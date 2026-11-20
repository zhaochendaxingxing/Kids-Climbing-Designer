import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COMBO_45L, getPartById, NEST_COMBO_SOCKET_LENGTH, NEST_SLOPE_SHOULDER } from '../src/data/parts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);
const [angle, elbow] = COMBO_45L.parts;
const angleDef = getPartById(angle.partId)!;
const world = (part: typeof angle, cpId: string) => {
  const cp = getPartById(part.partId)!.connectionPoints!.find(p => p.id === cpId)!;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation));
  return { position: new THREE.Vector3(...cp.position).applyQuaternion(q).add(new THREE.Vector3(...part.position)), direction: new THREE.Vector3(...cp.direction).applyQuaternion(q) };
};
const mouth = world(angle, 'x+');
const inserted = world(elbow, 'x+');
close(mouth.position.distanceTo(inserted.position), 0);
close(mouth.direction.dot(inserted.direction), -1);
close((elbow.position[0] - angle.position[0]) * 10, 118.19805523);
close(NEST_COMBO_SOCKET_LENGTH * 10, 68.19805523);
close(NEST_SLOPE_SHOULDER * 10, 75);
close(angleDef.connectorSpec!.socketLength * 10, 50);
const slope = world(angle, 'up45');
close(slope.direction.y, Math.SQRT1_2);
close(world(elbow, 'y+').direction.y, -1);
// 350mm斜杆 + 顶部25mm肩距，扣除檐口组合的内收，立杆半跨度200mm。
const inset = elbow.position[0] - slope.position.x;
close(((35 + 2.5) * Math.SQRT1_2 - inset) * 10, 200);
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  close(mouth.position.clone().applyQuaternion(q).distanceTo(inserted.position.clone().applyQuaternion(q)), 0);
  close(slope.direction.clone().applyQuaternion(q).y, Math.SQRT1_2);
}
console.log('PASS: SketchUp尺寸、嵌套端口、400mm屋顶跨度与四向旋转');
