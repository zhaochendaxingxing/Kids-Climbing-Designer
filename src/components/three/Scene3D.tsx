'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { message, Popover } from 'antd';
import { FlipHorizontal2, RotateCw } from 'lucide-react';
import * as THREE from 'three';
import PartThumbnail from './PartThumbnail';
import { createPartMesh } from './partMesh';
import { mirrorPlatformTransform } from './platformMirror';
import { findRoofPanelFit, type RoofPanelFit } from './roofPanelFit';
import { findTrampolineFit } from './trampolineFit';
import { findSlideFit, placeAssemblyParts } from './slideFit';
import { findLadderJoin } from './ladderFit';
import { findBridgeFit } from './bridgeFit';
import { findMountedAccessoryFit, findTallRainbowFit } from './specialAccessoryFit';
import { fitRoofCombo, endpointConnector, bodyIntersects, orientRoofCombo, ports } from '@/lib/construction';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore, collectGroupPartIds, getTopGroupOf } from '@/store/useStore';
import { PlacedPart, PartDefinition, SceneGroup } from '@/types/parts';
import { PART_COLORS, CONNECTOR_COLORS, PARTS_LIBRARY, getPartById, getPartColor, COMBO_45L, PLATE_THICKNESS } from '@/data/parts';

type DesignerState = ReturnType<typeof useStore.getState>;

interface SceneContextMenu {
  x: number;
  y: number;
  ids: string[];
}

interface SceneRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  ground: THREE.Mesh;
  gridHelper: THREE.GridHelper;
  partsGroup: THREE.Group;
  gizmo: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
}

declare global {
  interface Window {
    __debugLog?: (message: string) => void;
    __sceneCtxMenu?: (payload: SceneContextMenu) => void;
  }
}

const AXIS_LENGTH = 40;
const SNAP_DIST = 10;

// 自动吸附距离阈值（cm）
const SNAP_CONNECT_DIST = 6;     // 连接吸附距离
const SNAP_ANGLE_DEG = 15;       // 方向允许偏差（度）
const SNAP_PLATFORM_DIST = 8;    // 平台吸附距离
const PLATFORM_SEATING_INSET = 0.2; // 同一层平台沿用生长放置的就位深度（cm）

// 计算旋转后的最低Y值，确保不穿地
function getRotatedBottomY(part: PlacedPart, def: PartDefinition, newRot: [number, number, number]): number {
  const { width, height, depth } = def.size;
  const corners = [
    [-width / 2, 0, -depth / 2],
    [width / 2, 0, -depth / 2],
    [-width / 2, 0, depth / 2],
    [width / 2, 0, depth / 2],
    [-width / 2, height, -depth / 2],
    [width / 2, height, -depth / 2],
    [-width / 2, height, depth / 2],
    [width / 2, height, depth / 2],
  ];
  const euler = new THREE.Euler(newRot[0], newRot[1], newRot[2]);
  const quat = new THREE.Quaternion().setFromEuler(euler);
  let minY = Infinity;
  for (const c of corners) {
    const v = new THREE.Vector3(c[0], c[1], c[2]).applyQuaternion(quat);
    minY = Math.min(minY, v.y);
  }
  return part.position[1] + minY;
}

// 计算向量在垂直于 axisDir 的平面上的角度（用于旋转拖拽）
function getAngleAroundAxis(toHit: THREE.Vector3, axisDir: THREE.Vector3): number {
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const perp1 = new THREE.Vector3();
  // 选一个与 axisDir 不平行轴做叉积得 perp1
  if (Math.abs(axisDir.dot(xAxis)) < 0.9) {
    perp1.crossVectors(axisDir, xAxis).normalize();
  } else {
    perp1.crossVectors(axisDir, yAxis).normalize();
  }
  const perp2 = new THREE.Vector3().crossVectors(axisDir, perp1).normalize();
  const proj = toHit.clone().sub(axisDir.clone().multiplyScalar(toHit.dot(axisDir)));
  return Math.atan2(proj.dot(perp2), proj.dot(perp1));
}

// 从当前选中状态解析出的所有可操作零件的 id（顶层组递归展开 + 独立零件）
function collectSelectionIds(groups: SceneGroup[], selectedIds: string[]): string[] {
  const set = new Set<string>();
  const seenGroups = new Set<string>();
  for (const id of selectedIds) {
    const top = getTopGroupOf(groups, id);
    if (top) {
      if (!seenGroups.has(top.id)) {
        collectGroupPartIds(groups, top.id).forEach((x) => set.add(x));
        seenGroups.add(top.id);
      }
    } else {
      set.add(id);
    }
  }
  return [...set];
}

// Alt 复制：若新物体与老物体重合，则自动弹开到旁边空闲位置（保持原物不动）
function findFreeSpawn(
  src: PlacedPart,
  def: PartDefinition | undefined,
  base: [number, number, number],
  st: DesignerState,
  excludeId = ''
): [number, number, number] {
  const w = (def ? def.size.width : 20) + 6;
  const d = (def ? def.size.depth : 20) + 6;
  const offsets: [number, number, number][] = [
    [w, 0, 0],
    [0, 0, d],
    [-w, 0, 0],
    [0, 0, -d],
    [w, 0, d],
    [-w, 0, d],
    [w, 0, -d],
    [-w, 0, -d],
    [w * 2, 0, 0],
    [0, 0, d * 2],
    [-w * 2, 0, 0],
    [0, 0, -d * 2],
    [w * 2, 0, d * 2],
    [-w * 2, 0, -d * 2],
  ];
  const collideAt = (pos: [number, number, number]): boolean => {
    const test: PlacedPart = { ...src, position: pos };
    // excludeId 传空串时包含全部物体做重叠检测；松开幽灵时传副本自身 id 以排除自身、但仍包含原物
    return st.checkCollision(test, excludeId);
  };
  if (!collideAt(base)) return base;
  for (const off of offsets) {
    const pos: [number, number, number] = [base[0] + off[0], base[1], base[2] + off[2]];
    if (!collideAt(pos)) return pos;
  }
  return base;
}

// 计算一组零件在 world 上的 AABB 中心（含旋转，用 8 角点包围盒）
function computePartCenter(parts: PlacedPart[]): THREE.Vector3 {
  const v = new THREE.Vector3();
  if (parts.length === 0) return v;
  const box = new THREE.Box3();
  box.makeEmpty();
  for (const p of parts) {
    const def = getPartById(p.partId);
    if (!def) continue;
    const hw = def.size.width / 2, hh = def.size.height / 2, hd = def.size.depth / 2;
    const corners = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd],
      [-hw, -hh, hd], [hw, -hh, hd], [-hw, hh, hd], [hw, hh, hd],
    ];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]));
    const pos = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
    for (const c of corners) {
      const corner = new THREE.Vector3(c[0], c[1], c[2]).applyQuaternion(q).add(pos);
      box.expandByPoint(corner);
    }
  }
  if (box.isEmpty()) return v;
  box.getCenter(v);
  return v;
}

// 计算一组零件在 world 上的 AABB（含旋转），用于成组蓝色线框包围盒
function getSelAABB(parts: PlacedPart[]): THREE.Box3 | null {
  if (parts.length === 0) return null;
  const box = new THREE.Box3();
  box.makeEmpty();
  for (const p of parts) {
    const def = getPartById(p.partId);
    if (!def) continue;
    const hw = def.size.width / 2, hh = def.size.height / 2, hd = def.size.depth / 2;
    const corners: [number, number, number][] = [
      [-hw, -hh, -hd], [hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd],
      [-hw, -hh, hd], [hw, -hh, hd], [-hw, hh, hd], [hw, hh, hd],
    ];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]));
    const pos = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
    for (const c of corners) {
      box.expandByPoint(new THREE.Vector3(c[0], c[1], c[2]).applyQuaternion(q).add(pos));
    }
  }
  if (box.isEmpty()) return null;
  return box;
}

// Alt 复制幽灵：被拖拽的原物体在与副本（或其他部件）仍有体积碰撞时显示红色半透明，脱离碰撞后变回实体
function updateGhostHighlight(st: DesignerState, ds: { ghostActive: boolean; dragPartId: string | null }) {
  if (!ds.ghostActive || !ds.dragPartId) return;
  const dragged = st.parts.find((p: PlacedPart) => p.id === ds.dragPartId);
  if (!dragged) {
    st.setGhostCopy(null);
    return;
  }
  // 检测被拖拽物体是否与场景中其他部件（含原位静止副本）体积碰撞
  const overlapping = st.checkCollision(dragged, dragged.id);
  st.setGhostCopy(overlapping ? dragged.id : null);
}

// 获取某个零件所有连接点的世界坐标和方向
interface WorldConnPoint {
  partId: string;
  cpId: string;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  type: 'male' | 'female';
}

function getWorldConnPoints(parts: PlacedPart[], excludeId?: string): WorldConnPoint[] {
  const result: WorldConnPoint[] = [];
  for (const p of parts) {
    if (excludeId && p.id === excludeId) continue;
    const def = getPartById(p.partId);
    if (!def || !def.connectionPoints) continue;
    const euler = new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]);
    const quat = new THREE.Quaternion().setFromEuler(euler);
    for (const cp of def.connectionPoints) {
      const localPos = new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2]);
      const localDir = new THREE.Vector3(cp.direction[0], cp.direction[1], cp.direction[2]).normalize();
      result.push({
        partId: p.id,
        cpId: cp.id,
        position: localPos.applyQuaternion(quat).add(new THREE.Vector3(p.position[0], p.position[1], p.position[2])),
        direction: localDir.applyQuaternion(quat),
        type: cp.type || 'male',
      });
    }
  }
  return result;
}

// 计算零件自身的连接点世界坐标
function getSelfWorldConnPoints(part: PlacedPart, def: PartDefinition): WorldConnPoint[] {
  const result: WorldConnPoint[] = [];
  if (!def.connectionPoints) return result;
  const euler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
  const quat = new THREE.Quaternion().setFromEuler(euler);
  for (const cp of def.connectionPoints) {
    const localPos = new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2]);
    const localDir = new THREE.Vector3(cp.direction[0], cp.direction[1], cp.direction[2]).normalize();
    result.push({
      partId: part.id,
      cpId: cp.id,
      position: localPos.applyQuaternion(quat).add(new THREE.Vector3(part.position[0], part.position[1], part.position[2])),
      direction: localDir.applyQuaternion(quat),
      type: cp.type || 'male',
    });
  }
  return result;
}

// 找到最佳连接吸附点（与 targetCP 配对的 opposite 类型点）
function findBestSnap(
  selfCPs: WorldConnPoint[],
  others: WorldConnPoint[],
  snapDist = SNAP_CONNECT_DIST,
  snapAngleDeg = SNAP_ANGLE_DEG
): { selfCp: WorldConnPoint; otherCp: WorldConnPoint; dist: number } | null {
  let best: { selfCp: WorldConnPoint; otherCp: WorldConnPoint; dist: number } | null = null;
  const snapAngleRad = (snapAngleDeg * Math.PI) / 180;

  for (const scp of selfCPs) {
    for (const ocp of others) {
      // 类型必须相反（male ↔ female）
      if (scp.type === ocp.type) continue;
      // 方向必须大致相反（面对面才能插上）
      const dot = scp.direction.dot(ocp.direction);
      if (dot > -Math.cos(snapAngleRad)) continue; // 方向夹角 > 180±15°
      const dist = scp.position.distanceTo(ocp.position);
      if (dist < snapDist) {
        if (!best || dist < best.dist) {
          best = { selfCp: scp, otherCp: ocp, dist };
        }
      }
    }
  }
  return best;
}

// Exclude ports already joined to another part; proximity alone is not occupancy.
function availablePorts(points: WorldConnPoint[], candidates = points) {
  return candidates.filter(port => !points.some(other =>
    other.partId !== port.partId && other.type !== port.type
    && port.position.distanceTo(other.position) < 0.15
    && port.direction.dot(other.direction) < -0.999,
  ));
}

function findPickedPortFit(ray: THREE.Ray, part: PlacedPart, def: PartDefinition, scene: PlacedPart[]) {
  const points = getWorldConnPoints(scene);
  const local = getSelfWorldConnPoints(part, def);
  const distance = (p: THREE.Vector3) => ray.distanceSqToPoint(p);
  const candidates = availablePorts(points, points.filter(port => distance(port.position) < 9 ** 2))
    .sort((a, b) => distance(a.position) - distance(b.position)
      + (a.position.distanceTo(ray.origin) - b.position.distanceTo(ray.origin)) * 0.06);
  for (const target of candidates) {
    const ports = local.filter(port => port.type !== target.type)
      .sort((a, b) => a.direction.dot(target.direction) - b.direction.dot(target.direction));
    for (const port of ports) {
      const pose = computeSnappedTransform(part, def, port, target);
      const candidate = { ...part, ...pose };
      const existing = scene.filter(other => new THREE.Vector3(...other.position).distanceToSquared(target.position) < 85 ** 2);
      if (bodyIntersects([candidate], existing) || bodyIntersects(existing, [candidate])) continue;
      if (def.barSpec && existing.some(other => {
        const otherDef = getPartById(other.partId);
        if (!otherDef?.barSpec) return false;
        const line = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...pose.rotation));
        const origin = new THREE.Vector3(...pose.position);
        const offset = new THREE.Vector3(...other.position).sub(origin);
        const along = offset.dot(line);
        return Math.abs(along) < def.barSpec!.length / 2 + otherDef.barSpec.length / 2 - 1
          && offset.addScaledVector(line, -along).lengthSq() < 3 ** 2;
      })) continue;
      return pose;
    }
  }
  return null;
}

function findDoubleClampFit(ray: THREE.Ray, scene: PlacedPart[]) {
  const rails = scene.flatMap(part => {
    const bar = getPartById(part.partId)?.barSpec;
    const center = new THREE.Vector3(...part.position);
    return bar && ray.distanceSqToPoint(center) < (bar.length / 2 + 10) ** 2
      ? [{ center, length: bar.length, axis: new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...part.rotation)) }] : [];
  });
  let best: { position: PlacedPart['position']; rotation: PlacedPart['rotation']; distance: number } | null = null;
  for (const [index, a] of rails.entries()) for (const b of rails.slice(index + 1)) {
    if (Math.abs(a.axis.dot(b.axis)) < 0.998) continue;
    const z = b.center.clone().sub(a.center);
    const shift = z.dot(a.axis);
    z.addScaledVector(a.axis, -shift);
    if (Math.abs(z.length() - 5.5) > 0.2) continue;
    const start = Math.max(-a.length / 2, shift - b.length / 2) + 2.5;
    const end = Math.min(a.length / 2, shift + b.length / 2) - 2.5;
    if (start >= end) continue;
    const origin = a.center.clone().addScaledVector(z, 0.5);
    const center = new THREE.Vector3();
    const distance = ray.distanceSqToSegment(origin.clone().addScaledVector(a.axis, start), origin.clone().addScaledVector(a.axis, end), undefined, center);
    if (distance > 7 ** 2 || (best && distance >= best.distance)) continue;
    if (scene.some(part => part.partId === 'connector-bazi' && center.distanceToSquared(new THREE.Vector3(...part.position)) < 5 ** 2)) continue;
    const y = z.normalize().cross(a.axis);
    best = { position: center.toArray(), rotation: basisEuler(a.axis, y, a.axis.clone().cross(y)), distance };
  }
  return best;
}

// 计算吸附后的零件位置和旋转
function computeSnappedTransform(
  part: PlacedPart,
  def: PartDefinition,
  selfCp: WorldConnPoint,
  targetCp: WorldConnPoint
): { position: [number, number, number]; rotation: [number, number, number] } {
  // 1. 旋转：让 selfCp.direction 与 -targetCp.direction 对齐
  const selfDir = selfCp.direction.clone().normalize();
  const targetDir = targetCp.direction.clone().negate().normalize(); // 相反方向

  const rotQuat = new THREE.Quaternion().setFromUnitVectors(selfDir, targetDir);

  // 应用到原旋转
  const origEuler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
  const origQuat = new THREE.Quaternion().setFromEuler(origEuler);
  const newQuat = rotQuat.multiply(origQuat);
  const newEuler = new THREE.Euler().setFromQuaternion(newQuat);

  // 2. 位置：让 selfCp 的位置对齐到 targetCp 位置
  // 先计算 selfCp 在新旋转下的偏移量
  const defCp = def.connectionPoints?.find((c) => c.id === selfCp.cpId);
  if (!defCp) {
    return { position: part.position, rotation: part.rotation };
  }
  const localOffset = new THREE.Vector3(defCp.position[0], defCp.position[1], defCp.position[2]);
  const rotatedOffset = localOffset.clone().applyQuaternion(newQuat);
  const newPos = new THREE.Vector3(
    targetCp.position.x - rotatedOffset.x,
    targetCp.position.y - rotatedOffset.y,
    targetCp.position.z - rotatedOffset.z
  );

  return {
    position: [newPos.x, newPos.y, newPos.z],
    rotation: [newEuler.x, newEuler.y, newEuler.z],
  };
}

// —— 端点扩展：在元件的空闲扩展连接端生成半透明「幽灵扩展元件」——
// 规则：
//  - 杆件（female 两端管口）空闲端 → 幽灵「立六通」连接件，用于继续向外走杆
//  - 连接件（male 套管）空闲嵌套端 → 幽灵杆件，用于向外拉杆
//  - 已经与实体元件建立连接的部位不生成幽灵
function computeExtensionGhosts(src: PlacedPart): PlacedPart[] {
  const def = getPartById(src.partId);
  if (!def || !def.connectionPoints) return [];
  if (def.category !== 'bar' && def.category !== 'connector') return [];
  const sourceSelf = getSelfWorldConnPoints(src, def);
  // 其余所有实体元件的连接点（用于判断某端是否已被占用）
  const others = getWorldConnPoints(useStore.getState().parts, src.id);
  const out: PlacedPart[] = [];
  for (const scp of sourceSelf) {
    // 若该端已与实体元件对接（可吸附到某个异性连接点），则不显示扩展
    if (findBestSnap([scp], others, 0.15, 2)) continue;
    const ghostPartId = def.category === 'bar' ? 'connector-v6' : 'bar-35';
    const gdef = getPartById(ghostPartId);
    if (!gdef) continue;
    const tempGhost: PlacedPart = {
      id: '__ext',
      partId: ghostPartId,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      colorId: gdef.defaultColor,
    };
    const gSelf = getSelfWorldConnPoints(tempGhost, gdef);
    // 幽灵接口匹配：选取一个“类型相反”的接口作为对接锚点即可。
    // 幽灵初值在世界原点，且 computeSnappedTransform 会整体旋转到与源端朝向相反，
    // 因此无需按初始方向近似相反过滤（否则非轴向朝外的连接件套口会匹配失败）。
    const anchor = gSelf.find((c) => c.type !== scp.type);
    if (!anchor) continue;
    const tr = computeSnappedTransform(tempGhost, gdef, anchor, scp);
    const ghost = def.category === 'bar'
      ? endpointConnector(scp, tempGhost)
      : { ...tempGhost, position: tr.position, rotation: tr.rotation };
    if (!bodyIntersects([ghost], useStore.getState().parts)) out.push(ghost);
  }
  return out;
}
function findPlatformSnap(
  part: PlacedPart,
  def: PartDefinition,
  allParts: PlacedPart[]
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (def.directPlacement === 'tall-rainbow-frame') {
    const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...part.rotation));
    const center = new THREE.Vector3(...part.position);
    const ray = new THREE.Ray(center.clone().addScaledVector(normal, 12), normal.clone().negate());
    const fit = findTallRainbowFit(ray, allParts.filter(other => other.id !== part.id), def);
    return fit && center.distanceTo(new THREE.Vector3(...fit.position)) < 12 ? fit : null;
  }
  if (def.category !== 'platform' || !def.platformSpec) return null;
  if (def.extKind === 'rainbow') {
    return findPanelFit(new THREE.Vector3(...part.position), allParts, { excludeId: part.id });
  }
  const spec = def.platformSpec;

  const partPos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);

  // 收集附近水平杆件（中心 + 世界轴向）。忽略 Y 距离，允许从不同高度吸附到框架层。
  // 注意使用三维距离而非仅 XZ，框架绕 Y 旋转任意角度后杆件中心仍可被正确纳入。
  interface BarInfo {
    id: string;
    center: THREE.Vector3;
    axis: THREE.Vector3;
    def: PartDefinition;
  }
  const reach = Math.max(spec.plateWidth, spec.plateDepth) / 2 + 30;
  const bars: BarInfo[] = [];
  for (const p of allParts) {
    if (p.id === part.id) continue;
    const pd = getPartById(p.partId);
    if (!pd || pd.category !== 'bar' || !pd.connectionPoints || pd.connectionPoints.length < 2) continue;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2])
    );
    const center = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
    const pts = pd.connectionPoints.map((cp) =>
      new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2]).applyQuaternion(q).add(center)
    );
    const axis = pts[1].clone().sub(pts[0]).normalize();
    // 只考虑水平杆件（顶面/底面封板）
    if (Math.abs(axis.y) > 0.3) continue;
    if (center.distanceTo(partPos) > reach) continue;
    bars.push({ id: p.id, center, axis, def: pd });
  }
  if (bars.length < 4) return null;

  const UP = new THREE.Vector3(0, 1, 0);
  const holder: {
    best: { position: [number, number, number]; rotation: [number, number, number]; gap: number } | null;
  } = { best: null };

  const consider = (center: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, lenU: number, lenV: number, barRadius: number) => {
    // 尺寸匹配（容差 5，允许宽深 swap）；收纳盒另有"落入内缘+翻边盖过中心"判定
    const isStorbox = def.extKind === 'storbox';
    let matchW = Math.abs(lenU - spec.plateWidth) < 5 && Math.abs(lenV - spec.plateDepth) < 5;
    const matchRotated = Math.abs(lenU - spec.plateDepth) < 5 && Math.abs(lenV - spec.plateWidth) < 5;
    if (isStorbox && !matchW && !matchRotated) {
      const flangeW = spec.plateWidth / 2 + (spec.flangeWidth || 0);
      const flangeD = spec.plateDepth / 2 + (spec.flangeWidth || 0);
      const bodyFits = spec.plateWidth / 2 <= lenU / 2 + barRadius && spec.plateDepth / 2 <= lenV / 2 + barRadius;
      const flangeCovers = flangeW >= lenU / 2 - 1 && flangeD >= lenV / 2 - 1;
      if (bodyFits && flangeCovers) matchW = true;
    }
    if (!matchW && !matchRotated) return;

    // 收纳盒：局部 Y 原点为盒底，翻边底位于 rimHeight，让翻边底面落在杆顶、盒体下沉到框架内；
    // 普通平台板和玻璃板共用生长放置时的高度基准。
    const flushPlatform = !def.extension || def.extKind === 'glass';
    let offset = spec.plateThickness / 2;
    if (isStorbox) offset = -spec.rimHeight + 0.15;
    if (flushPlatform) offset = PLATE_THICKNESS / 2 - PLATFORM_SEATING_INSET;
    const newY = center.y + barRadius + offset;

    // 水平距离（相对当前板位置）需足够近
    const hTarget = new THREE.Vector3(center.x, partPos.y, center.z);
    if (hTarget.distanceTo(partPos) > SNAP_PLATFORM_DIST + 12) return;

    // 旋转：宽 local+X / 厚 local+Y(上) / 深 local+Z，全部基于杆件实际方向，与世界轴无关
    const rotation: [number, number, number] = matchRotated
      ? basisEuler(v, UP, u)
      : basisEuler(u, UP, v);

    const gap = Math.abs(newY - partPos.y);
    if (!holder.best || gap < holder.best.gap) {
      holder.best = { position: [center.x, newY, center.z], rotation, gap };
    }
  };

  // 任取 4 根水平杆，3 种配对找"两对平行 + 互相垂直 + 同层共面 + 中点重合"
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      for (let k = j + 1; k < bars.length; k++) {
        for (let l = k + 1; l < bars.length; l++) {
          const q = [bars[i], bars[j], bars[k], bars[l]];
          const pairings: [number, number][][] = [
            [[0, 1], [2, 3]],
            [[0, 2], [1, 3]],
            [[0, 3], [1, 2]],
          ];
          for (const pr of pairings) {
            const a = q[pr[0][0]], b = q[pr[0][1]], c = q[pr[1][0]], d = q[pr[1][1]];
            if (Math.abs(a.axis.dot(b.axis)) < 0.94) continue;
            if (Math.abs(c.axis.dot(d.axis)) < 0.94) continue;
            const u = a.axis.clone(), v = c.axis.clone();
            if (Math.abs(u.dot(v)) > 0.18) continue;
            // 同层（Y 接近）
            if ([b, c, d].some((g) => Math.abs(g.center.y - a.center.y) > 3)) continue;
            // 中点重合（闭合矩形）
            const midU = a.center.clone().add(b.center).multiplyScalar(0.5);
            const midV = c.center.clone().add(d.center).multiplyScalar(0.5);
            if (midU.distanceTo(midV) > 6) continue;
            const lenV = a.center.clone().sub(b.center).projectOnVector(v).length();
            const lenU = c.center.clone().sub(d.center).projectOnVector(u).length();
            if (lenU < 10 || lenV < 10) continue;
            const center = a.center.clone().add(b.center).add(c.center).add(d.center).multiplyScalar(0.25);
            const barRadius = q.reduce((s, g) => s + g.def.size.height, 0) / 8;
            consider(center, u, v, lenU, lenV, barRadius);
          }
        }
      }
    }
  }

  return holder.best ? { position: holder.best.position, rotation: holder.best.rotation } : null;
}

// 把一组右手正交基向量换算为 euler（模块级工具）
function basisEuler(
  xv: THREE.Vector3,
  yv: THREE.Vector3,
  zv: THREE.Vector3
): [number, number, number] {
  const X = xv.clone().normalize();
  const Y = yv.clone().normalize();
  const Z = zv.clone().normalize();
  // 施密特正交化（以 x、y 为基准）
  try {
    Z.sub(X.clone().multiplyScalar(X.dot(Z)));
    Z.sub(Y.clone().multiplyScalar(Y.dot(Z)));
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).sub(X.clone().multiplyScalar(X.z)).sub(Y.clone().multiplyScalar(Y.z)).normalize();
    Y.sub(X.clone().multiplyScalar(X.dot(Y)));
    if (Y.lengthSq() < 1e-8) Y.crossVectors(Z, X).negate();
  } catch {
    /* 保持默认 */
  }
  Z.normalize();
  Y.normalize();
  // 保证右手系
  const c = new THREE.Vector3().crossVectors(X, Y);
  if (c.dot(Z) < 0) Z.negate();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

// 沿鼠标射线识别四杆围成的实际矩形面，供生长铺板、配件库吸附和彩虹门使用。
function findPanelFit(
  cursor: { x: number; y: number; z: number },
  allParts: PlacedPart[],
  rainbow?: { excludeId?: string; ray?: THREE.Ray },
  rectangular?: { def?: PartDefinition; ray: THREE.Ray; maxDistance?: number }
): {
  partId: string;
  position: [number, number, number];
  rotation: [number, number, number];
} | null {
  const platforms = PARTS_LIBRARY.filter((p) => p.category === 'platform' && p.platformSpec && !p.extension);
  if (platforms.length === 0) return null;

  const cursorV = new THREE.Vector3(cursor.x, cursor.y, cursor.z);
  const UP = new THREE.Vector3(0, 1, 0);

  interface PanelFit {
    partId: string;
    position: [number, number, number];
    rotation: [number, number, number];
    dist: number;
  }
  // 收集杆件信息（中心 + 世界轴向）。
  interface BarInfo {
    id: string;
    center: THREE.Vector3;
    axis: THREE.Vector3;
    def: PartDefinition;
  }
  const bars: BarInfo[] = [];
  for (const part of allParts) {
    const def = getPartById(part.partId);
    if (!def || def.category !== 'bar' || !def.connectionPoints || def.connectionPoints.length < 2) continue;
    const euler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const center = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
    const pts = def.connectionPoints.map((cp) =>
      new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2]).applyQuaternion(quat).add(center)
    );
    const axis = pts[1].clone().sub(pts[0]).normalize();
    bars.push({ id: part.id, center, axis, def });
  }

  // 只取光标附近最近的一批杆件（控制 C(n,4) 枚举量；框架旋转任意角度均不受影响）
  const pointerRay = rectangular?.ray ?? rainbow?.ray;
  const distanceToPointer = (point: THREE.Vector3) => pointerRay
    ? pointerRay.distanceSqToPoint(point)
    : point.distanceToSquared(cursorV);
  const nearBars = bars
    .filter((b) => distanceToPointer(b.center) < 75 ** 2)
    .sort((a, b) => distanceToPointer(a.center) - distanceToPointer(b.center))
    .slice(0, rectangular ? 20 : 16);
  if (nearBars.length < 4) return null;

  const holder: { best: PanelFit | null } = { best: null };
  const consider = (candidate: PanelFit | null) => {
    if (!candidate) return;
    if (!holder.best || candidate.dist < holder.best.dist) holder.best = candidate;
  };

  // 按框格边长自动选规格，允许宽深互换。
  const matchPlatform = (w: number, d: number): PartDefinition | null => {
    let chosen: PartDefinition | null = null;
    let bestDiff = Infinity;
    for (const pl of platforms) {
      const sp = pl.platformSpec!;
      const diff1 = Math.abs(w - sp.plateWidth) + Math.abs(d - sp.plateDepth);
      const diff2 = Math.abs(w - sp.plateDepth) + Math.abs(d - sp.plateWidth);
      const m = Math.min(diff1, diff2);
      const direct = Math.abs(w - sp.plateWidth) < 3 && Math.abs(d - sp.plateDepth) < 3;
      const rotated = Math.abs(w - sp.plateDepth) < 3 && Math.abs(d - sp.plateWidth) < 3;
      if ((direct || rotated) && m < bestDiff) {
        bestDiff = m;
        chosen = pl;
      }
    }
    return chosen;
  };

  // 该位置是否已有平台
  const hasPlatformAt = (x: number, y: number, z: number) =>
    allParts.some((p) => {
      const pd = getPartById(p.partId);
      return p.id !== rainbow?.excludeId && pd && pd.category === 'platform' && Math.abs(p.position[0] - x) < 2 && Math.abs(p.position[1] - y) < 2 && Math.abs(p.position[2] - z) < 2;
    });

  // 通用矩形枚举：任取 4 根杆，3 种配对找"两对平行 + 两对垂直 + 4 杆共面 + 中点重合"。
  // 全程只使用杆件实际世界方向，不假设世界 X/Y/Z 轴，故框架绕 Y 旋转任意角度都能识别。
  const considerFour = (q: BarInfo[]) => {
    const pairings: [number, number][][] = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];
    for (const pr of pairings) {
      const a = q[pr[0][0]], b = q[pr[0][1]], c = q[pr[1][0]], d = q[pr[1][1]];
      // 两对分别平行
      const uAxis = a.axis;
      if (Math.abs(uAxis.dot(b.axis)) < 0.94) continue;
      const vAxis = c.axis;
      if (Math.abs(vAxis.dot(d.axis)) < 0.94) continue;
      // 两对互相垂直
      if (Math.abs(uAxis.dot(vAxis)) > 0.18) continue;

      const u = uAxis.clone(), v = vAxis.clone();
      // 统一方向符号（中点/法线计算不受符号影响，但保证右手系稳定）
      const n = new THREE.Vector3().crossVectors(u, v).normalize();
      if (n.lengthSq() < 1e-8) continue;

      // 4 杆共面：各中心到公共平面（过 a.center，法向 n）距离 < 4
      const onPlane = [a, b, c, d].every((g) => Math.abs((g.center.clone().sub(a.center)).dot(n)) < 4);
      if (!onPlane) continue;

      // 闭合：两对对边的中点应重合（平行四边形），配合已验证的垂直即矩形
      const midU = a.center.clone().add(b.center).multiplyScalar(0.5);
      const midV = c.center.clone().add(d.center).multiplyScalar(0.5);
      if (midU.distanceTo(midV) > 6) continue;

      // 边长：pair(a,b) 沿 u，二者中心沿 v 的间距 = v 向边长；pair(c,d) 沿 v，中心沿 u 间距 = u 向边长
      const lenAlongV = a.center.clone().sub(b.center).projectOnVector(v).length();
      const lenAlongU = c.center.clone().sub(d.center).projectOnVector(u).length();
      const center = a.center.clone().add(b.center).add(c.center).add(d.center).multiplyScalar(0.25);

      if (rectangular) {
        const { ray, maxDistance = Infinity } = rectangular;
        const upright = Math.abs(n.y) < 0.2;
        const horizontal = Math.abs(n.y) > 0.98;
        if (upright && Math.abs(u.y) > Math.abs(v.y)) {
          u.copy(vAxis);
          v.copy(uAxis);
        }
        const swapAxes = upright && Math.abs(uAxis.y) > Math.abs(vAxis.y);
        const width = swapAxes ? lenAlongV : lenAlongU;
        const depth = swapAxes ? lenAlongU : lenAlongV;
        // The frame must have supporting rails along its full four sides.
        const lengthsMatch = (bars: [BarInfo, BarInfo], length: number) =>
          bars.every(bar => Math.abs((bar.def.barSpec?.length ?? 0) + 5 - length) < 3);
        if (!lengthsMatch([a, b], lenAlongU) || !lengthsMatch([c, d], lenAlongV)) continue;
        const def = rectangular.def ?? matchPlatform(width, depth);
        const spec = def?.platformSpec;
        if (!def || !spec || ((def.extKind === 'storbox' || def.extKind === 'pouch') && !horizontal)) continue;
        const expectedW = def.extKind === 'storbox' ? 40 : spec.plateWidth;
        const expectedD = def.extKind === 'storbox' ? 40 : spec.plateDepth;
        const matches = (w: number, d: number) => Math.abs(width - w) < 3 && Math.abs(depth - d) < 3;
        if (!matches(expectedW, expectedD) && !matches(expectedD, expectedW)) continue;
        const swap = !matches(expectedW, expectedD);

        if (upright) {
          if (Math.abs(u.y) > 0.2 || Math.abs(v.y) < 0.95) continue;
          if (v.y < 0) v.negate();
          n.crossVectors(u, v).normalize();
          if (ray.origin.clone().sub(center).dot(n) < 0) n.negate();
        } else if (n.y < 0) n.negate();
        const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, center), new THREE.Vector3());
        const distance = hit?.distanceTo(ray.origin);
        if (!hit || distance === undefined || distance > maxDistance) continue;
        const offset = hit.clone().sub(center);
        if (Math.abs(offset.dot(u)) > width / 2 + 0.8 || Math.abs(offset.dot(v)) > depth / 2 + 0.8) continue;
        if (allParts.some(part => {
          if (getPartById(part.partId)?.category !== 'platform') return false;
          const delta = new THREE.Vector3(...part.position).sub(center);
          const onPlane = delta.dot(n);
          return Math.abs(onPlane) < 8 && delta.addScaledVector(n, -onPlane).lengthSq() < 4 ** 2;
        })) continue;
        const radius = q.reduce((sum, bar) => sum + (bar.def.barSpec?.outerDiameter ?? 4.4), 0) / 8;
        const seat = def.extKind === 'storbox' ? radius - spec.rimHeight + 0.15
          : radius + PLATE_THICKNESS / 2 - PLATFORM_SEATING_INSET;
        if (upright && !swap && u.clone().cross(n).dot(v) < 0) u.negate();
        const rotation = swap ? basisEuler(v, n, u) : basisEuler(u, n, v);
        consider({ partId: def.id, position: center.addScaledVector(n, upright ? 0 : seat).toArray(), rotation, dist: distance });
        continue;
      }

      // 彩虹门仅匹配竖向 40 × 40 cm 框格。
      if (!rainbow || Math.abs(n.y) >= 0.4) continue;
      const uHorizontal = Math.abs(u.y) < 0.3;
      if (uHorizontal === (Math.abs(v.y) < 0.3)) continue;
      const hAxis = uHorizontal ? u : v;
      const width = uHorizontal ? lenAlongU : lenAlongV;
      const height = uHorizontal ? lenAlongV : lenAlongU;
      const spec = getPartById('ext-plate-rainbow')!.platformSpec!;
      if (Math.abs(width - spec.plateWidth) > 1.5 || Math.abs(height - spec.plateDepth) > 1.5) continue;
      if (hasPlatformAt(center.x, center.y, center.z)) continue;
      let dist = center.distanceTo(cursorV);
      if (rainbow.ray) {
        const hit = rainbow.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, center), new THREE.Vector3());
        if (!hit) continue;
        const offset = hit.clone().sub(center);
        if (Math.abs(offset.dot(hAxis)) > width / 2 + 1 || Math.abs(offset.y) > height / 2 + 1) continue;
        dist = hit.distanceTo(rainbow.ray.origin);
      } else if (dist > 32) continue;
      const facing = new THREE.Vector3().crossVectors(UP, hAxis).normalize();
      consider({ partId: 'ext-plate-rainbow', position: center.toArray(), rotation: basisEuler(hAxis, facing, UP), dist });
    }
  };

  for (let i = 0; i < nearBars.length; i++)
    for (let j = i + 1; j < nearBars.length; j++)
      for (let k = j + 1; k < nearBars.length; k++)
        for (let l = k + 1; l < nearBars.length; l++) {
          considerFour([nearBars[i], nearBars[j], nearBars[k], nearBars[l]]);
        }

  return holder.best ? { partId: holder.best.partId, position: holder.best.position, rotation: holder.best.rotation } : null;
}

function createGizmo(): THREE.Group {
  const gizmo = new THREE.Group();
  gizmo.visible = false;

  const axisData = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xFF4444 },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x44FF44 },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x4444FF },
  ];

  axisData.forEach(({ dir, color }) => {
    // 箭头锥体
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(4, 12, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
    );
    cone.position.copy(dir.clone().multiplyScalar(AXIS_LENGTH));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.userData.isAxis = true;
    cone.userData.axisDir = dir.clone();
    gizmo.add(cone);

    // 轴杆
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, AXIS_LENGTH, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
    );
    cyl.position.copy(dir.clone().multiplyScalar(AXIS_LENGTH / 2));
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cyl.userData.isAxis = true;
    cyl.userData.axisDir = dir.clone();
    gizmo.add(cyl);
  });

  // 平面控制柄
  const planeData = [
    { normal: new THREE.Vector3(0, 0, 1), color: 0xFFFF44, pos: new THREE.Vector3(15, 15, 0) },
    { normal: new THREE.Vector3(0, 1, 0), color: 0xFF44FF, pos: new THREE.Vector3(15, 0, 15) },
    { normal: new THREE.Vector3(1, 0, 0), color: 0x44FFFF, pos: new THREE.Vector3(0, 15, 15) },
  ];

  planeData.forEach(({ normal, color, pos }) => {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
    );
    plane.position.copy(pos);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    plane.userData.isPlane = true;
    plane.userData.planeNormal = normal.clone();
    plane.userData.planePos = pos.clone();
    gizmo.add(plane);
  });

  // 弧线旋转控件（XY, XZ, YZ平面上的45°旋转弧）
  const arcPlanes = [
    { axis: 'z', color: 0xFFFF88, normal: new THREE.Vector3(0, 0, 1) },
    { axis: 'y', color: 0xFF88FF, normal: new THREE.Vector3(0, 1, 0) },
    { axis: 'x', color: 0x88FFFF, normal: new THREE.Vector3(1, 0, 0) },
  ];

  arcPlanes.forEach(({ axis, color, normal }) => {
    // 生成半圆弧
    const segments = 16;
    const radius = 28;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      points.push(new THREE.Vector3(x, y, 0));
    }

    // 使用细管状几何体让弧线可点击
    const tubePoints = points.map(p => p.clone());
    const curve = new THREE.CatmullRomCurve3(tubePoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 16, 2, 4, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    // 旋转到对应平面
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    tube.userData.isArc = true;
    tube.userData.arcAxis = axis;
    gizmo.add(tube);
  });

  return gizmo;
}

// 旋转视角模式的鼠标光标（旋转箭头图标）
const ROTATE_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='#4A90D9' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 11a8 8 0 1 0-2.34 5.66'/><path d='M20 4v7h-7'/></svg>`;
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(ROTATE_CURSOR_SVG)}") 12 12, grab`;

export default function Scene3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRuntime | null>(null);
  const gizmoRef = useRef<THREE.Group | null>(null);
  const selectedMarkerRef = useRef<THREE.Mesh | null>(null);
  const selBoxRef = useRef<THREE.LineSegments | null>(null);
  const selFillRef = useRef<THREE.Mesh | null>(null);
  const partsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const ghostGroupRef = useRef<THREE.Group | null>(null);
  // 端点扩展幽灵：空闲扩展连接端显示的半透明待部署元件
  const extGhostGroupRef = useRef<THREE.Group | null>(null);
  const platGhostGroupRef = useRef<THREE.Group | null>(null);
  const platGhostDataRef = useRef<RoofPanelFit | null>(null);
  const extGhostDataRef = useRef<{ partId: string; position: [number, number, number]; rotation: [number, number, number]; group: THREE.Group }[]>([]);
  const [extCount, setExtCount] = useState(0);
  const selectionRectRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const dragState = useRef({ isDown: false, isDragging: false, startX: 0, startY: 0, dragPartId: null as string | null, axisDir: null as THREE.Vector3 | null, planeNormal: null as THREE.Vector3 | null, planePos: null as THREE.Vector3 | null, isArc: false, startQuat: null as THREE.Quaternion | null, startAngle: 0, initialPos: null as [number, number, number] | null, initialT: 0, snapped: false, isSelecting: false, selOrigin: null as { x: number; y: number } | null, historyPushed: false, altCopy: false, groupSnap: null as { id: string; position: [number, number, number]; rotation: [number, number, number] }[] | null, groupAnchor: null as { x: number; y: number; z: number } | null, groupAxis: null as THREE.Vector3 | null, ghostActive: false, ghostSrcId: null as string | null, anchorCopyId: null as string | null, rigidSnap: null as { driverId: string; driverStart: [number, number, number]; members: { id: string; start: [number, number, number] }[] } | null });
  // 分组操作：当前选中的几何中心（供整组转动/移动）
  const groupCenterRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  // 操作轴旁边的"组信息"标签：用于展示/重命名组、快捷取消成组
  const groups = useStore((s) => s.groups);
  const parts = useStore((s) => s.parts);
  const draggingPart = useStore((state) => state.draggingPart);
  const ghostCopyId = useStore((state) => state.ghostCopyId);
  const ghostPosition = useStore((state) => state.ghostPosition);
  const gizmoMode = useStore((state) => state.gizmoMode);
  const hoveredPartId = useStore((state) => state.hoveredPartId);
  const navMode = useStore((state) => state.navMode);
  const paintColor = useStore((state) => state.paintColor);
  const pendingPreset = useStore((state) => state.pendingPreset);
  const releaseTick = useStore((state) => state.releaseTick);
  const selectedIds = useStore((state) => state.selectedIds);
  const selectedPartId = useStore((state) => state.selectedPartId);
  const workflow = useStore((state) => state.workflow);
  // 当前选中的顶层单元全部落在同一个成组内（成组物体不显示扩展幽灵，给出解组提示）
  const selGroupedHint = useStore((s) => {
    if (s.selectedIds.length === 0) return false;
    let grp: SceneGroup | undefined;
    for (const id of s.selectedIds) {
      const t = getTopGroupOf(s.groups, id);
      if (!t) return false; // 混入了未成组零件，交给扩展幽灵逻辑处理
      if (grp === undefined) grp = t;
      else if (grp.id !== t.id) return false; // 跨多个组，不提示
    }
    return grp !== undefined;
  });
  const [tagGroupId, setTagGroupId] = useState<string | null>(null);
  const [snapFeedback, setSnapFeedback] = useState(false);
  const [viewportState, setViewportState] = useState<'ready' | 'recovering' | 'failed'>('ready');
  const retryViewportRef = useRef<(() => void) | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const groupTagElRef = useRef<HTMLDivElement | null>(null);
  const rotateControl = useRef<{ element: HTMLButtonElement; anchor: THREE.Vector3 } | null>(null);

  // 提交组重命名
  const commitRename = () => {
    if (editingGroupId) useStore.getState().renameGroup(editingGroupId, nameDraft);
    setEditingGroupId(null);
  };
  // 标签上的"取消成组"快捷按钮
  const ungroupGroupByTag = () => {
    const st = useStore.getState();
    if (tagGroupId) st.ungroupGroup(tagGroupId);
    st.setSelection([], null);
    setTagGroupId(null);
    setEditingGroupId(null);
  };

  // 暴露给 3D 事件回调的右键菜单入口
  useEffect(() => {
    window.__sceneCtxMenu = (payload: { x: number; y: number; ids: string[] }) => {
      setCtxMenu({ x: payload.x, y: payload.y, ids: [...payload.ids] });
    };
    return () => { window.__sceneCtxMenu = undefined; };
  }, []);

  // 初始化场景
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF0F4F6);

    const camera = new THREE.PerspectiveCamera(45, Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 1, 5000);
    camera.position.set(150, 120, 150);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let contextLost = false;
    const controls = new OrbitControls(camera);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 30;
    controls.maxDistance = 2500;
    // 左键留给场景交互（选中/拖拽/放置），右键负责视角转动，中键缩放
    controls.mouseButtons.LEFT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = null;

    // 灯光
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xfff8ed, 1.8);
    dirLight.position.set(100, 150, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.left = -180;
    dirLight.shadow.camera.right = 180;
    dirLight.shadow.camera.top = 180;
    dirLight.shadow.camera.bottom = -180;
    dirLight.shadow.bias = -0.0004;
    dirLight.shadow.normalBias = 0.4;
    scene.add(dirLight);
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbdc6cd, 0.85);
    scene.add(hemiLight);

    // 地面
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xF0F4F6,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // 网格
    const gridHelper = new THREE.GridHelper(400, 40, 0xcbd5df, 0xdce3e8);
    const gridMaterial = gridHelper.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.5;
    gridHelper.position.y = 0.1;
    scene.add(gridHelper);

    // 选中标记
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(6, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x4A90D9, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    marker.rotation.x = -Math.PI / 2;
    marker.visible = false;
    scene.add(marker);
    selectedMarkerRef.current = marker;

    // 成组/多选时的蓝色线框包围盒
    const selBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: 0x38A8FF,
        transparent: true,
        opacity: 1,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    selBox.visible = false;
    scene.add(selBox);
    selBoxRef.current = selBox;

    // 选择填充面（辅助加粗显示）
    const selFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x38a8ff,
        transparent: true,
        opacity: 0.18,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    selFill.visible = false;
    scene.add(selFill);
    selFillRef.current = selFill;

    // 操作轴
    const gizmo = createGizmo();
    scene.add(gizmo);
    gizmoRef.current = gizmo;

    // 部件组
    const partsGroup = partsGroupRef.current;
    scene.add(partsGroup);

    // 保存ref
    sceneRef.current = { scene, camera, controls, ground, gridHelper, partsGroup, gizmo,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
    };

    // 动画循环
    let rafId = 0;
    const rotationScreen = new THREE.Vector3();
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (!renderer || contextLost || container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        controls.update();
        if (!camera.position.toArray().every(Number.isFinite) || !controls.target.toArray().every(Number.isFinite)) {
          resetCamera();
        }
        renderer.render(scene, camera);
      } catch (error) {
        console.error('3D viewport render failed', error);
        contextLost = true;
        setViewportState('failed');
        return;
      }
      const rotation = rotateControl.current;
      if (rotation) {
        const point = rotationScreen.copy(rotation.anchor).project(camera);
        const visible = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1;
        rotation.element.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) {
          const width = container.clientWidth;
          const height = container.clientHeight;
          const x = (point.x + 1) * width / 2;
          const y = (1 - point.y) * height / 2;
          const buttonWidth = rotation.element.offsetWidth;
          const left = x + 18 + buttonWidth <= width - 8 ? x + 18 : Math.max(8, x - buttonWidth - 18);
          const top = THREE.MathUtils.clamp(y - 18, 8, Math.max(8, height - 46));
          rotation.element.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
        }
      }
      // 让"组信息"标签跟随操作轴中心贴齐到屏幕
      const tagEl = groupTagElRef.current;
      if (tagEl) {
        const gc = groupCenterRef.current;
        const v3 = new THREE.Vector3(gc.x, gc.y, gc.z).project(camera);
        const w = container.clientWidth;
        const h = container.clientHeight;
        const x = (v3.x * 0.5 + 0.5) * w;
        const y = (-v3.y * 0.5 + 0.5) * h;
        tagEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, calc(-100% - 58px))`;
      }
    };

    // 窗口resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (renderer && !contextLost) renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // —— 顶部菜单触发的视角操作事件：重置 / 平移 / 旋转 ——
    function resetCamera() {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.reset();
      const bounds = new THREE.Box3().setFromObject(partsGroup);
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
        camera.position.set(150, 120, 150);
        controls.target.set(0, 0, 0);
      } else {
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        const verticalAngle = THREE.MathUtils.degToRad(camera.fov);
        const horizontalAngle = 2 * Math.atan(Math.tan(verticalAngle / 2) * camera.aspect);
        const distance = Math.max(40, sphere.radius / Math.sin(Math.min(verticalAngle, horizontalAngle) / 2) * 1.08);
        controls.target.copy(sphere.center);
        camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
      }
      controls.update();
      controls.enableDamping = damping;
    }
    function onContextLost(event: Event) {
      event.preventDefault();
      contextLost = true;
      setViewportState('recovering');
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(rebuildRenderer, 2500);
    }
    function onContextRestored() {
      clearTimeout(recoveryTimer);
      contextLost = false;
      onResize();
      setViewportState('ready');
    }
    function releaseRenderer() {
      if (!renderer) return;
      const canvas = renderer.domElement;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (controls.domElement === canvas) controls.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      renderer = null;
    }
    function rebuildRenderer() {
      clearTimeout(recoveryTimer);
      releaseRenderer();
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        const canvas = renderer.domElement;
        canvas.addEventListener('webglcontextlost', onContextLost);
        canvas.addEventListener('webglcontextrestored', onContextRestored);
        container!.appendChild(canvas);
        controls.connect(canvas);
        contextLost = false;
        onResize();
        setViewportState('ready');
      } catch (error) {
        console.error('Could not initialize the 3D viewport', error);
        releaseRenderer();
        setViewportState('failed');
      }
    }
    retryViewportRef.current = rebuildRenderer;
    rebuildRenderer();
    animate();
    const onCameraReset = () => {
      resetCamera();
      if (!renderer || contextLost) rebuildRenderer();
    };
    const onCameraPan = () => {
      // 沿观察方向的水平横向平移视角（保持俯仰，整体平视移动）
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const forward = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const step = right.multiplyScalar(25);
      camera.position.add(step);
      controls.target.add(step);
      controls.update();
    };
    const onCameraRotate = () => {
      // 绕目标点水平旋转视角（每次旋转 30°）
      const offset = camera.position.clone().sub(controls.target);
      const dist = offset.length();
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += Math.PI / 6;
      offset.setFromSpherical(spherical).setLength(dist);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
    };
    window.addEventListener('gizmo-reset-camera', onCameraReset);
    window.addEventListener('gizmo-pan-camera', onCameraPan);
    window.addEventListener('gizmo-rotate-camera', onCameraRotate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      window.removeEventListener('gizmo-reset-camera', onCameraReset);
      window.removeEventListener('gizmo-pan-camera', onCameraPan);
      window.removeEventListener('gizmo-rotate-camera', onCameraRotate);
      clearTimeout(recoveryTimer);
      retryViewportRef.current = null;
      releaseRenderer();
      disposeGroup(scene);
      partsGroup.clear();
      sceneRef.current = null;
    };
  }, []);

  // 渲染部件
  useEffect(() => {
    const ref = sceneRef.current;
    if (!ref) return;
    const partsGroup = ref.partsGroup;
    const existing = new Map(partsGroup.children.map(child => [child.userData.partId, child]));
    const parts = useStore.getState().parts;
    const selectedIds = useStore.getState().selectedIds;
    const hoveredId = useStore.getState().hoveredPartId;
    const ghostCopyId = useStore.getState().ghostCopyId;
    parts.forEach((part: PlacedPart) => {
      const def = getPartById(part.partId);
      if (!def) return;
      const color = getPartColor(def, part.colorId || def.defaultColor)?.hex ?? '#CCCCCC';
      // 多选高亮描边：选中=天空蓝，悬停=浅蓝
      const isSel = selectedIds.includes(part.id);
      const isHover = part.id === hoveredId;
      const outlineColor = isSel ? '#4A90D9' : isHover ? '#8FBDE8' : undefined;
      // Alt 复制中且与原物重合 → 红色半透明幽灵
      const isGhost = part.id === ghostCopyId;
      const previous = existing.get(part.id);
      existing.delete(part.id);
      if (previous?.userData.sourcePart === part && previous.userData.outlineColor === outlineColor
        && previous.userData.ghostCopy === isGhost) return;
      const group = createPartMesh(part, def, isGhost ? '#EE5A5A' : color, isGhost ? 0.45 : 1, outlineColor);
      // 选中用更亮描边线宽增强
      group.userData.partId = part.id;
      group.userData.sourcePart = part;
      group.userData.outlineColor = outlineColor;
      group.userData.ghostCopy = isGhost;
      if (previous) {
        partsGroup.remove(previous);
        disposeGroup(previous);
      }
      partsGroup.add(group);
    });
    for (const child of existing.values()) {
      partsGroup.remove(child);
      disposeGroup(child);
    }
  }, [parts, selectedIds, hoveredPartId, ghostCopyId]);

  // 幽灵预览（点击配件库后，在场景中显示半透明预览）
  useEffect(() => {
    const draggingPart = useStore.getState().draggingPart;
    const preset = useStore.getState().pendingPreset;
    const ref = sceneRef.current;

    // 清理旧 ghost
    if (ghostGroupRef.current) {
      if (ref) ref.scene.remove(ghostGroupRef.current);
      disposeGroup(ghostGroupRef.current);
      ghostGroupRef.current = null;
    }

    const ghostPos = useStore.getState().ghostPosition || [0, 10, 0];

    // 预置模块幽灵：多部件 + 成组整体预览
    if (preset && ref) {
      const outer = new THREE.Group();
      for (const pi of preset.parts) {
        const pdef = getPartById(pi.partId);
        if (!pdef) continue;
        const color = getPartColor(pdef, pi.colorId)?.hex ?? '#CCCCCC';
        const mesh = createPartMesh(pi, pdef, color, 0.4);
        mesh.userData.isGhost = true;
        mesh.userData.presetPartId = pi.id;
        if (pi.partId === 'connector-slide-strap') mesh.userData.strapSide = Math.sign(pi.position[0]);
        outer.add(mesh);
      }
      outer.position.set(ghostPos[0], ghostPos[1], ghostPos[2]);
      outer.userData.isGhostGroup = true;
      if (preset.directPlacement) outer.visible = false;
      ref.scene.add(outer);
      ghostGroupRef.current = outer;
      return;
    }

    if (!draggingPart || !ref) return;
    const def = getPartById(draggingPart.partId);
    if (!def) return;

    const color = getPartColor(def, draggingPart.colorId)?.hex ?? '#CCCCCC';
    const ghostPart: PlacedPart = {
      id: 'ghost-preview',
      partId: def.id,
      position: [ghostPos[0], ghostPos[1], ghostPos[2]],
      rotation: [0, 0, 0],
      colorId: draggingPart.colorId,
    };
    const ghost = createPartMesh(ghostPart, def, color, 0.4);
    ghost.visible = false;
    ghost.userData.isGhost = true;
    ref.scene.add(ghost);
    ghostGroupRef.current = ghost;
  }, [draggingPart, pendingPreset]);

  // 幽灵预览位置跟随
  useEffect(() => {
    const ghostPos = useStore.getState().ghostPosition;
    if (ghostGroupRef.current && ghostPos) {
      ghostGroupRef.current.position.set(ghostPos[0], ghostPos[1], ghostPos[2]);
    }
  }, [ghostPosition]);

  // 平台板幽灵：生长模式下，光标附近存在可落平台的矩形杆框架时在其顶面显示半透明平台板
  const clearPlatformGhost = useCallback(() => {
    const sc = sceneRef.current?.scene;
    if (platGhostGroupRef.current) {
      if (sc) sc.remove(platGhostGroupRef.current);
      disposeGroup(platGhostGroupRef.current);
      platGhostGroupRef.current = null;
    }
    platGhostDataRef.current = null;
  }, []);
  const updatePlatformGhost = useCallback((ray: THREE.Ray, solidHit?: THREE.Intersection, groundHit?: THREE.Intersection) => {
    const st = useStore.getState();
    const sc = sceneRef.current?.scene;
    if (!sc) return;
    if (
      st.gizmoMode !== 'growth' ||
      st.draggingPart ||
      st.pendingPreset ||
      st.paintColor ||
      dragState.current.isDragging
    ) {
      clearPlatformGhost();
      return;
    }
    // 平台板封面 Auto-ghost 仅在“增加配件”(accessory)阶段生效；
    // spec(生成框架)与 frame(增加框架)阶段都不显示平台板 ghost
    if (st.workflow !== 'accessory') {
      clearPlatformGhost();
      return;
    }
    const distance = solidHit?.distance ?? groundHit?.distance;
    const fit: RoofPanelFit | null = findRoofPanelFit(ray, st.parts, distance)
      ?? findPanelFit(ray.origin, st.parts, undefined, { ray, maxDistance: distance === undefined ? Infinity : distance + 3 });
    if (!fit) {
      clearPlatformGhost();
      return;
    }
    const platDef = getPartById(fit.partId);
    if (!platDef || platDef.category !== 'platform') {
      clearPlatformGhost();
      return;
    }
    const colorList = PART_COLORS;
    const color = colorList.find((c) => c.id === 'mint')?.hex || '#4CAF50';
    // 若幽灵形状（型号+位置+rotation）未变则跳过重建（抖动优化）
    const d = platGhostDataRef.current;
    if (platGhostGroupRef.current && d?.partId === fit.partId) {
      const same =
        Math.abs(d.position[0] - fit.position[0]) < 0.01 &&
        Math.abs(d.position[1] - fit.position[1]) < 0.01 &&
        Math.abs(d.position[2] - fit.position[2]) < 0.01 &&
        Math.abs(d.rotation[0] - fit.rotation[0]) < 0.01 &&
        Math.abs(d.rotation[1] - fit.rotation[1]) < 0.01 &&
        Math.abs(d.rotation[2] - fit.rotation[2]) < 0.01 &&
        JSON.stringify(d.roofOutline) === JSON.stringify(fit.roofOutline);
      if (same) return;
    }
    if (platGhostGroupRef.current) {
      sc.remove(platGhostGroupRef.current);
      disposeGroup(platGhostGroupRef.current);
      platGhostGroupRef.current = null;
    }
    const ghostPart: PlacedPart = {
      id: '__ptmp',
      partId: fit.partId,
      position: fit.position,
      rotation: fit.rotation,
      colorId: 'mint',
      roofOutline: fit.roofOutline,
    };
    const group = createPartMesh(ghostPart, platDef, color, 0.5, '#4A90D9');
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if ((o as THREE.Mesh).isMesh && m) {
        const mats = Array.isArray(m) ? m : [m];
        mats.forEach((mat) => {
          mat.transparent = true;
          mat.depthWrite = false;
        });
      }
    });
    const outer = new THREE.Group();
    outer.userData.isPlatGhost = true;
    outer.add(group);
    sc.add(outer);
    platGhostGroupRef.current = outer;
    platGhostDataRef.current = fit;
  }, [clearPlatformGhost]);

  // 端点扩展幽灵：选中单个独立杆件/连接件时，在其空闲扩展端显示半透明待部署元件
  useEffect(() => {
    const ref = sceneRef.current;
    if (!ref) return;
    // 清空旧的扩展幽灵
    if (extGhostGroupRef.current) {
      ref.scene.remove(extGhostGroupRef.current);
      disposeGroup(extGhostGroupRef.current);
      extGhostGroupRef.current = null;
    }
    extGhostDataRef.current = [];
    setExtCount(0);
    clearPlatformGhost();

    const st = useStore.getState();
    // 仅在“生长模式”下显示扩展幽灵；移动模式仅保留操作轴编辑；上色模式为独立模式
    if (st.gizmoMode !== 'growth' || st.paintColor) return;
    // 杆件/连接件扩展端幽灵仅在“增加框架”(frame)阶段生效；
    // spec(生成框架)与 accessory(增加配件)阶段都不识别杆件/连接件生长端
    if (st.workflow !== 'frame') return;
    // 放置/拖拽进行中不显示
    if (st.draggingPart || st.pendingPreset || dragState.current.isDragging) return;
    if (st.selectedIds.length !== 1) return;
    const id = st.selectedIds[0];
    // 仅对未被成组的独立零件显示扩展点（成组物体视为整体 solid）。
    // 例外：45°L嵌套组合的成员属于嵌套组合组，嵌套端已自动被另一件占用（findBestSnap 判定），
    // 其余端需可在生长模式继续生长，故放行组合成员。
    const topGroup = getTopGroupOf(st.groups, id);
    if (topGroup && topGroup.name !== COMBO_45L.name) return;
    const src = st.parts.find((p) => p.id === id);
    if (!src) return;
    const def = getPartById(src.partId);
    if (!def || !def.connectionPoints || (def.category !== 'bar' && def.category !== 'connector')) return;

    const ghosts = computeExtensionGhosts(src);
    if (!ghosts.length) return;

    const outer = new THREE.Group();
    outer.userData.isExtGhost = true;
    const entries: { partId: string; position: [number, number, number]; rotation: [number, number, number]; group: THREE.Group }[] = [];
    for (const g of ghosts) {
      const gdef = getPartById(g.partId);
      if (!gdef) continue;
      // 扩展幽灵：淡红色、半透明（透出后景），关闭 depthWrite 以免遮挡后方物体
      const group = createPartMesh(g, gdef, '#FF8A80', 0.5, '#EE5A5A');
      group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if ((o as THREE.Mesh).isMesh && m) {
          const mats = Array.isArray(m) ? m : [m];
          mats.forEach((mat) => {
            mat.transparent = true;
            mat.depthWrite = false;
          });
        }
      });
      group.userData.extGhostIndex = entries.length;
      outer.add(group);
      entries.push({ partId: g.partId, position: g.position, rotation: g.rotation, group });
    }
    extGhostDataRef.current = entries;
    ref.scene.add(outer);
    extGhostGroupRef.current = outer;
    setExtCount(entries.length);
    window.__debugLog?.(`🔷 端点扩展幽灵 × ${entries.length}`);
  }, [
    parts,
    selectedIds,
    selectedPartId,
    draggingPart,
    pendingPreset,
    releaseTick,
    gizmoMode,
    paintColor,
    workflow,
    clearPlatformGhost,
  ]);

  // 更新选中标记和操作轴
  useEffect(() => {
    const ref = sceneRef.current;
    if (!ref) return;
    const marker = selectedMarkerRef.current;
    const gizmo = gizmoRef.current;
    if (!marker || !gizmo) return;
    const state = useStore.getState();
    // 判断当前选中是否落在同一个多成员组内 → 当作"组物件"选中，显示组信息标签
    const rawSel = state.selectedIds;
    if (rawSel.length > 0) {
      const tops = new Set<string>();
      let loose = false;
      rawSel.forEach((id) => {
        const top = getTopGroupOf(state.groups, id);
        if (top) tops.add(top.id);
        else loose = true;
      });
      let tagId: string | null = null;
      if (!loose && tops.size === 1) {
        const gi = [...tops][0];
        const g = state.groups.find((x) => x.id === gi);
        if (g && collectGroupPartIds(state.groups, g.id).length > 1) tagId = g.id;
      }
      setTagGroupId(tagId);
    } else {
      setTagGroupId(null);
    }
    // 若当前为多选/成组，操作轴定位到几何中心
    const selIds = collectSelectionIds(state.groups, state.selectedIds);
    if (selIds.length > 0) {
      const selParts = state.parts.filter((p: PlacedPart) => selIds.includes(p.id));
      const center = computePartCenter(selParts);
      marker.position.set(center.x, 0.5, center.z);
      marker.visible = true;
      gizmo.position.set(center.x, center.y, center.z);
      // 生长模式或上色模式隐藏操作轴（生长模式仅保留扩展幽灵、上色模式为独立编辑模式）
      gizmo.visible = state.gizmoMode !== 'growth' && !state.paintColor;
      // 记录几何中心，供旋转使用
      groupCenterRef.current = { x: center.x, y: center.y, z: center.z };
      // 成组/多选时用蓝色线框包围盒框住所有组员，便于区分成组物体与单一物体
      const selBox = selBoxRef.current;
      if (selBox) {
        if (selParts.length > 1) {
          const bb = getSelAABB(selParts);
          if (bb) {
            const boxCenter = new THREE.Vector3();
            bb.getCenter(boxCenter);
            const boxSize = new THREE.Vector3();
            bb.getSize(boxSize);
            selBox.position.copy(boxCenter);
            selBox.scale.set(boxSize.x + 1, boxSize.y + 1, boxSize.z + 1);
            selBox.visible = true;
          } else {
            selBox.visible = false;
          }
          const selFill = selFillRef.current;
          if (selFill) {
            if (selParts.length > 1 && bb) {
              const bfc = new THREE.Vector3();
              bb.getCenter(bfc);
              const bfs = new THREE.Vector3();
              bb.getSize(bfs);
              selFill.position.copy(bfc);
              selFill.scale.set(bfs.x + 1, bfs.y + 1, bfs.z + 1);
              selFill.visible = true;
            } else {
              selFill.visible = false;
            }
          }
        } else {
          selBox.visible = false;
        }
      }
    } else {
      marker.visible = false;
      gizmo.visible = false;
      const selBox = selBoxRef.current;
      if (selBox) selBox.visible = false;
      const selFill = selFillRef.current;
      if (selFill) selFill.visible = false;
    }
  }, [selectedPartId, selectedIds, parts, gizmoMode, paintColor]);

  // 视角导航模式：pan=左键拖拽平移 / rotate=左键拖拽旋转，并切换鼠标光标
  useEffect(() => {
    const ref = sceneRef.current;
    const container = containerRef.current;
    const vm = useStore.getState().navMode;
    if (ref && ref.controls) {
      ref.controls.mouseButtons.LEFT = vm === 'pan' ? THREE.MOUSE.PAN : vm === 'rotate' ? THREE.MOUSE.ROTATE : null;
    }
    if (container) {
      if (vm === 'pan') container.style.cursor = 'grab';
      else if (vm === 'rotate') container.style.cursor = ROTATE_CURSOR;
      else container.style.cursor = '';
    }
  }, [navMode]);

  // 鼠标事件
  useEffect(() => {
    const ref = sceneRef.current;
    const container = containerRef.current;
    if (!ref || !container) return;
    const el = container;
    const { raycaster, pointer, camera, ground, controls } = ref;
    const ds = dragState.current;

    const getGizmoMeshes = () => {
      if (!gizmoRef.current || !gizmoRef.current.visible) return { axes: [] as THREE.Mesh[], planes: [] as THREE.Mesh[], arcs: [] as THREE.Mesh[] };
      const axes: THREE.Mesh[] = [];
      const planes: THREE.Mesh[] = [];
      const arcs: THREE.Mesh[] = [];
      gizmoRef.current.children.forEach((c) => {
        if (c instanceof THREE.Mesh) {
          if (c.userData.isAxis) axes.push(c);
          else if (c.userData.isPlane) planes.push(c as THREE.Mesh);
          else if (c.userData.isArc) arcs.push(c as THREE.Mesh);
        }
      });
      return { axes, planes, arcs };
    };

    const handleDirectPlacement = (place: boolean) => {
      const state = useStore.getState();
      const preset = state.pendingPreset;
      if (preset?.id === COMBO_45L.id) {
        const ray = raycaster.ray;
        const targets = availablePorts(getWorldConnPoints(state.parts))
          .filter(port => port.type === 'female' && ray.distanceSqToPoint(port.position) < 9 ** 2)
          .sort((a, b) => ray.distanceSqToPoint(a.position) - ray.distanceSqToPoint(b.position));
        const anchor = ports(preset.parts).find(port => port.direction.y < -0.99);
        const ghost = ghostGroupRef.current;
        if (anchor) for (const target of targets) {
          const shift = target.position.clone().sub(anchor.position);
          const candidate = preset.parts.map(part => ({ ...part, position: new THREE.Vector3(...part.position).add(shift).toArray() }));
          const fit = fitRoofCombo(candidate, state.parts);
          if (!fit) continue;
          if (place) {
            state.addPresetGroup({ ...preset, parts: fit }, [0, 0, 0]);
          } else if (ghost) {
            ghost.visible = true;
            ghost.rotation.set(...fit[0].rotation);
            ghost.position.set(...fit[0].position).sub(new THREE.Vector3(...preset.parts[0].position).applyEuler(ghost.rotation));
          }
          return true;
        }
        if (!place && ghost) ghost.rotation.set(0, 0, 0);
      }
      if (preset?.directPlacement === 'bridge-bay') {
        clearPlatformGhost();
        const fit = findBridgeFit(raycaster.ray, state.parts);
        if (place) {
          if (fit) {
            state.addPresetGroup({ ...preset, parts: placeAssemblyParts(preset.parts, fit) }, [0, 0, 0]);
            el.style.cursor = 'default';
          } else {
            void message.info({ key: 'bridge-fit', content: '请指向两侧有连续扶手的空框架（宽 40 cm、长 80 cm）。' });
          }
        } else {
          const ghost = ghostGroupRef.current;
          if (ghost) {
            ghost.visible = !!fit;
            if (fit) {
              ghost.position.copy(fit.position);
              ghost.rotation.y = fit.yaw;
            }
          }
          el.style.cursor = fit ? 'crosshair' : 'not-allowed';
        }
        return true;
      }
      if (preset?.directPlacement === 'slide-edge' || preset?.directPlacement === 'ladder-edge') {
        clearPlatformGhost();
        const ladder = preset.directPlacement === 'ladder-edge';
        const joint = ladder ? findLadderJoin(raycaster.ray, state.parts) : null;
        const fit = joint ?? findSlideFit(raycaster.ray, state.parts, ladder ? 15 : 20);
        if (place && fit) {
          if (joint) {
            state.addPresetGroup({ ...preset, name: '滑梯与爬梯', parts: joint.additions }, [0, 0, 0], joint);
          } else if ('strapHalfSpacing' in fit) {
            state.addPresetGroup({ ...preset, parts: placeAssemblyParts(preset.parts, fit) }, [0, 0, 0]);
          }
          el.style.cursor = 'default';
        } else if (place) {
          void message.info({ key: 'slide-fit', content: ladder ? '请选择水平杆件或双段滑梯的空闲侧边。' : '请选择一根侧面留空的水平杆件。' });
        } else {
          const ghost = ghostGroupRef.current;
          if (ghost) {
            ghost.visible = !!fit;
            if (fit) {
              ghost.position.copy(fit.position);
              ghost.rotation.y = fit.yaw;
              for (const member of ghost.children) {
                member.visible = !joint || joint.previewIds.has(member.userData.presetPartId);
                if (member.userData.strapSide && 'strapHalfSpacing' in fit) member.position.x = member.userData.strapSide * fit.strapHalfSpacing;
              }
            }
          }
          el.style.cursor = fit ? 'crosshair' : 'not-allowed';
        }
        return true;
      }
      const picked = state.draggingPart;
      const def = picked && getPartById(picked.partId);
      if (!picked || !def?.directPlacement) return false;
      clearPlatformGhost();
      const target = def.directPlacement;
      const fit = target === 'trampoline-frame' ? findTrampolineFit(raycaster.ray, state.parts, def)
        : target === 'tall-rainbow-frame' ? findTallRainbowFit(raycaster.ray, state.parts, def)
          : findMountedAccessoryFit(raycaster.ray, state.parts, def);
      if (place) {
        if (fit) {
          const part = state.addPart(fit.partId, fit.position, fit.rotation, picked.colorId, false, true);
          state.setDraggingPart(null);
          if (part) state.setSelection([part.id], part.id);
          el.style.cursor = 'default';
        } else {
          const content = target === 'trampoline-frame' ? '请选择四边闭合、内部空置的 80 × 80 cm 水平框架。'
            : target === 'tall-rainbow-frame' ? `请指向空的 40 × ${def.platformSpec?.plateDepth} cm 竖向框格。`
              : target === 'molded-slide' ? `请选择约 ${def.slideSpec?.rise} cm 高、外侧留空的水平长圆管。`
                : '请选择下方留空且高度足够的水平长圆管。';
          void message.info({ key: 'special-part-fit', content });
        }
      } else {
        const ghost = ghostGroupRef.current;
        if (ghost) {
          ghost.visible = !!fit;
          if (fit) {
            ghost.position.set(...fit.position);
            ghost.rotation.set(...fit.rotation);
          }
        }
        el.style.cursor = fit ? 'crosshair' : 'not-allowed';
      }
      return true;
    };

    const onNativeDrag = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('application/x-climbing-part')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const rect = el.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
      raycaster.setFromCamera(pointer, camera);
      if (!handleDirectPlacement(event.type === 'drop')) handlePickedPlacement(event.type === 'drop');
    };

    const handlePickedPlacement = (place: boolean) => {
      const state = useStore.getState();
      const picked = state.draggingPart;
      const def = picked && getPartById(picked.partId);
      if (!picked || !def) return false;
      clearPlatformGhost();
      const ghost = ghostGroupRef.current;
      if (state.workflow === 'frame' && state.gizmoMode === 'growth' && def.category === 'platform') {
        if (ghost) ghost.visible = false;
        if (place) void message.info('切换到「编辑平台板」或「移动配件」后即可放置板件。');
        return true;
      }
      const part: PlacedPart = { id: 'library-preview', partId: def.id, position: [0, 0, 0],
        rotation: [0, 0, 0], colorId: picked.colorId };
      const ray = raycaster.ray;
      const snap = def.extKind === 'rainbow'
        ? findPanelFit(ray.origin, state.parts, { ray })
        : def.category === 'platform'
          ? findPanelFit(ray.origin, state.parts, undefined, { def, ray })
          : def.id === 'connector-bazi'
            ? findDoubleClampFit(ray, state.parts)
            : findPickedPortFit(ray, part, def, state.parts);
      const groundHit = raycaster.intersectObject(ground)[0];
      let pose = snap;
      if (!pose && def.extKind !== 'rainbow' && groundHit && !raycaster.intersectObject(ref.partsGroup, true)
        .some(hit => hit.object instanceof THREE.Mesh && hit.distance < groundHit.distance - 0.1)) {
        const { x, z } = groundHit.point;
        const position: PlacedPart['position'] = [
          Math.round(x / SNAP_DIST) * SNAP_DIST, def.size.height / 2, Math.round(z / SNAP_DIST) * SNAP_DIST,
        ];
        if (!state.checkCollision({ ...part, position })) pose = { position, rotation: part.rotation };
      }
      if (place) {
        if (pose) {
          const added = state.addPart(def.id, pose.position, pose.rotation, picked.colorId, false, !!snap);
          if (added) {
            state.setDraggingPart(null);
            state.setSelection([added.id], added.id);
            el.style.cursor = 'default';
          }
        } else {
          void message.info({ key: 'picked-part-fit', content: def.extKind === 'rainbow'
            ? '请点击一个空的 40 × 40 cm 竖向框格。' : '请指向兼容的连接位置或空地。' });
        }
      } else {
        if (ghost) {
          ghost.visible = !!pose;
          if (pose) {
            ghost.position.set(...pose.position);
            ghost.rotation.set(...pose.rotation);
          }
        }
        el.style.cursor = snap ? 'crosshair' : pose ? 'copy' : 'not-allowed';
      }
      return true;
    };

    const onPointerDown = (e: PointerEvent) => {
      // 仅左键用于选中/拖拽/放置；中键拖拽旋转视角（滚轮缩放），右键平移/上下文菜单
      if (e.button !== 0) return;
      // 视角导航模式：左键交给 OrbitControls 平移/旋转视角，不进入场景选中/拖拽
      const vm = useStore.getState().navMode;
      if (vm !== 'none') {
        el.style.cursor = 'grabbing';
        return;
      }
      ds.historyPushed = false;
      ds.altCopy = false;
      const rect = container!.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      let state = useStore.getState();

      if (handleDirectPlacement(true) || handlePickedPlacement(true)) return;

      // 旋转预览点击
      if (state.rotationPreviewEnabled) {
        // 空点退出预览
        state.setRotationPreviewEnabled(false);
        state.setRotationPreviewVariants([]);
        state.setHoveredRotationIndex(null);
        return;
      }

      // 油漆桶上色模式：点击可着色元件（杆件/平台板）直接染色
      if (state.paintColor) {
        const paintMeshes: THREE.Mesh[] = [];
        ref.partsGroup.children.forEach((g) => {
          g.children.forEach((c) => {
            if (c instanceof THREE.Mesh) paintMeshes.push(c);
          });
        });
        const paintHits = raycaster.intersectObjects(paintMeshes);
        if (paintHits.length > 0) {
          const pg = paintHits[0].object.parent;
          const pid = pg && (pg.userData.partId as string | undefined);
          const part = pid ? state.parts.find((x: PlacedPart) => x.id === pid) : undefined;
          const def = part ? getPartById(part.partId) : undefined;
          if (part && def && (def.category === 'bar' || def.category === 'platform')) {
            state.paintPart(part.id, state.paintColor);
          }
        }
        return; // 上色模式下不响应选中/拖拽/操作轴等
      }

      // 检查操作轴点击
      if (state.selectedPartId) {
        const { axes, planes, arcs } = getGizmoMeshes();
        const allGizmo = [...axes, ...planes, ...arcs];
        if (allGizmo.length > 0) {
          const gizmoIntersects = raycaster.intersectObjects(allGizmo);
          if (gizmoIntersects.length > 0) {
            controls.enabled = false;
            // Alt + 操作轴（移动/旋转）：先复制当前选中（单件或整组），再对新副本执行操作
            if (e.altKey && !state.draggingPart) {
              state.duplicateSelection();
              ds.altCopy = true;
              ds.historyPushed = true; // 复制已记录一次历史，拖动不再额外记录
              state = useStore.getState();
              const dupSel = collectSelectionIds(state.groups, state.selectedIds);
              if (dupSel.length === 0) { controls.enabled = true; return; }
            }
            const hit = gizmoIntersects[0].object;
            if (hit.userData.isAxis) {
              const axisName = hit.userData.axisDir ? (hit.userData.axisDir.x ? 'X' : hit.userData.axisDir.y ? 'Y' : 'Z') : '?';
              window.__debugLog?.(`🔴 点中轴箭头: ${axisName}轴`);
              // 沿轴移动 — 使用相机朝向平面 + 初始位置追踪
              const part = state.parts.find((p: PlacedPart) => p.id === state.selectedPartId);
              if (part) {
                const partPos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
                ds.initialPos = [part.position[0], part.position[1], part.position[2]];
                // 创建相机朝向平面（垂直于相机视线方向）
                const camViewDir = new THREE.Vector3();
                camera.getWorldDirection(camViewDir);
                const camPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camViewDir, partPos);
                const initHit = new THREE.Vector3();
                const initResult = raycaster.ray.intersectPlane(camPlane, initHit);
                if (initResult) {
                  ds.initialT = initHit.clone().sub(partPos).dot(hit.userData.axisDir);
                } else {
                  ds.initialT = 0;
                }
              }
              ds.isDown = true;
              ds.isDragging = true;
              ds.dragPartId = state.selectedPartId;
              ds.axisDir = hit.userData.axisDir.clone();
              ds.planeNormal = null;
              ds.planePos = null;
              return;
            } else if (hit.userData.isPlane) {
              window.__debugLog?.(`🔴 点中平面: ${hit.userData.planeNormal ? (hit.userData.planeNormal.x ? 'XZ' : hit.userData.planeNormal.y ? 'XY' : 'YZ') : '?'}平面`);
              // 沿平面移动
              ds.isDown = true;
              ds.isDragging = true;
              ds.dragPartId = state.selectedPartId;
              ds.axisDir = null;
              ds.planeNormal = hit.userData.planeNormal.clone();
              ds.planePos = hit.userData.planePos.clone();
              return;
            } else if (hit.userData.isArc) {
              window.__debugLog?.(`🔴 点中旋转弧线: ${hit.userData.arcAxis || '?'}轴`);
              // 拖拽旋转（替换立即旋转45°）
              const axisDir = new THREE.Vector3(
                hit.userData.arcAxis === 'x' ? 1 : 0,
                hit.userData.arcAxis === 'y' ? 1 : 0,
                hit.userData.arcAxis === 'z' ? 1 : 0
              );
              const part = state.parts.find((p: PlacedPart) => p.id === state.selectedPartId);
              if (part) {
                // 整组旋转：以几何中心为锚点，记录成员初始变换快照（避免累加漂移）
                const gSel = collectSelectionIds(state.groups, state.selectedIds);
                const isGroup = gSel.length > 1;
                const anchorPos = isGroup
                  ? new THREE.Vector3(groupCenterRef.current.x, groupCenterRef.current.y, groupCenterRef.current.z)
                  : new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
                const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisDir, anchorPos);
                const hitPoint = new THREE.Vector3();
                const result = raycaster.ray.intersectPlane(plane, hitPoint);
                if (result) {
                  const toHit = hitPoint.clone().sub(anchorPos);
                  const startAngle = getAngleAroundAxis(toHit, axisDir);
                  if (isGroup) {
                    const gc = groupCenterRef.current;
                    ds.groupAnchor = { x: gc.x, y: gc.y, z: gc.z };
                    ds.groupAxis = axisDir.clone();
                    ds.groupSnap = gSel.map((gid: string) => {
                      const gp = state.parts.find((x: PlacedPart) => x.id === gid);
                      return gp
                        ? { id: gid, position: [...gp.position] as [number, number, number], rotation: [...gp.rotation] as [number, number, number] }
                        : null;
                    }).filter(Boolean) as { id: string; position: [number, number, number]; rotation: [number, number, number] }[];
                  } else {
                    ds.groupSnap = null;
                  }
                  state._pushHistory();
                  ds.historyPushed = true;
                  ds.isDown = true;
                  ds.isDragging = true;
                  ds.dragPartId = state.selectedPartId;
                  ds.axisDir = axisDir;
                  ds.planeNormal = null;
                  ds.planePos = null;
                  ds.isArc = true;
                  ds.startQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]));
                  ds.startAngle = startAngle;
                  window.__debugLog?.(`🔄 开始旋转拖拽: startAngle=${(startAngle * 180 / Math.PI).toFixed(1)}°`);
                  return;
                }
              }
              controls.enabled = true;
              return;
            }
          }
        }
      }

      // 平台板幽灵：点击半透明平台板 → 部署真实平台板
      if (!e.altKey && !state.draggingPart && platGhostDataRef.current && platGhostGroupRef.current) {
        const platHits = raycaster.intersectObject(platGhostGroupRef.current, true);
        if (platHits.length) {
          const st = useStore.getState();
          const md = platGhostDataRef.current;
          const added = st.addPart(md.partId, md.position, md.rotation, undefined, false, true, md.roofOutline);
          if (added) {
            st.setSelection([added.id], added.id);
            window.__debugLog?.(`🟩 平台板自动部署: → 实体 #${st.parts.length}`);
          }
          clearPlatformGhost();
          controls.enabled = true;
          return;
        }
      }

      // 端点扩展幽灵：点击半透明待部署元件 → 部署为真实元件并链式选中新元件
      if (!e.altKey && !state.draggingPart && extGhostDataRef.current.length && extGhostGroupRef.current) {
        // 对整组递归射线检测，兼容任意嵌套层级（含描边 LineSegments 挂载在 mesh 子节点）
        const extHits = raycaster.intersectObject(extGhostGroupRef.current, true);
        if (extHits.length) {
          // 沿父子链向上回溯，找到带 extGhostIndex 的幽灵分组
          let owner: THREE.Object3D | undefined = extHits[0].object;
          while (owner && owner.userData.extGhostIndex === undefined && owner.parent) {
            owner = owner.parent;
          }
          const idx = owner ? (owner.userData.extGhostIndex as number) : undefined;
          const entry = typeof idx === 'number' ? extGhostDataRef.current[idx] : undefined;
          if (entry) {
            const st = useStore.getState();
            const added = st.addPart(entry.partId, entry.position, entry.rotation, undefined, false, true);
            if (added) {
              st.setSelection([added.id], added.id);
              window.__debugLog?.(`🟢 端点扩展部署: ${entry.partId} → 实体 #${st.parts.length}`);
            }
            controls.enabled = true;
            return;
          }
        }
      }

      // 检查部件点击
      const allMeshes: THREE.Mesh[] = [];
      ref.partsGroup.children.forEach((g) => {
        g.children.forEach((c) => {
          if (c instanceof THREE.Mesh) allMeshes.push(c);
        });
      });
      const partIntersects = raycaster.intersectObjects(allMeshes);
      if (partIntersects.length > 0) {
        const hit = partIntersects[0].object;
        const partGroup = hit.parent;
        if (partGroup && partGroup.userData.partId) {
          const partId = partGroup.userData.partId;

          // 全选同类已改为顶部分类菜单选择（不再走场景点选），此处直接进入常规选中逻辑
          window.__debugLog?.(`🟦 选中部件: ${partId}`);

          // Alt + 点击：在原位生成一个副本（静止不动），被拖拽的原物体成为“幽灵”，重合时红色半透明，脱离碰撞后变实体
          if (e.altKey && !state.draggingPart) {
            const src = state.parts.find((p: PlacedPart) => p.id === partId);
            if (src) {
              // 复制视为一次操作（历史记录一次），之后的拖拽不再额外记录
              state._pushHistory();
              ds.historyPushed = true;
              ds.altCopy = true;
              // 1) 在原位生成一个静止副本（作为部署锚点）
              const copyPos: [number, number, number] = [src.position[0], src.position[1], src.position[2]];
              const copied = state.addPart(src.partId, copyPos, src.rotation, src.colorId, true, true);
              if (!copied) { controls.enabled = true; return; } // 复制失败：不予拖拽，避免误拖原物
              // 2) 拖拽目标是被操作的原物体，它成为“幽灵”（开始时与副本重合 → 红色半透明）
              state.setSelection([src.id], src.id);
              state.setGhostCopy(src.id);
              ds.isDown = true;
              ds.isDragging = false;
              ds.startX = e.clientX;
              ds.startY = e.clientY;
              ds.dragPartId = src.id;
              ds.axisDir = null;
              ds.planeNormal = null;
              ds.planePos = null;
              ds.ghostActive = true;
              ds.ghostSrcId = src.id;
              ds.anchorCopyId = copied.id; // 原位静止副本，用于碰撞判定
              window.__debugLog?.(`📋 Alt 复制(幽灵): 原物 ${src.id} 被拖拽，副本 ${copied.id} 静止原位`);
              return;
            }
          }

          // Ctrl/Shift 点击：切换多选；普通点击：单选
          const sel = useStore.getState().selectedIds;
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            if (sel.includes(partId)) {
              const next = sel.filter((i) => i !== partId);
              state.setSelection(next, next.length ? next[next.length - 1] : null);
            } else {
              state.setSelection([...sel, partId], partId);
            }
          } else {
            state.setSelection([partId], partId);
          }
          // 开始拖拽（drag-to-move）
          ds.isDown = true;
          ds.isDragging = false;
          ds.startX = e.clientX;
          ds.startY = e.clientY;
          ds.dragPartId = partId;
          ds.axisDir = null;
          ds.planeNormal = null;
          ds.planePos = null;
          return;
        }
      }

      // 检查地面点击（放置新部件或移动模式）
      const groundIntersects = raycaster.intersectObject(ground);
      if (groundIntersects.length > 0) {
        const p = groundIntersects[0].point;
        const gridSize = SNAP_DIST;
        // 预置模块部署：整组作为一个 solid 实体放置（含成组）
        if (state.pendingPreset) {
          const dropPos: [number, number, number] = [
            Math.round(p.x / gridSize) * gridSize,
            0,
            Math.round(p.z / gridSize) * gridSize,
          ];
          const preset = state.pendingPreset;
          if (preset.id === COMBO_45L.id) {
            const candidate = preset.parts.map(part => ({ ...part,
              position: part.position.map((v, i) => v + dropPos[i]) as [number, number, number],
            }));
            const fixed = fitRoofCombo(candidate, state.parts);
            if (!fixed && bodyIntersects(candidate, state.parts)) {
              alert('此处组合与已有构件穿插，无法放置。请换一个位置或选择空闲杆件端口。');
              return;
            }
            state.addPresetGroup({ ...preset, parts: fixed ?? candidate }, [0, 0, 0]);
          } else {
            state.addPresetGroup(preset, dropPos);
          }
          window.__debugLog?.(`✅ 已部署模块「${preset.name}」 @ (${dropPos[0]}, ${dropPos[2]})`);
          return;
        }
      }

      // 空白处按下：开始框选（记录起点；拖拽后松开时判定，单点则为取消选中）
      ds.isSelecting = true;
      ds.selOrigin = { x: e.clientX, y: e.clientY };
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      updateSelectionRect(e.clientX, e.clientY, e.clientX, e.clientY);
    };

    // 更新框选矩形 DOM 位置
    function updateSelectionRect(x1: number, y1: number, x2: number, y2: number) {
      const el = selectionRectRef.current;
      const c = containerRef.current;
      if (!el || !c) return;
      const r = c.getBoundingClientRect();
      const left = Math.min(x1, x2) - r.left;
      const top = Math.min(y1, y2) - r.top;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const minSel = 3;
      if (w < minSel && h < minSel) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }

    // 计算一个配件的世界包围盒角点投影到屏幕的 AABB
    function worldToScreen(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): { minX: number; minY: number; maxX: number; maxY: number } {
      const v = new THREE.Vector3();
      const rect = el.getBoundingClientRect();
      let sxMin = Infinity, syMin = Infinity, sxMax = -Infinity, syMax = -Infinity;
      const cs = [ [minX,minY,minZ],[maxX,minY,minZ],[minX,minY,maxZ],[maxX,minY,maxZ],[minX,maxY,minZ],[maxX,maxY,minZ],[minX,maxY,maxZ],[maxX,maxY,maxZ] ];
      for (const c of cs) {
        v.set(c[0], c[1], c[2]);
        v.project(camera);
        const sx = (v.x + 1) / 2 * rect.width + rect.left;
        const sy = (-v.y + 1) / 2 * rect.height + rect.top;
        sxMin = Math.min(sxMin, sx); syMin = Math.min(syMin, sy);
        sxMax = Math.max(sxMax, sx); syMax = Math.max(syMax, sy);
      }
      return { minX: sxMin, minY: syMin, maxX: sxMax, maxY: syMax };
    }

    // 计算配件世界 AABB（考虑旋转）
    function partWorldAABB(part: PlacedPart): { minX:number;minY:number;minZ:number;maxX:number;maxY:number;maxZ:number } {
      const def = getPartById(part.partId);
      const { width, height, depth } = def ? def.size : { width: 10, height: 10, depth: 10 };
      const euler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
      const quat = new THREE.Quaternion().setFromEuler(euler);
      const halfW = width / 2, halfH = height / 2, halfD = depth / 2;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      const cs = [ [-halfW,-halfH,-halfD],[halfW,-halfH,-halfD],[-halfW,-halfH,halfD],[halfW,-halfH,halfD],[-halfW,halfH,-halfD],[halfW,halfH,-halfD],[-halfW,halfH,halfD],[halfW,halfH,halfD] ];
      const v = new THREE.Vector3();
      for (const c of cs) {
        v.set(c[0], c[1], c[2]).applyQuaternion(quat).add(new THREE.Vector3(part.position[0], part.position[1], part.position[2]));
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
      return { minX, minY, minZ, maxX, maxY, maxZ };
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      // 视角导航模式：仅更新光标（拖拽=grabbing，悬停=对应图标），不进入场景悬停/幽灵逻辑
      const vm = useStore.getState().navMode;
      if (vm !== 'none') {
        el.style.cursor = (e.buttons & 1) ? 'grabbing' : (vm === 'pan' ? 'grab' : ROTATE_CURSOR);
        return;
      }
      raycaster.setFromCamera(pointer, camera);
      const state = useStore.getState();

      if (handleDirectPlacement(false) || handlePickedPlacement(false)) return;

      // 生长模式：光标附近存在可落平台的矩形框架时，更新平台板幽灵（仅“增加配件”阶段）
      if (state.gizmoMode === 'growth' && !dragState.current.isDown && state.workflow === 'accessory') {
        const am: THREE.Mesh[] = [];
        ref.partsGroup.children.forEach((g) => g.children.forEach((c: THREE.Object3D) => { if (c instanceof THREE.Mesh) am.push(c); }));
        const mh = raycaster.intersectObjects(am);
        const groundHit = mh.length ? undefined : raycaster.intersectObject(ground)[0];
        updatePlatformGhost(raycaster.ray, mh[0], groundHit);
      }

      // 悬停检测：gizmo手柄
      const gizmoGroup = gizmoRef.current;
      if (gizmoGroup) {
        gizmoGroup.updateMatrixWorld(true);
        const gizmoHits = raycaster.intersectObjects(gizmoGroup.children);
      let hovered = false;
      if (gizmoHits.length > 0) {
        const obj = gizmoHits[0].object;
        if (obj.userData.isAxis) {
          container.style.cursor = 'pointer';
          hovered = true;
          window.__debugLog?.(`✨ 悬停: 轴 ${obj.userData.axisDir?.toArray().map((v:number)=>v>0.5?'X':v<-0.5?'-X':'')?.join('')||'?'}轴`);
        } else if (obj.userData.isPlane) {
          container.style.cursor = 'move';
          hovered = true;
          window.__debugLog?.(`✨ 悬停: 平面`);
        } else if (obj.userData.isArc) {
          container.style.cursor = 'grab';
          hovered = true;
          window.__debugLog?.(`✨ 悬停: 弧线`);
        }
      }
      if (!hovered && !ds.isDown && !ds.isDragging) {
          if (container.style.cursor !== 'default') {
            container.style.cursor = 'default';
          }
        }
      }

      // 旋转预览悬停
      if (state.rotationPreviewEnabled) {
        // 只是预览，实际通过highlight效果更新
        return;
      }

      // 框选拖拽中
      if (ds.isSelecting && ds.selOrigin) {
        updateSelectionRect(ds.selOrigin.x, ds.selOrigin.y, e.clientX, e.clientY);
        return;
      }

      // 拖拽移动
      if (ds.isDown && ds.dragPartId) {
        const dx = Math.abs(e.clientX - ds.startX);
        const dy = Math.abs(e.clientY - ds.startY);
        if (dx > 3 || dy > 3) {
          ds.isDragging = true;
          controls.enabled = false;
        }
        if (ds.isDragging) {
          // 移动/旋转/复制视为一次操作：拖动开始时仅记录一次历史快照
          if (!ds.historyPushed) {
            if (!ds.altCopy) useStore.getState()._pushHistory();
            ds.historyPushed = true;
          }
          const part = state.parts.find((pt: PlacedPart) => pt.id === ds.dragPartId);
          if (part) {
            window.__debugLog?.(`🔄 拖拽中: id=${ds.dragPartId} axisDir=${ds.axisDir?.toArray()?.map((v:number)=>v>0.5?'1':v<-0.5?'-1':'0')||'null'}`);
            let newPos: [number, number, number] = [0, 0, 0];
            const partPos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
            let gotPos = false;

            if (ds.axisDir) {
              if (ds.isArc) {
                // 旋转拖拽（吸附到45°增量）：单件绕自身，整组绕几何中心
                const memberIds = collectSelectionIds(state.groups, state.selectedIds);
                const isGroup = memberIds.length > 1;
                const anchor = isGroup && ds.groupAnchor
                  ? new THREE.Vector3(ds.groupAnchor.x, ds.groupAnchor.y, ds.groupAnchor.z)
                  : new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
                const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(ds.axisDir, anchor);
                const hitPoint = new THREE.Vector3();
                const result = raycaster.ray.intersectPlane(plane, hitPoint);
                if (result) {
                  const toHit = hitPoint.clone().sub(anchor);
                  const currentAngle = getAngleAroundAxis(toHit, ds.axisDir);
                  const angleDiff = currentAngle - ds.startAngle;
                  // 吸附到15°（π/12）增量，支持更细的旋转细分
                  const snapAngle = Math.round(angleDiff / (Math.PI / 12)) * (Math.PI / 12);
                  if (Math.abs(snapAngle) > 0.01) {
                    // 在世界空间中旋转：rotQ * startQuat（先旋转到起始姿态，再绕世界轴旋转）
                    const rotQ = new THREE.Quaternion().setFromAxisAngle(ds.axisDir, snapAngle);
                    if (isGroup && ds.groupSnap && ds.groupAnchor) {
                      // 整组绕几何中心旋转：基于拖拽起始快照做绝对旋转，保持相对位置、避免累加漂移
                      const anchor = new THREE.Vector3(ds.groupAnchor.x, ds.groupAnchor.y, ds.groupAnchor.z);
                      const updates = ds.groupSnap.map((s) => {
                        const pos = new THREE.Vector3(s.position[0], s.position[1], s.position[2]);
                        const rel = pos.clone().sub(anchor).applyQuaternion(rotQ);
                        const np = anchor.clone().add(rel);
                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rotation[0], s.rotation[1], s.rotation[2]));
                        const e = new THREE.Euler().setFromQuaternion(rotQ.clone().multiply(q));
                        return { id: s.id, position: [np.x, np.y, np.z] as [number, number, number], rotation: [e.x, e.y, e.z] as [number, number, number] };
                      });
                      // 地面碰撞：以组内最低物体的实际下边界为界整体上移
                      const movedParts = updates.map((u) => {
                        const old = state.parts.find((x: PlacedPart) => x.id === u.id);
                        return { ...(old as PlacedPart), position: u.position as [number, number, number], rotation: u.rotation as [number, number, number] };
                      });
                      const flBox = getSelAABB(movedParts);
                      if (flBox && flBox.min.y < 0) {
                        const lift = -flBox.min.y;
                        for (const u of updates) u.position = [u.position[0], u.position[1] + lift, u.position[2]];
                      }
                      // 用 batchUpdate 恢复初始位置后再整体旋转，避免历史累加干扰
                      state.batchUpdate(updates);
                    } else {
                      const result = rotQ.multiply(ds.startQuat!);
                      const euler = new THREE.Euler().setFromQuaternion(result);
                      const newRot: [number, number, number] = [euler.x, euler.y, euler.z];
                      state.updatePartRotation(ds.dragPartId, newRot);
                      // 调整Y防止穿地
                      const def = getPartById(part.partId);
                      if (def) {
                        const bottomY = getRotatedBottomY(part, def, newRot);
                        if (bottomY < 0) {
                          state.updatePartPosition(ds.dragPartId, [part.position[0], part.position[1] - bottomY, part.position[2]]);
                        }
                      }
                    }
                    window.__debugLog?.(`🔄 旋转拖拽: snapAngle=${(snapAngle * 180 / Math.PI).toFixed(0)}° ${isGroup ? `(组 ${memberIds.length})` : ''}`);
                  }
                }
                // 旋转不更新位置，防止 newPos=[0,0,0] 将物体拉回原点
                gotPos = false;
              } else {
                // 沿轴移动 — 使用固定在初始位置的相机朝向平面（避免平面随部件移动而抖动）
                const initialPosVec = new THREE.Vector3(ds.initialPos![0], ds.initialPos![1], ds.initialPos![2]);
                const camViewDir = new THREE.Vector3();
                camera.getWorldDirection(camViewDir);
                const camPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camViewDir, initialPosVec);
                const hit = new THREE.Vector3();
                const result = raycaster.ray.intersectPlane(camPlane, hit);
                if (result && ds.initialPos) {
                  const currentT = hit.clone().sub(initialPosVec).dot(ds.axisDir);
                  const deltaT = currentT - ds.initialT;
                  const finalPos = new THREE.Vector3(
                    ds.initialPos[0] + ds.axisDir.x * deltaT,
                    ds.initialPos[1] + ds.axisDir.y * deltaT,
                    ds.initialPos[2] + ds.axisDir.z * deltaT
                  );
                  newPos = [finalPos.x, Math.max(finalPos.y, 0), finalPos.z];
                  gotPos = true;
                  window.__debugLog?.(`↕️ 轴拖拽: axisDir=${ds.axisDir.toArray().map((v:number)=>v>0.5?'1':v<-0.5?'-1':'0')} deltaT=${deltaT.toFixed(1)} newPos=${newPos.map((v:number)=>v.toFixed(1))}`);
                } else {
                  window.__debugLog?.(`⚠️ 轴拖拽: 无交点`);
                }
              }
            } else if (ds.planeNormal) {
              // 沿平面移动 — 使用平面法线定义的平面穿过部件位置
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(ds.planeNormal, partPos);
              const proj = new THREE.Vector3();
              const result = raycaster.ray.intersectPlane(plane, proj);
              if (result) {
                newPos = [proj.x, Math.max(proj.y, 0), proj.z];
                gotPos = true;
                window.__debugLog?.(`↕️ 平面拖拽: normal=${ds.planeNormal.toArray().map((v:number)=>v>0.5?'1':v<-0.5?'-1':'0')} newPos=${newPos.map((v:number)=>v.toFixed(1))}`);
              } else {
                window.__debugLog?.(`⚠️ 平面拖拽: 无交点`);
              }
            } else {
              // 自由拖拽（基于地面）
              const groundIntersects = raycaster.intersectObject(ground);
              if (groundIntersects.length > 0) {
                const p = groundIntersects[0].point;
                const def = getPartById(part.partId);
                const yOff = def ? def.size.height / 2 : 0;
                newPos = [p.x, yOff, p.z];
                gotPos = true;
              }
            }
            if (gotPos) {
              // 成组移动：若当前选中为整组/多选，则整体联动并做地面碰撞
              let memberIds = collectSelectionIds(state.groups, state.selectedIds);
              // 当只选中/抓取单个成员时，也要连同其所属顶层组整体移动，避免相对位移被破坏
              // 注意：Alt 复制(幽灵)拖拽时始终把副本当独立物体移动，绝不联动原物所在组，防止原物被拖动
              if (memberIds.length === 1 && !ds.ghostActive) {
                const top = getTopGroupOf(state.groups, part.id);
                if (top) memberIds = collectGroupPartIds(state.groups, top.id);
              }
              if (memberIds.length > 1) {
                // 成组物体视为不可撼动的刚体：整个拖拽手势中，所有成员始终使用「起始位置 + 统一位移」的绝对变换
                // 首次进入时快照所有成员的起始位置，之后每帧复用该快照，从根本上杜绝逐帧增量叠加导致的相对位移
                let st = useStore.getState();
                if (!ds.rigidSnap) {
                  const snap = memberIds
                    .map((mid: string) => {
                      const m = st.parts.find((p: PlacedPart) => p.id === mid);
                      return m ? ({ id: mid, start: [...m.position] as [number, number, number] }) : null;
                    })
                    .filter((v): v is { id: string; start: [number, number, number] } => v !== null);
                  ds.rigidSnap = { driverId: part.id, driverStart: [...part.position] as [number, number, number], members: snap };
                }
                const rs = ds.rigidSnap;
                st = useStore.getState();
                // 自由拖拽（非操作轴/平面）时保持组的高度不变，只沿地面移动，避免抓起顶部驱动件导致整体骤升骤降
                const keepY = !ds.axisDir && !ds.planeNormal;
                const raw: [number, number, number] = [
                  newPos[0] - rs.driverStart[0],
                  newPos[1] - rs.driverStart[1],
                  newPos[2] - rs.driverStart[2],
                ];
                // 组整体网格吸附（对位移取整），所有成员共享同一位移 → 完美刚体
                const dd: [number, number, number] = [raw[0], keepY ? 0 : raw[1], raw[2]];
                // 绝对位置 = 起始位置 + 统一位移（含驱动件本身，一步原子更新全部成员）
                const updates = rs.members.map((m) => ({
                  id: m.id,
                  position: [m.start[0] + dd[0], m.start[1] + dd[1], m.start[2] + dd[2]] as [number, number, number],
                }));
                // 地面碰撞：以组内最低物体实际下边界（含旋转 AABB）为界整体上移，不破坏相对位置
                const applied = updates
                  .map((u) => {
                    const old = st.parts.find((p: PlacedPart) => p.id === u.id);
                    return old ? { ...old, position: u.position } : null;
                  })
                  .filter((v): v is PlacedPart => v !== null);
                let snapped = false;
                {
                  const ownIds = new Set(memberIds);
                  const ownPorts = availablePorts(getWorldConnPoints(applied));
                  const externalPorts = availablePorts(getWorldConnPoints(st.parts.filter(p => !ownIds.has(p.id))));
                  const match = findBestSnap(ownPorts, externalPorts);
                  if (match) {
                    const delta = match.otherCp.position.clone().sub(match.selfCp.position);
                    // Axis and plane handles retain their movement constraints.
                    const permitted = ds.axisDir ? delta.clone().projectOnVector(ds.axisDir)
                      : ds.planeNormal ? delta.clone().projectOnPlane(ds.planeNormal)
                      : new THREE.Vector3(delta.x, 0, delta.z);
                    if (delta.distanceTo(permitted) < 0.15) {
                      updates.forEach(u => {
                        u.position = [u.position[0] + delta.x, u.position[1] + delta.y, u.position[2] + delta.z];
                      });
                      applied.forEach(p => { p.position = [p.position[0] + delta.x, p.position[1] + delta.y, p.position[2] + delta.z]; });
                      snapped = true;
                    }
                  }
                }
                const grpBox = getSelAABB(applied);
                let lift = 0;
                if (grpBox && grpBox.min.y < 0) lift = -grpBox.min.y;
                const finalUpdates = updates.map((u) => ({
                  id: u.id,
                  position: [u.position[0], u.position[1] + lift, u.position[2]] as [number, number, number],
                }));
                st.batchUpdate(finalUpdates);
                ds.snapped = snapped && lift === 0;
                setSnapFeedback(ds.snapped);
                window.__debugLog?.(`👥 成组移动(刚体): ${memberIds.length} 个成员`);
              } else {
                const def = getPartById(part.partId);
                // Alt 复制幽灵：自由移动（无碰撞），跟随鼠标；重合时红色半透明高亮
                if (ds.ghostActive) {
                  state.updatePartPosition(ds.dragPartId, newPos, true);
                  ds.snapped = false;
                  setSnapFeedback(false);
                  updateGhostHighlight(useStore.getState(), ds);
                } else if (def && (def.category === 'bar' || def.category === 'connector')) {
                  // 临时构造一个"待吸附"的 PlacedPart
                  const tempPart: PlacedPart = { ...part, position: newPos };
                  const selfCPs = getSelfWorldConnPoints(tempPart, def);
                  const others = getWorldConnPoints(state.parts, part.id);
                  const snap = findBestSnap(selfCPs, availablePorts(others), SNAP_CONNECT_DIST, 35);
                  if (snap) {
                    const snapped = computeSnappedTransform(tempPart, def, snap.selfCp, snap.otherCp);
                    state.updatePartPosition(ds.dragPartId, snapped.position, true);
                    state.updatePartRotation(ds.dragPartId, snapped.rotation);
                    ds.snapped = true;
                    setSnapFeedback(true);
                    window.__debugLog?.(`🧲 自动吸附: ${snap.selfCp.cpId} → ${snap.otherCp.cpId} d=${snap.dist.toFixed(1)}`);
                  } else {
                    state.updatePartPosition(ds.dragPartId, newPos, false);
                    ds.snapped = false;
                    setSnapFeedback(false);
                  }
                } else if (def && def.category === 'platform') {
                  // 平台板实时吸附（矩形框架）
                  const tempPart: PlacedPart = { ...part, position: newPos };
                  const snap = findPlatformSnap(tempPart, def, state.parts);
                  if (snap) {
                    state.updatePartPosition(ds.dragPartId, snap.position, true);
                    state.updatePartRotation(ds.dragPartId, snap.rotation);
                    ds.snapped = true;
                    setSnapFeedback(true);
                    window.__debugLog?.(`🧲 平台板吸附框架`);
                  } else {
                    state.updatePartPosition(ds.dragPartId, newPos, false);
                    ds.snapped = false;
                    setSnapFeedback(false);
                  }
                } else {
                  state.updatePartPosition(ds.dragPartId, newPos, false);
                  ds.snapped = false;
                }
              }
              window.__debugLog?.(`✅ 更新位置: ${newPos.map((v:number)=>v.toFixed(1))}`);
            }
          } else {
            window.__debugLog?.(`❌ 未找到部件: id=${ds.dragPartId}`);
          }
        }
      }

      // 幽灵位置
      if (state.draggingPart || state.pendingPreset) {
        const groundIntersects = raycaster.intersectObject(ground);
        if (groundIntersects.length > 0) {
          const p = groundIntersects[0].point;
          state.setGhostPosition([p.x, 0, p.z]);
        }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      // 视角导航模式：结束时恢复悬停光标，场景逻辑不参与（未进入场景拖拽）
      const vm = useStore.getState().navMode;
      if (vm !== 'none') {
        el.style.cursor = vm === 'pan' ? 'grab' : ROTATE_CURSOR;
      }
      const state = useStore.getState();

      // 结束框选
      if (ds.isSelecting && ds.selOrigin) {
        const { x: x1, y: y1 } = ds.selOrigin;
        const { clientX: x2, clientY: y2 } = event;
        const el = selectionRectRef.current;
        if (el) el.style.display = 'none';
        // 判断框选方向：左上→右下（正向）要求完全包含，反之要求部分相交
        const fwd = x2 >= x1 && y2 >= y1;
        const selIds: string[] = [];
        const curParts = state.parts;
        for (const p of (Math.abs(x2 - x1) >= 3 || Math.abs(y2 - y1) >= 3) ? curParts : []) {
          const def = getPartById(p.partId);
          if (!def) continue;
          const aabb = partWorldAABB(p);
          const sc = worldToScreen(aabb.minX, aabb.minY, aabb.minZ, aabb.maxX, aabb.maxY, aabb.maxZ);
          if (fwd) {
            // 完全在框内：物体屏幕AABB ⊆ 框
            const fullyInside =
              sc.minX >= Math.min(x1, x2) && sc.maxX <= Math.max(x1, x2) &&
              sc.minY >= Math.min(y1, y2) && sc.maxY <= Math.max(y1, y2);
            if (fullyInside) selIds.push(p.id);
          } else {
            // 部分相交：与框有交集
            const overlap =
              sc.minX <= Math.max(x1, x2) && sc.maxX >= Math.min(x1, x2) &&
              sc.minY <= Math.max(y1, y2) && sc.maxY >= Math.min(y1, y2);
            if (overlap) selIds.push(p.id);
          }
        }
        if (selIds.length > 0) {
          state.setSelection(selIds, selIds[selIds.length - 1]);
        } else {
          state.setSelection([], null);
        }
        ds.isSelecting = false;
        ds.selOrigin = null;
        controls.enabled = true;
        ds.isDown = false;
        return;
      }

      if (ds.isDragging && ds.dragPartId) {
        // 已吸附嵌套时保持精确连接位置，不再做网格吸附
        const part = state.parts.find((p: PlacedPart) => p.id === ds.dragPartId);
        if (part && !ds.snapped && !ds.rigidSnap) {
          const gridSize = SNAP_DIST;
          const snappedPos: [number, number, number] = [
            Math.round(part.position[0] / gridSize) * gridSize,
            Math.max(part.position[1], 0),
            Math.round(part.position[2] / gridSize) * gridSize,
          ];
          state.updatePartPosition(ds.dragPartId, snappedPos);
        }
      }
      // Alt 复制幽灵：松开时若被拖拽的原物体仍与副本（或其他部件）体积碰撞，自动弹开到最近的空闲位置，并恢复为正常颜色部署
      if (ds.ghostActive && ds.dragPartId) {
        const gst = useStore.getState();
        const dragged = gst.parts.find((p: PlacedPart) => p.id === ds.dragPartId);
        if (dragged && gst.checkCollision(dragged, dragged.id)) {
          const draggedDef = getPartById(dragged.partId);
          const freePos = findFreeSpawn(
            dragged,
            draggedDef,
            [dragged.position[0], dragged.position[1], dragged.position[2]],
            gst,
            dragged.id
          );
          gst.updatePartPosition(dragged.id, freePos, true);
        }
        gst.setGhostCopy(null);
        ds.ghostActive = false;
        ds.ghostSrcId = null;
        ds.anchorCopyId = null;
      }
      controls.enabled = true;
      setSnapFeedback(false);
      ds.isDown = false;
      ds.isDragging = false;
      ds.dragPartId = null;
      ds.axisDir = null;
      ds.planeNormal = null;
      ds.planePos = null;
      ds.isArc = false;
      ds.rigidSnap = null;
      ds.startQuat = null;
      ds.startAngle = 0;
      ds.initialPos = null;
      ds.initialT = 0;
      ds.snapped = false;
      ds.isSelecting = false;
      ds.selOrigin = null;
      // 拖动结束后触发扩展幽灵重建（ref 状态不发生响应式变化，需显式 bump）
      useStore.getState().bumpRelease();
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);

    // 右键菜单：命中已选物体时弹成组/解组菜单，否则维持视角旋转
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      const rect = el.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const allMeshes: THREE.Mesh[] = [];
      ref.partsGroup.children.forEach((g) => {
        g.children.forEach((c) => { if (c instanceof THREE.Mesh) allMeshes.push(c); });
      });
      const hits = raycaster.intersectObjects(allMeshes);
      let hitId: string | null = null;
      if (hits.length > 0) {
        const pg = hits[0].object.parent;
        if (pg && pg.userData.partId) hitId = pg.userData.partId;
      }
      // 若右键点击的物体已处于选中集合内，则在选中集合上弹菜单；否则选中所点物体再弹
      const cur = useStore.getState().selectedIds;
      let menuIds = cur;
      if (hitId) {
        // 右键命中成组成员时，无论是否已选中，都扩展为所属顶层组整体，以便显示「取消成组」
        const top = getTopGroupOf(st.groups, hitId);
        if (top) {
          const desc = collectGroupPartIds(st.groups, top.id);
          st.setSelection(desc, hitId);
          menuIds = desc;
        } else if (!cur.includes(hitId)) {
          st.setSelection([hitId], hitId);
          menuIds = [hitId];
        }
      }
      if (menuIds.length === 0) return;
      window.__sceneCtxMenu?.({ x: e.clientX, y: e.clientY, ids: [...menuIds] });
    };
    container.addEventListener('contextmenu', onContextMenu);
    const cancelSelection = () => {
      if (!ds.isSelecting) return;
      ds.isSelecting = false;
      ds.selOrigin = null;
      controls.enabled = true;
      if (selectionRectRef.current) selectionRectRef.current.style.display = 'none';
    };
    container.addEventListener('pointercancel', cancelSelection);
    container.addEventListener('dragover', onNativeDrag);
    container.addEventListener('drop', onNativeDrag);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('pointercancel', cancelSelection);
      container.removeEventListener('dragover', onNativeDrag);
      container.removeEventListener('drop', onNativeDrag);
      if (platGhostGroupRef.current) {
        ref.scene.remove(platGhostGroupRef.current);
        disposeGroup(platGhostGroupRef.current);
        platGhostGroupRef.current = null;
      }
    };
  }, [clearPlatformGhost, updatePlatformGhost]);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const state = useStore.getState();
      const tag = (e.target as HTMLElement)?.tagName || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedPartId) { e.preventDefault(); state.removeSelected(); }
      }
      if (e.key === 'Escape') {
        if (state.rotationPreviewEnabled) {
          state.setRotationPreviewEnabled(false);
          state.setRotationPreviewVariants([]);
        }
        state.selectPart(null);
        state.setDraggingPart(null);
        state.setPendingPreset(null);
      }
      if (state.selectedPartId) {
        if (e.key === 'r' || e.key === 'R') state.rotateSelected('y', Math.PI / 2);
        if (e.key === 'q' || e.key === 'Q') state.rotateSelected('y', -Math.PI / 2);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      }
      // G 快捷键：成组/解组
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (state.selectedIds.length > 0) {
          e.preventDefault();
          state.toggleGroup();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {viewportState !== 'ready' && (
        <div className="absolute inset-0 z-[30] grid place-items-center bg-[#f0f4f6]/90">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-6 py-4 text-sm text-slate-700 shadow-md" role="status">
            {viewportState === 'recovering' ? '3D 视窗正在恢复，当前模型已保留。' : '3D 视窗未能恢复，当前模型已保留。'}
            <button type="button" className="rounded-md bg-[#17629c] px-3 py-1.5 text-white" onClick={() => retryViewportRef.current?.()}>
              重试 3D 视窗
            </button>
          </div>
        </div>
      )}
      {snapFeedback && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-[#17455c] px-4 py-2 text-xs font-semibold text-white shadow-lg" role="status">
          ✓ 已吸附到连接位置
        </div>
      )}
      {/* 端点扩展提示：可用扩展点计数 / 成组元件解组提示 */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
        {extCount > 0 && (
          <div className="rounded-full border border-[#4A90D9]/40 bg-white/90 px-3 py-1 text-xs font-medium text-[#2F7FE0] shadow-sm">
            ✓ {extCount} 个可扩展端点，点击半透明元件继续搭建
          </div>
        )}
        {selGroupedHint && (
          <div className="rounded-full border border-[#F7CA45]/60 bg-white/90 px-3 py-1 text-xs text-[#8a6d1a] shadow-sm">
            该元件在成组内，需先「解组」才能显示扩展端点
          </div>
        )}
      </div>
      {/* 框选矩形 */}
      <div
        ref={selectionRectRef}
        data-testid="scene-selection-box"
        className="pointer-events-none absolute z-20 border-2 border-[#4A90D9] bg-[#4A90D9]/15"
        style={{ display: 'none' }}
      />
      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[150px] rounded-md border border-[#E8E8E8] bg-white py-1 shadow-lg"
          style={(() => {
            // 屏幕边界翻转：靠近下边缘则向上展开，靠近右边缘则向左展开，保证菜单完整显示
            const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
            const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
            const MENU_W = 150;
            // 估算菜单高度：更换颜色色块行(约40) + 替换列表项(约28 * 数量) + 成组/删除/取消(约 3*34=102)
            const siblingCount = (() => {
              const p = parts.find((x) => x.id === (ctxMenu.ids[0] || ''));
              if (!p) return 0;
              const d = getPartById(p.partId);
              if (!d || d.directPlacement || (d.category === 'connector' && !d.connectionPoints?.length) || (d.category === 'platform' && !d.platformSpec)) return 0;
              return PARTS_LIBRARY.filter((x) => x.category === d.category && x.id !== d.id &&
                x.id !== 'connector-45deg-nest' && !x.directPlacement && (x.category !== 'connector' || x.connectionPoints?.length)
                && (x.category !== 'platform' || x.platformSpec)).length;
            })();
            const estH = 46 + siblingCount * 28 + 102;
            let left = ctxMenu.x;
            let top = ctxMenu.y;
            if (ctxMenu.x + MENU_W > winW - 8) left = Math.max(8, ctxMenu.x - MENU_W);
            if (ctxMenu.y + estH > winH - 8) top = Math.max(8, ctxMenu.y - estH);
            return { left, top };
          })()}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(() => {
            const menuPrimary = (() => {
              if (!ctxMenu || ctxMenu.ids.length === 0) return null;
              const p = parts.find((x) => x.id === ctxMenu.ids[0]);
              if (!p) return null;
              const d = getPartById(p.partId);
              if (!d) return null;
              const palette = d.colors || (d.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS);
              const siblings = d.directPlacement || (d.category === 'connector' && !d.connectionPoints?.length)
                || (d.category === 'platform' && !d.platformSpec) ? [] : PARTS_LIBRARY.filter(
                  (x) => x.category === d.category && x.id !== d.id && x.id !== 'connector-45deg-nest'
                    && !x.directPlacement && (x.category !== 'connector' || x.connectionPoints?.length)
                    && (x.category !== 'platform' || x.platformSpec)
                );
              return { part: p, def: d, palette, siblings, isPlatform: d.category === 'platform', isStorbox: d.extKind === 'storbox' };
            })();
            if (!menuPrimary) return null;
            return (
              <>
                <div className="px-3 pb-0.5 pt-1.5 text-[11px] text-[#999]">更换颜色</div>
                <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                  {menuPrimary.palette.map((c) => (
                    <button
                      key={c.id}
                      title={c.name}
                      onClick={() => {
                        useStore.getState().updatePartColor(menuPrimary.part.id, c.id);
                        setCtxMenu(null);
                      }}
                      className="h-4 w-4 rounded-full border border-[#E8E8E8] transition hover:scale-110"
                      style={{
                        background: c.hex,
                        boxShadow: menuPrimary.part.colorId === c.id ? '0 0 0 2px #4A90D9' : 'none',
                      }}
                    />
                  ))}
                </div>
                {menuPrimary.def.connectorSpec && (
                  <button
                    onClick={() => {
                      const st = useStore.getState();
                      const cur = menuPrimary.part;
                      const fixed = fitRoofCombo(COMBO_45L.parts, st.parts, cur);
                      if (!fixed) {
                        alert('此处无法放置45°L组合：无法保留已有杆件连接，或组合会与现有构件穿插。请在屋顶檐口的立杆/斜杆端部使用。');
                        setCtxMenu(null);
                        return;
                      }
                      // Solve before mutation; replacement and grouping form one undo step.
                      st._pushHistory();
                      const inserted = fixed.map(p => ({ ...p, id: crypto.randomUUID() }));
                      const groupId = crypto.randomUUID();
                      const groups = st.groups.map(g => ({ ...g,
                        memberIds: g.memberIds.filter(id => id !== cur.id),
                        childGroupIds: g.memberIds.includes(cur.id) ? [...g.childGroupIds, groupId] : g.childGroupIds,
                      }));
                      useStore.setState({
                        parts: [...st.parts.filter(p => p.id !== cur.id), ...inserted],
                        groups: [...groups, { id: groupId, name: COMBO_45L.name, memberIds: inserted.map(p => p.id), childGroupIds: [] }],
                        selectedIds: inserted.map(p => p.id), selectedPartId: inserted[0].id,
                      });
                      setCtxMenu(null);
                    }}
                    className="block w-full px-3 py-1 text-left text-[13px] font-medium text-[#26C281] hover:bg-[#F0F4FA]"
                  >
                    {COMBO_45L.name}
                  </button>
                )}
                {menuPrimary.siblings.length > 0 && (
                  <>
                    <div className="px-3 pb-0.5 pt-1 text-[11px] text-[#999]">替换为同类型</div>
                    {menuPrimary.siblings.map((sib) => {
                      const color = getPartColor(sib, menuPrimary.part.colorId)
                        ?? getPartColor(sib, sib.defaultColor);
                      return (
                      <Popover
                        key={sib.id}
                        placement="right"
                        trigger={['hover', 'focus']}
                        mouseEnterDelay={0.18}
                        destroyOnHidden
                        title={sib.name}
                        content={<div className="w-40"><PartThumbnail part={sib} color={color?.hex ?? '#9CA3AF'} /></div>}
                      >
                      <button
                        type="button"
                        onClick={() => {
                          const st = useStore.getState();
                          st.replacePart(menuPrimary.part.id, sib.id);
                          st.setSelection([menuPrimary.part.id], menuPrimary.part.id);
                          setCtxMenu(null);
                        }}
                        className="block w-full px-3 py-1 text-left text-[13px] text-[#333] hover:bg-[#F0F4FA]"
                      >
                        {sib.name}
                      </button>
                      </Popover>
                    ); })}
                  </>
                )}
                {menuPrimary.def.category === 'bar' && (
                  <>
                    <div className="px-3 pb-0.5 pt-1 text-[11px] text-[#999]">重建</div>
                    <button
                      onClick={() => {
                        const st = useStore.getState();
                        st.replaceBarWithBarConnectorBar(menuPrimary.part.id);
                        setCtxMenu(null);
                      }}
                      className="block w-full px-3 py-1 text-left text-[13px] text-[#333] hover:bg-[#F0F4FA]"
                    >
                      替换为 杆-六通-杆
                    </button>
                  </>
                )}
                {menuPrimary.isPlatform && (
                  <>
                    <div className="px-3 pb-0.5 pt-1 text-[11px] text-[#999]">配件编辑</div>
                    {!menuPrimary.isStorbox && !menuPrimary.def.directPlacement && menuPrimary.def.platformSpec && (
                      <button
                        onClick={() => {
                          const st = useStore.getState();
                          const mirrored = mirrorPlatformTransform(menuPrimary.part, menuPrimary.def, st.parts);
                          if (mirrored) {
                            st.updatePartTransform(menuPrimary.part.id, mirrored.position, mirrored.rotation);
                          } else {
                            window.alert?.('未检测到该板件所在的矩形框架，无法镜像');
                          }
                          setCtxMenu(null);
                        }}
                        className="block w-full px-3 py-1 text-left text-[13px] text-[#333] hover:bg-[#F0F4FA]"
                      >
                        镜像
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const st = useStore.getState();
                        const ids = ctxMenu.ids;
                        const top = ids.length ? getTopGroupOf(st.groups, ids[0]) : undefined;
                        if (top) {
                          st.ungroupGroup(top.id);
                          st.setSelection([], null);
                        } else {
                          st.setSelection(ids, ids[0] || null);
                          st.toggleGroup();
                        }
                        setCtxMenu(null);
                      }}
                      className="block w-full px-3 py-1 text-left text-[13px] text-[#333] hover:bg-[#F0F4FA]"
                    >
                      {(() => {
                        const ids = ctxMenu.ids;
                        const gs = useStore.getState().groups;
                        return ids.length && getTopGroupOf(gs, ids[0]) ? '取消成组' : '成组';
                      })()}
                    </button>
                    <button
                      onClick={() => {
                        const st = useStore.getState();
                        ctxMenu.ids.forEach((id) => st.removePart(id));
                        st.setSelection([], null);
                        setCtxMenu(null);
                      }}
                      className="block w-full px-3 py-1 text-left text-[13px] text-[#EE5A5A] hover:bg-[#FFF0F0]"
                    >
                      删除
                    </button>
                  </>
                )}
                <div className="my-1 h-px bg-[#F0F0F0]" />
              </>
            );
          })()}
          {!(() => {
            if (!ctxMenu || ctxMenu.ids.length === 0) return false;
            const p = parts.find((x) => x.id === ctxMenu.ids[0]);
            if (!p) return false;
            const d = getPartById(p.partId);
            return !!d && d.category === 'platform';
          })() && (
          <>
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] text-[#333] hover:bg-[#F0F4FA]"
            onClick={() => {
              const st = useStore.getState();
              const ids = ctxMenu.ids;
              const top = ids.length ? getTopGroupOf(st.groups, ids[0]) : undefined;
              if (top) {
                st.ungroupGroup(top.id);
                st.setSelection([], null);
              } else {
                st.setSelection(ids, ids[0] || null);
                st.toggleGroup();
              }
              setCtxMenu(null);
            }}
          >
            {(() => {
              const ids = ctxMenu.ids;
              const gs = useStore.getState().groups;
              // 右键命中成组成员即视为选中整个成组物体 → 显示「取消成组」
              return ids.length && getTopGroupOf(gs, ids[0]) ? '取消成组' : '成组';
            })()}
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] text-[#EE5A5A] hover:bg-[#FFF0F0]"
            onClick={() => {
              const st = useStore.getState();
              ctxMenu.ids.forEach((id) => st.removePart(id));
              st.setSelection([], null);
              setCtxMenu(null);
            }}
          >
            删除
          </button>
          </>
          )}
          <button
            className="block w-full px-3 py-1.5 text-left text-[13px] text-[#666] hover:bg-[#F0F4FA]"
            onClick={() => setCtxMenu(null)}
          >
            取消
          </button>
        </div>
      )}
      {!ctxMenu && !paintColor && !pendingPreset && selectedIds.length > 0 && (() => {
        const nestedCombo = groups.find(group => group.childGroupIds.length === 0
          && group.memberIds.length === 2
          && selectedIds.every(id => group.memberIds.includes(id))
          && parts.some(part => group.memberIds.includes(part.id) && part.partId === 'connector-l')
          && parts.some(part => group.memberIds.includes(part.id) && part.partId === 'connector-45deg-nest'));
        const ids = new Set(nestedCombo?.memberIds ?? collectSelectionIds(groups, selectedIds));
        const selection = parts.filter(part => ids.has(part.id));
        if (!selection.length) return null;
        const board = selection.length === 1 ? getPartById(selection[0].partId) : undefined;
        const hasPlatform = selection.some(part => getPartById(part.partId)?.category === 'platform');
        const mirror = board?.category === 'platform' && !!board.platformSpec && !board.directPlacement && board.extKind !== 'storbox';
        if (hasPlatform && !mirror) return null;
        const elbow = selection.find(part => part.partId === 'connector-l');
        const slope = selection.length === 2 && elbow
          ? ports(selection).find(port => port.cpId === 'up45' && selection.some(part => part.id === port.partId && part.partId === 'connector-45deg-nest'))
          : undefined;
        const pivot = selection.length === 1 ? new THREE.Vector3(...selection[0].position) : getSelAABB(selection)?.getCenter(new THREE.Vector3());
        if (!pivot) return null;
        const anchor = slope && elbow ? new THREE.Vector3(...elbow.position).add(new THREE.Vector3(0, 2.5, 0)) : pivot;
        const wheelBar = selection.length === 1 && board?.extKind === 'wheelbar';
        const label = mirror ? '镜像平台板' : slope ? '绕立杆旋转 45°' : wheelBar ? '绕杆轴旋转 45°' : '绕竖直轴旋转 45°';
        return (
          <button
            ref={element => { rotateControl.current = element ? { element, anchor } : null; }}
            type="button"
            className="designer-rotate-step"
            title={label}
            aria-label={label}
            onClick={event => {
              const state = useStore.getState();
              const current = state.parts.filter(part => ids.has(part.id));
              if (current.length !== selection.length) return;
              let updates: PlacedPart[];
              if (mirror) {
                const transform = mirrorPlatformTransform(current[0], board, state.parts);
                if (!transform) {
                  void message.info({ key: 'platform-mirror', content: '未检测到该板件所在的矩形框架，无法镜像。' });
                  return;
                }
                updates = [{ ...current[0], ...transform }];
              } else if (slope) {
                const currentSlope = ports(current).find(port => port.partId === slope.partId && port.cpId === slope.cpId)!;
                const heading = Math.atan2(currentSlope.direction.z, currentSlope.direction.x);
                const result = orientRoofCombo(current, state.parts, heading + Math.PI / 4);
                if (!result.parts) {
                  void message.warning({ key: 'roof-rotation', content: result.error });
                  return;
                }
                updates = result.parts;
              } else if (wheelBar) {
                const part = current[0];
                const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation));
                // Local X is the centerline between the two tube ports.
                orientation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4));
                const rotation = new THREE.Euler().setFromQuaternion(orientation);
                updates = [{ ...part, rotation: [rotation.x, rotation.y, rotation.z] }];
              } else {
                const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4);
                updates = current.map(part => {
                  const position = new THREE.Vector3(...part.position).sub(pivot).applyQuaternion(turn).add(pivot);
                  const rotation = new THREE.Euler().setFromQuaternion(turn.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation))));
                  return { ...part, position: position.toArray() as [number, number, number], rotation: [rotation.x, rotation.y, rotation.z] };
                });
              }
              state._pushHistory();
              const byId = new Map(updates.map(part => [part.id, part]));
              useStore.setState({ parts: state.parts.map(part => byId.get(part.id) ?? part) });
              if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                const icon = event.currentTarget.querySelector('svg');
                icon?.getAnimations().forEach(animation => animation.cancel());
                const transform = mirror ? 'scaleX(-1)' : 'rotate(-42deg)';
                icon?.animate([{ transform }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.15,.85,.25,1)' });
              }
            }}
          >
            {mirror ? <FlipHorizontal2 size={17} aria-hidden="true" /> : <RotateCw size={17} aria-hidden="true" />}
            <span>{mirror ? '镜像' : '转 45°'}</span>
          </button>
        );
      })()}
      {/* 操作轴旁的"组信息"标签：把成组物体视为一个全新物件，可查看/重命名组、快捷取消成组 */}
      {tagGroupId && (() => {
        const g = groups.find((x) => x.id === tagGroupId);
        const name = g ? (g.name || '未命名组') : '';
        const isEditing = editingGroupId === tagGroupId;
        return (
          <div ref={groupTagElRef} className="pointer-events-none absolute left-0 top-0 z-30 will-change-transform">
            <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-[#4A90D9] bg-white px-2 py-1 text-[12px] shadow-md">
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.stopPropagation(); commitRename(); }
                      if (e.key === 'Escape') { e.stopPropagation(); setEditingGroupId(null); }
                    }}
                    onBlur={commitRename}
                    className="w-28 rounded border border-[#4A90D9] px-1 py-0.5 text-[12px] text-[#333] outline-none"
                  />
                  <button onClick={commitRename} className="px-0.5 text-[#26C281] hover:opacity-70" title="确认">✓</button>
                </>
              ) : (
                <>
                  <span className="max-w-[150px] truncate font-medium text-[#333]">{name}</span>
                  <button
                    onClick={() => { setNameDraft(name); setEditingGroupId(tagGroupId); }}
                    className="px-0.5 text-[#4A90D9] hover:opacity-70"
                    title="重命名组"
                  >✎</button>
                  <button
                    onClick={ungroupGroupByTag}
                    className="ml-0.5 rounded bg-[#F0F4FA] px-1.5 py-0.5 text-[#EE5A5A] hover:bg-[#E6EFFB]"
                    title="取消成组"
                  >解组</button>
                </>
              )}
            </div>
          </div>
        );
      })()}
      {/* 点击空白处关闭菜单 */}
      {ctxMenu && (
        <div
          className="fixed inset-0 z-[15]"
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
        />
      )}
    </div>
  );
}

function disposeGroup(obj: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      geometries.add(child.geometry);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach(material => materials.add(material));
    }
  });
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}
