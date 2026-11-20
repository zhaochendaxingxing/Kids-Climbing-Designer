import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PartDefinition } from '@/types/parts';
import { moldedTube } from './productGeometry';

type AddMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x?: number, y?: number, z?: number) => void;

export function buildHangingAccessory(def: PartDefinition, material: THREE.MeshStandardMaterial, add: AddMesh) {
  const top = def.size.height / 2;
  const bottom = -top;
  const webbing = material.clone();
  webbing.color.set('#c9c9bf');
  webbing.roughness = 0.93;
  const buckle = material.clone();
  buckle.color.set('#b4bdba');
  buckle.metalness = 0.65;
  const rope = webbing.clone();
  rope.color.set('#f3edda');
  const hook = webbing.clone();
  hook.color.set('#333a3d');
  const line = (a: THREE.Vector3, b: THREE.Vector3) =>
    add(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.37, 8, false), rope);

  for (const x of [-10, 10]) {
    add(moldedTube(3, 2.56, 2.28), hook, x, top, 0);
    if (def.extKind === 'rings') {
      const strapBottom = bottom + 12;
      const strapLength = top - strapBottom;
      add(new RoundedBoxGeometry(2.65, strapLength, 0.28, 2, 0.12), webbing, x, top - strapLength / 2);
      add(new RoundedBoxGeometry(3.05, 1.2, 0.52, 2, 0.18), buckle, x, top - strapLength * 0.58);
      add(new THREE.TorusGeometry(5.55, 1.05, 12, 40).scale(1.05, 0.89, 1), material, x, bottom + 6);
      for (const side of [-1, 1]) {
        add(new THREE.TorusGeometry(2.1, 0.68, 10, 24), material, x + side * 4.7, bottom + 11.2);
      }
    } else {
      add(new THREE.TorusGeometry(1.28, 0.28, 8, 20).scale(0.82, 1.5, 1), buckle, x, top - 3.6);
      const junction = new THREE.Vector3(x, bottom + 25, 0);
      line(new THREE.Vector3(x, top - 5, -0.42), junction);
      line(new THREE.Vector3(x, top - 5, 0.42), junction);
      for (const z of [-12, 12]) line(junction, new THREE.Vector3(Math.sign(x) * 13, bottom + 12, z));
    }
  }
  if (def.extKind !== 'swing') return;

  const profile = [[0, 0], [11.8, 0], [13.6, 2], [14.1, 7], [15.2, 12], [14.5, 12.4], [13.6, 7], [12.8, 2], [0, 1.3]];
  const bucket = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 48);
  const uv = bucket.getAttribute('uv');
  const positions = bucket.getAttribute('position');
  const colors = [];
  const ivory = new THREE.Color('#fff5de');
  for (let i = 0; i < uv.count; i++) {
    const peak = Math.abs((uv.getX(i) * 10) % 1 - 0.5);
    const color = (positions.getY(i) / 4 + peak * 1.9) % 1 < 0.46 ? ivory : material.color;
    colors.push(color.r, color.g, color.b);
  }
  bucket.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const fabric = material.clone();
  fabric.color.set('#ffffff');
  fabric.vertexColors = true;
  fabric.roughness = 0.94;
  add(bucket, fabric, 0, bottom);
  add(new THREE.TorusGeometry(15, 0.54, 10, 48).rotateX(Math.PI / 2), rope, 0, bottom + 12.15);
  for (const z of [-12, 12]) add(new THREE.CylinderGeometry(0.72, 0.72, 27, 14).rotateZ(Math.PI / 2), rope, 0, bottom + 12, z);
}

export function buildMoldedSlide(spec: NonNullable<PartDefinition['slideSpec']>, material: THREE.MeshStandardMaterial, add: AddMesh) {
  const { rise, run, innerWidth } = spec;
  const profile = new THREE.CatmullRomCurve3([
    [0, rise], [run * 0.1, rise - 2], [run * 0.26, rise * 0.76], [run * 0.49, rise * 0.37],
    [run * 0.71, rise * 0.07], [run * 0.88, 2.4], [run, 2],
  ].map(([z, y]) => new THREE.Vector3(0, y - rise / 2, z - run / 2)), false, 'centripetal');
  const vertices: number[] = [];
  const indices: number[] = [];
  const w = innerWidth / 2;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const p = profile.getPoint(i / steps);
    const sideHeight = 10.5 - 4 * Math.max(0, (i / steps - 0.84) / 0.16);
    const crossSection = [
      [-w - 3, 0], [-w - 3.5, sideHeight - 1], [-w - 2.6, sideHeight], [-w - 1.7, sideHeight - 0.9],
      [-w - 1.1, 2.2], [-w, 0.55], [-w + 1.4, 0], [w - 1.4, 0], [w, 0.55],
      [w + 1.1, 2.2], [w + 1.7, sideHeight - 0.9], [w + 2.6, sideHeight],
      [w + 3.5, sideHeight - 1], [w + 3, 0], [w + 1.2, -1.8], [-w - 1.2, -1.8],
    ];
    for (const [x, y] of crossSection) vertices.push(x, p.y + y, p.z);
    if (i === 0 || i === steps) {
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(crossSection.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
        const start = i * crossSection.length;
        if (i === 0) indices.push(start + a, start + b, start + c);
        else indices.push(start + c, start + b, start + a);
      }
    }
    if (!i) continue;
    for (let j = 0; j < crossSection.length; j++) {
      const period = crossSection.length;
      const a = (i - 1) * period + j;
      const b = (i - 1) * period + (j + 1) % period;
      indices.push(a, b, a + period, a + period, b, b + period);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const shell = material.clone();
  shell.side = THREE.DoubleSide;
  shell.roughness = 0.34;
  add(geo, shell);
}
