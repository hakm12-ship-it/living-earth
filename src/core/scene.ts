import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneApp {
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

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
    this.camera.position.set(0, 0, 4.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.3;
    this.controls.maxDistance = 8;
    this.controls.enablePan = false;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
  playIntro(durationMs: number): void {
    this.introActive = true;
    this.introStart = performance.now();
    this.introDuration = durationMs;
    this.introStartRadius = this.camera.position.length() || 4.5;
    this.introDir = this.camera.position.clone().normalize();
    if (this.introDir.lengthSq() === 0) this.introDir.set(0, 0, 1);
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => {
      if (this.introActive) {
        const t = Math.min((performance.now() - this.introStart) / this.introDuration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
        const radius = this.introStartRadius - eased * 2.0;
        // 인트로 동안은 방향(방위각)을 고정한 채 거리만 좁혀 들어간다 (점프컷 방지).
        this.camera.position.copy(this.introDir).multiplyScalar(radius);
        if (t >= 1) this.introActive = false;
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
