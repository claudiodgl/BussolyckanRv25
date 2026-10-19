/**
 * emergency-geometry.js — merged, vertex-coloured meshes for the response
 * fleet. Same conventions as vehicle-geometry.js: metres, +Z is
 * forward, Y up, origin at ground under the vehicle centre.
 *
 *   buildAmbulance()   Swedish yellow/green Battenburg box ambulance
 *   buildFireTruck()   red rescue engine with ladder
 *   buildPolice()      white/blue/yellow police estate car
 *   buildHelicopter()  red/white SAR helicopter (rotor built separately)
 *   buildRotor()       main rotor disc, spun per frame
 *   buildBeacon()      emissive blue light bar, flashed per frame
 *   buildDoubleDecker(hex)  Länstrafiken double-decker
 */
import * as THREE from 'three';
import { mergeColored, buildBusLen, setBusPalette } from './vehicle-geometry.js';

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return { geo: g, color };
}
function cyl(r, len, x, y, z, color, axis = 'x', seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  // Cylinder is indexed like BoxGeometry; normals present — mergeable.
  return { geo: g, color };
}
function wheels(parts, halfL, halfW, axles, r = 0.5) {
  for (const z of axles) for (const s of [-1, 1]) parts.push(cyl(r, 0.35, s * halfW, r, z, 0x111827));
}

const YELLOW = 0xfacc15, GREEN = 0x15803d, GLASS = 0x0f172a, DARK = 0x374151, WHITE = 0xf8fafc;

export function buildAmbulance() {
  const L = 6.6, hl = L / 2, p = [];
  p.push(box(2.3, 0.35, L, 0, 0.45, 0, DARK));                       // skirt
  p.push(box(2.25, 2.2, 4.4, 0, 1.75, -1.0, YELLOW));                // box body
  p.push(box(2.15, 1.5, 2.0, 0, 1.40, hl - 1.1, YELLOW));            // cab
  p.push(box(2.0, 0.6, 1.2, 0, 2.45, hl - 1.6, YELLOW));             // cab roof
  p.push(box(2.0, 0.75, 0.08, 0, 1.75, hl - 0.06, GLASS));           // windscreen
  for (const s of [-1, 1]) {
    p.push(box(0.06, 0.6, 1.0, s * 1.08, 1.75, hl - 1.2, GLASS));
    // Battenburg: alternating green/yellow checks along both sides
    for (let i = 0; i < 6; i++) {
      const z = -3.1 + i * 0.75;
      p.push(box(0.04, 0.42, 0.75, s * 1.14, 1.05, z + 0.37, i % 2 ? YELLOW : GREEN));
      p.push(box(0.04, 0.42, 0.75, s * 1.14, 1.47, z + 0.37, i % 2 ? GREEN : YELLOW));
    }
  }
  for (let i = 0; i < 3; i++) p.push(box(0.04 + 2.26, 0.42, 0.04, 0, 1.26, -3.22, i % 2 ? GREEN : YELLOW));
  p.push(box(0.5, 0.06, 1.6, 0, 2.88, -1.0, GREEN));                 // roof cross
  p.push(box(1.6, 0.06, 0.5, 0, 2.88, -1.0, GREEN));
  p.push(box(2.3, 0.3, 0.2, 0, 0.55, hl + 0.02, DARK));              // bumper
  for (const s of [-1, 1]) p.push(box(0.35, 0.2, 0.06, s * 0.75, 1.0, hl + 0.02, 0xfef3c7));
  wheels(p, hl, 1.05, [hl - 1.2, -hl + 1.1], 0.45);
  return mergeColored(p);
}

export function buildFireTruck() {
  const L = 9.0, hl = L / 2, p = [], RED = 0xb91c1c;
  p.push(box(2.5, 0.4, L, 0, 0.55, 0, DARK));
  p.push(box(2.5, 2.3, 2.4, 0, 1.9, hl - 1.2, RED));                 // crew cab
  p.push(box(2.3, 0.9, 0.08, 0, 2.35, hl - 0.02, GLASS));
  p.push(box(2.5, 2.6, 6.4, 0, 2.05, -1.25, RED));                   // body
  for (const s of [-1, 1]) {
    p.push(box(0.05, 0.22, 8.8, s * 1.26, 1.25, 0, WHITE));          // stripe
    p.push(box(0.05, 0.22, 8.8, s * 1.26, 1.62, 0, YELLOW));
    p.push(box(0.06, 0.7, 1.3, s * 1.26, 2.45, hl - 1.2, GLASS));
  }
  p.push(box(0.9, 0.25, 6.6, 0, 3.55, -1.4, 0x9ca3af));              // ladder
  for (let i = 0; i < 8; i++) p.push(box(0.9, 0.08, 0.08, 0, 3.72, -4.4 + i * 0.85, 0xd1d5db));
  wheels(p, hl, 1.15, [hl - 1.4, -hl + 1.6, -hl + 2.8], 0.55);
  return mergeColored(p);
}

export function buildPolice() {
  const L = 4.9, hl = L / 2, p = [], BLUE = 0x1d4ed8;
  p.push(box(1.85, 0.75, L, 0, 0.7, 0, WHITE));
  p.push(box(1.7, 0.6, 3.0, 0, 1.38, -0.35, WHITE));                 // greenhouse
  p.push(box(1.6, 0.5, 0.06, 0, 1.38, 1.18, GLASS));
  for (const s of [-1, 1]) {
    p.push(box(0.04, 0.45, 2.7, s * 0.86, 1.38, -0.35, GLASS));
    for (let i = 0; i < 6; i++)
      p.push(box(0.04, 0.32, 0.8, s * 0.94, 0.72, -2.0 + i * 0.8 + 0.4, i % 2 ? YELLOW : BLUE));
  }
  p.push(box(1.86, 0.05, 1.2, 0, 1.70, -0.1, BLUE));                 // POLIS roof panel
  wheels(p, hl, 0.88, [hl - 0.9, -hl + 0.9], 0.36);
  return mergeColored(p);
}

export function buildHelicopter() {
  const p = [], RED = 0xdc2626;
  p.push(box(2.1, 1.9, 5.6, 0, 1.75, 0.6, RED));                      // cabin
  p.push(box(2.12, 0.8, 5.0, 0, 2.6, 0.4, WHITE));                    // white upper band
  p.push(box(1.8, 1.0, 0.9, 0, 1.9, 3.75, GLASS));                    // nose glazing
  p.push(box(1.4, 0.9, 1.6, 0, 1.6, 3.6, RED));
  for (const s of [-1, 1]) p.push(box(0.05, 0.8, 1.8, s * 1.07, 2.0, 1.4, GLASS));
  p.push(box(0.7, 0.7, 6.5, 0, 2.3, -5.3, RED));                      // tail boom
  p.push(box(0.15, 2.0, 1.0, 0, 3.1, -8.4, WHITE));                   // fin
  p.push(box(2.6, 0.12, 0.7, 0, 2.6, -7.6, WHITE));                   // stabiliser
  p.push(box(1.0, 0.6, 1.6, 0, 2.95, 0.3, 0x9ca3af));                 // engine housing
  p.push(box(0.25, 0.9, 0.25, 0, 3.4, 0.3, DARK));                    // mast
  for (const s of [-1, 1]) {                                           // skids
    p.push(box(0.12, 0.12, 4.4, s * 1.2, 0.08, 0.6, DARK));
    p.push(box(0.1, 0.8, 0.1, s * 1.15, 0.5, 1.8, DARK));
    p.push(box(0.1, 0.8, 0.1, s * 1.15, 0.5, -0.6, DARK));
  }
  return mergeColored(p);
}

export function buildRotor() {
  const p = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(0.35, 0.06, 6.9);
    g.translate(0, 0, 3.45);
    g.rotateY(i * Math.PI / 2);
    g.translate(0, 3.9, 0.3);
    p.push({ geo: g, color: 0x1f2937 });
  }
  const tail = new THREE.BoxGeometry(0.06, 1.6, 0.18);
  tail.translate(0.18, 3.1, -8.4);
  p.push({ geo: tail, color: 0x1f2937 });
  return mergeColored(p);
}

/** Light bar used for every blue-light vehicle; positioned per type. */
export function buildBeacon() {
  return mergeColored([box(1.2, 0.22, 0.3, 0, 0, 0, 0x3b82f6)]);
}

export function buildDoubleDecker(hex) {
  setBusPalette(2, hex);
  const lower = buildBusLen(2, 12.5);
  lower.computeBoundingBox();
  const top = lower.boundingBox.max.y;
  const p = [];
  const W = 2.5, L = 12.3;
  p.push(box(W, 1.6, L, 0, top + 0.8, 0, hex));
  for (const s of [-1, 1]) p.push(box(0.04, 0.85, L - 1.2, s * (W / 2 + 0.01), top + 0.95, 0, GLASS));
  p.push(box(W - 0.2, 0.9, 0.05, 0, top + 0.95, L / 2 + 0.01, GLASS));
  p.push(box(W, 0.08, L, 0, top + 1.62, 0, 0xe5e7eb));
  return concatColored([lower, mergeColored(p)]);
}

/** Concatenate already-coloured indexed geometries (keeps vertex colours). */
export function concatColored(geoms) {
  let nv = 0, ni = 0;
  for (const g of geoms) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let v = 0, i = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    col.set(g.attributes.color.array, v * 3);
    const src = g.index.array;
    for (let k = 0; k < src.length; k++) idx[i + k] = src[k] + v;
    v += g.attributes.position.count; i += src.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
