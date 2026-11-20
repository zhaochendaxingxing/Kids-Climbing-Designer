import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PlatformSpec } from '@/types/parts';

export function storageBasin(spec: PlatformSpec) {
  const [w, d] = [spec.plateWidth / 2, spec.plateDepth / 2];
  const top = spec.rimHeight;
  const wall = spec.rimThickness;
  const flange = Math.min(spec.flangeWidth ?? 0, 4.35);
  // Follow the continuous section from the underside, over the lip, to the inside floor.
  const profile = [
    [0.001, 0.001, 0, 0], [w - 4.4, d - 4.4, 3.6, 0],
    [w - 3.1, d - 3.1, 4.5, 0.16], [w - 2.25, d - 2.25, 4.8, 0.65],
    [w - 1.7, d - 1.7, 4.9, 1.55], [w, d, 5.4, top - 0.5],
    [w + 0.35, d + 0.35, 5.8, top], [w + flange - 0.12, d + flange - 0.12, 10.4, top],
    [w + flange, d + flange, 10.5, top + 0.14], [w + flange, d + flange, 10.5, top + 0.43],
    [w + flange - 0.18, d + flange - 0.18, 10.35, top + 0.55],
    [w + 0.35, d + 0.35, 5.8, top + 0.55], [w - wall, d - wall, 5.05, top - 0.15],
    [w - 1.7 - wall, d - 1.7 - wall, 4.5, 2.05], [w - 2.6 - wall, d - 2.6 - wall, 3.9, 1.18],
    [w - 4.1, d - 4.1, 3.4, 0.85], [0.001, 0.001, 0, 0.85],
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  const quarter = 16;
  const steps = quarter * 4;
  for (const [x, z, radius, y] of profile) {
    for (let i = 0; i < steps; i++) {
      const quadrant = Math.floor(i / quarter);
      const theta = (quadrant + (i % quarter) / (quarter - 1)) * Math.PI / 2;
      const signX = quadrant === 0 || quadrant === 3 ? 1 : -1;
      const signZ = quadrant < 2 ? 1 : -1;
      vertices.push(signX * (x - radius) + Math.cos(theta) * radius, y, signZ * (z - radius) + Math.sin(theta) * radius);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < steps; i++) {
      const a = j * steps + i, b = j * steps + (i + 1) % steps;
      indices.push(a, a + steps, b, b, a + steps, b + steps);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Photo reference: three heavy ropes in each direction, with braided ties at crossings and sleeves on the frame.
export function buildRopeNet(group: THREE.Group, base: THREE.MeshStandardMaterial, width: number, depth: number, drop: number) {
  const gray: THREE.BufferGeometry[] = [];
  const light: THREE.BufferGeometry[] = [];
  const ropeRadius = 0.37;
  const tube = (points: THREE.Vector3[], radius: number, segments: number) =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false);
  const strand = (alongX: boolean, fixed: number, length: number, otherLength: number) => {
    const half = length / 2;
    const start = -half + 2.5, end = half - 2.5;
    const point = (t: number) => {
      const x = THREE.MathUtils.lerp(start, end, t);
      const sag = -1.05 * Math.sin(Math.PI * t) - drop;
      const side = fixed + 0.22 * Math.sin(t * 2 * Math.PI);
      return alongX ? new THREE.Vector3(x, sag, side) : new THREE.Vector3(side, sag + 0.2, x);
    };
    const steps = 130;
    const centers = Array.from({ length: steps + 1 }, (_, i) => point(i / steps));
    gray.push(tube(centers, ropeRadius, 34));
    const turns = (end - start) / 1.3;
    for (const phase of [0, Math.PI]) {
      const detail = centers.map((p, i) => {
        const a = i / steps * Math.PI * 2 * turns + phase;
        const y = Math.cos(a) * 0.32;
        const cross = Math.sin(a) * 0.32;
        return p.clone().add(alongX ? new THREE.Vector3(0, y, cross) : new THREE.Vector3(cross, y, 0));
      });
      (alongX ? gray : light).push(tube(detail, 0.125, steps));
    }
    for (const side of [-1, 1]) {
      const clamp = new THREE.TorusGeometry(2.42, 0.39, 8, 28);
      if (alongX) clamp.rotateZ(0.14 * side);
      else clamp.rotateY(Math.PI / 2).rotateX(0.14 * side);
      clamp.translate(alongX ? side * half : fixed, -drop, alongX ? fixed : side * half);
      gray.push(clamp);
      const knot = new THREE.TorusGeometry(0.61, 0.24, 7, 14);
      if (!alongX) knot.rotateY(Math.PI / 2);
      knot.rotateX(0.28);
      const inset = Math.min(3.0, otherLength / 10);
      knot.translate(alongX ? side * (half - inset) : fixed, -drop + 0.18, alongX ? fixed : side * (half - inset));
      gray.push(knot);
    }
  };
  const xs = [-width * 0.24, 0, width * 0.24];
  const zs = [-depth * 0.24, 0, depth * 0.24];
  zs.forEach(z => strand(true, z, width, depth));
  xs.forEach(x => strand(false, x, depth, width));
  for (const x of xs) for (const z of zs) {
    for (const turn of [-0.31, 0.31]) {
      const knot = new THREE.TorusGeometry(0.61, 0.21, 7, 13);
      knot.rotateY(Math.PI / 4).rotateZ(turn).translate(x + turn, -drop - 0.78, z + turn * 0.43);
      gray.push(knot);
    }
  }
  for (const [geometries, color] of [[gray, '#9b8e7d'], [light, '#e4dbcc']] as const) {
    const material = base.clone();
    material.color.set(color);
    material.roughness = 0.96;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
}

const holdProfile = {
  red: [[-5.2, 0.9], [-4.1, -2.9], [-2.6, -3.55], [-0.3, -2.3], [2.3, -2.78], [4.8, -1.78], [5.3, 0.25], [3.7, 2.13], [0.8, 3.4], [-2.18, 2.8]],
  blue: [[-4.7, 0.55], [-4.6, -1.35], [-3.1, -2.45], [-0.65, -2.4], [1.5, -3.2], [4, -2.95], [4.7, -0.6], [4.78, 1.6], [3.2, 3.45], [0.85, 3.28], [-1.7, 2.15], [-3.85, 1.9]],
};

export function buildClimbingHold(group: THREE.Group, base: THREE.MeshStandardMaterial, variant: 'red' | 'blue', x: number, z: number, yaw = 0) {
  const outline = new THREE.CatmullRomCurve3(holdProfile[variant].map(([x, z]) => new THREE.Vector3(x, z, 0)), true, 'centripetal');
  const shape = new THREE.Shape(outline.getPoints(48).slice(0, -1).map(p => new THREE.Vector2(p.x, p.y)));
  const sockets = [-2.25, 2.25];
  for (const bx of sockets) {
    const hole = new THREE.Path();
    hole.absarc(bx, 0, 0.91, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const hold = base.clone();
  hold.roughness = 0.68;
  hold.color.set(variant === 'red' ? '#ec392e' : '#2886dc');
  const recess = base.clone();
  recess.color.copy(hold.color).multiplyScalar(0.35);
  const metal = base.clone();
  metal.color.set('#aeb8be');
  metal.metalness = 0.7;
  metal.roughness = 0.31;
  const hex = base.clone();
  hex.color.set('#33383e');
  const turn = new THREE.Matrix4().makeRotationY(yaw);
  const add = (geometry: THREE.BufferGeometry, mat: THREE.Material) => {
    geometry.applyMatrix4(turn).translate(x, 0, z);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(new THREE.ExtrudeGeometry(shape, { depth: 1.38, bevelEnabled: true, bevelSize: 0.47, bevelThickness: 0.5, bevelSegments: 4, curveSegments: 20 })
    .rotateX(-Math.PI / 2).translate(0, 0.97, 0), hold);
  for (const bx of sockets) {
    add(new THREE.CylinderGeometry(0.66, 0.74, 0.24, 18).translate(bx, 1.53, 0), recess);
    add(new THREE.CylinderGeometry(0.36, 0.44, 0.18, 16).translate(bx, 1.73, 0), metal);
    add(new THREE.CylinderGeometry(0.145, 0.145, 0.016, 6).translate(bx, 1.826, 0), hex);
  }
}
