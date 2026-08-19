// 상단 중앙 UTC 시계: 낮/밤 경계(Globe 셰이더)가 실시간 UTC 기준임을 알려준다.
export function startClock(root: HTMLElement): void {
  const el = document.createElement('div');
  el.id = 'utc-clock';
  root.appendChild(el);
  const render = () => {
    const now = new Date();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    el.innerHTML = `<strong>${hh}:${mm}:${ss} UTC</strong><span>낮/밤 경계는 실시간입니다</span>`;
  };
  render();
  setInterval(render, 1000);
}
