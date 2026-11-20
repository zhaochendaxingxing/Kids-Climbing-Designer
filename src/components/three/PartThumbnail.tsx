'use client';

import Image from 'next/image';

import { useEffect, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import * as THREE from 'three';
import { getPartById, getPartColor } from '@/data/parts';
import type { PartDefinition, PlacedPart, PresetUnit } from '@/types/parts';

type ThumbnailProps = { part: PartDefinition; color: string; preset?: never }
  | { preset: PresetUnit; part?: never; color?: never };

const imageCache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function releaseThumbnailRenderer() {
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
}

async function renderThumbnail(definition?: PartDefinition, color?: string, preset?: PresetUnit) {
  const key = definition ? `${definition.id}:${color}` : preset!.id;
  const cached = imageCache.get(key);
  if (cached) return cached;

  const { createPartMesh } = await import('./partMesh');
  clearTimeout(releaseTimer);
  if (renderer?.getContext().isContextLost()) releaseThumbnailRenderer();
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(288, 184);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
  }
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  const parts: PlacedPart[] = preset?.parts ?? [{
    id: 'thumbnail',
    partId: definition!.id,
    colorId: definition!.defaultColor,
    position: [0, 0, 0],
    rotation: definition?.extKind === 'maze' || definition?.extKind === 'rainbow' ? [Math.PI / 2, 0, 0] : [0, 0, 0],
  }];
  for (const instance of parts) {
    const def = definition ?? getPartById(instance.partId);
    if (def) model.add(createPartMesh(instance, def, color ?? getPartColor(def, instance.colorId)?.hex ?? '#888888'));
  }
  scene.add(model);
  scene.add(new THREE.HemisphereLight('#ffffff', '#9eabb9', 2.2));
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.5);
  keyLight.position.set(-30, 60, 50);
  scene.add(keyLight);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const view = definition?.extKind === 'wheelbar'
    ? new THREE.Vector3(24, 80, 46)
    : definition?.barSpec ? new THREE.Vector3(38, 58, 72)
      : preset ? new THREE.Vector3(100, 73, 116) : new THREE.Vector3(60, 44, 70);
  camera.position.copy(center).add(view);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  let projectedWidth = 0;
  let projectedHeight = 0;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        projectedWidth = Math.max(projectedWidth, Math.abs(point.x));
        projectedHeight = Math.max(projectedHeight, Math.abs(point.y));
      }
    }
  }
  const aspect = 288 / 184;
  const span = Math.max(projectedHeight, projectedWidth / aspect, 1) * 1.19;
  camera.left = -span * aspect;
  camera.right = span * aspect;
  camera.top = span;
  camera.bottom = -span;
  camera.updateProjectionMatrix();

  try {
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) throw new Error('Thumbnail renderer lost its WebGL context');
    const image = renderer.domElement.toDataURL('image/png');
    imageCache.set(key, image);
    if (imageCache.size > 160)
      imageCache.delete(imageCache.keys().next().value!);
    return image;
  } finally {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    model.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.LineSegments
      ) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material)
          ? object.material
          : [object.material];
        list.forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach(material => {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    });
    releaseTimer = setTimeout(releaseThumbnailRenderer, 1500);
  }
}

export default function PartThumbnail({
  part,
  color,
  preset,
}: ThumbnailProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState<string>();

  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    renderThumbnail(part, color, preset)
      .then((source) => {
        if (current) setImage(source);
      })
      .catch(() => {
        if (current) setImage(undefined);
      });
    return () => {
      current = false;
    };
  }, [part, color, preset, visible]);

  return (
    <div ref={host} className="designer-part-image">
      {image ? (
        <Image unoptimized src={image} width={144} height={92} alt="" />
      ) : (
        <Box size={27} aria-hidden="true" />
      )}
    </div>
  );
}
