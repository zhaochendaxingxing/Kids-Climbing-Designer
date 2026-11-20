import * as THREE from 'three';
import { BRIDGE_RAIL_HEIGHT, BRIDGE_ROPE_DROP } from '@/data/finishedProducts';
import { getPartById } from '@/data/parts';
import type { PlacedPart } from '@/types/parts';

export function findBridgeFit(ray: THREE.Ray, parts: PlacedPart[]) {
  const rails = parts.flatMap(part => {
    if (getPartById(part.partId)?.barSpec?.length !== 35 || part.position[1] < BRIDGE_ROPE_DROP + 2.5) return [];
    const center = new THREE.Vector3(...part.position);
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...part.rotation));
    return Math.abs(axis.y) < 0.01 && ray.distanceSqToPoint(center) < 85 ** 2
      ? [{ center, axis: axis.setY(0).normalize() }] : [];
  });
  const up = new THREE.Vector3(0, 1, 0);
  let best: { position: THREE.Vector3; yaw: number; distance: number } | null = null;
  for (const { center, axis } of rails) {
    const across = up.clone().cross(axis);
    for (const lengthSide of [-1, 1]) for (const widthSide of [-1, 1]) {
      const middle = center.clone().addScaledVector(axis, lengthSide * 20).addScaledVector(across, widthSide * 20);
      const deck = middle.clone().addScaledVector(up, -BRIDGE_ROPE_DROP);
      const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(up, deck), new THREE.Vector3());
      if (!hit) continue;
      const cursor = hit.sub(deck);
      if (Math.abs(cursor.dot(across)) > 21 || Math.abs(cursor.dot(axis)) > 41) continue;
      const distance = ray.distanceSqToPoint(deck);
      if (best && distance >= best.distance) continue;

      const corners = [-1, 1].flatMap(side => [-1, 1].map(row =>
        middle.clone().addScaledVector(across, side * 20).addScaledVector(axis, row * 20)));
      if (!corners.every(point => rails.some(rail => rail.center.distanceToSquared(point) < 1
        && Math.abs(rail.axis.dot(axis)) > 0.998))) continue;
      if (parts.some(part => {
        const offset = new THREE.Vector3(...part.position).sub(deck);
        return Math.abs(offset.dot(across)) < 17 && Math.abs(offset.dot(axis)) < 40
          && offset.y > -3 && offset.y < BRIDGE_ROPE_DROP + 2;
      })) continue;
      best = { position: middle.addScaledVector(up, -BRIDGE_RAIL_HEIGHT), yaw: Math.atan2(axis.x, axis.z), distance };
    }
  }
  return best;
}
