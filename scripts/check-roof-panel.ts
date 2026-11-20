import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findRoofPanelFit } from '../src/components/three/roofPanelFit';
import { createPartMesh } from '../src/components/three/partMesh';
import { getPartById, ROOF_PANEL_ID } from '../src/data/parts';
import { useStore } from '../src/store/useStore';
import type { PlacedPart } from '../src/types/parts';

const corners = [[-20, 40, -20], [20, 40, -20], [20, 40, 20], [-20, 40, 20]]
  .map(point => new THREE.Vector3(...point));
const peak = new THREE.Vector3(0, 40 + Math.sqrt(800), 0);
const parts: PlacedPart[] = [];
function bar(a: THREE.Vector3, b: THREE.Vector3) {
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
  const { x, y, z } = new THREE.Euler().setFromQuaternion(tilt);
  parts.push({ id: 'bar-' + parts.length, partId: 'bar-35', colorId: 'mint', position: a.clone().lerp(b, 0.5).toArray(), rotation: [x, y, z] });
}
for (const [index, a] of corners.entries()) {
  bar(a, corners[(index + 1) % corners.length]);
  bar(a, peak);
}

const covered = [...parts];
for (const [index, a] of corners.entries()) {
  const b = corners[(index + 1) % corners.length];
  const target = a.clone().add(b).add(peak).divideScalar(3);
  const outward = target.clone().sub(peak).setY(0).normalize();
  const eye = target.clone().addScaledVector(outward, 45).add(new THREE.Vector3(0, 25, 0));
  const ray = new THREE.Ray(eye, target.clone().sub(eye).normalize());
  const fit = findRoofPanelFit(ray, covered);
  assert.ok(fit?.roofOutline, 'Each of the four faces is selectable');
  assert.equal(fit.partId, ROOF_PANEL_ID);
  const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...fit.rotation));
  assert.ok(normal.dot(outward) > 0.6 && normal.y > 0.5);
  const panel = { ...fit, id: 'panel-' + index, colorId: 'mint' };
  const mesh = createPartMesh(panel, getPartById(ROOF_PANEL_ID)!, '#ffffff');
  mesh.updateMatrixWorld(true);
  assert.ok(new THREE.Raycaster(ray.origin, ray.direction).intersectObject(mesh, true).length > 0);
  assert.equal(findRoofPanelFit(ray, covered, 5), null, 'An occluded face is not selected');
  assert.equal(findRoofPanelFit(ray, [parts[2 * index + 1], parts[(2 * index + 3) % parts.length]]), null, 'Two rafters alone do not make a face');
  covered.push(panel);

  const store = useStore.getState();
  store.addPart(fit.partId, fit.position, fit.rotation, undefined, false, true, fit.roofOutline);
}

const store = useStore.getState();
assert.equal(store.parts.length, 4);
assert.ok(JSON.parse(store.exportJSON()).parts.every((part: PlacedPart) => part.roofOutline?.length === 3));
store.undo();
assert.equal(useStore.getState().parts.length, 3);
console.log('PASS: four pyramid faces, actual panel meshes, occlusion, outline export and undo');
