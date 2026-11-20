import * as THREE from 'three';
import { getPartById, NEST_SLOPE_SHOULDER, PARTS_LIBRARY } from '../data/parts';
import type { PlacedPart } from '../types/parts';

// 方向向量 → 精确坐标键（保留角度；斜向不会被压成轴向）
function vecKey(v: THREE.Vector3): string {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return `${r(v.x)},${r(v.y)},${r(v.z)}`;
}

// 两个单位方向 a→ap、b→bp 的旋转（存在则返回 quaternion，否则 null，用于精确对齐接口）
function twoVectorRotation(
  aRaw: THREE.Vector3, apRaw: THREE.Vector3,
  bRaw: THREE.Vector3, bpRaw: THREE.Vector3,
): THREE.Quaternion | null {
  const a = aRaw.clone().normalize();
  const ap = apRaw.clone().normalize();
  const b = bRaw.clone().normalize();
  const bp = bpRaw.clone().normalize();
  // 相对夹角必须一致（否则不可能同时对齐）
  if (Math.abs(a.dot(b) - ap.dot(bp)) > 1e-3) return null;
  // 第一步：a → ap
  let q1: THREE.Quaternion;
  const da = a.dot(ap);
  if (da > 0.999999) q1 = new THREE.Quaternion();
  else if (da < -0.999999) {
    // 反平行：绕与 a 正交的任意轴转 180°
    const cross = a.clone().cross(new THREE.Vector3(1, 0, 0));
    const axis = cross.lengthSq() < 1e-6 ? a.clone().cross(new THREE.Vector3(0, 1, 0)) : cross;
    q1 = new THREE.Quaternion().setFromAxisAngle(axis.normalize(), Math.PI);
  } else {
    q1 = new THREE.Quaternion().setFromUnitVectors(a, ap);
  }
  const b1 = b.clone().applyQuaternion(q1);
  // 第二步：在垂直于 ap 的平面内把 b1 转到 bp（旋转轴为 ap 方向，故保持 ap 不动）
  const proj1 = b1.clone().sub(ap.clone().multiplyScalar(b1.dot(ap)));
  const proj2 = bp.clone().sub(ap.clone().multiplyScalar(bp.dot(ap)));
  if (proj1.lengthSq() < 1e-6 || proj2.lengthSq() < 1e-6) {
    // b 与 a 平行，无多余自由度；检查 b 是否已随 a 对齐
    return vecKey(b1) === vecKey(bp) ? q1 : null;
  }
  const q2 = new THREE.Quaternion().setFromUnitVectors(proj1.normalize(), proj2.normalize());
  q2.multiply(q1);
  return q2;
}

function eulerFromQuat(q: THREE.Quaternion): THREE.Euler {
  return new THREE.Euler().setFromQuaternion(q, 'XYZ');
}

// 局部接口方向集合能否通过（任意角度）旋转精确对齐为一组世界方向；能则返回 Euler，否则 null
function matchDirsToUsed(localDirs: THREE.Vector3[], usedWorld: THREE.Vector3[]): THREE.Euler | null {
  const n = localDirs.length;
  if (n === 0 || n !== usedWorld.length) return null;
  const loc = localDirs.map((v) => v.clone().normalize());
  const used = usedWorld.map((v) => v.clone().normalize());
  if (n === 1) return eulerFromQuat(new THREE.Quaternion().setFromUnitVectors(loc[0], used[0]));
  const usedKeys = new Set<string>(used.map((v) => vecKey(v)));
  const s0 = loc[0];
  // 以「第一个接口 + 任选第二个接口」作为旋转锚点，枚举其在 used 中的落点
  for (let i = 0; i < n; i++) {
    const u0 = used[i];
    for (let j = 1; j < n; j++) {
      const s1 = loc[j];
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const u1 = used[k];
        const q = twoVectorRotation(s0, u0, s1, u1);
        if (!q) continue;
        const set = new Set<string>(loc.map((v) => vecKey(v.clone().applyQuaternion(q))));
        if (set.size !== n) continue;
        let ok = true;
        for (const key of set) if (!usedKeys.has(key)) { ok = false; break; }
        if (ok) return eulerFromQuat(q);
      }
    }
  }
  return null;
}

// 找“接口数一致且可对齐到 used 方向”的连接件型号；返回 { partId, euler } 或 null
export function findOptimizedConnector(usedWorld: THREE.Vector3[]): { partId: string; euler: THREE.Euler } | null {
  const n = usedWorld.length;
  if (n === 0) return null;
  for (const def of PARTS_LIBRARY) {
    if (def.category !== 'connector') continue;
    const localDirs = (def.connectionPoints || [])
      .map((cp) => new THREE.Vector3(cp.direction[0], cp.direction[1], cp.direction[2]).normalize());
    if (localDirs.length !== n) continue;
    const euler = matchDirsToUsed(localDirs, usedWorld);
    if (euler) return { partId: def.id, euler };
  }
  return null;
}

export function ports(parts: PlacedPart[]) {
  return parts.flatMap(part => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation));
    return (getPartById(part.partId)?.connectionPoints ?? []).map(cp => ({
      partId: part.id, cpId: cp.id, type: cp.type,
      position: new THREE.Vector3(...cp.position).applyQuaternion(q).add(new THREE.Vector3(...part.position)),
      direction: new THREE.Vector3(...cp.direction).applyQuaternion(q).normalize(),
    }));
  });
}
type Port = ReturnType<typeof ports>[number];
const mates = (a: Port, b: Port, tolerance = 0.15) => a.type !== b.type && a.partId !== b.partId && a.position.distanceTo(b.position) < tolerance && a.direction.dot(b.direction) < -0.999;

// Probe connector bodies, rather than their large axis-aligned selection boxes.
// Male insertion segments deliberately sit inside hollow rods and are not body probes.
export function bodyIntersects(parts: PlacedPart[], scene: PlacedPart[]) {
  for (const p of parts) {
    const def = getPartById(p.partId);
    if (def?.category !== 'connector') continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation));
    const center = new THREE.Vector3(...p.position);
    const probes = [center];
    if (p.partId === 'connector-45deg-nest') {
      const direction = new THREE.Vector3(Math.SQRT1_2, Math.SQRT1_2, 0).applyQuaternion(q);
      for (let d = 1; d <= NEST_SLOPE_SHOULDER; d += 0.5) probes.push(center.clone().addScaledVector(direction, d));
    }
    for (const other of scene) {
      const od = getPartById(other.partId);
      if (od?.category === 'connector' && center.distanceTo(new THREE.Vector3(...other.position)) < 3.5) return true;
      if (!od?.barSpec) continue;
      const ends = ports([other]);
      if (ends.length !== 2) continue;
      const axis = ends[1].position.clone().sub(ends[0].position);
      const length = axis.length(); axis.normalize();
      for (const probe of probes) {
        const offset = probe.clone().sub(ends[0].position);
        const t = offset.dot(axis);
        if (t > 0.1 && t < length - 0.1 && offset.addScaledVector(axis, -t).length() < od.barSpec.outerDiameter / 2 + 0.2) return true;
      }
    }
  }
  return false;
}

// Evaluate every horizontal orientation, including rotations about a vertical anchor.
// Replacement must preserve ALL rods previously connected to the old junction.
export function fitRoofCombo(combo: PlacedPart[], scene: PlacedPart[], replaced?: PlacedPart): PlacedPart[] | null {
  const ids = new Set(combo.map(p => p.id));
  const rest = scene.filter(p => !ids.has(p.id) && p.id !== replaced?.id);
  const all = ports(rest);
  const required = replaced ? all.filter(cp => ports([replaced]).some(op => mates(op, cp))) : [];
  if (required.length > 2) return null;
  const targets = all.filter(cp => cp.type === 'female' && getPartById(rest.find(p => p.id === cp.partId)!.partId)?.category === 'bar' && !all.some(op => mates(cp, op)));
  const self = ports(combo);
  const free = self.filter(cp => cp.type === 'male' && !self.some(op => mates(cp, op)));
  const centroid = rest.reduce((v, p) => v.add(new THREE.Vector3(...p.position)), new THREE.Vector3()).divideScalar(Math.max(rest.length, 1));
  let best: { parts: PlacedPart[]; score: number } | null = null;
  for (const anchor of free) for (const target of targets) {
    if (required.length && !required.includes(target)) continue;
    if (!replaced && anchor.position.distanceTo(target.position) > 21) continue;
    const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    if (Math.hypot(anchor.direction.x, anchor.direction.z) > 0.01) yaws.push(Math.atan2(-target.direction.z, -target.direction.x) - Math.atan2(anchor.direction.z, anchor.direction.x));
    for (const yaw of yaws) {
      // THREE's positive Y rotation decreases the XZ azimuth.
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      if (anchor.direction.clone().applyQuaternion(q).dot(target.direction) > -0.999) continue;
      const translation = target.position.clone().sub(anchor.position.clone().applyQuaternion(q));
      const transformed = combo.map(p => {
        const v = new THREE.Vector3(...p.position).applyQuaternion(q).add(translation);
        const e = new THREE.Euler().setFromQuaternion(q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation))));
        return { ...p, position: v.toArray() as [number, number, number], rotation: [e.x, e.y, e.z] as [number, number, number] };
      });
      const external = ports(transformed).filter(cp => free.some(f => f.partId === cp.partId && f.cpId === cp.cpId));
      if (!required.every(cp => external.some(op => mates(cp, op)))) continue;
      if (bodyIntersects(transformed, rest)) continue;
      const connections = targets.filter(cp => external.some(op => mates(cp, op))).length;
      const slope = external.find(cp => Math.abs(cp.direction.y - Math.SQRT1_2) < 0.01);
      const inward = slope ? centroid.clone().sub(target.position).setY(0).normalize().dot(slope.direction.clone().setY(0).normalize()) : 0;
      const score = connections * 1000 + inward * 10 - anchor.position.distanceTo(target.position);
      if (!best || score > best.score) best = { parts: transformed, score };
    }
  }
  return best?.parts ?? null;
}

// Six-way connectors inherit the roof plane with a fixed roll about the rod axis.
export function endpointConnector(target: Port, part: PlacedPart): PlacedPart {
  const x = target.direction.clone().negate().normalize();
  let q = new THREE.Quaternion();
  let cpId = 'x+';
  if (Math.abs(x.y) > 0.999) {
    cpId = x.y > 0 ? 'y+' : 'y-';
  } else {
    const y = new THREE.Vector3(0, 1, 0).addScaledVector(x, -x.y).normalize();
    const z = x.clone().cross(y).normalize();
    q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  const cp = getPartById(part.partId)!.connectionPoints!.find(cp => cp.id === cpId)!;
  const v = target.position.clone().sub(new THREE.Vector3(...cp.position).applyQuaternion(q));
  const e = new THREE.Euler().setFromQuaternion(q);
  return { ...part, position: v.toArray() as [number, number, number], rotation: [e.x, e.y, e.z] };
}

// Absolute horizontal heading about the L socket axis, never the group's bounding-box center.
export function orientRoofCombo(combo: PlacedPart[], scene: PlacedPart[], heading: number): { parts?: PlacedPart[]; error?: string } {
  const elbow = combo.find(p => p.partId === 'connector-l');
  const angle = combo.find(p => p.partId === 'connector-45deg-nest');
  if (combo.length !== 2 || !elbow || !angle) return { error: '请选择完整的45°L嵌套组合。' };
  const down = ports([elbow]).find(cp => cp.cpId === 'y+')!;
  if (down.direction.y > -0.999) return { error: '组合的立杆接口未竖直向下，请先恢复组合姿态。' };
  const slope = ports([angle]).find(cp => cp.cpId === 'up45')!;
  const current = Math.atan2(slope.direction.z, slope.direction.x);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), current - heading);
  const transformed = combo.map(p => {
    const v = new THREE.Vector3(...p.position).sub(down.position).applyQuaternion(q).add(down.position);
    const e = new THREE.Euler().setFromQuaternion(q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation))));
    return { ...p, position: v.toArray() as [number, number, number], rotation: [e.x, e.y, e.z] as [number, number, number] };
  });
  const ids = new Set(combo.map(p => p.id));
  const rest = scene.filter(p => !ids.has(p.id));
  const before = ports(combo), after = ports(transformed);
  const external = ports(rest);
  if (external.some(cp => before.some(op => mates(cp, op)) && !after.some(op => mates(cp, op)))) {
    return { error: '斜接口已有连接，请先移开相连杆件，再调整组合方向。立杆连接会保留。' };
  }
  if (bodyIntersects(transformed, rest)) return { error: '这个方向会与现有构件穿插，请选择其他方向。' };
  return { parts: transformed };
}
