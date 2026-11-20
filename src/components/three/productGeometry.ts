import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Open molded tube, local axis X. The pin holes cut both cylindrical surfaces. */
export function moldedTube(length: number, outer: number, inner: number, holes: number[] = [], holeRadius = 0.44) {
  const bevel = Math.min(0.09, (outer - inner) * 0.32);
  const half = length / 2;
  const segments = 48;
  const angleHalf = Math.PI / 6;
  const patchHalf = holeRadius + 0.17;
  const positions: number[] = [];
  const normals: number[] = [];
  const surface = (radius: number, sign: number) => {
    // Flat panels in axial/azimuth coordinates, mapped onto the cylinder.
    const draw = (left: number, right: number, start: number, end: number, cut?: number) => {
      const shape = new THREE.Shape();
      const steps = Math.max(1, Math.round((end - start) / (2 * Math.PI) * segments));
      shape.moveTo(left, start);
      shape.lineTo(right, start);
      for (let i = 1; i <= steps; i++) shape.lineTo(right, start + (end - start) * i / steps);
      shape.lineTo(left, end);
      for (let i = steps - 1; i >= 0; i--) shape.lineTo(left, start + (end - start) * i / steps);
      if (cut !== undefined) {
        const path = new THREE.Path();
        for (let i = 0; i <= 24; i++) {
          const a = -i / 24 * Math.PI * 2;
          const x = cut + holeRadius * Math.cos(a);
          const theta = Math.asin(holeRadius * Math.sin(a) / radius);
          if (i === 0) path.moveTo(x, theta);
          else path.lineTo(x, theta);
        }
        shape.holes.push(path);
      }
      const indexed = new THREE.ShapeGeometry(shape);
      const flat = indexed.toNonIndexed();
      const vertices = flat.getAttribute('position');
      for (let i = 0; i < vertices.count; i += 3) {
        for (const offset of sign > 0 ? [0, 2, 1] : [0, 1, 2]) {
          const theta = vertices.getY(i + offset);
          positions.push(vertices.getX(i + offset), radius * Math.cos(theta), radius * Math.sin(theta));
          normals.push(0, sign * Math.cos(theta), sign * Math.sin(theta));
        }
      }
      indexed.dispose();
      flat.dispose();
    };
    // Split each azimuth strip to keep the surface curved after triangulation.
    const band = (left: number, right: number, start: number, end: number) => {
      const steps = Math.max(1, Math.round((end - start) / (2 * Math.PI) * segments));
      const vertex = (x: number, theta: number) => {
        positions.push(x, radius * Math.cos(theta), radius * Math.sin(theta));
        normals.push(0, sign * Math.cos(theta), sign * Math.sin(theta));
      };
      for (let i = 0; i < steps; i++) {
        const a = start + (end - start) * i / steps;
        const b = start + (end - start) * (i + 1) / steps;
        if (sign > 0) {
          vertex(left, a); vertex(left, b); vertex(right, b);
          vertex(left, a); vertex(right, b); vertex(right, a);
        } else {
          vertex(left, a); vertex(right, b); vertex(left, b);
          vertex(left, a); vertex(right, a); vertex(right, b);
        }
      }
    };
    const start = -half + bevel;
    const end = half - bevel;
    band(start, end, angleHalf, 2 * Math.PI - angleHalf);
    let cursor = start;
    for (const hole of holes) {
      band(cursor, hole - patchHalf, -angleHalf, angleHalf);
      draw(hole - patchHalf, hole + patchHalf, -angleHalf, angleHalf, hole);
      cursor = hole + patchHalf;
    }
    band(cursor, end, -angleHalf, angleHalf);
  };
  surface(outer, 1);
  surface(inner, -1);
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  walls.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const pieces = [walls];
  const plain = (geometry: THREE.BufferGeometry) => {
    if (geometry.index) {
      const unindexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = unindexed;
    }
    geometry.deleteAttribute('uv');
    pieces.push(geometry);
  };
  for (const sign of [-1, 1]) {
    const axial = (value: number) => sign * (half - value);
    const profile = [
      [outer, axial(bevel)], [outer - bevel, axial(0)], [inner + bevel, axial(0)], [inner, axial(bevel)],
    ];
    if (sign < 0) profile.reverse();
    plain(new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), segments).rotateZ(-Math.PI / 2));
  }
  for (const hole of holes) {
    const vertices: number[] = [];
    const point = (a: number, r: number) => {
      const z = holeRadius * Math.sin(a);
      return [hole + holeRadius * Math.cos(a), Math.sqrt(r * r - z * z), z];
    };
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, b = (i + 1) / 24 * Math.PI * 2;
      vertices.push(...point(a, outer), ...point(b, outer), ...point(a, inner), ...point(b, outer), ...point(b, inner), ...point(a, inner));
    }
    const rim = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    rim.computeVertexNormals();
    pieces.push(rim);
  }
  const combined = mergeGeometries(pieces)!;
  pieces.forEach(geometry => geometry.dispose());
  return combined;
}
