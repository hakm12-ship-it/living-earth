import * as THREE from 'three';
import * as satellite from 'satellite.js';
import type { Layer } from './layer';
import { cacheGet, cacheSet } from '../data/poller';
import { fetchTle } from '../data/tle';
import type { TleEntry } from '../data/tle';
import { latLonToVector3, altitudeToRadius } from '../utils/geo';
import { LayerFade } from './fade';

const PROPAGATE_MS = 500;
const TLE_CACHE_KEY = 'celestrak-tle';
const TLE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 하루 1회 갱신

// 위성 레이어: CelesTrak "visual" 그룹의 TLE를 하루 1회 캐싱해 가져오고,
// satellite.js(SGP4)로 초당 2회 propagation한 뒤 프레임 사이는 보간(lerp)한다.
// 위성 전체를 InstancedMesh 1개로 그려 드로우콜을 1로 유지한다.
export class SatelliteLayer implements Layer {
  mesh: THREE.InstancedMesh | null = null;
  private group = new THREE.Group();
  private names: string[] = [];
  private orbitLine: THREE.Line | null = null;
  private satrecs: satellite.SatRec[] = [];
  private prevPos: THREE.Vector3[] = [];
  private nextPos: THREE.Vector3[] = [];
  private lastPropagateAt = 0;
  private maxCount = 150;
  private status: 'ok' | 'error' | 'loading' = 'loading';
  private active = true;
  private onStatusChange: ((s: 'ok' | 'error' | 'loading') => void) | undefined;
  private fade = new LayerFade(this.group, false); // 기본 꺼짐(spec)
  // 세션 내 재시도가 진행 중일 때 중복 fetch를 막는 플래그.
  private retrying = false;
  // 파싱된 TLE 원본. maxCount가 다시 늘어날 때 이 목록에서 재빌드한다.
  private entries: TleEntry[] = [];

  constructor(onStatusChange?: (s: 'ok' | 'error' | 'loading') => void) {
    this.onStatusChange = onStatusChange;
  }

  async init(scene: THREE.Scene): Promise<void> {
    scene.add(this.group);

    // TLE는 하루 한 번이면 충분 — 캐시가 신선하면 네트워크 생략
    const cached = cacheGet<{ at: number; entries: TleEntry[] }>(TLE_CACHE_KEY);
    if (cached && Date.now() - cached.at < TLE_MAX_AGE_MS) {
      this.build(cached.entries);
      return;
    }
    try {
      const entries = await fetchTle();
      cacheSet(TLE_CACHE_KEY, { at: Date.now(), entries });
      this.build(entries);
    } catch {
      if (cached) this.build(cached.entries); // 오래됐어도 캐시가 있으면 사용
      else {
        this.status = 'error';
        this.onStatusChange?.('error');
      }
    }
  }

  // CelesTrak이 rate-limit(403) 등으로 초기 fetch에 실패하면 status가 'error'로
  // 고정되어 새로고침 전까지는 위성이 영구히 비활성 상태가 된다. 사용자가 패널에서
  // 위성 토글을 다시 켤 때(=setVisible(true)) 딱 한 번만 재시도한다 — 백그라운드
  // 재시도 루프는 두지 않는다(이미 rate-limit 중인 엔드포인트를 두드리지 않기 위함).
  private async retryInit(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    this.status = 'loading';
    this.onStatusChange?.('loading');
    try {
      const entries = await fetchTle();
      cacheSet(TLE_CACHE_KEY, { at: Date.now(), entries });
      this.build(entries);
    } catch {
      this.status = 'error';
      this.onStatusChange?.('error');
    } finally {
      this.retrying = false;
    }
  }

  private build(entries: TleEntry[]): void {
    this.entries = entries;
    // 재빌드 시 인스턴스 인덱스가 달라지므로 이전 메시와 궤도선은 버린다.
    this.hideOrbit();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    const now = new Date();
    const gmst = satellite.gstime(now);

    // 이름과 satrec의 인덱스가 어긋나지 않도록 쌍으로 필터링.
    // 최초 propagate가 실패하는 satrec(SGP4 오류, 디코이 등)은 여기서 제외한다 —
    // 그렇지 않으면 prevPos가 아직 빈 배열이라 fallback이 (0,0,0)(지구 중심)으로
    // 계산되고, 이후 tick에서도 계속 그 값을 이어받아 지구 중심에 영구히 박힌
    // "유령 위성" 인스턴스가 생긴다(피킹 대상에 지구본이 없어 클릭 시 선택될 수 있음).
    // 빌드 이후 시점에 propagate가 실패하는 경우는 update()의 propagate()에서
    // 마지막으로 유효했던 위치(prevPos)를 그대로 유지하도록 처리한다(원점행 없음).
    const pairs = entries
      .slice(0, this.maxCount)
      .map((e) => ({ name: e.name, rec: satellite.twoline2satrec(e.line1, e.line2) }))
      .filter((p) => p.rec.error === 0)
      .map((p) => ({ ...p, pv: satellite.propagate(p.rec, now) }))
      .filter((p): p is { name: string; rec: satellite.SatRec; pv: NonNullable<typeof p.pv> } => p.pv !== null);

    this.names = pairs.map((p) => p.name);
    this.satrecs = pairs.map((p) => p.rec);
    this.nextPos = pairs.map((p) => {
      const geo = satellite.eciToGeodetic(p.pv.position, gmst);
      return latLonToVector3(
        satellite.degreesLat(geo.latitude),
        satellite.degreesLong(geo.longitude),
        altitudeToRadius(geo.height * 3), // 시각적 과장 x3 (LEO 밀집 완화)
      );
    });
    this.prevPos = this.nextPos.map((v) => v.clone());
    this.lastPropagateAt = performance.now();

    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.006, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffcc, transparent: true }),
      this.satrecs.length,
    );
    this.group.add(this.mesh);
    this.status = 'ok';
    this.onStatusChange?.('ok');
  }

  // satellite.js 7.x: propagate()는 실패 시 `{position:false}`가 아니라 null을 반환한다
  // (구버전 API와 다름 — 설치된 버전 확인 후 이에 맞춰 구현).
  private propagate(): void {
    const now = new Date();
    const gmst = satellite.gstime(now);
    this.prevPos = this.nextPos;
    this.nextPos = this.satrecs.map((rec, i) => {
      const pv = satellite.propagate(rec, now);
      if (!pv) {
        return this.prevPos[i]?.clone() ?? new THREE.Vector3();
      }
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      return latLonToVector3(
        satellite.degreesLat(geo.latitude),
        satellite.degreesLong(geo.longitude),
        altitudeToRadius(geo.height * 3), // 시각적 과장 x3 (LEO 밀집 완화)
      );
    });
    this.lastPropagateAt = performance.now();
  }

  update(time: number): void {
    this.fade.tick(time);
    if (!this.mesh || this.satrecs.length === 0 || !this.active) return;
    if (performance.now() - this.lastPropagateAt >= PROPAGATE_MS) this.propagate();

    const t = Math.min((performance.now() - this.lastPropagateAt) / PROPAGATE_MS, 1);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < this.nextPos.length; i++) {
      const a = this.prevPos[i] ?? this.nextPos[i];
      p.lerpVectors(a, this.nextPos[i], t);
      m.setPosition(p);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setMaxCount(n: number): void {
    if (n === this.maxCount) return;
    const grew = n > this.maxCount;
    this.maxCount = n;
    if (!this.mesh) return; // 아직 빌드 전이면 다음 빌드에 반영된다

    if (grew) {
      // 저사양 -> 고사양 복귀. 잘라낸 위성은 satrecs에 남아 있지 않으므로
      // 보관해 둔 TLE 원본에서 다시 만든다.
      if (this.entries.length > this.satrecs.length) this.build(this.entries);
      return;
    }
    if (this.satrecs.length > n) {
      this.satrecs = this.satrecs.slice(0, n);
      this.names = this.names.slice(0, n);
      this.prevPos = this.prevPos.slice(0, n);
      this.nextPos = this.nextPos.slice(0, n);
      this.mesh.count = n;
    }
  }

  getSatName(instanceId: number): string | undefined {
    return this.names[instanceId];
  }

  // 선택 위성의 궤도선: 위성 고유 주기를 64등분해 propagation.
  // satrec.no는 SGP4 평균운동(라디안/분, kozai 보정 제외)이므로 주기(분) = 2π / no.
  // (satellite.js 7.1.0 SatRec.d.ts에서 확인: "Mean motion in radians per minute without kozai.")
  // 값이 없거나 비정상(무한/음수/비현실적 범위)이면 대표값(95분, LEO 근사)으로 대체한다.
  showOrbit(instanceId: number): void {
    this.hideOrbit();
    const rec = this.satrecs[instanceId];
    if (!rec) return;
    const DEFAULT_PERIOD_MIN = 95;
    const computedPeriodMin = (2 * Math.PI) / rec.no;
    const periodMin =
      Number.isFinite(computedPeriodMin) && computedPeriodMin > 1 && computedPeriodMin < 1500
        ? computedPeriodMin
        : DEFAULT_PERIOD_MIN;
    const points: THREE.Vector3[] = [];
    const start = Date.now();
    // gmst는 한 시점(start) 것으로 고정한다. 매 표본점마다 그 시각의 gmst를 쓰면
    // 지구 자전이 함께 반영되어 "지상 궤적(ground track)"이 되는데, 이는 한 주기
    // 동안 지구가 자전한 만큼(경도 약 20~30°) 시작점과 끝점이 어긋나 궤도선이
    // 닫히지 않는다. 궤도의 실제 타원 형태(관성계 궤적)를 지구본 위에 겹쳐 그리려면
    // 모든 표본점에 동일한 gmst를 적용해 지구가 그 순간에 고정된 것처럼 변환해야 한다.
    const gmst = satellite.gstime(new Date(start));
    for (let i = 0; i <= 64; i++) {
      const d = new Date(start + (i / 64) * periodMin * 60 * 1000);
      const pv = satellite.propagate(rec, d);
      if (!pv) continue;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      points.push(
        latLonToVector3(
          satellite.degreesLat(geo.latitude),
          satellite.degreesLong(geo.longitude),
          altitudeToRadius(geo.height * 3),
        ),
      );
    }
    this.orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffffcc, transparent: true, opacity: 0.4 }),
    );
    this.group.add(this.orbitLine);
  }

  hideOrbit(): void {
    if (!this.orbitLine) return;
    this.group.remove(this.orbitLine);
    this.orbitLine.geometry.dispose();
    (this.orbitLine.material as THREE.Material).dispose();
    this.orbitLine = null;
  }

  setVisible(visible: boolean): void {
    this.fade.setVisible(visible);
    if (!visible) this.hideOrbit();
    // 이전 init/재시도가 실패해 status가 'error'인 상태에서 사용자가 다시 켰다면
    // 새로고침 없이도 이번 세션 안에서 복구를 시도한다(한 번만, 자동 반복 없음).
    else if (this.status === 'error') void this.retryInit();
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  getStatus(): 'ok' | 'error' | 'loading' {
    return this.status;
  }

  dispose(): void {
    this.hideOrbit();
    this.mesh?.geometry.dispose();
    (this.mesh?.material as THREE.Material | undefined)?.dispose();
  }
}
