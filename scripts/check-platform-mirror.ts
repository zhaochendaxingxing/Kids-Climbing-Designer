import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mirrorPlatformTransform } from '../src/components/three/platformMirror';
import { PARTS_LIBRARY } from '../src/data/parts';
import type { PlacedPart } from '../src/types/parts';

function part(id: string, partId: string, position: PlacedPart['position'], rotation: PlacedPart['rotation']): PlacedPart {
  return { id, partId, position, rotation, colorId: 'mint' };
}

// Same spacing as the framework generator. The selected bay shares posts and
// crossbars with the rest of the grid and has more than 24 nearby bars.
const grid: PlacedPart[] = [];
for (let x = -60; x <= 60; x += 40) {
  for (let y = -40; y <= 80; y += 40) {
    for (let z = -40; z <= 40; z += 40) {
      if (x < 60) grid.push(part(`x-${x}-${y}-${z}`, 'bar-35', [x + 20, y, z], [0, 0, 0]));
      if (y < 80) grid.push(part(`y-${x}-${y}-${z}`, 'bar-35', [x, y + 20, z], [0, 0, Math.PI / 2]));
      if (z < 40) grid.push(part(`z-${x}-${y}-${z}`, 'bar-35', [x, y, z + 20], [0, Math.PI / 2, 0]));
    }
  }
}

function normal(rotation: PlacedPart['rotation']) {
  return new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(...rotation));
}

function yaw(source: PlacedPart): PlacedPart {
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 5);
  const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...source.rotation));
  const rotation = new THREE.Euler().setFromQuaternion(turn.clone().multiply(orientation));
  return { ...source, position: new THREE.Vector3(...source.position).applyQuaternion(turn).toArray(), rotation: [rotation.x, rotation.y, rotation.z] };
}

const extensions = PARTS_LIBRARY.filter(def => def.category === 'platform' && def.extension && def.platformSpec && !def.directPlacement);
for (const def of extensions) {
  const shortSide = Math.round(Math.min(def.platformSpec!.plateDepth, def.platformSpec!.plateWidth));
  const panel = part('board', def.id, [0, 20, 0.3], [Math.PI / 2, 0, 0]);
  if (def.extKind === 'storbox') {
    assert.equal(mirrorPlatformTransform(panel, def, grid), null, def.id);
    continue;
  }

  const bars = shortSide === 40 ? grid : [
    part('bottom', 'bar-35', [0, 20 - shortSide / 2, 0], [0, 0, 0]),
    part('top', 'bar-35', [0, 20 + shortSide / 2, 0], [0, 0, 0]),
    part('left', `bar-${shortSide - 5}`, [-20, 20, 0], [0, 0, Math.PI / 2]),
    part('right', `bar-${shortSide - 5}`, [20, 20, 0], [0, 0, Math.PI / 2]),
  ];
  if (shortSide === 40) {
    assert.ok(grid.filter(bar => new THREE.Vector3(...bar.position).distanceTo(new THREE.Vector3(...panel.position)) < 64.5).length > 24);
  }
  const mounted = yaw(panel);
  const frame = bars.map(yaw);
  const mirrored = mirrorPlatformTransform(mounted, def, frame);
  assert.ok(mirrored, def.id);
  assert.ok(new THREE.Vector3(...mirrored.position).distanceTo(new THREE.Vector3(...yaw({ ...panel, position: [0, 20, -0.3] }).position)) < 1e-6, def.id);
  assert.ok(normal(mirrored.rotation).dot(normal(mounted.rotation)) < -0.999, def.id);
  const restored = mirrorPlatformTransform({ ...mounted, ...mirrored }, def, frame);
  assert.ok(restored && new THREE.Vector3(...restored.position).distanceTo(new THREE.Vector3(...mounted.position)) < 1e-6, def.id);
  assert.ok(restored && normal(restored.rotation).dot(normal(mounted.rotation)) > 0.999, def.id);
}

const glass = extensions.find(def => def.extKind === 'glass')!;
const deck = part('deck', glass.id, [0, 2, 20], [0, 0, 0]);
const mirroredDeck = mirrorPlatformTransform(deck, glass, grid);
assert.ok(mirroredDeck && Math.abs(mirroredDeck.position[1] + 2) < 1e-6);
assert.ok(normal(mirroredDeck.rotation).y < -0.999);
assert.equal(mirrorPlatformTransform({ ...deck, position: [0, 12, 20] }, glass, grid), null);
assert.equal(mirrorPlatformTransform(deck, glass, grid.filter(bar => !bar.id.startsWith('z-'))), null);
console.log(`PASS: ${extensions.length} extension definitions, dense and rotated frames, narrow panels, horizontal mount and missing frame`);
