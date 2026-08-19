// CelesTrak "visual" 그룹: 육안 관측 가능한 밝은 위성 ~150개 큐레이션 목록.
export const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle';

export type TleEntry = { name: string; line1: string; line2: string };

// TLE 텍스트를 3줄 단위(이름, line1, line2)로 파싱한다.
// line1은 '1 ', line2는 '2 '로 시작해야 하며, 형식이 맞지 않는 줄은 한 줄씩 건너뛰어
// 이후 블록 파싱이 어긋나지 않도록 한다.
export function parseTleText(text: string): TleEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const out: TleEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith('1 ') && l2?.startsWith('2 ')) {
      out.push({ name, line1: l1, line2: l2 });
      i += 3;
    } else {
      i += 1; // 깨진 줄 건너뛰기
    }
  }
  return out;
}

export async function fetchTle(): Promise<TleEntry[]> {
  const res = await fetch(CELESTRAK_URL);
  if (!res.ok) throw new Error(`CelesTrak ${res.status}`);
  return parseTleText(await res.text());
}
