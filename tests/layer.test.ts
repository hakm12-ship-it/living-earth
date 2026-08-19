import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { LayerManager, type Layer } from '../src/layers/layer';

function fakeLayer(): Layer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    init: vi.fn(async () => void calls.push('init')),
    update: (t: number) => calls.push(`update:${t}`),
    setVisible: (v: boolean) => calls.push(`visible:${v}`),
    setActive: (a: boolean) => calls.push(`active:${a}`),
    dispose: () => calls.push('dispose'),
    getStatus: () => 'ok' as const,
  };
}

describe('LayerManager', () => {
  it('add하면 init이 호출된다', () => {
    const m = new LayerManager(new THREE.Scene());
    const l = fakeLayer();
    m.add('eq', l);
    expect(l.init).toHaveBeenCalledOnce();
  });

  it('update는 모든 레이어에 위임', () => {
    const m = new LayerManager(new THREE.Scene());
    const a = fakeLayer();
    const b = fakeLayer();
    m.add('a', a);
    m.add('b', b);
    m.update(123);
    expect(a.calls).toContain('update:123');
    expect(b.calls).toContain('update:123');
  });

  it('setVisible은 해당 레이어에만 위임', () => {
    const m = new LayerManager(new THREE.Scene());
    const a = fakeLayer();
    const b = fakeLayer();
    m.add('a', a);
    m.add('b', b);
    m.setVisible('a', false);
    expect(a.calls).toContain('visible:false');
    expect(b.calls).not.toContain('visible:false');
  });

  it('setActive는 모든 레이어에 위임', () => {
    const m = new LayerManager(new THREE.Scene());
    const a = fakeLayer();
    m.add('a', a);
    m.setActive(false);
    expect(a.calls).toContain('active:false');
  });

  // 회귀 테스트: Task 6 리뷰에서 드러난 위험 — Poller.start()는 캐시된 값을
  // onData로 동기 방출할 때 try/catch로 감싸지 않는다. 레이어는 init() 안에서
  // poller.start()를 호출하므로, onData가 캐시 데이터에서 예외를 던지면
  // init()이 반환한 Promise가 reject된다. add()는 이 반환값을 그냥 버리므로
  // (void layer.init(...)), 이를 방치하면 unhandled rejection이 되어
  // Task 14의 콘솔 에러 zero 스모크 테스트를 깨뜨릴 수 있다.
  it('init이 reject해도 unhandled rejection이 발생하지 않고 매니저는 계속 정상 동작한다', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = new LayerManager(new THREE.Scene());
    const bad: Layer = {
      init: vi.fn(() => Promise.reject(new Error('init 실패'))),
      update: vi.fn(),
      setVisible: vi.fn(),
      setActive: vi.fn(),
      dispose: vi.fn(),
      getStatus: () => 'error' as const,
    };
    const good = fakeLayer();

    m.add('bad', bad);
    m.add('good', good);

    // 마이크로태스크 큐를 비워 reject된 init()의 후속 catch 핸들러가 실행되게 한다.
    await Promise.resolve();
    await Promise.resolve();

    // 실패가 조용히 삼켜지지 않고 보고되어야 한다.
    expect(consoleErrorSpy).toHaveBeenCalled();

    // 매니저는 여전히 사용 가능해야 한다: 다른 레이어는 정상적으로 update/setVisible을 받는다.
    m.update(1);
    m.setVisible('good', false);
    expect(good.calls).toContain('update:1');
    expect(good.calls).toContain('visible:false');

    consoleErrorSpy.mockRestore();
  });

  // 회귀 테스트: Three.js는 renderer.setAnimationLoop(cb) 콜백이 "반환된 뒤에야"
  // 다음 rAF를 예약한다. update()가 레이어별 try/catch로 격리되지 않으면, 한
  // 레이어의 update()가 던지는 예외가 LayerManager.update() 자체를 중단시키고
  // 그 예외가 상위 렌더 루프까지 전파되어 전체 렌더 루프(지구본 포함)가 영구히
  // 멈춘다 — 스펙의 "데이터가 죽어도 지구는 산다" 원칙 위반.
  it('한 레이어의 update()가 던져도 다른 레이어는 계속 갱신되고 예외가 전파되지 않는다', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = new LayerManager(new THREE.Scene());
    const bad: Layer = {
      init: vi.fn(async () => {}),
      update: vi.fn(() => {
        throw new Error('update 실패');
      }),
      setVisible: vi.fn(),
      setActive: vi.fn(),
      dispose: vi.fn(),
      getStatus: () => 'error' as const,
    };
    const good = fakeLayer();
    m.add('bad', bad);
    m.add('good', good);

    // update() 호출 자체가 예외를 던지지 않아야 한다(그래야 상위 rAF 콜백/렌더가 이어진다).
    expect(() => m.update(1)).not.toThrow();
    expect(good.calls).toContain('update:1');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    // 계속 던지는 레이어라도 매 프레임 콘솔을 도배하지 않고 최초 1회만 로그한다.
    expect(() => m.update(2)).not.toThrow();
    expect(() => m.update(3)).not.toThrow();
    expect(good.calls).toContain('update:2');
    expect(good.calls).toContain('update:3');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
