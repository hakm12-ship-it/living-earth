import { describe, it, expect } from 'vitest';
import { parseTleText } from '../src/data/tle';

const sample = `ISS (ZARYA)
1 25544U 98067A   26231.51782528 -.00002182  00000-0 -11606-4 0  2927
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537
HST
1 20580U 90037B   26231.47404173  .00000954  00000-0  50213-4 0  9998
2 20580  28.4699 288.8102 0002424 321.7771 171.3708 15.09299865423838
BROKEN ENTRY
only one line`;

describe('parseTleText', () => {
  it('3줄 블록을 파싱한다', () => {
    const out = parseTleText(sample);
    expect(out[0].name).toBe('ISS (ZARYA)');
    expect(out[0].line1.startsWith('1 25544')).toBe(true);
    expect(out[0].line2.startsWith('2 25544')).toBe(true);
  });
  it('깨진 블록은 건너뛴다', () => {
    expect(parseTleText(sample)).toHaveLength(2);
  });
  it('빈 입력은 빈 배열', () => {
    expect(parseTleText('')).toEqual([]);
  });
});
