import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  PLATE_THICKNESS, NEST_SOCKET_OUTER_DIAMETER, NEST_SOCKET_INNER_DIAMETER, SLIDE_STRAP_RAIL_SPACING,
  NEST_SOCKET_LENGTH, NEST_COMBO_SOCKET_LENGTH, NEST_SLOPE_SHOULDER,
} from '@/data/parts';
import type { PartDefinition, PlacedPart } from '@/types/parts';
import { moldedTube } from './productGeometry';
import { buildHangingAccessory, buildMoldedSlide } from './specialAccessoryMesh';
import { buildFabricPouch } from './fabricPouch';
import { buildMazeFace } from './mazePanel';
import { buildClimbingHold, buildRopeNet, storageBasin } from './moldedAccessories';

// 创建中空圆管几何体（杆件） — 使用 LatheGeometry 生成管壁，两端可见
function createBarTubeGeometry(length: number, outerR: number, innerR: number): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [];
  const segments = 24;
  // 外轮廓（从左下到左上，顺时针）
  points.push(new THREE.Vector2(outerR, -length / 2));
  points.push(new THREE.Vector2(outerR, length / 2));
  // 顶面（外→内）
  points.push(new THREE.Vector2(innerR, length / 2));
  // 内壁
  points.push(new THREE.Vector2(innerR, -length / 2));
  // 底面（内→外闭合）
  const geo = new THREE.LatheGeometry(points, segments);
  geo.rotateZ(Math.PI / 2); // 轴线沿 X 轴（默认 Lathe 沿 Y 轴旋转）
  return geo;
}

// 创建平台板几何体（平板 + 四周折边）
function createPlatformGeometry(spec: {
  plateWidth: number;
  plateDepth: number;
  plateThickness: number;
  rimHeight: number;
  rimThickness: number;
}): THREE.BufferGeometry {
  const { plateWidth, plateDepth, plateThickness, rimHeight, rimThickness } = spec;
  const corner = 2.2;
  const plateGeo = createCutCornerPanelGeometry(plateWidth, plateDepth, plateThickness, corner, []);

  // 折边使用四个 Box，通过 mergeGeometries 合并
  // 折边中点 Y（板下方向下突出）。
  // 额外下移 0.01cm，避免折边顶面与板底（y=-thickness/2）共面产生 Z-fighting ，
  // 否则顶面视角会出现深灰色直角三角形网格线
  const rimTopY = -plateThickness / 2 - rimHeight / 2 - 0.01;
  const frontRim = new THREE.BoxGeometry(plateWidth - corner * 2, rimHeight, rimThickness);
  frontRim.translate(0, rimTopY, -plateDepth / 2 + rimThickness / 2);
  const backRim = new THREE.BoxGeometry(plateWidth - corner * 2, rimHeight, rimThickness);
  backRim.translate(0, rimTopY, plateDepth / 2 - rimThickness / 2);
  const leftRim = new THREE.BoxGeometry(rimThickness, rimHeight, plateDepth - corner * 2);
  leftRim.translate(-plateWidth / 2 + rimThickness / 2, rimTopY, 0);
  const rightRim = new THREE.BoxGeometry(rimThickness, rimHeight, plateDepth - corner * 2);
  rightRim.translate(plateWidth / 2 - rimThickness / 2, rimTopY, 0);

  // 合并几何体
  const source = [plateGeo, frontRim, backRim, leftRim, rightRim];
  const geometries = source.map(geo => geo.index ? geo.toNonIndexed() : geo);
  const merged = mergeGeometries(geometries);
  new Set([...source, ...geometries]).forEach(geo => geo.dispose());
  return merged;
}

// 生成带「四角内凹切角」的水平平板几何（板面 XZ、厚沿 Y），支持真正镂空孔（圆形 / 正六边形）。
// holes 坐标用世界系：x=宽方向、z=深方向、type='circle'|'hex'、r=半径(cm)。
function createCutCornerPanelGeometry(
  w: number,
  d: number,
  thickness: number,
  cornerCut: number,
  holes: { x: number; z: number; type: 'circle' | 'hex'; r: number }[]
): THREE.BufferGeometry {
  const bevel = Math.min(0.12, thickness / 5);
  const hw = w / 2 - bevel;
  const hd = d / 2 - bevel;
  const cc = cornerCut;
  const shape = new THREE.Shape();
  // 外轮廓：方形四角切掉 45° 等腰直角三角形（内凹切角）
  shape.moveTo(-hw + cc, -hd);
  shape.lineTo(hw - cc, -hd);
  shape.quadraticCurveTo(hw - cc, -hd + cc, hw, -hd + cc);
  shape.lineTo(hw, hd - cc);
  shape.quadraticCurveTo(hw - cc, hd - cc, hw - cc, hd);
  shape.lineTo(-hw + cc, hd);
  shape.quadraticCurveTo(-hw + cc, hd - cc, -hw, hd - cc);
  shape.lineTo(-hw, -hd + cc);
  shape.quadraticCurveTo(-hw + cc, -hd + cc, -hw + cc, -hd);
  shape.closePath();

  const makeHolePath = (x: number, z: number, type: 'circle' | 'hex', r: number) => {
    const hole = new THREE.Path();
    const seg = type === 'circle' ? 40 : 6;
    const base = type === 'circle' ? 0 : Math.PI / 6;
    for (let i = 0; i <= seg; i++) {
      const a = base + (i / seg) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = -z + Math.sin(a) * r;
      if (i === 0) hole.moveTo(px, py);
      else hole.lineTo(px, py);
    }
    return hole;
  };

  for (const h of holes) {
    shape.holes.push(makeHolePath(h.x, h.z, h.type, h.r));
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness - 2 * bevel, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -thickness / 2 + bevel, 0);
  return geo;
}

// 扩展配件专属渲染（扩展杆件 / 扩展板件）
// 每种 extKind 用简单的 THREE 基元拼出可辨认造型；mat 为已配色的标准材质
function buildExtensionMesh(
  group: THREE.Group,
  def: PartDefinition,
  mat: THREE.MeshStandardMaterial,
  createPlatformGeometry: (spec: NonNullable<PartDefinition['platformSpec']>) => THREE.BufferGeometry
): void {
  const spec = def.platformSpec;
  const ext = def.extKind ?? '';

  const addMesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, scaleY = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(1, scaleY, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  if (ext === 'rings' || ext === 'swing') {
    buildHangingAccessory(def, mat, addMesh);
    return;
  }
  if (def.slideSpec) {
    buildMoldedSlide(def.slideSpec, mat, addMesh);
    return;
  }
  if (ext === 'trampoline-80') {
    const canvas = mat.clone();
    canvas.roughness = 0.95;
    canvas.color.multiplyScalar(0.52);
    addMesh(new RoundedBoxGeometry(75, 0.48, 75, 2, 0.22), canvas, 0, -0.35, 0);
    const loop = new THREE.TorusGeometry(2.37, 0.24, 7, 18);
    for (const side of [-1, 1]) {
      for (const t of [-34, -27, -19, -11, -4, 4, 11, 19, 27, 34]) {
        addMesh(loop.clone().rotateY(Math.PI / 2), canvas, t, 0, side * 40);
        addMesh(loop.clone(), canvas, side * 40, 0, t);
      }
    }
    loop.dispose();
    for (const side of [-1, 1]) {
      addMesh(new THREE.BoxGeometry(75, 0.3, 2.6), canvas, 0, -0.2, side * 38.6);
      addMesh(new THREE.BoxGeometry(2.6, 0.3, 75), canvas, side * 38.6, -0.2, 0);
    }
    return;
  }
  if (ext === 'rope-bridge' || ext === 'long-rope-bridge' || ext === 'balance-bridge') {
    const rope = mat.clone();
    rope.color.set('#e9e3d1');
    rope.roughness = 0.96;
    const long = ext !== 'rope-bridge';
    const halfWidth = ext === 'balance-bridge' ? 9 : 18;
    if (long) {
      addMesh(new RoundedBoxGeometry(halfWidth * 2, 0.85, 77, 3, 0.4), mat);
    } else {
      addMesh(new RoundedBoxGeometry(36, 0.85, 18, 3, 0.4), mat);
    }
    for (const sign of [-1, 1]) {
      for (const z of long ? [-34, -20, -6, 6, 20, 34] : [-7.5, 7.5]) {
        const points = [[halfWidth - 1, 0], [halfWidth, 4], [(halfWidth + 20) / 2, 20], [20, 40]].map(([x, y]) =>
          new THREE.Vector3(sign * x, y, z));
        addMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.26, 7, false), rope);
        addMesh(new THREE.TorusGeometry(2.36, 0.26, 7, 18), rope, sign * 20, 40, z);
      }
    }
    return;
  }
  if (ext === 'bridge-rope') {
    const rope = mat.clone();
    rope.color.set('#e5dcc7');
    rope.roughness = 0.96;
    for (const z of [-0.32, 0.32]) {
      const points = [[-5, -20], [-3.8, -14], [-1.6, -4], [2, 9], [5, 20]]
        .map(([x, y]) => new THREE.Vector3(x, y, z));
      addMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, 0.23, 7, false), rope);
    }
    for (const side of [-1, 1]) {
      addMesh(new THREE.TorusGeometry(2.36, 0.27, 7, 20), rope, side * 5, side * 20, 0);
      addMesh(new THREE.SphereGeometry(0.55, 8, 6), rope, side * 5 - side * 1.9, side * 17.4, 0);
    }
    return;
  }
  if (ext === 'slide-strap') {
    const outerRadius = def.size.height / 2;
    const halfSpacing = SLIDE_STRAP_RAIL_SPACING / 2;
    const capsule = (path: THREE.Path, radius: number) => {
      path.moveTo(-halfSpacing, -radius);
      path.absarc(halfSpacing, 0, radius, -Math.PI / 2, Math.PI / 2, false);
      path.absarc(-halfSpacing, 0, radius, Math.PI / 2, Math.PI * 1.5, false);
      path.closePath();
    };
    const belt = new THREE.Shape();
    const opening = new THREE.Path();
    capsule(belt, outerRadius);
    capsule(opening, outerRadius - 0.16);
    belt.holes.push(opening);
    const webbing = new THREE.ExtrudeGeometry(belt, { depth: def.size.width, bevelEnabled: false, curveSegments: 16 });
    webbing.rotateY(Math.PI / 2).translate(-def.size.width / 2, 0, 0);
    const fabric = mat.clone();
    fabric.roughness = 0.98;
    addMesh(webbing, fabric);
    const stitching = fabric.clone();
    stitching.color.lerp(new THREE.Color('#a0a19c'), 0.28);
    for (const z of [-0.52, 0.52]) {
      addMesh(new THREE.BoxGeometry(def.size.width - 0.4, 0.03, 0.065), stitching, 0, outerRadius, z);
    }
    return;
  }

  // 1) 扩展杆件：35CM 圆管 + 亮黄三辐方向盘（固定于管身中部上方）
  if (ext === 'wheelbar') {
    const bar = def.barSpec!;
    const half = bar.length / 2;
    addMesh(moldedTube(bar.length, bar.outerDiameter / 2, bar.innerDiameter / 2, [-half + 2.3, half - 2.3]), mat);
    // 方向盘和安装座共轴，杆件本身的接口与两端扣孔沿用圆管规格。
    const wheelMat = mat.clone();
    wheelMat.color.set('#ffda22');
    wheelMat.roughness = 0.34;
    const collar = mat.clone();
    collar.roughness = 0.43;
    addMesh(moldedTube(5.5, 2.62, bar.outerDiameter / 2 + 0.04), collar);
    addMesh(new THREE.CylinderGeometry(1.68, 2.25, 3.15, 32), collar, 0, 2.85, 0);

    const faceHeight = 5.3;
    addMesh(new THREE.TorusGeometry(11.35, 1.02, 20, 64).rotateX(-Math.PI / 2), wheelMat, 0, faceHeight, 0);
    const hubProfile = [
      [0, -0.90], [2.78, -0.90], [3.48, -0.66], [3.82, -0.27], [3.96, 0.25],
      [3.91, 0.65], [3.68, 0.91], [3.34, 0.91], [2.96, 0.70], [2.60, 0.27],
      [1.46, -0.25], [1.19, -0.25], [1.04, 0.04], [0.82, 0.08], [0.72, -0.26], [0, -0.26],
    ];
    addMesh(new THREE.LatheGeometry(hubProfile.map(([r, y]) => new THREE.Vector2(r, y)), 56), wheelMat, 0, faceHeight, 0);
    const screw = mat.clone();
    screw.color.set('#aeb8b8');
    screw.metalness = 0.74;
    screw.roughness = 0.29;
    addMesh(new THREE.CylinderGeometry(0.61, 0.64, 0.21, 24), screw, 0, faceHeight - 0.12, 0);
    const socket = mat.clone();
    socket.color.set('#42413a');
    addMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 6), socket, 0, faceHeight, 0);

    const spoke = new THREE.Shape();
    spoke.moveTo(3.05, -1.42);
    spoke.quadraticCurveTo(7.4, -1.24, 10.62, -1.16);
    spoke.quadraticCurveTo(11.1, -1.1, 11.15, -0.58);
    spoke.lineTo(11.15, 0.58);
    spoke.quadraticCurveTo(11.1, 1.1, 10.62, 1.16);
    spoke.quadraticCurveTo(7.4, 1.24, 3.05, 1.42);
    spoke.closePath();
    for (const x of [6.05, 8.82]) {
      const recess = new THREE.Path();
      recess.absarc(x, 0, 0.45, 0, Math.PI * 2, true);
      spoke.holes.push(recess);
    }
    const web = new THREE.ExtrudeGeometry(spoke, {
      depth: 0.52, bevelSize: 0.15, bevelThickness: 0.16, bevelSegments: 3, curveSegments: 12,
    }).rotateX(-Math.PI / 2).translate(0, faceHeight - 0.26, 0);
    for (let i = 0; i < 3; i++) {
      const yaw = Math.PI / 9 + i * Math.PI * 2 / 3;
      addMesh(web.clone().rotateY(yaw), wheelMat);
      for (const x of [6.05, 8.82]) {
        addMesh(new THREE.CylinderGeometry(0.43, 0.43, 0.38, 16).translate(x, faceHeight, 0).rotateY(yaw), wheelMat);
      }
    }
    web.dispose();
    return;
  }

  // 2) 扩展板件（按 extKind 分型）
  if (!spec) return;

  const dims = {
    w: def.size.width,
    d: def.size.depth,
  };

  if (ext === 'glass') {
    // 产品是透明 PC 板，四周彩管由用户另行搭建。
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#cfeeff',
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const thickness = 0.5;
    const surfaceOffset = (PLATE_THICKNESS - thickness) / 2;
    const panel = createCutCornerPanelGeometry(dims.w, dims.d, thickness, 2.2, []);
    addMesh(panel, glassMat, 0, surfaceOffset, 0);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(panel, 28), new THREE.LineBasicMaterial({
      color: '#8ec5d3', transparent: true, opacity: 0.43,
    }));
    edge.position.y = surfaceOffset;
    group.add(edge);
    return;
  }
  if (ext === 'pouch') {
    buildFabricPouch(group, mat, spec.plateWidth, spec.plateDepth);
    return;
  }
  if (ext === 'rainbow') {
    // 与框架封板共用坐标：X 为宽，Z 为高，Y 为门的法线；原点在开口中心。
    const colors = ['#65b88d', '#27aab1', '#efa234', '#ee4d65', '#895893', '#438bc7', '#ebc347'];
    const height = spec.plateDepth;
    const spacing = (spec.plateWidth - 5) / colors.length;
    const strapWidth = spacing - 0.42;
    const sleeveRadius = 2.25;
    colors.forEach((color, index) => {
      const fabric = mat.clone();
      fabric.color.set(color);
      fabric.roughness = 0.91;
      const x = (index - (colors.length - 1) / 2) * spacing;
      addMesh(new RoundedBoxGeometry(strapWidth, 0.24, height - 2 * sleeveRadius + 0.3, 2, 0.11), fabric, x, 0, 0);
      for (const z of [-height / 2, height / 2]) {
        addMesh(moldedTube(strapWidth, sleeveRadius + 0.18, sleeveRadius - 0.03), fabric, x, 0, z);
      }
    });
    return;
  }
  if (ext === 'honeycomb') {
    // 蜂巢板：白色底板（四角内凹切角）布满正六边形镂空（蜂巢状网格）。
    // 六边形单元按标准密铺定位（pointy-top）：同列孔距 = √3·R、斜向行距 = 1.5·R、交错半列。
    // 关键：开孔半径必须小于单元外接圆半径 R（保留约 1cm 蜂窝壁），
    // 否则相邻孔洞会相切/相交，导致 ExtrudeGeometry 对 Shape 三角化失败，
    // 表现为乱三角、孔洞未正确镂空（仅部分孔通透）。
    const hexR = 2.2; // 六边形单元外接圆半径
    const holeR = hexR * 0.72; // 开孔半径（<R，预留蜂窝壁）
    const colSpacing = hexR * Math.sqrt(3); // 相邻列中心水平间距
    const rowSpacing = hexR * 1.5; // 相邻行中心纵向间距
    const margin = 3.2;
    const cols = Math.max(1, Math.floor((dims.w - margin * 2) / (hexR * Math.sqrt(3))));
    const rows = Math.max(1, Math.floor((dims.d - margin * 2) / rowSpacing));
    const startX = -((cols - 1) * colSpacing) / 2;
    const startZ = -((rows - 1) * rowSpacing) / 2;
    const holes: { x: number; z: number; type: 'circle' | 'hex'; r: number }[] = [];
    for (let r = 0; r < rows; r++) {
      const off = r % 2 === 0 ? 0 : colSpacing / 2;
      for (let c = 0; c < cols; c++) {
        const x = startX + c * colSpacing + off;
        if (Math.abs(x) > dims.w / 2 - margin) continue;
        holes.push({ x, z: startZ + r * rowSpacing, type: 'hex', r: holeR });
      }
    }
    const geo = createCutCornerPanelGeometry(dims.w, dims.d, 0.7, 5, holes);
    addMesh(geo, mat, 0, 0, 0);
    return;
  }
  if (ext === 'brick') {
    // 积木板：底板 + 众多圆凸粒
    addMesh(createCutCornerPanelGeometry(dims.w, dims.d, 0.8, 2.2, []), mat, 0, 0.2, 0);
    const studs = 23;
    const gap = (dims.w - 3) / studs;
    const stud = new THREE.CylinderGeometry(0.33, 0.39, 0.34, 8);
    const studsGeometry: THREE.BufferGeometry[] = [];
    for (let i = 0; i < studs; i++) {
      for (let j = 0; j < studs; j++) {
        if ((i === 0 || i === studs - 1) && (j === 0 || j === studs - 1)) continue;
        studsGeometry.push(stud.clone().translate((i - (studs - 1) / 2) * gap, 0.76, (j - (studs - 1) / 2) * gap));
      }
    }
    addMesh(mergeGeometries(studsGeometry), mat);
    stud.dispose();
    studsGeometry.forEach(geo => geo.dispose());
    return;
  }
  if (ext === 'ninehole') {
    // 九洞板：浅蓝底板（四角内凹切角）3×3 均匀布置 9 个直径 7cm 的圆形镂空通孔
    const spacing = Math.min(dims.w, dims.d) / 3;
    const posVals = [-spacing, 0, spacing];
    const holes: { x: number; z: number; type: 'circle' | 'hex'; r: number }[] = [];
    for (const ix of posVals) {
      for (const iz of posVals) {
        holes.push({ x: ix, z: iz, type: 'circle', r: 3.5 });
      }
    }
    const geo = createCutCornerPanelGeometry(dims.w, dims.d, 0.9, 5, holes);
    addMesh(geo, mat, 0, 0, 0);
    return;
  }
  if (ext === 'basketball') {
    // 篮球板：方形竖立篮板（四角内凹切角）＋ 板面中心水平向前伸出的白色篮筐 ＋ 白黄相间下垂篮网。
    // 本地坐标约定（挂装为立面板时）：local X = 板宽、local Y = 板厚/前伸方向、local Z = 竖直方向。
    const bw = spec.plateWidth; // 篮板宽（40）
    const bd = spec.plateDepth; // 篮板高（40，立放后）
    const boardGeo = createCutCornerPanelGeometry(bw, bd, 0.9, 5, []);
    addMesh(boardGeo, mat, 0, 0, 0);

    const whiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.6 });
    const hoopR = 8.6; // 篮筐半径（较原先 4.2 扩大一倍以上）
    const protrude = 15; // 篮筐相对板面前伸距离（local Y）
    // 白色安装板（贴合篮板正面，居中）
    addMesh(new THREE.BoxGeometry(16, 0.6, 16), whiteMat, 0, 0.7, 0);
    // 连接臂（从安装板向前伸出，托起篮筐）
    addMesh(new THREE.BoxGeometry(4.5, protrude - 1, 4.5), whiteMat, 0, (protrude + 1) / 2, 0);
    // 篮筐：水平圆环（local XY 平面 → 挂装后即水平朝上、向前伸出）
    addMesh(new THREE.TorusGeometry(hoopR, 0.5, 12, 40), whiteMat, 0, protrude, 0);

    // 篮网：白黄相间，从篮筐圆环向下垂挂（挂装后“下”= local -Z）
    const netWhiteMat = new THREE.MeshStandardMaterial({ color: '#f7f7f2', transparent: true, opacity: 0.78, wireframe: true, side: THREE.DoubleSide });
    const netYellowMat = new THREE.MeshStandardMaterial({ color: '#F7CA45', transparent: true, opacity: 0.78, wireframe: true, side: THREE.DoubleSide });
    const addNet = (topR: number, botR: number, len: number, m: THREE.Material, zc: number) => {
      const g = new THREE.CylinderGeometry(topR, botR, len, 16, 2, true);
      g.rotateX(Math.PI / 2); // local +Z 为篮筐上方
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, protrude, zc);
      mesh.castShadow = true;
      group.add(mesh);
    };
    addNet(hoopR, hoopR * 0.82, 5.5, netWhiteMat, -2.75);
    addNet(hoopR * 0.82, hoopR * 0.5, 5, netYellowMat, -8);
    return;
  }
  if (ext === 'maze') {
    const frame = mat.clone();
    frame.roughness = 0.44;
    addMesh(createCutCornerPanelGeometry(dims.w, dims.d, 1.5, 2.2, []), frame);
    buildMazeFace(group, mat);
    return;
  }
  if (ext === 'ropenet') {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion).y;
    const drop = Math.abs(up) > 0.95 ? Math.sign(up) * 2.2 : 0;
    buildRopeNet(group, mat, spec.plateWidth, spec.plateDepth, drop);
    return;
  }
  if (ext === 'rockbig' || ext === 'rockmid' || ext === 'rocksmall') {
    addMesh(createCutCornerPanelGeometry(dims.w, dims.d, 0.8, 2.6, []), mat, 0, 0.2, 0);
    if (ext === 'rocksmall') {
      // 20×40 配件沿长边横向使用，单个红色抓点偏一侧。
      buildClimbingHold(group, mat, 'red', 0, -8.4, Math.PI / 2);
    } else {
      const medium = ext === 'rockmid';
      buildClimbingHold(group, mat, 'red', medium ? 5.9 : 8.2, -11.2);
      buildClimbingHold(group, mat, 'blue', medium ? -5.9 : -9, 10.7, medium ? 0.15 : -0.16);
    }
    return;
  }
  if (ext === 'storbox') {
    const plastic = mat.clone();
    plastic.roughness = 0.46;
    addMesh(storageBasin(spec), plastic);
    return;
  }
  if (ext === 'capsule') {
    // 亚克力太空舱：透明亚克力方板 + 中心圆洞 + 透明半球舱
    const panelW = spec.plateWidth;   // 39.5
    const panelD = spec.plateDepth;   // 39.5
    const panelT = spec.plateThickness ?? 1;
    const domeR = 12;                  // 半球半径
    const holeR = domeR * 0.85;        // 板面开洞半径（略小于半球半径，半球边缘嵌入板内）

    const acrylicMat = new THREE.MeshStandardMaterial({
      color: '#d6f0ff',
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // 1) 透明方板（中心开圆洞）
    const shape = new THREE.Shape();
    const hw = panelW / 2, hd = panelD / 2;
    shape.moveTo(-hw, -hd);
    shape.lineTo(hw, -hd);
    shape.lineTo(hw, hd);
    shape.lineTo(-hw, hd);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeR, 0, Math.PI * 2, false);
    shape.holes.push(hole);
    const panelGeo = new THREE.ExtrudeGeometry(shape, { depth: panelT, bevelEnabled: false });
    panelGeo.rotateX(-Math.PI / 2); // 使板面水平，法线朝上
    const panelMesh = new THREE.Mesh(panelGeo, acrylicMat);
    panelMesh.position.y = 0;
    panelMesh.castShadow = false;
    panelMesh.receiveShadow = true;
    group.add(panelMesh);

    // 2) 透明半球舱（从板面中心向上凸起）
    const domeGeo = new THREE.SphereGeometry(domeR, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMesh = new THREE.Mesh(domeGeo, acrylicMat);
    domeMesh.position.y = panelT / 2; // 半球底面贴在板面上
    domeMesh.castShadow = false;
    domeMesh.receiveShadow = false;
    group.add(domeMesh);

    // 3) 洞口边缘圆环（装饰，增强立体感）
    const ringMat = new THREE.MeshStandardMaterial({
      color: '#a0c8e8',
      transparent: true,
      opacity: 0.5,
      roughness: 0.2,
      metalness: 0.3,
    });
    const ringGeo = new THREE.TorusGeometry(holeR, 0.3, 8, 40);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 2; // 水平放置
    ringMesh.position.y = panelT / 2;
    group.add(ringMesh);
    return;
  }

  // 兜底：普通平台板（未命中分型的扩展板件也按板渲染）
  const geo = createPlatformGeometry(spec);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

export function createPartMesh(part: PlacedPart, def: PartDefinition, color: string, opacity = 1, outlineColor?: string): THREE.Group {
  const group = new THREE.Group();
  // 兼容旧方案数据中缺失 position/rotation 的情况
  const pos = part.position || [0, 0, 0];
  const rot = part.rotation || [0, 0, 0];
  group.position.set(pos[0], pos[1], pos[2]);
  group.rotation.set(rot[0], rot[1], rot[2]);

  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: def.category === 'connector' ? 0.38 : 0.52,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });

  // 八字扣：两个并排的空心圆管连体（8字形双环），替代通用球+套筒造型
  if (def.id === 'connector-bazi') {
    const tubeLen = 5; // 单筒轴向长度（沿 X）
    const tubeOuterR = 5.5 / 2; // 单筒外半径（与并排总宽 11 = 2×5.5 贴合）
    const tubeInnerR = 4.5 / 2; // 单筒内半径（略大于杆外径 4.4，可套杆）
    const geo = createBarTubeGeometry(tubeLen, tubeOuterR, tubeInnerR);
    // 两筒沿 Z 方向并排贴合（中心距 = 外径 5.5）
    const tubeA = new THREE.Mesh(geo, mat);
    tubeA.position.set(0, 0, -tubeOuterR);
    tubeA.castShadow = true;
    tubeA.receiveShadow = true;
    const tubeB = new THREE.Mesh(geo, mat);
    tubeB.position.set(0, 0, tubeOuterR);
    tubeB.castShadow = true;
    tubeB.receiveShadow = true;
    group.add(tubeA, tubeB);
  } else if (def.extKind === 'roof-triangle' && part.roofOutline) {
    const shape = new THREE.Shape(part.roofOutline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: PLATE_THICKNESS, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2).translate(0, -PLATE_THICKNESS / 2, 0);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  } else if (def.extension && def.extKind) {
    // ===== 扩展配件专属渲染（扩展杆件 / 扩展板件）=====
    buildExtensionMesh(group, def, mat, createPlatformGeometry);
    if (def.extKind === 'basketball' || def.extKind === 'maze') {
      // Wall mounting can reverse local Z. Align the basket's local up with
      // world up projected into the board plane, preserving its front face.
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion.clone().invert());
      if (Math.hypot(localUp.x, localUp.z) > 0.001) {
        const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(localUp.x, localUp.z));
        group.children.forEach(child => {
          child.position.applyQuaternion(turn);
          child.quaternion.premultiply(turn);
        });
      }
    }
  } else if (def.category === 'connector' && def.connectorSpec) {
    const spec = def.connectorSpec;
    const coreR = spec.centerDiameter / 2;
    const socketR = spec.socketDiameter / 2;
    const socketLen = spec.socketLength;

    // 中心球体
    const coreGeo = new RoundedBoxGeometry(coreR * 2, coreR * 2, coreR * 2, 3, coreR * 0.83);
    const core = new THREE.Mesh(coreGeo, mat);
    core.castShadow = true;
    core.receiveShadow = true;
    group.add(core);

    // 接口套筒（从中心球表面向外延伸 socketLen）
    const points = def.connectionPoints || [];
    for (const cp of points) {
      const dir = new THREE.Vector3(cp.direction[0], cp.direction[1], cp.direction[2]).normalize();
      // 嵌套套筒端（female）：空心管口，用来套住 male 凸头（外径 4cm）。
      // 尺寸按 45度两通工程图：内径 4cm、外径 5cm、壁厚 0.5cm。
      const isNest = cp.type === 'female';
      // female 嵌套套筒：按 45度工程图水平端口轴向长 6.82cm；male 套筒仍用 socketLen(4cm)
      const cpLen = isNest ? (def.id === 'connector-45deg-nest' ? NEST_COMBO_SOCKET_LENGTH : NEST_SOCKET_LENGTH) : socketLen;
      const shoulder = def.id === 'connector-45deg-nest' && cp.id === 'up45'
        ? NEST_SLOPE_SHOULDER : coreR;
      // 参考模型斜接口具有加长颈部；接杆肩部与连接点使用同一基准。
      if (shoulder > coreR) {
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(coreR, coreR, shoulder, 24), mat);
        neck.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        neck.position.copy(dir.clone().multiplyScalar(shoulder / 2));
        neck.castShadow = true;
        group.add(neck);
      }
      const overlap = isNest ? 0.28 : 1.05;
      const socketGeo = moldedTube(
        cpLen + overlap,
        isNest ? NEST_SOCKET_OUTER_DIAMETER / 2 : socketR,
        isNest ? NEST_SOCKET_INNER_DIAMETER / 2 : socketR - spec.socketWallThickness,
        isNest ? [] : [(cpLen + overlap) / 2 - 1.05],
        0.39,
      );
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      socketGeo.applyQuaternion(quat);
      const socket = new THREE.Mesh(socketGeo, mat);
      socket.castShadow = true;
      socket.receiveShadow = true;
      // 套筒从中心球表面向外延伸：位置 = 中心 + dir * (coreR + cpLen/2)
      // female 外径更粗但定位基准仍取中心球表面起点，保证 male/female 贴合面对齐一致
      socket.position.copy(dir.clone().multiplyScalar(shoulder + (cpLen - overlap) / 2));
      group.add(socket);
    }
  } else if (def.category === 'bar' && def.barSpec) {
    // 中空圆管
    const { length, outerDiameter, innerDiameter } = def.barSpec;
    const geo = moldedTube(length, outerDiameter / 2, innerDiameter / 2, [-length / 2 + 2.3, length / 2 - 2.3], 0.55);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  } else if (def.category === 'platform' && def.platformSpec) {
    // 平台板（平板 + 折边）
    const geo = createPlatformGeometry(def.platformSpec);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 让平台板的顶面在 y = 位置 + 厚度/2（即 group 位置对应板的中心）
    // 折边向下伸，这正好符合几何设计
    group.add(mesh);
  } else {
    // fallback
    const { width, height, depth } = def.size;
    const geo = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 外描边（选中高亮）
  if (outlineColor) {
    const edgesMat = new THREE.LineBasicMaterial({ color: outlineColor, linewidth: 2 });
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const edges = new THREE.EdgesGeometry(child.geometry, 1);
        const line = new THREE.LineSegments(edges, edgesMat);
        child.add(line);
      }
    });
  }

  return group;
}
