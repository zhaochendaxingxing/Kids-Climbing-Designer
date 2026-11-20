import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FACE_SIZE = 768;
const palette = ['#28acc2', '#2c8247', '#76b957', '#ef5751', '#e7a24b', '#8b62a0', '#4c84c7', '#dc5784'];
// Viewed from +Y, the art reads left-to-right along -X, with +Z at the top.
const faceCoordinate = (value: number) => (50 - value) * 0.3;

function canvasLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = FACE_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(FACE_SIZE / 100, FACE_SIZE / 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { ctx, texture };
}

function drawWood(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, 100, 82);
  gradient.addColorStop(0, '#f3d9a6');
  gradient.addColorStop(0.5, '#e9c791');
  gradient.addColorStop(1, '#f3daad');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 100, 100);
  for (let i = 0; i < 210; i++) {
    const x = i * 0.48;
    ctx.strokeStyle = i % 4 ? '#a9643020' : '#fff5d954';
    ctx.lineWidth = i % 3 === 0 ? 0.15 : 0.07;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 2 * Math.sin(i), 29, x - 3 * Math.cos(i), 68, x + Math.sin(i * 0.7), 100);
    ctx.stroke();
  }
}

function drawArtwork(ctx: CanvasRenderingContext2D) {
  for (const [x, y, angle] of [[5, 7, -0.6], [41, 2, 1], [95, 38, -1], [5, 53, -0.8], [96, 73, 0.4], [16, 97, 0.6], [74, 98, -0.7]]) {
    ctx.fillStyle = '#a9c659';
    ctx.beginPath();
    ctx.ellipse(x, y, 3.2, 7, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffb243';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(79 + 15 * Math.cos(a), 15 + 15 * Math.sin(a));
    ctx.lineTo(79 + 9.4 * Math.cos(a - 0.29), 15 + 9.4 * Math.sin(a - 0.29));
    ctx.lineTo(79 + 9.4 * Math.cos(a + 0.29), 15 + 9.4 * Math.sin(a + 0.29));
    ctx.fill();
  }
  ctx.fillStyle = '#f68f42';
  ctx.beginPath();
  ctx.arc(79, 15, 10.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#784328';
  ctx.lineWidth = 0.65;
  for (const x of [75, 83]) {
    ctx.beginPath();
    ctx.arc(x, 14.7, 1.2, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#81372b';
  ctx.beginPath();
  ctx.ellipse(79, 17.6, 2.8, 1.7, 0, 0, Math.PI);
  ctx.fill();
  for (const [x, y, body] of [[8, 26, '#c69230'], [55, 10, '#e8604f'], [39, 97, '#e8604f']] as const) {
    ctx.fillStyle = '#f4ead3';
    for (const wing of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + wing * 1.4, y - 1.7, 1.5, 1, wing, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.8, 2.2, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
}

export function buildMazeFace(group: THREE.Group, base: THREE.MeshStandardMaterial) {
  const wood = base.clone();
  wood.color.set('#e5bc82');
  const face = canvasLayer();
  const labels = canvasLayer();
  drawWood(face.ctx);
  drawArtwork(face.ctx);
  const columns = Array.from({ length: 9 }, (_, i) => 13 + i * 8.8);
  const tracks = [[12, 19, 56, 19], [20, 11, 20, 31], [12, 32, 85, 32], [12, 59, 88, 59]];
  for (const x of columns) tracks.push([x, 32, x, 53], [x, 59, x, 91]);
  face.ctx.lineCap = 'round';
  for (const [width, color, shift] of [[2, '#fff0c1', 0.33], [1.72, '#765034', 0], [0.82, '#483223', 0.06]] as const) {
    face.ctx.strokeStyle = color;
    face.ctx.lineWidth = width;
    face.ctx.beginPath();
    for (const [x1, y1, x2, y2] of tracks) {
      face.ctx.moveTo(x1 + shift, y1 + shift);
      face.ctx.lineTo(x2 + shift, y2 + shift);
    }
    face.ctx.stroke();
  }
  const panel = new THREE.Mesh(new RoundedBoxGeometry(30.5, 0.95, 30.5, 3, 0.46), wood);
  panel.position.y = 1.04;
  panel.castShadow = panel.receiveShadow = true;
  group.add(panel);
  const addFace = (texture: THREE.Texture, y: number, alphaTest: number) => {
    const material = base.clone();
    material.color.set('#ffffff');
    material.map = texture;
    material.alphaTest = alphaTest;
    material.roughness = 0.85;
    const geometry = new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2).rotateY(Math.PI);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.receiveShadow = alphaTest === 0;
    group.add(mesh);
  };
  addFace(face.texture, 1.54, 0);

  const beads = new Map<string, THREE.BufferGeometry[]>();
  const bead = (x: number, y: number, color: string, text: string) => {
    const geometry = new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.34), new THREE.Vector2(0.74, -0.34), new THREE.Vector2(0.99, -0.1),
      new THREE.Vector2(0.98, 0.15), new THREE.Vector2(0.74, 0.39), new THREE.Vector2(0, 0.39),
    ], 16).translate(faceCoordinate(x), 1.82, faceCoordinate(y));
    const items = beads.get(color) ?? [];
    items.push(geometry);
    beads.set(color, items);
    labels.ctx.fillStyle = color === '#e5bc82' ? '#824235' : '#fffbea';
    labels.ctx.font = 'bold 3.5px Arial';
    labels.ctx.textAlign = 'center';
    labels.ctx.textBaseline = 'middle';
    labels.ctx.fillText(text, x, y + 0.05);
  };
  bead(54, 19, '#e5bc82', '=');
  bead(20, 11, '#f0ecd7', '');
  columns.forEach((x, i) => {
    bead(x, 42 - (i === 8 ? 4 : 0), palette[i % palette.length], String((i + 2) % 10));
    bead(x, 48, palette[(i * 2 + 3) % palette.length], String((i + 2) % 10));
  });
  for (let row = 0; row < 3; row++) {
    columns.slice(0, 7).forEach((x, i) => {
      bead(x, 77 + row * 6, palette[(i * 2 + row) % palette.length], i === 6 ? ['+', '×', '÷'][row] : String((i + row + 4) % 10));
    });
  }
  for (const [color, geometries] of beads) {
    const material = base.clone();
    material.color.set(color);
    material.roughness = 0.62;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = true;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  addFace(labels.texture, 2.23, 0.4);
}
