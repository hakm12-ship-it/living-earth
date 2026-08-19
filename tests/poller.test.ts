import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { backoffDelay, cacheGet, cacheSet, Poller } from '../src/data/poller';

describe('backoffDelay', () => {
  it('5초 -> 10초 -> 30초 -> 60초 상한', () => {
    expect(backoffDelay(0)).toBe(5000);
    expect(backoffDelay(1)).toBe(10000);
    expect(backoffDelay(2)).toBe(30000);
    expect(backoffDelay(3)).toBe(60000);
    expect(backoffDelay(10)).toBe(60000);
  });
});

describe('cache', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('저장하고 읽는다', () => {
    cacheSet('k', { a: 1 });
    expect(cacheGet<{ a: number }>('k')).toEqual({ a: 1 });
  });
  it('없는 키는 null', () => {
    expect(cacheGet('none')).toBeNull();
  });
});

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('성공 시 onData와 ok 상태, 간격마다 재호출', async () => {
    const fetchFn = vi.fn().mockResolvedValue('data');
    const onData = vi.fn();
    const onStatus = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData, onStatus });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).toHaveBeenCalledWith('data');
    expect(onStatus).toHaveBeenCalledWith('ok');
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it('실패 시 error 상태 + 백오프 후 재시도, 복구되면 ok', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('ok!');
    const onData = vi.fn();
    const onStatus = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData, onStatus });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).toHaveBeenLastCalledWith('error');
    expect(onData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); // backoffDelay(0)
    expect(onData).toHaveBeenCalledWith('ok!');
    expect(onStatus).toHaveBeenLastCalledWith('ok');
    p.stop();
  });

  it('pause 중에는 호출하지 않고 resume에서 즉시 호출', async () => {
    const fetchFn = vi.fn().mockResolvedValue('d');
    const p = new Poller({ fetchFn, intervalMs: 1000, onData: vi.fn() });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    p.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    p.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    p.stop();
  });
});

// 회귀 테스트: in-flight fetch 도중 생명주기 전환(pause/resume/stop)이 일어나는 경우.
// Task 13에서 document.visibilitychange -> pause()/resume()을 연결하면 흔히 발생하는 상황이다.
describe('Poller 동시성 (in-flight 상태 전환)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetch 진행 중 pause 후 resume해도 체인이 두 개로 분열되지 않는다', async () => {
    let resolveFirst: (v: string) => void;
    const firstPromise = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValue('later');
    const onData = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData });

    p.start(); // tick A: fetchFn 첫 호출, 아직 pending
    expect(fetchFn).toHaveBeenCalledTimes(1);

    p.pause(); // A가 아직 진행 중인 상태에서 일시정지
    p.resume(); // tick B 시작: fetchFn 두 번째 호출

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // A를 이제 해결한다 - 이미 무효화된(stale) tick이므로 onData를 호출하면 안 되고
    // 새로운 타이머를 예약해서도 안 된다.
    resolveFirst!('stale-data');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).not.toHaveBeenCalledWith('stale-data');

    // B(resume 시점의 tick)는 정상적으로 데이터를 방출하고, 정상 간격으로만 재호출되어야 한다.
    // 체인이 분열되었다면 여러 타이머가 동시에 살아남아 fetchFn 호출 수가 예상보다 많아진다.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(4);

    p.stop();
  });

  it('fetch 진행 중 stop하면 이후 resolve되어도 onData/onStatus가 호출되지 않고 타이머도 없다', async () => {
    let resolveFetch: (v: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchFn = vi.fn().mockReturnValue(pending);
    const onData = vi.fn();
    const onStatus = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData, onStatus });

    p.start();
    p.stop(); // fetch가 아직 pending인 상태에서 완전 중단

    resolveFetch!('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(onData).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();

    // 더 이상 어떤 타이머도 발화하지 않아야 한다.
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onData).not.toHaveBeenCalled();
  });

  it('onData가 예외를 던지면 error 상태로 오진하지 않고 정상 간격으로 계속 폴링한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue('ok-data');
    const onData = vi.fn().mockImplementation(() => {
      throw new Error('consumer bug');
    });
    const onStatus = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData, onStatus });

    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStatus).not.toHaveBeenCalledWith('error');

    // backoff(5000ms 등)가 아니라 정상 interval(1000ms)에서 다음 폴링이 일어나야 한다.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(onStatus).not.toHaveBeenCalledWith('error');

    p.stop();
  });

  it('과잉 보정 방지: 생명주기 호출 없이도 여러 간격에 걸쳐 계속 폴링한다', async () => {
    const fetchFn = vi.fn().mockResolvedValue('x');
    const onData = vi.fn();
    const p = new Poller({ fetchFn, intervalMs: 1000, onData });

    p.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(onData).toHaveBeenCalledTimes(4);

    p.stop();
  });
});
