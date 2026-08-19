import { describe, it, expect } from 'vitest';
import { latLonToVector3, altitudeToRadius, GLOBE_RADIUS } from '../src/utils/geo';

describe('latLonToVector3', () => {
  it('북극(90,0)은 +Y축', () => {
    const v = latLonToVector3(90, 0, 1);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(1, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it('남극(-90,0)은 -Y축', () => {
    const v = latLonToVector3(-90, 0, 1);
    expect(v.y).toBeCloseTo(-1, 5);
  });

  it('반지름 스케일이 적용된다', () => {
    const v = latLonToVector3(0, 45, 2.5);
    expect(v.length()).toBeCloseTo(2.5, 5);
  });

  it('날짜변경선: lon 180과 -180은 같은 점', () => {
    const a = latLonToVector3(10, 180, 1);
    const b = latLonToVector3(10, -180, 1);
    expect(a.distanceTo(b)).toBeCloseTo(0, 5);
  });

  it('lon 90과 -90은 대칭', () => {
    const a = latLonToVector3(0, 90, 1);
    const b = latLonToVector3(0, -90, 1);
    expect(a.x).toBeCloseTo(-b.x, 5);
    expect(a.z).toBeCloseTo(-b.z, 5);
  });
});

describe('altitudeToRadius', () => {
  it('고도 0km는 지표면', () => {
    expect(altitudeToRadius(0)).toBeCloseTo(GLOBE_RADIUS, 5);
  });
  it('고도 6371km는 반지름 2배', () => {
    expect(altitudeToRadius(6371)).toBeCloseTo(GLOBE_RADIUS * 2, 5);
  });
});
