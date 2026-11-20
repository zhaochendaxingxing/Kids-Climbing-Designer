import * as THREE from 'three';
import { getPartById, PLATE_THICKNESS, ROOF_PANEL_ID } from '@/data/parts';
import type { PlacedPart } from '@/types/parts';

export type RoofPanelFit = Pick<PlacedPart, 'partId' | 'position' | 'rotation' | 'roofOutline'>;

interface Rail {
  low: THREE.Vector3;
  high: THREE.Vector3;
  direction: THREE.Vector3;
  radius: number;
}

function meetAtPeak(a: Rail, b: Rail): THREE.Vector3 | null {
  const angle = a.direction.dot(b.direction);
  const denominator = 1 - angle ** 2;
  if (denominator < 0.04 || a.high.distanceToSquared(b.high) > 16 ** 2) return null;
  const offset = a.high.clone().sub(b.high);
  const onA = offset.dot(a.direction);
  const onB = offset.dot(b.direction);
  const t = (angle * onB - onA) / denominator;
  const s = (onB - angle * onA) / denominator;
  if (t < -2 || s < -2 || t > 9 || s > 9) return null;
  const aPeak = a.high.clone().addScaledVector(a.direction, t);
  const bPeak = b.high.clone().addScaledVector(b.direction, s);
  return aPeak.distanceToSquared(bPeak) <= 2 ** 2 ? aPeak.lerp(bPeak, 0.5) : null;
}

function reachesEave(a: Rail, b: Rail, eave: Rail): boolean {
  // Leave room for both connector shoulders, including the 45° nested elbow.
  const reachSq = 13 ** 2;
  return (a.low.distanceToSquared(eave.low) <= reachSq && b.low.distanceToSquared(eave.high) <= reachSq)
    || (a.low.distanceToSquared(eave.high) <= reachSq && b.low.distanceToSquared(eave.low) <= reachSq);
}

export function findRoofPanelFit(ray: THREE.Ray, parts: PlacedPart[], occluder = Infinity): RoofPanelFit | null {
  const slopes: Rail[] = [];
  const eaves: Rail[] = [];
  for (const part of parts) {
    const def = getPartById(part.partId);
    const ends = def?.connectionPoints;
    if (!def?.barSpec || !ends || ends.length < 2) continue;
    const origin = new THREE.Vector3(...part.position);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation));
    const [a, b] = ends.slice(0, 2).map(end => new THREE.Vector3(...end.position).applyQuaternion(q).add(origin));
    if (ray.distanceSqToSegment(a, b) > 55 ** 2) continue;
    const [low, high] = a.y <= b.y ? [a, b] : [b, a];
    const direction = high.clone().sub(low).normalize();
    const rail = { low, high, direction, radius: def.barSpec.outerDiameter / 2 };
    if (direction.y <= 0.12) eaves.push(rail);
    else if (direction.y >= 0.25 && direction.y <= 0.96) slopes.push(rail);
  }

  let nearest = occluder;
  let best: RoofPanelFit | null = null;
  const hit = new THREE.Vector3();
  for (const [i, a] of slopes.entries()) {
    for (let j = i + 1; j < slopes.length; j++) {
      const b = slopes[j];
      const peak = meetAtPeak(a, b);
      if (!peak) continue;
      for (const eave of eaves) {
        if (!reachesEave(a, b, eave)) continue;
        const height = (eave.low.y + eave.high.y) / 2;
        const toEaveA = (height - a.low.y) / a.direction.y;
        const toEaveB = (height - b.low.y) / b.direction.y;
        if (Math.abs(toEaveA) > 13 || Math.abs(toEaveB) > 13) continue;
        const aBase = a.low.clone().addScaledVector(a.direction, toEaveA);
        const bBase = b.low.clone().addScaledVector(b.direction, toEaveB);
        const base = bBase.clone().sub(aBase);
        const cross = base.clone().cross(peak.clone().sub(aBase));
        if (base.lengthSq() < 12 ** 2 || cross.lengthSq() < 120 ** 2) continue;
        const normal = cross.normalize();
        if (Math.abs(normal.y) < 0.22 || Math.abs(normal.y) > 0.97) continue;
        if (normal.y < 0) normal.negate();
        // The eave may sit slightly inside the hip rods at the nested joint.
        if (Math.abs(base.clone().normalize().dot(eave.direction)) < 0.87
          || Math.abs(eave.low.clone().sub(aBase).dot(normal)) > 9
          || Math.abs(eave.high.clone().sub(aBase).dot(normal)) > 9) continue;
        const offset = (a.radius + b.radius + eave.radius) / 3 + PLATE_THICKNESS / 2 - 0.2;
        const corners = [aBase, bBase, peak].map(point => point.addScaledVector(normal, offset));
        if (!ray.intersectTriangle(corners[0], corners[1], corners[2], false, hit)) continue;
        const distance = hit.distanceTo(ray.origin);
        if (distance >= nearest) continue;

        const x = base.normalize();
        const z = x.clone().cross(normal);
        const inPlane = corners.map(point => point.clone().sub(corners[0]));
        const xs = inPlane.map(point => point.dot(x));
        const zs = inPlane.map(point => point.dot(z));
        const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
        const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
        const center = corners[0].clone().addScaledVector(x, midX).addScaledVector(z, midZ);
        if (parts.some(part => part.roofOutline && center.distanceToSquared(new THREE.Vector3(...part.position)) < 2 ** 2)) continue;
        const pose = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, normal, z));
        best = {
          partId: ROOF_PANEL_ID,
          position: center.toArray(),
          rotation: [pose.x, pose.y, pose.z],
          roofOutline: [[xs[0] - midX, zs[0] - midZ], [xs[1] - midX, zs[1] - midZ], [xs[2] - midX, zs[2] - midZ]],
        };
        nearest = distance;
      }
    }
  }
  return best;
}
