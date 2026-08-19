import * as THREE from 'three';

// 지진, ISS, 위성 등 모든 데이터 레이어가 구현하는 공통 인터페이스.
export interface Layer {
  // scene에 필요한 오브젝트를 추가하고 데이터 폴링 등을 시작한다.
  init(scene: THREE.Scene): Promise<void>;
  // 매 프레임(또는 매 틱) 호출되어 애니메이션 등을 갱신한다.
  update(time: number): void;
  // 레이어 표시 여부를 토글한다(토글 패널에서 사용).
  setVisible(visible: boolean): void;
  // 백그라운드 탭 전환 등에서 폴링을 일시정지/재개한다(기본 구현: 내부 Poller pause/resume).
  setActive(active: boolean): void;
  // 리소스 정리.
  dispose(): void;
  getStatus(): 'ok' | 'error' | 'loading';
}

// 여러 Layer를 id로 관리하며 라이프사이클(초기화/갱신/표시/활성화/정리)을 위임한다.
export class LayerManager {
  private layers = new Map<string, Layer>();
  private scene: THREE.Scene;
  // update()에서 이미 한 번 실패를 로그한 레이어 id. rAF는 콜백이 반환된 뒤에야
  // 다음 프레임을 예약하므로, 레이어 하나가 매 프레임 예외를 던지면 여기서 잡지
  // 않는 한 렌더 루프 전체(지구본 포함)가 그대로 멈춘다("데이터가 죽어도 지구는
  // 산다" 원칙). try/catch로 격리하되, 계속 던지는 레이어가 매 프레임 콘솔을
  // 도배하지 않도록 레이어당 최초 1회만 로그한다.
  private failedLayers = new Set<string>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // 레이어를 등록하고 즉시 init을 호출한다.
  // init()은 비동기이지만 add() 자체는 동기 API로 유지한다(호출부가 동기 흐름이다).
  // 그렇다고 반환된 Promise를 완전히 버리면(void), init 내부에서 poller.start()가
  // 캐시된 값을 onData로 동기 방출할 때 던진 예외가 그대로 reject로 전파되어
  // unhandled rejection이 되고, 아무도 관측하지 않아 콘솔/스모크 테스트를 조용히 오염시킨다.
  // 따라서 실패를 소비(catch)하고 명시적으로 로그를 남긴다.
  add(id: string, layer: Layer): void {
    this.layers.set(id, layer);
    layer.init(this.scene).catch((err: unknown) => {
      console.error(`[LayerManager] 레이어 "${id}" 초기화 실패:`, err);
    });
  }

  get(id: string): Layer | undefined {
    return this.layers.get(id);
  }

  setVisible(id: string, visible: boolean): void {
    this.layers.get(id)?.setVisible(visible);
  }

  setActive(active: boolean): void {
    for (const layer of this.layers.values()) layer.setActive(active);
  }

  update(time: number): void {
    for (const [id, layer] of this.layers) {
      try {
        layer.update(time);
      } catch (err) {
        if (!this.failedLayers.has(id)) {
          this.failedLayers.add(id);
          console.error(`[LayerManager] 레이어 "${id}" update 중 오류 발생 (이후 조용히 무시됨):`, err);
        }
      }
    }
  }

  dispose(): void {
    for (const layer of this.layers.values()) layer.dispose();
    this.layers.clear();
  }
}
