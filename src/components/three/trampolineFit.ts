import * as THREE from 'three';
import { getPartById } from '@/data/parts';
import type { PartDefinition, PlacedPart } from '@/types/parts';

interface Rail {
  center: THREE.Vector3;
  axis: THREE.Vector3;
  halfSpan: number;
}

const eaveShoulder = 2.5;
const tolerance = 1.4;
const up = new THREE.Vector3(0, 1, 0);

export function findTrampolineFit(ray: THREE.Ray, parts: PlacedPart[], def: PartDefinition):
  Pick<PlacedPart, 'partId' | 'position' | 'rotation'> | null {
  const span = def.size.width;
  const half = span / 2;
  const rails: Rail[] = [];
  const panels: THREE.Vector3[] = [];
  for (const part of parts) {
    const type = getPartById(part.partId);
    const center = new THREE.Vector3(...part.position);
    if (ray.distanceSqToPoint(center) > (span + 15) ** 2) continue;
    const rotation = new THREE.Euler(...part.rotation);
    if (type?.category === 'platform' && up.clone().applyEuler(rotation).y ** 2 > 0.5) panels.push(center);
    if (!type?.barSpec) continue;
    const axis = new THREE.Vector3(1, 0, 0).applyEuler(rotation);
    if (Math.abs(axis.y) > 0.06) continue;
    rails.push({ center, axis: axis.setY(0).normalize(), halfSpan: type.barSpec.length / 2 + eaveShoulder });
  }
  const offset = new THREE.Vector3();
  const coversSide = (start: THREE.Vector3, axis: THREE.Vector3) => {
    const intervals: [number, number][] = [];
    for (const rail of rails) {
      if (Math.abs(axis.dot(rail.axis)) < 0.998) continue;
      const along = offset.subVectors(rail.center, start).dot(axis);
      if (offset.addScaledVector(axis, -along).lengthSq() > tolerance ** 2) continue;
      const from = along - rail.halfSpan;
      const to = along + rail.halfSpan;
      if (from >= -tolerance && to <= span + tolerance) intervals.push([from, to]);
    }
    intervals.sort(([a], [b]) => a - b);
    let end = 0;
    for (const [from, to] of intervals) {
      if (from > end + tolerance) break;
      end = Math.max(end, to);
    }
    return end >= span - tolerance;
  };

  const hit = new THREE.Vector3();
  const plane = new THREE.Plane();
  let nearest = Infinity;
  let best: ReturnType<typeof findTrampolineFit> = null;
  for (const rail of rails) {
    plane.setFromNormalAndCoplanarPoint(up, rail.center);
    if (!ray.intersectPlane(plane, hit)) continue;
    const distance = hit.distanceTo(ray.origin);
    if (distance >= nearest) continue;
    for (const sign of [-1, 1]) {
      const axis = rail.axis.clone().multiplyScalar(sign);
      const start = rail.center.clone().addScaledVector(axis, -rail.halfSpan);
      for (const side of [-1, 1]) {
        const inward = axis.clone().cross(up).multiplyScalar(side);
        const within = (point: THREE.Vector3, boundary: number, height: number) => {
          offset.subVectors(point, start);
          const a = offset.dot(axis);
          const b = offset.dot(inward);
          return Math.abs(offset.y) < height && a > boundary && a < span - boundary && b > boundary && b < span - boundary;
        };
        if (!within(hit, 0, tolerance)) continue;
        const opposite = start.clone().addScaledVector(inward, span);
        const end = start.clone().addScaledVector(axis, span);
        if (!coversSide(start, axis) || !coversSide(opposite, axis)
          || !coversSide(start, inward) || !coversSide(end, inward)) continue;
        if (panels.some(point => within(point, 2, 5)) || rails.some(candidate => within(candidate.center, 3, tolerance))) continue;
        const center = start.clone().addScaledVector(axis, half).addScaledVector(inward, half);
        best = { partId: def.id, position: center.toArray(), rotation: [0, Math.atan2(-axis.z, axis.x), 0] };
        nearest = distance;
      }
    }
  }
  return best;
}
