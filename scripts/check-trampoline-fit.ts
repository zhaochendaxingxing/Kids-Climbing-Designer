import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findTrampolineFit } from '../src/components/three/trampolineFit';
import { FINISHED_PRODUCTS } from '../src/data/finishedProducts';
import { getPartById, SPECIAL_EXTENSIONS } from '../src/data/parts';
import type { PlacedPart } from '../src/types/parts';

const def = getPartById('platform-trampoline-80')!;
assert.ok(SPECIAL_EXTENSIONS.includes(def));
const product = FINISHED_PRODUCTS.find(item => item.id === 'product-small-01')!;
const mat = product.parts.find(part => part.partId === def.id)!;
const shell = product.parts.filter(part => part !== mat);
const rayAt = (position: PlacedPart['position']) => new THREE.Ray(
  new THREE.Vector3(...position).add(new THREE.Vector3(0, 100, 0)), new THREE.Vector3(0, -1, 0));
const ray = rayAt(mat.position);
assert.deepEqual(findTrampolineFit(ray, shell, def)?.position, mat.position);
assert.equal(findTrampolineFit(ray, product.parts, def), null, 'Do not stack on an installed mat');

const blocked = (partId: string, position: PlacedPart['position']) => [...shell, {
  id: 'blocked', partId, position, rotation: [0, 0, 0], colorId: 'mint',
} satisfies PlacedPart];
assert.equal(findTrampolineFit(ray, blocked('bar-35', [20, 42.5, -40]), def), null);
assert.equal(findTrampolineFit(ray, blocked('platform-39.5x39.5', [20, 44.6, -60]), def), null);
const sideRemoved = shell.filter(part => !(part.partId === 'bar-35' && part.position[0] === 20
  && part.position[1] === 42.5 && part.position[2] === -80));
assert.equal(findTrampolineFit(ray, sideRemoved, def), null);

const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.63);
const rotated = shell.map(part => {
  const view = yaw.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)));
  const euler = new THREE.Euler().setFromQuaternion(view);
  return { ...part, rotation: [euler.x, euler.y, euler.z] as PlacedPart['rotation'],
    position: new THREE.Vector3(...part.position).applyQuaternion(yaw).toArray() };
});
const expected = new THREE.Vector3(...mat.position).applyQuaternion(yaw);
const fit = findTrampolineFit(rayAt(expected.toArray()), rotated, def);
assert.ok(fit && new THREE.Vector3(...fit.position).distanceTo(expected) < 1e-6);
console.log('PASS: real preset, rotated frame, missing rails, occupied span and duplicate prevention');
