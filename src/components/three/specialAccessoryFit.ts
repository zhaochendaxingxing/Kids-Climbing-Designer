import * as THREE from 'three';
import { getPartById } from '@/data/parts';
import type { PartDefinition, PlacedPart } from '@/types/parts';

const up = new THREE.Vector3(0, 1, 0);
type Fit = Pick<PlacedPart, 'partId' | 'position' | 'rotation'>;

function sceneMembers(parts: PlacedPart[]) {
  return parts.map(part => {
    const def = getPartById(part.partId);
    return { part, def, center: new THREE.Vector3(...part.position),
      axis: new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...part.rotation)) };
  });
}

export function findTallRainbowFit(ray: THREE.Ray, parts: PlacedPart[], def: PartDefinition): Fit | null {
  const spec = def.platformSpec;
  if (!spec) return null;
  const { plateWidth: width, plateDepth: height } = spec;
  const members = sceneMembers(parts);
  const bars = members.filter(member => member.def?.barSpec);
  const horizontal = bars.filter(member => Math.abs(member.axis.y) < 0.02
    && Math.abs(member.def!.barSpec!.length + 5 - width) < 1
    && ray.distanceSqToPoint(member.center) < (height + width) ** 2);
  let best: Fit | null = null;
  let closest = Infinity;
  for (const bottom of horizontal) {
    const axis = bottom.axis.clone().setY(0).normalize();
    const topPoint = bottom.center.clone().addScaledVector(up, height);
    if (!horizontal.some(top => top.center.distanceToSquared(topPoint) < 1
      && Math.abs(top.axis.dot(axis)) > 0.997)) continue;
    const center = bottom.center.clone().addScaledVector(up, height / 2);
    const normal = up.clone().cross(axis);
    const intersection = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
    if (!intersection) continue;
    const offset = intersection.clone().sub(center);
    const distance = intersection.distanceTo(ray.origin);
    if (distance >= closest || Math.abs(offset.dot(axis)) > width / 2 || Math.abs(offset.y) > height / 2) continue;

    const covers = (sign: number) => {
      const start = bottom.center.clone().addScaledVector(axis, width / 2 * sign);
      const intervals = bars.flatMap(bar => {
        if (Math.abs(bar.axis.y) < 0.998) return [];
        const delta = bar.center.clone().sub(start);
        if (Math.hypot(delta.x, delta.z) > 1.2) return [];
        const half = (bar.def!.barSpec!.length + 5) / 2;
        return [[delta.y - half, delta.y + half]];
      }).sort(([a], [b]) => a - b);
      let reached = 0;
      for (const [from, to] of intervals) {
        if (from > reached + 1.2) break;
        if (from >= -1.2 && to <= height + 1.2) reached = Math.max(reached, to);
      }
      return reached >= height - 1.2;
    };
    if (!covers(-1) || !covers(1)) continue;
    if (members.some(member => {
      if (!member.def?.barSpec && member.def?.category !== 'platform') return false;
      const delta = member.center.clone().sub(center);
      return Math.abs(delta.dot(normal)) < 3
        && Math.abs(delta.dot(axis)) < width / 2 - 2 && Math.abs(delta.y) < height / 2 - 2;
    })) continue;
    if (normal.dot(ray.direction) > 0) normal.negate();
    const rotation = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(normal.clone().cross(up), normal, up));
    best = { partId: def.id, position: center.toArray(), rotation: [rotation.x, rotation.y, rotation.z] };
    closest = distance;
  }
  return best;
}

export function findMountedAccessoryFit(ray: THREE.Ray, parts: PlacedPart[], def: PartDefinition): Fit | null {
  const members = sceneMembers(parts);
  const slide = def.slideSpec;
  let closest = Infinity;
  let best: Fit | null = null;
  const hit = new THREE.Vector3();
  const pointOnRail = new THREE.Vector3();
  for (const rail of members) {
    const length = rail.def?.barSpec?.length ?? 0;
    if (length < (slide ? slide.innerWidth - 0.5 : 25) || Math.abs(rail.axis.y) > 0.01) continue;
    if (slide ? Math.abs(rail.center.y - slide.rise) > 4 : rail.center.y < def.size.height + 1) continue;
    const axis = rail.axis.clone().setY(0).normalize();
    const distance = ray.distanceSqToSegment(rail.center.clone().addScaledVector(axis, -length / 2),
      rail.center.clone().addScaledVector(axis, length / 2), hit, pointOnRail);
    const score = distance + hit.distanceTo(ray.origin) * 0.02;
    if (distance > 8 ** 2 || score >= closest) continue;
    const side = axis.clone().cross(up);
    if (side.dot(hit.clone().sub(pointOnRail)) < -0.5
      || (Math.abs(side.dot(hit.clone().sub(pointOnRail))) < 0.5 && side.dot(ray.origin.clone().sub(rail.center)) < 0)) side.negate();

    const clear = (forward: THREE.Vector3) => !members.some(member => {
      if (member.part.id === rail.part.id) return false;
      const delta = member.center.clone().sub(rail.center);
      const across = delta.dot(axis);
      const along = delta.dot(forward);
      if (Math.abs(across) >= def.size.width / 2) return false;
      if (slide) {
        if (along < 2 || along > slide.run) return false;
        const slope = -slide.rise * Math.min(1, Math.max(0, (along / slide.run - 0.1) / 0.65));
        return delta.y > slope - 7 && delta.y < slope + 13;
      }
      if (member.def?.directPlacement === 'hanging-bar'
        && Math.abs(delta.y + member.def.size.height / 2) < 3 && Math.abs(along) < 4) return true;
      return Math.abs(along) < def.size.depth / 2 + 1 && delta.y < -2 && delta.y > -def.size.height;
    });
    if (!clear(side) && (!slide || !clear(side.negate()))) continue;
    const center = rail.center.clone();
    if (slide) center.addScaledVector(side, slide.run / 2).addScaledVector(up, -slide.rise / 2);
    else center.addScaledVector(up, -def.size.height / 2);
    best = { partId: def.id, position: center.toArray(), rotation: [0, Math.atan2(side.x, side.z), 0] };
    closest = score;
  }
  return best;
}
