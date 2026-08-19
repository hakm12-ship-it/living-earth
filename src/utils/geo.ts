import * as THREE from 'three';

/** 지구본 모델의 기준 반지름(씬 단위). 위경도 → 3D 좌표 변환의 기준이 된다. */
export const GLOBE_RADIUS = 1;

/** 실제 지구의 반지름 (km). 고도 변환에 사용. */
export const EARTH_RADIUS_KM = 6371;

/**
 * 위도/경도를 3D 좌표로 변환.
 * 좌표계: 위도 90° = +Y축, (lat 0, lon 0) = 텍스처 UV가 맞는 방향.
 * Three.js 기본 SphereGeometry의 UV 배치 기준으로:
 * x = -r·sin(φ)·cos(θ), y = r·cos(φ), z = r·sin(φ)·sin(θ)
 * (φ = (90−lat)·π/180, θ = (lon+180)·π/180)
 */
export function latLonToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/**
 * 고도(km)를 씬 반지름으로 변환.
 * 고도 0km = GLOBE_RADIUS, 고도 증가 시 선형으로 반지름 확대.
 */
export function altitudeToRadius(altKm: number): number {
  return GLOBE_RADIUS * (1 + altKm / EARTH_RADIUS_KM);
}

/**
 * 두 위경도 지점을 t(0~1)로 선형 보간한다.
 * 경도는 날짜변경선(±180°) 랩어라운드를 고려해 항상 짧은 쪽 경로로 보간하고,
 * 결과 경도를 [-180, 180] 범위로 정규화한다.
 */
export function lerpLatLon(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
): { lat: number; lon: number } {
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  let lon = a.lon + dLon * t;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: a.lat + (b.lat - a.lat) * t, lon };
}
