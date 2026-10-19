/**
 * app.js — Rv 25 story map.
 *
 * One MapLibre map spanning every place involved (Växjö → Lund → Linköping)
 * with a three.js custom layer for vehicles. All motion is a pure function
 * of the simulated clock S.t (minutes after midnight, 5 Oct 2026), so
 * play / pause / scrub / jump are all just "set S.t".
 *
 * Coordinate frame for three.js: metres-ish local Mercator around the crash
 * site — x = east, z = south, y = up.
 */
import * as THREE from 'three';
import { t, pick, lang, langMode, bilingual, setLang, applyStatic } from './i18n.js';
import * as VG from './vehicle-geometry.js';
import * as EG from './emergency-geometry.js';

// ── Palette ─────────────────────────────────────────────────────────────────
const PLACE_COLOR = {
  vxo_hosp: '#f43f5e', lby_hosp: '#f59e0b', vmo_hosp: '#a78bfa', kkr_hosp: '#22d3ee',
  lnd_hosp: '#34d399', lkp_hosp: '#60a5fa', skarvet: '#a3e635',
};
const VEH_COLOR = { ambulance: '#facc15', helicopter: '#22d3ee', fire: '#ef4444', police: '#60a5fa', bus: '#a3e635', bus845: '#22c55e' };
const VEH_ICON = { ambulance: '🚑', helicopter: '🚁', fire: '🚒', police: '🚓', bus: '🚌', bus845: '🚌' };
const HOSP_ORDER = ['vxo_hosp', 'lby_hosp', 'vmo_hosp', 'kkr_hosp', 'lnd_hosp', 'lkp_hosp', 'skarvet'];
const CITY_BUS_COLOR = { vaxjo: 0x00923f, karlskrona: 0xe30613, lund: 0xce1141, linkoping: 0x009cdb };

// ── State ───────────────────────────────────────────────────────────────────
const S = {
  scene: null, t: 0, playing: false, speed: 1, story: true,
  autoCam: true, follow: null, lastUserInput: 0, dwellUntil: 0, lastEventIdx: -1, lastTrailT: -1, lastTrailReal: 0,
};
let map, O, OS;                 // map, origin MercatorCoordinate, metres→mercator scale
const routes = {};              // name → { ll, cum, x, z, lc }
let missions = [];
let transitLines = new Map();
let events = [];

// ── Geometry helpers ────────────────────────────────────────────────────────
function toLocal(ll) {
  const m = maplibregl.MercatorCoordinate.fromLngLat(ll);
  return [(m.x - O.x) / OS, (m.y - O.y) / OS];
}
function toLngLat(x, z) {
  return new maplibregl.MercatorCoordinate(O.x + x * OS, O.y + z * OS, 0).toLngLat();
}
function prepLine(ll) {
  const n = ll.length, x = new Float64Array(n), z = new Float64Array(n), lc = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = toLocal(ll[i]); x[i] = p[0]; z[i] = p[1]; }
  for (let i = 1; i < n; i++) lc[i] = lc[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  return { x, z, lc, len: lc[n - 1] || 0 };
}
/** Position + unit heading at fraction f ∈ [0,1] of a prepared line. */
function along(L, f, out) {
  const d = Math.max(0, Math.min(1, f)) * L.len, lc = L.lc;
  let lo = 0, hi = lc.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lc[mid] <= d) lo = mid; else hi = mid; }
  const seg = (lc[hi] - lc[lo]) || 1, u = (d - lc[lo]) / seg;
  const dx = L.x[hi] - L.x[lo], dz = L.z[hi] - L.z[lo], h = Math.hypot(dx, dz) || 1;
  out.x = L.x[lo] + dx * u; out.z = L.z[lo] + dz * u; out.hx = dx / h; out.hz = dz / h;
  out.i = lo; out.u = u;
  return out;
}
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const hm = m => { m = Math.floor(m + 1e-6); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const clock = m => hm(m).replace(':', lang() === 'sv' ? '.' : ':');

// ── Mission prep: annotate each segment with phase + destination ───────────
function prepMissions(sc) {
  const crash = sc.places.crash;
  const isCrash = p => Math.abs(p[0] - crash.lon) < 1e-3 && Math.abs(p[1] - crash.lat) < 1e-3;
  for (const m of sc.missions) {
    let lastH = { hx: 0, hz: -1 };
    let firstHold = true;
    for (const s of m.seq) {
      if (s.type === 'drive') {
        s.L = routes[s.route];
        const r = s.route;
        if (r === 'line845') { s.phase = 'driving'; }
        else if (r.includes('_to_scene') || r.endsWith('_back')) s.phase = 'enroute';
        else if (r.includes('_home')) s.phase = 'returning';
        else s.phase = 'transport';
        if (s.phase === 'transport') {
          const mm = r.match(/_r\d+_(\w+_hosp|skarvet)$/);
          s.dest = mm ? mm[1] : (r === 'relief_bus_skarvet' ? 'skarvet' : m.arrivals[0]?.place);
        }
        const end = along(s.L, 1, {});
        lastH = { hx: end.hx, hz: end.hz };
      } else if (s.type === 'fly') {
        s.A = toLocal(s.a); s.B = toLocal(s.b);
        s.phase = isCrash(s.b) ? 'enroute' : isCrash(s.a) ? 'transport' : 'returning';
        if (s.phase === 'transport') s.dest = m.arrivals[0]?.place;
        const dx = s.B[0] - s.A[0], dz = s.B[1] - s.A[1], h = Math.hypot(dx, dz) || 1;
        lastH = { hx: dx / h, hz: dz / h };
      } else {
        s.P = toLocal(s.at);
        s.phase = s.type === 'crash' ? 'crashed'
          : s.note === 'handover' ? 'handover'
          : (s.note === 'load' || s.note === 'on scene' || s.note === 'boarding') ? 'onscene'
          : s.note === 'start-up' ? 'enroute' : (firstHold ? 'idle' : 'onscene');
      }
      if (s.type !== 'drive' && s.type !== 'fly') s.h = { ...lastH };
      firstHold = false;
    }
    // Hold headings should face the NEXT drive when idle at a base.
    for (let i = 0; i < m.seq.length - 1; i++) {
      const s = m.seq[i], n = m.seq[i + 1];
      if ((s.type === 'hold') && n.type === 'drive') { const a = along(n.L, 0, {}); s.h = { hx: a.hx, hz: a.hz }; }
    }
    // Wait parked at the base from the start, and stay parked when done.
    const first = m.seq[0], last = m.seq[m.seq.length - 1];
    if (first.t0 > sc.meta.t_start) {
      m.seq.unshift({ type: 'hold', at: segStartLL(first, sc), P: segStart(first), h: first.h || { hx: 0, hz: -1 },
                      t0: sc.meta.t_start, t1: first.t0, phase: 'idle' });
    }
    if (last.type !== 'crash') {
      const e = segEnd(last);
      m.seq.push({ type: 'hold', at: segEndLL(last, sc), P: e.p, h: e.h, t0: last.t1, t1: sc.meta.t_end + 600, phase: 'parked' });
    }
    m.t0 = m.seq[0].t0; m.t1 = m.seq[m.seq.length - 1].t1;
    const slot = sceneSlot(m);
    for (const s of m.seq) if (s.type === 'hold' && isCrash(s.at) && slot) {
      s.off = slot;
      if (slot.face) s.h = { hx: slot.face[0], hz: slot.face[1] };
    }
    for (const s of m.seq) if (s.type === 'hold' && !isCrash(s.at)) s.off = baseSlot(s.at, m.id);
    for (let i = 0; i < m.seq.length; i++) {
      const s = m.seq[i];
      if (s.type !== 'hold') continue;
      const pv = m.seq[i - 1], nx = m.seq[i + 1];
      if (pv && (pv.type === 'drive' || pv.type === 'fly')) s.entry = segEnd(pv).p;
      if (nx && (nx.type === 'drive' || nx.type === 'fly')) s.exit = segStart(nx);
    }
    // Summary times for the unit list.
    const d0 = m.seq.find(s => s.type === 'drive' || s.type === 'fly');
    const toScene = m.seq.find(s => s.phase === 'enroute' && (s.type === 'drive' || s.type === 'fly'));
    m.tDispatch = d0 ? d0.t0 : m.t0;
    m.tScene = toScene ? toScene.t1 : null;
  }
  return sc.missions;
}

function segStart(s) {
  if (s.type === 'drive') { const a = along(s.L, 0, {}); return [a.x, a.z]; }
  if (s.type === 'fly') return s.A;
  return s.P;
}
function segEnd(s) {
  if (s.type === 'drive') { const a = along(s.L, 1, {}); return { p: [a.x, a.z], h: { hx: a.hx, hz: a.hz } }; }
  if (s.type === 'fly') {
    const dx = s.B[0] - s.A[0], dz = s.B[1] - s.A[1], h = Math.hypot(dx, dz) || 1;
    return { p: s.B, h: { hx: dx / h, hz: dz / h } };
  }
  return { p: s.P, h: s.h };
}
const segStartLL = (s, sc) => s.type === 'drive' ? sc.routes[s.route].coords[0] : s.type === 'fly' ? s.a : s.at;
const segEndLL = (s, sc) => s.type === 'drive' ? sc.routes[s.route].coords.at(-1) : s.type === 'fly' ? s.b : s.at;
/** Distinct parking spot per unit at a base or hospital (rows of five). */
const _baseSlots = new Map();
function baseSlot(ll, id) {
  const key = `${ll[0].toFixed(3)},${ll[1].toFixed(3)}`;
  if (!_baseSlots.has(key)) _baseSlots.set(key, new Map());
  const mm = _baseSlots.get(key);
  if (!mm.has(id)) mm.set(id, mm.size);
  const n = mm.get(id);
  return { dx: (n % 5) * 9 - 18, dz: Math.floor(n / 5) * 14 + 10 };
}

/** Where each unit parks at the scene, in metres along / across Rv 25
 *  (along = direction of travel towards Alvesta, across = + to the right). */
const _slotCount = {};
let _road = null;   // { ax, az } unit vector along the westbound carriageway
function sceneSlot(m) {
  if (!_road) { const e = along(routes.line845, 1, {}); _road = { ax: e.hx, az: e.hz }; }
  const n = (_slotCount[m.vehicle] = (_slotCount[m.vehicle] || 0) + 1) - 1;
  const { ax, az } = _road, rx = -az, rz = ax;
  const mk = (al, ac, faceBack) => ({ dx: ax * al + rx * ac, dz: az * al + rz * ac,
    face: faceBack ? [-ax, -az] : [ax, az] });
  switch (m.vehicle) {
    case 'ambulance': return mk(-48 + n * 13, -9, true);
    case 'fire': return mk(-30 + n * 26, -1.5, false);
    case 'police': return mk(n ? 95 : -85, -2, n === 0);
    case 'helicopter': return mk(35, -48, false);
    case 'bus': return mk(70, -7, true);
    default: return null;
  }
}

/** Trapezoidal velocity profile: time fraction u -> distance fraction, with
 *  acceleration over the first aS and braking over the last aE of the time. */
function ease(u, aS, aE) {
  u = Math.max(0, Math.min(1, u));
  const v = 1 / (1 - aS / 2 - aE / 2);
  if (u < aS) return v * u * u / (2 * aS);
  if (u > 1 - aE) return 1 - v * (1 - u) * (1 - u) / (2 * aE);
  return v * (u - aS / 2);
}
const _b = {};
/** Pose of a mission at time tt, or null when not on the map. */
const _a = {};
function missionPose(m, tt, out) {
  if (tt < m.t0 || tt > m.t1) return null;
  let s = m.seq[m.seq.length - 1];
  for (const q of m.seq) if (tt >= q.t0 && tt <= q.t1) { s = q; break; }
  out.seg = s; out.phase = s.phase; out.y = 0; out.roll = 0; out.pitch = 0;
  if (s.type === 'drive') {
    const T = Math.max(1e-6, s.t1 - s.t0);
    // ~20 s to get up to speed and to brake (the crash bus never brakes).
    const a = Math.min(0.4, 0.35 / T);
    const f = ease((tt - s.t0) / T, a, s.phase === 'driving' ? 0 : a);
    along(s.L, f, _a); out.x = _a.x; out.z = _a.z; out.f = f;
    // Look-ahead heading: turns through corners instead of snapping.
    const f2 = Math.min(1, f + 22 / Math.max(1, s.L.len));
    if (f2 - f > 1e-5) {
      along(s.L, f2, _b);
      const dx = _b.x - _a.x, dz = _b.z - _a.z, h = Math.hypot(dx, dz);
      if (h > 0.5) { out.hx = dx / h; out.hz = dz / h; } else { out.hx = _a.hx; out.hz = _a.hz; }
    } else { out.hx = _a.hx; out.hz = _a.hz; }
  } else if (s.type === 'fly') {
    const T = Math.max(1e-6, s.t1 - s.t0);
    const f = ease((tt - s.t0) / T, Math.min(0.3, 0.6 / T), Math.min(0.3, 0.6 / T));
    out.x = s.A[0] + (s.B[0] - s.A[0]) * f; out.z = s.A[1] + (s.B[1] - s.A[1]) * f;
    const dx = s.B[0] - s.A[0], dz = s.B[1] - s.A[1], h = Math.hypot(dx, dz) || 1;
    out.hx = dx / h; out.hz = dz / h; out.f = f;
    out.y = 320 * smooth(0, 0.1, f) * (1 - smooth(0.9, 1, f));
    out.pitch = 0.12 * smooth(0.05, 0.2, f) * (1 - smooth(0.8, 0.95, f));
  } else {
    out.x = s.P[0]; out.z = s.P[1]; out.hx = s.h.hx; out.hz = s.h.hz; out.f = 1;
    if (s.off) { out.x += s.off.dx * _slotScale; out.z += s.off.dz * _slotScale; }
    if (s.type === 'crash') {
      // Veers right, slides into the ditch and rolls onto its side (~10 s).
      const k = smooth(s.t0, s.t0 + 0.17, tt), k2 = smooth(s.t0 + 0.05, s.t0 + 0.2, tt);
      const hx0 = out.hx, hz0 = out.hz;
      out.x += -hz0 * 14 * k + hx0 * 18 * k; out.z += hx0 * 14 * k + hz0 * 18 * k;
      const yaw = 0.35 * Math.sin(Math.PI * Math.min(1, k * 1.3));
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      out.hx = hx0 * c + hz0 * sn; out.hz = -hx0 * sn + hz0 * c;
      out.roll = Math.PI / 2 * 0.98 * k2;
    } else {
      // Pull into / out of the parking spot instead of teleporting.
      const dur = s.t1 - s.t0, mm = Math.min(0.45, dur / 3);
      const glide = (from, to, u) => {
        const e = ease(u, 0.5, 0.5);
        const dx = to[0] - from[0], dz = to[1] - from[1], h = Math.hypot(dx, dz);
        out.x = from[0] + dx * e; out.z = from[1] + dz * e;
        if (h > 2) { out.hx = dx / h; out.hz = dz / h; }
      };
      const Q = [out.x, out.z];
      if (s.entry && tt < s.t0 + mm) glide(s.entry, Q, (tt - s.t0) / mm);
      else if (s.exit && tt > s.t1 - mm) glide(Q, s.exit, 1 - (s.t1 - tt) / mm);
    }
  }
  return out;
}

// ── Map style (grayscale OSM raster, darkened for dusk) ────────────────────
function baseStyle() {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
             attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
      { id: 'osm-tiles', type: 'raster', source: 'osm',
        paint: { 'raster-saturation': -0.85, 'raster-contrast': 0.08, 'raster-brightness-min': 0.04, 'raster-brightness-max': 0.82 } },
    ],
  };
}

function addMapLayers(sc) {
  map.addSource('buildings', { type: 'geojson', data: 'data/buildings.geojson' });
  map.addLayer({ id: 'buildings', type: 'fill-extrusion', source: 'buildings', minzoom: 11.5,
    paint: { 'fill-extrusion-color': '#cbd5e1', 'fill-extrusion-height': ['get', 'h'],
             'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.5, 0.82] } });

  map.addSource('closure', { type: 'geojson', data: lineFC([]) });
  map.addLayer({ id: 'closure-glow', type: 'line', source: 'closure',
    paint: { 'line-color': '#ef4444', 'line-width': 12, 'line-opacity': 0.25, 'line-blur': 6 } });
  map.addLayer({ id: 'closure', type: 'line', source: 'closure',
    paint: { 'line-color': '#ef4444', 'line-width': 3.5, 'line-dasharray': [2, 1.4] } });

  map.addSource('ghost', { type: 'geojson', data: lineFC([]) });
  map.addLayer({ id: 'ghost', type: 'line', source: 'ghost', layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 2, 'line-opacity': 0.45, 'line-dasharray': [1, 2] } });

  map.addSource('flows', { type: 'geojson', data: lineFC([]) });
  const flowW = ['interpolate', ['linear'], ['zoom'], 6, ['+', 1.5, ['*', 0.9, ['get', 'n']]], 12, ['+', 4, ['*', 2.2, ['get', 'n']]]];
  map.addLayer({ id: 'flows-glow', type: 'line', source: 'flows', filter: ['==', ['get', 'x'], 0],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['+', 4, ['*', 2, ['get', 'n']]], 12, ['+', 10, ['*', 5, ['get', 'n']]]], 'line-opacity': 0, 'line-blur': 8 } });
  map.addLayer({ id: 'flows', type: 'line', source: 'flows', filter: ['==', ['get', 'x'], 0],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': flowW, 'line-opacity': 0 } });
  map.addLayer({ id: 'flows-xfer', type: 'line', source: 'flows', filter: ['==', ['get', 'x'], 1],
    paint: { 'line-color': ['get', 'c'], 'line-width': 3, 'line-opacity': 0, 'line-dasharray': [2, 1.5] } });

  map.addSource('trails', { type: 'geojson', data: lineFC([]) });
  map.addLayer({ id: 'trails-glow', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 5, 14, 14],
             'line-opacity': ['*', 0.22, ['get', 'o']], 'line-blur': 4 } });
  map.addLayer({ id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 14, 4],
             'line-opacity': ['get', 'o'] } });
}
const lineFC = feats => ({ type: 'FeatureCollection', features: feats });

// ── three.js layer ──────────────────────────────────────────────────────────
const MAX = { amb: 24, fire: 8, police: 8, heli: 2, rotor: 2, beacon: 40, dd: 2, relief: 2, plane: 8, tram: 120, train: 80, train_ic: 40 };
const meshes = {};
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'),
      _p = new THREE.Vector3(), _sv = new THREE.Vector3();
let lights = null;

function makeInst(scene3, key, geo, max) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false; im.count = 0;
  scene3.add(im); meshes[key] = im; im.userData.n = 0;
  return im;
}
function put(key, x, y, z, hx, hz, k, roll = 0, pitch = 0, yawExtra = 0) {
  const im = meshes[key]; const i = im.userData.n;
  if (i >= im.instanceMatrix.count) return;
  _e.set(pitch, Math.atan2(hx, hz) + yawExtra, roll); _q.setFromEuler(_e);
  _p.set(x, y, z); _sv.set(k, k, k);
  _m4.compose(_p, _q, _sv); im.setMatrixAt(i, _m4); im.userData.n = i + 1;
}

function threeLayer() {
  let renderer, scene3, camera;
  const modelM = new THREE.Matrix4();
  return {
    id: 'vehicles', type: 'custom', renderingMode: '3d',
    onAdd(m, gl) {
      camera = new THREE.Camera();
      scene3 = new THREE.Scene();
      const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.6);
      const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-0.6, 1, 0.4);
      scene3.add(hemi, sun); lights = { hemi, sun };
      VG.setBusPalette(0, CITY_BUS_COLOR.vaxjo);
      for (const [city, hex] of Object.entries(CITY_BUS_COLOR)) {
        VG.setBusPalette(0, hex); makeInst(scene3, `bus_${city}`, VG.buildBusLen(0, 10), 260);
      }
      makeInst(scene3, 'tram', VG.buildTram(), MAX.tram);
      makeInst(scene3, 'train', VG.buildTrain(), MAX.train);
      makeInst(scene3, 'train_ic', VG.buildOresund(), MAX.train_ic);
      makeInst(scene3, 'plane', VG.buildPlane(), MAX.plane);
      makeInst(scene3, 'amb', EG.buildAmbulance(), MAX.amb);
      makeInst(scene3, 'fire', EG.buildFireTruck(), MAX.fire);
      makeInst(scene3, 'police', EG.buildPolice(), MAX.police);
      makeInst(scene3, 'heli', EG.buildHelicopter(), MAX.heli);
      makeInst(scene3, 'rotor', EG.buildRotor(), MAX.rotor);
      makeInst(scene3, 'dd', EG.buildDoubleDecker(0x00923f), MAX.dd);
      VG.setBusPalette(0, 0x00923f); makeInst(scene3, 'relief', VG.buildBusLen(0, 12), MAX.relief);
      const bm = makeInst(scene3, 'beacon', EG.buildBeacon(), MAX.beacon);
      bm.material = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      modelM.makeTranslation(O.x, O.y, O.z)
        .scale(new THREE.Vector3(OS, -OS, OS))
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    },
    render(gl, matrix) {
      updateVehicles();
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(modelM);
      lastMVP = camera.projectionMatrix;
      renderer.resetState();
      renderer.render(scene3, camera);
    },
  };
}

// Per-frame vehicle placement ------------------------------------------------
const _pose = {};
let _slotScale = 1;   // spreads parked units as vehicles grow with zoom-out
const vehLabels = new Map();   // mission id → maplibregl.Marker
// Everything hoverable this frame: key → { kind, ref, x, y, z }. Keys are the
// mission id, `trip:<i>` for background transit and `flight:<i>` for planes, so
// S.follow can point at any of them.
let PICK = new Map(), _pickNext = new Map();
let lastMVP = null;            // three.js clip matrix of the last frame (local → clip)
function vehicleScales() {
  const z = map.getZoom(), lat = map.getCenter().lat;
  const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, z));
  return {
    emerg: Math.min(900, Math.max(2.5, 24 * mpp / 7)),
    transit: Math.min(70, Math.max(2.2, 8 * mpp / 10)),
    zoom: z,
    plane: Math.min(900, Math.max(2.5, 30 * mpp / 20)),
    mpp,
  };
}

function updateVehicles() {
  for (const k in meshes) meshes[k].userData.n = 0;
  _pickNext.clear();
  const tt = S.t, K = vehicleScales(), now = performance.now();
  _slotScale = Math.min(5, Math.max(1, K.emerg / 2.5));
  const flashOn = Math.floor(now / 230) % 2 === 0;

  // Emergency fleet -----------------------------------------------------------
  for (const m of missions) {
    const p = missionPose(m, tt, _pose);
    m._pose = p ? { x: p.x, z: p.z, hx: p.hx, hz: p.hz, phase: p.phase, seg: p.seg, y: p.y } : null;
    if (!p) continue;
    const k = K.emerg;
    _pickNext.set(m.id, { kind: 'mission', ref: m, x: p.x, y: (m.vehicle === 'helicopter' ? p.y + (p.y > 1 ? 4 * k : 0) : 0) + 1.2 * k, z: p.z, r: 3.5 * k });
    const blue = (p.phase === 'enroute' || p.phase === 'transport') && m.vehicle !== 'bus';
    switch (m.vehicle) {
      case 'ambulance': put('amb', p.x, 0, p.z, p.hx, p.hz, k); if (blue && flashOn) put('beacon', p.x, 2.95 * k, p.z, p.hx, p.hz, k); break;
      case 'fire': put('fire', p.x, 0, p.z, p.hx, p.hz, k); if (blue && flashOn) put('beacon', p.x, 3.9 * k, p.z, p.hx, p.hz, k); break;
      case 'police': put('police', p.x, 0, p.z, p.hx, p.hz, k * 1.1); if ((blue || p.phase === 'onscene') && flashOn) put('beacon', p.x, 1.8 * k * 1.1, p.z, p.hx, p.hz, k * 0.9); break;
      case 'bus': put('relief', p.x, 0, p.z, p.hx, p.hz, k); break;
      case 'bus845': {
        const y = p.roll ? 1.3 * k : 0;
        put('dd', p.x, y, p.z, p.hx, p.hz, k, p.roll); break;
      }
      case 'helicopter': {
        const y = p.y + (p.y > 1 ? 4 * k : 0);
        put('heli', p.x, y, p.z, p.hx, p.hz, k, 0, p.pitch);
        const spinning = p.phase !== 'idle' && !(p.seg.type === 'hold' && p.seg.note === 'handover' && tt > p.seg.t0 + 3);
        put('rotor', p.x, y, p.z, p.hx, p.hz, k, 0, p.pitch, spinning ? now / 40 : 0.4);
        break;
      }
    }
  }

  // Background public transport ----------------------------------------------
  const trips = S.scene.transit.trips;
  const busesOn = K.zoom >= 9.2;   // local buses vanish into blobs below this
  for (let i = 0; i < trips.length; i++) {
    const r = trips[i];
    if (r[1] > tt) break;           // sorted by depart
    if (r[2] < tt) continue;
    const L = transitLines.get(r[0]); if (!L || (!busesOn && L.key.startsWith('bus'))) continue;
    let f = (tt - r[1]) / Math.max(1, r[2] - r[1]); if (r[3]) f = 1 - f;
    along(L.P, f, _a);
    const hx = r[3] ? -_a.hx : _a.hx, hz = r[3] ? -_a.hz : _a.hz;
    const fade = Math.max(0.05, Math.min(1, (tt - r[1]) / 0.5, (r[2] - tt) / 0.5));
    put(L.key, _a.x, 0, _a.z, hx, hz, (L.key.startsWith('train') ? K.transit * 0.9 : K.transit) * fade);
    _pickNext.set(`trip:${i}`, { kind: 'transit', ref: r, x: _a.x, y: K.transit, z: _a.z, r: 4 * K.transit });
  }

  // Flights at Småland Airport (illustrative) --------------------------------
  const ap = S.scene.flights._ap;
  for (const [fi, [m0, kind, brg]] of S.scene.flights.list.entries()) {
    const D = 18;
    let f;
    if (kind === 'dep') { if (tt < m0 || tt > m0 + D) continue; f = (tt - m0) / D; }
    else { if (tt < m0 - D || tt > m0) continue; f = (m0 - tt) / D; }
    const th = brg * Math.PI / 180, dx = Math.sin(th), dz = -Math.cos(th);
    const dist = 1500 * smooth(0, 0.08, f) + 140000 * Math.pow(f, 1.6);
    const alt = Math.min(3600, Math.max(0, (dist - 1500) * 0.07));
    const sx = kind === 'dep' ? dx : -dx, sz = kind === 'dep' ? dz : -dz;
    const pf = Math.max(0.05, Math.min(1, f / 0.04, (1 - f) / 0.08));
    put('plane', ap[0] + dx * dist, alt + (alt > 0 ? 3 * K.plane : 0), ap[1] + dz * dist, sx, sz, K.plane * pf, 0,
        kind === 'dep' ? -0.12 * smooth(0.05, 0.15, f) : 0.06 * smooth(0.05, 0.15, f));
    _pickNext.set(`flight:${fi}`, { kind: 'plane', ref: S.scene.flights.list[fi], x: ap[0] + dx * dist, y: alt + (alt > 0 ? 3 * K.plane : 0), z: ap[1] + dz * dist, r: 10 * K.plane });
  }
  [PICK, _pickNext] = [_pickNext, PICK];

  for (const k in meshes) {
    const im = meshes[k]; im.count = im.userData.n; im.instanceMatrix.needsUpdate = true;
  }
}

// ── Markers (places + vehicle labels) ──────────────────────────────────────
const placeMarkers = {};
function markerEl(cls, icon, color, label) {
  const el = document.createElement('div');
  el.className = `mk ${cls}`;
  el.innerHTML = `<div class="ic" style="background:${color}">${icon}</div><div class="lb">${label}</div>`;
  return el;
}
function buildPlaceMarkers(sc) {
  for (const [id, p] of Object.entries(sc.places)) {
    if (['junction', 'locality', 'town', 'station'].includes(p.kind)) continue;
    let el;
    if (p.kind === 'crash') {
      el = document.createElement('div'); el.className = 'crash-mk';
    } else if (p.kind === 'hospital' || p.kind === 'clinic') {
      el = markerEl(p.approx ? 'approx' : '', p.kind === 'hospital' ? 'H' : 'V', PLACE_COLOR[id], pick(p, ''));
    } else {
      const ic = { ambulance_base: '🚑', heli_base: '🚁', fire_base: '🚒', police: '🚓' }[p.kind] || '•';
      el = markerEl('small approx', ic, '#334155', pick(p, ''));
    }
    el.title = p.approx ? `${pick(p, '')} — ${t('approx')}` : pick(p, '');
    const mk = new maplibregl.Marker({ element: el, anchor: p.kind === 'crash' ? 'center' : 'left', offset: p.kind === 'crash' ? [0, 0] : [-12, 0] })
      .setLngLat([p.lon, p.lat]).addTo(map);
    placeMarkers[id] = { mk, el, p };
  }
  refreshMarkerLabels();
}
function refreshMarkerLabels() {
  const z = map.getZoom();
  for (const [id, { el, p }] of Object.entries(placeMarkers)) {
    if (p.kind === 'crash') { el.style.display = S.t >= S.scene.meta.t_crash ? '' : 'none'; continue; }
    const small = el.classList.contains('small');
    el.style.display = (small && z < 8.3) || (p.kind === 'clinic' && z < 11) ? 'none' : '';
    el.classList.toggle('hidden-lb', small ? z < 10.8 : z < 6.4);
    if (p.kind === 'hospital' || p.kind === 'clinic') {
      const n = hospCounts[id] || 0;
      el.querySelector('.lb').innerHTML = pick(p, '') + (n ? `<b>${n}</b>` : (id === 'skarvet' && hospLight ? '<b>✓</b>' : ''));
    } else {
      el.querySelector('.lb').textContent = pick(p, '');
    }
  }
}
function updateVehicleLabels() {
  const show = map.getZoom() >= 10.6;
  for (const m of missions) {
    if (m.vehicle === 'police' || m.vehicle === 'fire') continue;
    let mk = vehLabels.get(m.id);
    const p = m._pose;
    const moving = p && (p.phase === 'enroute' || p.phase === 'transport' || p.phase === 'driving');
    if (!show || !p || !moving) { if (mk) mk.getElement().style.display = 'none'; continue; }
    if (!mk) {
      const el = document.createElement('div'); el.className = 'veh-lb';
      mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([0, 0]).addTo(map);
      vehLabels.set(m.id, mk);
    }
    const el = mk.getElement(); el.style.display = '';
    el.textContent = shortName(m);
    mk.setLngLat(toLngLat(p.x, p.z));
  }
}
const shortName = m => pick(m, '').replace(/^Ambulans |^Ambulance /, '').replace(/ \(.*\)$/, '');

// ── Trails ─────────────────────────────────────────────────────────────────
function sliceLL(ll, cum, f) {
  const d = f * cum[cum.length - 1];
  const out = [];
  for (let i = 0; i < ll.length; i++) {
    if (cum[i] <= d) { out.push(ll[i]); continue; }
    const a = ll[i - 1], b = ll[i], u = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    break;
  }
  return out;
}
function segColor(m, s) {
  if (s.phase === 'transport') return PLACE_COLOR[s.dest] || '#fff';
  if (s.phase === 'returning') return '#64748b';
  return VEH_COLOR[m.vehicle] || '#fff';
}
function updateTrails() {
  const tt = S.t, trails = [], ghosts = [];
  for (const m of missions) {
    if (tt < m.t0) continue;
    for (const s of m.seq) {
      if (s.type !== 'drive' && s.type !== 'fly') continue;
      if (tt < s.t0) continue;
      const f = Math.min(1, (tt - s.t0) / Math.max(1e-6, s.t1 - s.t0));
      const c = segColor(m, s);
      const old = tt > s.t1 + 20;
      const o = s.phase === 'returning' ? 0.35 * (1 - 0.7 * _flowA) : old ? 0.55 * (1 - 0.65 * _flowA) : 0.95;
      let coords;
      if (s.type === 'drive') {
        const R = S.scene.routes[s.route];
        coords = sliceLL(R.coords, R.cum, f);
        if (f < 1 && s.phase !== 'returning') ghosts.push({ type: 'Feature', properties: { c },
          geometry: { type: 'LineString', coordinates: R.coords } });
      } else {
        const a = s.a, b = s.b, n = 24; coords = [];
        for (let i = 0; i <= n * f; i++) { const u = i / n; coords.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
        coords.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
        if (f < 1) ghosts.push({ type: 'Feature', properties: { c }, geometry: { type: 'LineString', coordinates: [a, b] } });
      }
      if (coords.length >= 2) trails.push({ type: 'Feature', properties: { c, o }, geometry: { type: 'LineString', coordinates: coords } });
    }
  }
  map.getSource('trails').setData(lineFC(trails));
  updateFlows();
  map.getSource('ghost').setData(lineFC(ghosts));
  const cl = S.scene.closure;
  map.getSource('closure').setData(lineFC(tt >= cl.t0 && tt <= cl.t1
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: cl.coords } }] : []));
}

// ── Patient flows: arcs crash → hospital (width = patients received) ─────
let _flowA = 0;
const flowMarkers = new Map();
function arc(a, b, bend = 0.18, n = 40) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const k = Math.cos(my * Math.PI / 180);                 // lon→ground scale
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  const cx = mx - dy * bend / k, cy = my + dx * bend;     // perpendicular control point
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    out.push([v * v * a[0] + 2 * u * v * cx + u * u * b[0], v * v * a[1] + 2 * u * v * cy + u * u * b[1]]);
  }
  return out;
}
function updateFlows() {
  const P = S.scene.places, tt = S.t;
  _flowA = smooth(18 * 60 + 40, 19 * 60, tt);
  const direct = {}, xfer = {}; let light = false;
  for (const m of missions) for (const a of m.arrivals) {
    if (a.t > tt) continue;
    if (a.light) { light = true; continue; }
    const tgt = m.transfer ? xfer : direct;
    tgt[a.place] = (tgt[a.place] || 0) + a.n;
  }
  const feats = [], badges = [];
  const crash = [P.crash.lon, P.crash.lat], vxo = [P.vxo_hosp.lon, P.vxo_hosp.lat];
  for (const [id, n] of Object.entries(direct)) {
    const c = arc(crash, [P[id].lon, P[id].lat]);
    feats.push({ type: 'Feature', properties: { c: PLACE_COLOR[id], n, x: 0 }, geometry: { type: 'LineString', coordinates: c } });
    badges.push([id, n, c[Math.round(c.length * 0.62)]]);
  }
  if (light) {
    const c = arc(crash, [P.skarvet.lon, P.skarvet.lat], -0.12);
    feats.push({ type: 'Feature', properties: { c: PLACE_COLOR.skarvet, n: 0.6, x: 0 }, geometry: { type: 'LineString', coordinates: c } });
  }
  for (const [id, n] of Object.entries(xfer)) {
    const c = arc(vxo, [P[id].lon, P[id].lat], 0.12);
    feats.push({ type: 'Feature', properties: { c: PLACE_COLOR[id], n, x: 1 }, geometry: { type: 'LineString', coordinates: c } });
    badges.push([`x_${id}`, n, c[Math.round(c.length * 0.55)], id]);
  }
  map.getSource('flows').setData(lineFC(feats));
  map.setPaintProperty('flows', 'line-opacity', 0.85 * _flowA);
  map.setPaintProperty('flows-glow', 'line-opacity', 0.25 * _flowA);
  map.setPaintProperty('flows-xfer', 'line-opacity', 0.9 * _flowA);
  const seen = new Set();
  for (const [key, n, at, idx] of badges) {
    seen.add(key);
    let mk = flowMarkers.get(key);
    if (!mk) {
      const el = document.createElement('div'); el.className = 'flow-badge';
      mk = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
      flowMarkers.set(key, mk);
    }
    const el = mk.getElement();
    el.style.background = PLACE_COLOR[idx || key];
    el.textContent = n;
    el.style.opacity = _flowA;
    el.style.display = _flowA > 0.02 ? '' : 'none';
    mk.setLngLat(at);
  }
  for (const [key, mk] of flowMarkers) if (!seen.has(key)) mk.getElement().style.display = 'none';
}

// ── Director: after the scene work, the camera chases patient transports ─
const DIRECTOR_FROM = 18 * 60 + 50;
let _dirBearing = null, _dirNext = 0, _dirUntil = 0;
function transportsNow() {
  const out = [];
  for (const m of missions) {
    const p = m._pose;
    if (p && p.phase === 'transport' && (p.seg.type === 'drive' || p.seg.type === 'fly')) out.push({ m, p });
  }
  return out;
}
function directorTick(now) {
  if (!S.story || !S.autoCam || !S.playing || S.follow || S.t < DIRECTOR_FROM) return;
  if (now < S.dwellUntil - 1500 || now < _dirNext || now - S.lastUserInput < 6000) return;
  if (map.isMoving() && now > _dirUntil) return;      // someone else's flight
  const tr = transportsNow();
  if (!tr.length) { _dirBearing = null; return; }
  _dirNext = now + 1200;
  if (tr.length === 1) {
    const { p } = tr[0];
    const target = Math.atan2(p.hx, -p.hz) * 180 / Math.PI;
    const ctr = toLngLat(p.x, p.z);
    if (!Number.isFinite(target) || !Number.isFinite(ctr.lng) || !Number.isFinite(ctr.lat)) { console.warn('director: bad pose', p); return; }
    if (_dirBearing === null) _dirBearing = target;
    let d = ((target - _dirBearing + 540) % 360) - 180;
    _dirBearing += d * 0.25;
    _dirUntil = now + 1300;
    map.easeTo({ center: ctr, zoom: 11.6, pitch: 58, bearing: _dirBearing, duration: 1300, easing: x => x, essential: true });
  } else {
    const b = new maplibregl.LngLatBounds();
    for (const { m, p } of tr) {
      const ll = toLngLat(p.x, p.z); b.extend(ll);
      const dest = S.scene.places[p.seg.dest]; if (dest) b.extend([dest.lon, dest.lat]);
    }
    _dirBearing = null; _dirUntil = now + 1500;
    map.fitBounds(b, { padding: 60, maxZoom: 11, pitch: 40, bearing: 0, duration: 1500, essential: true });
  }
}

// ── Hospitals panel ────────────────────────────────────────────────────────
let hospCounts = {}, hospLight = false;
function buildHospPanel() {
  const box = document.getElementById('hospList');
  box.innerHTML = '';
  for (const id of HOSP_ORDER) {
    const p = S.scene.places[id];
    const row = document.createElement('div'); row.className = 'hosp-row'; row.dataset.id = id;
    row.innerHTML = `<span class="dot" style="background:${PLACE_COLOR[id]}"></span><span class="name">${pick(p, '')}</span><span class="num">0</span><div class="bar"><i style="background:${PLACE_COLOR[id]}"></i></div>`;
    row.onclick = () => flyToPlaces([id], 14.5);
    box.appendChild(row);
  }
}
function updateHospPanel() {
  const counts = {}; let light = false;
  for (const m of missions) for (const a of m.arrivals) {
    if (a.t <= S.t) { counts[a.place] = (counts[a.place] || 0) + a.n; if (a.light) light = true; }
  }
  const doc = S.scene.documented_totals;
  for (const row of document.querySelectorAll('.hosp-row')) {
    const id = row.dataset.id, n = counts[id] || 0;
    const prev = hospCounts[id] || 0;
    const num = row.querySelector('.num');
    if (id === 'skarvet') {
      num.innerHTML = light ? `✓<small>${t('light_injured')}</small>` : '–';
    } else {
      num.innerHTML = `${n}${doc[id] ? `<small>/ ${doc[id]}</small>` : ''}`;
    }
    row.querySelector('.bar i').style.width = `${Math.min(100, 100 * n / Math.max(1, doc[id] || 1))}%`;
    if (n > prev && S.playing) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
  }
  const changed = JSON.stringify(counts) !== JSON.stringify(hospCounts) || light !== hospLight;
  hospCounts = counts; hospLight = light;
  if (changed) refreshMarkerLabels();
}

// ── Units panel ────────────────────────────────────────────────────────────
function buildUnitPanel() {
  const box = document.getElementById('unitList'); box.innerHTML = '';
  const order = { bus845: 0, ambulance: 1, helicopter: 2, fire: 3, police: 4, bus: 5 };
  const ms = [...missions].sort((a, b) => (order[a.vehicle] - order[b.vehicle]) || (a.tDispatch - b.tDispatch));
  for (const m of ms) {
    const row = document.createElement('div'); row.className = 'unit-row'; row.dataset.id = m.id;
    row.innerHTML = `<span class="ico">${VEH_ICON[m.vehicle]}</span><div><div class="nm">${pick(m, '')}</div><div class="st"></div></div><div class="tm"></div>`;
    row.onclick = () => setFollow(S.follow === m.id ? null : m.id);
    box.appendChild(row);
  }
}
function statusText(m) {
  const p = m._pose;
  if (!p) return S.t < m.t0 ? t('status_idle') : t('status_done');
  const ph = p.phase, s = p.seg;
  const dest = s.dest ? pick(S.scene.places[s.dest], '').replace(/ \(.*\)$/, '') : '';
  switch (ph) {
    case 'driving': return t('status_driving');
    case 'crashed': return t('status_crashed');
    case 'enroute': return `<span class="pill" style="background:${VEH_COLOR[m.vehicle]}"></span>${t('status_enroute')}`;
    case 'onscene': return `<span class="pill" style="background:#e2e8f0"></span>${t('status_onscene')}`;
    case 'transport': return `<span class="pill" style="background:${PLACE_COLOR[s.dest]}"></span>${t('status_transport')} → <b>${dest}</b>`;
    case 'handover': return `${t('status_handover')} · ${pick(S.scene.places[prevDest(m, s) || m.base], '').replace(/ \(.*\)$/, '')}`;
    case 'returning': return t('status_returning');
    case 'parked': return t('status_done');
    default: return t('status_idle');
  }
}
function prevDest(m, s) {
  const i = m.seq.indexOf(s);
  for (let j = i - 1; j >= 0; j--) if (m.seq[j].dest) return m.seq[j].dest;
  return null;
}
function timeText(m) {
  const tt = S.t, parts = [];
  if (m.vehicle === 'bus845') return tt >= S.scene.meta.t_crash ? clock(S.scene.meta.t_crash) : '';
  if (tt >= m.tDispatch) parts.push(clock(m.tDispatch));
  if (m.tScene && tt >= m.tScene) parts.push(`+${Math.round(m.tScene - m.tDispatch)} ${t('min')}`);
  for (const a of m.arrivals) if (tt >= a.t) parts.push(`${clock(a.t)}`);
  return parts.join(' · ');
}
function updateUnitPanel(force) {
  for (const row of document.querySelectorAll('.unit-row')) {
    const m = missions.find(q => q.id === row.dataset.id);
    const st = statusText(m), tm = timeText(m);
    const stEl = row.querySelector('.st'), tmEl = row.querySelector('.tm');
    if (force || stEl.innerHTML !== st) stEl.innerHTML = st;
    if (force || tmEl.textContent !== tm) tmEl.textContent = tm;
    row.classList.toggle('dim', !m._pose || m._pose.phase === 'idle' || m._pose.phase === 'parked');
    row.classList.toggle('following', S.follow === m.id);
  }
}

// ── Story: events, cards, camera ───────────────────────────────────────────
function padding() {
  const w = window.innerWidth;
  if (w < 760) return { top: 150, bottom: 340, left: 10, right: 10 };
  if (w < 1100) return { top: 30, bottom: 150, left: 330, right: 330 };
  const right = document.body.classList.contains('compact') ? 110 : 410;
  return { top: 30, bottom: 160, left: 420, right };
}
function flyToPlaces(ids, maxZoom = 13, opts = {}) {
  const pts = ids.map(id => { const p = S.scene.places[id]; return [p.lon, p.lat]; });
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  for (const q of pts) b.extend(q);
  map.fitBounds(b, { padding: 50, maxZoom, duration: 2600, pitch: opts.pitch ?? 45, bearing: opts.bearing ?? 0, essential: true });
}
function camera(name) {
  if (S.follow) return;
  const P = S.scene.places, c = [P.crash.lon, P.crash.lat];
  const fly = (center, zoom, pitch, bearing) => map.flyTo({ center, zoom, pitch, bearing, duration: 2800, essential: true });
  switch (name) {
    case 'city': return fly([P.vxo_resc.lon - 0.03, P.vxo_resc.lat + 0.006], 12.6, 55, -70);
    case 'crash': return fly(c, 14.3, 58, -35);
    case 'crash_close': return fly(c, 16.9, 62, 25);
    case 'region': return flyToPlaces(['crash', 'vxo_hosp', 'alv_amb', 'lby_hosp', 'vmo_hosp'], 10, { pitch: 40 });
    case 'corridor': return flyToPlaces(['kvalleberg', 'hanaslov', 'crash'], 12.5, { pitch: 50, bearing: -20 });
    case 'hospitals': return flyToPlaces(['crash', 'vxo_hosp', 'lby_hosp'], 11, { pitch: 40 });
    case 'heli': return flyToPlaces(['crash', 'kkr_hosp', 'ron_sar', 'vxo_hosp'], 9.5, { pitch: 35 });
    case 'overview': return flyToPlaces(['crash', 'vxo_hosp', 'lby_hosp', 'vmo_hosp', 'kkr_hosp'], 9, { pitch: 30 });
    case 'skarvet': return flyToPlaces(['skarvet', 'vxo_hosp', 'crash'], 13, { pitch: 50, bearing: -30 });
    case 'south': return flyToPlaces(['vxo_hosp', 'lnd_hosp', 'lkp_hosp'], 8, { pitch: 20 });
    case 'flows': return flyToPlaces(['crash', 'vxo_hosp', 'lby_hosp', 'vmo_hosp', 'kkr_hosp'], 9.3, { pitch: 30 });
    case 'flows_all': return flyToPlaces(['crash', 'vxo_hosp', 'lby_hosp', 'vmo_hosp', 'kkr_hosp', 'lnd_hosp', 'lkp_hosp'], 8, { pitch: 15 });
    case 'xfer': {
      const tr = transportsNow();
      if (!tr.length) return camera('flows_all');
      const b = new maplibregl.LngLatBounds();
      for (const { p } of tr) {
        b.extend(toLngLat(p.x, p.z));
        const d = S.scene.places[p.seg.dest]; if (d) b.extend([d.lon, d.lat]);
      }
      return map.fitBounds(b, { padding: 60, maxZoom: 11, pitch: 35, bearing: 0, duration: 2600, essential: true });
    }
    case 'none': return;
  }
}

/** Event-driven camera moves; skipped when the viewer has turned off the
 *  automatic camera (the 🎯 button still works on demand). */
function autoCamera(name) { if (S.autoCam) camera(name); }
function setAutoCam(on) {
  S.autoCam = on;
  try { localStorage.setItem('rv25.autocam', on ? '1' : '0'); } catch (_) { /* ignore */ }
  const cb = document.getElementById('chkAutoCam'); if (cb) cb.checked = on;
  if (!on && map.isMoving()) map.stop();
}
function setFollow(id) {
  S.follow = id;
  const chip = document.getElementById('followChip');
  const e = id && (PICK.get(id) || (missions.find(q => q.id === id) && { kind: 'mission', ref: missions.find(q => q.id === id) }));
  chip.classList.toggle('hidden', !e);
  if (!e) S.follow = null;
  else {
    chip.querySelector('span').textContent = `${t('following')}: ${vehTitle(e)}`;
    const p = PICK.get(id);
    if (p) map.easeTo({ center: toLngLat(p.x, p.z), zoom: Math.max(map.getZoom(), e.kind === 'plane' ? 11 : 13), duration: 1200 });
  }
  updateRing();
  updateUnitPanel(true);
}

// ── Hover tooltip + selection ring ─────────────────────────────────────────
const CITY_NAME = { vaxjo: 'Växjö', karlskrona: 'Karlskrona', lund: 'Lund', linkoping: 'Linköping' };
const NOTE_KEY = { load: 'tip_loading', handover: 'tip_handover', boarding: 'tip_boarding', 'on scene': 'tip_working', 'start-up': 'tip_startup' };
const placeName = id => id ? pick(S.scene.places[id], '').replace(/ \(.*\)$/, '') : '';
function nearestPlaceId(ll) {
  let best = null, bd = 2500;
  for (const [id, p] of Object.entries(S.scene.places)) {
    const d = Math.hypot((p.lon - ll[0]) * 111320 * Math.cos(p.lat * Math.PI / 180), (p.lat - ll[1]) * 110540);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
const where = ll => { const id = nearestPlaceId(ll); return id === 'crash' ? t('scene') : id ? placeName(id) : ''; };
/** Screen position (CSS px) of a local-frame point, via the last three.js frame. */
function screenOf(x, y, z) {
  if (!lastMVP) return null;
  const v = new THREE.Vector4(x, y, z, 1).applyMatrix4(lastMVP);
  if (v.w <= 0) return null;
  const c = map.getCanvas();
  return [(v.x / v.w + 1) / 2 * c.clientWidth, (1 - v.y / v.w) / 2 * c.clientHeight];
}
function pickAt(px, py) {
  let best = null, bd = Infinity;
  const mpp = vehicleScales().mpp;
  for (const [key, e] of PICK) {
    const s = screenOf(e.x, e.y, e.z); if (!s) continue;
    const d = Math.hypot(s[0] - px, s[1] - py);
    const rad = Math.max(14, Math.min(40, e.r / mpp));   // vehicle's own size, clamped
    // Emergency units win ties over background traffic.
    const score = d - (e.kind === 'mission' ? 8 : 0);
    if (d < rad && score < bd) { bd = score; best = key; }
  }
  return best;
}
function transitInfo(r) {
  const id = r[0], [city, rest] = id.split(':');
  const L = S.scene.transit.lines.find(l => l.id === id) || {};
  let kind, line = '';
  if (L.type === 'tram') kind = t('tip_tram');
  else if (L.type === 'train') kind = L.intercity ? t('tip_ic') : t('tip_train');
  else { kind = t('leg_bus'); const mm = rest.match(/bus_(?:\w+?_)?(\d+)$/); if (mm && !rest.includes('sweep')) line = mm[1]; }
  return { kind, line, city: CITY_NAME[city] || city };
}
function vehTitle(e) {
  if (e.kind === 'mission') return pick(e.ref, '');
  if (e.kind === 'transit') { const i = transitInfo(e.ref); return `${i.kind}${i.line ? ` ${t('tip_line')} ${i.line}` : ''} · ${i.city}`; }
  const [, kind, , city] = e.ref;
  return `${t('tip_flight')} ${kind === 'dep' ? '→' : '←'} ${city}`;
}
function legLine(s) {
  const dur = s.t1 - s.t0, left = Math.max(0, s.t1 - S.t);
  const len = s.type === 'drive' ? s.L.len : Math.hypot(s.B[0] - s.A[0], s.B[1] - s.A[1]);
  const kmh = Math.round(len / 1000 / (dur / 60));
  return `${t('tip_dep')} <b>${clock(s.t0)}</b> → ${t('eta')} <b>${clock(s.t1)}</b> (${Math.round(dur)} ${t('min')}, ${(len / 1000).toFixed(len < 10000 ? 1 : 0)} km)`
    + `<br>${left > 0.05 ? `${Math.ceil(left)} ${t('min')} ${t('tip_left')} · ` : ''}${t('tip_avg')} ≈ ${kmh} km/h`;
}
function missionTip(m) {
  const p = m._pose, rows = [];
  rows.push(`<div class="tt-st">${statusText(m)}</div>`);
  if (p) {
    const s = p.seg, sc = S.scene;
    if (s.type === 'drive' || s.type === 'fly') {
      const from = where(segStartLL(s, sc)), to = s.dest ? placeName(s.dest) : where(segEndLL(s, sc));
      const cap = w => w ? w[0].toUpperCase() + w.slice(1) : '…';
      if (from || to) rows.push(`<div>${cap(from)} → <b>${to || '…'}</b></div>`);
      rows.push(`<div class="tt-dim">${legLine(s)}</div>`);
    } else if (s.type === 'hold' && p.phase !== 'idle' && p.phase !== 'parked') {
      const at = where(s.at), note = NOTE_KEY[s.note] ? t(NOTE_KEY[s.note]) : '';
      rows.push(`<div>${at ? `${at} · ` : ''}${note}</div><div class="tt-dim">${clock(s.t0)}–${clock(s.t1)} (${Math.round(s.t1 - s.t0)} ${t('min')})</div>`);
    } else if (s.type === 'crash') {
      rows.push(`<div class="tt-dim">${t('tip_crash_at')} <b>${clock(sc.meta.t_crash)}</b></div>`);
    }
  }
  const info = [];
  if (m.base) info.push(`${t('tip_base')}: ${placeName(m.base)}`);
  if (m.mutual_aid) info.push(t('tip_mutual'));
  if (m.tScene) info.push(`${t('leg_alarm_scene')}: ${Math.round(m.tScene - m.tDispatch)} ${t('min')} (${clock(m.tDispatch)}→${clock(m.tScene)})`);
  const done = m.arrivals.filter(a => a.t <= S.t);
  if (m.arrivals.length && m.vehicle !== 'bus845') {
    const n = done.reduce((q, a) => q + (a.n || 1), 0);
    info.push(`${t('tip_patients')}: <b>${n}</b>${done.length ? ` (${done.map(a => `${placeName(a.place)} ${clock(a.t)}`).join(', ')})` : ''}`);
  }
  if (info.length) rows.push(`<div class="tt-info">${info.join('<br>')}</div>`);
  rows.push(`<div class="tt-src ${m.estimated ? 'est' : 'doc'}">${m.estimated ? t('tip_modelled') : t('documented')}</div>`);
  return rows.join('');
}
function vehTipHtml(key) {
  const e = PICK.get(key); if (!e) return '';
  let icon, body;
  if (e.kind === 'mission') { icon = VEH_ICON[e.ref.vehicle]; body = missionTip(e.ref); }
  else if (e.kind === 'transit') {
    const r = e.ref, i = transitInfo(r);
    icon = i.kind === t('leg_bus') ? '🚌' : i.kind === t('tip_tram') ? '🚋' : '🚆';
    body = `<div class="tt-st">${t('status_driving')}</div><div class="tt-dim">${t('tip_dep')} <b>${clock(r[1])}</b> → ${t('eta')} <b>${clock(r[2])}</b> · ${Math.max(0, Math.ceil(r[2] - S.t))} ${t('min')} ${t('tip_left')}</div>`
      + `<div class="tt-src est">${t('tip_synthetic')}</div>`;
  } else {
    const [m0, kind, , city] = e.ref;
    icon = '✈️';
    body = `<div class="tt-st">${kind === 'dep' ? `${t('tip_took_off')} ${clock(m0)} ${t('tip_from')} Småland Airport` : `${t('tip_lands')} ${clock(m0)}, Småland Airport`}</div>`
      + `<div class="tt-src est">${t('tip_illustrative')}</div>`;
  }
  const hint = S.follow === key ? t('tip_following') : t('tip_follow');
  return `<div class="tt-h"><span class="ico">${icon}</span>${vehTitle(e)}</div>${body}<div class="tt-hint">${hint}</div>`;
}
let _hoverKey = null, _mouse = null;
function updateHover() {
  const tip = document.getElementById('vehTip');
  const key = _mouse ? pickAt(_mouse[0], _mouse[1]) : null;
  _hoverKey = key;
  map.getCanvas().style.cursor = key ? 'pointer' : '';
  if (!key) { tip.classList.add('hidden'); return; }
  const html = vehTipHtml(key);
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.classList.remove('hidden');
  const W = window.innerWidth, H = window.innerHeight, w = tip.offsetWidth, h = tip.offsetHeight;
  const c = map.getCanvas().getBoundingClientRect();
  let x = c.left + _mouse[0] + 16, y = c.top + _mouse[1] + 16;
  if (x + w > W - 8) x = c.left + _mouse[0] - w - 16;
  if (y + h > H - 8) y = c.top + _mouse[1] - h - 16;
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
}
/** Ring drawn in screen space around the followed (and hovered) vehicle. */
function updateRing() {
  for (const [id, key] of [['selRing', S.follow], ['hoverRing', _hoverKey !== S.follow ? _hoverKey : null]]) {
    const el = document.getElementById(id); if (!el) continue;
    const e = key && PICK.get(key), s = e && screenOf(e.x, e.y, e.z);
    if (!s) { el.classList.add('hidden'); continue; }
    const d = Math.max(26, Math.min(70, 2.2 * e.r / vehicleScales().mpp));
    el.classList.remove('hidden');
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${s[0] - d / 2}px, ${s[1] - d / 2}px)`;
  }
}
/** Frame whatever is happening right now: every unit that is moving, plus
 *  the crash site while people are working there. Falls back to the current
 *  event's camera when nothing moves. */
function focusAction() {
  setFollow(null);
  const pts = [];
  let atScene = false;
  for (const m of missions) {
    const p = m._pose; if (!p) continue;
    if (['enroute', 'transport', 'driving'].includes(p.phase) && p.seg.type !== 'hold') {
      const ll = toLngLat(p.x, p.z); pts.push([ll.lng, ll.lat]);
    }
    if (p.phase === 'onscene' || (p.phase === 'crashed' && S.t < S.scene.meta.t_crash + 3)) atScene = true;
  }
  const P = S.scene.places;
  if (atScene) pts.push([P.crash.lon, P.crash.lat]);
  if (!pts.length) { const i = currentEventIdx(S.t); return camera(i >= 0 ? events[i].cam : 'city'); }
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  for (const q of pts) b.extend(q);
  map.fitBounds(b, { padding: 70, maxZoom: pts.length === 1 ? 14.5 : 15.5, pitch: 45,
                     bearing: map.getBearing(), duration: 1800, essential: true });
}
function setCompact(on) {
  document.body.classList.toggle('compact', on);
  const b = document.getElementById('btnCompact');
  b.textContent = on ? '⟨' : '⟩';
  b.title = t(on ? 'expand_panel' : 'compact_panel');
  try { localStorage.setItem('rv25.compact', on ? '1' : ''); } catch (_) { /* ignore */ }
  map.setPadding(padding());
}

function buildChapters() {
  const ol = document.getElementById('chapterList'); ol.innerHTML = '';
  events.forEach((e, i) => {
    const li = document.createElement('li'); li.className = e.kind;
    const strip = s => s.replace(/^\d\d[.:]\d\d – /, '');
    li.title = `${clock(e.t)} ${pick(e, 'title')}`;
    li.innerHTML = `<span class="tt">${clock(e.t)}</span><span>${strip(pick(e, 'title'))}${bilingual() ? `<em class="tr-li">${strip(e.title_en)}</em>` : ''}</span>`;
    li.onclick = () => { seek(e.t + 0.01); S.lastEventIdx = i; showCard(i, true); autoCamera(e.cam); };
    ol.appendChild(li);
  });
  buildTicks();
}
function currentEventIdx(tt) {
  let k = -1;
  for (let i = 0; i < events.length; i++) if (events[i].t <= tt) k = i;
  return k;
}
function showCard(i, animate) {
  const card = document.getElementById('eventCard');
  if (i < 0) {
    card.innerHTML = `<div class="meta"><span class="time">${clock(S.scene.meta.t_start)}</span></div>
      <h3>${pick(S.scene.meta, 'title')}</h3><p>${introText()}</p>${bilingual() ? `<div class="tr"><span>${t('translation')}</span><h4>${S.scene.meta.title_en}</h4><p>${introText('en')}</p></div>` : ''}`;
  } else {
    const e = events[i];
    card.innerHTML = `<div class="meta"><span class="badge ${e.kind}" title="${t(e.kind === 'doc' ? 'documented_tip' : 'estimated_tip')}">${t(e.kind === 'doc' ? 'documented' : 'estimated')}</span>
      <span class="time">${clock(e.t)}${e.kind === 'est' ? ' ≈' : ''}</span></div>
      <h3>${pick(e, 'title')}</h3><p>${pick(e, 'body')}</p>${bilingual() ? `<div class="tr"><span>${t('translation')}</span><h4>${e.title_en}</h4><p>${e.body_en}</p></div>` : ''}<div class="src">${t('source')}: ${e.src}</div>`;
  }
  if (animate) { card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter'); }
  document.querySelectorAll('#chapterList li').forEach((li, j) => {
    li.classList.toggle('past', j < i); li.classList.toggle('cur', j === i);
    if (j === i && animate) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}
const introText = (l = lang()) => l === 'sv'
  ? 'Kartan återskapar händelseförloppet från olyckan på riksväg 25 till att patienterna togs emot på sjukhusen. Tryck ▶ för att starta. Grönt = dokumenterat i publicerade källor, orange = uppskattat.'
  : 'The map reconstructs the sequence from the crash on Rv 25 until patients were received at the hospitals. Press ▶ to start. Green = documented in published sources, orange = estimated.';

// ── Timeline ───────────────────────────────────────────────────────────────
const T0 = () => S.scene.meta.t_start, T1 = () => S.scene.meta.t_end;
const frac = tt => (tt - T0()) / (T1() - T0());
function buildTicks() {
  const ticks = document.getElementById('trackTicks'); ticks.innerHTML = '';
  for (const e of events) {
    const d = document.createElement('div'); d.className = `tick ${e.kind}`;
    d.style.left = `${frac(e.t) * 100}%`; d.dataset.label = `${clock(e.t)} ${pick(e, 'title').replace(/^\d\d[.:]\d\d – /, '')}`;
    ticks.appendChild(d);
  }
  const hours = document.getElementById('trackHours'); hours.innerHTML = '';
  for (let h = Math.ceil(T0() / 60); h <= Math.floor(T1() / 60); h++) {
    const d = document.createElement('div'); d.className = 'hour'; d.style.left = `${frac(h * 60) * 100}%`;
    d.textContent = clock(h * 60); hours.appendChild(d);
  }
}
function initTrack() {
  const track = document.getElementById('track');
  let drag = false;
  const at = ev => { const r = track.getBoundingClientRect(); return T0() + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (T1() - T0()); };
  track.addEventListener('pointerdown', ev => { drag = true; track.setPointerCapture(ev.pointerId); seek(at(ev)); });
  track.addEventListener('pointermove', ev => { if (drag) seek(at(ev)); });
  track.addEventListener('pointerup', () => {
    drag = false;
    const i = currentEventIdx(S.t); S.lastEventIdx = i; showCard(i, true);
    if (S.story && i >= 0) autoCamera(events[i].cam);
  });
}
function seek(tt) {
  S.t = Math.max(T0(), Math.min(T1(), tt));
  S.dwellUntil = 0;
  const i = currentEventIdx(S.t);
  if (i !== S.lastEventIdx && events.length) showCard(i, false);
  S.lastEventIdx = i;
  S.lastTrailT = -1;
}

// ── Gantt ──────────────────────────────────────────────────────────────────
let ganttRows = [], ganttHover = -1;
const G_RH = 14, G_LW = 210;   // G_LW matches body.gantt-open .track-wrap padding
/** time → x on the Gantt canvas, aligned to the main track's pixels. */
function ganttX() {
  const tr = document.getElementById('track').getBoundingClientRect();
  const cr = document.getElementById('gantt').getBoundingClientRect();
  const x0 = tr.left - cr.left, w = tr.width;
  const X = tt => x0 + frac(tt) * w;
  X.inv = x => T0() + (x - x0) / w * (T1() - T0());
  X.x0 = x0;
  return X;
}
function drawGantt() {
  const wrap = document.getElementById('ganttWrap');
  if (wrap.classList.contains('hidden')) return;
  const cv = document.getElementById('gantt'), dpr = window.devicePixelRatio || 1;
  const rows = ganttRows = [...document.querySelectorAll('.unit-row')].map(r => missions.find(m => m.id === r.dataset.id));
  const W = cv.clientWidth || wrap.clientWidth, H = rows.length * G_RH + 6, RH = G_RH;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = `${H}px`; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const X = ganttX();   // same pixels as the main track above
  g.font = '10.5px Segoe UI, sans-serif'; g.textBaseline = 'middle';
  for (let h = Math.ceil(T0() / 60); h <= Math.floor(T1() / 60); h++) {
    g.fillStyle = 'rgba(148,163,184,.15)'; g.fillRect(X(h * 60), 0, 1, H);
  }
  for (const e of events) {   // faint guides under the event ticks
    g.fillStyle = e.estimated ? 'rgba(245,158,11,.10)' : 'rgba(34,197,94,.10)'; g.fillRect(X(e.t), 0, 1, H);
  }
  rows.forEach((m, r) => {
    const y = r * RH + 2;
    if (S.follow === m.id || r === ganttHover) {
      g.fillStyle = S.follow === m.id ? 'rgba(250,204,21,.22)' : 'rgba(148,163,184,.14)';
      g.fillRect(0, y, W, RH);
    }
    g.fillStyle = S.follow === m.id ? '#facc15' : '#cbd5e1'; g.fillText(`${VEH_ICON[m.vehicle]} ${pick(m, '')}`.slice(0, 34), 4, y + RH / 2);
    for (const s of m.seq) {
      if (s.phase === 'idle' || s.phase === 'parked') continue;
      let c = s.phase === 'onscene' ? '#94a3b8' : s.phase === 'handover' ? '#475569' : s.phase === 'crashed' ? '#ef4444' : segColor(m, s);
      if (s.phase === 'driving') c = VEH_COLOR.bus845;
      const x0 = X(Math.max(T0(), s.t0)), x1 = X(Math.min(T1(), s.t1));
      if (x1 <= x0) continue;
      g.globalAlpha = s.t0 <= S.t ? 1 : 0.28;
      g.fillStyle = c; g.fillRect(x0, y + 3, Math.max(1.5, x1 - x0), RH - 6);
    }
    g.globalAlpha = 1;
  });
  g.fillStyle = '#fff'; g.fillRect(X(S.t) - 1, 0, 2, H);
}

// ── Day / night ────────────────────────────────────────────────────────────
// Växjö 5 Oct: sunset ≈ 18.36, civil dusk ≈ 19.13.
function updateLight() {
  const day = 1 - smooth(18 * 60 + 15, 19 * 60 + 20, S.t);
  map.setPaintProperty('osm-tiles', 'raster-brightness-max', 0.3 + 0.52 * day);
  map.setPaintProperty('buildings', 'fill-extrusion-color', day > 0.5 ? '#cbd5e1' : day > 0.15 ? '#94a3b8' : '#64748b');
  if (lights) { lights.hemi.intensity = 0.9 + 0.7 * day; lights.sun.intensity = 0.5 + 1.0 * day; }
  const dn = document.getElementById('dayNight');
  dn.textContent = lang() === 'sv'
    ? (S.t < 18 * 60 + 36 ? 'Solnedgång 18.36' : S.t < 19 * 60 + 13 ? 'Skymning' : 'Mörker')
    : (S.t < 18 * 60 + 36 ? 'Sunset 18:36' : S.t < 19 * 60 + 13 ? 'Dusk' : 'Dark');
}

// ── Main loop ──────────────────────────────────────────────────────────────
let lastReal = performance.now(), lastUi = 0, lastLight = -1;
/** Story-mode clock multiplier: fast through quiet stretches, easing down
 *  to real pace during the last ~1.5 min before each event. */
function storyFactor(tt) {
  if (!S.story) return 1;
  const base = tt > 19 * 60 + 50 ? 5 : tt > 18 * 60 + 45 ? 2.5 : 1;
  const nxt = events.find(e => e.t > tt + 1e-6);
  const gap = nxt ? nxt.t - tt : Infinity;
  return Math.max(base, 1 + 4 * smooth(1.5, 6, gap));
}
// While an event card is fresh the clock creeps in slow motion instead of
// freezing, so e.g. the rollover plays out under its card.
const DWELL_RATE = 0.12;
function tick(now) {
  const dt = Math.min(0.1, (now - lastReal) / 1000); lastReal = now;
  if (S.playing) {
    const prev = S.t;
    const rate = now < S.dwellUntil ? DWELL_RATE * Math.min(1, S.speed) : S.speed * storyFactor(S.t);
    S.t = Math.min(T1(), S.t + dt * rate);
    // Event crossing → card, camera, short dwell.
    const i = currentEventIdx(S.t);
    if (i !== S.lastEventIdx && i >= 0 && events[i].t > prev - 1e-6) {
      S.lastEventIdx = i; showCard(i, true);
      if (S.story) {
        autoCamera(events[i].cam);
        S.dwellUntil = now + 1000 * Math.min(5.5, 2.5 + pick(events[i], 'body').length / 110) / Math.sqrt(S.speed);
      }
    }
    if (S.t >= T1()) setPlaying(false);
    directorTick(now);
  }
  // Follow: recentre, but never while the user is touching the map.
  if (S.follow) {
    const e = PICK.get(S.follow);
    if (!e && !missions.some(q => q.id === S.follow)) setFollow(null);   // trip/flight ended
    else if (e && now - S.lastUserInput > 600 && !map.isMoving()) map.setCenter(toLngLat(e.x, e.z));
  }
  updateRing();
  // UI at ~10 Hz
  if (now - lastUi > 100) {
    lastUi = now;
    document.getElementById('clock').textContent = clock(S.t);
    if (_mouse) updateHover();
    document.getElementById('clockDate').textContent = S.t >= 1440
      ? `${t('weekday_tue')} 6 ${t('month_oct')}` : `${t('weekday_mon')} 5 ${t('month_oct')}`;
    const f = frac(S.t) * 100;
    document.getElementById('playhead').style.left = `${f}%`;
    document.getElementById('trackFill').style.width = `${f}%`;
    if (Math.abs(S.t - S.lastTrailT) > 0.05) { updateTrails(); S.lastTrailT = S.t; }
    updateHospPanel(); updateUnitPanel(); updateVehicleLabels(); drawGantt();
    placeMarkers.crash.el.style.display = S.t >= S.scene.meta.t_crash ? '' : 'none';
    const crashed = S.t >= S.scene.meta.t_crash;
    document.querySelector('.tally').style.opacity = crashed ? 1 : 0;
    document.getElementById('tallyKilled').parentElement.style.display = S.t >= 21 * 60 + 28 ? '' : 'none';
    if (Math.abs(S.t - lastLight) > 0.5) { updateLight(); lastLight = S.t; }
  }
  map.triggerRepaint();
  requestAnimationFrame(tick);
}
function setPlaying(on) {
  if (on && S.t >= T1()) seek(T0());
  S.playing = on;
  const b = document.getElementById('btnPlay');
  b.textContent = on ? '❚❚' : '▶'; b.title = t(on ? 'pause' : 'play');
  if (!on) S.dwellUntil = 0;
}
function jumpEvent(dir) {
  const i = currentEventIdx(S.t - (dir < 0 ? 0.02 : 0)) + (dir > 0 ? 1 : (S.t - events[Math.max(0, currentEventIdx(S.t))]?.t < 0.5 ? -1 : 0));
  const k = Math.max(0, Math.min(events.length - 1, i));
  seek(events[k].t + 0.01); S.lastEventIdx = k; showCard(k, true); autoCamera(events[k].cam);
}

// ── UI wiring ──────────────────────────────────────────────────────────────
function buildLegend() {
  const L = document.getElementById('legend');
  const item = (sw, label) => `<div class="li">${sw}<span>${label}</span></div>`;
  const line = c => `<span class="sw" style="background:${c}"></span>`;
  L.innerHTML = [
    item(line(VEH_COLOR.ambulance), `${t('leg_ambulance')} · ${t('status_enroute').toLowerCase()}`),
    item(line(PLACE_COLOR.vxo_hosp), `${t('leg_scene_hosp')}`),
    item(line(VEH_COLOR.helicopter), t('leg_heli')),
    item(line(VEH_COLOR.fire), t('leg_fire')),
    item(line(VEH_COLOR.police), t('leg_police')),
    item(line(VEH_COLOR.bus), t('light_injured_n')),
    item(`<span class="sw dash" style="color:#ef4444"></span>`, t('leg_closure')),
    item(`<span class="sw dot" style="background:#ef4444"></span>`, t('leg_crash')),
    item(`<span class="sw" style="background:#64748b"></span>`, t('status_returning')),
    item(`<span class="sw dot" style="border:1.5px dashed #fff;background:#334155"></span>`, t('leg_approx')),
  ].join('');
}
function relabelAll() {
  applyStatic(); buildLegend(); buildHospPanel(); buildUnitPanel(); buildChapters();
  showCard(S.lastEventIdx, false); refreshMarkerLabels(); updateLight(); updateUnitPanel(true);
  // Publications only (skip 'time modelled' notes), sorted.
  document.getElementById('sourceList').innerHTML = [...new Set(events.flatMap(e => e.src.split(/;\s*/))
    .map(s => s.trim()).filter(s => s && !/modell|^tid|^time/i.test(s)))]
    .sort((a, b) => a.localeCompare(b, 'sv')).map(s => `<li>${s}</li>`).join('');
  document.getElementById('btnPlay').title = t(S.playing ? 'pause' : 'play');
}
function wireUI() {
  document.getElementById('btnPlay').onclick = () => setPlaying(!S.playing);
  document.querySelectorAll('#speedGroup button').forEach(b => b.onclick = () => {
    S.speed = +b.dataset.speed;
    document.querySelectorAll('#speedGroup button').forEach(q => q.classList.toggle('on', q === b));
  });
  document.getElementById('chkStory').onchange = e => { S.story = e.target.checked; };
  let ac = true;
  try { ac = localStorage.getItem('rv25.autocam') !== '0'; } catch (_) { /* private mode */ }
  setAutoCam(ac);
  document.getElementById('chkAutoCam').onchange = e => setAutoCam(e.target.checked);
  const modes = ['sv', 'en', 'both'];
  const applyLang = l => {
    setLang(l); relabelAll();
    document.querySelectorAll('#langSwitch button').forEach(b => b.classList.toggle('on', b.dataset.lang === l));
  };
  document.querySelectorAll('#langSwitch button').forEach(b => b.onclick = () => applyLang(b.dataset.lang));
  applyLang(langMode());
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyL' && e.target.tagName !== 'INPUT') applyLang(modes[(modes.indexOf(langMode()) + 1) % 3]);
  });
  document.getElementById('btnGantt').onclick = () => {
    const w = document.getElementById('ganttWrap'); w.classList.toggle('hidden');
    document.body.classList.toggle('gantt-open', !w.classList.contains('hidden'));
    document.getElementById('btnGantt').classList.toggle('on', !w.classList.contains('hidden'));
    drawGantt();
  };
  // Per-unit timeline: click a unit's name to follow it; click one of its
  // bars to jump there and follow it; click empty track to just seek.
  const gcv = document.getElementById('gantt');
  const ganttHit = ev => {
    const r = gcv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const row = Math.floor((y - 2) / G_RH), m = ganttRows[row];
    const X = ganttX(), tt = X.inv(x);
    const inBars = tt >= T0() && tt <= T1();
    const seg = m && inBars ? m.seq.find(s => s.phase !== 'idle' && s.phase !== 'parked' && tt >= s.t0 - 1 && tt <= s.t1 + 1) : null;
    return { row: m ? row : -1, m, label: x < X.x0 - 4, inBars, tt, seg };
  };
  gcv.addEventListener('click', ev => {
    const h = ganttHit(ev);
    if (h.m && h.label) { setFollow(S.follow === h.m.id ? null : h.m.id); drawGantt(); return; }
    if (!h.inBars) return;
    seek(h.tt);
    if (h.seg) setTimeout(() => { setFollow(h.m.id); drawGantt(); }, 80);   // after a frame has posed it
  });
  gcv.addEventListener('mousemove', ev => {
    const h = ganttHit(ev);
    if (h.row !== ganttHover) { ganttHover = h.row; drawGantt(); }
    gcv.style.cursor = (h.m && (h.label || h.seg)) ? 'pointer' : h.inBars ? 'col-resize' : '';
    if (!h.m) { gcv.title = ''; return; }
    const what = h.seg ? `
${clock(h.seg.t0)}–${clock(h.seg.t1)} · ${t('status_' + (h.seg.phase === 'onscene' ? 'onscene' : h.seg.phase))}`
      + (h.seg.dest ? ` → ${placeName(h.seg.dest)}` : '') : '';
    gcv.title = `${pick(h.m, '')}${what}
${h.label ? t('tip_follow') : h.seg ? t('gantt_seg_tip') : ''}`;
  });
  gcv.addEventListener('mouseleave', () => { ganttHover = -1; drawGantt(); });
  document.getElementById('btnLegend').onclick = () => {
    const L = document.getElementById('legend'); L.classList.toggle('hidden');
    document.getElementById('btnLegend').classList.toggle('on', !L.classList.contains('hidden'));
  };
  const about = document.getElementById('about');
  const showAbout = on => {
    about.classList.toggle('hidden', !on);
    if (!on && location.hash === '#about') history.replaceState(null, '', location.pathname + location.search);
  };
  document.getElementById('btnAbout').onclick = () => showAbout(true);
  document.getElementById('aboutClose').onclick = () => showAbout(false);
  about.addEventListener('click', e => { if (e.target === about) showAbout(false); });
  window.addEventListener('hashchange', () => { if (location.hash === '#about') showAbout(true); });
  if (location.hash === '#about') showAbout(true);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); jumpEvent(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); jumpEvent(-1); }
    else if (e.code === 'Escape') { setFollow(null); showAbout(false); }
    else if (e.code === 'KeyF') focusAction();
    else if (e.code === 'KeyC') setAutoCam(!S.autoCam);
    else if (e.code === 'KeyT') setCompact(!document.body.classList.contains('compact'));
  });
  // A mouse/touch press on the map ends follow mode; the wheel only pauses
  // it so you can zoom while following.
  const cv = map.getCanvasContainer();
  const stopFollow = () => { if (S.follow) setFollow(null); };
  cv.addEventListener('mousedown', () => { S.lastUserInput = performance.now(); stopFollow(); });
  cv.addEventListener('touchstart', stopFollow, { passive: true });
  cv.addEventListener('wheel', () => { S.lastUserInput = performance.now(); }, { passive: true });
  // Hover any vehicle for details; click it to follow (click empty map = release).
  cv.addEventListener('mousemove', ev => {
    const r = map.getCanvas().getBoundingClientRect();
    _mouse = [ev.clientX - r.left, ev.clientY - r.top]; updateHover();
  });
  cv.addEventListener('mouseleave', () => { _mouse = null; updateHover(); });
  map.on('click', ev => {
    const key = pickAt(ev.point.x, ev.point.y);
    if (key) { S.lastUserInput = 0; setFollow(key); updateHover(); }
  });
  document.querySelector('#followChip button').onclick = () => setFollow(null);
  document.getElementById('btnFocus').onclick = focusAction;
  document.getElementById('btnCompact').onclick = () => setCompact(!document.body.classList.contains('compact'));
  map.on('zoomend', refreshMarkerLabels);
  window.addEventListener('resize', () => { map.setPadding(padding()); drawGantt(); });
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function main() {
  const sc = await (await fetch('data/scene.json')).json();
  S.scene = sc; S.t = sc.meta.t_start; events = sc.events;
  const crash = [sc.places.crash.lon, sc.places.crash.lat];
  O = maplibregl.MercatorCoordinate.fromLngLat(crash, 0);
  OS = O.meterInMercatorCoordinateUnits();
  for (const [name, r] of Object.entries(sc.routes)) routes[name] = prepLine(r.coords);
  missions = prepMissions(sc);
  for (const l of sc.transit.lines) {
    const key = l.type === 'tram' ? 'tram' : l.type === 'train' ? (l.intercity ? 'train_ic' : 'train') : `bus_${l.city}`;
    transitLines.set(l.id, { key, P: prepLine(l.coords) });
  }
  sc.flights._ap = toLocal(sc.flights.airport);

  map = new maplibregl.Map({
    container: 'map', style: baseStyle(), antialias: true, maxPitch: 78,
    center: [sc.places.vxo_resc.lon - 0.03, sc.places.vxo_resc.lat + 0.006], zoom: 12.6, pitch: 55, bearing: -70,
  });
  map.on('load', () => {
    addMapLayers(sc);
    map.addLayer(threeLayer());
    buildPlaceMarkers(sc);
    wireUI(); initTrack(); relabelAll();
    let compact = false;
    try { compact = !!localStorage.getItem('rv25.compact'); } catch (_) { /* ignore */ }
    setCompact(compact);
    document.getElementById('loading').classList.add('hidden');
    requestAnimationFrame(tick);
  });
  window.__rv25 = { S, map, missions, seek, setPlaying, camera, PICK: () => PICK, screenOf, setFollow };   // for capture scripts
}
main();
