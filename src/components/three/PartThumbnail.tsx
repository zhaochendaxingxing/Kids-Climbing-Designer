'use client';

import { useEffect, useRef, useState } from 'react';
import { Box } from 'lucide-react';
import * as THREE from 'three';
import type { PartDefinition, PlacedPart } from '@/types/parts';

const imageCache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

async function renderThumbnail(definition: PartDefinition, color: string) {
  const key = `${definition.id}:${color}`;
  const cached = imageCache.get(key);
  if (cached) return cached;

  const { createPartMesh } = await import('./Scene3D');
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
  clearTimeout(releaseTimer);
  const scene = new THREE.Scene();
  const instance: PlacedPart = {
    id: 'thumbnail',
    partId: definition.id,
    colorId: definition.defaultColor,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
  const model = createPartMesh(instance, definition, color);
  scene.add(model);
  scene.add(new THREE.HemisphereLight('#ffffff', '#9eabb9', 2.2));
  const keyLight = new THREE.DirectionalLight('#ffffff', 2.5);
  keyLight.position.set(-30, 60, 50);
  scene.add(keyLight);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const span = Math.max(radius * 1.12, 4);
  const camera = new THREE.OrthographicCamera(
    -span * 1.56,
    span * 1.56,
    span,
    -span,
    0.1,
    1000,
  );
  camera.position.copy(center).add(new THREE.Vector3(60, 44, 70));
  camera.lookAt(center);

  try {
    renderer.render(scene, camera);
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
    materials.forEach((material) => material.dispose());
    releaseTimer = setTimeout(() => {
      renderer?.dispose();
      renderer = null;
    }, 1500);
  }
}

export default function PartThumbnail({
  part,
  color,
}: {
  part: PartDefinition;
  color: string;
}) {
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
    renderThumbnail(part, color)
      .then((source) => {
        if (current) setImage(source);
      })
      .catch(() => {
        if (current) setImage(undefined);
      });
    return () => {
      current = false;
    };
  }, [part, color, visible]);

  return (
    <div ref={host} className="designer-part-image">
      {image ? (
        <img src={image} width={144} height={92} alt="" />
      ) : (
        <Box size={27} aria-hidden="true" />
      )}
    </div>
  );
}
