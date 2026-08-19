// 간이 태양 직하점 공식. 균시차(equation of time)는 무시 — 시각 오차 최대 ±16분(경도 ±4°).
// 낮/밤 경계 렌더링 용도로 충분하다.
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000; // 소수 포함

  // 태양 적위: -23.44° * cos(360°/365 * (N + 10))
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));

  // UTC 시각 기준 경도: 정오에 0°, 시간당 서쪽으로 15°
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (12 - utcHours) * 15;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;

  return { lat, lon };
}
