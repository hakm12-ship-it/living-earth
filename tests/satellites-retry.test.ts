import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// SatelliteLayer는 모듈 최상단에서 fetchTle를 import해 쓰므로, 실제 네트워크 호출
// 없이 성공/실패를 제어하려면 모듈 자체를 목(mock)으로 바꿔야 한다.
const fetchTleMock = vi.fn();
vi.mock('../src/data/tle', () => ({ fetchTle: () => fetchTleMock() }));

// localStorage 캐시도 격리한다 — 이전 테스트/실행에서 남은 TLE 캐시가 있으면
// init()이 네트워크를 아예 타지 않아 이 테스트의 전제(최초 fetch 실패)가 깨진다.
vi.mock('../src/data/poller', () => ({
  cacheGet: () => null,
  cacheSet: () => {},
}));

import { SatelliteLayer } from '../src/layers/satellites';

// 실제 SGP4 파싱이 가능한 유효한 TLE 한 쌍(ISS). build()가 이 데이터를 propagate할
// 수 있어야 status가 'ok'로 전이된다.
const VALID_ENTRIES = [
  {
    name: 'ISS (ZARYA)',
    line1: '1 25544U 98067A   26231.51782528 -.00002182  00000-0 -11606-4 0  2927',
    line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537',
  },
];

describe('SatelliteLayer: 세션 내 재시도', () => {
  beforeEach(() => {
    fetchTleMock.mockReset();
  });

  it('초기 fetch 실패 후 setVisible(true)를 호출하면 재시도해서 복구한다', async () => {
    fetchTleMock.mockRejectedValueOnce(new Error('CelesTrak 403'));
    const statuses: Array<'ok' | 'error' | 'loading'> = [];
    const layer = new SatelliteLayer((s) => statuses.push(s));

    await layer.init(new THREE.Scene());
    expect(layer.getStatus()).toBe('error'); // 새로고침 없이는 여기서 영구히 멈추던 결함

    fetchTleMock.mockResolvedValueOnce(VALID_ENTRIES);
    layer.setVisible(true); // 사용자가 토글을 다시 켬 = 재시도 트리거
    // retryInit()은 내부에서 await하는 비동기 함수라 마이크로태스크 큐를 비워야 한다.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(layer.getStatus()).toBe('ok');
    expect(fetchTleMock).toHaveBeenCalledTimes(2); // 최초 1회 + 재시도 1회, 자동 반복 없음
  });

  it('재시도도 실패하면 다시 error 상태가 되고(체크박스로 또 재시도 가능), 무한 반복하지 않는다', async () => {
    fetchTleMock.mockRejectedValueOnce(new Error('CelesTrak 403'));
    const layer = new SatelliteLayer();
    await layer.init(new THREE.Scene());
    expect(layer.getStatus()).toBe('error');

    fetchTleMock.mockRejectedValueOnce(new Error('CelesTrak 403 again'));
    layer.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(layer.getStatus()).toBe('error');
    expect(fetchTleMock).toHaveBeenCalledTimes(2); // 재시도는 토글 액션당 정확히 1회
  });
});
