// USGS 지진 피드(GeoJSON) URL과 파서.
// 지난 24시간 동안 발생한 전세계 지진 정보를 제공한다.
export const USGS_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export type Earthquake = {
  lat: number;
  lon: number;
  mag: number;
  time: number;
  place: string;
};

// USGS GeoJSON 응답을 Earthquake 배열로 변환한다. 형식이 깨진 feature는 건너뛴다.
// geometry.coordinates는 [lon, lat, depth] 순서임에 주의.
export function parseUsgs(geojson: unknown): Earthquake[] {
  const out: Earthquake[] = [];
  const features = (geojson as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const props = (f as { properties?: { mag?: unknown; time?: unknown; place?: unknown } })?.properties;
    const coords = (f as { geometry?: { coordinates?: unknown[] } })?.geometry?.coordinates;
    if (!props || !Array.isArray(coords)) continue;
    const [lon, lat] = coords;
    if (typeof props.mag !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    out.push({
      lat,
      lon,
      mag: props.mag,
      time: typeof props.time === 'number' ? props.time : 0,
      place: typeof props.place === 'string' ? props.place : '',
    });
  }
  return out;
}

// 실제 USGS 피드를 fetch하고 파싱한다.
export async function fetchUsgs(): Promise<Earthquake[]> {
  const res = await fetch(USGS_URL);
  if (!res.ok) throw new Error(`USGS ${res.status}`);
  return parseUsgs(await res.json());
}
