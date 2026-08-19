import * as THREE from 'three';
import type { Layer } from './layer';
import { Poller } from '../data/poller';
import { fetchUsgs } from '../data/usgs';
import type { Earthquake } from '../data/usgs';
import { latLonToVector3, GLOBE_RADIUS } from '../utils/geo';
import { LayerFade } from './fade';

// 펄스 링 셰이더: 정점은 평면 그대로 통과시키고, 프래그먼트에서 uTime에 따라
// 중심에서 바깥으로 퍼지는 링을 그린다(2초 주기). CPU에서 프레임마다 지오메트리를
// 건드리지 않고 GPU 유니폼만 갱신하므로 비용이 낮다.
const PULSE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PULSE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade; // 레이어 토글 페이드(0~1) — LayerFade가 매 프레임 갱신
varying vec2 vUv;
void main() {
  float d = distance(vUv, vec2(0.5)) * 2.0;      // 0(중심)~1(가장자리)
  float wave = fract(uTime * 0.5);                // 2초 주기로 퍼지는 링
  float ring = smoothstep(wave - 0.08, wave, d) * (1.0 - smoothstep(wave, wave + 0.04, d));
  gl_FragColor = vec4(1.0, 0.25, 0.15, ring * (1.0 - wave) * 0.9 * uFade);
}
`;

const MAX_QUAKES = 500;

// 지진 레이어: USGS 24시간 피드를 폴링해 InstancedMesh 마커 1개(드로우콜 1)로 렌더링하고,
// M5 이상인 지진에 한해 GPU 셰이더 유니폼으로 애니메이션되는 펄스 링을 추가한다.
export class EarthquakeLayer implements Layer {
  markers: THREE.InstancedMesh | null = null;
  private group = new THREE.Group();
  private quakes: Earthquake[] = [];
  private pulseMaterials: THREE.ShaderMaterial[] = [];
  private poller: Poller<Earthquake[]>;
  private status: 'ok' | 'error' | 'loading' = 'loading';
  private onStatusChange?: (s: 'ok' | 'error' | 'loading') => void;
  private fade = new LayerFade(this.group, true); // 기본 켜짐(spec)

  constructor(onStatusChange?: (s: 'ok' | 'error' | 'loading') => void) {
    this.onStatusChange = onStatusChange;
    this.poller = new Poller({
      fetchFn: fetchUsgs,
      intervalMs: 5 * 60 * 1000,
      cacheKey: 'usgs-quakes',
      onData: (quakes) => this.rebuild(quakes),
      onStatus: (s) => {
        this.status = s;
        this.onStatusChange?.(s);
      },
    });
  }

  async init(scene: THREE.Scene): Promise<void> {
    scene.add(this.group);
    this.poller.start();
  }

  private rebuild(quakes: Earthquake[]): void {
    this.clearMeshes();
    this.quakes = quakes.slice(0, MAX_QUAKES);

    // 16x16: 8x8은 가까이서 보면 각진 다면체로 보인다(스펙 §5). 하나의 지오메트리를
    // InstancedMesh 전체가 공유하므로 세그먼트를 올려도 비용은 마커 수와 무관하게 1회다.
    const geo = new THREE.SphereGeometry(1, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    this.markers = new THREE.InstancedMesh(geo, mat, this.quakes.length);

    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const now = Date.now();
    this.quakes.forEach((q, i) => {
      const pos = latLonToVector3(q.lat, q.lon, GLOBE_RADIUS * 1.002);
      const size = 0.004 + Math.max(q.mag, 0) * 0.0035; // M2 작게, M6+ 크게
      m.makeScale(size, size, size).setPosition(pos);
      this.markers!.setMatrixAt(i, m);
      // 색: 규모(노랑->빨강) + 최근일수록 밝게
      const recency = Math.max(0, 1 - (now - q.time) / 86400000); // 0~1
      color.setHSL(Math.max(0.12 - q.mag * 0.02, 0), 1.0, 0.35 + recency * 0.3);
      this.markers!.setColorAt(i, color);
    });
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    this.group.add(this.markers);

    // M5+ 펄스 링 (지표면에 접하는 평면 링)
    for (const q of this.quakes.filter((q) => q.mag >= 5)) {
      const pulseMat = new THREE.ShaderMaterial({
        vertexShader: PULSE_VERT,
        fragmentShader: PULSE_FRAG,
        uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
        transparent: true,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), pulseMat);
      const pos = latLonToVector3(q.lat, q.lon, GLOBE_RADIUS * 1.005);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2)); // 지표면 접선 방향
      this.pulseMaterials.push(pulseMat);
      this.group.add(ring);
    }
  }

  private clearMeshes(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    this.markers = null;
    this.pulseMaterials = [];
  }

  // 클릭 피킹용: InstancedMesh의 instanceId로부터 원본 지진 데이터를 찾는다.
  getQuakeAt(instanceId: number): Earthquake | undefined {
    return this.quakes[instanceId];
  }

  update(time: number): void {
    for (const mat of this.pulseMaterials) mat.uniforms.uTime.value = time / 1000;
    this.fade.tick(time);
  }

  setVisible(visible: boolean): void {
    this.fade.setVisible(visible);
  }

  setActive(active: boolean): void {
    if (active) this.poller.resume();
    else this.poller.pause();
  }

  getStatus(): 'ok' | 'error' | 'loading' {
    return this.status;
  }

  dispose(): void {
    this.poller.stop();
    this.clearMeshes();
  }
}
