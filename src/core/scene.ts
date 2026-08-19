import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneApp {
  /** 대기 글로우 셸까지 포함한 지구본의 시각적 반지름. */
  private static readonly VISUAL_RADIUS = 1.05;
  /** 제한 축을 이만큼 넘겨 채운다(1이면 딱 맞고, 크면 가장자리가 살짝 잘린다). */
  private static readonly FILL = 1.1;

  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private frameCallbacks: Array<(time: number) => void> = [];
  private introActive = false;
  private introStart = 0;
  private introDuration = 0;
  private introDir = new THREE.Vector3(0, 0, 1);
  private introStartRadius = 4.5;
  private introTargetRadius = 2.5;
  private flyActive = false;
  private flyStart = 0;
  private flyDuration = 0;
  private flyFrom = new THREE.Vector3();
  private flyTo_ = new THREE.Vector3();
  private flyRadius = 2.5;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
    // 인트로는 화면에 꽉 차는 거리보다 멀리서 시작한다.
    this.camera.position.set(0, 0, this.fitDistance() * 1.8);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 8;
    this.controls.enablePan = false;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // 세로로 회전하는 등 비율이 좁아지면 같은 거리에서도 지구가 화면 밖으로 넘친다.
      // 넘치는 경우에만 뒤로 물린다(사용자가 의도적으로 당겨둔 줌은 건드리지 않는다).
      const need = this.fitDistance();
      if (this.camera.position.length() < need) this.camera.position.setLength(need);
      this.controls.maxDistance = Math.max(8, need * 1.5);
    });

    // 자동 자전: 조작이 없을 때 천천히 회전, 조작 시작 시 즉시 중단(인트로도 스킵),
    // 조작 종료 5초 뒤 재개
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.introActive = false; // 인트로 스킵
      clearTimeout(idleTimer);
    });
    this.controls.addEventListener('end', () => {
      idleTimer = setTimeout(() => (this.controls.autoRotate = true), 5000);
    });
  }

  onFrame(cb: (time: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  /**
   * 인트로 카메라 연출: durationMs 동안 카메라 거리를 (현재 반지름) -> (현재 반지름 - 2.0)으로 이징.
   * (기본 시작 반지름 4.5 기준 4.5 -> 2.5)
   * 사용자 입력 시 즉시 스킵.
   *
   * 주의: 텍스처 로딩 중에도 생성자에서 자동 자전이 즉시 시작되므로, 로딩이 끝나고 이 메서드가
   * 호출되는 시점에는 카메라가 이미 자동 자전으로 회전해 있을 수 있다. 여기서 카메라 위치를
   * (0,0,4.5)로 초기화해버리면 그 회전이 순간적으로 사라지는 점프컷이 발생하므로, 위치를
   * 리셋하지 않고 "현재 방향(방위각)"만 저장해 반지름만 애니메이션한다.
   */
  /**
   * 지구본이 화면에 알맞게 담기는 카메라 거리.
   *
   * 세로 화면에서는 가로 시야각이 세로보다 좁아지므로, 고정 거리를 쓰면 지구가 화면
   * 밖으로 넘쳐 바다만 보인다. 제한이 되는 쪽 시야각을 기준으로 거리를 계산한다.
   * FILL이 1보다 큰 것은 제한 축을 살짝 넘겨 화면을 가득 채우는 구도를 위한 것이다.
   */
  fitDistance(): number {
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const limitHalf = Math.min(vHalf, hHalf);
    const angle = Math.min(limitHalf * SceneApp.FILL, Math.PI / 2 - 1e-3);
    return SceneApp.VISUAL_RADIUS / Math.sin(angle);
  }

  /**
   * 카메라를 지정한 방향으로 부드럽게 돌린다(거리는 유지).
   *
   * 인트로와 마찬가지로 위치를 즉시 옮기지 않고 현재 지점에서 보간한다.
   * 자동 자전은 멈춘다 — 사용자가 특정 지점을 보려고 요청한 상황이므로
   * 도착하자마자 회전해 흘러가면 의도와 어긋난다.
   */
  flyTo(direction: THREE.Vector3, durationMs = 1200): void {
    this.introActive = false; // 인트로 중이면 양보한다
    this.controls.autoRotate = false;
    this.flyActive = true;
    this.flyStart = performance.now();
    this.flyDuration = durationMs;
    this.flyRadius = this.camera.position.length() || this.fitDistance();
    this.flyFrom.copy(this.camera.position).normalize();
    this.flyTo_.copy(direction).normalize();
  }

  playIntro(durationMs: number): void {
    this.introActive = true;
    this.introStart = performance.now();
    this.introDuration = durationMs;
    this.introStartRadius = this.camera.position.length() || this.fitDistance() * 1.8;
    this.introTargetRadius = this.fitDistance();
    this.introDir = this.camera.position.clone().normalize();
    if (this.introDir.lengthSq() === 0) this.introDir.set(0, 0, 1);
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => {
      if (this.introActive) {
        const t = Math.min((performance.now() - this.introStart) / this.introDuration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const radius = this.introStartRadius + (this.introTargetRadius - this.introStartRadius) * eased;
        // 인트로 동안은 방향(방위각)을 고정한 채 거리만 좁혀 들어간다 (점프컷 방지).
        this.camera.position.copy(this.introDir).multiplyScalar(radius);
        if (t >= 1) this.introActive = false;
      }
      if (this.flyActive) {
        const t = Math.min((performance.now() - this.flyStart) / this.flyDuration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        // 두 방향 사이를 구면 보간해 지구 표면을 따라 도는 궤적으로 이동한다.
        const dir = this.flyFrom.clone().lerp(this.flyTo_, eased).normalize();
        this.camera.position.copy(dir).multiplyScalar(this.flyRadius);
        if (t >= 1) this.flyActive = false;
      }
      this.controls.update();
      for (const cb of this.frameCallbacks) cb(time);
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }
}
