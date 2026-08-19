import { describe, it, expect, vi } from 'vitest';
import { QualityMonitor, QualityController } from '../src/core/quality';

describe('QualityMonitor', () => {
  it('측정 구간 평균 fps가 임계 이상이면 high', () => {
    const q = new QualityMonitor(3000, 30);
    const cb = vi.fn();
    q.onDecide(cb);
    // 60fps 시뮬레이션: 16.67ms 간격 프레임 3초분
    for (let t = 0; t <= 3100; t += 16.67) q.recordFrame(t);
    expect(cb).toHaveBeenCalledWith('high');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('평균 fps가 임계 미만이면 low', () => {
    const q = new QualityMonitor(3000, 30);
    const cb = vi.fn();
    q.onDecide(cb);
    // 20fps 시뮬레이션: 50ms 간격
    for (let t = 0; t <= 3100; t += 50) q.recordFrame(t);
    expect(cb).toHaveBeenCalledWith('low');
  });

  it('측정 종료 후 recordFrame은 무시된다', () => {
    const q = new QualityMonitor(1000, 30);
    const cb = vi.fn();
    q.onDecide(cb);
    for (let t = 0; t <= 1100; t += 16.67) q.recordFrame(t);
    for (let t = 1100; t <= 5000; t += 200) q.recordFrame(t);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // 결함 재현 테스트(라운드 1 지적 사항 반영): 측정 구간(3초) 도중 탭이 백그라운드로
  // 전환되면 SceneApp이 rAF를 멈추고, 복귀 시 다음 프레임의 타임스탬프는 실제 벽시계
  // 경과(여기선 5초)만큼 건너뛴다. 라운드 1에서는 이를 "간격이 250ms를 넘으면 일시정지로
  // 간주"하는 휴리스틱으로 처리했으나, 리뷰에서 그 휴리스틱 자체가 느린 기기를 오판정한다는
  // 지적을 받아, 여기서는 명시적 pause()/resume() 신호로 대체했다. 탭 전환 구간에서는
  // recordFrame을 아예 호출하지 않고(실제 앱에서 rAF가 멈추므로) pause()/resume()만
  // 호출해 시뮬레이션한다.
  it('측정 도중 탭이 백그라운드로 전환(pause/resume)되어도 잘못된 low 판정을 내리지 않는다', () => {
    const q = new QualityMonitor(3000, 30);
    const cb = vi.fn();
    q.onDecide(cb);

    let t = 0;
    // 60fps로 약 1초간 정상 프레임 (렌더 루프 시작 직후 탭 전환 전 상황)
    for (; t <= 1000; t += 16.67) q.recordFrame(t);

    // 탭이 5초간 백그라운드로 전환되었다가 복귀. 실제 앱에서는 rAF가 완전히 멈추므로
    // 이 구간 동안 recordFrame은 전혀 호출되지 않는다 — visibilitychange 핸들러가
    // pause()/resume()만 호출한다.
    q.pause();
    t += 5000;
    q.resume();

    // 복귀 후 다시 60fps로 정상 프레임이 이어져 측정 구간(3초 상당)을 채운다.
    for (let i = 0; i < 500 && cb.mock.calls.length === 0; i++) {
      t += 16.67;
      q.recordFrame(t);
    }

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('high');
    expect(cb).not.toHaveBeenCalledWith('low');
  });

  // 라운드 1 Finding 1(a): 프레임 간격이 항상 임계값(구 250ms)을 넘는 극단적으로 느린
  // 기기(예: 3fps, ~333ms 간격)는 "간격이 크면 일시정지로 간주해 제외"하는 구 휴리스틱
  // 하에서는 모든 프레임이 제외되어 elapsed가 결코 measureMs에 도달하지 못하고 onDecide가
  // 영원히 호출되지 않았다. 명시적 pause()/resume() 신호로 바뀐 지금은 pause()가 호출되지
  // 않는 한 어떤 간격도 버리지 않으므로, 이 기기도 결국 측정을 마치고 'low'로 판정돼야 한다.
  it('프레임 간격이 항상 느린(3fps) 기기도 언젠가 low로 판정된다', () => {
    const q = new QualityMonitor(3000, 30);
    const cb = vi.fn();
    q.onDecide(cb);
    // 3fps 시뮬레이션: ~333.33ms 간격. 탭 전환 없음(pause 호출 없음) — 전부 진짜 느린 프레임.
    for (let t = 0; t <= 12000 && cb.mock.calls.length === 0; t += 333.33) q.recordFrame(t);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('low');
  });

  // 라운드 1 Finding 1(b): 빠른 프레임 9개(20ms 간격) 뒤에 긴 스톨 1개(300ms, GC/레이아웃
  // 등)가 반복되는 "버스티" 패턴. 실제 평균은 (9*20+300)/10 = 48ms/frame ≈ 20.8fps로
  // 임계(30fps) 미만이라 low여야 하는데, 구 250ms 휴리스틱은 300ms 스톨을 매번 제외해
  // 버려서 남은 빠른 프레임만으로 fps를 계산해 'high'로 오판정했다. pause()를 호출하지
  // 않았으므로(실제 탭 전환이 아니라 진짜 스톨이므로) 지금 구현은 모든 프레임을 그대로
  // 반영해 정확히 low로 판정해야 한다.
  it('빠른 프레임 사이에 긴 스톨이 반복되는 버스티 기기는 low로 판정된다(고른 프레임 실제 평균 미만)', () => {
    const q = new QualityMonitor(3000, 30);
    const cb = vi.fn();
    q.onDecide(cb);
    let t = 0;
    outer: for (let cycle = 0; cycle < 200; cycle++) {
      for (let i = 0; i < 9; i++) {
        t += 20;
        q.recordFrame(t);
        if (cb.mock.calls.length > 0) break outer;
      }
      t += 300; // GC/레이아웃 등으로 인한 긴 스톨(실제 프레임 간격 — pause 아님)
      q.recordFrame(t);
      if (cb.mock.calls.length > 0) break;
    }
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('low');
  });

  // 안전장치: pause()가 호출된 뒤 resume()이 오지 않는 상태로(예: visibilitychange 유실)
  // recordFrame만 계속 들어오면, 데이터가 전혀 쌓이지 않아 정상적으로는 영원히 판정되지
  // 않는다. maxWallMs(기본 measureMs*5)를 넘기면 그 시점까지의(비어있는) 데이터로 강제
  // 판정해야 한다 — elapsed===0이므로 fps=0, 보수적으로 'low'가 나온다.
  it('pause 후 resume 신호가 오지 않아도 안전장치(maxWallMs)가 판정을 강제한다', () => {
    const q = new QualityMonitor(3000, 30); // maxWallMs 기본값 = 3000*5 = 15000
    const cb = vi.fn();
    q.onDecide(cb);
    q.recordFrame(0); // wallStartAt=0 확정
    q.pause();
    // resume 없이 recordFrame만 계속 들어온다(실제로는 rAF가 멈췄어야 하지만, 신호가
    // 씹혀 pause 플래그만 남고 무언가가 계속 recordFrame을 호출하는 경로를 흉내낸다).
    for (let t = 100; t <= 20000; t += 100) q.recordFrame(t);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('low');
  });

  // 라운드 2 지적 사항: 안전장치의 벽시계(wallStartAt 기준)가 "정상적으로 재개된 일시정지
  // 구간"까지 그대로 포함시키고 있었다. 60fps 정상 기기가 측정 시작 후 약 500ms 만에
  // (아직 elapsed가 500ms 정도만 쌓인 채로) 지극히 평범한 20초짜리 탭 전환을 했다 돌아오면,
  // 재개 직후 첫 프레임에서 벽시계가 이미 20500ms(>= maxWallMs 15000ms)를 가리켜 안전장치가
  // 즉시 발동해, 가장 느린(로딩 초기) 500ms치 데이터만으로 강제 판정되어 버렸다 — 십중팔구
  // 'low'로, 멀쩡한 기기를 영구히 오판정한다. 라운드 1이 없애려던 것과 정확히 같은 종류의
  // 오류가 안전장치를 통해 재유입된 것이다. 이 테스트는 그 오판정이 다시는 일어나지 않고,
  // 재개 후 남은 측정 구간이 정상적으로 이어져 전체 3초 창을 채운 뒤 올바르게 'high'가
  // 나오는지 검증한다. (라운드 2 구현에 대해 실패해야 함 — pausedAccum 개념이 없어 안전장치가
  // wallStartAt 기준 원시 경과 시간만 본다.)
  it('안전장치의 벽시계는 정상적으로 재개된 일시정지 구간을 제외한다(긴 탭 전환이 조기 강제판정을 유발하지 않음)', () => {
    const q = new QualityMonitor(3000, 30); // maxWallMs 기본값 = 15000
    const cb = vi.fn();
    q.onDecide(cb);

    let t = 0;
    // 측정 시작 직후 약 400ms는 텍스처 로딩/셰이더 컴파일 등으로 느리다(~5fps, 200ms 간격) —
    // 이 구간만 놓고 보면 fps≈5로 'low'가 나올 데이터다. 실제 지적 사항이 말하는 "가장
    // 느린 초기 구간"을 흉내낸 것.
    q.recordFrame(t); // t=0, 첫 프레임(집계 없음)
    t += 200;
    q.recordFrame(t); // elapsed=200, frames=1
    t += 200;
    q.recordFrame(t); // elapsed=400, frames=2 (여기까지 fps = 2/400*1000 = 5)

    // 사용자가 탭을 20초간 전환했다 돌아온다 — maxWallMs(15000ms)보다 훨씬 긴, 지극히
    // 평범한 일시정지. 실제 앱에서는 이 구간 동안 rAF가 멈추므로 recordFrame이 전혀
    // 호출되지 않는다.
    q.pause();
    t += 20000;
    q.resume();

    // 복귀 후에는 정상 60fps로 이어져 측정 구간(3초 상당)을 마저 채운다 — 초기 로딩
    // 구간은 예외적으로 느렸을 뿐, 기기 자체는 빠르다는 것이 이 시나리오의 핵심이다.
    // 안전장치가 일시정지 구간을 벽시계에서 제외하지 못한다면, 복귀 직후 첫 프레임에서
    // 곧바로(20400 >= 15000) 강제 판정되어 앞의 400ms(fps≈5, 'low')만으로 끝났을 것이다.
    // 반대로 전체 3초 창을 온전히 채우면 대부분이 빠른 프레임이라 평균 fps는 임계를
    // 넘어 'high'가 나와야 한다.
    for (let i = 0; i < 500 && cb.mock.calls.length === 0; i++) {
      t += 16.67;
      q.recordFrame(t);
    }

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('high');
  });

  // 반대 방향 가드: pause()가 호출된 뒤 resume()이 (신호 유실 등으로) 결코 오지 않는데도
  // recordFrame만 계속 들어오는 경우, 안전장치는 여전히 발동해야 한다. 위 수정에서 "확정된
  // (resume까지 끝난)" 구간만 제외하도록 한 것은, 이 미확정 구간까지 통째로 제외해버리면
  // 라운드 1의 (a)(영원히 판정되지 않는 결함)가 안전장치를 통해 다시 열리기 때문이다. 이
  // 테스트는 위의 "pause 후 resume 신호가 오지 않아도 안전장치가 판정을 강제한다" 테스트와
  // 본질적으로 같은 시나리오를 재확인하는 것으로, 라운드 2 구현과 이번 수정 양쪽 모두에서
  // 통과해야 정상이다(이번 수정이 미확정 구간까지 실수로 제외해버리는 "안전장치 무력화"
  // 방향으로 새지 않았음을 확인하는 회귀 가드).
  it('resume 신호가 결코 오지 않아도(미확정 일시정지) 안전장치는 무력화되지 않는다', () => {
    const q = new QualityMonitor(3000, 30); // maxWallMs 기본값 = 15000
    const cb = vi.fn();
    q.onDecide(cb);
    q.recordFrame(0); // wallStartAt=0 확정
    q.pause(); // resume()을 영원히 호출하지 않는다
    for (let t = 100; t <= 20000; t += 100) q.recordFrame(t);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('low');
  });
});

describe('QualityController (자동 판정 vs 수동 토글 우선순위)', () => {
  it('사용자가 버튼을 누르지 않았다면 자동 판정이 그대로 적용된다', () => {
    const apply = vi.fn();
    const c = new QualityController(apply);
    c.autoDecide('low');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('low');
    expect(c.getLevel()).toBe('low');
  });

  it('수동 토글 이후 도착한 자동 판정은 무시된다', () => {
    const apply = vi.fn();
    const c = new QualityController(apply);
    c.manualToggle(); // high -> low, 사용자가 명시적으로 저사양 선택
    expect(apply).toHaveBeenLastCalledWith('low');

    c.autoDecide('high'); // 뒤늦게 도착한 자동 판정(예: 'high') — 무시되어야 함
    expect(apply).toHaveBeenCalledTimes(1); // manualToggle 호출분 그대로, 추가 호출 없음
    expect(c.getLevel()).toBe('low'); // 사용자의 선택이 유지된다
  });

  it('수동 토글은 몇 번을 눌러도 자동 판정보다 항상 우선한다', () => {
    const apply = vi.fn();
    const c = new QualityController(apply);
    c.autoDecide('low'); // 자동으로 먼저 저사양 전환
    c.manualToggle(); // 사용자가 수동으로 다시 high로 전환
    expect(c.getLevel()).toBe('high');
    c.autoDecide('low'); // 자동 판정이 다시 와도 무시
    expect(c.getLevel()).toBe('high');
    expect(apply).toHaveBeenLastCalledWith('high');
  });
});
