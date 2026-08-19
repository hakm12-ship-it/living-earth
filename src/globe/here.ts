import * as THREE from 'three';
import { GLOBE_RADIUS, latLonToVector3 } from '../utils/geo';

/**
 * 사용자의 현재 위치를 지구본에 표시하는 마커.
 *
 * 데이터 레이어가 아니라 단일 지점 표시라 Layer 인터페이스를 따르지 않는다.
 * 토글 대상이 아니고, 폴링도 상태도 없다.
 */
export class HereMarker {
  private group = new THREE.Group();
  private ring: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);
  }

  /** 지정한 위경도에 마커를 놓고 보이게 한다. 여러 번 불러도 위치만 갱신된다. */
  show(lat: number, lon: number): void {
    const pos = latLonToVector3(lat, lon, GLOBE_RADIUS * 1.004);
    if (!this.ring) {
      // 지표면에 접하는 얇은 링. 마커 자체가 지형을 가리지 않도록 속은 비운다.
      const geo = new THREE.RingGeometry(0.012, 0.02, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x66ff99,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
      });
      this.ring = new THREE.Mesh(geo, mat);
      this.group.add(this.ring);
    }
    this.ring.position.copy(pos);
    this.ring.lookAt(pos.clone().multiplyScalar(2)); // 지표면 접선 방향
    this.group.visible = true;
  }

  /** 마커가 놓인 방향(카메라를 그쪽으로 돌릴 때 쓴다). */
  directionOf(lat: number, lon: number): THREE.Vector3 {
    return latLonToVector3(lat, lon, 1).normalize();
  }

  dispose(): void {
    if (!this.ring) return;
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.group.remove(this.ring);
    this.ring = null;
  }
}
