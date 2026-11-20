import * as THREE from 'three';
import { LADDER_ACCESSORY, SLIDE_ACCESSORY, SLIDE_RAIL_HEIGHT, SLIDE_RUN } from '@/data/finishedProducts';
import { getPartById, SLIDE_STRAP_RAIL_SPACING } from '@/data/parts';
import { findOptimizedConnector, ports } from '@/lib/construction';
import type { PlacedPart } from '@/types/parts';
import { placeAssemblyParts } from './slideFit';

export function findLadderJoin(ray: THREE.Ray, scene: PlacedPart[]) {
  const rails = scene.filter(part => part.partId === 'bar-35');
  const vector = (part: PlacedPart) => new THREE.Vector3(...part.position);
  const axisOf = (part: PlacedPart) => new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...part.rotation));
  const down = new THREE.Vector3(0, -40, SLIDE_RUN).normalize();
  const normal = down.clone().cross(new THREE.Vector3(1, 0, 0));
  let scenePorts: ReturnType<typeof ports> | undefined;
  let best: { additions: PlacedPart[]; replacements: PlacedPart[]; sharedIds: string[];
    previewIds: Set<string>; position: THREE.Vector3; yaw: number; score: number } | null = null;

  for (const rail of rails) {
    if (ray.distanceSqToPoint(vector(rail)) > 62 ** 2) continue;
    const slope = axisOf(rail);
    if (Math.abs(Math.abs(slope.y) - 0.5) > 0.005) continue;
    if (slope.y > 0) slope.negate();
    const yaw = Math.atan2(slope.x, slope.z);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
    const surface = normal.clone().applyQuaternion(turn);
    for (const row of [0, 1]) {
      const start = vector(rail).addScaledVector(slope, -(row * 40 + 20));
      const otherRail = rails.find(part => part.id !== rail.id && Math.abs(axisOf(part).dot(slope)) > 0.999
        && vector(part).distanceToSquared(start.clone().addScaledVector(slope, 60 - row * 40)) < 0.01);
      if (!otherRail) continue;
      for (const side of [-1, 1]) {
        const outward = sideAxis.clone().multiplyScalar(side);
        const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(surface, start), new THREE.Vector3());
        if (!hit) continue;
        const cursor = hit.clone().sub(start);
        const across = cursor.dot(outward);
        const along = cursor.dot(slope);
        if (across < -2 || across > 32 || along < -3 || along > 83) continue;
        const score = hit.distanceTo(ray.origin);
        if (best && score >= best.score) continue;
        const isSlide = [20, 60].every(distance => {
          const panel = start.clone().addScaledVector(slope, distance).addScaledVector(outward, -20).addScaledVector(surface, 2.1);
          return scene.some(part => part.partId === 'platform-39.5x39.5' && vector(part).distanceToSquared(panel) < 0.04);
        });
        if (!isSlide || scene.some(part => {
          const offset = vector(part).sub(start);
          return offset.dot(outward) > 1 && offset.dot(outward) < 32 && Math.abs(offset.dot(surface)) < 4
            && offset.dot(slope) > -2 && offset.dot(slope) < 82;
        })) continue;

        const joints = [0, 40, 80].map(distance => scene.find(part => getPartById(part.partId)?.connectorSpec
          && vector(part).distanceToSquared(start.clone().addScaledVector(slope, distance)) < 0.04));
        if (joints.some(part => !part)) continue;
        const replacements: PlacedPart[] = [];
        const connectedPorts = scenePorts ??= ports(scene);
        for (const joint of joints) {
          if (!joint) continue;
          const connected = connectedPorts.filter(port => port.partId === joint.id && connectedPorts.some(other =>
            other.partId !== joint.id && other.type !== port.type && other.position.distanceToSquared(port.position) < 0.02
            && other.direction.dot(port.direction) < -0.999));
          const match = findOptimizedConnector([...connected.map(port => port.direction), outward]);
          if (match) replacements.push({ ...joint, partId: match.partId, rotation: [match.euler.x, match.euler.y, match.euler.z] });
        }
        if (replacements.length !== 3) continue;

        const position = start.clone().addScaledVector(outward, 15);
        position.addScaledVector(new THREE.Vector3(0, 1, 0), -SLIDE_RAIL_HEIGHT);
        position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(turn), -SLIDE_STRAP_RAIL_SPACING);
        const world = placeAssemblyParts(LADDER_ACCESSORY.parts, { position, yaw, strapHalfSpacing: 9 });
        const sharedX = -side * 15;
        const previewIds = new Set<string>();
        const additions = world.filter((part, index) => {
          const local = LADDER_ACCESSORY.parts[index];
          if (part.partId === 'connector-slide-strap') return false;
          if (Math.abs(local.position[0] - sharedX) > 0.01) {
            previewIds.add(part.id);
            return true;
          }
          if (part.partId === 'bar-15') {
            const distance = vector(part).sub(start).dot(slope);
            const replaced = [rail, otherRail][distance < 40 ? row : 1 - row];
            part.colorId = replaced.colorId;
            if (distance % 40 < 20) {
              replacements.push({ ...part, id: replaced.id });
              return false;
            }
            return true;
          }
          return Math.abs(vector(part).sub(start).dot(slope) % 40 - 20) < 0.1;
        });
        const slideOrigin = position.clone().addScaledVector(outward, -35);
        const slideBodies = SLIDE_ACCESSORY.parts.filter(part => part.partId !== 'connector-slide-strap');
        const shared = placeAssemblyParts(slideBodies, { position: slideOrigin, yaw, strapHalfSpacing: 12 }).flatMap(expected => {
          const center = vector(expected);
          const existing = scene.find(part => vector(part).distanceToSquared(center) < 0.04
            && getPartById(part.partId)?.category === getPartById(expected.partId)?.category);
          return existing ? [existing.id] : [];
        });
        const strapCenter = slideOrigin.clone().add(new THREE.Vector3(0, SLIDE_RAIL_HEIGHT, SLIDE_STRAP_RAIL_SPACING / 2).applyQuaternion(turn));
        const straps = scene.filter(part => {
          if (part.partId !== 'connector-slide-strap') return false;
          const delta = vector(part).sub(strapCenter);
          const x = delta.dot(sideAxis);
          return Math.abs(x) < 15 && delta.addScaledVector(sideAxis, -x).lengthSq() < 0.04;
        });
        const sharedIds = [...new Set([...shared, ...straps.map(part => part.id), ...replacements.map(part => part.id)])];
        best = { additions, replacements, sharedIds, previewIds, position, yaw, score };
      }
    }
  }
  return best;
}
