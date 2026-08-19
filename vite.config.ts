import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  // satellite.js 7.x는 WASM SGP4 구현을 위해 워커 파일(top-level await 포함)을 번들에
  // 포함한다. Vite 워커 기본 출력 포맷인 'iife'는 top-level await를 지원하지 않아
  // 프로덕션 빌드가 실패한다("Top-level await is currently not supported with the
  // 'iife' output format"). 워커 포맷을 'es'로 바꾸면 이 문제가 해결된다
  // (대상 브라우저는 모듈 워커를 지원하는 최신 환경으로 가정 — 이 프로젝트가 이미
  // 요구하는 WebGL2 지원 범위와 부합한다).
  worker: { format: 'es' },
  test: {
    // e2e/*.spec.ts는 Playwright 테스트라 vitest 기본 include 패턴(**/*.spec.ts)과
    // 겹친다. vitest가 이를 자기 테스트로 잘못 집어삼켜 "test.beforeEach() 호출 위치가
    // 잘못됨" 에러를 내므로 명시적으로 제외한다.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
