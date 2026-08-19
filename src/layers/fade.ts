import * as THREE from 'three';

// 레이어 토글 시 즉시 visible을 뒤집는 대신 짧게 페이드인/아웃한다(스펙 §3).
// 지진 펄스 링(ShaderMaterial), 위성 궤도선/ISS 궤적(Line), InstancedMesh 마커 등
// 레이어마다 머티리얼 종류가 제각각이라, 이 헬퍼는 group 트리를 매 틱마다 순회하며
// 만나는 모든 머티리얼에 공통으로 적용한다 — 레이어가 데이터 갱신으로 메시를
// 재생성(rebuild)해도(지진/USGS 폴링 등) 다음 틱에 새 머티리얼을 자동으로 잡아낸다.
const FADE_MS = 350;

type FadableMaterial = THREE.Material & { opacity: number; transparent: boolean };

function isFadable(m: THREE.Material): m is FadableMaterial {
  return 'opacity' in m;
}

// 각 머티리얼의 "원래" opacity(예: 궤적선의 0.4/0.5 반투명)를 최초 1회 캐싱해두고,
// 그 값에 페이드 진행률(factor)을 곱한다. userData에 저장하므로 머티리얼이 새로
// 생성되면(rebuild) 자동으로 다시 캐싱된다.
function applyFactor(root: THREE.Object3D, factor: number): void {
  root.traverse((obj) => {
    const withMaterial = obj as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    const mat = withMaterial.material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (!isFadable(m)) continue;
      if (m.userData.__baseOpacity === undefined) m.userData.__baseOpacity = m.opacity;
      m.transparent = true;
      m.opacity = (m.userData.__baseOpacity as number) * factor;
      // ShaderMaterial(펄스 링 등)은 gl_FragColor의 알파를 셰이더 코드가 직접 계산하므로
      // material.opacity가 자동 적용되지 않는다 — uFade 유니폼이 있으면 함께 갱신한다.
      const shaderMat = m as THREE.ShaderMaterial;
      if (shaderMat.uniforms?.uFade) shaderMat.uniforms.uFade.value = factor;
    }
  });
}

// 레이어의 group 하나에 대한 페이드 상태를 추적한다. 레이어의 update(time)에서
// 매 프레임 tick(time)을 호출해야 진행된다.
export class LayerFade {
  private readonly group: THREE.Object3D;
  private factor: number;
  private target: number;
  private lastTime: number | null = null;

  constructor(group: THREE.Object3D, initiallyVisible: boolean) {
    this.group = group;
    this.factor = initiallyVisible ? 1 : 0;
    this.target = this.factor;
    this.group.visible = initiallyVisible;
  }

  // 사용자가 토글한 목표 표시 상태를 설정한다. 즉시 뒤집지 않고 tick()에서
  // 점진적으로 접근한다. visible=true인 경우 지금 당장 렌더 대상에 포함되어야
  // opacity 상승이 눈에 보이므로 group.visible을 바로 켠다(끌 때는 opacity가
  // 0에 도달한 뒤 tick()이 끈다).
  setVisible(visible: boolean): void {
    this.target = visible ? 1 : 0;
    if (visible) this.group.visible = true;
  }

  tick(time: number): void {
    if (this.lastTime === null) this.lastTime = time;
    const dt = Math.max(0, time - this.lastTime);
    this.lastTime = time;

    if (this.factor !== this.target) {
      const step = dt / FADE_MS;
      this.factor =
        this.factor < this.target
          ? Math.min(this.target, this.factor + step)
          : Math.max(this.target, this.factor - step);
    }

    applyFactor(this.group, this.factor);

    if (this.factor === 0 && this.target === 0) this.group.visible = false;
  }
}
