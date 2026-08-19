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
/** 파문을 붙일 최근 지진의 시간 창(시간). */
const RIPPLE_WINDOW_H = 6;
/** 파문을 붙일 최소 규모. 이보다 작으면 화면이 어지러워진다. */
const RIPPLE_MIN_MAG = 4;
/** 파문 개수 상한. 각 파문이 드로우콜 하나라 성능 예산을 지키려면 제한이 필요하다. */
const RIPPLE_MAX = 8;

// 발광 점: 불투명 구체 대신 가장자리가 부드럽게 사라지는 점으로 그린다.
// 구체는 지구 위에 스티커를 붙인 것처럼 보이고 지형을 가리는 반면, 가산 블렌딩된
// 점은 빛처럼 읽혀 밤면의 도시 불빛과 자연스럽게 어울린다.
// THREE.Points는 항상 카메라를 향하므로 빌보딩을 따로 하지 않아도 된다.
const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
varying float vSize;
uniform float uFade;
void main() {
  vColor = aColor;
  vSize = aSize;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // 원근에 따라 크기를 줄인다(가까울수록 크게).
  gl_PointSize = aSize * uFade * (4.2 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
varying vec3 vColor;
uniform float uFade;
void main() {
  // 점 내부 좌표로 중심에서의 거리를 구해 부드럽게 감쇠시킨다.
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  // 색은 그대로 두고 알파로만 감쇠시킨다. 가산 블렌딩을 쓰면 밝은 낮면 위에서
  // 채널이 포화돼 전부 흰 점이 되어 깊이 색 구분이 사라진다.
  float core = pow(1.0 - d, 2.2) * 1.4;  // 중심의 진한 알갱이
  float halo = pow(1.0 - d, 1.4) * 0.25; // 바깥으로 퍼지는 옅은 테두리
  gl_FragColor = vec4(vColor, min(core + halo, 1.0) * uFade);
  #include <colorspace_fragment>
}
`;

/**
 * 규모에 따른 점 크기.
 *
 * 지진 규모는 로그 척도라 선형으로 매핑하면 M2와 M6이 비슷해 보인다(에너지는
 * 약 1000배 차이인데도). 밑을 1.7로 둔 지수 매핑이면 규모 1당 1.7배씩 커져
 * 큰 지진이 확실히 도드라지면서도 화면을 뒤덮지는 않는다.
 */
function sizeForMag(mag: number): number {
  return 1.6 + Math.pow(1.7, Math.max(mag, 0));
}

/**
 * 진원 깊이에 따른 색.
 *
 * 지진학에서 쓰는 관례를 따라 얕을수록 따뜻한 색, 깊을수록 차가운 색으로 둔다.
 * 대부분의 지진이 얕은 곳에 몰려 있으므로 깊이를 그대로 쓰지 않고 로그로 눌러
 * 0~70km 구간에서도 색이 구분되게 한다.
 */
function colorForDepth(depthKm: number, target: THREE.Color): THREE.Color {
  // 300km 이상은 모두 가장 차가운 색으로 묶는다. 그보다 깊은 지진은 드물고,
  // 구간을 넓게 잡으면 정작 대부분이 몰린 얕은 쪽의 색 차이가 뭉개진다.
  const t = Math.min(Math.max(depthKm, 0) / 300, 1);
  // 0.02(주황빨강) -> 0.55(청록)
  return target.setHSL(0.02 + t * 0.53, 0.95, 0.6);
}

export class EarthquakeLayer implements Layer {
  markers: THREE.Points | null = null;
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

    const positions = new Float32Array(this.quakes.length * 3);
    const colors = new Float32Array(this.quakes.length * 3);
    const sizes = new Float32Array(this.quakes.length);

    const color = new THREE.Color();
    const now = Date.now();
    this.quakes.forEach((q, i) => {
      const pos = latLonToVector3(q.lat, q.lon, GLOBE_RADIUS * 1.004);
      positions.set([pos.x, pos.y, pos.z], i * 3);

      colorForDepth(q.depthKm, color);
      // 최근일수록 밝게. 오래된 지진은 잔불처럼 가라앉는다.
      const recency = Math.max(0, 1 - (now - q.time) / 86400000);
      const dim = 0.45 + recency * 0.55;
      colors.set([color.r * dim, color.g * dim, color.b * dim], i * 3);

      sizes[i] = sizeForMag(q.mag);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uFade: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });

    this.markers = new THREE.Points(geo, mat);
    this.markers.frustumCulled = false;
    this.group.add(this.markers);

    // 최근에 일어난 큰 지진에만 파문을 얹는다. 규모가 아니라 "방금 일어났는가"를
    // 기준으로 두면 볼 때마다 다른 곳이 반짝여, 지구가 살아있다는 인상이 살아난다.
    const rippleCutoff = now - RIPPLE_WINDOW_H * 3600 * 1000;
    const recent = this.quakes
      .filter((q) => q.mag >= RIPPLE_MIN_MAG && q.time >= rippleCutoff)
      .sort((a, b) => b.time - a.time)
      .slice(0, RIPPLE_MAX);

    for (const q of recent) {
      const pulseMat = new THREE.ShaderMaterial({
        vertexShader: PULSE_VERT,
        fragmentShader: PULSE_FRAG,
        uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
        transparent: true,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), pulseMat);
      const pos = latLonToVector3(q.lat, q.lon, GLOBE_RADIUS * 1.006);
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

  // 클릭 피킹용: Points의 index로부터 원본 지진 데이터를 찾는다.
  getQuakeAt(index: number): Earthquake | undefined {
    return this.quakes[index];
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
