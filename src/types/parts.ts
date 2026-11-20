// 配件类型定义

export type PartCategory = 'bar' | 'connector' | 'platform';

export interface PartSize {
  width: number;   // cm
  height: number;  // cm
  depth: number;   // cm
}

export interface PartColor {
  id: string;
  name: string;
  hex: string;
}

// 杆件专有参数
export interface BarSpec {
  length: number;      // cm，杆件长度
  outerDiameter: number; // cm，外径（内径 + 2 * 壁厚）
  innerDiameter: number; // cm，内径（4cm）
  wallThickness: number; // cm，壁厚（0.2cm = 2mm）
}

// 连接件专有参数
export interface ConnectorSpec {
  socketDiameter: number; // cm，连接头套管外径（4cm，可塞入杆件内径）
  socketLength: number;   // cm，单个连接头长度（插入杆件部分）
  socketWallThickness: number; // cm，套管壁厚
  centerDiameter: number; // cm，中心球体/接头直径
}

// 平台板专有参数
export interface PlatformSpec {
  plateWidth: number;  // cm，板宽
  plateDepth: number;  // cm，板长/深
  plateThickness: number; // cm，板厚（2cm）
  rimHeight: number;   // cm，折边高度
  rimThickness: number; // cm，折边厚度
  flangeWidth?: number; // cm，收纳盒等顶部翻边向外延伸宽度
}

export interface PartDefinition {
  id: string;
  name: string;
  category: PartCategory;
  size: PartSize;          // 厘米（包围盒尺寸）
  colors: PartColor[];
  defaultColor: string;    // color id
  description?: string;
  connectionPoints?: ConnectionPoint[];
  // 分类专有参数
  barSpec?: BarSpec;
  connectorSpec?: ConnectorSpec;
  platformSpec?: PlatformSpec;
  // 扩展配件标记（扩展杆件/扩展板件）：category 复用 bar/platform，用 extension 区分，extKind 细分渲染类型
  extension?: boolean;
  extKind?: string;
  directPlacement?: 'trampoline-frame' | 'hanging-bar' | 'tall-rainbow-frame' | 'molded-slide';
  slideSpec?: { rise: number; run: number; innerWidth: number };
}

export interface ConnectionPoint {
  id: string;
  position: [number, number, number]; // 相对配件中心的位置 (cm)
  direction: [number, number, number]; // 接口方向单位向量（用于建模时的轴向对齐）
  // 接口类型：
  // - male: 凸头（连接件的套管，插入杆件内）
  // - female: 凹口（杆件的两端，可被插入）
  type: 'male' | 'female';
}

export interface PlacedPart {
  id: string;              // 实例ID
  partId: string;          // 配件定义ID
  position: [number, number, number]; // 世界坐标 (cm)
  rotation: [number, number, number]; // 欧拉角 (弧度)
  colorId: string;         // 当前颜色ID
  scale?: [number, number, number];
  roofOutline?: [[number, number], [number, number], [number, number]]; // local XZ in cm
  parentId?: string;       // 所属组ID（成组后设置）
}

export interface SceneGroup {
  id: string;              // 组ID
  name?: string;
  memberIds: string[];     // 直接零件成员 part.id 列表
  childGroupIds: string[]; // 直接子组 id 列表（支持嵌套）
}

export interface PresetUnit {
  id: string;
  name: string;
  category: string;
  description: string;
  thumbnail?: string;
  directPlacement?: 'slide-edge' | 'ladder-edge' | 'bridge-bay';
  parts: PlacedPart[];     // 相对坐标
  subgroups?: Pick<SceneGroup, 'name' | 'memberIds'>[];
}

export interface DesignProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  parts: PlacedPart[];
  description?: string;
}

export interface PartDiffItem {
  partId: string;
  partName: string;
  category: PartCategory;
  oldCount: number;
  newCount: number;
  change: number;
  colors: { colorId: string; oldCount: number; newCount: number }[];
  type: 'added' | 'removed' | 'changed';
}

export interface DesignDiff {
  beforeName: string;
  afterName: string;
  addedParts: PartDiffItem[];
  removedParts: PartDiffItem[];
  changedParts: PartDiffItem[];
}

export type ViewMode = 'normal' | 'diff';
export type DiffHighlightType = 'added' | 'removed' | 'none';
