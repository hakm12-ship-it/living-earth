// 폴링 백오프 지연 테이블: 5초 -> 10초 -> 30초 -> 60초(상한)
const BACKOFF_MS = [5000, 10000, 30000, 60000];

// 연속 실패 횟수(failCount)에 따른 재시도 지연(ms)을 반환한다. 상한을 넘으면 60초 고정.
export function backoffDelay(failCount: number): number {
  return BACKOFF_MS[Math.min(failCount, BACKOFF_MS.length - 1)];
}

// localStorage에 값을 JSON으로 직렬화해 저장한다. 저장 불가 환경(용량 초과, 미지원 등)은 조용히 무시.
export function cacheSet(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

// localStorage에서 값을 읽어 JSON 파싱한다. 키가 없거나 파싱 실패, 미지원 환경이면 null.
export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

type PollerOptions<T> = {
  fetchFn: () => Promise<T>;
  intervalMs: number;
  cacheKey?: string; // 지정 시 성공 데이터를 캐싱하고 start() 직후 캐시를 즉시 방출
  onData: (data: T) => void;
  onStatus?: (s: 'ok' | 'error') => void;
};

// 주기적으로 fetchFn을 호출하며, 실패 시 backoffDelay로 재시도 간격을 늘리는 폴러.
// 지진 레이어는 cacheKey를 지정해 사용하고, ISS는 cacheKey 없이 5초 간격으로 사용한다.
export class Poller<T> {
  private opts: PollerOptions<T>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failCount = 0;
  private running = false;
  private paused = false;
  // 생명주기 전환(start/stop/pause/resume)마다 증가하는 세대(epoch) 카운터.
  // in-flight fetch가 끝난 시점에 세대가 바뀌어 있으면 그 tick은 폐기(stale)된 것으로 본다.
  // 이렇게 해야 pause 중 resolve된 fetch가 새 tick 체인과 뒤섞이거나 stop 이후에도
  // onData/onStatus를 발화시키는 경쟁 상태를 막을 수 있다.
  private epoch = 0;

  constructor(opts: PollerOptions<T>) {
    this.opts = opts;
  }

  // 폴링을 시작한다. cacheKey가 있으면 캐시된 값을 즉시 onData로 방출한 뒤 첫 fetch를 수행한다.
  start(): void {
    if (this.running) return;
    this.running = true;
    this.epoch++;
    if (this.opts.cacheKey) {
      const cached = cacheGet<T>(this.opts.cacheKey);
      if (cached !== null) this.opts.onData(cached);
    }
    void this.tick(this.epoch);
  }

  // 폴링을 완전히 중단하고 예약된 타이머를 취소한다. in-flight fetch가 있다면 세대가
  // 바뀌므로 나중에 resolve되어도 무시된다.
  stop(): void {
    this.running = false;
    this.epoch++;
    clearTimeout(this.timer);
  }

  // 일시 정지: 타이머를 취소하고 세대를 올려 in-flight fetch를 무효화한다. running 상태는 유지한다.
  pause(): void {
    this.paused = true;
    this.epoch++;
    clearTimeout(this.timer);
  }

  // 일시 정지 해제 후 즉시 한 번 fetch를 수행한다. 새 세대를 시작해 이전에 남아있던
  // in-flight fetch(있다면)와 구분한다.
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.epoch++;
    void this.tick(this.epoch);
  }

  // fetch 한 번을 수행하고, 성공/실패에 따라 다음 지연을 계산해 재예약한다.
  // myEpoch은 이 tick이 시작될 때의 세대 번호로, await 이후 this.epoch과 비교해
  // 그 사이 stop/pause/start/resume이 호출되었는지(=이 tick이 stale한지) 판단한다.
  private async tick(myEpoch: number): Promise<void> {
    if (!this.running || this.paused || myEpoch !== this.epoch) return;

    let data: T;
    try {
      data = await this.opts.fetchFn();
    } catch {
      // fetch 자체의 실패만 backoff 대상으로 삼는다 (Finding 3: 콜백 예외와 분리).
      if (myEpoch !== this.epoch) return; // 대기 중 상태가 바뀐 stale tick은 폐기
      this.opts.onStatus?.('error');
      const delay = backoffDelay(this.failCount);
      this.failCount++;
      if (this.running && !this.paused) {
        this.timer = setTimeout(() => void this.tick(this.epoch), delay);
      }
      return;
    }

    if (myEpoch !== this.epoch) return; // fetch 대기 중 stop/pause/재시작됨: 결과를 버린다

    this.failCount = 0;
    if (this.opts.cacheKey) cacheSet(this.opts.cacheKey, data);

    // 다음 폴링을 onData 호출보다 먼저 예약한다: 소비자 콜백이 예외를 던지더라도
    // 정상 간격 폴링이 끊기지 않도록 하기 위함이다.
    if (this.running && !this.paused) {
      this.timer = setTimeout(() => void this.tick(this.epoch), this.opts.intervalMs);
    }

    try {
      this.opts.onData(data);
    } catch (err) {
      // 소비자 콜백(onData)의 버그를 네트워크 실패로 오진하지 않는다: error 상태나
      // backoff로 잘못 전이시키지 않되, 조용히 삼키지도 않고 콘솔에 남겨 드러낸다.
      console.error('[Poller] onData 콜백에서 예외가 발생했습니다:', err);
      return;
    }
    this.opts.onStatus?.('ok');
  }
}
