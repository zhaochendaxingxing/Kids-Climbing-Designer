import * as THREE from 'three';
import { COMBO_45L, PLATE_THICKNESS, SLIDE_STRAP_RAIL_SPACING, getPartById } from './parts';
import { findOptimizedConnector, ports } from '../lib/construction';
import type { PlacedPart, PresetUnit } from '../types/parts';

type Point = PlacedPart['position'];

function productBuilder(id: string) {
  const parts: PlacedPart[] = [];
  const subgroups: NonNullable<PresetUnit['subgroups']> = [];
  const joints = new Map<string, { center: Point; directions: THREE.Vector3[] }>();
  const ground = 2.5;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const front = new THREE.Vector3(0, 0, 1);
  const euler = (q: THREE.Quaternion): Point => {
    const rotation = new THREE.Euler().setFromQuaternion(q);
    return [rotation.x, rotation.y, rotation.z];
  };
  const add = (partId: string, position: Point, colorId: string, rotation: Point = [0, 0, 0]) => {
    parts.push({ id: `${id}-${parts.length}`, partId, position: [position[0], position[1] + ground, position[2]], rotation, colorId });
  };
  const joint = (center: Point, direction: THREE.Vector3) => {
    const key = center.map(value => Math.round(value * 1e6)).join(',');
    if (!joints.has(key)) joints.set(key, { center, directions: [] });
    joints.get(key)!.directions.push(direction);
  };
  // Standard connectors seat each bar 2.5 cm from the joint center.
  const shoulder = getPartById('connector-v6')!.connectionPoints![0].position[0];
  const pipe = (from: Point, to: Point, color: string, connectFrom = true, connectTo = true) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a).normalize();
    const length = a.distanceTo(b) - shoulder * (Number(connectFrom) + Number(connectTo));
    add(`bar-${Math.round(length)}`, a.clone().addScaledVector(axis, length / 2 + (connectFrom ? shoulder : 0)).toArray(), color,
      euler(new THREE.Quaternion().setFromUnitVectors(xAxis, axis)));
    if (connectFrom) joint(from, axis);
    if (connectTo) joint(to, axis.clone().negate());
  };
  const panel = (partId: string, center: Point, widthAxis: THREE.Vector3, normal: THREE.Vector3, color: string, offset = 0) => {
    const basis = new THREE.Matrix4().makeBasis(widthAxis, normal, widthAxis.clone().cross(normal));
    const rotation = new THREE.Euler().setFromRotationMatrix(basis);
    add(partId, new THREE.Vector3(...center).addScaledVector(normal, offset).toArray(), color, [rotation.x, rotation.y, rotation.z]);
  };
  const finish = () => {
    for (const { center, directions } of joints.values()) {
      const match = findOptimizedConnector(directions);
      const rotation = match?.euler;
      add(match?.partId ?? 'connector-v6', center, 'black', rotation ? [rotation.x, rotation.y, rotation.z] : undefined);
    }
    return { parts, subgroups };
  };
  return { parts, subgroups, shoulder, xAxis, up, front, euler, add, joint, pipe, panel, finish };
}

function addGable(builder: ReturnType<typeof productBuilder>, towerLeft: number, back: number, railHeight: number) {
  const { add, euler, joint, parts, pipe, shoulder, subgroups, up } = builder;
  const towerRight = towerLeft + 40;
  const towerCenter = towerLeft + 20;
  const eaveHeight = railHeight + 40;
  // Fit the existing 45°L pair at each eave, then use its actual slope port
  // to install the rafters and identify the ridge joint.
  const elbow = COMBO_45L.parts.find(part => part.partId === 'connector-l')!;
  const rafterLength = getPartById('bar-35')!.barSpec!.length;
  const ridge: Point[] = [];
  for (const z of [back, back + 40]) {
    for (const x of [towerLeft, towerRight]) {
      const left = x === towerLeft;
      add('bar-35', [x, (railHeight + eaveHeight) / 2, z], left === (z === 0) ? 'graphite' : 'mint', [0, 0, Math.PI / 2]);
      joint([x, railHeight, z], up);
      const yaw = new THREE.Quaternion().setFromAxisAngle(up, left ? 0 : Math.PI);
      const base = new THREE.Vector3(x, eaveHeight, z);
      const comboStart = parts.length;
      const combo = COMBO_45L.parts.map(part => {
        const center = new THREE.Vector3(...part.position).sub(new THREE.Vector3(...elbow.position)).applyQuaternion(yaw).add(base);
        const turn = yaw.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)));
        const placed = { ...part, position: center.toArray(), rotation: euler(turn) };
        add(placed.partId, placed.position, placed.colorId, placed.rotation);
        return placed;
      });
      subgroups.push({ name: COMBO_45L.name, memberIds: parts.slice(comboStart).map(part => part.id) });
      const slope = ports(combo).find(port => port.cpId === 'up45')!;
      const peak = slope.position.clone().addScaledVector(slope.direction, rafterLength + shoulder);
      peak.x = towerCenter;
      peak.z = z;
      pipe(slope.position.toArray(), peak.toArray(), left ? 'graphite' : 'mint', false);
      if (left) ridge.push(peak.toArray());
    }
  }
  pipe(ridge[0], ridge[1], 'pine');
  return ridge[0][1];
}

const SLIDE_DECK_HEIGHT = 40;
export const SLIDE_RAIL_HEIGHT = SLIDE_DECK_HEIGHT + 2.5;
export const SLIDE_RUN = Math.sqrt(80 ** 2 - SLIDE_DECK_HEIGHT ** 2);

function addTwoSectionSlide(builder: ReturnType<typeof productBuilder>, towerLeft: number) {
  const { add, pipe, panel, xAxis } = builder;
  const span = 40;
  const deckHeight = SLIDE_DECK_HEIGHT;
  const towerRight = towerLeft + span;
  const towerCenter = towerLeft + span / 2;
  const square = 'platform-39.5x39.5';
  const seating = getPartById('bar-35')!.barSpec!.outerDiameter / 2 + PLATE_THICKNESS / 2 - 0.2;
  // Two square slide panels run under a second pair of rails. Short
  // stanchions along the normal raise the grips at the top, seam and foot.
  const run = SLIDE_RUN;
  const railZ = SLIDE_STRAP_RAIL_SPACING;
  const down = new THREE.Vector3(0, -deckHeight, run).normalize();
  const rampNormal = xAxis.clone().cross(down).negate();
  const gripRise = 20;
  const rampCorner = (x: number, row: number): Point => [x, deckHeight * (1 - row / 2), railZ + row * run / 2];
  const grip = (x: number, row: number): Point =>
    new THREE.Vector3(...rampCorner(x, row)).addScaledVector(rampNormal, gripRise).toArray();
  for (let row = 0; row <= 2; row++) {
    pipe(rampCorner(towerLeft, row), rampCorner(towerRight, row), row === 2 ? 'pine' : 'white');
    for (const x of [towerLeft, towerRight]) {
      pipe(rampCorner(x, row), grip(x, row), x === towerLeft ? 'pine' : 'graphite');
    }
    if (row === 2) break;
    for (const x of [towerLeft, towerRight]) {
      pipe(rampCorner(x, row), rampCorner(x, row + 1), x === towerLeft ? 'graphite' : 'mint');
      pipe(grip(x, row), grip(x, row + 1), (row === 0) === (x === towerLeft) ? 'pine' : 'mint');
    }
    panel(square, rampCorner(towerCenter, row + 0.5), down, rampNormal, row === 0 ? 'white' : 'pine', seating);
  }
  for (const x of [towerLeft + 8, towerRight - 8]) add('connector-slide-strap', [x, deckHeight, railZ / 2], 'black');

}

function buildRoofSlide(): Pick<PresetUnit, 'parts' | 'subgroups'> {
  const builder = productBuilder('roof-slide');
  const { xAxis, up, front, pipe, panel, finish } = builder;
  const span = 40;
  const deckHeight = 40;
  const railHeight = 80;
  const towerLeft = 40;
  const towerRight = towerLeft + span;
  const towerCenter = (towerLeft + towerRight) / 2;
  const square = 'platform-39.5x39.5';
  const half = 'platform-39.5x19.5';
  const seating = getPartById('bar-35')!.barSpec!.outerDiameter / 2 + PLATE_THICKNESS / 2 - 0.2;

  // Three adjacent deck bays share their crossbars. The single lower step
  // projects in front of the left bay, with the roof at the opposite end.
  const columns = [-40, 0, towerLeft, towerRight];
  for (const y of [0, deckHeight]) {
    for (const [index, x] of columns.entries()) {
      pipe([x, y, -span], [x, y, 0], index % 2 ? 'white' : 'mint');
      if (index < columns.length - 1) {
        pipe([x, y, -span], [x + span, y, -span], index === 0 ? 'pine' : 'graphite');
        pipe([x, y, 0], [x + span, y, 0], index === 0 ? 'mint' : 'pine');
      }
    }
  }
  for (const y of [0, 20]) {
    pipe([-40, y, 0], [-40, y, span], 'pine');
    pipe([0, y, 0], [0, y, span], 'mint');
    pipe([-40, y, span], [0, y, span], 'pine');
  }
  pipe([-40, 20, 0], [0, 20, 0], 'mint');
  for (const x of [-40, 0]) {
    pipe([x, 0, 0], [x, 20, 0], 'mint');
    pipe([x, 20, 0], [x, deckHeight, 0], 'white');
    pipe([x, 0, span], [x, 20, span], x === 0 ? 'pine' : 'mint');
    pipe([x, 20, span], [x, 60, span], x === 0 ? 'mint' : 'graphite');
    pipe([x, deckHeight, 0], [x, 60, 0], x === 0 ? 'pine' : 'white');
    pipe([x, 60, span], [x, 60, 0], x === 0 ? 'white' : 'mint');
    pipe([x, 60, 0], [x, railHeight, 0], x === 0 ? 'pine' : 'white');
  }
  for (const [index, x] of columns.entries()) {
    pipe([x, 0, -span], [x, deckHeight, -span], index % 2 ? 'graphite' : 'mint');
    pipe([x, deckHeight, -span], [x, railHeight, -span], index % 2 ? 'white' : 'mint');
    if (index < columns.length - 1) {
      pipe([x, railHeight, -span], [x + span, railHeight, -span], index === 2 ? 'graphite' : 'mint');
    }
  }
  for (const x of [towerLeft, towerRight]) {
    pipe([x, 0, 0], [x, deckHeight, 0], 'mint');
    pipe([x, deckHeight, 0], [x, railHeight, 0], x === towerLeft ? 'mint' : 'white');
  }
  pipe([towerRight, railHeight, 0], [towerRight, railHeight, -span], 'mint');
  pipe([-40, railHeight, 0], [-40, railHeight, -span], 'pine');
  pipe([0, railHeight, 0], [towerLeft, railHeight, 0], 'mint');
  // The front stays open over both the step and the chute entrance.
  panel(square, [-20, 20, 20], xAxis, up, 'white', seating);
  panel(square, [-20, deckHeight, -20], xAxis, up, 'pine', seating);
  panel(square, [20, deckHeight, -20], xAxis, up, 'white', seating);
  panel(square, [towerCenter, deckHeight, -20], xAxis, up, 'graphite', seating);
  panel(half, [-20, 10, 40], xAxis, front, 'mint');
  panel(half, [0, 10, 20], front, xAxis, 'white');
  const leftNormal = xAxis.clone().negate();
  panel(square, [-40, deckHeight / 2, -span / 2], front, leftNormal, 'mint');
  panel(half, [-40, 10, span / 2], front, leftNormal, 'mint');
  panel(square, [towerRight, 20, -20], front, xAxis, 'pine');

  const ridgeY = addGable(builder, towerLeft, -span, railHeight);
  for (const sign of [-1, 1]) {
    const away = new THREE.Vector3(sign, -1, 0).normalize();
    const normal = new THREE.Vector3(sign, 1, 0).normalize();
    const center = new THREE.Vector3(towerCenter, ridgeY, -20).addScaledVector(away, 20 - seating);
    panel(square, center.toArray(), away, normal, sign < 0 ? 'mint' : 'pine', seating);
  }

  addTwoSectionSlide(builder, towerLeft);
  return finish();
}

export const ROOF_SLIDE_PRODUCT: PresetUnit = {
  id: 'product-roof-slide',
  name: '双坡小屋滑梯架',
  category: '成品产品',
  description: '三格平台，左侧踏台，右侧双坡小屋与带扶手的双段滑梯。',
  ...buildRoofSlide(),
};

const SQUARE = 'platform-39.5x39.5';
const SMALL_DECK = 2.1;
const FINISHES = ['mint', 'pine', 'white', 'graphite'];

function smallFrame(id: string) {
  const builder = productBuilder(id);
  const edges = new Set<string>();
  const edge = (a: Point, b: Point, color = FINISHES[edges.size % FINISHES.length]) => {
    const key = [a.join(','), b.join(',')].sort().join('/');
    if (edges.has(key)) return;
    edges.add(key);
    builder.pipe(a, b, color);
  };
  const perimeter = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    for (let x = x0; x < x1; x += 40) {
      edge([x, y, z0], [x + 40, y, z0]);
      edge([x, y, z1], [x + 40, y, z1]);
    }
    for (let z = z0; z < z1; z += 40) {
      edge([x0, y, z], [x0, y, z + 40]);
      edge([x1, y, z], [x1, y, z + 40]);
    }
  };
  const post = (x: number, z: number, levels: number[]) => {
    levels.slice(1).forEach((y, i) => edge([x, levels[i], z], [x, y, z]));
  };
  const deck = (x: number, y: number, z: number, color = 'mint') =>
    builder.panel(SQUARE, [x, y, z], builder.xAxis, builder.up, color, SMALL_DECK);
  return { ...builder, edge, perimeter, post, deck };
}

function addRamp(b: ReturnType<typeof smallFrame>, x: number, entry: number, height: number, sections: number,
  kind: 'slide' | 'net' | 'ladder', sharedLadder = false) {
  const { xAxis, edge, panel, add } = b;
  const axis = new THREE.Vector3(0, -height, Math.sqrt((40 * sections) ** 2 - height ** 2)).normalize();
  const normal = axis.clone().cross(xAxis);
  const gripSections = sections === 3 ? 2 : sections;
  const point = (side: number, row: number, rise = 0): Point => new THREE.Vector3(side, height, entry + SLIDE_STRAP_RAIL_SPACING)
    .addScaledVector(axis, row * 40).addScaledVector(normal, rise).toArray();
  for (let row = 0; row <= sections; row++) {
    edge(point(x, row), point(x + 40, row), row === sections ? 'mint' : 'graphite');
    if (kind === 'slide' && row <= gripSections) {
      for (const side of [x, x + 40]) edge(point(side, row), point(side, row, 20), 'graphite');
    }
    if (row === sections) break;
    for (const side of [x, x + 40]) {
      if (sharedLadder && side === x) {
        edge(point(side, row), point(side, row + 0.5), 'mint');
        edge(point(side, row + 0.5), point(side, row + 1), 'mint');
      } else {
        edge(point(side, row), point(side, row + 1), 'mint');
      }
      if (kind === 'slide' && row < gripSections) edge(point(side, row, 20), point(side, row + 1, 20), row % 2 ? 'white' : 'pine');
    }
    if (kind !== 'ladder') {
      panel(kind === 'slide' ? SQUARE : 'ext-plate-ropenet', point(x + 20, row + 0.5), xAxis, normal,
        kind === 'net' ? 'white' : sections === 2 ? (row ? 'mint' : 'white') : (row % 2 ? 'white' : 'pine'),
        kind === 'net' ? 0 : SMALL_DECK);
    }
  }
  for (const side of [x + 8, x + 32]) add('connector-slide-strap', [side, height, entry + SLIDE_STRAP_RAIL_SPACING / 2], 'black');

  if (sharedLadder) addFiveRungLadder(b, x - 30, true);
}

function addFiveRungLadder(builder: ReturnType<typeof productBuilder>, left: number, sharedRight = false) {
  const right = left + 30;
  const corner = (x: number, index: number): Point =>
    [x, SLIDE_DECK_HEIGHT * (1 - index / 4), SLIDE_STRAP_RAIL_SPACING + SLIDE_RUN * index / 4];
  for (let index = 0; index <= 4; index++) {
    builder.pipe(corner(left, index), corner(right, index), index % 2 ? 'graphite' : 'mint');
    if (index === 4) continue;
    builder.pipe(corner(left, index), corner(left, index + 1), 'mint');
    if (!sharedRight) builder.pipe(corner(right, index), corner(right, index + 1), 'mint');
  }
  for (const x of [left + 6, right - 6]) {
    builder.add('connector-slide-strap', [x, SLIDE_DECK_HEIGHT, SLIDE_STRAP_RAIL_SPACING / 2], 'black');
  }
}

function addTrampoline(b: ReturnType<typeof smallFrame>, x: number, openSide: 'front' | 'right') {
  const { add, edge, perimeter, post } = b;
  for (const y of [0, 40]) perimeter(x, x + 80, -80, 0, y);
  for (const dx of [0, 40, 80]) {
    post(x + dx, -80, [0, 40, 80]);
    const meetsBridge = openSide === 'front' ? dx >= 40 : dx === 80;
    post(x + dx, 0, meetsBridge ? [0, 20, 40, 60] : [0, 40]);
    edge([x + dx, 0, -80], [x + dx, 0, -40]);
    edge([x + dx, 0, -40], [x + dx, 0, 0]);
    if (dx < 80) edge([x + dx, 80, -80], [x + dx + 40, 80, -80]);
  }
  for (const side of [x, x + 80]) {
    const endsAtFront = openSide === 'right' || side === x + 80;
    const besideBridge = openSide === 'right' && side === x + 80;
    post(side, -40, besideBridge ? [0, 20, 40, 60] : [0, 40, 80]);
    if (endsAtFront && !besideBridge) post(side, 0, openSide === 'front' ? [60, 80] : [40, 80]);
    if (openSide === 'right' && side === x + 80) continue;
    edge([side, 80, -80], [side, 80, -40]);
    if (endsAtFront) edge([side, 80, -40], [side, 80, 0]);
  }
  add('platform-trampoline-80', [x + 40, 40, -40], 'graphite');
}

function addBridgeBay(b: ReturnType<typeof smallFrame>, x: number, z: number) {
  const { edge, post } = b;
  for (const side of [x, x + 40]) {
    edge([side, 0, z], [side, 0, z + 40]);
    for (const y of [20, 60]) edge([side, y, z], [side, y, z + 40]);
    post(side, z, [0, 20, 40, 60]);
    post(side, z + 40, [0, 20, 40, 60]);
  }
  edge([x, 0, z], [x + 40, 0, z]);
  edge([x, 0, z + 40], [x + 40, 0, z + 40]);
}

export const BRIDGE_RAIL_HEIGHT = 62.5;
export const BRIDGE_ROPE_DROP = 40;

function addSuspendedBridge(builder: ReturnType<typeof productBuilder>, x: number, z: number) {
  const { add, panel, pipe, front, up } = builder;
  const deck = 20;
  for (const end of [-40, 0, 40]) {
    pipe([x - 10, deck, z + end], [x + 10, deck, z + end], 'mint');
  }
  for (const side of [-1, 1]) {
    for (const end of [-40, 0]) {
      pipe([x + side * 10, deck, z + end], [x + side * 10, deck, z + end + 40], 'pine');
    }
    for (const station of [-31, -9, 9, 31]) {
      add('connector-bridge-rope', [x + side * 15, deck + BRIDGE_ROPE_DROP / 2, z + station],
        'black', [0, side < 0 ? Math.PI : 0, 0]);
    }
  }
  for (const bay of [-20, 20]) {
    panel('platform-39.5x19.5', [x, deck, z + bay], front, up, 'mint', SMALL_DECK);
  }
}

function smallOne() {
  const b = smallFrame('small-01');
  addTrampoline(b, 0, 'right');
  addRamp(b, -5.5, 0, 40, 2, 'ladder');
  // The adjacent lane has the white climbing net visible in the reference.
  addRamp(b, 34.5, 0, 40, 2, 'net');
  addBridgeBay(b, 80, -40);
  addBridgeBay(b, 80, 0);
  addSuspendedBridge(b, 100, 0);
  const { perimeter, edge, post, deck } = b;
  for (const y of [0, 40]) perimeter(80, 120, -80, -40, y);
  for (const x of [80, 120]) {
    if (x === 120) post(x, -80, [0, 40, 80]);
    post(x, -40, [60, 80]);
  }
  edge([120, 80, -80], [120, 80, -40]);
  edge([80, 80, -80], [80, 80, -40]);
  edge([80, 80, -80], [120, 80, -80]);
  deck(100, 40, -60);
  return b.finish();
}

function smallTwo() {
  const b = smallFrame('small-02');
  const { deck, edge, perimeter, post } = b;
  addTrampoline(b, 40, 'front');
  for (const y of [0, 40, 80]) perimeter(0, 40, -80, -40, y);
  for (const x of [0, 40]) {
    for (const z of [-80, -40]) {
      if (x === 0) post(x, z, [0, 40, 80, 120]);
      else post(x, z, [80, 120]);
    }
    edge([x, 120, -80], [x, 120, -40]);
  }
  edge([0, 120, -80], [40, 120, -80]);
  edge([0, 120, -40], [40, 120, -40]);
  deck(20, 80, -60, 'mint');
  addGable(b, 0, -80, 120);
  addRamp(b, -5.5, -40, 80, 3, 'slide');
  addBridgeBay(b, 80, 0);
  addBridgeBay(b, 80, 40);
  addSuspendedBridge(b, 100, 40);

  // The middle approach has its own low deck and three-rung ladder.
  for (const y of [0, 20]) perimeter(40, 80, 40, 80, y);
  for (const z of [40, 80]) post(40, z, [0, 20]);
  deck(60, 20, 60, 'mint');
  // Keep the two 20 cm rail spans and locate the foot one strap-spacing
  // from the step's crossbar. The two circles meet below the step.
  const start = new THREE.Vector2(SLIDE_STRAP_RAIL_SPACING, 40);
  const stepRail = new THREE.Vector2(40, 20);
  const axis = stepRail.clone().sub(start);
  const distance = axis.length();
  axis.normalize();
  const along = (40 ** 2 - SLIDE_STRAP_RAIL_SPACING ** 2 + distance ** 2) / (2 * distance);
  const offset = Math.sqrt(40 ** 2 - along ** 2);
  const foot = start.clone().addScaledVector(axis, along).addScaledVector(new THREE.Vector2(axis.y, -axis.x), offset);
  const approach = (x: number, row: number): Point =>
    [x, THREE.MathUtils.lerp(start.y, foot.y, row / 2), THREE.MathUtils.lerp(start.x, foot.x, row / 2)];
  for (let row = 0; row <= 2; row++) {
    edge(approach(45, row), approach(75, row), row === 1 ? 'white' : 'mint');
    if (row < 2) for (const x of [45, 75]) edge(approach(x, row), approach(x, row + 1), 'graphite');
  }
  for (const x of [48, 72]) b.add('connector-slide-strap', [x, 40, SLIDE_STRAP_RAIL_SPACING / 2], 'black');
  const strapCenter = foot.clone().lerp(stepRail, 0.5);
  const strapRoll = Math.atan2(foot.y - stepRail.y, stepRail.x - foot.x);
  for (const x of [51, 69]) b.add('connector-slide-strap', [x, strapCenter.y, strapCenter.x], 'black', [strapRoll, 0, 0]);
  return b.finish();
}

function smallThree() {
  const b = smallFrame('small-03');
  const { xAxis, front, edge, perimeter, post, deck, panel } = b;
  for (const y of [0, 40]) {
    perimeter(0, 120, -40, 0, y);
    for (const x of [40, 80]) edge([x, y, -40], [x, y, 0]);
  }
  const columns = [0, 40, 80, 120];
  columns.forEach((x, i) => {
    post(x, -40, [0, 40, 80]);
    post(x, 0, x <= 40 ? [0, 20, 40, 60, 80] : [0, 40, 80]);
    if (i === 3) return;
    edge([x, 80, -40], [x + 40, 80, -40]);
    deck(x + 20, 40, -20, ['mint', 'white', 'graphite'][i]);
    panel(i === 1 ? 'ext-plate-ninehole' : 'ext-plate-honeycomb', [x + 20, 60, -40], xAxis, front, 'mint');
  });
  edge([0, 80, -40], [0, 80, 0]);
  edge([120, 80, -40], [120, 80, 0]);
  panel('ext-plate-capsule', [0, 60, -20], front, xAxis.clone().negate(), 'white');
  perimeter(0, 40, 0, 40, 0);
  perimeter(0, 40, 0, 40, 20);
  for (const x of [0, 40]) {
    post(x, 40, [0, 20, 60]);
    edge([x, 60, 0], [x, 60, 40]);
  }
  deck(20, 20, 20, 'pine');
  // The steering-wheel tube replaces the front crossbar of the middle bay.
  b.add('ext-bar-wheel', [60, 80, 0], 'white', [-Math.PI / 4, 0, 0]);
  b.joint([40, 80, 0], xAxis);
  b.joint([80, 80, 0], xAxis.clone().negate());
  addRamp(b, 80, 0, 40, 2, 'slide', true);
  return b.finish();
}

export const FINISHED_PRODUCTS = [
  { ...ROOF_SLIDE_PRODUCT, thumbnail: '/products/roof-slide.png' },
  { id: 'product-small-01', name: '小户型01 · 小月龄A', description: '双格蹦床、攀爬网、双跨悬索桥和台阶。', thumbnail: '/products/small-01.png', ...smallOne() },
  { id: 'product-small-02', name: '小户型02 · 小户型A', description: '双坡屋架、三段滑梯、蹦床、双跨吊桥和小爬梯。', thumbnail: '/products/small-02.png', ...smallTwo() },
  { id: 'product-small-03', name: '小户型03 · 小户型C', description: '踏台、梯道、滑梯、方向盘和组合围板。', thumbnail: '/products/small-03.png', ...smallThree() },
];

const slideBuilder = productBuilder('slide-accessory');
addTwoSectionSlide(slideBuilder, -20);
export const SLIDE_ACCESSORY = {
  id: 'special-two-section-slide',
  name: '双段滑梯',
  category: '特殊扩展配件',
  description: '自动吸附到水平杆件',
  directPlacement: 'slide-edge',
  ...slideBuilder.finish(),
} satisfies PresetUnit;

const ladderBuilder = productBuilder('ladder-accessory');
addFiveRungLadder(ladderBuilder, -15);
export const LADDER_ACCESSORY = {
  id: 'special-five-rung-ladder',
  name: '五横杆爬梯',
  category: '特殊扩展配件',
  description: '吸附到水平杆，或与滑梯共用侧杆',
  directPlacement: 'ladder-edge',
  ...ladderBuilder.finish(),
} satisfies PresetUnit;

const bridgeBuilder = productBuilder('bridge-accessory');
addSuspendedBridge(bridgeBuilder, 0, 0);
export const BRIDGE_ACCESSORY = {
  id: 'special-suspended-bridge',
  name: '双跨吊桥',
  category: '特殊扩展配件',
  description: '两块长平台板，吊挂在两侧扶手上',
  directPlacement: 'bridge-bay',
  ...bridgeBuilder.finish(),
} satisfies PresetUnit;
