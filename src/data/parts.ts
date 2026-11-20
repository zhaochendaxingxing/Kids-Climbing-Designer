import type { PartDefinition, PartCategory, PresetUnit } from '@/types/parts';

export const DEFAULT_FRAME_COLOR = { id: 'pine', name: '深绿', hex: '#478977' };

// 颜色调色板（杆件、平台板可选色）
export const PART_COLORS = [
  { id: 'mint', name: '浅绿', hex: '#B6D3AE' },
  DEFAULT_FRAME_COLOR,
  { id: 'green', name: '草绿', hex: '#0E9B70' },
  { id: 'red', name: '红色', hex: '#FD362E' },
  { id: 'white', name: '白色', hex: '#D9DCD9' },
  { id: 'deep-blue', name: '深蓝', hex: '#3C7BB5' },
  { id: 'light-blue', name: '浅蓝', hex: '#A3DDFE' },
  { id: 'blue', name: '天蓝', hex: '#2B8BDF' },
  { id: 'graphite', name: '灰色', hex: '#656D68' },
  { id: 'purple', name: '紫色', hex: '#915D85' },
  { id: 'pink', name: '粉红', hex: '#FAB6CD' },
  { id: 'yellow', name: '黄色', hex: '#F8E243' },
];

const LEGACY_PART_COLORS = [
  { id: 'olive', name: '橄榄绿', hex: '#6B7F4A' },
  { id: 'orange', name: '阳光橙', hex: '#FF9F43' },
];

export function getPartColor(part: PartDefinition, colorId: string) {
  return part.colors.find(color => color.id === colorId)
    ?? (part.category !== 'connector' ? LEGACY_PART_COLORS.find(color => color.id === colorId) : undefined);
}

// 连接件固定为黑色
export const CONNECTOR_COLORS = [
  { id: 'black', name: '黑色', hex: '#2B2B2B' },
];

// 分类配置
export const CATEGORY_CONFIG: Record<PartCategory, { name: string; icon: string; description: string }> = {
  bar: { name: '杆件', icon: 'BarsOutlined', description: '15 / 35CM 圆管' },
  connector: { name: '连接件', icon: 'ApartmentOutlined', description: '多向连接接头' },
  platform: { name: '平台板', icon: 'TableOutlined', description: '站立平台板' },
};

// ===== 基础尺寸常量（cm） =====
// 杆件：内径 4cm，壁厚 2mm = 0.2cm，外径 = 4.4cm
const BAR_INNER_DIAMETER = 4;
const BAR_WALL_THICKNESS = 0.2;
const BAR_OUTER_DIAMETER = BAR_INNER_DIAMETER + BAR_WALL_THICKNESS * 2; // 4.4
export const SLIDE_STRAP_RAIL_SPACING = 5.5;
const SLIDE_STRAP_OUTER_DIAMETER = BAR_OUTER_DIAMETER + 0.4;

// 连接件：连接头（套管）外径 4cm（刚好能塞入杆件内径），壁厚 0.2cm
const SOCKET_DIAMETER = 4;
const SOCKET_WALL = 0.2;
// 连接头插入杆件的深度
const SOCKET_INSERT_LEN = 4;

// 连接件嵌套套筒（female 大套筒端）：空心管口，用于套住 male 凸头（外径 4cm）。
// 尺寸来源（45度两通转接件工程图）：接口内径 40mm(4cm)、外径 50mm(5cm)、壁厚 5mm(0.5cm)
export const NEST_SOCKET_WALL = 0.5;
export const NEST_SOCKET_OUTER_DIAMETER = SOCKET_DIAMETER + NEST_SOCKET_WALL * 2; // 5
export const NEST_SOCKET_INNER_DIAMETER = SOCKET_DIAMETER; // 4
// 45度件 斜向嵌套套筒（female，接杆件）轴向长度：末端 5cm（工程图黄色方框段）
export const NEST_SOCKET_LENGTH = 5;
export const NEST_COMBO_SOCKET_LENGTH = 6.819805523;
export const NEST_SLOPE_SHOULDER = 7.5;

// 中心球直径（比杆件外径大一点，视觉上有凸起）
const CENTER_DIAMETER = 5;

// 平台板：板厚 2mm = 0.2cm，折边高 2cm
export const PLATE_THICKNESS = 0.2;
export const ROOF_PANEL_ID = 'platform-roof-triangle';
const RIM_HEIGHT = 2;   // 折边高度
const RIM_THICKNESS = 0.4; // 折边厚度

// 方向向量常量
const DX: [number, number, number] = [1, 0, 0];
const DX_NEG: [number, number, number] = [-1, 0, 0];
const DY: [number, number, number] = [0, 1, 0];
const DY_NEG: [number, number, number] = [0, -1, 0];
const DZ: [number, number, number] = [0, 0, 1];
const DZ_NEG: [number, number, number] = [0, 0, -1];
// 45° 方向（XY 平面，朝上）
const D45: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0];
// 45° 方向（XY 平面，朝左上）
const D45_NEG: [number, number, number] = [-Math.SQRT1_2, Math.SQRT1_2, 0];

// 连接点贴合位置 = 中心球表面（杆件管口最终贴合在这里，即套管根部）
// 套管的 4cm 插入长度是伸进杆件内孔深处的，不是贴合面
const CONN_POINT_DIST = CENTER_DIAMETER / 2; // 2.5

// SketchUp 屋顶模型实测：球半径25mm、水平套筒68.198mm。
// 两球中心距118.198mm，L凸头插入水平套筒，斜杆肩部距球心75mm。
const COMBO_CENTER_DISTANCE = 5 + NEST_COMBO_SOCKET_LENGTH;

// ===== 一体式45°L内收转接件：立杆接口相对斜杆接口的水平内收量（cm）=====
// 屋顶推导结论：斜杆45°(bar-35)水平投影 24.7 - 框架半宽 20 ≈ 4.7，须由转接件把立杆端向内侧(靠屋顶中心)内收，
// 立杆才能正好落回框架角。单球一体成型，省略两件嵌套带来的 5-K 球心距，直接在球心定义两接口的水平错位。
const COMBO_INWARD_X = 4.7; // 立杆接口(0) 与 斜杆接口(+X) 的水平错位 —— 内收量
// 套管末端到中心距离（用于包围盒尺寸）
const SOCKET_EXTENT = CONN_POINT_DIST + SOCKET_INSERT_LEN; // 6.5

// 辅助：生成带类型的连接点（type 可选，默认 male）
function cp(
  id: string,
  pos: [number, number, number],
  dir: [number, number, number],
  type: 'male' | 'female' = 'male'
): {
  id: string;
  position: [number, number, number];
  direction: [number, number, number];
  type: 'male' | 'female';
} {
  return { id, position: pos, direction: dir, type };
}

// 配件定义库
export const PARTS_LIBRARY: PartDefinition[] = [
  // ============ 杆件（圆管） ============
  // 杆件两端为 female 凹口（连接件的 male 凸头插入）
  // 杆件长度：从一端管口到另一端管口的距离
  {
    id: 'bar-15',
    name: '短圆管 15CM',
    category: 'bar',
    size: { width: 15, height: BAR_OUTER_DIAMETER, depth: BAR_OUTER_DIAMETER },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '15CM 圆管，两端可插连接件',
    barSpec: {
      length: 15,
      outerDiameter: BAR_OUTER_DIAMETER,
      innerDiameter: BAR_INNER_DIAMETER,
      wallThickness: BAR_WALL_THICKNESS,
    },
    connectionPoints: [
      { id: 'end-left', position: [-7.5, 0, 0], direction: DX_NEG, type: 'female' },
      { id: 'end-right', position: [7.5, 0, 0], direction: DX, type: 'female' },
    ],
  },
  {
    id: 'bar-25',
    name: '中圆管 25CM',
    category: 'bar',
    size: { width: 25, height: BAR_OUTER_DIAMETER, depth: BAR_OUTER_DIAMETER },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '25CM 圆管，两端可插连接件',
    barSpec: {
      length: 25,
      outerDiameter: BAR_OUTER_DIAMETER,
      innerDiameter: BAR_INNER_DIAMETER,
      wallThickness: BAR_WALL_THICKNESS,
    },
    connectionPoints: [
      { id: 'end-left', position: [-12.5, 0, 0], direction: DX_NEG, type: 'female' },
      { id: 'end-right', position: [12.5, 0, 0], direction: DX, type: 'female' },
    ],
  },
  {
    id: 'bar-35',
    name: '长圆管 35CM',
    category: 'bar',
    size: { width: 35, height: BAR_OUTER_DIAMETER, depth: BAR_OUTER_DIAMETER },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '35CM 圆管，两端可插连接件',
    barSpec: {
      length: 35,
      outerDiameter: BAR_OUTER_DIAMETER,
      innerDiameter: BAR_INNER_DIAMETER,
      wallThickness: BAR_WALL_THICKNESS,
    },
    connectionPoints: [
      { id: 'end-left', position: [-17.5, 0, 0], direction: DX_NEG, type: 'female' },
      { id: 'end-right', position: [17.5, 0, 0], direction: DX, type: 'female' },
    ],
  },

  // ============ 连接件（黑色） ============
  // 所有连接点类型为 male（凸头，插入杆件）
  // connectionPoints 的 position = 接口端面的位置（杆件端面贴合处）
  {
    id: 'connector-straight',
    name: '一字接头',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: CENTER_DIAMETER, depth: CENTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '直通接头，连接两根同轴圆管',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
    ],
  },
  {
    id: 'connector-45deg',
    name: '45度两通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 1.7, height: SOCKET_EXTENT * 1.7, depth: CENTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '45° 角连接，用于斜撑：水平端为 male 凸头（接 L 件），斜向端为 female 嵌套套筒（接杆件）',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      // 水平端：male 实心凸头（接 L 件），朝 +X。球直径5cm → 该端贴合点即球表面 CONN_POINT_DIST，凸头长度仅 socketLength(4cm)，远小于 6.82
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      // 斜向端：female 嵌套套筒（黄色段5cm，能嵌杆件），朝左上45°（D45_NEG：-X,+Y）；下段 b=5cm 贴合于球表面，末端 female 套筒伸出
      cp('up45', [-CONN_POINT_DIST * Math.SQRT1_2, CONN_POINT_DIST * Math.SQRT1_2, 0], D45_NEG, 'female'),
    ],
  },
  {
    id: 'connector-45deg-nest',
    name: '45度两通(嵌套端)',
    category: 'connector',
    size: { width: 2 * (CONN_POINT_DIST + NEST_COMBO_SOCKET_LENGTH), height: 2 * ((NEST_SLOPE_SHOULDER + 5) * Math.SQRT1_2 + CONN_POINT_DIST), depth: CENTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '45° 角连接件（内含一个嵌套大套筒端，仅用于 45°L 嵌套组合内部，不作为独立配件）',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: 5,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      // 水平套筒口是内部嵌套贴合面，与 L 件凸头根部对齐。
      cp('x+', [CONN_POINT_DIST + NEST_COMBO_SOCKET_LENGTH, 0, 0], DX, 'female'),
      // 斜向肩部距球心75mm，后接50mm插入段。
      cp('up45', [NEST_SLOPE_SHOULDER * Math.SQRT1_2, NEST_SLOPE_SHOULDER * Math.SQRT1_2, 0], D45, 'male'),
    ],
  },
  {
    id: 'connector-45-in',
    name: '45°L内收转接',
    category: 'connector',
    size: { width: COMBO_INWARD_X + SOCKET_EXTENT * 1.5, height: SOCKET_EXTENT * 2, depth: CENTER_DIAMETER * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '一体式45°L内收转接：立杆接口竖直朝下、斜杆接口45°朝上，立杆接口相对斜杆接口水平内收4.7cm，使屋顶立杆落回40框架角',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      // 立杆 (y-)：竖直向下的 male 端，位于球心正下方（内收侧）
      cp('down', [0, -CONN_POINT_DIST, 0], [0, -1, 0], 'male'),
      // 斜杆 (up45)：45° 朝上偏右的 male 端，贴合点水平外置 COMBO_INWARD_X → 立杆端相对斜杆端内收 4.7
      cp('up45', [COMBO_INWARD_X, CONN_POINT_DIST * Math.SQRT1_2, 0], D45, 'male'),
    ],
  },
  {
    id: 'connector-bazi',
    name: '八字扣',
    category: 'connector',
    size: { width: 11, height: 5.5, depth: 5 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '8字形双连体圆筒，两个并排空心圆管，可套接两根平行杆件',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: 5,
    },
    // 两个并排圆管沿 Z 方向分布（z=±2.75），每管沿 X 轴贯穿，两端各一个 female 管口
    connectionPoints: [
      { id: 'a-end-left', position: [-5.5, 0, -2.75], direction: DX_NEG, type: 'female' },
      { id: 'a-end-right', position: [5.5, 0, -2.75], direction: DX, type: 'female' },
      { id: 'b-end-left', position: [-5.5, 0, 2.75], direction: DX_NEG, type: 'female' },
      { id: 'b-end-right', position: [5.5, 0, 2.75], direction: DX, type: 'female' },
    ],
  },
  {
    id: 'connector-l',
    name: 'L两通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: CENTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '90° 直角连接，L 形',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
    ],
  },
  {
    id: 'connector-cross',
    name: '十字四通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: CENTER_DIAMETER, depth: SOCKET_EXTENT * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '平面十字连接，水平四向',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
      cp('z+', [0, 0, CONN_POINT_DIST], DZ),
      cp('z-', [0, 0, -CONN_POINT_DIST], DZ_NEG),
    ],
  },
  {
    id: 'connector-v3',
    name: '立三通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: SOCKET_EXTENT * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '立体三向，X/Y/Z 各一接口',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
      cp('z+', [0, 0, CONN_POINT_DIST], DZ),
    ],
  },
  {
    id: 'connector-t6',
    name: 'T字三通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: CENTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '平面T形三通，水平一线（两端）+ 垂直一腿',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
    ],
  },
  {
    id: 'connector-v4',
    name: '立四通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: SOCKET_EXTENT * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '立体四向，水平一线 + 上 + 前',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
      cp('z+', [0, 0, CONN_POINT_DIST], DZ),
    ],
  },
  {
    id: 'connector-v5',
    name: '立五通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: SOCKET_EXTENT * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '立体五向，水平四向 + 上',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
      cp('z+', [0, 0, CONN_POINT_DIST], DZ),
      cp('z-', [0, 0, -CONN_POINT_DIST], DZ_NEG),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
    ],
  },
  {
    id: 'connector-v6',
    name: '立六通',
    category: 'connector',
    size: { width: SOCKET_EXTENT * 2, height: SOCKET_EXTENT * 2, depth: SOCKET_EXTENT * 2 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '立体六向，全方向连接',
    connectorSpec: {
      socketDiameter: SOCKET_DIAMETER,
      socketLength: SOCKET_INSERT_LEN,
      socketWallThickness: SOCKET_WALL,
      centerDiameter: CENTER_DIAMETER,
    },
    connectionPoints: [
      cp('x+', [CONN_POINT_DIST, 0, 0], DX),
      cp('x-', [-CONN_POINT_DIST, 0, 0], DX_NEG),
      cp('y+', [0, CONN_POINT_DIST, 0], DY),
      cp('y-', [0, -CONN_POINT_DIST, 0], DY_NEG),
      cp('z+', [0, 0, CONN_POINT_DIST], DZ),
      cp('z-', [0, 0, -CONN_POINT_DIST], DZ_NEG),
    ],
  },
  {
    id: 'connector-slide-strap',
    name: '滑梯绑带',
    category: 'connector',
    size: { width: 2.8, height: SLIDE_STRAP_OUTER_DIAMETER, depth: SLIDE_STRAP_RAIL_SPACING + SLIDE_STRAP_OUTER_DIAMETER },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '绕过平台与滑梯入口两根平行圆管的配套织带',
    extension: true,
    extKind: 'slide-strap',
  },
  {
    id: 'connector-bridge-rope',
    name: '吊桥挂绳',
    category: 'connector',
    size: { width: 15, height: 45, depth: 1.5 },
    colors: CONNECTOR_COLORS,
    defaultColor: 'black',
    description: '吊桥踏板圆管与框架扶手之间的挂绳',
    extension: true,
    extKind: 'bridge-rope',
  },
  // ============ 平台板 ============
  // 平台板厚度 2cm，底部有折边（向下突出），折边恰好卡在四根杆件组成的矩形内
  {
    id: 'platform-39.5x19.5',
    name: '长平台板 39.5×19.5',
    category: 'platform',
    size: { width: 39.5, height: PLATE_THICKNESS + RIM_HEIGHT, depth: 19.5 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '长方形平台板，防滑表面',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 19.5,
      plateThickness: PLATE_THICKNESS,
      rimHeight: RIM_HEIGHT,
      rimThickness: RIM_THICKNESS,
    },
  },
  {
    id: 'platform-39.5x39.5',
    name: '方平台板 39.5×39.5',
    category: 'platform',
    size: { width: 39.5, height: PLATE_THICKNESS + RIM_HEIGHT, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '正方形平台板，防滑表面',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: PLATE_THICKNESS,
      rimHeight: RIM_HEIGHT,
      rimThickness: RIM_THICKNESS,
    },
  },
  {
    id: 'platform-29.5x39.5',
    name: '中板-浅绿',
    category: 'platform',
    size: { width: 29.5, height: PLATE_THICKNESS + RIM_HEIGHT, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '长方形平台板 30×40CM（29.5×39.5 净尺寸），防滑表面',
    platformSpec: {
      plateWidth: 29.5,
      plateDepth: 39.5,
      plateThickness: PLATE_THICKNESS,
      rimHeight: RIM_HEIGHT,
      rimThickness: RIM_THICKNESS,
    },
  },

  // ============ 扩展配件 ============
  // 扩展配件 category 复用 bar/platform（以便右键"替换为同类型"自动匹配），用 extension 标记 + extKind 细分渲染。
  // 扩展板件中部分不含杆件（图中杆件仅为示意该元件与杆件组合的样子），其本体仅是板/网/兜/盒/舱等。

  // ---- 扩展杆件：35圆管 + 方向盘（方向盘固定在管身上）----
  {
    id: 'ext-bar-wheel',
    name: '方向盘杆 35CM',
    category: 'bar',
    size: { width: 35, height: 8.52, depth: 24.74 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '35CM 圆管上固定一个亮黄色三辐方向盘，两端可插连接件',
    extension: true,
    extKind: 'wheelbar',
    barSpec: {
      length: 35,
      outerDiameter: BAR_OUTER_DIAMETER,
      innerDiameter: BAR_INNER_DIAMETER,
      wallThickness: BAR_WALL_THICKNESS,
    },
    connectionPoints: [
      { id: 'end-left', position: [-17.5, 0, 0], direction: DX_NEG, type: 'female' },
      { id: 'end-right', position: [17.5, 0, 0], direction: DX, type: 'female' },
    ],
  },

  // ---- 扩展板件（本体为板/网/兜/盒/舱，不含杆件框架）----
  {
    id: 'ext-plate-glass',
    name: 'PC玻璃栈道',
    category: 'platform',
    size: { width: 39.5, height: 3, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: 'PC 透明玻璃栈道板 40×40，不含管子',
    extension: true,
    extKind: 'glass',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: 1,
      rimHeight: 1.5,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-pouch',
    name: '布兜',
    category: 'platform',
    size: { width: 40, height: 25, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '方形拉链布兜，适配 40×40cm 框格。四边布套包裹顶部圆管，兜底悬空，不含架子。',
    extension: true,
    extKind: 'pouch',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 0.4,
      rimHeight: 6,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-rainbow',
    name: '彩虹门',
    category: 'platform',
    size: { width: 40, height: 4.86, depth: 44.86 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '彩虹织带门 40×40，多彩竖条装饰扉',
    extension: true,
    extKind: 'rainbow',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 0.4,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  ...[60, 80].map((height): PartDefinition => ({
    id: `ext-plate-rainbow-${height}`,
    name: `彩虹门 40 × ${height} cm`,
    category: 'platform',
    size: { width: 40, height: 4.86, depth: height + 4.86 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: `七色织带，安装在 40 × ${height} cm 竖向框格`,
    extension: true,
    extKind: 'rainbow',
    platformSpec: { plateWidth: 40, plateDepth: height, plateThickness: 0.4, rimHeight: 2, rimThickness: 0.4 },
    directPlacement: 'tall-rainbow-frame',
  })),
  ...[
    { id: 'rings', name: '双吊环', height: 42, depth: 5 },
    { id: 'swing', name: '布兜秋千', height: 57, depth: 31 },
  ].map(({ id, name, height, depth }): PartDefinition => ({
    id: `special-${id}`,
    name,
    category: 'platform',
    size: { width: 34, height, depth },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '吊挂在下方留空的水平长圆管上',
    extension: true,
    extKind: id,
    directPlacement: 'hanging-bar',
  })),
  ...[{ rise: 60, run: 125, innerWidth: 30 }, { rise: 80, run: 145, innerWidth: 32.5 }]
    .map((slideSpec): PartDefinition => ({
      id: `special-molded-slide-${slideSpec.rise}`,
      name: `一体滑梯 ${slideSpec.rise} cm 高`,
      category: 'platform',
      size: { width: slideSpec.innerWidth + 7, height: slideSpec.rise + 12, depth: slideSpec.run },
      colors: PART_COLORS,
      defaultColor: 'red',
      description: `高 ${slideSpec.rise} cm · 长 ${slideSpec.run} cm · 内宽 ${slideSpec.innerWidth} cm`,
      extension: true,
      extKind: 'molded-slide',
      directPlacement: 'molded-slide',
      slideSpec,
    })),
  {
    id: 'ext-plate-honeycomb',
    name: '蜂巢板',
    category: 'platform',
    size: { width: 39.5, height: 3, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '澳白色蜂窝镂空板 40×40，六边形镂空网格',
    extension: true,
    extKind: 'honeycomb',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-brick',
    name: '积木板',
    category: 'platform',
    size: { width: 40, height: 4, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '积木板 40×40 浅绿色，表面布满圆形凸粒',
    extension: true,
    extKind: 'brick',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-ninehole',
    name: '九洞板',
    category: 'platform',
    size: { width: 39.5, height: 3, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'blue',
    description: '九洞板 浅蓝色，3×3 圆孔拼插板',
    extension: true,
    extKind: 'ninehole',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-basketball',
    name: '篮球板',
    category: 'platform',
    size: { width: 40, height: 3, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '黄色篮板 40×40 + 篮板筐 + 双色篮网',
    extension: true,
    extKind: 'basketball',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-maze',
    name: '迷宫板',
    category: 'platform',
    size: { width: 39.5, height: 3, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '数字认知迷宫板，可换色底板与原木色滑槽面板',
    extension: true,
    extKind: 'maze',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-ropenet',
    name: '爬网',
    category: 'platform',
    size: { width: 40, height: 3, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '趴网/爬网 40×40，灰色绳白肋方格网',
    extension: true,
    extKind: 'ropenet',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 0.4,
      rimHeight: 0.4,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-rock-big',
    name: '攀岩板-大 40×40',
    category: 'platform',
    size: { width: 40, height: 4, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '大型攀岩板 40×40，黄色，两只红蓝攀岩点',
    extension: true,
    extKind: 'rockbig',
    platformSpec: {
      plateWidth: 40,
      plateDepth: 40,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-rock-mid',
    name: '攀岩板-中 30×40',
    category: 'platform',
    size: { width: 30, height: 4, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '中型攀岩板 30×40，黄色，两只红蓝攀岩点',
    extension: true,
    extKind: 'rockmid',
    platformSpec: {
      plateWidth: 30,
      plateDepth: 40,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-rock-small',
    name: '攀岩板-小 20×40',
    category: 'platform',
    size: { width: 20, height: 4, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'yellow',
    description: '小型攀岩板 20×40，黄色，一只红色攀岩点',
    extension: true,
    extKind: 'rocksmall',
    platformSpec: {
      plateWidth: 20,
      plateDepth: 40,
      plateThickness: 1.5,
      rimHeight: 2,
      rimThickness: 0.4,
    },
  },
  {
    id: 'ext-plate-storbox',
    name: '收纳盒',
    category: 'platform',
    size: { width: 34, height: 17, depth: 34 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '澳白色敞口方槽收纳盒，盒体卡入 1x1 框架内、顶部翻边搭接在框架顶杆上',
    extension: true,
    extKind: 'storbox',
    platformSpec: {
      plateWidth: 34,
      plateDepth: 34,
      plateThickness: 1,
      rimHeight: 15,
      rimThickness: 0.5,
      flangeWidth: 6,
    },
  },
  {
    id: 'ext-plate-capsule',
    name: '亚克力太空舱',
    category: 'platform',
    size: { width: 39.5, height: 22, depth: 39.5 },
    colors: PART_COLORS,
    defaultColor: 'white',
    description: '半球透明亚克力太空舱观察窗，不含框架',
    extension: true,
    extKind: 'capsule',
    platformSpec: {
      plateWidth: 39.5,
      plateDepth: 39.5,
      plateThickness: 1,
      rimHeight: 8,
      rimThickness: 0.4,
    },
  },
  {
    id: 'platform-trampoline-80',
    name: '双格蹦床垫',
    category: 'platform',
    size: { width: 80, height: 5, depth: 80 },
    colors: PART_COLORS,
    defaultColor: 'graphite',
    description: '直接吸附到空的 80 × 80 cm 水平框架',
    extension: true,
    extKind: 'trampoline-80',
    directPlacement: 'trampoline-frame',
  },
  {
    id: 'platform-rope-bridge',
    name: '绳索悬挂踏板',
    category: 'platform',
    size: { width: 40, height: 42, depth: 40 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '用两侧绳索吊挂的踏板',
    extension: true,
    extKind: 'rope-bridge',
  },
  {
    id: 'platform-long-rope-bridge',
    name: '双跨悬索桥',
    category: 'platform',
    size: { width: 40, height: 42, depth: 80 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    extension: true,
    extKind: 'long-rope-bridge',
  },
  {
    id: 'platform-balance-bridge',
    name: '悬挂独木桥',
    category: 'platform',
    size: { width: 40, height: 42, depth: 80 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    extension: true,
    extKind: 'balance-bridge',
  },
  {
    id: ROOF_PANEL_ID,
    name: '三角屋面板',
    category: 'platform',
    size: { width: 40, height: PLATE_THICKNESS, depth: 30 },
    colors: PART_COLORS,
    defaultColor: 'mint',
    description: '由三角斜框格自动生成，边长随屋面调整',
    extension: true,
    extKind: 'roof-triangle',
  },
];

// ===== 扩展杆件/扩展板件分组（供 RightPanel"扩展配件"选项卡使用）=====
export const EXT_BARS = PARTS_LIBRARY.filter((p) => p.extension && p.category === 'bar');
export const EXT_PLATES = PARTS_LIBRARY.filter((p) => p.extension && p.category === 'platform' && p.platformSpec && !p.directPlacement);
export const SPECIAL_EXTENSIONS = PARTS_LIBRARY.filter(part => part.directPlacement);

// ===== 按《儿童攀爬架-屋顶.skp》校准的两件嵌套组合 =====
// 本地 +X 指向屋脊内侧。L件在内侧，向下接立杆；45度件斜口向内上方。
export const COMBO_45L: PresetUnit = {
  id: 'combo-45l', name: '45°L嵌套组合', category: '连接件',
  description: '按SketchUp屋顶接法：水平套筒嵌套L两通，内侧向下接立杆，斜口向屋脊上升45°',
  parts: [
    { id: '__c45l_d', partId: 'connector-45deg-nest', position: [0, 3.2, 0], rotation: [0, 0, 0], colorId: 'black' },
    { id: '__c45l_l', partId: 'connector-l', position: [COMBO_CENTER_DISTANCE, 3.2, 0], rotation: [0, 0, Math.PI], colorId: 'black' },
  ],
};

// 预设组合单元（当前配件库重构后暂空，后续可按新配件补充）
export const PRESET_UNITS: PresetUnit[] = [
  {
    id: 'preset-square-frame',
    name: '正方形爬架底框',
    category: '基础框架',
    description: '4 根 35CM 长杆 + 4 个十字四通连接件组成的正方形框架，可直接拖出部署',
    parts: [
      // 四个角的十字四通连接件（黑色，x/z 四向接口）
      { id: '__c1', partId: 'connector-cross', position: [17.5, 0, 17.5], rotation: [0, 0, 0], colorId: 'black' },
      { id: '__c2', partId: 'connector-cross', position: [17.5, 0, -17.5], rotation: [0, 0, 0], colorId: 'black' },
      { id: '__c3', partId: 'connector-cross', position: [-17.5, 0, -17.5], rotation: [0, 0, 0], colorId: 'black' },
      { id: '__c4', partId: 'connector-cross', position: [-17.5, 0, 17.5], rotation: [0, 0, 0], colorId: 'black' },
      // 四条边 35CM 长杆
      { id: '__b1', partId: 'bar-35', position: [17.5, 0, 0], rotation: [0, Math.PI / 2, 0], colorId: 'mint' },
      { id: '__b2', partId: 'bar-35', position: [0, 0, -17.5], rotation: [0, 0, 0], colorId: 'mint' },
      { id: '__b3', partId: 'bar-35', position: [-17.5, 0, 0], rotation: [0, Math.PI / 2, 0], colorId: 'mint' },
      { id: '__b4', partId: 'bar-35', position: [0, 0, 17.5], rotation: [0, 0, 0], colorId: 'mint' },
    ],
  },
];

// 辅助函数：根据ID获取配件定义
export function getPartById(id: string): PartDefinition | undefined {
  return PARTS_LIBRARY.find((p) => p.id === id);
}

// 辅助函数：按分类获取配件
export function getPartsByCategory(category: PartCategory): PartDefinition[] {
  return PARTS_LIBRARY.filter((p) => p.category === category);
}
