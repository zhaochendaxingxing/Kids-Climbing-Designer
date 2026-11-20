import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getPartById, SPECIAL_EXTENSIONS, SLIDE_STRAP_RAIL_SPACING } from '../src/data/parts';
import { FINISHED_PRODUCTS } from '../src/data/finishedProducts';
import { findMountedAccessoryFit, findTallRainbowFit } from '../src/components/three/specialAccessoryFit';
import { createPartMesh } from '../src/components/three/partMesh';
import type { PlacedPart } from '../src/types/parts';

function piece(id: string, partId: string, position: PlacedPart['position'], rotation: PlacedPart['rotation'] = [0, 0, 0]): PlacedPart {
  return { id, partId, position, rotation, colorId: 'mint' };
}

for (const height of [60, 80]) {
  const def = getPartById(`ext-plate-rainbow-${height}`)!;
  assert.ok(SPECIAL_EXTENSIONS.includes(def));
  const rails = [piece('bottom', 'bar-35', [0, 0, 0]), piece('top', 'bar-35', [0, height, 0])];
  for (const x of [-20, 20]) {
    rails.push(piece(`left-${x}`, 'bar-35', [x, 20, 0], [0, 0, Math.PI / 2]));
    rails.push(piece(`upper-${x}`, `bar-${height - 45}`, [x, (40 + height) / 2, 0], [0, 0, Math.PI / 2]));
  }
  const ray = new THREE.Ray(new THREE.Vector3(0, height / 2, 100), new THREE.Vector3(0, 0, -1));
  const fit = findTallRainbowFit(ray, rails, def);
  assert.deepEqual(fit?.position, [0, height / 2, 0]);
  assert.equal(findTallRainbowFit(ray, rails.slice(0, -1), def), null);
  assert.equal(findTallRainbowFit(ray, rails, getPartById(`ext-plate-rainbow-${140 - height}`)!), null);
  assert.equal(findTallRainbowFit(ray, [...rails, piece('crossbar', 'bar-35', [0, 40, 0])], def), null);
}

for (const id of ['special-rings', 'special-swing', 'special-molded-slide-60', 'special-molded-slide-80']) {
  const def = getPartById(id)!;
  const y = def.slideSpec?.rise ?? 80;
  const ray = new THREE.Ray(new THREE.Vector3(0, y, 100), new THREE.Vector3(0, 0, -1));
  const rail = piece('rail', 'bar-35', [0, y, 0]);
  const fit = findMountedAccessoryFit(ray, [rail], def);
  assert.ok(fit, id);
  assert.equal(findMountedAccessoryFit(ray, [piece('vertical', 'bar-35', [0, y, 0], [0, 0, Math.PI / 2])], def), null);
  assert.equal(findMountedAccessoryFit(ray, [rail, { ...fit, id: 'already-mounted', colorId: 'mint' }], def)?.rotation[1] === fit.rotation[1], false);
  const model = createPartMesh({ ...fit, id, colorId: def.defaultColor }, def, '#e03a39');
  const bounds = new THREE.Box3().setFromObject(model);
  assert.ok(!bounds.isEmpty() && bounds.min.y >= -0.1);
}

const smallTwo = FINISHED_PRODUCTS.find(item => item.id === 'product-small-02')!;
const lowerStep = new THREE.Vector3(60, 22.5, 40);
const bottom = smallTwo.parts.filter(part => part.partId === 'bar-25' && part.position[0] === 60)
  .sort((a, b) => a.position[1] - b.position[1])[0];
const bottomBeam = new THREE.Vector3(...bottom.position);
assert.ok(Math.abs(bottomBeam.distanceTo(lowerStep) - SLIDE_STRAP_RAIL_SPACING) < 0.001);
const mounts = smallTwo.parts.filter(part => part.partId === 'connector-slide-strap'
  && Math.abs(part.position[1] - (bottomBeam.y + lowerStep.y) / 2) < 0.001);
assert.equal(mounts.length, 2);
for (const mount of mounts) {
  const span = new THREE.Vector3(0, 0, SLIDE_STRAP_RAIL_SPACING).applyEuler(new THREE.Euler(...mount.rotation));
  assert.ok(span.distanceTo(lowerStep.clone().sub(bottomBeam)) < 0.001);
}
console.log('PASS: both rainbow sizes, both hanging items, both molded slides and lower ladder straps');
