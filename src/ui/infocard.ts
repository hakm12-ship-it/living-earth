// 클릭 피킹 결과를 보여주는 정보 카드. 3D 위에 얹는 일반 DOM 요소로,
// 텍스트 렌더링 품질과 접근성을 위해 WebGL이 아닌 HTML로 렌더링한다.
export class InfoCard {
  private el: HTMLDivElement;
  private onClose?: () => void;

  // onClose: 카드가 닫힐 때(X 버튼 클릭) 호출된다. 위성 궤도선처럼 "선택"에 종속된
  // 부가 시각 요소를 카드 생명주기에 맞춰 정리하는 용도(main.ts에서 연결).
  constructor(root: HTMLElement, onClose?: () => void) {
    this.onClose = onClose;
    this.el = document.createElement('div');
    this.el.id = 'info-card';
    this.el.setAttribute('data-testid', 'info-card');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'info-card-close') this.hide();
    });
  }

  show(title: string, rows: Array<[string, string]>): void {
    // 지진 place 등 원격 API에서 온 문자열이 rows에 섞여 들어오므로,
    // innerHTML 문자열 보간 대신 DOM API(createElement + textContent)로 구성해
    // 마크업 인젝션 가능성을 원천 차단한다.
    this.el.replaceChildren();

    const closeBtn = document.createElement('button');
    closeBtn.id = 'info-card-close';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.textContent = '×';
    this.el.appendChild(closeBtn);

    const heading = document.createElement('h2');
    heading.textContent = title;
    this.el.appendChild(heading);

    const dl = document.createElement('dl');
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    this.el.appendChild(dl);

    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
    this.onClose?.();
  }
}
