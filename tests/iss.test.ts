import { describe, it, expect } from 'vitest';
import { parseIss } from '../src/data/iss-api';
import { lerpLatLon } from '../src/utils/geo';

describe('parseIss', () => {
  it('API 응답을 IssState로 변환', () => {
    const s = parseIss({ latitude: 12.3, longitude: -45.6, altitude: 420.5, velocity: 27580 });
    expect(s).toEqual({ lat: 12.3, lon: -45.6, altKm: 420.5, velocityKmh: 27580 });
  });
  it('필드 누락이면 throw', () => {
    expect(() => parseIss({ latitude: 1 })).toThrow();
    expect(() => parseIss(null)).toThrow();
  });
});

describe('lerpLatLon', () => {
  it('일반 보간', () => {
    const p = lerpLatLon({ lat: 0, lon: 10 }, { lat: 10, lon: 20 }, 0.5);
    expect(p.lat).toBeCloseTo(5);
    expect(p.lon).toBeCloseTo(15);
  });
  it('날짜변경선을 짧은 경로로 넘는다 (179 -> -179)', () => {
    const p = lerpLatLon({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }, 0.5);
    expect(Math.abs(p.lon)).toBeCloseTo(180, 1);
  });
  it('결과 경도는 [-180, 180] 범위', () => {
    const p = lerpLatLon({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.9);
    expect(p.lon).toBeGreaterThanOrEqual(-180);
    expect(p.lon).toBeLessThanOrEqual(180);
  });
});
