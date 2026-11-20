import * as THREE from 'three';
import { getPartById, SLIDE_STRAP_RAIL_SPACING } from '@/data/parts';
import { SLIDE_RAIL_HEIGHT, SLIDE_RUN } from '@/data/finishedProducts';
import type { PlacedPart } from '@/types/parts';

export function findSlideFit(ray: THREE.Ray, parts: PlacedPart[], halfWidth = 20) {
  const up = new THREE.Vector3(0, 1, 0);
  const nearby = parts.map(part => ({ part, center: new THREE.Vector3(...part.position), def: getPartById(part.partId) }));
  const point = new THREE.Vector3();
  const onRail = new THREE.Vector3();
  let target: { center: THREE.Vector3; axis: THREE.Vector3; side: THREE.Vector3; halfLength: number; score: number } | undefined;
  for (const rail of nearby) {
    const bar = rail.def?.barSpec;
    if (!bar) continue;
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...rail.part.rotation));
    if (Math.abs(axis.y) > 0.01) continue;
    axis.setY(0).normalize();
    const halfLength = bar.length / 2;
    const distance = ray.distanceSqToSegment(
      rail.center.clone().addScaledVector(axis, -halfLength), rail.center.clone().addScaledVector(axis, halfLength), point, onRail);
    if (distance > 9 ** 2) continue;
    const score = distance + point.distanceTo(ray.origin) * 0.025;
    if (target && score >= target.score) continue;
    const side = axis.clone().cross(up);
    const cursorSide = point.clone().sub(onRail).dot(side);
    const preferredSide = Math.abs(cursorSide) >= 0.5 ? cursorSide : ray.origin.clone().sub(rail.center).dot(side);
    if (preferredSide < 0) side.negate();
    target = { center: rail.center, axis, side, halfLength, score };
  }
  if (!target) return null;
  const { center, axis, side, halfLength } = target;
  const offsets = nearby.map(item => ({ ...item, delta: item.center.clone().sub(center) }));
  // Keep one slide per crossbar, regardless of the side from which it was installed.
  if (offsets.some(({ delta, def }) => def?.id === 'connector-slide-strap'
    && Math.abs(delta.dot(axis)) <= halfLength && Math.abs(delta.dot(side)) < SLIDE_STRAP_RAIL_SPACING
    && Math.abs(delta.y) < 2)) return null;
  const open = (direction: THREE.Vector3) => !offsets.some(({ delta }) => {
    const forward = delta.dot(direction);
    if (Math.abs(delta.dot(axis)) > halfWidth + 1 || forward <= 1 || forward > SLIDE_RUN + SLIDE_STRAP_RAIL_SPACING + 2) return false;
    const slope = -40 * Math.max(0, forward - SLIDE_STRAP_RAIL_SPACING) / SLIDE_RUN;
    return delta.y >= slope - 4 && delta.y <= slope + 22;
  });
  if (!open(side) && !open(side.negate())) return null;
  return {
    position: center.clone().addScaledVector(up, -SLIDE_RAIL_HEIGHT),
    yaw: Math.atan2(side.x, side.z),
    strapHalfSpacing: Math.min(halfWidth - (halfWidth === 20 ? 8 : 6), halfLength - 1.5),
  };
}

export function placeAssemblyParts(parts: PlacedPart[], fit: { position: THREE.Vector3; yaw: number; strapHalfSpacing?: number }): PlacedPart[] {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fit.yaw);
  return parts.map(part => {
    const rotation = new THREE.Euler().setFromQuaternion(turn.clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation))));
    const local = new THREE.Vector3(...part.position);
    if (part.partId === 'connector-slide-strap' && fit.strapHalfSpacing !== undefined) {
      local.x = Math.sign(local.x) * fit.strapHalfSpacing;
    }
    return {
      ...part,
      position: local.applyQuaternion(turn).add(fit.position).toArray(),
      rotation: [rotation.x, rotation.y, rotation.z],
    };
  });
}
