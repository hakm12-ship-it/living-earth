export type QualityLevel = 'high' | 'low';

// 렌더 루프의 프레임 타임스탬프를 관찰해 저사양 기기 여부를 한 번 판정한다.
//
// 탭이 백그라운드로 전환된 구간은 프레임 간격의 크기로 추측하지 않고, 호출자가
// visibilitychange에서 pause()/resume()으로 명시적으로 알려준다. 간격 크기로 추측하면
// 실제로 느린 프레임과 정지된 탭을 구분하지 못해, 극단적으로 느린 기기가 아예 판정을
// 못 받거나(모든 프레임이 제외되어 측정이 끝나지 않음) 긴 스톨이 간간이 섞이는 기기가
// 빠른 프레임만 남아 'high'로 오판정된다. 명시적 신호를 쓰면 아무리 느린 프레임도
// 버리지 않으므로 두 경우 모두 정상 판정된다.
//
// 안전장치: pause()/resume() 신호가 유실되는 경로에 대비해, 활성 상태로 흐른 벽시계
// 시간이 maxWallMs를 넘으면 그때까지 모인 데이터로 강제 판정한다. 데이터가 없으면
// fps 0으로 계산되어 보수적으로 'low'가 된다. 벽시계에서 제외하는 것은 resume()으로
// 정상 종료된 일시정지 구간뿐이다 — 재개 신호가 유실된 채 흐르는 시간까지 빼주면
// "영원히 판정되지 않는" 상태가 다시 열리기 때문이다.
//
// 전제: pause()/resume() 호출이 실제 가시성 변화와 대응해야 한다. 이 클래스는 호출자의
// 배선 오류까지 감지하지는 않으며, 안전장치는 판정이 아예 나오지 않는 경우만 막는다.
export class QualityMonitor {
  private measureMs: number;
  private thresholdFps: number;
  private maxWallMs: number;
  private frames = 0;
  // pause() 구간을 제외하고 누적한 경과 시간(ms). 실제 프레임의 간격은 아무리 커도 그대로 더한다.
  private elapsed = 0;
  private lastAt: number | null = null;
  // 최초 recordFrame 시각(paused 여부와 무관) — 안전장치가 기준으로 삼는 "측정 시작 시각".
  private wallStartAt: number | null = null;
  private paused = false;
  private decided = false;
  private cb: ((level: QualityLevel) => void) | null = null;
  // "확정된"(resume까지 끝난) 일시정지 구간의 누적 길이(ms) — 안전장치 벽시계에서 제외한다.
  private pausedAccum = 0;
  // pause() 호출 시점에 알려져 있던 마지막 now(이 시점엔 실제 now를 받지 못하므로, 다음
  // recordFrame이 자신의 now로 구간 길이를 확정할 때까지 임시로 들고 있는다). resume()이
  // 아직 안 왔다면(=paused===true) 이 값은 "미확정"이므로 안전장치 계산에서 빼지 않는다.
  private pauseMark: number | null = null;
  private lastKnownNow: number | null = null;

  constructor(measureMs: number, thresholdFps: number, maxWallMs = measureMs * 5) {
    this.measureMs = measureMs;
    this.thresholdFps = thresholdFps;
    this.maxWallMs = maxWallMs;
  }

  onDecide(cb: (level: QualityLevel) => void): void {
    this.cb = cb;
  }

  // 탭이 백그라운드로 전환됐음을 명시적으로 알린다. 판정 전이라면 이후 recordFrame은
  // resume()이 호출되기 전까지 집계되지 않는다.
  pause(): void {
    if (this.decided || this.paused) return;
    this.paused = true;
    // 아직 프레임이 하나도 없었다면 null. 이 값은 resume() 후 첫 recordFrame이 실제
    // now를 받을 때 구간 길이를 확정하는 데 쓰인다.
    this.pauseMark = this.lastKnownNow;
    // 재개 후 첫 프레임과의 간격이 "일시정지 구간을 포함한 큰 delta"로 잘못 더해지지
    // 않도록, 다음 recordFrame을 다시 첫 프레임처럼(간격 계산 없이) 처리한다.
    this.lastAt = null;
  }

  // 탭이 다시 보이게 됐음을 알린다. 이후 recordFrame부터 다시 집계를 재개한다. 일시정지
  // 구간의 정확한 길이는 pauseMark와 다음 recordFrame의 now 차이로, 그 recordFrame
  // 안에서 확정한다(resume() 자체는 now를 받지 않으므로 여기서는 계산할 수 없다).
  resume(): void {
    this.paused = false;
  }

  recordFrame(now: number): void {
    if (this.decided) return;
    if (this.wallStartAt === null) this.wallStartAt = now;
    this.lastKnownNow = now;

    if (this.paused) {
      // resume()이 아직 호출되지 않은 "미확정" 일시정지 구간 — 안전장치 벽시계에서
      // 제외하지 않는다(resume 신호 유실 시에도 결국 강제 판정될 수 있도록).
      this.maybeForceDecide(now);
      return;
    }

    if (this.pauseMark !== null) {
      // resume() 직후 맞는 첫 프레임 — 방금 끝난 일시정지 구간의 실제 길이를 확정해
      // 안전장치 벽시계에서 제외할 누적치에 더한다.
      this.pausedAccum += Math.max(0, now - this.pauseMark);
      this.pauseMark = null;
    }

    if (this.lastAt === null) {
      this.lastAt = now;
      this.maybeForceDecide(now);
      return;
    }

    const delta = now - this.lastAt;
    this.lastAt = now;
    if (delta > 0) {
      // 간격이 크더라도(느린 기기일 수 있으므로) 절대 버리지 않는다 — pause()로 명시적으로
      // 알려진 구간만 제외 대상이다.
      this.frames++;
      this.elapsed += delta;
    }

    if (this.elapsed >= this.measureMs) {
      this.finish();
      return;
    }
    this.maybeForceDecide(now);
  }

  private maybeForceDecide(now: number): void {
    if (this.wallStartAt === null) return;
    const activeWall = now - this.wallStartAt - this.pausedAccum;
    if (activeWall >= this.maxWallMs) {
      this.finish();
    }
  }

  private finish(): void {
    this.decided = true;
    const fps = this.elapsed > 0 ? (this.frames / this.elapsed) * 1000 : 0;
    this.cb?.(fps >= this.thresholdFps ? 'high' : 'low');
  }
}

// 자동 판정(QualityMonitor)과 사용자의 수동 토글이 충돌하지 않도록 하는 아주 얇은 상태 기계.
// 사용자가 패널의 "저사양 모드 전환" 버튼을 한 번이라도 누르면 그 순간부터는 사용자의 선택이
// 유일한 진실이 되어, 그 뒤에 도착하는 QualityMonitor의 자동 판정은 무시된다(사용자가 명시적으로
// 고른 프로파일이 백그라운드 휴리스틱에 의해 조용히 되돌려지는 것을 막기 위함). 반대로 사용자가
// 버튼을 한 번도 누르지 않았다면 자동 판정은 지금까지와 동일하게 그대로 적용된다.
export class QualityController {
  private level: QualityLevel = 'high';
  private manualOverride = false;
  private apply: (level: QualityLevel) => void;

  constructor(apply: (level: QualityLevel) => void) {
    this.apply = apply;
  }

  getLevel(): QualityLevel {
    return this.level;
  }

  // QualityMonitor.onDecide에서 호출한다. 사용자가 이미 수동으로 전환했다면 무시.
  autoDecide(level: QualityLevel): void {
    if (this.manualOverride) return;
    this.level = level;
    this.apply(level);
  }

  // 패널의 수동 토글 버튼에서 호출한다. 이후 자동 판정은 더 이상 적용되지 않는다.
  manualToggle(): void {
    this.manualOverride = true;
    this.level = this.level === 'high' ? 'low' : 'high';
    this.apply(this.level);
  }
}
