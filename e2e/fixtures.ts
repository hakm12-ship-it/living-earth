// 스모크 테스트용 고정 픽스처.
//
// 실 API(USGS, wheretheiss.at, CelesTrak)를 라우트 가로채기로 대체한다. 세 서비스를
// 실제로 호출하면 테스트가 그날그날의 외부 가용성(레이트리밋, 순단, 스키마 변경)에
// 좌우되는 flaky 테스트가 되고, 요청이 실패하면 브라우저가 콘솔에 에러를 남겨 "콘솔
// 에러 0개" 단언과 정면으로 충돌한다(실제로 이 세션에서 CelesTrak이 요청량 때문에
// 403을 반환하는 상태를 이미 겪었다). 그래서 여기서는 세 엔드포인트를 결정적인 샘플로
// 고정한다.
//
// 트레이드오프: 이 스텁은 실 스키마와의 어긋남(필드 이름 변경 등)을 잡아내지 못한다.
// 다만 그 책임은 tests/usgs.test.ts, tests/iss.test.ts, tests/tle.test.ts가 실 스키마
// 샘플로 이미 지고 있으므로, 여기서는 "파서가 데이터를 올바르게 파싱하는지"가 아니라
// "레이어가 파싱된 데이터를 받아 화면에 배선되는지"만 확인하면 충분하다.
import type { Page } from '@playwright/test';

export const USGS_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      // 의도적으로 M5 미만으로 둔다: M5+는 EarthquakeLayer가 uTime 기반 펄스 링을
      // 매 프레임 애니메이션하는데, 그러면 e2e/smoke.spec.ts의 프레임 diff 테스트가
      // 위성 토글과 무관하게도 항상 픽셀이 바뀌어 오탐(false positive)을 낼 수 있다.
      type: 'Feature',
      properties: { mag: 4.6, time: 1755600000000, place: '10km ESE of Test City' },
      geometry: { type: 'Point', coordinates: [139.5, 35.6, 10] },
    },
    {
      type: 'Feature',
      properties: { mag: 3.1, time: 1755600100000, place: '5km N of Sample Town' },
      geometry: { type: 'Point', coordinates: [-118.2, 34.0, 5] },
    },
  ],
};

export const ISS_FIXTURE = {
  name: 'iss',
  id: 25544,
  latitude: 12.34,
  longitude: 56.78,
  altitude: 420.5,
  velocity: 27580.3,
  visibility: 'daylight',
  footprint: 4500,
  timestamp: 1755600000,
  daynum: 2461000.5,
  solar_lat: 12.1,
  solar_lon: 45.6,
  units: 'kilometers',
};

// ISS(ZARYA) 공개 TLE와 동일한 형식(3줄 블록 x 2)의 샘플. 값 자체는 임의이며 파서가
// 요구하는 형식("1 "/"2 " 접두사)만 맞추면 된다.
export const TLE_FIXTURE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9994
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49560190 12345
CSS (TIANHE)
1 48274U 21035A   24001.50000000  .00006717  00000-0  10270-3 0  9995
2 48274  41.4700 100.1234 0001234  90.1234 270.1234 15.60000000 12346
`;

// 반드시 page.goto() 이전에 호출해야 첫 요청부터 가로채진다.
export async function stubApis(page: Page): Promise<void> {
  await page.route('**/earthquake.usgs.gov/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USGS_FIXTURE) }),
  );
  await page.route('**/api.wheretheiss.at/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ISS_FIXTURE) }),
  );
  await page.route('**/celestrak.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: TLE_FIXTURE }),
  );
}
