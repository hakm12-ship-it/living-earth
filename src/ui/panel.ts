// 좌하단 레이어 범례 겸 스위치. 점 색은 지구본 마커 색과 같고, 점 자체가 토글이다.
export type PanelItem = {
  id: string;
  label: string;
  // 범례 점이자 스위치의 색. 해당 레이어가 지구본에 실제로 그리는 마커 색과 일치시킨다.
  color: string;
  defaultOn: boolean;
  onToggle: (on: boolean) => void;
  // true면 status가 'error'여도 체크박스를 비활성화하지 않는다. 위성처럼 토글을
  // 다시 켜는 동작 자체가 세션 내 재시도를 트리거하는 레이어에 사용한다 —
  // 그렇지 않으면 체크박스가 비활성화되어 사용자가 재시도를 시작할 방법이 없다.
  allowToggleOnError?: boolean;
};

export class LayerPanel {
  private el: HTMLDivElement;
  private items: PanelItem[];
  private initialApplied = false;

  constructor(root: HTMLElement, items: PanelItem[]) {
    this.items = items;
    this.el = document.createElement('div');
    this.el.id = 'layer-panel';
    this.el.innerHTML = items
      .map(
        (item) => `
      <label class="layer-toggle" data-layer="${item.id}">
        <input type="checkbox" data-testid="toggle-${item.id}" ${item.defaultOn ? 'checked' : ''} />
        <span class="label">${item.label}</span>
        <span class="status" hidden>연결 안 됨</span>
      </label>`,
      )
      .join('');
    root.appendChild(this.el);

    for (const item of items) {
      const row = this.el.querySelector<HTMLElement>(`[data-layer="${item.id}"]`)!;
      // 점 색은 CSS 변수로 넘긴다 — 스위치(=input)를 그 색으로 칠하는 건 스타일 쪽 일이다.
      row.style.setProperty('--dot', item.color);
      const input = row.querySelector<HTMLInputElement>('input')!;
      input.addEventListener('change', () => item.onToggle(input.checked));
    }
    // 주의: 여기서 onToggle(defaultOn)을 즉시 호출하지 않는다 — 생성 시점에는 아직
    // 어떤 레이어도 LayerManager에 등록돼 있지 않아(main.ts: 패널 -> 레이어 생성 ->
    // layers.add 순서) onToggle이 layers.setVisible을 호출해도 조용히 무동작한다.
    // 초기 상태 반영은 모든 레이어가 등록된 뒤 applyInitial()을 명시적으로 호출해야 한다.
  }

  // 모든 레이어가 LayerManager에 등록된 뒤 정확히 한 번 호출해 각 항목의 defaultOn을
  // 실제로 반영한다(패널의 선언된 기본값이 레이어 표시 상태의 단일 진실 공급원이 되도록).
  // 중복 호출을 막기 위해 initialApplied 플래그로 가드한다.
  applyInitial(): void {
    if (this.initialApplied) return;
    this.initialApplied = true;
    for (const item of this.items) item.onToggle(item.defaultOn);
  }

  // 패널 아래에 동작 버튼을 추가하고 그 버튼을 돌려준다.
  // 호출부가 라벨을 상태에 맞게 바꿀 수 있어야 하기 때문이다.
  addAction(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'panel-action';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    this.el.appendChild(btn);
    return btn;
  }

  setStatus(id: string, s: 'ok' | 'error' | 'loading'): void {
    const row = this.el.querySelector(`[data-layer="${id}"]`);
    if (!row) return;
    const status = row.querySelector<HTMLElement>('.status')!;
    const input = row.querySelector<HTMLInputElement>('input')!;
    const item = this.items.find((i) => i.id === id);
    status.hidden = s !== 'error';
    input.disabled = s === 'error' && !item?.allowToggleOnError;
    row.classList.toggle('error', s === 'error');
  }
}
