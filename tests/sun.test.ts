import { describe, it, expect } from 'vitest';
import { subsolarPoint } from '../src/globe/sun';

describe('subsolarPoint', () => {
  it('춘분 UTC 정오: 적도 부근, 경도 0 부근', () => {
    const p = subsolarPoint(new Date('2026-03-20T12:00:00Z'));
    expect(Math.abs(p.lat)).toBeLessThan(2);
    expect(Math.abs(p.lon)).toBeLessThan(4); // 균시차 무시로 오차 허용
  });

  it('하지 무렵: 위도 약 +23.4', () => {
    const p = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(p.lat).toBeGreaterThan(21);
    expect(p.lat).toBeLessThan(25);
  });

  it('동지 무렵: 위도 약 -23.4', () => {
    const p = subsolarPoint(new Date('2026-12-21T12:00:00Z'));
    expect(p.lat).toBeLessThan(-21);
    expect(p.lat).toBeGreaterThan(-25);
  });

  it('UTC 자정: 경도 180 부근', () => {
    const p = subsolarPoint(new Date('2026-03-20T00:00:00Z'));
    expect(Math.abs(Math.abs(p.lon) - 180)).toBeLessThan(4);
  });

  it('경도는 [-180, 180] 범위', () => {
    for (const h of [0, 6, 12, 18, 23]) {
      const p = subsolarPoint(new Date(`2026-08-19T${String(h).padStart(2, '0')}:00:00Z`));
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
    }
  });
});
