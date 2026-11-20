import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BRIDGE_ACCESSORY, FINISHED_PRODUCTS, ROOF_SLIDE_PRODUCT } from '../src/data/finishedProducts';
import { findBridgeFit } from '../src/components/three/bridgeFit';
import { getPartById } from '../src/data/parts';
import { ports } from '../src/lib/construction';
import { useStore } from '../src/store/useStore';

const { parts } = ROOF_SLIDE_PRODUCT;
const definitions = new Map(parts.map(part => [part.id, getPartById(part.partId)]));
assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
assert.ok(parts.every(part => definitions.get(part.id)), 'Every product part must come from the existing library');

const allPorts = ports(parts);
for (const port of allPorts) {
  if (definitions.get(port.partId)?.category !== 'bar') continue;
  const joints = allPorts.filter(candidate => candidate.type !== port.type
    && candidate.position.distanceTo(port.position) < 0.001
    && candidate.direction.dot(port.direction) < -0.999);
  assert.equal(joints.length, 1, `Rod port ${port.partId}:${port.cpId} at ${port.position.toArray()} must meet exactly one connector`);
}
assert.equal(parts.filter(part => part.partId === 'connector-45deg-nest').length, 4);
assert.equal(parts.filter(part => part.partId === 'connector-bazi').length, 0);
const straps = parts.filter(part => part.partId === 'connector-slide-strap');
assert.equal(straps.length, 2);
const forbiddenRail = parts.find(({ partId, position: [x, y, z] }) =>
  partId === 'bar-35' && x === 40 && y === 82.5 && z === -20);
assert.equal(forbiddenRail, undefined);
const panels = parts.filter(part => part.partId === 'platform-39.5x39.5');
const deck = panels.filter(({ position: [, y, z] }) => Math.abs(y - 44.6) < 0.01 && z === -20);
assert.deepEqual(deck.map(part => part.position[0]), [-20, 20, 60], 'The photo shows three rear deck bays');
const leftSide = parts.filter(part => part.partId.startsWith('platform-') && part.position[0] === -40);
assert.deepEqual(leftSide.map(part => [part.partId, ...part.position]), [
  ['platform-39.5x39.5', -40, 22.5, -20],
  ['platform-39.5x19.5', -40, 12.5, 20],
]);
for (const part of leftSide) {
  const normal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...part.rotation));
  assert.ok(normal.x < -0.999);
}
const chute = panels.filter(({ position: [x, , z] }) => x === 60 && z > 0);
assert.equal(chute.length, 2);
const tilt = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...chute[0].rotation));
assert.ok(tilt.distanceTo(new THREE.Vector3(0, Math.sqrt(3) / 2, 0.5)) < 0.001);
const underRails = parts.filter(({ partId, position: [x, , z], rotation }) => partId === 'bar-35'
  && (x === 40 || x === 80) && z > 0
  && new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...rotation)).y < -0.49);
assert.equal(underRails.length, 8, 'Each side has two lower rails and two raised grab rails');
assert.ok(parts.every(part => definitions.get(part.id)?.colors?.some(color => color.id === part.colorId)));
useStore.getState().addPresetGroup(ROOF_SLIDE_PRODUCT, [70, 0, 20]);
const placed = useStore.getState();
const productGroup = placed.groups.find(group => group.name === ROOF_SLIDE_PRODUCT.name)!;
assert.equal(productGroup.childGroupIds.length, 4);
for (const groupId of productGroup.childGroupIds) {
  const group = placed.groups.find(candidate => candidate.id === groupId)!;
  assert.deepEqual(group.memberIds.map(id => placed.parts.find(part => part.id === id)?.partId).sort(),
    ['connector-45deg-nest', 'connector-l']);
}
placed.undo();
assert.equal(useStore.getState().parts.length, 0);
placed.redo();
assert.equal(useStore.getState().parts.length, parts.length);
placed.ungroupGroup(productGroup.id);
assert.ok(productGroup.childGroupIds.every(id => useStore.getState().groups.some(group => group.id === id)));
const placedStraps = useStore.getState().parts.filter(part => part.partId === 'connector-slide-strap');
placed.setSelection(placedStraps.map(part => part.id));
placed.replaceSelectedConnectors('connector-v6');
assert.equal(useStore.getState().parts.filter(part => part.partId === 'connector-slide-strap').length, 2);
console.log(`PASS: ${parts.length} existing parts, all rod ports matched, four eave joints and two chute sections`);

for (const product of FINISHED_PRODUCTS.slice(1)) {
  const definitions = new Map(product.parts.map(part => [part.id, getPartById(part.partId)]));
  assert.ok(product.parts.every(part => definitions.get(part.id)));
  const allPorts = ports(product.parts);
  for (const port of allPorts) {
    if (!definitions.get(port.partId)?.barSpec) continue;
    const joints = allPorts.filter(candidate => candidate.type !== port.type
      && candidate.position.distanceTo(port.position) < 0.001
      && candidate.direction.dot(port.direction) < -0.999);
    assert.equal(joints.length, 1, `${product.name}: ${port.partId} at ${port.position.toArray()} does not have one matching connector`);
  }
  for (const part of product.parts) {
    const end = allPorts.filter(port => port.partId === part.id);
    if (!definitions.get(part.id)?.barSpec || end.length !== 2) continue;
    const axis = end[1].position.clone().sub(end[0].position).normalize();
    const length = end[0].position.distanceTo(end[1].position);
    for (const other of allPorts) {
      if (other.partId === part.id || !definitions.get(other.partId)?.barSpec || Math.abs(other.direction.dot(axis)) < 0.999) continue;
      const delta = other.position.clone().sub(end[0].position);
      const t = delta.dot(axis);
      assert.ok(t <= 0.01 || t >= length - 0.01 || delta.addScaledVector(axis, -t).length() > 0.01,
        `${product.name}: overlapping tubes ${other.partId} and ${part.id}`);
    }
  }
  console.log(`PASS: ${product.name}, ${product.parts.length} parts and connected bars`);
}

const smallThree = FINISHED_PRODUCTS.find(product => product.id === 'product-small-03')!;
const wheel = smallThree.parts.find(part => part.partId === 'ext-bar-wheel');
assert.deepEqual(wheel?.rotation, [-Math.PI / 4, 0, 0]);
const rungs = smallThree.parts.filter(part => part.partId === 'bar-25' && part.position[0] === 65);
assert.equal(rungs.length, 5);
assert.deepEqual(rungs.map(part => Math.round(part.position[1] - 2.5)), [40, 30, 20, 10, 0]);
const sharedRail = smallThree.parts.filter(part => part.partId === 'bar-15' && part.position[0] === 80 && part.position[2] > 5.5
  && Math.abs(new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(...part.rotation)).y + 0.5) < 0.001);
assert.equal(sharedRail.length, 4);

const smallOne = FINISHED_PRODUCTS.find(product => product.id === 'product-small-01')!;
const smallTwo = FINISHED_PRODUCTS.find(product => product.id === 'product-small-02')!;
assert.ok(smallOne.parts.some(part => part.partId === 'platform-39.5x39.5' && part.position.join(',') === '100,44.6,-60'));
assert.ok(smallTwo.parts.some(part => part.partId === 'platform-39.5x39.5' && part.position.join(',') === '60,24.6,60'));
assert.equal(smallTwo.parts.filter(part => part.partId === 'bar-25' && part.position[0] === 60).length, 3);
assert.ok(smallTwo.parts.some(part => part.partId === 'bar-35' && part.position.join(',') === '20,122.5,-40'));
assert.ok(!smallTwo.parts.some(part => part.partId === 'bar-35' && part.position[0] === 14.5
  && part.position[1] > 83 && part.position[1] < 120 && part.position[2] > -40));

assert.equal(BRIDGE_ACCESSORY.parts.filter(part => part.partId === 'bar-15').length, 3);
assert.equal(BRIDGE_ACCESSORY.parts.filter(part => part.partId === 'bar-35').length, 4);
assert.equal(BRIDGE_ACCESSORY.parts.filter(part => part.partId === 'platform-39.5x19.5').length, 2);
assert.equal(BRIDGE_ACCESSORY.parts.filter(part => part.partId === 'connector-bridge-rope').length, 8);
for (const [product, offset] of [[smallOne, 0], [smallTwo, 40]] as const) {
  const ids = new Set<string>();
  for (const local of BRIDGE_ACCESSORY.parts) {
    const target = new THREE.Vector3(...local.position).add(new THREE.Vector3(100, 0, offset));
    const part = product.parts.find(candidate => candidate.partId === local.partId && candidate.colorId === local.colorId
      && target.distanceToSquared(new THREE.Vector3(...candidate.position)) < 0.0001);
    assert.ok(part, `${product.name}: missing common bridge part ${local.partId}`);
    ids.add(part.id);
  }
  assert.equal(ids.size, BRIDGE_ACCESSORY.parts.length);
  const ray = new THREE.Ray(new THREE.Vector3(100, 100, offset), new THREE.Vector3(0, -1, 0));
  assert.equal(findBridgeFit(ray, product.parts), null, 'Occupied bridge bay rejects a duplicate');
  const frame = product.parts.filter(part => !ids.has(part.id));
  const fit = findBridgeFit(ray, frame);
  assert.ok(fit && fit.position.distanceToSquared(new THREE.Vector3(100, 0, offset)) < 0.001);
  assert.equal(findBridgeFit(ray, frame.filter(part => part.position[0] !== 120)), null);
}
console.log('PASS: both products use the same editable bridge, fitting an empty double bay only');
