import { describe, it, expect } from 'vitest';
import { parseUsgs } from '../src/data/usgs';

const sample = {
  features: [
    {
      properties: { mag: 4.5, time: 1755500000000, place: '10km SW of Somewhere' },
      geometry: { coordinates: [139.7, 35.6, 10] }, // [lon, lat, depth]
    },
    {
      properties: { mag: null, time: 1755500000001, place: 'bad one' },
      geometry: { coordinates: [0, 0, 0] },
    },
    { properties: null, geometry: null },
  ],
};

describe('parseUsgs', () => {
  it('정상 feature를 변환한다 (coordinates는 [lon, lat] 순서)', () => {
    const out = parseUsgs(sample);
    expect(out[0]).toEqual({ lat: 35.6, lon: 139.7, mag: 4.5, time: 1755500000000, place: '10km SW of Somewhere' });
  });
  it('mag가 null이거나 깨진 feature는 건너뛴다', () => {
    expect(parseUsgs(sample)).toHaveLength(1);
  });
  it('features가 없으면 빈 배열', () => {
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs(null)).toEqual([]);
  });
});
