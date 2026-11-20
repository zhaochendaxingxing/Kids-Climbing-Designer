import * as THREE from 'three';
import { getPartById } from '@/data/parts';

/** Open fabric basket. The local origin is at the platform seating height. */
export function buildFabricPouch(group: THREE.Group, material: THREE.MeshStandardMaterial, width: number, depth: number) {
  const cloth = material.clone();
  cloth.roughness = 0.98;
  const seam = cloth.clone();
  seam.color.multiplyScalar(0.76);
  const zipper = cloth.clone();
  zipper.color.set('#b99447');
  zipper.metalness = 0.42;
  zipper.roughness = 0.48;

  const barRadius = (getPartById('bar-35')!.barSpec!.outerDiameter) / 2;
  const barY = -barRadius + 0.1;
  const floorEdge = -23;

  function add(geometry: THREE.BufferGeometry, mat: THREE.Material, yaw = 0) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  function fabricGrid(columns: number, rows: number, point: (u: number, v: number) => [number, number, number]) {
    const geometry = new THREE.PlaneGeometry(1, 1, columns, rows);
    const vertices = geometry.getAttribute('position');
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        vertices.setXYZ(row * (columns + 1) + column, ...point(2 * column / columns - 1, row / rows));
      }
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  const sag = (u: number) => 1 - u * u;
  add(fabricGrid(20, 20, (u, v) => {
    const z = 2 * v - 1;
    return [u * (width / 2 - 5), floorEdge - 0.65 * (sag(u) + sag(z)) - 0.7 * sag(u) * sag(z), z * (depth / 2 - 5)];
  }), cloth);

  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2;
    const [span, across] = side % 2 === 0 ? [width, depth] : [depth, width];
    const wallPoint = (u: number, v: number): [number, number, number] => {
      const fullness = Math.sin(Math.PI * v);
      const ripple = 0.28 * Math.sin(u * 15 + v * 8 + side) + 0.17 * Math.sin(u * 25 - v * 15);
      return [
        u * (span / 2 - THREE.MathUtils.lerp(barRadius, 5, v)),
        THREE.MathUtils.lerp(barY, floorEdge - 0.65 * sag(u), v),
        across / 2 - THREE.MathUtils.lerp(barRadius, 5, v) + sag(u) * fullness * (1.15 + ripple),
      ];
    };
    add(fabricGrid(40, 20, wallPoint), cloth, yaw);
    const stitchedCorner = Array.from({ length: 9 }, (_, i) => new THREE.Vector3(...wallPoint(1, i / 8)));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stitchedCorner), 12, 0.095, 6, false), seam, yaw);

    // The four separate zipped sleeves leave the corner fittings exposed.
    const length = span - 6;
    const sleeve = new THREE.CylinderGeometry(1, 1, length, 32, 48, true);
    const vertices = sleeve.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getY(i);
      const cos = vertices.getZ(i);
      const sin = vertices.getX(i);
      const fold = Math.sin(x * 1.37 + 1.2 * cos + side) * Math.cos(3 * sin + x * 0.37);
      const radius = barRadius + 0.27 + fold * 0.16;
      vertices.setXYZ(i, x, barY + radius * cos, across / 2 + radius * sin);
    }
    sleeve.computeVertexNormals();
    add(sleeve, cloth, yaw);

    const track = new THREE.CapsuleGeometry(0.12, length - 0.8, 3, 8).rotateZ(Math.PI / 2);
    track.translate(0, barY - 1.52, across / 2 + barRadius * 0.86);
    add(track, seam, yaw);
    const slider = new THREE.BoxGeometry(0.75, 0.34, 0.35).translate(length / 2 - 1.4, barY - 1.58, across / 2 + barRadius * 0.9);
    add(slider, zipper, yaw);
    const pull = new THREE.TorusGeometry(0.24, 0.075, 6, 12).scale(0.75, 1.65, 1);
    pull.translate(length / 2 - 1.36, barY - 2.05, across / 2 + barRadius * 0.95);
    add(pull, zipper, yaw);
  }
}
