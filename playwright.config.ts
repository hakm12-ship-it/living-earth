import { defineConfig } from '@playwright/test';

// 개발 서버 포트: 5173은 이 머신에서 다른 프로세스가 점유 중이라 사용할 수 없다.
// .claude/launch.json에서 프로젝트를 5180에 고정해뒀으므로 여기서도 동일하게 맞춘다.
const PORT = 5180;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // 여러 워커가 동시에 WebGL 캔버스를 렌더링 + 스크린샷하면 이 머신에서 GPU/CPU
  // 경합으로 프레임이 느려져(관찰된 사례: 4~5s짜리 테스트가 20~40s로 늘어짐) 기본
  // 30초 타임아웃을 넘기는 일이 생겼다. 워커를 2개로 제한하고 타임아웃도 여유 있게 둔다.
  // 순차 실행. 캔버스 스크린샷은 GPU 리드백 때문에 한 장에 수 초가 걸리는데,
  // 병렬로 돌리면 서로 경합해 렌더가 밀리고 테스트가 타임아웃으로 실패한다.
  // 스모크는 5개뿐이라 순차로 돌려도 몇 분이면 끝나고, 그 대신 결정적으로 통과한다.
  workers: 1,
  timeout: 120_000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
