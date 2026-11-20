import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COMBO_45L } from '../src/data/parts';
import type { PlacedPart } from '../src/types/parts';
import { ports, fitRoofCombo, endpointConnector, bodyIntersects, orientRoofCombo } from '../src/lib/construction';
const part = (id: string, partId: string, position: [number, number, number], rotation: [number, number, number] = [0,0,0]): PlacedPart => ({ id, partId, position, rotation, colorId: 'black' });
const close = (a: number, b: number) => assert.ok(Math.abs(a-b)<0.001, `${a} != ${b}`);
const elbow = COMBO_45L.parts[1];
const old = part('old','connector-v6', [...elbow.position]);
const vertical = part('vertical','bar-35',[elbow.position[0],elbow.position[1]-20,0],[0,0,Math.PI/2]);
const guide = part('guide','bar-35',[50,0,0]);
const result = fitRoofCombo(COMBO_45L.parts,[old,vertical,guide],old);
assert.ok(result, 'Vertical anchor must admit a valid replacement');
const slope = ports(result).find(cp=>cp.cpId==='up45')!;
assert.ok(slope.direction.x>0.7,'Slope points into the frame');
const down = ports(result).find(cp=>cp.cpId==='y+')!;
close(down.direction.y,-1);
const rodTop = ports([vertical]).find(cp=>cp.direction.y>0.9)!;
close(down.position.distanceTo(rodTop.position),0);
for(const direction of [new THREE.Vector3(1,1,0).normalize(),new THREE.Vector3(-1,1,0).normalize(),new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,1).normalize()]) {
  const target = {...rodTop, direction, position:new THREE.Vector3(0,20,0)};
  const endpoint = endpointConnector(target, part('six','connector-v6',[0,0,0]));
  const cps = ports([endpoint]);
  assert.ok(cps.some(cp=>cp.direction.dot(direction)<-0.999 && cp.position.distanceTo(target.position)<0.001));
  if(Math.abs(direction.y)<0.999) {
    const depth = new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(...endpoint.rotation));
    close(depth.y,0); // Roof-plane normal never rolls out of horizontal.
  }
}
const horizontal = part('horizontal','bar-35',[old.position[0]+20,old.position[1],0]);
const depth = part('depth','bar-35',[old.position[0],old.position[1],20],[0,-Math.PI/2,0]);
assert.equal(fitRoofCombo(COMBO_45L.parts,[old,vertical,horizontal,depth],old),null,'Cannot silently disconnect a three-rod junction');
assert.ok(bodyIntersects(COMBO_45L.parts,[part('obstacle','bar-35',[0,3.2,0])]));
const occupied = part('occupied','connector-v6',old.position);
assert.equal(fitRoofCombo(COMBO_45L.parts,[occupied,vertical]),null,'Occupied endpoints cannot be reused');
console.log('PASS: inward orientation, exact anchors, stable endpoint roll, incompatible junctions, body intersection and occupied ports');

for (const heading of [0, Math.PI/4, Math.PI/2, Math.PI, -Math.PI/2]) {
  const rotated = orientRoofCombo(result, [...result, vertical, guide], heading);
  assert.ok(rotated.parts, rotated.error);
  const rotatedPorts = ports(rotated.parts);
  const hinge = rotatedPorts.find(cp=>cp.cpId==='y+')!;
  close(hinge.position.distanceTo(down.position),0);
  close(hinge.direction.y,-1);
  const slopePort = rotatedPorts.find(cp=>cp.cpId==='up45')!;
  close(slopePort.direction.x, Math.cos(heading)*Math.SQRT1_2);
  close(slopePort.direction.z, Math.sin(heading)*Math.SQRT1_2);
  close(slopePort.direction.y, Math.SQRT1_2);
  close(new THREE.Vector3(...rotated.parts[0].position).distanceTo(new THREE.Vector3(...rotated.parts[1].position)),11.819805523);
}
const rodCenter = slope.position.clone().addScaledVector(slope.direction,17.5);
const rodEuler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),slope.direction));
const attached = part('attached','bar-35',rodCenter.toArray() as [number,number,number],[rodEuler.x,rodEuler.y,rodEuler.z]);
assert.ok(orientRoofCombo(result,[...result,vertical,attached],Math.PI).error,'Do not silently detach an attached slope rod');
assert.ok(orientRoofCombo(result,[...result,vertical],0).parts,'The current heading is valid');
console.log('PASS: fixed post axis, five headings, rigid nesting, and connected slope protection');
