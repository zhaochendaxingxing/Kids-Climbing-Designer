import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPartMesh } from '../src/components/three/partMesh';
import { getPartById } from '../src/data/parts';

function mesh(partId: string, rotation: [number, number, number] = [0, 0, 0]) {
  const model = createPartMesh({ id: 'test', partId, position: [0, 0, 0], rotation, colorId: 'white' }, getPartById(partId)!, '#ffffff');
  model.updateMatrixWorld(true);
  return model;
}

const glassTop = new THREE.Box3().setFromObject(mesh('ext-plate-glass')).max.y;
const platformTop = new THREE.Box3().setFromObject(mesh('platform-39.5x39.5')).max.y;
assert.ok(Math.abs(glassTop - platformTop) < 0.00001, 'Glass and platform must share the same top surface');

const pouch = mesh('ext-plate-pouch');
const opening = new THREE.Raycaster(new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, -1, 0));
const centerHit = opening.intersectObject(pouch, true)[0];
assert.ok(centerHit && Math.abs(centerHit.point.y + 25) < 0.01, 'The opening exposes the hanging center of the floor');
const sleeve = new THREE.Raycaster(new THREE.Vector3(0, 8, 20), new THREE.Vector3(0, -1, 0));
assert.ok(sleeve.intersectObject(pouch, true)[0]?.point.y > 0, 'The cloth wraps over the top rail');

for (const rotation of [[Math.PI / 2, 0, 0], [-Math.PI / 2, 0, 0], [0, 0, Math.PI / 2]] as [number, number, number][]) {
  const board = mesh('ext-plate-basketball', rotation);
  let hoopY: number | undefined;
  const netSections: number[] = [];
  board.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const y = node.getWorldPosition(new THREE.Vector3()).y;
    if (node.geometry instanceof THREE.TorusGeometry) hoopY = y;
    if (node.geometry instanceof THREE.CylinderGeometry) netSections.push(y);
  });
  assert.notEqual(hoopY, undefined);
  assert.equal(netSections.length, 2);
  assert.ok(netSections.every(y => y < hoopY!), 'Net hangs below hoop for either wall-facing direction');
}
console.log('PASS: flush glass, open fabric pouch with rail sleeve, upright basketball net');
