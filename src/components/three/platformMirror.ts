import * as THREE from 'three';
import { getPartById } from '@/data/parts';
import type { PartDefinition, PlacedPart } from '@/types/parts';

interface FrameBar {
  center: THREE.Vector3;
  axis: THREE.Vector3;
  ends: [THREE.Vector3, THREE.Vector3];
  links: [CornerLink[], CornerLink[]];
}

interface CornerLink {
  bar: FrameBar;
  farEnd: 0 | 1;
  corner: THREE.Vector3;
}

const ENDS = [0, 1] as const;
const CORNER_REACH = 8;

export function mirrorPlatformTransform(
  part: PlacedPart,
  def: PartDefinition,
  allParts: PlacedPart[]
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  const spec = def.platformSpec;
  if (def.category !== 'platform' || !spec || def.extKind === 'storbox') return null;

  const position = new THREE.Vector3(...part.position);
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation));
  const boardNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
  const reach = Math.max(spec.plateWidth, spec.plateDepth) + 25;
  const bars: FrameBar[] = [];
  for (const candidate of allParts) {
    const data = getPartById(candidate.partId);
    const ports = data?.connectionPoints;
    if (data?.category !== 'bar' || !ports || ports.length < 2) continue;
    const center = new THREE.Vector3(...candidate.position);
    if (center.distanceToSquared(position) > reach ** 2) continue;
    const rotation = new THREE.Euler(...candidate.rotation);
    const ends: FrameBar['ends'] = [
      new THREE.Vector3(...ports[0].position).applyEuler(rotation).add(center),
      new THREE.Vector3(...ports[1].position).applyEuler(rotation).add(center),
    ];
    bars.push({ center, ends, axis: ends[1].clone().sub(ends[0]).normalize(), links: [[], []] });
  }

  // Only connect perpendicular bars at a shared corner. Dense frames do not
  // affect which four-edge loops can be found.
  for (const [index, first] of bars.entries()) {
    for (let j = index + 1; j < bars.length; j++) {
      const second = bars[j];
      if (Math.abs(first.axis.dot(second.axis)) >= 0.18) continue;
      for (const a of ENDS) {
        for (const b of ENDS) {
          if (first.ends[a].distanceToSquared(second.ends[b]) >= CORNER_REACH ** 2) continue;
          const corner = first.ends[a].clone().lerp(second.ends[b], 0.5);
          first.links[a].push({ bar: second, farEnd: b === 0 ? 1 : 0, corner });
          second.links[b].push({ bar: first, farEnd: a === 0 ? 1 : 0, corner });
        }
      }
    }
  }

  const sizeMatches = (width: number, depth: number) =>
    (Math.abs(width - spec.plateWidth) < 10 && Math.abs(depth - spec.plateDepth) < 10)
    || (Math.abs(depth - spec.plateWidth) < 10 && Math.abs(width - spec.plateDepth) < 10);
  let best: { normal: THREE.Vector3; axis: THREE.Vector3; offset: number; distance: number } | undefined;
  const offset = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (const first of bars) {
    // Start at end 1 and return through end 0, traversing each side end to end.
    for (const second of first.links[1]) {
      normal.crossVectors(first.axis, second.bar.axis).normalize();
      if (Math.abs(normal.dot(boardNormal)) < 0.8) continue;
      const planeDistance = offset.subVectors(position, first.center).dot(normal);
      if (Math.abs(planeDistance) > 5) continue;
      for (const third of second.bar.links[second.farEnd]) {
        if (third.bar === first || Math.abs(third.bar.axis.dot(first.axis)) <= 0.985) continue;
        for (const fourth of third.bar.links[third.farEnd]) {
          if (fourth.bar === second.bar || Math.abs(fourth.bar.axis.dot(second.bar.axis)) <= 0.985) continue;
          const closing = fourth.bar.links[fourth.farEnd].find(link => link.bar === first && link.farEnd === 1);
          if (!closing) continue;
          const corners = [second.corner, third.corner, fourth.corner, closing.corner];
          if (corners.some(corner => Math.abs(offset.subVectors(corner, first.center).dot(normal)) > 4)) continue;
          const edges = corners.map((corner, i) => corners[(i + 1) % 4].clone().sub(corner));
          const [a, b, c, d] = edges.map(edge => edge.length());
          if (Math.abs(a - c) > 6 || Math.abs(b - d) > 6
            || Math.abs(edges[0].dot(edges[1])) > 0.15 * a * b
            || Math.abs(edges[1].dot(edges[2])) > 0.15 * b * c) continue;
          const width = (a + c) / 2;
          const depth = (b + d) / 2;
          if (width < 10 || depth < 10 || !sizeMatches(width, depth)) continue;

          const center = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(0.25);
          offset.subVectors(position, center);
          const distance = offset.lengthSq();
          const normalOffset = offset.dot(normal);
          if (Math.abs(normalOffset) > 5 || distance > 18 ** 2 || (best && distance >= best.distance)) continue;
          best = { normal: normal.clone(), axis: first.axis, offset: normalOffset, distance };
        }
      }
    }
  }
  if (!best) return null;

  // Use the in-plane vertical direction to keep a wall accessory upright.
  // A horizontal frame uses one of its bar axes.
  const hinge = new THREE.Vector3(0, 1, 0).addScaledVector(best.normal, -best.normal.y);
  if (hinge.length() < 0.25) hinge.copy(best.axis);
  const turn = new THREE.Quaternion().setFromAxisAngle(hinge.normalize(), Math.PI);
  const rotation = new THREE.Euler().setFromQuaternion(turn.multiply(orientation));
  return {
    position: position.addScaledVector(best.normal, -2 * best.offset).toArray(),
    rotation: [rotation.x, rotation.y, rotation.z],
  };
}
