import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LayerFade } from '../src/layers/fade';

function meshWithOpacity(baseOpacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ opacity: baseOpacity, transparent: true }),
  );
}

describe('LayerFade', () => {
  it('초기 상태를 즉시 반영한다(페이드 없이)', () => {
    const group = new THREE.Group();
    const fade = new LayerFade(group, false);
    expect(group.visible).toBe(false);

    const group2 = new THREE.Group();
    const fade2 = new LayerFade(group2, true);
    expect(group2.visible).toBe(true);
    void fade;
    void fade2;
  });

  it('setVisible(true) 직후 group은 바로 보이되 opacity는 0에서 점진적으로 올라간다', () => {
    const group = new THREE.Group();
    const mesh = meshWithOpacity(1);
    group.add(mesh);
    const mat = mesh.material as THREE.MeshBasicMaterial;

    const fade = new LayerFade(group, false);
    fade.setVisible(true);
    expect(group.visible).toBe(true); // 렌더 대상에는 즉시 포함(그래야 opacity 상승이 보인다)

    fade.tick(0); // lastTime 기준점
    fade.tick(50); // 350ms 페이드 중 50ms 경과 -> 완전 불투명(1)에 도달하지 않음
    expect(mat.opacity).toBeGreaterThan(0);
    expect(mat.opacity).toBeLessThan(1);

    fade.tick(1000); // 충분히 지나면 목표(1)에 수렴
    expect(mat.opacity).toBeCloseTo(1, 5);
  });

  it('setVisible(false)로 페이드아웃하면 opacity가 0에 도달한 뒤에야 group.visible이 꺼진다', () => {
    const group = new THREE.Group();
    const mesh = meshWithOpacity(1);
    group.add(mesh);
    const mat = mesh.material as THREE.MeshBasicMaterial;

    const fade = new LayerFade(group, true);
    fade.tick(0);
    fade.setVisible(false);
    fade.tick(50); // 아직 페이드 진행 중: 완전히 사라지지 않았으니 계속 그려져야 한다
    expect(mat.opacity).toBeGreaterThan(0);
    expect(group.visible).toBe(true);

    fade.tick(1000); // 목표(0)에 도달
    expect(mat.opacity).toBeCloseTo(0, 5);
    expect(group.visible).toBe(false);
  });

  it('머티리얼의 원래 opacity(베이스라인)를 유지한 채 그 비율로 페이드한다', () => {
    const group = new THREE.Group();
    const mesh = meshWithOpacity(0.4); // 예: 궤적선처럼 원래도 반투명한 머티리얼
    group.add(mesh);
    const mat = mesh.material as THREE.MeshBasicMaterial;

    const fade = new LayerFade(group, true);
    fade.tick(0);
    fade.tick(1000); // factor -> 1
    expect(mat.opacity).toBeCloseTo(0.4, 5); // 1.0이 아니라 베이스라인 0.4를 유지
  });
});
