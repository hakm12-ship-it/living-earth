import * as THREE from 'three';
import type { Layer } from './layer';
import { Poller } from '../data/poller';
import { fetchIss } from '../data/iss-api';
import type { IssState } from '../data/iss-api';
import { latLonToVector3, altitudeToRadius, lerpLatLon } from '../utils/geo';
import { LayerFade } from './fade';

const TRAIL_MAX = 120;
const POLL_MS = 5000;
// 실제 ISS 고도(~420km)는 지구 반지름의 6.6%에 불과해 그대로 그리면 지표에 붙어 보인다.
// 시각적 명료성을 위해 마커/궤적 위치 계산에서만 고도를 8배 과장하고,
// getState()가 반환하는 값(정보 카드용)은 실제 고도를 그대로 유지한다.
const ALT_EXAGGERATION = 8;

// ISS 레이어: wheretheiss.at을 5초 간격으로 폴링하고, 직전-최신 샘플 사이를
// 폴링 간격 동안 위경도 보간(lerpLatLon)하여 마커가 매끄럽게 이동하도록 한다.
// 최근 위치를 최대 120개 이어 궤적(Line)을 그린다.
export class IssLayer implements Layer {
  marker: THREE.Mesh | null = null;
  private group = new THREE.Group();
  private prev: IssState | null = null;
  private next: IssState | null = null;
  private lastDataAt = 0;
  private current: IssState | null = null;
  private trail: THREE.Vector3[] = [];
  private trailLine: THREE.Line | null = null;
  private poller: Poller<IssState>;
  private status: 'ok' | 'error' | 'loading' = 'loading';
  private onStatusChange?: (s: 'ok' | 'error' | 'loading') => void;
  private fade = new LayerFade(this.group, true); // 기본 켜짐(spec)

  constructor(onStatusChange?: (s: 'ok' | 'error' | 'loading') => void) {
    this.onStatusChange = onStatusChange;
    this.poller = new Poller({
      fetchFn: fetchIss,
      intervalMs: POLL_MS,
      onData: (state) => {
        this.prev = this.next ?? state;
        this.next = state;
        this.lastDataAt = performance.now();
      },
      onStatus: (s) => {
        this.status = s;
        this.onStatusChange?.(s);
      },
    });
  }

  async init(scene: THREE.Scene): Promise<void> {
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true }),
    );
    this.group.add(this.marker);

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    this.trailLine = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.5 }),
    );
    this.trailLine.frustumCulled = false;
    this.group.add(this.trailLine);

    scene.add(this.group);
    this.poller.start();
  }

  update(time: number): void {
    this.fade.tick(time);
    if (!this.prev || !this.next || !this.marker || !this.trailLine) return;
    const t = Math.min((performance.now() - this.lastDataAt) / POLL_MS, 1);
    const p = lerpLatLon(this.prev, this.next, t);
    const altKm = this.prev.altKm + (this.next.altKm - this.prev.altKm) * t;
    // current: 정보 카드에 노출되는 실제 값. 렌더용 고도 과장을 적용하지 않는다.
    this.current = { lat: p.lat, lon: p.lon, altKm, velocityKmh: this.next.velocityKmh };

    // pos: 화면 표시용 좌표. 고도만 8배 과장해 지표 위에 떠 보이도록 한다.
    const pos = latLonToVector3(p.lat, p.lon, altitudeToRadius(altKm * ALT_EXAGGERATION));
    this.marker.position.copy(pos);

    // 궤적: 마지막 점과 충분히 멀어지면 추가
    if (this.trail.length === 0 || this.trail[this.trail.length - 1].distanceTo(pos) > 0.01) {
      this.trail.push(pos.clone());
      if (this.trail.length > TRAIL_MAX) this.trail.shift();
      const attr = this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.trail.forEach((v, i) => attr.setXYZ(i, v.x, v.y, v.z));
      // 남는 슬롯은 마지막 점으로 채움 (0,0,0으로 선이 튀는 것 방지)
      const last = this.trail[this.trail.length - 1];
      for (let i = this.trail.length; i < TRAIL_MAX; i++) attr.setXYZ(i, last.x, last.y, last.z);
      attr.needsUpdate = true;
    }
  }

  getState(): IssState | null {
    return this.current;
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
    this.marker?.geometry.dispose();
    (this.marker?.material as THREE.Material | undefined)?.dispose();
    this.trailLine?.geometry.dispose();
    (this.trailLine?.material as THREE.Material | undefined)?.dispose();
  }
}
