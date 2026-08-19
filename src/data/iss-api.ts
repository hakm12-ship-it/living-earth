// ISS(국제우주정거장) 실시간 위치 API. wheretheiss.at은 별도 API 키 없이 사용 가능.
export const ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';

export type IssState = { lat: number; lon: number; altKm: number; velocityKmh: number };

// API 응답(unknown)을 IssState로 변환한다. 필드가 없거나 타입이 다르면 throw하여
// Poller가 이를 fetch 실패(error 상태)로 처리하도록 한다.
export function parseIss(json: unknown): IssState {
  const o = json as { latitude?: unknown; longitude?: unknown; altitude?: unknown; velocity?: unknown } | null;
  if (
    typeof o?.latitude !== 'number' ||
    typeof o?.longitude !== 'number' ||
    typeof o?.altitude !== 'number' ||
    typeof o?.velocity !== 'number'
  ) {
    throw new Error('ISS 응답 형식 오류');
  }
  return { lat: o.latitude, lon: o.longitude, altKm: o.altitude, velocityKmh: o.velocity };
}

export async function fetchIss(): Promise<IssState> {
  const res = await fetch(ISS_URL);
  if (!res.ok) throw new Error(`ISS API ${res.status}`);
  return parseIss(await res.json());
}
