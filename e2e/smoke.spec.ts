import { test, expect, type Page } from '@playwright/test';
import { stubApis } from './fixtures';

let consoleErrors: string[];
let pageErrors: string[];

test.beforeEach(async ({ page }: { page: Page }) => {
  consoleErrors = [];
  pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  // console.error만 감시하면 잡히지 않은 예외(unhandled exception)와 미처리 프로미스
  // 거부(unhandled rejection)를 놓친다 — Playwright는 이 둘을 'pageerror'로 별도 발생시킨다.
  // 렌더 루프에서 던진 TypeError나 실패한 fetch 체인이 조용히 통과하는 것을 막기 위해
  // 반드시 함께 감시한다.
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  // 세 데이터 API를 결정적 픽스처로 고정한다 (사유: e2e/fixtures.ts 상단 주석 참고).
  // goto보다 반드시 먼저 걸어야 첫 폴링 요청부터 가로채진다.
  await stubApis(page);
});

function expectNoErrors(): void {
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
}

// 캔버스 영역을 스크린샷 -> 페이지 내부 <img>+2D 캔버스로 재디코드해 RGBA 픽셀
// 배열을 얻는다. 별도 이미지 처리 라이브러리 없이 브라우저 자체 PNG 디코더를
// 재사용하는 방식이다.
async function capturePixels(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<{
  data: number[];
  width: number;
  height: number;
}> {
  const shot = await page.screenshot({ clip: box });
  const base64Png = shot.toString('base64');
  return page.evaluate((dataUrl) => {
    return new Promise<{ data: number[]; width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        resolve({ data: Array.from(data), width: c.width, height: c.height });
      };
      img.onerror = () => reject(new Error('스크린샷 PNG 디코드 실패'));
      img.src = `data:image/png;base64,${dataUrl}`;
    });
  }, base64Png);
}

test('페이지 로드: 캔버스가 렌더되고 콘솔 에러가 없다', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#globe-canvas');
  await expect(canvas).toBeVisible();
  // three가 캔버스에 이미 WebGL2 컨텍스트를 만들어뒀다면, 같은 타입으로 다시
  // getContext를 호출했을 때 스펙상 "기존 컨텍스트"가 반환되어야 한다(신규 생성이
  // 아님) — 즉 null이 아니라는 것은 진짜로 WebGL2 컨텍스트를 획득했다는 뜻이다.
  // (이전 버전은 `|| true` 폴백이 있어 이 검사가 항상 통과하는 눈속임이었다.)
  const hasContext = await page.evaluate(() => {
    const c = document.getElementById('globe-canvas') as HTMLCanvasElement;
    return c.getContext('webgl2') !== null;
  });
  expect(hasContext).toBe(true);
  await page.waitForTimeout(3000); // 텍스처/데이터 로딩 대기
  expectNoErrors();
});

test('레이어 토글 3개가 동작한다', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(2000);
  for (const id of ['earthquakes', 'iss', 'satellites']) {
    const toggle = page.getByTestId(`toggle-${id}`);
    await expect(toggle).toBeVisible();
    await toggle.click(); // 상태 반전
    await toggle.click(); // 원복
  }
  expectNoErrors();
});

test('UTC 시계가 표시된다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#utc-clock')).toContainText('UTC');
});

test('캔버스에 검은 화면이 아닌 실제 렌더링이 나타난다', async ({ page }) => {
  // 셰이더·텍스처·배선이 깨져 캔버스가 새까맣게 나오는 회귀를 잡기 위한 가드.
  await page.goto('/');
  await page.waitForTimeout(4000); // 텍스처 로딩 + 리빌(reveal) 애니메이션 대기

  const canvas = page.locator('#globe-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const { data } = await capturePixels(page, box!);
  let nonBlack = 0;
  const totalPixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 20) nonBlack++;
  }
  const nonBlackFraction = nonBlack / totalPixels;

  // 우주 배경은 정당하게 검은색이고 지구본은 프레임의 일부만 차지하므로 기준을 낮게
  // 잡되(플레이키 방지), 전체가 새까맣게 나오는 회귀는 확실히 잡을 만큼은 높게 잡는다.
  expect(nonBlackFraction).toBeGreaterThan(0.05);
});

// SatelliteLayer가 마커에 쓰는 색(0xffffcc = R255,G255,B204). 지진 마커(HSL 기반
// 노랑~빨강), ISS 마커(0x66ddff, 청록), 별(순백 0xffffff, B=255라 아래 밴드 밖)과
// 겹치지 않는 좁은 밴드다.
//
// 토글 패널의 위성 범례 점도 같은 색을 쓴다(범례 색을 마커 색과 일치시키는 것이
// 패널의 요점이다). 패널은 캔버스 위에 겹쳐 있으므로 그 사각형은 표본에서 제외해야
// 위성이 꺼진 상태의 기준선이 0이 된다.
function countSatelliteColorPixels(
  shot: { data: number[]; width: number; height: number },
  exclude?: { x: number; y: number; width: number; height: number },
): number {
  const { data, width } = shot;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!(r > 235 && g > 235 && b > 180 && b < 235)) continue;
    if (exclude) {
      const px = (i / 4) % width;
      const py = Math.floor(i / 4 / width);
      const inside =
        px >= exclude.x &&
        px < exclude.x + exclude.width &&
        py >= exclude.y &&
        py < exclude.y + exclude.height;
      if (inside) continue;
    }
    count++;
  }
  return count;
}

test('위성 토글을 켜면 위성 마커가 실제로 화면에 나타난다 (배선 회귀 가드)', async ({ page }) => {
  // 체크박스가 뒤집히고 콘솔 에러가 없는 것만으로는 "토글이 실제로는 아무것도 하지
  // 않는" 결함을 잡지 못한다. 그래서 위성 마커가 실제로 그려지는지를 직접 확인한다.
  //
  // 전/후 스크린샷을 픽셀 단위로 diff하는 방식은 쓰지 않는다 — 정지된 장면을 연달아
  // 캡처해도 인코딩/컴포지팅 잡음만으로 수만 픽셀이 달라진 것으로 잡혀, 위성 몇 개가
  // 만드는 수백 픽셀의 신호가 묻힌다. 대신 위성 마커 색(0xffffcc)이 장면의 다른 어떤
  // 것과도 겹치지 않는다는 점을 이용해, 한 장의 스크린샷에서 그 색을 가진 픽셀 수를
  // 센다. 프레임 간 비교가 아니라 절대량 측정이므로 렌더링 잡음에 좌우되지 않는다.
  // (WebGL 캔버스는 preserveDrawingBuffer:false라 toDataURL로는 빈 이미지가 나온다.)
  //
  // 위성이 카메라 반대편에 있을 수 있으므로 몇 개의 방위각에서 시도하고, 하나라도
  // 매칭 픽셀이 나오면 통과시킨다.
  await page.goto('/');
  await page.waitForTimeout(4000);

  const canvas = page.locator('#globe-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const toggle = page.getByTestId('toggle-satellites');

  // 패널의 위성 범례 점이 마커와 같은 색이므로, 패널이 덮는 사각형은 표본에서 뺀다.
  // 스크린샷은 devicePixelRatio만큼 확대돼 있을 수 있어 캔버스 대비 배율로 환산한다.
  const panelBox = (await page.locator('#layer-panel').boundingBox())!;
  const probe = await capturePixels(page, box);
  const scale = probe.width / box.width;
  const excludePanel = {
    x: (panelBox.x - box.x) * scale,
    y: (panelBox.y - box.y) * scale,
    width: panelBox.width * scale,
    height: panelBox.height * scale,
  };

  // 껐을 때는 이 색의 픽셀이 전혀 없어야 한다(오검출 기준선 확인).
  expect(countSatelliteColorPixels(probe, excludePanel)).toBe(0);

  let sawSatellite = false;
  let maxCount = 0;

  for (const dx of [0, 300, 260]) {
    if (dx !== 0) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx, cy, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    await toggle.click(); // 켜기
    await page.waitForTimeout(600); // TLE 빌드/렌더 반영 대기
    const on = await capturePixels(page, box);
    const count = countSatelliteColorPixels(on, excludePanel);
    maxCount = Math.max(maxCount, count);
    await toggle.click(); // 다음 시도를 위해 원복
    await page.waitForTimeout(200);

    if (count > 3) {
      sawSatellite = true;
      break;
    }
  }

  expect(sawSatellite, `모든 카메라 각도에서 위성 색 픽셀이 3개 이하였음 (최대: ${maxCount})`).toBe(true);
  expectNoErrors();
});
