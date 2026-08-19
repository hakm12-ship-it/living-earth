import * as satellite from 'satellite.js';

/** 지상 관측자 위치(도 단위). 고도는 해수면 기준으로 충분해 다루지 않는다. */
export type Observer = { lat: number; lon: number };

/** 통과 한 건: 시작 시각과 그 통과에서의 최대 고도각. */
export type Pass = { start: Date; maxElevationDeg: number };

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** 지평선 위로 이 각도를 넘어야 "보인다"고 본다. 지평선 근처는 건물·산에 가린다. */
export const MIN_ELEVATION_DEG = 10;

/** 위성 바로 아래 지표면 지점(위경도, 도). 궤도 계산에 실패하면 null. */
export function subPoint(rec: satellite.SatRec, date: Date): { lat: number; lon: number } | null {
  const pv = satellite.propagate(rec, date);
  if (!pv) return null;
  const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  return { lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude) };
}

/**
 * 관측자에서 본 위성의 고도각(도). 90이면 천정, 0이면 지평선, 음수면 지평선 아래.
 * 궤도 계산에 실패하면 -90(=보이지 않음)을 돌려준다.
 */
export function elevationDeg(rec: satellite.SatRec, date: Date, obs: Observer): number {
  const pv = satellite.propagate(rec, date);
  if (!pv) return -90;
  const ecf = satellite.eciToEcf(pv.position, satellite.gstime(date));
  const look = satellite.ecfToLookAngles(
    { latitude: obs.lat * RAD, longitude: obs.lon * RAD, height: 0 },
    ecf,
  );
  return look.elevation * DEG;
}

/** 지금 관측자의 지평선 위에 떠 있는 위성 수. */
export function countAboveHorizon(
  recs: satellite.SatRec[],
  date: Date,
  obs: Observer,
  minElevationDeg = MIN_ELEVATION_DEG,
): number {
  let n = 0;
  for (const rec of recs) {
    if (elevationDeg(rec, date, obs) >= minElevationDeg) n++;
  }
  return n;
}

/**
 * 관측자 머리 위를 다음에 지나는 시각.
 *
 * from부터 stepSec 간격으로 앞으로 훑어 고도각이 기준을 처음 넘는 지점을 찾고,
 * 그 통과가 끝날 때까지 이어가며 최대 고도각을 기록한다. 이미 지나가는 중이면
 * from 자체가 시작 시각이 된다. 탐색 구간 안에 통과가 없으면 null.
 *
 * 30초 간격은 저궤도 위성이 지평선 위에 머무는 시간(보통 수 분)보다 충분히 짧아
 * 통과를 통째로 건너뛰지 않는다.
 */
export function nextPass(
  rec: satellite.SatRec,
  from: Date,
  obs: Observer,
  { hours = 24, stepSec = 30, minElevationDeg = MIN_ELEVATION_DEG } = {},
): Pass | null {
  const stepMs = stepSec * 1000;
  const end = from.getTime() + hours * 3600 * 1000;

  for (let t = from.getTime(); t <= end; t += stepMs) {
    const el = elevationDeg(rec, new Date(t), obs);
    if (el < minElevationDeg) continue;

    // 통과 시작을 찾았다. 지평선 아래로 내려갈 때까지 최대 고도각을 추적한다.
    const start = new Date(t);
    let maxEl = el;
    for (let u = t + stepMs; u <= end; u += stepMs) {
      const e = elevationDeg(rec, new Date(u), obs);
      if (e < minElevationDeg) break;
      if (e > maxEl) maxEl = e;
    }
    return { start, maxElevationDeg: maxEl };
  }
  return null;
}
