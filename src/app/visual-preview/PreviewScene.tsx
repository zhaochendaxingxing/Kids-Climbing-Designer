'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PARTS_LIBRARY } from '@/data/parts';
import type { PartDefinition } from '@/types/parts';

export interface PreviewSettings {
  layers: number;
  columns: number;
  depth: number;
  color: string;
  grid: boolean;
  pan: boolean;
}

export interface ViewCommand {
  action: 'home' | 'in' | 'out';
  sequence: number;
}

const JOINT = '#343b3a';
const BOARD = '#f5eee1';

function material(color: string) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    metalness: 0.08,
  });
}

function addTube(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  mat: THREE.Material,
  radius = 1.9,
) {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 20),
    mat,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function disposeGroup(group: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const list = Array.isArray(object.material)
        ? object.material
        : [object.material];
      list.forEach((item) => materials.add(item));
    }
  });
  materials.forEach((item) => item.dispose());
}

function buildFrame(settings: PreviewSettings) {
  const group = new THREE.Group();
  const tube = material(settings.color);
  const joint = material(JOINT);
  const board = material(BOARD);
  const { columns, depth, layers } = settings;
  const point = (x: number, y: number, z: number) =>
    new THREE.Vector3((x - columns / 2) * 40, 4 + y * 40, (z - depth / 2) * 40);

  for (let y = 0; y <= layers; y++) {
    for (let x = 0; x <= columns; x++) {
      for (let z = 0; z <= depth; z++) {
        const position = point(x, y, z);
        const connector = new THREE.Mesh(
          new THREE.SphereGeometry(2.7, 16, 12),
          joint,
        );
        connector.position.copy(position);
        connector.castShadow = true;
        group.add(connector);
        if (x < columns) addTube(group, position, point(x + 1, y, z), tube);
        if (z < depth) addTube(group, position, point(x, y, z + 1), tube);
        if (y < layers) addTube(group, position, point(x, y + 1, z), tube);
      }
    }
  }

  for (let x = 0; x < columns; x++) {
    for (let z = 0; z < depth; z++) {
      if ((x + z) % 2 === 0) {
        const platform = new THREE.Mesh(
          new THREE.BoxGeometry(37, 1.6, 37),
          board,
        );
        platform.position
          .copy(point(x, layers - 1, z))
          .add(new THREE.Vector3(20, 2.5, 20));
        platform.castShadow = true;
        platform.receiveShadow = true;
        group.add(platform);
      }
    }
  }

  const roofHeight = columns * 20;
  for (const z of [0, depth]) {
    const peak = point(columns / 2, layers, z).add(
      new THREE.Vector3(0, roofHeight, 0),
    );
    addTube(group, point(0, layers, z), peak, tube);
    addTube(group, point(columns, layers, z), peak, tube);
    const connector = new THREE.Mesh(
      new THREE.SphereGeometry(2.7, 16, 12),
      joint,
    );
    connector.position.copy(peak);
    group.add(connector);
  }
  addTube(
    group,
    point(columns / 2, layers, 0).add(new THREE.Vector3(0, roofHeight, 0)),
    point(columns / 2, layers, depth).add(new THREE.Vector3(0, roofHeight, 0)),
    tube,
  );
  return group;
}

export default function PreviewScene({
  settings,
  command,
  onReady,
}: {
  settings: PreviewSettings;
  command: ViewCommand;
  onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    render: () => void;
    reset: () => void;
    grid: THREE.GridHelper;
    model: THREE.Group | null;
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.setAttribute(
      'aria-label',
      '攀爬架示例模型，可拖动旋转或使用视角按钮',
    );
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 1500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 100;
    controls.maxDistance = 1100;
    controls.maxPolarAngle = Math.PI / 2.06;
    const render = () => renderer.render(scene, camera);
    const reset = () => {
      const model = runtime.current?.model;
      const bounds = model
        ? new THREE.Box3()
            .setFromObject(model)
            .getBoundingSphere(new THREE.Sphere())
        : new THREE.Sphere(new THREE.Vector3(0, 62, 0), 90);
      const verticalAngle = THREE.MathUtils.degToRad(camera.fov);
      const horizontalAngle =
        2 * Math.atan(Math.tan(verticalAngle / 2) * camera.aspect);
      const distance =
        (bounds.radius /
          Math.sin(Math.min(verticalAngle, horizontalAngle) / 2)) *
        1.08;
      controls.target.copy(bounds.center);
      camera.position
        .copy(bounds.center)
        .add(
          new THREE.Vector3(210, 118, 250).normalize().multiplyScalar(distance),
        );
      controls.update();
      render();
    };
    scene.add(new THREE.HemisphereLight('#ffffff', '#bdc6cd', 2.2));
    const light = new THREE.DirectionalLight('#fff8ed', 3);
    light.position.set(-80, 240, 100);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.left = -160;
    light.shadow.camera.right = 160;
    light.shadow.camera.top = 180;
    light.shadow.camera.bottom = -160;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.8;
    light.shadow.radius = 4;
    scene.add(light);
    const fill = new THREE.DirectionalLight('#d4e8ff', 1);
    fill.position.set(120, 70, -140);
    scene.add(fill);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(400, 40, '#cbd5df', '#dce3e8');
    grid.position.y = -0.05;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.48;
    scene.add(grid);
    runtime.current = {
      scene,
      camera,
      controls,
      render,
      reset,
      grid,
      model: null,
    };
    controls.addEventListener('change', render);
    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      reset();
    });
    observer.observe(container);
    reset();
    onReady(true);
    return () => {
      observer.disconnect();
      controls.dispose();
      if (runtime.current?.model) disposeGroup(runtime.current.model);
      ground.geometry.dispose();
      ground.material.dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, [onReady]);

  useEffect(() => {
    const view = runtime.current;
    if (!view) return;
    const previousSize = view.model?.userData.dimensions;
    const dimensions = `${settings.columns}-${settings.layers}-${settings.depth}`;
    if (view.model) {
      view.scene.remove(view.model);
      disposeGroup(view.model);
    }
    view.model = buildFrame(settings);
    view.model.userData.dimensions = dimensions;
    view.scene.add(view.model);
    view.grid.visible = settings.grid;
    view.controls.mouseButtons.LEFT = settings.pan
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;
    if (previousSize !== dimensions) view.reset();
    view.render();
  }, [settings]);

  useEffect(() => {
    const view = runtime.current;
    if (!view) return;
    if (command.action === 'home') view.reset();
    else {
      const offset = view.camera.position.clone().sub(view.controls.target);
      const distance = THREE.MathUtils.clamp(
        offset.length() * (command.action === 'in' ? 0.84 : 1.19),
        100,
        1100,
      );
      view.camera.position
        .copy(view.controls.target)
        .add(offset.setLength(distance));
      view.controls.update();
      view.render();
    }
  }, [command]);

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }}>
      {error && (
        <p role="alert" style={{ padding: 24 }}>
          3D 预览需要 WebGL，请在支持硬件加速的浏览器中打开。
        </p>
      )}
    </div>
  );
}

function partModel(part: PartDefinition, color: string) {
  const group = new THREE.Group();
  const mat = material(part.category === 'connector' ? JOINT : color);
  if (part.barSpec) {
    const { length, outerDiameter, innerDiameter } = part.barSpec;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerDiameter / 2, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerDiameter / 2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, {
        depth: length,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      mat,
    );
    mesh.position.z = -length / 2;
    group.add(mesh);
    group.rotation.set(0.3, -0.9, 0.45);
  } else if (part.connectorSpec) {
    group.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(part.connectorSpec.centerDiameter / 2, 20, 16),
        mat,
      ),
    );
    for (const connection of part.connectionPoints ?? []) {
      const direction = new THREE.Vector3(...connection.direction);
      addTube(
        group,
        direction.clone().multiplyScalar(1.5),
        direction.clone().multiplyScalar(6.5),
        mat,
        2,
      );
    }
    group.rotation.y = 0.3;
  } else {
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(part.size.width, 1.8, part.size.depth),
        mat,
      ),
    );
  }
  return group;
}

export function usePartThumbnails(parts: PartDefinition[], color: string) {
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      return;
    }
    renderer.setSize(288, 176);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const result: Record<string, string> = {};
    for (const part of parts) {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#9eabb9', 3));
      const light = new THREE.DirectionalLight('#ffffff', 3);
      light.position.set(-30, 60, 50);
      scene.add(light);
      const model = partModel(part, color);
      scene.add(model);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z) * 0.72;
      const camera = new THREE.OrthographicCamera(
        -span * 1.64,
        span * 1.64,
        span,
        -span,
        0.1,
        500,
      );
      camera.position.set(60, 45, 80);
      camera.lookAt(box.getCenter(new THREE.Vector3()));
      renderer.render(scene, camera);
      result[part.id] = renderer.domElement.toDataURL('image/png');
      disposeGroup(model);
    }
    renderer.dispose();
    setImages(result);
  }, [parts, color]);
  return images;
}

export const PREVIEW_PARTS = [
  'bar-35',
  'bar-15',
  'connector-v6',
  'connector-l',
  'platform-39.5x39.5',
  'platform-39.5x19.5',
]
  .map((id) => PARTS_LIBRARY.find((part) => part.id === id))
  .filter((part): part is PartDefinition => Boolean(part));
