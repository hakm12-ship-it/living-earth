// 좌상단 헤더: 이 화면이 무엇인지와 소스 위치를 알려준다.
// 방문자가 처음 보는 것이 지구본과 토글뿐이면 무엇을 보고 있는지 알 수 없으므로,
// 시각을 방해하지 않는 선에서 최소한의 맥락만 둔다.
const SOURCE_URL = 'https://github.com/hakm12-ship-it/living-earth';

export function mountHeader(root: HTMLElement): void {
  const el = document.createElement('header');
  el.id = 'site-header';

  const title = document.createElement('h1');
  title.textContent = '살아있는 지구';

  const desc = document.createElement('p');
  desc.className = 'source';
  desc.textContent = 'USGS · NASA · CelesTrak';

  const link = document.createElement('a');
  link.href = SOURCE_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'SOURCE ↗';

  el.append(title, desc, link);
  root.appendChild(el);
}
