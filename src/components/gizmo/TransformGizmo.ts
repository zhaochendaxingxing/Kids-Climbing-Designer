import * as THREE from 'three';

export type GizmoAxis = 'x' | 'y' | 'z';
export type GizmoMode = 'translate' | 'rotate';
export type GizmoHandleType = 'axis' | 'plane' | 'arc';

export interface GizmoHitInfo {
  type: GizmoHandleType;
  axis?: GizmoAxis;
  plane?: 'xy' | 'yz' | 'xz';
  point: THREE.Vector3;
}

export interface TransformGizmoOptions {
  size?: number;
  snapStep?: number;
  rotationStep?: number; // 度数
}

const AXIS_COLORS: Record<GizmoAxis, number> = {
  x: 0xff4444,
  y: 0x44dd44,
  z: 0x4488ff,
};

const HOVER_COLOR = 0xffdd00;

interface HandleInfo {
  type: GizmoHandleType;
  axis?: GizmoAxis;
  plane?: 'xy' | 'yz' | 'xz';
}

interface DragState {
  info: HandleInfo;
  startGizmoPos: THREE.Vector3;
  startGizmoQuat: THREE.Quaternion;
  startHitPoint: THREE.Vector3; // 初始命中点（世界空间）
  dragAxis: THREE.Vector3;     // 世界空间方向
  dragPlane: THREE.Plane;      // 拖拽平面（世界空间）
  startAxisParam: number;      // 轴移动用：初始命中点在轴上的参数
}

export class TransformGizmo {
  public group: THREE.Group;
  public size: number;
  public snapStep: number;
  public rotationStep: number;

  private translateGroup: THREE.Group;
  private rotateGroup: THREE.Group;
  private handleMap: Map<THREE.Object3D, HandleInfo>;
  private handleMaterials: Map<THREE.Object3D, THREE.MeshBasicMaterial | THREE.LineBasicMaterial>;
  private originalColors: Map<THREE.Object3D, number>;

  private dragState: DragState | null = null;

  constructor(options: TransformGizmoOptions = {}) {
    this.size = options.size ?? 30;
    this.snapStep = options.snapStep ?? 5;
    this.rotationStep = options.rotationStep ?? 15;

    this.group = new THREE.Group();
    this.translateGroup = new THREE.Group();
    this.rotateGroup = new THREE.Group();
    this.handleMap = new Map();
    this.handleMaterials = new Map();
    this.originalColors = new Map();

    this.group.add(this.translateGroup);
    this.group.add(this.rotateGroup);

    this.buildTranslateHandles();
    this.buildRotateHandles();
  }

  // ========= 构建手柄 =========

  private buildTranslateHandles() {
    const s = this.size;
    this.createAxisHandle('x', new THREE.Vector3(1, 0, 0), s);
    this.createAxisHandle('y', new THREE.Vector3(0, 1, 0), s);
    this.createAxisHandle('z', new THREE.Vector3(0, 0, 1), s);

    const ps = s * 0.35;
    this.createPlaneHandle('xy', ps, new THREE.Vector3(ps * 0.6, ps * 0.6, 0));
    this.createPlaneHandle('yz', ps, new THREE.Vector3(0, ps * 0.6, ps * 0.6));
    this.createPlaneHandle('xz', ps, new THREE.Vector3(ps * 0.6, 0, ps * 0.6));
  }

  private createAxisHandle(axis: GizmoAxis, direction: THREE.Vector3, length: number) {
    const group = new THREE.Group();
    const color = AXIS_COLORS[axis];

    const shaftRadius = length * 0.05;
    const pickRadius = length * 0.15;
    const headLength = length * 0.22;
    const headWidth = length * 0.14;

    // 拾取圆柱（最粗，半透明可见）
    const pickGeo = new THREE.CylinderGeometry(pickRadius, pickRadius, length, 12);
    const pickMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthTest: false,
    });
    const pickMesh = new THREE.Mesh(pickGeo, pickMat);
    pickMesh.position.y = length / 2;
    pickMesh.renderOrder = 990;
    group.add(pickMesh);

    // 可见杆身
    const shaftGeo = new THREE.CylinderGeometry(shaftRadius, shaftRadius, length * 0.72, 12);
    const shaftMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = length * 0.36;
    shaft.renderOrder = 1000;
    group.add(shaft);

    // 箭头头部
    const headGeo = new THREE.ConeGeometry(headWidth, headLength, 16);
    const headMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = length * 0.72 + headLength / 2;
    head.renderOrder = 1000;
    group.add(head);

    // 让 group 朝向 direction（默认沿 +Y）
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
    group.quaternion.copy(quat);

    const info: HandleInfo = { type: 'axis', axis };
    this.handleMap.set(pickMesh, info);
    this.handleMap.set(shaft, info);
    this.handleMap.set(head, info);

    this.handleMaterials.set(pickMesh, pickMat);
    this.handleMaterials.set(shaft, shaftMat);
    this.handleMaterials.set(head, headMat);

    this.originalColors.set(pickMesh, color);
    this.originalColors.set(shaft, color);
    this.originalColors.set(head, color);

    this.translateGroup.add(group);
  }

  private createPlaneHandle(plane: 'xy' | 'yz' | 'xz', size: number, position: THREE.Vector3) {
    const normalAxis = plane === 'xy' ? 'z' : plane === 'yz' ? 'x' : 'y';
    const color = AXIS_COLORS[normalAxis];

    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.renderOrder = 980;

    if (plane === 'yz') {
      mesh.rotation.y = Math.PI / 2;
    } else if (plane === 'xz') {
      mesh.rotation.x = -Math.PI / 2;
    }

    const info: HandleInfo = { type: 'plane', plane };
    this.handleMap.set(mesh, info);
    this.handleMaterials.set(mesh, mat);
    this.originalColors.set(mesh, color);

    this.translateGroup.add(mesh);
  }

  private buildRotateHandles() {
    const r = this.size * 1.2;
    this.createArcHandle('x', r);
    this.createArcHandle('y', r);
    this.createArcHandle('z', r);
  }

  private createArcHandle(axis: GizmoAxis, radius: number) {
    const color = AXIS_COLORS[axis];

    // 可见的粗弧线
    const torusGeo = new THREE.TorusGeometry(radius, radius * 0.03, 8, 64, Math.PI * 1.5);
    const torusMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.renderOrder = 995;

    // 拾取 torus（更粗，半透明）
    const pickGeo = new THREE.TorusGeometry(radius, radius * 0.1, 8, 64, Math.PI * 1.5);
    const pickMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.1,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const pickTorus = new THREE.Mesh(pickGeo, pickMat);
    pickTorus.renderOrder = 994;

    // 对齐（默认 torus 在 XY 平面，孔沿 Z）
    if (axis === 'x') {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      torus.quaternion.copy(q);
      pickTorus.quaternion.copy(q);
    } else if (axis === 'y') {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      torus.quaternion.copy(q);
      pickTorus.quaternion.copy(q);
    }

    const info: HandleInfo = { type: 'arc', axis };
    this.handleMap.set(torus, info);
    this.handleMap.set(pickTorus, info);
    this.handleMaterials.set(torus, torusMat);
    this.handleMaterials.set(pickTorus, pickMat);
    this.originalColors.set(torus, color);
    this.originalColors.set(pickTorus, color);

    this.rotateGroup.add(torus);
    this.rotateGroup.add(pickTorus);
  }

  // ========= 公共 API =========

  setPosition(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
  }

  setRotation(x: number, y: number, z: number) {
    this.group.rotation.set(x, y, z);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  setMode(mode: 'translate' | 'rotate' | 'both') {
    this.translateGroup.visible = mode === 'translate' || mode === 'both';
    this.rotateGroup.visible = mode === 'rotate' || mode === 'both';
  }

  setSize(size: number) {
    this.size = size;
    this.clearHandles();
    this.buildTranslateHandles();
    this.buildRotateHandles();
  }

  setSnapStep(step: number) {
    this.snapStep = step;
  }

  setRotationStep(deg: number) {
    this.rotationStep = deg;
  }

  private clearHandles() {
    const dispose = (obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    };
    this.translateGroup.traverse(dispose);
    this.rotateGroup.traverse(dispose);
    while (this.translateGroup.children.length > 0) this.translateGroup.remove(this.translateGroup.children[0]);
    while (this.rotateGroup.children.length > 0) this.rotateGroup.remove(this.rotateGroup.children[0]);
    this.handleMap.clear();
    this.handleMaterials.clear();
    this.originalColors.clear();
  }

  dispose() {
    this.clearHandles();
  }

  // ========= 交互 =========

  get handleCount(): number {
    return this.handleMap.size;
  }

  intersect(raycaster: THREE.Raycaster): GizmoHitInfo | null {
    if (!this.group.visible) return null;

    const objects: THREE.Object3D[] = [];
    this.handleMap.forEach((_info, obj) => objects.push(obj));

    // 调试：确保 worldMatrix 是最新的
    this.group.updateMatrixWorld(true);

    const hits = raycaster.intersectObjects(objects, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const info = this.handleMap.get(hit.object);
    if (!info) return null;

    return {
      type: info.type,
      axis: info.axis,
      plane: info.plane,
      point: hit.point.clone(),
    };
  }

  setHover(handleKey: HandleInfo | null) {
    this.handleMap.forEach((info, obj) => {
      const mat = this.handleMaterials.get(obj);
      const origColor = this.originalColors.get(obj);
      if (!mat || origColor === undefined) return;

      const isMatch =
        handleKey !== null &&
        info.type === handleKey.type &&
        info.axis === handleKey.axis &&
        info.plane === handleKey.plane;

      const targetColor = isMatch ? HOVER_COLOR : origColor;
      mat.color.setHex(targetColor);
    });
  }

  /**
   * 开始拖拽
   * @param hit 命中信息
   * @param camera 相机（用于构造轴拖拽平面）
   */
  startDrag(hit: GizmoHitInfo, camera: THREE.Camera) {
    const startGizmoPos = this.group.position.clone();
    const startGizmoQuat = this.group.quaternion.clone();
    const startHitPoint = hit.point.clone();
    const info: HandleInfo = { type: hit.type, axis: hit.axis, plane: hit.plane };

    let dragAxis = new THREE.Vector3();
    const dragPlane = new THREE.Plane();
    let startAxisParam = 0;

    if (hit.type === 'axis' && hit.axis) {
      // === 轴移动 ===
      dragAxis = this.getWorldAxis(hit.axis);

      // 初始命中点在轴上的参数（距 gizmo 中心，沿轴方向）
      const toHit = new THREE.Vector3().subVectors(startHitPoint, startGizmoPos);
      startAxisParam = toHit.dot(dragAxis);

      // 构造拖拽平面：包含轴，且面向相机
      const viewDir = new THREE.Vector3();
      camera.getWorldDirection(viewDir);
      viewDir.normalize();

      // 处理视线几乎与轴平行的情况
      if (Math.abs(viewDir.dot(dragAxis)) > 0.97) {
        viewDir.set(0, 1, 0);
        if (Math.abs(viewDir.dot(dragAxis)) > 0.97) {
          viewDir.set(0, 0, -1);
        }
      }

      // 平面法线 = 轴 × (视线 × 轴) = 视线在垂直于轴平面上的投影
      const temp = new THREE.Vector3().crossVectors(viewDir, dragAxis).normalize();
      const normal = new THREE.Vector3().crossVectors(dragAxis, temp).normalize();
      // 确保法线朝向相机（与视线方向相反）
      if (normal.dot(viewDir) > 0) normal.negate();

      dragPlane.setFromNormalAndCoplanarPoint(normal, startHitPoint);

    } else if (hit.type === 'plane' && hit.plane) {
      // === 平面移动 ===
      dragAxis = this.getPlaneNormalWorld(hit.plane);
      dragPlane.setFromNormalAndCoplanarPoint(dragAxis, startHitPoint);

    } else if (hit.type === 'arc' && hit.axis) {
      // === 旋转 ===
      dragAxis = this.getWorldAxis(hit.axis);
      // 旋转平面法线 = 旋转轴方向（从外看向旋转中心）
      const planeNormal = dragAxis.clone().negate();
      dragPlane.setFromNormalAndCoplanarPoint(planeNormal, startGizmoPos);

      // 将起始命中点投影到旋转平面上
      const projected = startHitPoint.clone();
      dragPlane.projectPoint(projected, projected);
      startHitPoint.copy(projected);
    } else {
      return;
    }

    this.dragState = {
      info,
      startGizmoPos,
      startGizmoQuat,
      startHitPoint,
      dragAxis,
      dragPlane,
      startAxisParam,
    };
  }

  private getWorldAxis(axis: GizmoAxis): THREE.Vector3 {
    const v = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    );
    v.applyQuaternion(this.group.quaternion);
    return v.normalize();
  }

  private getPlaneNormalWorld(plane: 'xy' | 'yz' | 'xz'): THREE.Vector3 {
    const normal = new THREE.Vector3(
      plane === 'yz' ? 1 : 0,
      plane === 'xz' ? 1 : 0,
      plane === 'xy' ? 1 : 0,
    );
    normal.applyQuaternion(this.group.quaternion);
    return normal.normalize();
  }

  /**
   * 拖拽更新
   */
  onDrag(raycaster: THREE.Raycaster): { position?: [number, number, number]; rotation?: [number, number, number] } {
    if (!this.dragState) return {};

    const result: { position?: [number, number, number]; rotation?: [number, number, number] } = {};
    const { info, startGizmoPos, startGizmoQuat, startHitPoint, dragAxis, dragPlane, startAxisParam } = this.dragState;

    // 计算射线与拖拽平面的交点
    const planeHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return result;

    if (info.type === 'axis') {
      // === 轴移动 ===
      // 轴线：newGizmoPos + t * dragAxis
      // 希望鼠标始终"抓住"轴上参数为 startAxisParam 的点
      // 即：newGizmoPos + startAxisParam * dragAxis = planeHit 在轴线上的最近点

      // 将 planeHit 投影到轴线上（以 startGizmoPos 为参考）
      const toHit = new THREE.Vector3().subVectors(planeHit, startGizmoPos);
      const hitParam = toHit.dot(dragAxis);

      // gizmo 位置变化 = 命中点参数变化
      const deltaParam = hitParam - startAxisParam;
      let newPos = startGizmoPos.clone().add(dragAxis.clone().multiplyScalar(deltaParam));

      if (this.snapStep > 0) {
        newPos = this.snapVec(newPos, this.snapStep);
      }

      result.position = [newPos.x, newPos.y, newPos.z];

    } else if (info.type === 'plane') {
      // === 平面移动 ===
      // 平面偏移 = 当前命中点 - 起始命中点
      const delta = new THREE.Vector3().subVectors(planeHit, startHitPoint);
      let newPos = startGizmoPos.clone().add(delta);

      if (this.snapStep > 0) {
        newPos = this.snapVec(newPos, this.snapStep);
      }

      result.position = [newPos.x, newPos.y, newPos.z];

    } else if (info.type === 'arc' && info.axis) {
      // === 旋转 ===
      const center = startGizmoPos;

      // 构造平面内的参考方向
      const refDir = new THREE.Vector3(1, 0, 0);
      if (Math.abs(refDir.dot(dragPlane.normal)) > 0.95) {
        refDir.set(0, 1, 0);
      }
      refDir.projectOnPlane(dragPlane.normal).normalize();

      const startVec = new THREE.Vector3().subVectors(startHitPoint, center);
      const currentVec = new THREE.Vector3().subVectors(planeHit, center);

      const startAngle = this.angleOnPlane(startVec, refDir, dragPlane.normal);
      const currentAngle = this.angleOnPlane(currentVec, refDir, dragPlane.normal);

      let deltaAngle = currentAngle - startAngle;

      if (this.rotationStep > 0) {
        const stepRad = (this.rotationStep * Math.PI) / 180;
        deltaAngle = Math.round(deltaAngle / stepRad) * stepRad;
      }

      // 绕 dragAxis 旋转 deltaAngle
      // 注意：dragAxis 是旋转轴方向，和 plane.normal 相反
      const rotAxis = dragAxis.clone();
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, deltaAngle);
      const newQuat = new THREE.Quaternion().multiplyQuaternions(rotQuat, startGizmoQuat);
      const newRot = new THREE.Euler().setFromQuaternion(newQuat);

      result.rotation = [newRot.x, newRot.y, newRot.z];
    }

    return result;
  }

  private angleOnPlane(vec: THREE.Vector3, refDir: THREE.Vector3, planeNormal: THREE.Vector3): number {
    const v = vec.clone().projectOnPlane(planeNormal).normalize();
    const r = refDir.clone().normalize();
    // angle = atan2(cross(ref, v).normal, ref·v)
    const cross = new THREE.Vector3().crossVectors(r, v);
    const sin = cross.dot(planeNormal);
    const cos = r.dot(v);
    return Math.atan2(sin, cos);
  }

  private snapVec(v: THREE.Vector3, step: number): THREE.Vector3 {
    return new THREE.Vector3(
      Math.round(v.x / step) * step,
      Math.round(v.y / step) * step,
      Math.round(v.z / step) * step,
    );
  }

  endDrag() {
    this.dragState = null;
  }
}
