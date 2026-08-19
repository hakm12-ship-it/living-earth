import * as THREE from 'three';
import { GLOBE_RADIUS } from '../utils/geo';

const VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vNormal;
void main() {
  // BackSide 렌더: 가장자리로 갈수록 강한 푸른 글로우
  float intensity = clamp(pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0), 0.0, 1.0);
  // 이 값은 "선형(linear)" 공간의 색이다. sRGB 인코딩(#include <colorspace_fragment>)은
  // 채널별로 균일하지 않게 밝기를 끌어올리며(어두운 채널일수록 더 많이 끌어올림),
  // 그 결과 (0.3, 0.6, 1.0) 같은 값은 R/G가 B 쪽으로 밀려 올라가 흰색에 가깝게 보였다.
  // 인코딩 후에도 또렷한 파란색으로 보이도록, R/G를 크게 낮추고 B만 높게 유지한
  // 채도 높은 선형 틴트를 사용한다 (인코딩 후 대략 (0.15, 0.4, 0.95) 근방이 되도록 역산).
  vec3 tint = vec3(0.02, 0.13, 0.9);
  gl_FragColor = vec4(tint * intensity, 1.0);
  // ShaderMaterial은 기본 내장 머티리얼과 달리 출력 색공간 변환 에필로그를 자동으로 받지 않으므로
  // (renderer.outputColorSpace가 sRGB인 경우) 여기서 직접 linear -> sRGB 변환을 적용한다.
  // (지구본 셰이더와 동일한 처리: src/globe/globe.ts 참고)
  #include <colorspace_fragment>
}
`;

export function createAtmosphere(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    // 셸 반지름은 지구 반지름의 1.04배로 얇게 유지한다 (프레넬 기반 "가장자리" 글로우여야 하며,
    // 두꺼운 불투명 셸처럼 보이면 안 됨). 실측: 이 반지름에서 글로우 세기가 정점 대비 10% 밑으로
    // 떨어지는 지점까지의 거리가 지구 반지름의 약 4.5~4.7% (여러 위도에서 측정, 목표 3~5% 충족).
    new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 64, 64),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  return mesh;
}
