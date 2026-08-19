import * as THREE from 'three';
import { GLOBE_RADIUS, latLonToVector3 } from '../utils/geo';
import { subsolarPoint } from './sun';

const VERT = /* glsl */ `
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform vec3 uSunDir;
uniform float uReveal;   // 0(어두움) -> 1(완전 표시)
uniform bool uHasTexture;
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  if (!uHasTexture) {
    // 텍스처 실패 폴백: 단색 지구
    float d = max(dot(normalize(vWorldNormal), uSunDir), 0.0);
    gl_FragColor = vec4(vec3(0.05, 0.15, 0.3) * (0.3 + d), 1.0);
  } else {
    float cosAngle = dot(normalize(vWorldNormal), uSunDir);
    float blend = smoothstep(-0.15, 0.15, cosAngle); // 부드러운 터미네이터
    vec3 day = texture2D(uDayMap, vUv).rgb;
    vec3 night = texture2D(uNightMap, vUv).rgb * 1.4; // 야경 강조
    vec3 color = mix(night, day, blend);
    // 리빌: 어두운 상태에서 야경이 점등되듯 밝아짐
    gl_FragColor = vec4(color * uReveal, 1.0);
  }
  // ShaderMaterial은 기본 내장 머티리얼과 달리 출력 색공간 변환 에필로그를 자동으로 받지 않으므로
  // (renderer.outputColorSpace가 sRGB인 경우) 여기서 직접 linear -> sRGB 변환을 적용한다.
  // 폴백 경로도 동일하게 이 변환을 거치도록 early return 대신 if/else로 구성했다.
  #include <colorspace_fragment>
}
`;

export class Globe {
  readonly mesh: THREE.Mesh;
  readonly ready: Promise<void>;
  private material: THREE.ShaderMaterial;
  private revealTarget = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uDayMap: { value: null },
        uNightMap: { value: null },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uReveal: { value: 0 },
        uHasTexture: { value: false },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64), this.material);

    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => loader.load(url, resolve, undefined, reject));

    this.ready = Promise.all([
      load('/textures/earth_day.jpg'),
      load('/textures/earth_night.jpg'),
    ])
      .then(([day, night]) => {
        day.colorSpace = THREE.SRGBColorSpace;
        night.colorSpace = THREE.SRGBColorSpace;
        this.material.uniforms.uDayMap.value = day;
        this.material.uniforms.uNightMap.value = night;
        this.material.uniforms.uHasTexture.value = true;
        this.revealTarget = 1;
      })
      .catch(() => {
        // 폴백: 단색 지구라도 보여준다 (검은 화면 금지)
        this.revealTarget = 1;
      });
  }

  update(_time: number): void {
    const { lat, lon } = subsolarPoint(new Date());
    const sunDir = latLonToVector3(lat, lon, 1).normalize();
    this.material.uniforms.uSunDir.value.copy(sunDir);
    // 리빌 이징 (프레임당 5%씩 목표에 접근)
    const u = this.material.uniforms.uReveal;
    u.value += (this.revealTarget - u.value) * 0.05;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.uniforms.uDayMap.value?.dispose();
    this.material.uniforms.uNightMap.value?.dispose();
    this.material.dispose();
  }
}
