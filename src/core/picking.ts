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
  let downAt: { x: number; y: number } | null = null;

  const canvas = app.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    // 드래그(회전)와 클릭 구분: 5px 이상 움직였으면 무시
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, app.camera);
    for (const target of targets) {
      // 레이어 하나(target.object()/onPick)가 던지는 예외가 다른 레이어의 피킹까지
      // 막지 않도록 대상별로 격리한다(layers.ts의 update() 격리와 동일한 원칙).
      try {
        const obj = target.object();
        if (!obj || !obj.visible || !obj.parent?.visible) continue;
        const hits = raycaster.intersectObject(obj, false);
        if (hits.length > 0) {
          target.onPick(hits[0]);
          return;
        }
      } catch (err) {
        console.error('[picking] 대상 처리 중 오류가 발생했습니다 (해당 대상만 건너뜀):', err);
      }
    }
  });
}
