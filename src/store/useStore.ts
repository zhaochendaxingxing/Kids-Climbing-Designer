import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import type { PlacedPart, SceneGroup, DesignProject, DesignDiff, PartDiffItem, ViewMode, PartCategory, PresetUnit } from '@/types/parts';
import { getPartById, getPartColor, PART_COLORS, DEFAULT_FRAME_COLOR } from '@/data/parts';
import { findOptimizedConnector } from '@/lib/construction';

// 内部状态类型
interface InternalState {
  _history: HistoryState;
}

const GRID_SIZE = 10; // 10cm 网格

// 吸附到网格
function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

function snapPosition(pos: [number, number, number]): [number, number, number] {
  return [snapToGrid(pos[0]), snapToGrid(pos[1]), snapToGrid(pos[2])];
}

// ==================== 连接件智能优化 ====================
// 目标：把连接件替换成「接口数 == 实际连入杆件数」、且所有接口方向都能贴合到对应杆件的型号。
// 实现：先算出每个连接件被占用的接口在世界坐标下的方向集合；再在所有轴向连接件中找
//       一个「接口数一致、且可通过旋转把自身接口精确对齐到这些方向」的型号，替换并带上该旋转。

// 把方向向量吸附到最近坐标轴（消除旋转/浮点带来的微分量）：
// 仅当某分量远小于主导分量时归零；真正的斜向（如45°）不会被改动
function snapToAxis(v: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  const m = Math.max(ax, ay, az);
  if (m < 1e-9) return v.clone();
  if (ax === 0 || ax / m < 1e-4) v.x = 0;
  if (ay === 0 || ay / m < 1e-4) v.y = 0;
  if (az === 0 || az / m < 1e-4) v.z = 0;
  return v.normalize();
}

// 计算某连接件被占用接口的世界方向集合（每个被杆件端头贴合的接口对应一个方向）
function connectorUsedWorldDirs(c: PlacedPart, allParts: PlacedPart[], getBarEndPoints: (p: PlacedPart) => { pos: [number, number, number] }[]): THREE.Vector3[] {
  const cdef = getPartById(c.partId);
  if (!cdef || !cdef.connectionPoints) return [];
  const cPos = new THREE.Vector3(c.position[0], c.position[1], c.position[2]);
  const euler = new THREE.Euler(c.rotation[0], c.rotation[1], c.rotation[2]);
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const SOCKET_DIST = 3; // 套筒口到中心的距离
  const out: THREE.Vector3[] = [];
  for (const cp of cdef.connectionPoints) {
    const d = snapToAxis(new THREE.Vector3(cp.direction[0], cp.direction[1], cp.direction[2]).normalize().applyQuaternion(quat));
    const face = cPos.clone().addScaledVector(d, SOCKET_DIST);
    let used = false;
    for (const b of allParts) {
      if (b.id === c.id) continue;
      const bdef = getPartById(b.partId);
      if (!bdef || bdef.category !== 'bar') continue;
      const ends = getBarEndPoints(b); // 每根杆给出 2 个端头 {pos}
      if (ends.length < 2) continue;
      const p0 = new THREE.Vector3(ends[0].pos[0], ends[0].pos[1], ends[0].pos[2]);
      const p1 = new THREE.Vector3(ends[1].pos[0], ends[1].pos[1], ends[1].pos[2]);
      const axis = p1.clone().sub(p0).normalize(); // 杆轴
      if (Math.abs(axis.dot(d)) < 0.7) continue; // 杆轴必须与该接口方向一致
      for (const end of ends) {
        const e = new THREE.Vector3(end.pos[0], end.pos[1], end.pos[2]);
        const atFace = e.distanceTo(face) < 4;
        const towardSide = e.sub(cPos).dot(d) > 0; // 端头在接口的朝向侧（排除反向端）
        if (atFace && towardSide) { used = true; break; }
      }
      if (used) break;
    }
    if (used) out.push(d);
  }
  return out;
}

// ==================== 嵌套分组工具函数 ====================

// 递归收集某组（含所有子组）的全部零件 id
export function collectGroupPartIds(groups: SceneGroup[], groupId: string): string[] {
  const g = groups.find((x) => x.id === groupId);
  if (!g) return [];
  const ids = new Set<string>(g.memberIds);
  for (const cid of g.childGroupIds) collectGroupPartIds(groups, cid).forEach((id) => ids.add(id));
  return [...ids];
}

// 直接子组所属的父组（该组 id 出现在谁的 childGroupIds 中）
export function getParentGroup(groups: SceneGroup[], groupId: string): SceneGroup | undefined {
  return groups.find((g) => g.childGroupIds.includes(groupId));
}

// 零件所在的最顶层组（沿 childGroupIds 向上追溯）；若不属于任何组返回 undefined
export function getTopGroupOf(groups: SceneGroup[], partId: string): SceneGroup | undefined {
  const direct = groups.find((g) => g.memberIds.includes(partId));
  if (!direct) return undefined;
  let top = direct;
  let guard = 0;
  while (guard++ < 100) {
    const p = getParentGroup(groups, top.id);
    if (!p) break;
    top = p;
  }
  return top;
}

// 从一组选中 id 解析出互不重复的"顶层单元"：顶层组 + 独立零件
function resolveTopUnits(groups: SceneGroup[], selectedIds: string[]): { groupIds: string[]; partIds: string[] } {
  const seenGroups = new Set<string>();
  const seenParts = new Set<string>();
  for (const id of selectedIds) {
    const top = getTopGroupOf(groups, id);
    if (top) {
      if (!seenGroups.has(top.id)) seenGroups.add(top.id);
    } else {
      seenParts.add(id);
    }
  }
  return { groupIds: [...seenGroups], partIds: [...seenParts] };
}

const newGroupId = () => `grp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const newPartId = () => `part-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

// 估算一组零件的几何中心（AABB 中心，忽略旋转的近似）
function computeCenter(parts: PlacedPart[]): [number, number, number] {
  if (parts.length === 0) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const def = getPartById(p.partId);
    const hw = (def ? def.size.width : 20) / 2;
    const hh = (def ? def.size.height : 20) / 2;
    const hd = (def ? def.size.depth : 20) / 2;
    minX = Math.min(minX, p.position[0] - hw); maxX = Math.max(maxX, p.position[0] + hw);
    minY = Math.min(minY, p.position[1] - hh); maxY = Math.max(maxY, p.position[1] + hh);
    minZ = Math.min(minZ, p.position[2] - hd); maxZ = Math.max(maxZ, p.position[2] + hd);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

// 地面碰撞：以组内最低物体为边界整体上移，使 minBottom >= 0；不破坏相对位置
function clampGroupToGround(parts: PlacedPart[], memberIds: Set<string>): PlacedPart[] {
  let minBottom = Infinity;
  for (const p of parts) {
    if (!memberIds.has(p.id)) continue;
    const def = getPartById(p.partId);
    const hh = (def ? def.size.height : 20) / 2;
    minBottom = Math.min(minBottom, p.position[1] - hh);
  }
  if (minBottom >= 0 || !isFinite(minBottom)) return parts;
  const lift = -minBottom;
  return parts.map((p) => (memberIds.has(p.id) ? { ...p, position: [p.position[0], p.position[1] + lift, p.position[2]] as [number, number, number] } : p));
}

type SceneSnapshot = { parts: PlacedPart[]; groups: SceneGroup[] };
interface HistoryState {
  past: SceneSnapshot[];
  future: SceneSnapshot[];
}

type PlaceablePreset = Pick<PresetUnit, 'id' | 'name' | 'parts' | 'subgroups' | 'directPlacement'>;

interface SceneState {
  // 场景中的配件
  parts: PlacedPart[];
  selectedPartId: string | null;
  selectedIds: string[];
  groups: SceneGroup[];
  /** Alt 复制时，当前处于“红色半透明幽灵”状态的副本 id（与原物重合时设置） */
  ghostCopyId: string | null;
  setGhostCopy: (id: string | null) => void;
  pendingPreset: PlaceablePreset | null;
  setPendingPreset: (preset: PlaceablePreset | null) => void;
  addPresetGroup: (preset: PlaceablePreset, dropPos: [number, number, number],
    merge?: { replacements: PlacedPart[]; sharedIds: string[] }) => void;
  setSelection: (ids: string[], primaryId?: string | null) => void;
  releaseTick: number;
  bumpRelease: () => void;
  duplicateSelection: () => void;
  toggleGroup: () => void;
  ungroupGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  movePartsByIds: (ids: string[], position: [number, number, number], rotation?: [number, number, number], skipCollision?: boolean) => void;
  setMultiplePositions: (updates: { id: string; position: [number, number, number] }[]) => void;
  batchUpdate: (updates: { id: string; position?: [number, number, number]; rotation?: [number, number, number] }[]) => void;
  // 更新单个零件的位置/旋转（计入历史），用于镜像等整体变换
  updatePartTransform: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  hoveredPartId: string | null;
  
  // 拖拽状态
  draggingPart: { partId: string; colorId: string } | null;
  ghostPosition: [number, number, number] | null;
  
  // 视角
  cameraPosition: [number, number, number];
  
  // 网格设置
  gridSize: number;
  gridVisible: boolean;
  
  // 旋转预览
  rotationPreviewEnabled: boolean;
  rotationPreviewVariants: { euler: [number, number, number] }[];
  hoveredRotationIndex: number | null;
  setRotationPreviewEnabled: (enabled: boolean) => void;
  setRotationPreviewVariants: (variants: { euler: [number, number, number] }[]) => void;
  setHoveredRotationIndex: (index: number | null) => void;
  
  // 交互模式
  interactionMode: 'select' | 'move' | 'idle';
  setInteractionMode: (mode: 'select' | 'move' | 'idle') => void;
  // 变换/生长模式：move = 操作轴编辑（选中显示操作轴、无幽灵）；growth = 生长模式（选中隐藏操作轴、仅显示扩展幽灵）
  gizmoMode: 'move' | 'growth';
  setGizmoMode: (mode: 'move' | 'growth') => void;
  // 建模流程：spec=生成框架 / frame=增加框架(仅杆件+连接件) / accessory=增加配件(平台封面+右键替换)
  workflow: 'spec' | 'frame' | 'accessory';
  setWorkflow: (w: 'spec' | 'frame' | 'accessory') => void;
  // 视角导航模式：none=正常场景交互 / pan=拖拽平移视角 / rotate=拖拽旋转视角
  navMode: 'none' | 'pan' | 'rotate';
  setNavMode: (mode: 'none' | 'pan' | 'rotate') => void;
  // 自动生成基础框架（layers层高 × cols列深；cell格子边长，cm）
  generateFramework: (layers: number, cols: number, depth: number) => void;
  // 油漆桶上色：paintColor=当前上色颜色（null=未启用上色模式）
  paintColor: string | null;
  setPaintColor: (colorId: string | null) => void;
  paintPart: (id: string, colorId: string) => void;
  // 全选同类·点选模式：激活后在场景中点选某一类元件，即可整类全选
  pickSameActive: boolean;
  setPickSameActive: (active: boolean) => void;
  // 一键批量编辑（全选同类后）
  selectByCategory: (category: PartCategory) => void;
  paintSelected: (colorId: string) => void;
  randomColorSelected: (colorIds: readonly string[]) => void;
  replaceSelectedConnectors: (newPartId: string) => void;
  optimizeSelectedConnectors: () => void;
  selectedPartScreenPos: { x: number; y: number } | null;
  setSelectedPartScreenPos: (pos: { x: number; y: number } | null) => void;
  
  // 操作
  addPart: (partId: string, position: [number, number, number], rotation?: [number, number, number], colorId?: string, skipHistory?: boolean, skipCollision?: boolean, roofOutline?: PlacedPart['roofOutline']) => PlacedPart | undefined;
  removePart: (id: string) => void;
  removeSelected: () => void;
  updatePartPosition: (id: string, position: [number, number, number], skipCollision?: boolean) => void;
  updatePartRotation: (id: string, rotation: [number, number, number]) => void;
  updatePartColor: (id: string, colorId: string) => void;
  selectPart: (id: string | null) => void;
  getGroupOf: (id: string) => SceneGroup | undefined;
  setHoveredPart: (id: string | null) => void;
  replacePart: (id: string, newPartId: string) => void;
  replaceBarWithBarConnectorBar: (id: string) => void;
  
  setDraggingPart: (part: { partId: string; colorId: string } | null) => void;
  setGhostPosition: (pos: [number, number, number] | null) => void;
  
  rotateSelected: (axis: 'x' | 'y' | 'z', angle: number) => void;
  moveSelected: (delta: [number, number, number]) => void;
  
  // 转接头连接
  getBarEndPoints: (part: PlacedPart) => { pos: [number, number, number]; dir: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-' }[];
  snapConnectorToBars: (connectorId: string) => void;
  addBarFromConnector: (connectorId: string, partId: string, direction: [number, number, number]) => void;
  getConnectorConnectionCount: (connectorId: string) => number;
  
  // 撤销/重做
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  
  // 历史记录辅助
  _pushHistory: () => void;
  
  // 批量操作
  clearScene: () => void;
  addParts: (parts: PlacedPart[], basePosition?: [number, number, number]) => void;
  
  // 碰撞检测
  checkCollision: (part: PlacedPart, excludeId?: string) => boolean;
}

interface ProjectState {
  // 方案列表
  projects: DesignProject[];
  currentProjectId: string | null;
  savedPartsKey: string;
  
  // 版本对比
  viewMode: ViewMode;
  diffResult: DesignDiff | null;
  
  // 操作
  loadProjects: () => void;
  saveProject: (name?: string) => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  newProject: () => void;
  getCurrentProject: () => DesignProject | null;
  
  // 版本对比
  startCompare: (beforeId: string, afterId: string) => void;
  exitCompare: () => void;
  computeDiff: (oldProject: DesignProject, newProject: DesignProject) => DesignDiff;
  
  // 导出
  exportJSON: () => string;
  exportCSV: () => string;
  getPartsSummary: () => { category: PartCategory; partId: string; partName: string; count: number }[];
}

type StoreState = SceneState & ProjectState;

const STORAGE_KEY = 'climbing-frame-projects';
const CURRENT_KEY = 'climbing-frame-current';

// 初始空方案
function createEmptyProject(): DesignProject {
  const now = Date.now();
  return {
    id: uuidv4(),
    name: '未命名方案',
    createdAt: now,
    updatedAt: now,
    parts: [],
  };
}

// 碰撞检测：基于AABB包围盒
function getAABB(part: PlacedPart): { min: [number, number, number]; max: [number, number, number] } {
  const def = getPartById(part.partId);
  if (!def) {
    return { min: part.position, max: part.position };
  }
  const { width, height, depth } = def.size;
  const [x, y, z] = part.position;
  // 简化：假设不考虑旋转（仅Y轴旋转需要处理，这里先简化为AABB）
  // 对于Y轴90度旋转，交换width和depth
  const ry = part.rotation[1];
  const normalizedRy = ((ry % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const isRotated = Math.abs(Math.round(normalizedRy / (Math.PI / 2)) % 2) === 1;
  
  const w = isRotated ? depth : width;
  const d = isRotated ? width : depth;
  
  return {
    min: [x - w / 2, y - height / 2, z - d / 2],
    max: [x + w / 2, y + height / 2, z + d / 2],
  };
}

function aabbIntersect(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] }
): boolean {
  return (
    a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
    a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
    a.min[2] < b.max[2] && a.max[2] > b.min[2]
  );
}

export const useStore = create<StoreState>((set, get) => ({
  // ====== 初始状态 ======
  parts: [],
  selectedPartId: null,
  selectedIds: [],
  releaseTick: 0,
  groups: [],
  hoveredPartId: null,
  draggingPart: null,
  ghostPosition: null,
  ghostCopyId: null,
  pendingPreset: null,
  cameraPosition: [150, 150, 200],
  gridSize: GRID_SIZE,
  gridVisible: true,
  rotationPreviewEnabled: false,
  rotationPreviewVariants: [],
  hoveredRotationIndex: null,
  interactionMode: 'select',
  gizmoMode: 'growth',
  workflow: 'spec',
  navMode: 'none',
  paintColor: null,
  pickSameActive: false,
  selectedPartScreenPos: null,
  canUndo: false,
  canRedo: false,
  
  projects: [],
  currentProjectId: null,
  savedPartsKey: STORAGE_KEY,
  
  viewMode: 'normal',
  diffResult: null,
  
  // ====== 历史记录 ======
  _history: { past: [], future: [] } as HistoryState,
  
  _pushHistory: () => {
    const state = get();
    const history = (state as unknown as InternalState)._history as HistoryState;
    history.past.push(JSON.parse(JSON.stringify({ parts: state.parts, groups: state.groups })));
    if (history.past.length > 50) history.past.shift();
    history.future = [];
    set({ canUndo: history.past.length > 0, canRedo: false });
  },
  
  // ====== 配件操作 ======
  addPart: (partId, position, rotation, colorId, skipHistory = false, skipCollision = false, roofOutline) => {
    const state = get();
    const def = getPartById(partId);
    if (!def) {
      console.warn(`[addPart] 未找到配件定义: ${partId}`);
      return;
    }
    
    const newPart: PlacedPart = {
      id: uuidv4(),
      partId,
      // 吸附命中时位置已精确对齐，跳过网格吸附
      position: !skipCollision ? snapPosition(position) : position,
      rotation: rotation || [0, 0, 0],
      colorId: colorId || def.defaultColor,
      ...(roofOutline && { roofOutline }),
    };
    
    // 碰撞检测（吸附命中时允许嵌套重叠，跳过检测）
    if (!skipCollision && state.checkCollision(newPart)) {
      console.warn(`[addPart] 碰撞拦截，未放置: ${partId} @ (${position[0]}, ${position[1]}, ${position[2]})`);
      return;
    }
    
    if (!skipHistory) state._pushHistory();
    const newParts = [...state.parts, newPart];
    
    set({ parts: newParts, selectedPartId: newPart.id });
    return newPart;
  },
  
  removePart: (id: string) => {
    const state = get();
    state._pushHistory();
    set({
      parts: state.parts.filter((p) => p.id !== id),
      selectedPartId: state.selectedPartId === id ? null : state.selectedPartId,
    });
  },
  
  removeSelected: () => {
    const state = get();
    if (state.selectedIds.length === 0) return;
    state._pushHistory();
    const { groupIds, partIds } = resolveTopUnits(state.groups, state.selectedIds);

    // 收集所有将被删除的零件 id：独立零件 + 被选中顶层组的全部后代
    const toDelete = new Set<string>(partIds);
    for (const gid of groupIds) collectGroupPartIds(state.groups, gid).forEach((id) => toDelete.add(id));

    // 删除涉及这些零件的组（直接组成员或含被删子组的组）
    let groups = state.groups.filter((g) => {
      const memberAlive = g.memberIds.filter((m) => !toDelete.has(m));
      const childAlive = g.childGroupIds;
      return memberAlive.length > 0 || childAlive.length > 0;
    });
    // 清理组引用中被删的成员与不存在的子组
    groups = groups.map((g) => ({
      ...g,
      memberIds: g.memberIds.filter((m) => !toDelete.has(m)),
      childGroupIds: g.childGroupIds.filter((c) => groups.some((x) => x.id === c)),
    }));
    groups = groups.filter((g) => g.memberIds.length > 0 || g.childGroupIds.length > 0);

    set({
      parts: state.parts.filter((p) => !toDelete.has(p.id)),
      selectedPartId: null,
      selectedIds: [],
      groups,
    });
  },
  
  updatePartPosition: (id: string, position: [number, number, number], skipCollision = false) => {
    const state = get();
    // 吸附命中时位置已精确对齐，跳过网格吸附
    const snappedPos = !skipCollision ? snapPosition(position) : position;
    
    // 检查碰撞（吸附命中时允许嵌套重叠，跳过检测）
    const part = state.parts.find((p) => p.id === id);
    if (!part) return;
    
    const testPart = { ...part, position: snappedPos };
    if (!skipCollision && state.checkCollision(testPart, id)) return;
    
    set({
      parts: state.parts.map((p) =>
        p.id === id ? { ...p, position: snappedPos } : p
      ),
    });
  },
  
  updatePartRotation: (id: string, rotation: [number, number, number]) => {
    const state = get();
    set({
      parts: state.parts.map((p) =>
        p.id === id ? { ...p, rotation } : p
      ),
    });
  },
  
  updatePartColor: (id: string, colorId: string) => {
    const state = get();
    set({
      parts: state.parts.map((p) =>
        p.id === id ? { ...p, colorId } : p
      ),
    });
  },
  
  selectPart: (id: string | null) => {
    set({ selectedPartId: id, selectedIds: id ? [id] : [] });
  },

  bumpRelease: () => {
    set({ releaseTick: get().releaseTick + 1 });
  },

  setSelection: (ids: string[], primaryId?: string | null) => {
    const s = get();
    const finalIds = s.parts.length ? ids.filter((id) => s.parts.some((p) => p.id === id)) : ids;
    set({
      selectedIds: finalIds,
      selectedPartId: primaryId === undefined ? (finalIds.length ? finalIds[finalIds.length - 1] : null) : primaryId,
    });
  },

  getGroupOf: (id: string) => get().groups.find((g) => g.memberIds.includes(id)),

  toggleGroup: () => {
    const s = get();
    if (s.selectedIds.length === 0) return;
    const { groupIds, partIds } = resolveTopUnits(s.groups, s.selectedIds);

    // 情形A：恰好选中单个顶层组的全部后代 → 解组该组一层（各物体恢复成组前状态）
    if (groupIds.length === 1 && partIds.length === 0) {
      const topId = groupIds[0];
      const top = s.groups.find((g) => g.id === topId);
      if (top) {
        const descendants = collectGroupPartIds(s.groups, topId);
        const allSelCovered = descendants.length > 0 && descendants.every((id) => s.selectedIds.includes(id)) && s.selectedIds.length === descendants.length;
        if (allSelCovered) {
          const parent = getParentGroup(s.groups, topId);
          let groups = s.groups.filter((g) => g.id !== topId);
          if (parent) {
            // 把被解组的成员与子组提升到父组
            groups = groups.map((g) =>
              g.id === parent.id
                ? {
                    ...g,
                    memberIds: [...g.memberIds, ...top.memberIds].filter((id, i, arr) => arr.indexOf(id) === i),
                    childGroupIds: [...g.childGroupIds.filter((c) => c !== topId), ...top.childGroupIds],
                  }
                : g,
            );
          } else {
            // 无父组：memberIds 恢复为独立零件（无需改 parts 结构），childGroupIds 提升为顶层组
          }
          let cleaned = groups.filter((g) => g.memberIds.length > 0 || g.childGroupIds.length > 0);
          // 清理不存在子组引用的孤立引用
          cleaned = cleaned.map((g) => ({ ...g, childGroupIds: g.childGroupIds.filter((c) => cleaned.some((x) => x.id === c)) }));
          // 选中原组的成员（单选主件），便于继续编辑
          const memberIds = top.memberIds.length ? top.memberIds : descendants;
          set({ groups: cleaned, selectedIds: memberIds, selectedPartId: memberIds[0] || null });
          return;
        }
      }
    }

    // 情形B：否则将顶层单元组合成大组（可含子组，实现嵌套）
    // 成组物体未加入新（独立未成组）物体时，不可再次成组
    if (partIds.length === 0) return;
    const gid = newGroupId();
    const newGroup: SceneGroup = { id: gid, memberIds: partIds, childGroupIds: groupIds };
    const groups = [...s.groups, newGroup];
    const allIds = collectGroupPartIds(groups, gid);
    set({ groups, selectedIds: allIds, selectedPartId: allIds.length ? allIds[0] : null });
  },

  // Alt 复制：复制选中内容（独立零件或整个顶层组，含嵌套结构），保持相对位置，并把选中切到副本
  duplicateSelection: () => {
    const state = get();
    if (state.selectedIds.length === 0) return;
    const { groupIds, partIds } = resolveTopUnits(state.groups, state.selectedIds);
    state._pushHistory();

    const workingParts = [...state.parts];
    const newGroups: SceneGroup[] = [];
    const oldPartToNew = new Map<string, string>();
    const oldGroupToNew = new Map<string, string>();

    // 计算整体偏移（向右前方偏移，避免与原物重叠）
    const firstPart = state.parts.find((p) => p.id === partIds[0] || collectGroupPartIds(state.groups, groupIds[0] || '').includes(p.id));
    const offset: [number, number, number] = firstPart ? [firstPart.position[0] + 30, 0, firstPart.position[2] + 30] : [30, 0, 30];
    const offsetVec = new THREE.Vector3(offset[0], offset[1], offset[2]);

    // 深拷贝单个零件
    const clonePart = (oldPart: PlacedPart): string => {
      const nid = newPartId();
      oldPartToNew.set(oldPart.id, nid);
      const p = new THREE.Vector3(oldPart.position[0], oldPart.position[1], oldPart.position[2]).add(offsetVec);
      workingParts.push({
        ...oldPart,
        id: nid,
        position: [p.x, Math.max(p.y, 0), p.z],
      });
      return nid;
    };

    // 深拷贝组树（含嵌套），返回新组 id
    const cloneGroupTree = (g: SceneGroup): string => {
      const existing = oldGroupToNew.get(g.id);
      if (existing) return existing;
      const ngid = newGroupId();
      oldGroupToNew.set(g.id, ngid);
      const newMembers = g.memberIds.map((mid) => {
        const op = workingParts.find((p) => p.id === mid);
        return op ? clonePart(op) : '';
      }).filter(Boolean);
      let children: string[] = [];
      children = g.childGroupIds.map((cid) => {
        const cg = state.groups.find((x) => x.id === cid);
        return cg ? cloneGroupTree(cg) : '';
      }).filter(Boolean);
      const ng: SceneGroup = { id: ngid, memberIds: newMembers, childGroupIds: children };
      newGroups.push(ng);
      return ngid;
    };

    for (const gid of groupIds) {
      const g = state.groups.find((x) => x.id === gid);
      if (g) cloneGroupTree(g);
    }
    for (const pid of partIds) {
      const op = state.parts.find((p) => p.id === pid);
      if (op) clonePart(op);
    }

    const newSel = workingParts.filter((p) => oldPartToNew.has(p.id)).map((p) => p.id);
    set({
      parts: workingParts,
      groups: [...state.groups, ...newGroups],
      selectedIds: newSel,
      selectedPartId: newSel.length ? newSel[0] : null,
    });
  },

  // 直接解组指定顶层组：成员提升到父级或恢复为独立零件，子组提升一层。用于右键菜单「取消成组」
  ungroupGroup: (groupId: string) => {
    const s = get();
    const top = s.groups.find((g) => g.id === groupId);
    if (!top) return;
    const parent = s.groups.find((g) => g.childGroupIds.includes(groupId));
    let groups = s.groups.filter((g) => g.id !== groupId);
    if (parent) {
      groups = groups.map((g) =>
        g.id === parent.id
          ? {
              ...g,
              memberIds: [...g.memberIds, ...top.memberIds],
              childGroupIds: g.childGroupIds.filter((c) => c !== groupId).concat(top.childGroupIds),
            }
          : g
      );
    }
    // 清理空组
    groups = groups.filter((g) => g.memberIds.length > 0 || g.childGroupIds.length > 0);
    set({ groups });
  },

  renameGroup: (groupId: string, name: string) => {
    const s = get();
    const trimmed = (name || '').trim();
    const groups = s.groups.map((g) =>
      g.id === groupId ? { ...g, name: trimmed || '未命名组' } : g
    );
    set({ groups });
  },

  movePartsByIds: (ids: string[], position: [number, number, number], rotation?: [number, number, number], skipCollision = false) => {
    const state = get();
    const idSet = new Set(ids);
    const parts = state.parts.map((p) => {
      if (!idSet.has(p.id)) return p;
      const np = {
        ...p,
        position: skipCollision ? position : snapPosition(position),
        ...(rotation ? { rotation } : {}),
      };
      return np;
    });
    // 碰撞检测：若任一目标碰撞（且未忽略），回滚
    if (!skipCollision) {
      const newSet = parts.filter((p) => idSet.has(p.id));
      const others = parts.filter((p) => !idSet.has(p.id));
      for (const np of newSet) {
        if (others.some((o) => aabbIntersect(getAABB(np), getAABB(o)))) return;
      }
    }
    state._pushHistory();
    set({ parts });
  },

  // 一次性设置多个部件的绝对位置（用于成组整体平移，不推送历史，拖拽过程中持续调用）
  setMultiplePositions: (updates: { id: string; position: [number, number, number] }[]) => {
    const state = get();
    const map = new Map(updates.map((u) => [u.id, u.position]));
    set({
      parts: state.parts.map((p) => (map.has(p.id) ? { ...p, position: map.get(p.id)! } : p)),
    });
  },

  // 批量更新多个零件的位移与旋转（不推历史，拖拽过程中持续调用）
  batchUpdate: (updates) => {
    const state = get();
    const posMap = new Map<string, [number, number, number]>();
    const rotMap = new Map<string, [number, number, number]>();
    for (const u of updates) {
      if (u.position) posMap.set(u.id, u.position);
      if (u.rotation) rotMap.set(u.id, u.rotation);
    }
    set({
      parts: state.parts.map((p) => {
        const pos = posMap.get(p.id);
        const rot = rotMap.get(p.id);
        if (!pos && !rot) return p;
        return { ...p, ...(pos ? { position: pos } : {}), ...(rot ? { rotation: rot } : {}) };
      }),
    });
  },

  // 更新单个零件的位置/旋转并计入历史（镜像等一次性整体变换）
  updatePartTransform: (id, position, rotation) => {
    const state = get();
    if (!state.parts.some((p) => p.id === id)) return;
    state._pushHistory();
    set({
      parts: state.parts.map((p) => (p.id === id ? { ...p, position, rotation } : p)),
    });
  },

  setHoveredPart: (id: string | null) => {
    set({ hoveredPartId: id });
  },
  
  replacePart: (id: string, newPartId: string) => {
    const state = get();
    const part = state.parts.find((p) => p.id === id);
    if (!part || part.partId === newPartId) return;
    const def = getPartById(newPartId);
    if (!def) return;
    const keepColor = !!getPartColor(def, part.colorId);
    // 杆件长度变化时，让新杆自动对齐到一端（默认对齐到已连接的一端；两端未连接则对齐 -X 端）
    let newPosition: [number, number, number] | undefined;
    const oldDef = getPartById(part.partId);
    if (oldDef && oldDef.category === 'bar' && def.category === 'bar') {
      const oldLen = oldDef.barSpec?.length ?? oldDef.size.width;
      const newLen = def.barSpec?.length ?? def.size.width;
      if (oldLen !== newLen) {
        const halfOld = oldLen / 2;
        const euler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
        const quat = new THREE.Quaternion().setFromEuler(euler);
        const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(quat); // 杆轴方向
        // 计算旧杆两端世界坐标
        const pos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
        const minusEnd = pos.clone().addScaledVector(dir, -halfOld); // -X 端
        const plusEnd = pos.clone().addScaledVector(dir, halfOld); // +X 端
        // 检测两端是否已连接连接件（连接件中心到端头足够近）
        const isNearConnector = (end: THREE.Vector3) =>
          state.parts.some((o) => {
            if (o.id === id) return false;
            if (getPartById(o.partId)?.category !== 'connector') return false;
            return o.position ? end.distanceTo(new THREE.Vector3(o.position[0], o.position[1], o.position[2])) < 8 : false;
          });
        const anchoredMinus = isNearConnector(minusEnd);
        const anchoredPlus = isNearConnector(plusEnd);
        // 需要沿局部 X 的平移量 delta（正值指向 +X）：保持 -X 端 → (newLen-oldLen)/2；保持 +X 端 → (oldLen-newLen)/2
        const delta = (anchoredPlus && !anchoredMinus) ? (oldLen - newLen) / 2 : (newLen - oldLen) / 2;
        const shift = new THREE.Vector3(delta, 0, 0).applyQuaternion(quat);
        newPosition = [pos.x + shift.x, pos.y + shift.y, pos.z + shift.z] as [number, number, number];
      }
    }
    // 平台板 ↔ 收纳盒：调整 Y 使翻边落在杆顶、盒身垂入框架
    if (!newPosition && oldDef && oldDef.category === 'platform' && def.category === 'platform') {
      const oldSpec = oldDef.platformSpec;
      const newSpec = def.platformSpec;
      if (oldSpec && newSpec) {
        const oldIsStorbox = !!oldSpec.flangeWidth;
        const newIsStorbox = !!newSpec.flangeWidth;
        if (oldIsStorbox !== newIsStorbox) {
          const oldY = part.position[1];
          let quadYPlusBarR: number;
          if (oldIsStorbox) {
            quadYPlusBarR = oldY + (oldSpec.rimHeight ?? 0) - 0.15;
          } else {
            quadYPlusBarR = oldY - (oldSpec.plateThickness ?? 2) / 2;
          }
          let newY: number;
          if (newIsStorbox) {
            newY = quadYPlusBarR - (newSpec.rimHeight ?? 0) + 0.15;
          } else {
            newY = quadYPlusBarR + (newSpec.plateThickness ?? 2) / 2;
          }
          newPosition = [part.position[0], newY, part.position[2]];
        }
      }
    }
    state._pushHistory();
    set({
      parts: state.parts.map((p) =>
        p.id === id
          ? {
              ...p,
              partId: newPartId,
              position: newPosition ?? p.position,
              colorId: keepColor ? p.colorId : def.defaultColor,
            }
          : p
      ),
    });
  },

  // 把一根杆件替换为「15cm杆 + 立六通 + 15cm杆」三段结构（两端对齐原杆端点，整体保持原跨度）
  replaceBarWithBarConnectorBar: (id) => {
    const st = get();
    const part = st.parts.find((p) => p.id === id);
    if (!part) return;
    const def = getPartById(part.partId);
    if (!def || def.category !== 'bar') return;
    const len = def.barSpec?.length ?? def.size.width;
    const euler = new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]);
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const pos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
    const half = len / 2;
    const half15 = 7.5; // 15cm 杆半长
    // 局部 X 偏移 → 世界坐标
    const shift = (dx: number): [number, number, number] => {
      const p = new THREE.Vector3(dx, 0, 0).applyQuaternion(quat);
      return [pos.x + p.x, pos.y + p.y, pos.z + p.z];
    };
    const newParts: PlacedPart[] = [
      { id: uuidv4(), partId: 'bar-15', position: shift(-(half - half15)), rotation: part.rotation, colorId: part.colorId },
      { id: uuidv4(), partId: 'connector-v6', position: [pos.x, pos.y, pos.z], rotation: part.rotation, colorId: 'black' },
      { id: uuidv4(), partId: 'bar-15', position: shift(half - half15), rotation: part.rotation, colorId: part.colorId },
    ];
    st._pushHistory();
    const ids = newParts.map((p) => p.id);
    // 从所有分组中摘除被替换的旧杆（避免残留引用导致渲染/成组异常）
    const groups = st.groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }));
    set({
      parts: [...st.parts.filter((p) => p.id !== id), ...newParts],
      groups: groups.filter((g) => g.memberIds.length > 0 || g.childGroupIds.length > 0),
      selectedIds: ids,
      selectedPartId: ids[0],
    });
    // 成组并命名，使三段结构可整体移动/生长
    get().toggleGroup();
    const s2 = get();
    const top = getTopGroupOf(s2.groups, ids[0]);
    if (top) {
      set({ groups: s2.groups.map((g) => (g.id === top.id ? { ...g, name: '杆-六通-杆' } : g)) });
    }
  },
  
  setInteractionMode: (mode: 'select' | 'move' | 'idle') => {
    set({ interactionMode: mode });
  },

  setGizmoMode: (mode: 'move' | 'growth') => {
    set({ gizmoMode: mode });
  },

  setNavMode: (mode: 'none' | 'pan' | 'rotate') => {
    // 进入视角导航模式时退出其他点选/上色模式，避免干扰
    if (mode !== 'none') {
      set({ navMode: mode, paintColor: null, pickSameActive: false });
    } else {
      set({ navMode: mode });
    }
  },

  setWorkflow: (w: 'spec' | 'frame' | 'accessory') => {
    set({ workflow: w });
    // 各阶段的生长能力由 workflow 状态机控制（扩展幽灵仅 frame、平台板 ghost 仅 accessory、spec 全部关闭），
    // 因此不再强制切换 gizmoMode：accessory 阶段需保持 growth 才会出平台板封面 ghost。
  },

  generateFramework: (layers: number, cols: number, depth: number) => {
    const state = get();
    state._pushHistory();
    // 清空现有零件
    set({ parts: [], groups: [], selectedIds: [], selectedPartId: null });
    const next: PlacedPart[] = [];
    const add = (partId: string, position: [number, number, number], rotation?: [number, number, number], colorId?: string) => {
      const defaultColor = getPartById(partId)?.category === 'connector' ? 'black' : DEFAULT_FRAME_COLOR.id;
      next.push({ id: uuidv4(), partId, position, rotation: rotation || [0, 0, 0], colorId: colorId || defaultColor });
    };
    // 格子边长：35cm 杆 + 连接件贴合（CONN_POINT_DIST*2 = 5cm）≈ 40cm
    const cell = 40;
    // 用黑色立六通作为框架节点，杆件使用默认框架色。
    for (let z = 0; z <= depth; z++) {
      for (let x = 0; x <= cols; x++) {
        for (let y = 0; y <= layers; y++) {
          add('connector-v6', [x * cell, y * cell, z * cell], undefined, 'black');
        }
      }
    }
    // 沿 X 的杆件（每个水平层、每个 z 行）
    for (let z = 0; z <= depth; z++) {
      for (let y = 0; y <= layers; y++) {
        for (let x = 0; x < cols; x++) {
          add('bar-35', [x * cell + cell / 2, y * cell, z * cell], [0, 0, 0]);
        }
      }
    }
    // 沿 Z 的杆件（绕 Y 90°）
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y <= layers; y++) {
        for (let x = 0; x <= cols; x++) {
          add('bar-35', [x * cell, y * cell, z * cell + cell / 2], [0, Math.PI / 2, 0]);
        }
      }
    }
    // 沿 Y 的竖向杆件（绕 Z 90°）
    for (let z = 0; z <= depth; z++) {
      for (let x = 0; x <= cols; x++) {
        for (let y = 0; y < layers; y++) {
          add('bar-35', [x * cell, y * cell + cell / 2, z * cell], [0, 0, Math.PI / 2]);
        }
      }
    }
    set({ parts: next });
  },

  setPaintColor: (colorId: string | null) => {
    set({ paintColor: colorId });
  },

  setPickSameActive: (active: boolean) => {
    set({ pickSameActive: active });
  },

  paintPart: (id: string, colorId: string) => {
    const s = get();
    s._pushHistory();
    set({
      parts: s.parts.map((p) => (p.id === id ? { ...p, colorId } : p)),
    });
  },

  selectByCategory: (category: PartCategory) => {
    const s = get();
    const ids = s.parts
      .filter((p) => getPartById(p.partId)?.category === category)
      .map((p) => p.id);
    s.setSelection(ids, ids.length ? ids[ids.length - 1] : null);
  },

  paintSelected: (colorId: string) => {
    const s = get();
    const sel = new Set(s.selectedIds);
    const affected = s.parts.some((p) => {
      if (!sel.has(p.id)) return false;
      const def = getPartById(p.partId);
      return def && (def.category === 'bar' || def.category === 'platform');
    });
    if (!affected) return;
    s._pushHistory();
    set({
      parts: s.parts.map((p) => {
        if (!sel.has(p.id)) return p;
        const def = getPartById(p.partId);
        if (!def || (def.category !== 'bar' && def.category !== 'platform')) return p;
        return { ...p, colorId };
      }),
    });
  },

  randomColorSelected: (colorIds) => {
    const palette = PART_COLORS.filter(color => colorIds.includes(color.id));
    if (!palette.length) return;
    const s = get();
    const sel = new Set(s.selectedIds);
    const affected = s.parts.some((p) => {
      if (!sel.has(p.id)) return false;
      const def = getPartById(p.partId);
      return def && (def.category === 'bar' || def.category === 'platform');
    });
    if (!affected) return;
    s._pushHistory();
    set({
      parts: s.parts.map((p) => {
        if (!sel.has(p.id)) return p;
        const def = getPartById(p.partId);
        if (!def || (def.category !== 'bar' && def.category !== 'platform')) return p;
        const rand = palette[Math.floor(Math.random() * palette.length)];
        return { ...p, colorId: rand.id };
      }),
    });
  },

  replaceSelectedConnectors: (newPartId: string) => {
    const s = get();
    const sel = new Set(s.selectedIds);
    const def = getPartById(newPartId);
    if (!def?.connectorSpec) return;
    const affected = s.parts.some(part => sel.has(part.id) && getPartById(part.partId)?.connectorSpec);
    if (!affected) return;
    s._pushHistory();
    set({
      parts: s.parts.map((p) => {
        if (!sel.has(p.id)) return p;
        const cdef = getPartById(p.partId);
        if (!cdef?.connectorSpec || p.partId === newPartId) return p;
        const keep = (def.colors || []).some((c) => c.id === p.colorId);
        return { ...p, partId: newPartId, colorId: keep ? p.colorId : def.defaultColor };
      }),
    });
  },

  optimizeSelectedConnectors: () => {
    const s = get();
    const sel = new Set(s.selectedIds);
    const hasConnector = s.parts.some((p) => sel.has(p.id) && getPartById(p.partId)?.category === 'connector');
    if (!hasConnector) return;
    const gbe = (p: PlacedPart) => get().getBarEndPoints(p);
    let changed = false;
    const newParts = s.parts.map((p) => {
      if (!sel.has(p.id) || getPartById(p.partId)?.category !== 'connector') return p;
      const used = connectorUsedWorldDirs(p, s.parts, gbe);
      const target = findOptimizedConnector(used);
      if (process.env.NODE_ENV !== 'production') {
        // 供调试：打印每个被选连接件的占用方向与其拟替换目标
        console.debug('[optimize]', p.partId, '@', p.position, 'used=', used.map((d) => d.toArray()), '->', target ? target.partId : null);
      }
      if (!target) return p;
      const def = getPartById(target.partId);
      if (!def || target.partId === p.partId) return p;
      changed = true;
      const keep = (def.colors || []).some((c) => c.id === p.colorId);
      return {
        ...p,
        partId: target.partId,
        rotation: [target.euler.x, target.euler.y, target.euler.z] as [number, number, number],
        colorId: keep ? p.colorId : def.defaultColor,
      };
    });
    if (!changed) return;
    s._pushHistory();
    set({ parts: newParts });
  },
  
  setSelectedPartScreenPos: (pos: { x: number; y: number } | null) => {
    set({ selectedPartScreenPos: pos });
  },
  
  setRotationPreviewEnabled: (enabled: boolean) => {
    set({ rotationPreviewEnabled: enabled });
  },
  
  setRotationPreviewVariants: (variants: { euler: [number, number, number] }[]) => {
    set({ rotationPreviewVariants: variants });
  },
  
  setHoveredRotationIndex: (index: number | null) => {
    set({ hoveredRotationIndex: index });
  },
  
  
  setDraggingPart: (part: { partId: string; colorId: string } | null) => {
    set({ draggingPart: part, ghostPosition: part ? [0, 10, 0] : null,
      ...(part && { pendingPreset: null, selectedIds: [], selectedPartId: null,
        paintColor: null, pickSameActive: false, navMode: 'none' as const }) });
  },
  
  setGhostCopy: (id: string | null) => {
    set({ ghostCopyId: id });
  },
  
  setPendingPreset: (preset) => {
    if (preset) {
      set({ pendingPreset: preset, draggingPart: null, selectedIds: [], selectedPartId: null,
        navMode: 'none', paintColor: null, pickSameActive: false });
    } else {
      set({ pendingPreset: null });
    }
  },
  
  addPresetGroup: (preset, dropPos, merge) => {
    const state = get();
    if (!preset.parts.length) return;
    state._pushHistory();
    const newParts: PlacedPart[] = preset.parts.map((p) => ({
      ...p,
      id: uuidv4(),
      position: [
        p.position[0] + dropPos[0],
        p.position[1] + dropPos[1],
        p.position[2] + dropPos[2],
      ] as [number, number, number],
    }));
    const ids = newParts.map((p) => p.id);
    const placedId = new Map(preset.parts.map((part, index) => [part.id, ids[index]]));
    const subgroups = (preset.subgroups ?? []).map((group): SceneGroup => ({
      id: newGroupId(),
      name: group.name,
      memberIds: group.memberIds.map(id => placedId.get(id)!).filter(Boolean),
      childGroupIds: [],
    })).filter(group => group.memberIds.length > 0);
    const subgroupMembers = new Set(subgroups.flatMap(group => group.memberIds));
    const joinedGroups = new Set((merge?.sharedIds ?? []).flatMap(id => {
      const group = getTopGroupOf(state.groups, id);
      return group ? [group.id] : [];
    }));
    const looseShared = (merge?.sharedIds ?? []).filter(id => !getTopGroupOf(state.groups, id));
    const replacements = new Map(merge?.replacements.map(part => [part.id, part]));
    const group: SceneGroup = {
      id: newGroupId(),
      name: preset.name,
      memberIds: [...ids.filter(id => !subgroupMembers.has(id)), ...looseShared],
      childGroupIds: [...subgroups.map(child => child.id), ...joinedGroups],
    };
    const groups = [...state.groups, ...subgroups, group];
    set({
      parts: [...state.parts.map(part => replacements.get(part.id) ?? part), ...newParts],
      groups,
      pendingPreset: null,
      selectedIds: collectGroupPartIds(groups, group.id),
      selectedPartId: ids[0],
    });
  },
  
  setGhostPosition: (pos: [number, number, number] | null) => {
    if (!pos) {
      set({ ghostPosition: null });
      return;
    }
    const snappedPos = snapPosition(pos);
    set({ ghostPosition: snappedPos });
  },
  
  rotateSelected: (axis: 'x' | 'y' | 'z', angle: number) => {
    const state = get();
    const ids = state.selectedIds.length > 0 ? state.selectedIds : (state.selectedPartId ? [state.selectedPartId] : []);
    if (ids.length === 0) return;
    const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

    // 若选中内容属于组 → 整组绕几何中心旋转（保持相对位置）
    const { groupIds } = resolveTopUnits(state.groups, ids);
    if (groupIds.length > 0) {
      const memberIds = new Set<string>();
      for (const gid of groupIds) collectGroupPartIds(state.groups, gid).forEach((id) => memberIds.add(id));
      const members = state.parts.filter((p) => memberIds.has(p.id));
      if (members.length === 0) return;
      // 计算几何中心（AABB 中心）
      const center = computeCenter(members);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      state._pushHistory();
      const newParts = state.parts.map((p) => {
        if (!memberIds.has(p.id)) return p;
        // 绕中心旋转位置（Y 轴旋转）
        let x = p.position[0], y = p.position[1], z = p.position[2];
        let rx = p.rotation[0], ry = p.rotation[1], rz = p.rotation[2];
        if (axis === 'y') {
          const dx = x - center[0], dz = z - center[2];
          x = center[0] + dx * cos - dz * sin;
          z = center[2] + dx * sin + dz * cos;
          // 自身绕 Y 轴旋转
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
          const rotQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
          const e = new THREE.Euler().setFromQuaternion(rotQ.multiply(q));
          rx = e.x; ry = e.y; rz = e.z;
        } else {
          // 其他轴：仅绕中心平移位置（近似），自身旋转相加
          if (axis === 'x') { const dy = y - center[1], dz = z - center[2]; y = center[1] + dy * cos - dz * sin; z = center[2] + dy * sin + dz * cos; rx += angle; }
          else if (axis === 'z') { const dx = x - center[0], dy = y - center[1]; x = center[0] + dx * cos - dy * sin; y = center[1] + dx * sin + dy * cos; rz += angle; }
        }
        return { ...p, position: [x, y, z] as [number, number, number], rotation: [rx, ry, rz] as [number, number, number] };
      });
      // 地面碰撞：以组内最低物体为边界整体上移
      const clamped = clampGroupToGround(newParts, memberIds);
      set({ parts: clamped });
      return;
    }

    state._pushHistory();
    set({
      parts: state.parts.map((p) =>
        ids.includes(p.id)
          ? { ...p, rotation: p.rotation.map((v, k) => (k === idx ? v + angle : v)) as [number, number, number] }
          : p,
      ),
    });
  },
  
  moveSelected: (delta: [number, number, number]) => {
    const state = get();
    if (!state.selectedPartId) return;
    const part = state.parts.find((p) => p.id === state.selectedPartId);
    if (!part) return;
    
    const newPos: [number, number, number] = [
      part.position[0] + delta[0],
      part.position[1] + delta[1],
      part.position[2] + delta[2],
    ];
    
    state._pushHistory();
    state.updatePartPosition(state.selectedPartId, newPos);
  },
  
  undo: () => {
    const state = get();
    const history = (state as unknown as InternalState)._history as HistoryState;
    if (history.past.length === 0) return;
    
    const prev = history.past.pop()!;
    history.future.unshift(JSON.parse(JSON.stringify({ parts: state.parts, groups: state.groups })));
    set({
      ...prev,
      canUndo: history.past.length > 0,
      canRedo: true,
      selectedPartId: null,
      selectedIds: [],
    });
  },
  
  redo: () => {
    const state = get();
    const history = (state as unknown as InternalState)._history as HistoryState;
    if (history.future.length === 0) return;
    
    const next = history.future.shift()!;
    history.past.push(JSON.parse(JSON.stringify({ parts: state.parts, groups: state.groups })));
    set({
      ...next,
      canUndo: true,
      canRedo: history.future.length > 0,
      selectedPartId: null,
      selectedIds: [],
    });
  },
  
  clearScene: () => {
    const state = get();
    if (state.parts.length === 0) return;
    state._pushHistory();
    set({ parts: [], selectedPartId: null });
  },
  
  addParts: (parts: PlacedPart[], basePosition: [number, number, number] = [0, 0, 0]) => {
    const state = get();
    state._pushHistory();
    
    const newParts = parts.map((p) => {
      const newId = uuidv4();
      return {
        ...p,
        id: newId,
        position: [
          p.position[0] + basePosition[0],
          p.position[1] + basePosition[1],
          p.position[2] + basePosition[2],
        ] as [number, number, number],
      };
    });
    
    set({ parts: [...state.parts, ...newParts] });
  },
  
  checkCollision: (part: PlacedPart, excludeId?: string): boolean => {
    const state = get();
    const aabb = getAABB(part);
    
    for (const other of state.parts) {
      if (excludeId && other.id === excludeId) continue;
      const otherAABB = getAABB(other);
      if (aabbIntersect(aabb, otherAABB)) {
        return true;
      }
    }
    return false;
  },
  
  // 获取横杆两端端点
  getBarEndPoints: (part: PlacedPart) => {
    const def = getPartById(part.partId);
    if (!def || def.category !== 'bar') return [];
    
    const { width, height } = def.size;
    const barLength = Math.max(width, height) / 2; // 半径
    const rx = part.rotation[0];
    const ry = part.rotation[1];
    const rz = part.rotation[2];
    
    // 计算横杆方向向量（默认沿X轴）
    const dir = new THREE.Vector3(1, 0, 0);
    const euler = new THREE.Euler(rx, ry, rz);
    dir.applyEuler(euler);
    dir.normalize();
    
    const p1: [number, number, number] = [
      part.position[0] + dir.x * barLength,
      part.position[1] + dir.y * barLength,
      part.position[2] + dir.z * barLength,
    ];
    const p2: [number, number, number] = [
      part.position[0] - dir.x * barLength,
      part.position[1] - dir.y * barLength,
      part.position[2] - dir.z * barLength,
    ];
    
    // 确定方向标签
    const getDirLabel = (v: THREE.Vector3): 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-' => {
      const absX = Math.abs(v.x), absY = Math.abs(v.y), absZ = Math.abs(v.z);
      if (absX >= absY && absX >= absZ) return v.x >= 0 ? 'x+' : 'x-';
      if (absY >= absX && absY >= absZ) return v.y >= 0 ? 'y+' : 'y-';
      return v.z >= 0 ? 'z+' : 'z-';
    };
    
    const dir1 = dir.clone().normalize();
    const dir2 = dir.clone().negate();
    
    return [
      { pos: p1, dir: getDirLabel(dir1) },
      { pos: p2, dir: getDirLabel(dir2) },
    ];
  },
  
  // 将转接头吸附到最近的横杆末端
  snapConnectorToBars: (connectorId: string) => {
    const state = get();
    const connector = state.parts.find((p) => p.id === connectorId);
    if (!connector) return;
    
    const def = getPartById(connector.partId);
    if (!def || def.category !== 'connector') return;
    
    // 查找所有横杆的端点
    let closestDist = Infinity;
    let snapPos: [number, number, number] | null = null;
    
    for (const bar of state.parts) {
      const barDef = getPartById(bar.partId);
      if (!barDef || barDef.category !== 'bar') continue;
      
      const endPoints = state.getBarEndPoints(bar);
      for (const ep of endPoints) {
        const dx = ep.pos[0] - connector.position[0];
        const dy = ep.pos[1] - connector.position[1];
        const dz = ep.pos[2] - connector.position[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < closestDist && dist < 20) {
          closestDist = dist;
          snapPos = ep.pos;
        }
      }
    }
    
    if (snapPos) {
      state._pushHistory();
      set({
        parts: state.parts.map((p) =>
          p.id === connectorId
            ? { ...p, position: snapPos! }
            : p
        ),
      });
    }
  },
  


  // 从转接头添加横杆
  addBarFromConnector: (connectorId: string, partId: string, direction: [number, number, number]) => {
    const state = get();
    const connector = state.parts.find(p => p.id === connectorId);
    if (!connector) return;
    
    const barDef = getPartById(partId);
    if (!barDef || barDef.category !== 'bar') return;
    
    // 计算新杆的位置（半长位置）
    const barLength = barDef.size.width; // 横杆默认沿X轴方向
    const halfLength = barLength / 2;
    const lengthVec: [number, number, number] = [
      direction[0] * halfLength,
      direction[1] * halfLength,
      direction[2] * halfLength
    ];
    const barPos: [number, number, number] = [
      connector.position[0] + lengthVec[0],
      connector.position[1] + lengthVec[1],
      connector.position[2] + lengthVec[2],
    ];
    
    // 计算旋转
    const dirVec = new THREE.Vector3(direction[0], direction[1], direction[2]).normalize();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(xAxis, dirVec);
    const euler = new THREE.Euler().setFromQuaternion(quat);
    const rot: [number, number, number] = [euler.x, euler.y, euler.z];
    
    // 添加新杆（自动添加两端转接头）
    state.addPart(partId, barPos, rot, undefined, false);
  },
  // 计算转接头连接的杆件数量
  getConnectorConnectionCount: (connectorId: string): number => {
    const state = get();
    const connector = state.parts.find(p => p.id === connectorId);
    if (!connector) return 0;
    const connDef = getPartById(connector.partId);
    if (!connDef || connDef.category !== 'connector') return 0;
    
    let count = 0;
    const connPos = connector.position;
    const tolerance = 5;
    
    for (const part of state.parts) {
      if (part.id === connectorId) continue;
      const partDef = getPartById(part.partId);
      if (!partDef || partDef.category !== 'bar') continue;
      
      const ends = state.getBarEndPoints(part);
      for (const end of ends) {
        const dist = Math.sqrt(
          Math.pow(end.pos[0] - connPos[0], 2) +
          Math.pow(end.pos[1] - connPos[1], 2) +
          Math.pow(end.pos[2] - connPos[2], 2)
        );
        if (dist < tolerance) {
          count++;
          break;
        }
      }
    }
    
    return count;
  },
  
  // ====== 方案管理 ======
  loadProjects: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const currentRaw = localStorage.getItem(CURRENT_KEY);
      const projects = raw ? JSON.parse(raw) : [];
      const currentId = currentRaw || null;
      
      // 如果没有方案，创建一个默认的
      if (projects.length === 0) {
        const newProject = createEmptyProject();
        set({
          projects: [newProject],
          currentProjectId: newProject.id,
        });
        return;
      }
      
      set({
        projects,
        currentProjectId: currentId && projects.find((p: DesignProject) => p.id === currentId)
          ? currentId
          : projects[0]?.id || null,
      });
      
      // 加载当前方案的配件
      const current = projects.find((p: DesignProject) => p.id === (currentId || projects[0]?.id));
      if (current) {
        set({ parts: [...current.parts] });
      }
    } catch (e) {
      console.error('加载方案失败', e);
      const newProject = createEmptyProject();
      set({ projects: [newProject], currentProjectId: newProject.id });
    }
  },
  
  saveProject: (name?: string) => {
    const state = get();
    const now = Date.now();
    
    let currentProject: DesignProject;
    const projects = [...state.projects];
    
    if (state.currentProjectId) {
      const idx = projects.findIndex((p) => p.id === state.currentProjectId);
      if (idx >= 0) {
        currentProject = {
          ...projects[idx],
          name: name || projects[idx].name,
          parts: JSON.parse(JSON.stringify(state.parts)),
          updatedAt: now,
        };
        projects[idx] = currentProject;
      } else {
        currentProject = {
          id: state.currentProjectId,
          name: name || '未命名方案',
          createdAt: now,
          updatedAt: now,
          parts: JSON.parse(JSON.stringify(state.parts)),
        };
        projects.push(currentProject);
      }
    } else {
      currentProject = {
        id: uuidv4(),
        name: name || '未命名方案',
        createdAt: now,
        updatedAt: now,
        parts: JSON.parse(JSON.stringify(state.parts)),
      };
      projects.push(currentProject);
      set({ currentProjectId: currentProject.id });
    }
    
    set({ projects });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    localStorage.setItem(CURRENT_KEY, currentProject.id);
    
    return currentProject;
  },
  
  loadProject: (id: string) => {
    const state = get();
    const project = state.projects.find((p) => p.id === id);
    if (!project) return;
    
    // 保存当前场景到历史
    (state as unknown as InternalState)._history = { past: [], future: [] };
    
    set({
      parts: JSON.parse(JSON.stringify(project.parts)),
      currentProjectId: id,
      selectedPartId: null,
      canUndo: false,
      canRedo: false,
    });
    localStorage.setItem(CURRENT_KEY, id);
  },
  
  deleteProject: (id: string) => {
    const state = get();
    const projects = state.projects.filter((p) => p.id !== id);
    
    let newCurrentId = state.currentProjectId;
    if (state.currentProjectId === id) {
      newCurrentId = projects[0]?.id || null;
      if (newCurrentId) {
        const newCurrent = projects.find((p) => p.id === newCurrentId);
        set({ parts: newCurrent ? [...newCurrent.parts] : [] });
      } else {
        set({ parts: [] });
      }
    }
    
    set({ projects, currentProjectId: newCurrentId });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    if (newCurrentId) {
      localStorage.setItem(CURRENT_KEY, newCurrentId);
    } else {
      localStorage.removeItem(CURRENT_KEY);
    }
  },
  
  duplicateProject: (id: string) => {
    const state = get();
    const project = state.projects.find((p) => p.id === id);
    if (!project) return;
    
    const now = Date.now();
    const newProject: DesignProject = {
      ...JSON.parse(JSON.stringify(project)),
      id: uuidv4(),
      name: `${project.name} (副本)`,
      createdAt: now,
      updatedAt: now,
    };
    
    const projects = [...state.projects, newProject];
    set({ projects });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  },
  
  renameProject: (id: string, name: string) => {
    const state = get();
    const projects = state.projects.map((p) =>
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p
    );
    set({ projects });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  },
  
  newProject: () => {
    const state = get();
    const newProject = createEmptyProject();
    const projects = [...state.projects, newProject];
    
    (state as unknown as InternalState)._history = { past: [], future: [] };
    
    set({
      projects,
      currentProjectId: newProject.id,
      parts: [],
      selectedPartId: null,
      canUndo: false,
      canRedo: false,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    localStorage.setItem(CURRENT_KEY, newProject.id);
  },
  
  getCurrentProject: () => {
    const state = get();
    return state.projects.find((p) => p.id === state.currentProjectId) || null;
  },
  
  // ====== 版本对比 ======
  startCompare: (beforeId, afterId) => {
    if (beforeId === afterId) return;
    const state = get();
    const before = state.projects.find(project => project.id === beforeId);
    const after = state.projects.find(project => project.id === afterId);
    if (!before || !after) return;
    
    set({
      viewMode: 'diff',
      diffResult: state.computeDiff(before, after),
    });
  },
  
  exitCompare: () => {
    set({
      viewMode: 'normal',
      diffResult: null,
    });
  },
  
  computeDiff: (oldProject: DesignProject, newProject: DesignProject): DesignDiff => {
    const counts = new Map<string, { oldCount: number; newCount: number; colors: Map<string, PartDiffItem['colors'][number]> }>();
    const countParts = (parts: PlacedPart[], side: 'oldCount' | 'newCount') => {
      for (const { partId, colorId } of parts) {
        const entry = counts.get(partId) ?? { oldCount: 0, newCount: 0, colors: new Map() };
        const color = entry.colors.get(colorId) ?? { colorId, oldCount: 0, newCount: 0 };
        entry[side]++;
        color[side]++;
        entry.colors.set(colorId, color);
        counts.set(partId, entry);
      }
    };
    countParts(oldProject.parts, 'oldCount');
    countParts(newProject.parts, 'newCount');
    
    const addedParts: PartDiffItem[] = [];
    const removedParts: PartDiffItem[] = [];
    const changedParts: PartDiffItem[] = [];
    
    for (const [partId, { oldCount, newCount, colors }] of counts) {
      const colorChanges = [...colors.values()].filter(color => color.oldCount !== color.newCount);
      if (colorChanges.length === 0) continue;
      const def = getPartById(partId);
      const type = oldCount === 0 ? 'added' : newCount === 0 ? 'removed' : 'changed';
      const list = type === 'added' ? addedParts : type === 'removed' ? removedParts : changedParts;
      list.push({ partId, partName: def?.name ?? partId, category: def?.category ?? 'bar',
        oldCount, newCount, change: newCount - oldCount, colors: colorChanges, type });
    }
    
    return {
      beforeName: oldProject.name,
      afterName: newProject.name,
      addedParts,
      removedParts,
      changedParts,
    };
  },
  
  // ====== 导出 ======
  getPartsSummary: () => {
    const state = get();
    const countMap = new Map<string, number>();
    state.parts.forEach((p) => {
      countMap.set(p.partId, (countMap.get(p.partId) || 0) + 1);
    });
    
    const result: { category: PartCategory; partId: string; partName: string; count: number }[] = [];
    countMap.forEach((count, partId) => {
      const def = getPartById(partId);
      if (def) {
        result.push({
          category: def.category,
          partId,
          partName: def.name,
          count,
        });
      }
    });
    
    result.sort((a, b) => a.category.localeCompare(b.category));
    return result;
  },
  
  exportJSON: () => {
    const state = get();
    const project = state.getCurrentProject();
    const data = {
      project: project ? { name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt } : null,
      parts: state.parts.map((p) => ({
        id: p.partId,
        name: getPartById(p.partId)?.name || '',
        position: p.position,
        rotation: p.rotation,
        color: p.colorId,
        roofOutline: p.roofOutline,
      })),
      summary: state.getPartsSummary(),
    };
    return JSON.stringify(data, null, 2);
  },
  
  exportCSV: () => {
    const state = get();
    const summary = state.getPartsSummary();
    const headers = ['分类', '配件名称', '配件ID', '数量'];
    const rows = summary.map((s) => [s.category, s.partName, s.partId, String(s.count)]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  },
}));
