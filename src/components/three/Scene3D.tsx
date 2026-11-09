'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore, collectGroupPartIds, getTopGroupOf } from '@/store/useStore';
import { PlacedPart, PartDefinition, SceneGroup } from '@/types/parts';
import { PART_COLORS, CONNECTOR_COLORS, PARTS_LIBRARY, getPartById, COMBO_45L, NEST_SOCKET_OUTER_DIAMETER, NEST_SOCKET_INNER_DIAMETER, NEST_SOCKET_LENGTH } from '@/data/parts';

type DesignerState = ReturnType<typeof useStore.getState>;

interface SceneContextMenu {
  x: number;
  y: number;
  ids: string[];
}

interface SceneRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
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
  const plateGeo = new THREE.BoxGeometry(plateWidth, plateThickness, plateDepth);

  // 折边使用四个 Box，通过 mergeGeometries 合并
  // 折边中点 Y（板下方向下突出）。
  // 额外下移 0.01cm，避免折边顶面与板底（y=-thickness/2）共面产生 Z-fighting ，
  // 否则顶面视角会出现深灰色直角三角形网格线
  const rimTopY = -plateThickness / 2 - rimHeight / 2 - 0.01;
  const frontRim = new THREE.BoxGeometry(plateWidth - rimThickness * 2, rimHeight, rimThickness);
  frontRim.translate(0, rimTopY, -plateDepth / 2 + rimThickness / 2);
  const backRim = new THREE.BoxGeometry(plateWidth - rimThickness * 2, rimHeight, rimThickness);
  backRim.translate(0, rimTopY, plateDepth / 2 - rimThickness / 2);
  const leftRim = new THREE.BoxGeometry(rimThickness, rimHeight, plateDepth);
  leftRim.translate(-plateWidth / 2 + rimThickness / 2, rimTopY, 0);
  const rightRim = new THREE.BoxGeometry(rimThickness, rimHeight, plateDepth);
  rightRim.translate(plateWidth / 2 - rimThickness / 2, rimTopY, 0);

  // 合并几何体
  const merged = mergeGeometries([plateGeo, frontRim, backRim, leftRim, rightRim]);
  return merged;
}

// 生成布艺编织纹理（CanvasTexture）：用于布兜等软质配件的表面，区别于平滑硬质板材
function createFabricTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // 底色
  ctx.fillStyle = '#b0b0a8';
  ctx.fillRect(0, 0, size, size);
  const cell = 12; // 每格纱线宽度
  // 经纬纱线明暗交错（平纹编织）
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const dark = ((x / cell) + (y / cell)) % 2 === 0;
      ctx.fillStyle = dark ? '#c4c4bb' : '#94948b';
      ctx.fillRect(x, y, cell, cell);
    }
  }
  // 纬向纱线细纹（水平）
  ctx.strokeStyle = '#808078';
  ctx.lineWidth = 1;
  for (let y = 0; y <= size; y += cell / 2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  // 经向纱线细纹（垂直）
  ctx.strokeStyle = '#9a9a91';
  for (let x = 0; x <= size; x += cell / 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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
  const hw = w / 2;
  const hd = d / 2;
  const cc = cornerCut;
  const shape = new THREE.Shape();
  // 外轮廓：方形四角切掉 45° 等腰直角三角形（内凹切角）
  shape.moveTo(-hw + cc, -hd);
  shape.lineTo(hw - cc, -hd);
  shape.lineTo(hw, -hd + cc);
  shape.lineTo(hw, hd - cc);
  shape.lineTo(hw - cc, hd);
  shape.lineTo(-hw + cc, hd);
  shape.lineTo(-hw, hd - cc);
  shape.lineTo(-hw, -hd + cc);
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

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -thickness / 2, 0);
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
  const darkMat = new THREE.MeshStandardMaterial({
    color: '#444444',
    roughness: 0.7,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const redMat = new THREE.MeshStandardMaterial({
    color: '#EE5A5A',
    roughness: 0.5,
    side: THREE.DoubleSide,
  });

  const addMesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, scaleY = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(1, scaleY, 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // 1) 扩展杆件：35CM 圆管 + 亮黄三辐方向盘（固定于管身中部上方）
  if (ext === 'wheelbar') {
    const tubeGeo = createBarTubeGeometry(35, 4.4 / 2, 4.0 / 2);
    addMesh(tubeGeo, mat, 0, 0, 0);
    // 方向盘：圆环（轮胎）+ 三辐条 + 中心毂
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#F7CA45', roughness: 0.4, side: THREE.DoubleSide });
    const rimGeo = new THREE.TorusGeometry(5, 0.9, 12, 32);
    const rim = new THREE.Mesh(rimGeo, wheelMat);
    rim.position.set(0, 8.5, 0);
    rim.rotation.set(Math.PI / 2, 0, 0);
    rim.castShadow = true;
    group.add(rim);
    // 中心毂
    addMesh(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 16), wheelMat, 0, 8.5, 0, 0);
    // 三辐条（Y 方向在环面内均布）：辐条沿竖直平面内的三条径向方向
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), wheelMat);
      spoke.position.set(0, 8.5, 0);
      spoke.rotation.z = (i * Math.PI * 2) / 3;
      const tmp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), wheelMat);
      tmp.position.set(0, 2.1, 0);
      tmp.updateMatrix();
      spoke.add(tmp);
      spoke.updateMatrixWorld();
      group.add(spoke);
    }
    return;
  }

  // 2) 扩展板件（按 extKind 分型）
  if (!spec) return;

  const dims = {
    w: def.size.width,
    d: def.size.depth,
  };

  if (ext === 'glass') {
    // PC 玻璃栈道：透明板 + 白色金属边框
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#cfeeff',
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
      metalness: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    addMesh(new THREE.BoxGeometry(dims.w - 1, 0.5, dims.d - 1), glassMat, 0, 1.2, 0);
    // 边框条
    const frameMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
    const fw = dims.w / 2 - 0.2, fd = dims.d / 2 - 0.2;
    addMesh(new THREE.BoxGeometry(dims.w, 1.2, 0.6), frameMat, 0, 0.8, -fd);
    addMesh(new THREE.BoxGeometry(dims.w, 1.2, 0.6), frameMat, 0, 0.8, fd);
    addMesh(new THREE.BoxGeometry(0.6, 1.2, dims.d), frameMat, -fw, 0.8, 0);
    addMesh(new THREE.BoxGeometry(0.6, 1.2, dims.d), frameMat, fw, 0.8, 0);
    return;
  }
  if (ext === 'pouch') {
    // 布兜：方形悬挂兜袋。顶部开口（四角绳扣挂在框架顶部4根圆管上），主体从开口向下沉入框架内部
    // 本地坐标：兜口绳索环位于 y≈0 附近（贴合框架顶面），兜壁/兜底向下延伸到 -depth
    // 布料材质：编织纹理 map + bumpMap，粗糙度高、无金属感，与平滑硬质板材形成区分
    const fabricTex = createFabricTexture();
    fabricTex.repeat.set(4, 4);
    const pouchMat = new THREE.MeshStandardMaterial({
      color: mat.color,
      roughness: 0.85,
      metalness: 0,
      map: fabricTex,
      bumpMap: fabricTex,
      bumpScale: 0.5,
      side: THREE.DoubleSide,
    });
    const half = dims.w / 2;
    const depth = 25; // 兜深：约 25cm，主体从顶部圆管口下沉、不到框架底
    // 兜底（y = -depth）
    addMesh(new THREE.BoxGeometry(dims.w - 0.6, 0.5, dims.d - 0.6), pouchMat, 0, -depth, 0);
    // 四面侧壁：从兜口(y≈0)向下至兜底(-depth)
    addMesh(new THREE.BoxGeometry(dims.w, depth, 0.5), pouchMat, 0, -depth / 2, -half);
    addMesh(new THREE.BoxGeometry(dims.w, depth, 0.5), pouchMat, 0, -depth / 2, half);
    addMesh(new THREE.BoxGeometry(0.5, depth, dims.d), pouchMat, -half, -depth / 2, 0);
    addMesh(new THREE.BoxGeometry(0.5, depth, dims.d), pouchMat, half, -depth / 2, 0);
    // 兜口翻边（略高于兜口，形成开口边缘）
    addMesh(new THREE.BoxGeometry(dims.w, 1.2, 0.4), pouchMat, 0, 0.4, -half);
    addMesh(new THREE.BoxGeometry(dims.w, 1.2, 0.4), pouchMat, 0, 0.4, half);
    addMesh(new THREE.BoxGeometry(0.4, 1.2, dims.d), pouchMat, -half, 0.4, 0);
    addMesh(new THREE.BoxGeometry(0.4, 1.2, dims.d), pouchMat, half, 0.4, 0);
    // 顶部四角绳扣（挂在框架顶部4根圆管上）
    const cueMat = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.8 });
    const corners: [number, number, number][] = [[-half, 0, -half], [-half, 0, half], [half, 0, -half], [half, 0, half]];
    for (const c of corners) addMesh(new THREE.TorusGeometry(1.0, 0.35, 8, 16), cueMat, c[0], c[1], c[2]);
    return;
  }
  if (ext === 'rainbow') {
    // 彩虹门：多彩竖条织带扉
    const w = dims.w;
    const colors = ['#FF5A5A', '#F7CA45', '#26C281', '#4A90D9', '#B19CD9'];
    const stripeW = 4;
    const count = Math.floor(w / stripeW);
    for (let i = 0; i < count; i++) {
      const c = colors[i % colors.length];
      const sm = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide });
      addMesh(new THREE.BoxGeometry(stripeW - 0.2, 40, 0.4), sm, -w / 2 + stripeW / 2 + i * stripeW, 20, 0);
    }
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
    addMesh(new THREE.BoxGeometry(dims.w, 0.8, dims.d), mat, 0, 0.2, 0);
    const studs = 8;
    const gap = dims.w / studs;
    for (let i = 0; i < studs; i++) {
      for (let j = 0; j < studs; j++) {
        addMesh(
          new THREE.CylinderGeometry(0.45, 0.45, 1, 12),
          mat,
          -dims.w / 2 + gap / 2 + i * gap,
          1.2,
          -dims.d / 2 + gap / 2 + j * gap
        );
      }
    }
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
      const g = new THREE.CylinderGeometry(topR, botR, len, 16, 2);
      g.rotateX(Math.PI / 2); // 轴由 Y 对齐到 local Z（竖直向下）
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
    // 迷宫板：红色外框 + 原木操作面板 + 卡通装饰（太阳/绿叶/小虫）+ 彩色滑珠 + 运算滑块
    const woodMat = new THREE.MeshStandardMaterial({ color: '#d9b38c', roughness: 0.6, side: THREE.DoubleSide });
    addMesh(new THREE.BoxGeometry(dims.w, 0.8, dims.d), woodMat, 0, 0.15, 0);
    // 红色外框
    const half = dims.w / 2;
    addMesh(new THREE.BoxGeometry(dims.w, 1.4, 0.6), redMat, 0, 0.6, -half);
    addMesh(new THREE.BoxGeometry(dims.w, 1.4, 0.6), redMat, 0, 0.6, half);
    addMesh(new THREE.BoxGeometry(0.6, 1.4, dims.d), redMat, -half, 0.6, 0);
    addMesh(new THREE.BoxGeometry(0.6, 1.4, dims.d), redMat, half, 0.6, 0);
    // 顶部彩色滑珠滑槽（横梁）
    addMesh(new THREE.BoxGeometry(dims.w - 8, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: '#c8a87a' }), 0, 1.05, -half + 6);
    // 彩色滑珠（红/黄/蓝/绿沿槽分布）
    const beadColors = ['#EE5A5A', '#F7CA45', '#4A90D9', '#26C281'];
    for (let i = 0; i < 4; i++) {
      const bm = new THREE.MeshStandardMaterial({ color: beadColors[i], roughness: 0.3 });
      addMesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 14), bm, -10 + i * 6.6, 1.45, -half + 6);
    }
    // 两枚运算符号滑块（带数字/符号的小方块）
    addMesh(new THREE.BoxGeometry(2.2, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }), -6, 1.0, 4);
    addMesh(new THREE.BoxGeometry(2.2, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: '#F7CA45', roughness: 0.4 }), 5, 1.0, -5);
    // 卡通太阳（左上 + 四向光芒）
    const sunMat = new THREE.MeshStandardMaterial({ color: '#F7CA45', roughness: 0.4 });
    addMesh(new THREE.CylinderGeometry(1.4, 1.4, 0.5, 18), sunMat, -half + 4, 1.2, half - 4);
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2;
      addMesh(new THREE.BoxGeometry(0.5, 0.3, 1.6), sunMat, -half + 4 + Math.cos(a) * 2.2, 1.2, half - 4 + Math.sin(a) * 2.2);
    }
    // 两片绿叶
    const leafMat = new THREE.MeshStandardMaterial({ color: '#26C281', roughness: 0.5, side: THREE.DoubleSide });
    addMesh(new THREE.BoxGeometry(1.6, 0.25, 0.9), leafMat, 9, 1.0, 10);
    addMesh(new THREE.BoxGeometry(1.6, 0.25, 0.9), leafMat, 12, 1.0, 8);
    // 卡通小虫（红色半球 + 黑点）
    addMesh(new THREE.CylinderGeometry(1.1, 1.5, 0.8, 16), redMat, -12, 0.85, -10);
    addMesh(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 8), darkMat, -12, 1.3, -11.4);
    return;
  }
  if (ext === 'ropenet') {
    // 爬网：灰白双色绳线编织的方格网（水平网格，绳结固定于四边）
    const grayMat = new THREE.MeshStandardMaterial({ color: '#9a9a9a', roughness: 0.85, side: THREE.DoubleSide });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#f5f5f0', roughness: 0.75, side: THREE.DoubleSide });
    const n = 8;
    const gap = dims.w / n;
    const ropeR = 0.22;
    const addRope = (length: number, m: THREE.Material, x: number, y: number, z: number, alongX: boolean) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(ropeR, ropeR, length, 8), m);
      mesh.position.set(x, y, z);
      if (alongX) mesh.rotation.z = Math.PI / 2; // 沿 Y → 沿 X（横向绳）
      else mesh.rotation.x = Math.PI / 2; // 沿 Y → 沿 Z（纵向绳）
      mesh.castShadow = true;
      group.add(mesh);
    };
    // 横向绳（沿 X，分布于 Z 方向，灰白交替）
    for (let i = 0; i <= n; i++) {
      const z = -dims.d / 2 + i * gap;
      addRope(dims.w, i % 2 === 0 ? grayMat : whiteMat, 0, 0, z, true);
    }
    // 纵向绳（沿 Z，分布于 X 方向，白灰交替）
    for (let i = 0; i <= n; i++) {
      const x = -dims.w / 2 + i * gap;
      addRope(dims.d, i % 2 === 0 ? whiteMat : grayMat, x, 0, 0, false);
    }
    return;
  }
  if (ext === 'rockbig' || ext === 'rockmid' || ext === 'rocksmall') {
    // 攀岩板：黄色板 + 攀岩点（红/蓝半球凸点）
    addMesh(new THREE.BoxGeometry(dims.w, 0.8, dims.d), mat, 0, 0.2, 0);
    // 大板两只点（红/蓝），中板两只，小板一只
    const points: [number, number, string][] =
      ext === 'rocksmall'
        ? [[-5, 0, '#EE5A5A']]
        : ext === 'rockmid'
          ? [[-6, 5, '#EE5A5A'], [6, -5, '#4A90D9']]
          : [[-7, 6, '#EE5A5A'], [7, -6, '#4A90D9']];
    for (const [px, pz, pc] of points) {
      const holdMat = new THREE.MeshStandardMaterial({ color: pc, roughness: 0.5, side: THREE.DoubleSide });
      addMesh(new THREE.SphereGeometry(1.1, 16, 12), holdMat, px, 1, pz);
    }
    return;
  }
  if (ext === 'storbox') {
    // 收纳盒：敞口方槽 + 顶部翻边（卡搭在 1x1 框架顶杆上）+ 边耳
    // 盒体需能穿过框架杆件内缘（<35.6cm），翻边外缘需盖过杆件中心（>20cm）搭在杆顶
    const half = dims.w / 2; // 盒体半宽（dims.w≈34）
    const boxH = 15; // 盒体高度（局部 0=盒底，boxH=盒口/翻边底）
    const flangeThickness = 1; // 翻边厚度
    const flangeWidth = 6; // 翻边向外延伸宽度（外缘半宽 = half + 6 = 23，盖过杆中心20）
    const flangeOuter = half + flangeWidth; // 翻边外缘半宽
    const flangeLen = dims.w - 4; // 每条翻边长度略短于盒体外缘，四角留缺口避让连接球

    // 盒体四壁
    addMesh(new THREE.BoxGeometry(dims.w, boxH, 0.4), mat, 0, boxH / 2, -half);
    addMesh(new THREE.BoxGeometry(dims.w, boxH, 0.4), mat, 0, boxH / 2, half);
    addMesh(new THREE.BoxGeometry(0.4, boxH, dims.d - 0.4), mat, -half, boxH / 2, 0);
    addMesh(new THREE.BoxGeometry(0.4, boxH, dims.d - 0.4), mat, half, boxH / 2, 0);
    // 底板
    addMesh(new THREE.BoxGeometry(dims.w - 0.4, 0.4, dims.d - 0.4), mat, 0, 0.2, 0);

    // 顶部翻边：四条独立条带，搭在四根框架顶杆上，四角留缺口避开连接件球
    const flangeY = boxH + flangeThickness / 2;
    // 前后翻边（沿 X 方向铺，搭在 z=±20 的杆上）
    addMesh(new THREE.BoxGeometry(flangeLen, flangeThickness, flangeWidth), mat, 0, flangeY, -flangeOuter + flangeWidth / 2);
    addMesh(new THREE.BoxGeometry(flangeLen, flangeThickness, flangeWidth), mat, 0, flangeY, flangeOuter - flangeWidth / 2);
    // 左右翻边（沿 Z 方向铺，搭在 x=±20 的杆上）
    addMesh(new THREE.BoxGeometry(flangeWidth, flangeThickness, flangeLen), mat, -flangeOuter + flangeWidth / 2, flangeY, 0);
    addMesh(new THREE.BoxGeometry(flangeWidth, flangeThickness, flangeLen), mat, flangeOuter - flangeWidth / 2, flangeY, 0);

    // 边耳（两侧小凸耳，位于左右翻边沿上）
    const earMat = new THREE.MeshStandardMaterial({ color: '#e0e0e0', roughness: 0.6 });
    addMesh(new THREE.BoxGeometry(2, 1.2, 3), earMat, -flangeOuter + flangeWidth / 2, boxH + 0.2, 0);
    addMesh(new THREE.BoxGeometry(2, 1.2, 3), earMat, flangeOuter - flangeWidth / 2, boxH + 0.2, 0);
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
    roughness: 0.6,
    metalness: 0.1,
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
  } else if (def.extension && def.extKind) {
    // ===== 扩展配件专属渲染（扩展杆件 / 扩展板件）=====
    buildExtensionMesh(group, def, mat, createPlatformGeometry);
  } else if (def.category === 'connector' && def.connectorSpec) {
    const spec = def.connectorSpec;
    const coreR = spec.centerDiameter / 2;
    const socketR = spec.socketDiameter / 2;
    const socketLen = spec.socketLength;

    // 中心球体
    const coreGeo = new THREE.SphereGeometry(coreR, 20, 16);
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
      const cpLen = isNest ? NEST_SOCKET_LENGTH : socketLen;
      let socketGeo: THREE.BufferGeometry;
      if (isNest) {
        const nestOuterR = NEST_SOCKET_OUTER_DIAMETER / 2; // 外半径 2.5（外径 5）
        const nestInnerR = NEST_SOCKET_INNER_DIAMETER / 2; // 内半径 2.0（内径 4）
        // 空心管壁：LatheGeometry 沿 Y 轴旋转（与 male 实心 CylinderGeometry 同为 Y 轴，后续统一定向）
        const pts: THREE.Vector2[] = [
          new THREE.Vector2(nestOuterR, -cpLen / 2),
          new THREE.Vector2(nestOuterR, cpLen / 2),
          new THREE.Vector2(nestInnerR, cpLen / 2),
          new THREE.Vector2(nestInnerR, -cpLen / 2),
        ];
        socketGeo = new THREE.LatheGeometry(pts, 24);
      } else {
        socketGeo = new THREE.CylinderGeometry(socketR, socketR, cpLen, 16);
      }
      // 对齐方向（默认圆柱/管壁沿 Y 轴，旋转到 dir）
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      socketGeo.applyQuaternion(quat);
      const socket = new THREE.Mesh(socketGeo, mat);
      socket.castShadow = true;
      socket.receiveShadow = true;
      // 套筒从中心球表面向外延伸：位置 = 中心 + dir * (coreR + cpLen/2)
      // female 外径更粗但定位基准仍取中心球表面起点，保证 male/female 贴合面对齐一致
      socket.position.copy(dir.clone().multiplyScalar(coreR + cpLen / 2));
      group.add(socket);
    }
  } else if (def.category === 'bar' && def.barSpec) {
    // 中空圆管
    const { length, outerDiameter, innerDiameter } = def.barSpec;
    const geo = createBarTubeGeometry(length, outerDiameter / 2, innerDiameter / 2);
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

// 组合刚体吸附：将 45°L 嵌套组合整体「绕竖直轴旋转 + 平移」，使其中一闲置端与最近的杆件端口正确嵌套。
// 关键：组合是「斜杆端(up45，仰角45°) + 立杆端(竖直向下)」的结构化形态，必须保持立杆始终竖直、斜杆保持45°仰角，
// 只允许绕世界 Y 轴做水平旋转（镜像匹配屋顶左侧/右侧）与整体平移，避免被任意 3D 旋转扭转成横向横杆。
function snapComboRigid(comboParts: PlacedPart[]): PlacedPart[] | null {
  const comboIdSet = new Set(comboParts.map((p) => p.id));
  const allParts = useStore.getState().parts;
  const others = getWorldConnPoints(allParts).filter((cp) => !comboIdSet.has(cp.partId));
  if (others.length === 0) return null;

  const partSelf: { part: PlacedPart; def: PartDefinition; cps: WorldConnPoint[] }[] = [];
  for (const p of comboParts) {
    const def = getPartById(p.partId);
    if (!def || !def.connectionPoints) continue;
    partSelf.push({ part: p, def, cps: getSelfWorldConnPoints(p, def) });
  }

  const THRESH = SNAP_CONNECT_DIST + 15;
  let best: { transform: PlacedPart[]; connected: number; alignDist: number } | null = null;

  // 对每个组合 male 闲置端作为锚，匹配一个周围 female 杆件端口
  for (const ps of partSelf) {
    for (const sc of ps.cps) {
      if (sc.type !== 'male') continue; // 锚点只用 male（套管），其插入杆件 female 凹口
      for (const oc of others) {
        if (oc.type !== 'female') continue;
        const d0 = sc.position.distanceTo(oc.position);
        if (d0 > THRESH) continue;

        // 仅绕世界 Y 轴旋转：把 sc 的水平方向对准 -oc 的水平方向（竖直分量保持不变）
        const a = new THREE.Vector3(sc.direction.x, 0, sc.direction.z).normalize();
        const b = new THREE.Vector3(-oc.direction.x, 0, -oc.direction.z).normalize();
        // 竖直朝向的端口水平投影可能接近零向量，此时无需水平旋转
        let Qy: THREE.Quaternion;
        if (a.lengthSq() > 1e-4 && b.lengthSq() > 1e-4) {
          // a、b 均落在水平面上，最小旋转四元数即绕竖直轴 Y 的旋转（唯一、无歧义）
          Qy = new THREE.Quaternion().setFromUnitVectors(a, b);
        } else {
          Qy = new THREE.Quaternion();
        }
        // 旋转后 sc 的世界位置（以 ps.part 位置为枢轴）
        const pivot = new THREE.Vector3(ps.part.position[0], ps.part.position[1], ps.part.position[2]);
        const scAfter = sc.position.clone().sub(pivot).applyQuaternion(Qy).add(pivot);
        const deltaT = new THREE.Vector3().subVectors(oc.position, scAfter);

        const transformed: PlacedPart[] = comboParts.map((p) => {
          const pp = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
          const rotated = pp.clone().sub(pivot).applyQuaternion(Qy).add(pivot).add(deltaT);
          const pq = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]));
          const nq = new THREE.Quaternion().multiplyQuaternions(Qy, pq);
          const ne = new THREE.Euler().setFromQuaternion(nq);
          return { ...p, position: [rotated.x, rotated.y, rotated.z], rotation: [ne.x, ne.y, ne.z] };
        });

        // 统计整体对接端口数（含锚点），优先让最多闲置端真实对接；同数量取距离更近
        let connected = 1;
        for (const ts of partSelf) {
          const tpart = transformed.find((p) => p.id === ts.part.id)!;
          for (const tp of getSelfWorldConnPoints(tpart, ts.def)) {
            if (tp.cpId === sc.cpId && ts.part.id === ps.part.id) continue; // 锚点已计入
            if (findBestSnap([tp], others)) connected++;
          }
        }

        if (!best || connected > best.connected || (connected === best.connected && d0 < best.alignDist)) {
          best = { transform: transformed, connected, alignDist: d0 };
        }
      }
    }
  }
  return best ? best.transform : null;
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
    if (findBestSnap([scp], others)) continue;
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
    out.push({ ...tempGhost, position: tr.position, rotation: tr.rotation });
  }
  return out;
}
function findPlatformSnap(
  part: PlacedPart,
  def: PartDefinition,
  allParts: PlacedPart[]
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (def.category !== 'platform' || !def.platformSpec) return null;
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
    // 普通平台板：板底落在杆顶
    const newY = isStorbox
      ? center.y + barRadius - spec.rimHeight + 0.15
      : center.y + barRadius + spec.plateThickness / 2;

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

// 生长模式的通用“平台/立面封板自动识别”：
// - 水平矩形框架 → 在顶面铺平台板（按框架尺寸自动挑型号）
// - 竖直矩形框架 → 生成竖立封板（立面板）
// 返回最佳点位（离光标最近），已做“已存在平台”去重。
function findPanelFit(
  cursor: { x: number; y: number; z: number },
  allParts: PlacedPart[]
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
  const nearBars = bars
    .filter((b) => b.center.distanceTo(cursorV) < 75)
    .sort((a, b) => a.center.distanceTo(cursorV) - b.center.distanceTo(cursorV))
    .slice(0, 16);
  if (nearBars.length < 4) return null;

  const holder: { best: PanelFit | null } = { best: null };
  const consider = (candidate: PanelFit | null) => {
    if (!candidate) return;
    if (!holder.best || candidate.dist < holder.best.dist) holder.best = candidate;
  };

  // 平台型号匹配（尺寸 ±13 容差，允许宽深 swap）
  const matchPlatform = (w: number, d: number): { def: PartDefinition; swap: boolean } | null => {
    let chosen: PartDefinition | null = null;
    let swap = false;
    let bestDiff = Infinity;
    for (const pl of platforms) {
      const sp = pl.platformSpec!;
      const diff1 = Math.abs(w - sp.plateWidth) + Math.abs(d - sp.plateDepth);
      const diff2 = Math.abs(w - sp.plateDepth) + Math.abs(d - sp.plateWidth);
      const m = Math.min(diff1, diff2);
      if (m <= 13 && m < bestDiff) {
        bestDiff = m;
        chosen = pl;
        swap = diff2 < diff1;
      }
    }
    return chosen ? { def: chosen, swap } : null;
  };

  // 该位置是否已有平台
  const hasPlatformAt = (x: number, y: number, z: number) =>
    allParts.some((p) => {
      const pd = getPartById(p.partId);
      return pd && pd.category === 'platform' && Math.abs(p.position[0] - x) < 2 && Math.abs(p.position[1] - y) < 2 && Math.abs(p.position[2] - z) < 2;
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

      // 水平开口（顶面/底面封板）：法线接近竖直
      if (Math.abs(n.y) > 0.7) {
        if (Math.abs(u.y) > 0.3 || Math.abs(v.y) > 0.3) continue;
        const matched = matchPlatform(lenAlongU, lenAlongV);
        if (!matched) continue;
        const barRadius = q.reduce((s, g) => s + g.def.size.height, 0) / 8;
        const posY = center.y + barRadius + matched.def.platformSpec!.plateThickness / 2 - 0.2;
        if (hasPlatformAt(center.x, posY, center.z)) continue;
        // 宽 local+X / 厚 local+Y(上) / 深 local+Z；basisEuler 内部做右手系校正
        const rotation: [number, number, number] = matched.swap
          ? basisEuler(v, UP, u)
          : basisEuler(u, UP, v);
        consider({ partId: matched.def.id, position: [center.x, posY, center.z], rotation, dist: center.distanceTo(cursorV) });
        continue;
      }

      // 竖直开口（立面封板）：法线接近水平；两对中一对水平（上下边）、一对竖直（左右边）
      if (Math.abs(n.y) < 0.4) {
        const pairUhoriz = Math.abs(u.y) < 0.3;
        const pairVhoriz = Math.abs(v.y) < 0.3;
        if (pairUhoriz === pairVhoriz) continue; // 必须恰有一对水平、一对竖直
        // hAxis=上下水平杆方向（矩形宽边方向）；宽=左右竖直杆间距，高=上下水平杆间距
        const hAxis = pairUhoriz ? u : v;
        const width = pairUhoriz ? lenAlongV : lenAlongU;
        const height = pairUhoriz ? lenAlongU : lenAlongV;
        const matched = matchPlatform(width, height);
        if (!matched) continue;
        if (hasPlatformAt(center.x, center.y, center.z)) continue;
        // 宽 local+X 沿水平边、厚 local+Y 沿墙面法线、高 local+Z 沿世界竖直
        const rotation: [number, number, number] = matched.swap
          ? basisEuler(UP, n, hAxis)
          : basisEuler(hAxis, n, UP);
        consider({ partId: matched.def.id, position: [center.x, center.y, center.z], rotation, dist: center.distanceTo(cursorV) });
      }
      // 斜向开口（0.4~0.7）既非水平也非竖直封板，忽略
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

// 板件镜像：先识别与平台板四边相交接的 4 根杆件所构成的矩形平面（镜面），
// 再以该平面为镜像面把板镜像到对侧。整个计算只依赖实际杆件的世界方向与位置，
// 不使用板自身本地轴/世界固定轴，因此无论框架整体旋转到什么角度、板是否手动放置，
// 镜像后都与框架精确贴合、不会错位。
// 对中心对称的矩形板，绕镜面内铰链轴转 180° 的刚体变换与"平面反射"视觉等价，
// 且铰链轴取镜面内最接近世界竖直的方向，保证翻转后上下不倒置。
// 收纳盒（storbox）为不对称敞口容器，镜像无工程意义，不支持（返回 null）。
// 返回镜像后的世界 position / rotation；找不到相接杆件矩形时返回 null。
function mirrorPlatformTransform(
  part: PlacedPart,
  def: PartDefinition,
  allParts: PlacedPart[]
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  if (def.category !== 'platform' || !def.platformSpec || def.extKind === 'storbox') return null;
  const spec = def.platformSpec;
  const partPos = new THREE.Vector3(part.position[0], part.position[1], part.position[2]);
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(part.rotation[0], part.rotation[1], part.rotation[2]));
  const normalWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(q0); // 板厚方向（法线）

  // 收集附近杆件：中心、无向世界轴、两端点世界坐标
  interface BarInfo { center: THREE.Vector3; axis: THREE.Vector3; e0: THREE.Vector3; e1: THREE.Vector3 }
  const bars: BarInfo[] = [];
  for (const p of allParts) {
    if (p.id === part.id) continue;
    const pd = getPartById(p.partId);
    if (!pd || pd.category !== 'bar' || !pd.connectionPoints || pd.connectionPoints.length < 2) continue;
    const c = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
    if (c.distanceTo(partPos) > Math.max(spec.plateWidth, spec.plateDepth) + 25) continue;
    const bq = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]));
    const ep = pd.connectionPoints.map((cp) =>
      new THREE.Vector3(cp.position[0], cp.position[1], cp.position[2]).applyQuaternion(bq).add(c)
    );
    bars.push({ center: c, axis: ep[1].clone().sub(ep[0]).normalize(), e0: ep[0], e1: ep[1] });
  }
  if (bars.length < 4 || bars.length > 24) return null;

  const sizeMatch = (w: number, h: number) =>
    (Math.abs(w - spec.plateWidth) < 10 && Math.abs(h - spec.plateDepth) < 10)
    || (Math.abs(w - spec.plateDepth) < 10 && Math.abs(h - spec.plateWidth) < 10);

  const Y = new THREE.Vector3(0, 1, 0);
  interface MirrorPlane { center: THREE.Vector3; normal: THREE.Vector3; u: THREE.Vector3; dist: number }
  let best: MirrorPlane | null = null;

  // 枚举 4 根杆的组合，判断能否构成与板贴合的矩形框架平面
  const N = bars.length;
  for (let a = 0; a < N; a++) {
    for (let b = a + 1; b < N; b++) {
      for (let c = b + 1; c < N; c++) {
        for (let d = c + 1; d < N; d++) {
          const quad = [bars[a], bars[b], bars[c], bars[d]];
          // 3 种配对方式，找"两对平行 + 两对互相垂直"
          const pairings: Array<[number, number, number, number]> = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];
          let u: THREE.Vector3 | null = null;
          let v: THREE.Vector3 | null = null;
          for (const [i, j, k, l] of pairings) {
            const ai = quad[i].axis, aj = quad[j].axis, ak = quad[k].axis, al = quad[l].axis;
            if (Math.abs(ai.dot(aj)) > 0.985 && Math.abs(ak.dot(al)) > 0.985 && Math.abs(ai.dot(ak)) < 0.18) {
              u = ai.clone();
              v = ak.clone();
              break;
            }
          }
          if (!u || !v) continue;
          const n = new THREE.Vector3().crossVectors(u, v).normalize();
          // 4 根杆共面（杆中心到过 quad[0] 中心、法向 n 的平面距离）
          const p0 = quad[0].center;
          let coplanar = true;
          for (const qd of quad) {
            if (Math.abs(qd.center.clone().sub(p0).dot(n)) > 4) { coplanar = false; break; }
          }
          if (!coplanar) continue;
          // 8 个端点聚类成 4 个角点（不同杆之间距离 <8 合并），每角恰好 2 个端点
          const endpoints: { pos: THREE.Vector3; bar: number }[] = [];
          quad.forEach((qd, bi) => { endpoints.push({ pos: qd.e0, bar: bi }, { pos: qd.e1, bar: bi }); });
          const parent = [0, 1, 2, 3, 4, 5, 6, 7];
          const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
          for (let i = 0; i < 8; i++) {
            for (let j = i + 1; j < 8; j++) {
              if (endpoints[i].bar === endpoints[j].bar) continue;
              if (endpoints[i].pos.distanceTo(endpoints[j].pos) < 8) {
                const ri = find(i), rj = find(j);
                if (ri !== rj) parent[ri] = rj;
              }
            }
          }
          const groups = new Map<number, THREE.Vector3[]>();
          for (let i = 0; i < 8; i++) {
            const r = find(i);
            if (!groups.has(r)) groups.set(r, []);
            groups.get(r)!.push(endpoints[i].pos);
          }
          if (groups.size !== 4) continue;
          const garr = [...groups.values()];
          if (garr.some((g) => g.length !== 2)) continue;
          const corners = garr.map((g) => g[0].clone().add(g[1]).multiplyScalar(0.5));
          // 角点按绕中心方位角排序
          const ctr = corners[0].clone().add(corners[1]).add(corners[2]).add(corners[3]).multiplyScalar(0.25);
          corners.sort((c1, c2) => Math.atan2(
            new THREE.Vector3().crossVectors(c1.clone().sub(ctr), c2.clone().sub(ctr)).dot(n),
            c1.clone().sub(ctr).dot(c2.clone().sub(ctr))
          ));
          // 矩形校验：邻边垂直 + 对边等长
          const edges = [0, 1, 2, 3].map((i) => corners[(i + 1) % 4].clone().sub(corners[i]));
          const elen = edges.map((e) => e.length());
          if (Math.abs(edges[0].dot(edges[1])) > 0.15 * elen[0] * elen[1]) continue;
          if (Math.abs(edges[1].dot(edges[2])) > 0.15 * elen[1] * elen[2]) continue;
          if (Math.abs(elen[0] - elen[2]) > 6 || Math.abs(elen[1] - elen[3]) > 6) continue;
          const w = (elen[0] + elen[2]) / 2;
          const h = (elen[1] + elen[3]) / 2;
          if (w < 10 || h < 10 || !sizeMatch(w, h)) continue;
          // 板须贴合该平面：板中心在镜面内（法向距离 <5）、板法线与镜面法线近似平行
          const pc = partPos.clone().sub(ctr);
          if (Math.abs(pc.dot(n)) > 5) continue;
          if (Math.abs(normalWorld.dot(n)) < 0.8) continue;
          const dist = pc.length();
          if (dist > 18) continue;
          if (!best || dist < best.dist) best = { center: ctr, normal: n.clone(), u: u.clone(), dist };
        }
      }
    }
  }
  if (!best) return null;

  // ===== 以杆件矩形平面为镜面进行镜像 =====
  const n = best.normal;
  // 位置：对镜面（过矩形中心）做平面反射；水平搭放的贴合偏移会自动反射到对侧。
  const off = partPos.clone().sub(best.center);
  const newPos = partPos.clone().addScaledVector(n, -2 * off.dot(n));
  // 姿态：绕镜面内"铰链轴"转 180°（视觉等价于反射，且为合法刚体旋转）。
  // 铰链轴取世界竖直方向在镜面内的投影，保证翻转后上下不倒；镜面近水平时退化为镜面内 u 方向。
  let hinge = Y.clone().addScaledVector(n, -Y.dot(n));
  if (hinge.length() < 0.25) hinge = best.u.clone();
  hinge.normalize();
  const qRot = new THREE.Quaternion().setFromAxisAngle(hinge, Math.PI); // 世界系轴，左乘
  const qNew = qRot.multiply(q0);
  const e = new THREE.Euler().setFromQuaternion(qNew, 'XYZ');
  return {
    position: [newPos.x, newPos.y, newPos.z],
    rotation: [e.x, e.y, e.z],
  };
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
  const platGhostDataRef = useRef<{ position: [number, number, number]; rotation: [number, number, number] } | null>(null);
  const platGhostPartIdRef = useRef<string | null>(null);
  const extGhostDataRef = useRef<{ partId: string; position: [number, number, number]; rotation: [number, number, number]; group: THREE.Group }[]>([]);
  const [extCount, setExtCount] = useState(0);
  const selectionRectRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const dragState = useRef({ isDown: false, isDragging: false, startX: 0, startY: 0, dragPartId: null as string | null, axisDir: null as THREE.Vector3 | null, planeNormal: null as THREE.Vector3 | null, planePos: null as THREE.Vector3 | null, isArc: false, startQuat: null as THREE.Quaternion | null, startAngle: 0, initialPos: null as [number, number, number] | null, initialT: 0, snapped: false, isSelecting: false, selOrigin: null as { x: number; y: number } | null, selCur: null as { x: number; y: number } | null, historyPushed: false, altCopy: false, groupSnap: null as { id: string; position: [number, number, number]; rotation: [number, number, number] }[] | null, groupAnchor: null as { x: number; y: number; z: number } | null, groupAxis: null as THREE.Vector3 | null, ghostActive: false, ghostSrcId: null as string | null, anchorCopyId: null as string | null, rigidSnap: null as { driverId: string; driverStart: [number, number, number]; members: { id: string; start: [number, number, number] }[] } | null });
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
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const groupTagElRef = useRef<HTMLDivElement | null>(null);

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

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 5000);
    camera.position.set(150, 120, 150);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
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
    sceneRef.current = { scene, camera, renderer, controls, ground, gridHelper, partsGroup, gizmo,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
    };

    // 动画循环
    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
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
    animate();

    // 窗口resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // —— 顶部菜单触发的视角操作事件：重置 / 平移 / 旋转 ——
    const onCameraReset = () => {
      const bounds = new THREE.Box3().setFromObject(partsGroup);
      if (bounds.isEmpty()) {
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
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  // 渲染部件
  useEffect(() => {
    const ref = sceneRef.current;
    if (!ref) return;
    const partsGroup = ref.partsGroup;
    // 清理旧的
    while (partsGroup.children.length > 0) {
      const child = partsGroup.children[0];
      disposeGroup(child);
      partsGroup.remove(child);
    }
    // 重新渲染
    const parts = useStore.getState().parts;
    const selectedIds = useStore.getState().selectedIds;
    const hoveredId = useStore.getState().hoveredPartId;
    const ghostCopyId = useStore.getState().ghostCopyId;
    parts.forEach((part: PlacedPart) => {
      const def = getPartById(part.partId);
      if (!def) return;
      const colorList = def.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS;
      const color = colorList.find((c: { id: string }) => c.id === (part.colorId || def.defaultColor))?.hex || '#CCCCCC';
      // 多选高亮描边：选中=天空蓝，悬停=浅蓝
      const isSel = selectedIds.includes(part.id);
      const isHover = part.id === hoveredId;
      const outlineColor = isSel ? '#4A90D9' : isHover ? '#8FBDE8' : undefined;
      // Alt 复制中且与原物重合 → 红色半透明幽灵
      const isGhost = part.id === ghostCopyId;
      const group = createPartMesh(part, def, isGhost ? '#EE5A5A' : color, isGhost ? 0.45 : 1, outlineColor);
      // 选中用更亮描边线宽增强
      group.userData.partId = part.id;
      partsGroup.add(group);
    });
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
        const colorList = pdef.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS;
        const color = colorList.find((c: { id: string }) => c.id === pi.colorId)?.hex || '#CCCCCC';
        const mesh = createPartMesh(pi, pdef, color, 0.4);
        mesh.userData.isGhost = true;
        outer.add(mesh);
      }
      outer.position.set(ghostPos[0], ghostPos[1], ghostPos[2]);
      outer.userData.isGhostGroup = true;
      ref.scene.add(outer);
      ghostGroupRef.current = outer;
      return;
    }

    if (!draggingPart || !ref) return;
    const def = getPartById(draggingPart.partId);
    if (!def) return;

    const colorList = def.category === 'connector' ? CONNECTOR_COLORS : PART_COLORS;
    const color = colorList.find((c: { id: string }) => c.id === draggingPart.colorId)?.hex || '#CCCCCC';
    const ghostPart: PlacedPart = {
      id: 'ghost-preview',
      partId: def.id,
      position: [ghostPos[0], ghostPos[1], ghostPos[2]],
      rotation: [0, 0, 0],
      colorId: draggingPart.colorId,
    };
    const ghost = createPartMesh(ghostPart, def, color, 0.4);
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
    platGhostPartIdRef.current = null;
  }, []);
  const updatePlatformGhost = useCallback((cursor: THREE.Vector3) => {
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
    const fit = findPanelFit(cursor, st.parts);
    if (!fit) {
      clearPlatformGhost();
      return;
    }
    const platDef = getPartById(fit.partId);
    if (!platDef || platDef.category !== 'platform' || !platDef.platformSpec) {
      clearPlatformGhost();
      return;
    }
    const colorList = PART_COLORS;
    const color = colorList.find((c) => c.id === 'mint')?.hex || '#4CAF50';
    // 若幽灵形状（型号+位置+rotation）未变则跳过重建（抖动优化）
    const d = platGhostDataRef.current;
    if (platGhostGroupRef.current && d && platGhostPartIdRef.current === fit.partId) {
      const same =
        Math.abs(d.position[0] - fit.position[0]) < 0.01 &&
        Math.abs(d.position[1] - fit.position[1]) < 0.01 &&
        Math.abs(d.position[2] - fit.position[2]) < 0.01 &&
        Math.abs(d.rotation[0] - fit.rotation[0]) < 0.01 &&
        Math.abs(d.rotation[1] - fit.rotation[1]) < 0.01 &&
        Math.abs(d.rotation[2] - fit.rotation[2]) < 0.01;
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
    platGhostDataRef.current = { position: fit.position, rotation: fit.rotation };
    platGhostPartIdRef.current = fit.partId;
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
          const added = st.addPart(platGhostPartIdRef.current || 'platform-39.5x39.5', md.position, md.rotation, undefined, false, true);
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
        const gridSize = state.snapEnabled ? SNAP_DIST : 1;
        // 预置模块部署：整组作为一个 solid 实体放置（含成组）
        if (state.pendingPreset) {
          const dropPos: [number, number, number] = [
            Math.round(p.x / gridSize) * gridSize,
            0,
            Math.round(p.z / gridSize) * gridSize,
          ];
          const preset = state.pendingPreset;
          state.addPresetGroup(preset, dropPos);
          // 45°L嵌套组合：部署后立即做「结构化刚体吸附」——仅绕世界Y旋转+整体平移，
          // 保持立杆竖直、斜杆45°仰角，并把闲置 male 端与周边杆件 female 端贴合（与右键替换逻辑统一）。
          if (preset.id === COMBO_45L.id) {
            const s3 = useStore.getState();
            const comboIds = s3.selectedIds;
            if (comboIds.length === 2) {
              const comboParts = s3.parts.filter((p) => comboIds.includes(p.id));
              const fixed = snapComboRigid(comboParts);
              if (fixed) {
                const updates = fixed.map((p) => ({ id: p.id, position: p.position, rotation: p.rotation }));
                s3.batchUpdate(updates);
              }
            }
          }
          window.__debugLog?.(`✅ 已部署模块「${preset.name}」 @ (${dropPos[0]}, ${dropPos[2]})`);
          return;
        }
        if (state.draggingPart) {
          const def = getPartById(state.draggingPart.partId);
          // 增加框架(frame)阶段只允许放置/生长杆件与连接件，禁止平台板、扩展板件等
          if (state.workflow === 'frame' && def && (def.category !== 'bar' && def.category !== 'connector')) {
            window.__debugLog?.(`🚫 增加框架阶段仅允许杆件和连接件`);
            state.setDraggingPart(null);
            return;
          }
          const yOff = def ? def.size.height / 2 : 0;
          let pos: [number, number, number] = [
            Math.round(p.x / gridSize) * gridSize,
            yOff,
            Math.round(p.z / gridSize) * gridSize,
          ];
          let rot: [number, number, number] | undefined = undefined;
          let snapHit = false;

          // 放置时自动吸附（杆件/连接件）
          if (def && (def.category === 'bar' || def.category === 'connector')) {
            const tempPart: PlacedPart = {
              id: 'ghost',
              partId: def.id,
              position: pos,
              rotation: [0, 0, 0],
              colorId: state.draggingPart.colorId,
            };
            const selfCPs = getSelfWorldConnPoints(tempPart, def);
            const others = getWorldConnPoints(state.parts);
            const snap = findBestSnap(selfCPs, others);
            if (snap) {
              const snapped = computeSnappedTransform(tempPart, def, snap.selfCp, snap.otherCp);
              pos = snapped.position;
              rot = snapped.rotation;
              snapHit = true;
              window.__debugLog?.(`🧲 放置吸附: ${snap.selfCp.cpId} → ${snap.otherCp.cpId}`);
            }
          } else if (def && def.category === 'platform') {
            // 平台板放置吸附
            const tempPart: PlacedPart = {
              id: 'ghost',
              partId: def.id,
              position: pos,
              rotation: [0, 0, 0],
              colorId: state.draggingPart.colorId,
            };
            const snap = findPlatformSnap(tempPart, def, state.parts);
            if (snap) {
              pos = snap.position;
              rot = snap.rotation;
              snapHit = true;
            }
          }

          state.addPart(state.draggingPart.partId, pos, rot, state.draggingPart.colorId, false, snapHit);
          window.__debugLog?.(`✅ 已放置元件: ${state.draggingPart.partId} @ (${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`);
          state.setDraggingPart(null);
          return;
        }
      } else if (state.draggingPart) {
        window.__debugLog?.('⚠️ 点击未命中地面，无法放置元件');
      }

      // 空白处按下：开始框选（记录起点；拖拽后松开时判定，单点则为取消选中）
      ds.isSelecting = true;
      ds.selOrigin = { x: e.clientX, y: e.clientY };
      ds.selCur = { x: e.clientX, y: e.clientY };
      controls.enabled = false;
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

      // 生长模式：光标附近存在可落平台的矩形框架时，更新平台板幽灵（仅“增加配件”阶段）
      if (state.gizmoMode === 'growth' && !dragState.current.isDown && state.workflow === 'accessory') {
        const am: THREE.Mesh[] = [];
        ref.partsGroup.children.forEach((g) => g.children.forEach((c: THREE.Object3D) => { if (c instanceof THREE.Mesh) am.push(c); }));
        const mh = raycaster.intersectObjects(am);
        if (mh.length) {
          updatePlatformGhost(mh[0].point);
        } else {
          const gInt = raycaster.intersectObject(ground);
          if (gInt.length) updatePlatformGhost(gInt[0].point);
          else clearPlatformGhost();
        }
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
        ds.selCur = { x: e.clientX, y: e.clientY };
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
                const g = st.snapEnabled ? SNAP_DIST : 1;
                // 自由拖拽（非操作轴/平面）时保持组的高度不变，只沿地面移动，避免抓起顶部驱动件导致整体骤升骤降
                const keepY = !ds.axisDir && !ds.planeNormal;
                const raw: [number, number, number] = [
                  newPos[0] - rs.driverStart[0],
                  newPos[1] - rs.driverStart[1],
                  newPos[2] - rs.driverStart[2],
                ];
                // 组整体网格吸附（对位移取整），所有成员共享同一位移 → 完美刚体
                const dd: [number, number, number] = [
                  Math.round(raw[0] / g) * g,
                  keepY ? 0 : raw[1],
                  Math.round(raw[2] / g) * g,
                ];
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
                const grpBox = getSelAABB(applied);
                let lift = 0;
                if (grpBox && grpBox.min.y < 0) lift = -grpBox.min.y;
                const finalUpdates = updates.map((u) => ({
                  id: u.id,
                  position: [u.position[0], u.position[1] + lift, u.position[2]] as [number, number, number],
                }));
                st.batchUpdate(finalUpdates);
                ds.snapped = false;
                window.__debugLog?.(`👥 成组移动(刚体): ${memberIds.length} 个成员`);
              } else {
                const def = getPartById(part.partId);
                // Alt 复制幽灵：自由移动（无碰撞），跟随鼠标；重合时红色半透明高亮
                if (ds.ghostActive) {
                  state.updatePartPosition(ds.dragPartId, newPos, true);
                  ds.snapped = false;
                  updateGhostHighlight(useStore.getState(), ds);
                } else if (def && (def.category === 'bar' || def.category === 'connector')) {
                  // 临时构造一个"待吸附"的 PlacedPart
                  const tempPart: PlacedPart = { ...part, position: newPos };
                  const selfCPs = getSelfWorldConnPoints(tempPart, def);
                  const others = getWorldConnPoints(state.parts, part.id);
                  const snap = findBestSnap(selfCPs, others);
                  if (snap) {
                    const snapped = computeSnappedTransform(tempPart, def, snap.selfCp, snap.otherCp);
                    state.updatePartPosition(ds.dragPartId, snapped.position, true);
                    state.updatePartRotation(ds.dragPartId, snapped.rotation);
                    ds.snapped = true;
                    window.__debugLog?.(`🧲 自动吸附: ${snap.selfCp.cpId} → ${snap.otherCp.cpId} d=${snap.dist.toFixed(1)}`);
                  } else {
                    state.updatePartPosition(ds.dragPartId, newPos, false);
                    ds.snapped = false;
                  }
                } else if (def && def.category === 'platform') {
                  // 平台板实时吸附（矩形框架）
                  const tempPart: PlacedPart = { ...part, position: newPos };
                  const snap = findPlatformSnap(tempPart, def, state.parts);
                  if (snap) {
                    state.updatePartPosition(ds.dragPartId, snap.position, true);
                    state.updatePartRotation(ds.dragPartId, snap.rotation);
                    ds.snapped = true;
                    window.__debugLog?.(`🧲 平台板吸附框架`);
                  } else {
                    state.updatePartPosition(ds.dragPartId, newPos, false);
                    ds.snapped = false;
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

    const onPointerUp = () => {
      // 视角导航模式：结束时恢复悬停光标，场景逻辑不参与（未进入场景拖拽）
      const vm = useStore.getState().navMode;
      if (vm !== 'none') {
        el.style.cursor = vm === 'pan' ? 'grab' : ROTATE_CURSOR;
      }
      const state = useStore.getState();

      // 结束框选
      if (ds.isSelecting && ds.selOrigin) {
        const x1 = ds.selOrigin.x, y1 = ds.selOrigin.y, x2 = ds.selCur?.x ?? x1, y2 = ds.selCur?.y ?? y1;
        updateSelectionRect(x1, y1, x2, y2);
        const el = selectionRectRef.current;
        if (el) el.style.display = 'none';
        // 判断框选方向：左上→右下（正向）要求完全包含，反之要求部分相交
        const fwd = x2 >= x1 && y2 >= y1;
        const selIds: string[] = [];
        const curParts = state.parts;
        for (const p of curParts) {
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
        ds.selCur = null;
        controls.enabled = true;
        ds.isDown = false;
        return;
      }

      if (ds.isDragging && ds.dragPartId) {
        // 已吸附嵌套时保持精确连接位置，不再做网格吸附
        const part = state.parts.find((p: PlacedPart) => p.id === ds.dragPartId);
        if (part && state.snapEnabled && !ds.snapped) {
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
      ds.selCur = null;
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

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('contextmenu', onContextMenu);
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
        className="pointer-events-none fixed z-20 border-2 border-[#4A90D9] bg-[#4A90D9]/15"
        style={{ display: 'none', position: 'fixed' }}
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
              if (!d) return 0;
              return PARTS_LIBRARY.filter((x) => x.category === d.category && x.id !== d.id &&
                (x.id !== 'connector-45deg-nest')).length;
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
              const siblings = PARTS_LIBRARY.filter(
                  (x) => x.category === d.category && x.id !== d.id && x.id !== 'connector-45deg-nest'
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
                {menuPrimary.def.category === 'connector' && (
                  <button
                    onClick={() => {
                      const st = useStore.getState();
                      const cur = menuPrimary.part;
                      // 用 45°L嵌套组合（两件）原地替换当前选中连接件：以当前件位置为锚点，删旧件后部署组合
                      // 组合两件相对锚点 x∈[-(组合半宽), +(3.2-COMBO_NEST_K)]、y∈[0,3.2]：dropPos 需减去组合件内置 y 偏移(3.2)，
                      // 否则组合整体被抬高 3.2cm、悬空无法与杆件对接。
                      // 组合水平几何中心 x = (0 + (5-COMBO_NEST_K))/2 = 2.5 - COMBO_NEST_K/2，据此动态锚定。
                      const cmbY = COMBO_45L.parts[0].position[1];
                      const cmbCx =
                        (COMBO_45L.parts[0].position[0] + COMBO_45L.parts[1].position[0]) / 2;
                      st.removePart(cur.id);
                      st.addPresetGroup(
                        { id: COMBO_45L.id, name: COMBO_45L.name, parts: COMBO_45L.parts },
                        [cur.position[0] - cmbCx, cur.position[1] - cmbY, cur.position[2]]
                      );
                      // 组合整体刚体吸附（旋转+平移）：让 45度件或L形件的闲置端与相近杆件正确嵌套，
                      // 尽量让多个闲置端同时对接周边杆件，修正组合方向。
                      const s2 = useStore.getState();
                      const comboIds = s2.selectedIds;
                      if (comboIds.length === 2) {
                        const comboParts = s2.parts.filter((p) => comboIds.includes(p.id));
                        const fixed = snapComboRigid(comboParts);
                        if (fixed) {
                          const updates = fixed.map((p) => ({ id: p.id, position: p.position, rotation: p.rotation }));
                          s2.batchUpdate(updates);
                        }
                      }
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
                    {menuPrimary.siblings.map((sib) => (
                      <button
                        key={sib.id}
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
                    ))}
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
                    {!menuPrimary.isStorbox && (
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
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material?.dispose();
      }
    }
  });
}
