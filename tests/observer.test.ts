import { describe, it, expect } from 'vitest';
import * as satellite from 'satellite.js';
import { countAboveHorizon, elevationDeg, nextPass, subPoint } from '../src/utils/observer';

// 실제 TLE 한 건(CelesTrak visual 그룹). 통과 시각은 TLE epoch에 따라 달라지므로
// 특정 시각을 단언하지 않고, 어떤 TLE·어떤 시각에도 성립하는 관계만 검증한다.
const TLE1 = '1 00694U 63047A   26230.54267739  .00001237  00000+0  14063-3 0  9994';
const TLE2 = '2 00694  30.3542  10.6492 0545452  67.4554 298.2835 14.12609751154526';
const REF = new Date('2026-08-19T12:00:00Z');

function rec() {
  return satellite.twoline2satrec(TLE1, TLE2);
}

describe('subPoint', () => {
  it('위성 바로 아래 지점의 위경도를 돌려준다', () => {
    const p = subPoint(rec(), REF);
    expect(p).not.toBeNull();
    expect(p!.lat).toBeGreaterThanOrEqual(-90);
    expect(p!.lat).toBeLessThanOrEqual(90);
    expect(p!.lon).toBeGreaterThanOrEqual(-180);
    expect(p!.lon).toBeLessThanOrEqual(180);
    // 궤도 경사각이 30.35도이므로 위성은 그 범위를 벗어날 수 없다.
    expect(Math.abs(p!.lat)).toBeLessThanOrEqual(31);
  });
});

describe('elevationDeg', () => {
  it('바로 아래 지점에서 보면 천정에 가깝다', () => {
    const p = subPoint(rec(), REF)!;
    const el = elevationDeg(rec(), REF, { lat: p.lat, lon: p.lon });
    expect(el).toBeGreaterThan(85);
  });

  it('지구 반대편에서 보면 지평선 아래다', () => {
    const p = subPoint(rec(), REF)!;
    const antipodeLon = p.lon > 0 ? p.lon - 180 : p.lon + 180;
    const el = elevationDeg(rec(), REF, { lat: -p.lat, lon: antipodeLon });
    expect(el).toBeLessThan(0);
  });

  it('반환값은 -90 이상 90 이하다', () => {
    for (const lat of [-89, -45, 0, 37.5, 89]) {
      const el = elevationDeg(rec(), REF, { lat, lon: 127 });
      expect(el).toBeGreaterThanOrEqual(-90);
      expect(el).toBeLessThanOrEqual(90);
    }
  });
});

describe('countAboveHorizon', () => {
  it('바로 아래 지점에서는 그 위성이 보인다', () => {
    const p = subPoint(rec(), REF)!;
    expect(countAboveHorizon([rec()], REF, { lat: p.lat, lon: p.lon }, 10)).toBe(1);
  });

  it('지구 반대편에서는 보이지 않는다', () => {
    const p = subPoint(rec(), REF)!;
    const antipodeLon = p.lon > 0 ? p.lon - 180 : p.lon + 180;
    expect(countAboveHorizon([rec()], REF, { lat: -p.lat, lon: antipodeLon }, 10)).toBe(0);
  });

  it('빈 목록은 0이다', () => {
    expect(countAboveHorizon([], REF, { lat: 0, lon: 0 }, 10)).toBe(0);
  });
});

describe('nextPass', () => {
  it('이미 머리 위에 있으면 지금부터 통과 중으로 본다', () => {
    const p = subPoint(rec(), REF)!;
    const pass = nextPass(rec(), REF, { lat: p.lat, lon: p.lon });
    expect(pass).not.toBeNull();
    expect(pass!.start.getTime()).toBe(REF.getTime());
    expect(pass!.maxElevationDeg).toBeGreaterThan(85);
  });

  it('통과가 있으면 시작 시각이 탐색 구간 안에 있다', () => {
    const p = subPoint(rec(), REF)!;
    // 위성과 같은 위도대의 다른 경도 — 하루 안에 반드시 다시 지나간다.
    const pass = nextPass(rec(), REF, { lat: p.lat, lon: p.lon + 40 });
    expect(pass).not.toBeNull();
    expect(pass!.start.getTime()).toBeGreaterThanOrEqual(REF.getTime());
    expect(pass!.start.getTime()).toBeLessThanOrEqual(REF.getTime() + 24 * 3600 * 1000);
    expect(pass!.maxElevationDeg).toBeGreaterThanOrEqual(10);
  });

  it('궤도가 닿지 않는 극지방에서는 통과가 없다', () => {
    // 경사각 30.35도 위성은 북위 85도 상공에 절대 오지 않는다.
    expect(nextPass(rec(), REF, { lat: 85, lon: 0 })).toBeNull();
  });
});
