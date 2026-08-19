import * as THREE from 'three';
import type { SceneApp } from './scene';

export type PickTarget = {
  object: () => THREE.Object3D | null; // 매 클릭 시점에 조회 (rebuild 대응)
  onPick: (intersection: THREE.Intersection) => void;
};

export function setupPicking(app: SceneApp, targets: PickTarget[]): void {
  const raycaster = new THREE.Raycaster();
  // THREE.Points는 화면상 점 크기와 무관하게 이 임계값(월드 단위) 안에 들어와야
  // 교차로 잡힌다. 기본값 1은 지구본(반지름 1) 기준으로 너무 커서 아무 데나 맞고,
  // 0이면 절대 맞지 않는다. 지진 마커 간격을 고려해 작게 잡는다.
  raycaster.params.Points.threshold = 0.015;
  const pointer = new THREE.Vector2();
  // 누른 뒤 이만큼 넘게 움직였으면 클릭이 아니라 회전 조작으로 본다.
  // 손가락은 마우스보다 훨씬 많이 흔들린다 — 마우스 기준(5px)을 그대로 쓰면
  // 실기기에서 탭이 자주 무시된다. 회전 스와이프는 보통 수십~수백 px이라
  // 터치 기준을 넉넉히 잡아도 둘은 충분히 구분된다.
  const DRAG_SLOP_PX = { mouse: 5, touch: 14, pen: 8 } as const;
  let downAt: { x: number; y: number; slop: number } | null = null;
  let pending: { target: PickTarget; intersection: THREE.Intersection } | null = null;

  // 화면 좌표에서 광선을 쏴 가장 먼저 맞는 대상을 돌려준다.
  // 대상 하나가 던지는 예외가 나머지 대상의 판정까지 막지 않도록 개별로 격리한다.
  function pickAt(clientX: number, clientY: number) {
    pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, app.camera);
    for (const target of targets) {
      try {
        const obj = target.object();
        if (!obj || !obj.visible || !obj.parent?.visible) continue;
        const hits = raycaster.intersectObject(obj, false);
        if (hits.length > 0) return { target, intersection: hits[0] };
      } catch (err) {
        console.error('[picking] 대상 처리 중 오류가 발생했습니다 (해당 대상만 건너뜀):', err);
      }
    }
    return null;
  }

  const canvas = app.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    const slop =
      e.pointerType === 'touch'
        ? DRAG_SLOP_PX.touch
        : e.pointerType === 'pen'
          ? DRAG_SLOP_PX.pen
          : DRAG_SLOP_PX.mouse;
    downAt = { x: e.clientX, y: e.clientY, slop };

    // 무엇을 눌렀는지는 **누르는 순간** 판정해 기억해 둔다.
    // 손가락이 조금이라도 움직이면 OrbitControls가 지구를 회전시키므로, 손을 뗄 때
    // 다시 광선을 쏘면 조준했던 지점 아래에 그 마커가 더 이상 없다. 실기기에서
    // 탭이 자주 빗나가던 원인이 이것이다.
    pending = pickAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    const hit = pending;
    pending = null;
    // 드래그(회전)와 탭 구분: 입력 종류별 허용치보다 많이 움직였으면 회전으로 본다.
    if (!downAt || !hit) return;
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > downAt.slop) return;
    try {
      hit.target.onPick(hit.intersection);
    } catch (err) {
      console.error('[picking] 대상 처리 중 오류가 발생했습니다:', err);
    }
  });
}
