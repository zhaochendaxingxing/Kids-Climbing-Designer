import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LADDER_ACCESSORY, SLIDE_ACCESSORY, SLIDE_RUN } from '../src/data/finishedProducts';
import { getPartById } from '../src/data/parts';
import { findLadderJoin } from '../src/components/three/ladderFit';
import { placeAssemblyParts } from '../src/components/three/slideFit';
import { ports } from '../src/lib/construction';
import { useStore } from '../src/store/useStore';

const yaw = 0.87;
const origin = new THREE.Vector3(50, 10, 15);
const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const scene = placeAssemblyParts(SLIDE_ACCESSORY.parts, { position: origin, yaw, strapHalfSpacing: 12 });
for (const side of [-1, 1]) {
  const point = new THREE.Vector3(side * 35, 60, 5.5 + SLIDE_RUN / 2).applyQuaternion(turn).add(origin);
  const ray = new THREE.Ray(point, new THREE.Vector3(0, -1, 0));
  const fit = findLadderJoin(ray, scene);
  assert.ok(fit, 'Either free side accepts the ladder');
  assert.equal(fit.additions.filter(part => part.partId === 'bar-25').length, 5);
  assert.equal(fit.replacements.filter(part => part.partId === 'bar-15').length, 2);
  const updated = new Map(fit.replacements.map(part => [part.id, part]));
  const combined = [...scene.map(part => updated.get(part.id) ?? part), ...fit.additions];
  const allPorts = ports(combined);
  for (const port of allPorts) {
    if (!getPartById(combined.find(part => part.id === port.partId)!.partId)?.barSpec) continue;
    assert.equal(allPorts.filter(other => other.type !== port.type
      && other.position.distanceToSquared(port.position) < 0.001 && other.direction.dot(port.direction) < -0.999).length, 1);
  }
  assert.equal(findLadderJoin(ray, combined), null, 'Joined sides must not accept duplicate ladders');

  useStore.setState({ parts: scene, groups: [{ id: 'slide', name: SLIDE_ACCESSORY.name, memberIds: scene.map(part => part.id), childGroupIds: [] }] });
  useStore.getState().addPresetGroup({ ...LADDER_ACCESSORY, parts: fit.additions }, [0, 0, 0], fit);
  assert.equal(useStore.getState().groups.at(-1)?.childGroupIds[0], 'slide');
  useStore.getState().undo();
  assert.equal(useStore.getState().groups.length, 1);
  assert.equal(JSON.stringify(useStore.getState().parts), JSON.stringify(scene));
  useStore.getState().redo();
  assert.equal(useStore.getState().parts.length, combined.length);
}
console.log('PASS: rotated merges on both sides, connected rung ports, duplicate rejection, and atomic undo/redo');
