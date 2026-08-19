import * as THREE from 'three';
import './style.css';
import { SceneApp } from './core/scene';
import { Globe } from './globe/globe';
import { createAtmosphere } from './globe/atmosphere';
import { LayerManager } from './layers/layer';
import { EarthquakeLayer } from './layers/earthquakes';
import { IssLayer } from './layers/iss';
import { SatelliteLayer } from './layers/satellites';
import { InfoCard } from './ui/infocard';
import { LayerPanel } from './ui/panel';
import { startClock } from './ui/clock';
import { setupPicking } from './core/picking';
import { QualityMonitor, QualityController } from './core/quality';

const canvas = document.getElementById('globe-canvas') as HTMLCanvasElement;
const app = new SceneApp(canvas);

// 별 배경: Points 2000개를 구 껍질(shell) 위에 균일 분포시킨다.
// 카메라 maxDistance(8)보다 충분히 먼 반지름(30) ~ far plane(100) 이내로 두어,
// 별이 지구본(반지름 1)보다 카메라에 가까워지는 일이 없도록 한다.
// 각 성분을 독립적으로 샘플링하는 큐브 분포는 원점 근처에도 점을 만들어 별이
// 지구본 앞에 찍히므로, 구면 위 균일 분포(z를 [-1,1]에서 균일 샘플 후 acos으로
// 보정)를 쓴다.
const STAR_COUNT = 2000;
const STAR_RADIUS = 30;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const z = Math.random() * 2 - 1; // [-1, 1] 균일
  const theta = Math.acos(z); // 극쪽 쏠림 보정
  const phi = Math.random() * Math.PI * 2;
  const sinTheta = Math.sin(theta);
  starPos[i * 3] = STAR_RADIUS * sinTheta * Math.cos(phi);
  starPos[i * 3 + 1] = STAR_RADIUS * sinTheta * Math.sin(phi);
  starPos[i * 3 + 2] = STAR_RADIUS * z;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 }));
app.scene.add(stars);

// 지구본: 낮/밤 셰이더 + 로딩 리빌
const globe = new Globe();
app.scene.add(globe.mesh);
app.onFrame((time) => globe.update(time));

// 대기 글로우 (프레넬 셰이더)
app.scene.add(createAtmosphere());

// 클릭 피킹 + 정보 카드 + 레이어 토글 패널이 매달릴 UI 루트
const uiRoot = document.getElementById('ui-root')!;
// 카드를 닫으면(X 클릭) 선택에 종속된 위성 궤도선도 함께 정리한다(궤도선이 카드가
// 닫힌 뒤에도 화면에 남아있던 결함의 수정). satelliteLayer는 아래에서 생성되지만
// 클로저로 캡처하므로 선언 순서 문제는 없다(호출은 항상 생성 이후에만 일어남).
const infoCard = new InfoCard(uiRoot, () => satelliteLayer.hideOrbit());

// 패널을 레이어보다 먼저 만든다 — 각 레이어 생성자가 넘겨받는 상태 콜백이
// panel.setStatus를 호출하기 때문에, 레이어를 만들기 전에 panel 인스턴스가 있어야 한다.
const layers = new LayerManager(app.scene);
const panel = new LayerPanel(uiRoot, [
  {
    id: 'earthquakes',
    label: '지진',
    color: '#ff6a3d',
    defaultOn: true,
    onToggle: (on) => layers.setVisible('earthquakes', on),
  },
  { id: 'iss', label: 'ISS', color: '#66ddff', defaultOn: true, onToggle: (on) => layers.setVisible('iss', on) },
  {
    id: 'satellites',
    label: '위성',
    color: '#ffffcc',
    defaultOn: false,
    allowToggleOnError: true, // 토글을 다시 켜면 SatelliteLayer가 세션 내 재시도를 한다
    onToggle: (on) => layers.setVisible('satellites', on),
  },
]);

// 데이터 레이어(지진 등) 관리 — 상태 콜백을 패널에 연결
const earthquakeLayer = new EarthquakeLayer((s) => panel.setStatus('earthquakes', s));
layers.add('earthquakes', earthquakeLayer);
const issLayer = new IssLayer((s) => panel.setStatus('iss', s));
layers.add('iss', issLayer);
const satelliteLayer = new SatelliteLayer((s) => panel.setStatus('satellites', s));
layers.add('satellites', satelliteLayer);
app.onFrame((time) => layers.update(time));

// 세 레이어가 모두 등록된 뒤에야 패널의 defaultOn을 반영한다 — 그 전에 호출하면
// layers.setVisible이 아직 등록되지 않은 id를 조회해 조용히 무동작한다.
panel.applyInitial();

// 저사양 프로파일: 픽셀 비율과 위성 표시 개수를 낮춰 프레임 비용을 줄인다.
// 텍스처 재로딩 비용이 큰 해상도 다운스케일 대신 픽셀 비율 1 + 위성 50개로 갈음한다
// (스펙의 성능 목표(30fps+) 달성 수단으로 충분하며, 부족하면 후속으로 추가한다).
function applyQuality(level: 'high' | 'low'): void {
  if (level === 'low') {
    app.renderer.setPixelRatio(1);
    satelliteLayer.setMaxCount(50);
  } else {
    app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    satelliteLayer.setMaxCount(150);
  }
}

// QualityController: 자동 판정(QualityMonitor)과 패널의 수동 토글이 같은 프로파일을
// 두고 경쟁하지 않도록 중재한다. 사용자가 버튼을 누른 적이 없으면 자동 판정을 그대로
// 적용하고, 한 번이라도 눌렀다면 그 뒤로는 자동 판정을 무시해 사용자의 선택을 지킨다
// (자세한 내용은 core/quality.ts의 QualityController 주석 참고).
const qualityController = new QualityController(applyQuality);

// 렌더 루프 시작 후 3초간 실제 fps를 측정해 임계(30fps) 미만이면 자동으로 저사양 프로파일로
// 전환한다. QualityMonitor는 탭 전환을 visibilitychange가 호출하는 pause()/resume()
// 신호로만 인식하므로, 측정 도중 탭을 옮겼다 돌아와도 정상 기기가 저사양으로 오판정되지
// 않는다. 반면 진짜 느린 프레임(GC/레이아웃 스톨 포함)은 그대로 반영되어 저사양 판정에
// 기여한다.
const quality = new QualityMonitor(3000, 30);
quality.onDecide((level) => qualityController.autoDecide(level));
app.onFrame((time) => quality.recordFrame(time));

// 수동 저사양 토글: 사용자가 누르면 그 순간부터 자동 판정보다 우선한다(QualityController).
panel.addAction('저사양 모드 전환', () => qualityController.manualToggle());

// 백그라운드 탭: 렌더 루프와 데이터 폴링을 일시정지하고, 복귀 시 재개한다.
// QualityMonitor에도 동일한 신호를 명시적으로 전달해(pause/resume) 측정 구간과 탭 전환이
// 겹칠 때 프레임 간격을 추측하지 않고 정확히 배제/재개할 수 있게 한다.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    app.stop();
    layers.setActive(false);
    quality.pause();
  } else {
    app.start();
    layers.setActive(true);
    quality.resume();
  }
});

startClock(uiRoot);

app.start();

// 로딩 완료 후 인트로 카메라 연출 시작
globe.ready.then(() => app.playIntro(2500));

setupPicking(app, [
  {
    object: () => earthquakeLayer.markers,
    onPick: (hit) => {
      const q = hit.instanceId !== undefined ? earthquakeLayer.getQuakeAt(hit.instanceId) : undefined;
      if (!q) return;
      satelliteLayer.hideOrbit(); // 다른 대상을 고르면 이전 위성 궤도선은 정리한다
      infoCard.show(`규모 ${q.mag.toFixed(1)} 지진`, [
        ['위치', q.place || `${q.lat.toFixed(2)}, ${q.lon.toFixed(2)}`],
        ['발생', new Date(q.time).toLocaleString('ko-KR')],
        ['좌표', `${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°`],
      ]);
    },
  },
  {
    object: () => issLayer.marker,
    onPick: () => {
      const s = issLayer.getState();
      if (!s) return;
      satelliteLayer.hideOrbit(); // 다른 대상을 고르면 이전 위성 궤도선은 정리한다
      infoCard.show('국제우주정거장 (ISS)', [
        ['고도', `${s.altKm.toFixed(1)} km`],
        ['속도', `${Math.round(s.velocityKmh).toLocaleString()} km/h`],
        ['좌표', `${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°`],
      ]);
    },
  },
  {
    object: () => satelliteLayer.mesh,
    onPick: (hit) => {
      if (hit.instanceId === undefined) return;
      const name = satelliteLayer.getSatName(hit.instanceId);
      if (!name) return;
      satelliteLayer.showOrbit(hit.instanceId);
      infoCard.show(name, [['데이터', 'CelesTrak TLE (SGP4 궤도 전파)']]);
    },
  },
]);
