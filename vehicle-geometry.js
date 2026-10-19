/**
 * vehicle-geometry.js — 3D vehicle meshes lifted verbatim from EpiCity
 * (static/transport.js: palettes + _build*Geometry). Each builder returns a
 * single merged BufferGeometry with per-vertex colour, +Z = forward, Y = up,
 * in metres. Do not edit here without porting back; see EpiCity for history.
 */
import * as THREE from 'three';


const _CSS_COLORS = {
  red: 0xff0000, blue: 0x0000ff, green: 0x008000, yellow: 0xffff00,
  gold: 0xffd700, white: 0xffffff, black: 0x000000, orange: 0xffa500,
  grey: 0x808080, silver: 0xc0c0c0, purple: 0x800080, pink: 0xffc0cb,
};

function _hexToInt(hex) {
  if (typeof hex === 'number') return hex;
  if (!hex) return null;
  const s = String(hex).trim().toLowerCase();
  if (_CSS_COLORS[s] !== undefined) return _CSS_COLORS[s];
  const n = parseInt(s.replace(/^#/, ''), 16);
  return isNaN(n) ? null : n;
}

function _darkenCol(color, factor) {
  const r = ((color >> 16) & 0xff) * factor;
  const g = ((color >> 8) & 0xff) * factor;
  const b = (color & 0xff) * factor;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function _lightenCol(color, factor) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return (Math.round(r + (255 - r) * factor) << 16) |
         (Math.round(g + (255 - g) * factor) << 8) |
         Math.round(b + (255 - b) * factor);
}

function _clampBrightness(color, minBrightness) {
  // Ensure a colour has at least *minBrightness* (0-255) in its max channel
  // so very dark brand colours (pure black) still produce visible vehicles.
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mx = Math.max(r, g, b);
  if (mx >= minBrightness) return color;
  const boost = minBrightness / Math.max(mx, 1);
  return (Math.min(255, Math.round(r * boost + 30)) << 16) |
         (Math.min(255, Math.round(g * boost + 30)) << 8) |
         Math.min(255, Math.round(b * boost + 30));
}

function _deriveBusPalette(bodyColor) {
  const c = _clampBrightness(bodyColor, 50);
  return {
    BODY: c, LOWER: _darkenCol(c, 0.45),
    WINDOW: 0x1e293b, BUMPER: 0x292524, WHEEL: 0x1c1917,
    GRILLE: 0x44403c, ROOF_AC: 0x78716c, MIRROR: 0x44403c,
    STRIPE: _lightenCol(c, 0.6),
  };
}

function _deriveTrainPalette(bodyColor) {
  const c = _clampBrightness(bodyColor, 50);
  return {
    BODY: c, STRIPE: _lightenCol(c, 0.55),
    WINDOW: 0x111827, BOGIE: 0x1c1917,
    ROOF: _lightenCol(c, 0.45), LOWER: _darkenCol(c, 0.55),
    CAB_FACE: c, CHEVRON: _lightenCol(c, 0.7),
    HEADLIGHT: 0xfef3c7,
  };
}

// Default palettes — exact replicas of the original hardcoded values
const _DEFAULT_BUS_PALETTES = [
  { BODY: 0xdc2626, LOWER: 0x7f1d1d, WINDOW: 0x1e293b, BUMPER: 0x292524,
    WHEEL: 0x1c1917, GRILLE: 0x44403c, ROOF_AC: 0x78716c, MIRROR: 0x44403c,
    STRIPE: 0xffffff },
  { BODY: 0x15803d, LOWER: 0x0a4d25, WINDOW: 0x1e293b, BUMPER: 0x1c1917,
    WHEEL: 0x1c1917, GRILLE: 0x374151, ROOF_AC: 0x6b7280, MIRROR: 0x374151,
    STRIPE: 0xa3e635 },
  { BODY: 0xea580c, LOWER: 0x9a3412, WINDOW: 0x1e293b, BUMPER: 0x292524,
    WHEEL: 0x1c1917, GRILLE: 0x44403c, ROOF_AC: 0x78716c, MIRROR: 0x374151,
    STRIPE: 0xfbbf24 },
];
const _DEFAULT_TRAIN_PALETTES = [
  { BODY: 0x3b5bdb, STRIPE: 0xc0c0c0, WINDOW: 0x111827, BOGIE: 0x1c1917,
    ROOF: 0x94a3b8, LOWER: 0x374151, CAB_FACE: 0x3b5bdb,
    CHEVRON: 0xfbbf24, HEADLIGHT: 0xfef3c7 },
  { BODY: 0xd1d5db, STRIPE: 0x1d4ed8, WINDOW: 0x111827, BOGIE: 0x1c1917,
    ROOF: 0x9ca3af, LOWER: 0x4b5563, CAB_FACE: 0xb0b8c4,
    CHEVRON: 0x1d4ed8, HEADLIGHT: 0xfef3c7 },
  { BODY: 0xf1f5f9, STRIPE: 0x2563eb, WINDOW: 0x111827, BOGIE: 0x1c1917,
    ROOF: 0xcbd5e1, LOWER: 0x64748b, CAB_FACE: 0xe2e8f0,
    CHEVRON: 0x2563eb, HEADLIGHT: 0xfef3c7 },
];
const _DEFAULT_TRAM_COLOR  = 0x16a34a;
const _DEFAULT_PLANE_COLOR = 0x65a30d;

let _busPalettes   = _DEFAULT_BUS_PALETTES.slice();
let _trainPalettes = _DEFAULT_TRAIN_PALETTES.slice();
let _tramBodyColor  = _DEFAULT_TRAM_COLOR;
let _planeBodyColor = _DEFAULT_PLANE_COLOR;

const _tmpMat = new THREE.Matrix4();
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _tmpEuler = new THREE.Euler();

// ── Procedural vehicle geometries ────────────────────────────────────────────

function _buildPlaneGeometry() {
  // High-poly regional jet (~10k faces). Based on reference model sheet:
  // rounded fuselage, swept wings, underwing hex-cylinder engine pods on
  // struts, T-tail with high horizontal stabilisers, dual landing gear,
  // window rows, doors as flat polys.
  const BODY     = _planeBodyColor;               // operator brand fuselage
  const BELLY    = 0x9ca3af;                      // grey belly panel
  const WINDOW   = 0x1e293b;                      // dark glass
  const NOSE_TIP = 0x334155;                      // dark radome
  const WING     = _lightenCol(_planeBodyColor, 0.3); // muted wing
  const TAIL_FIN = _darkenCol(_planeBodyColor, 0.6);  // darker fin
  const ENGINE   = 0x374151;                      // dark engine cowl
  const EXHAUST  = 0x1f2937;                      // exhaust nozzle
  const GEAR     = 0x292524;                      // landing gear dark
  const DOOR     = _darkenCol(_planeBodyColor, 0.5);  // door
  const HS = 32;  // high segment count for smooth round sections
  const p = [];

  // ═══════════════════════════════════════════════════════════════════════
  // 1. FUSELAGE — multi-section tapered cylinder for smooth body
  // ═══════════════════════════════════════════════════════════════════════

  // Main fuselage barrel (constant cross-section)
  const fusMain = new THREE.CylinderGeometry(1.15, 1.15, 12.0, HS, 1);
  fusMain.rotateX(Math.PI / 2);
  fusMain.translate(0, 1.15, 0);
  p.push({ geo: fusMain, color: BODY });

  // Forward fuselage taper (wider → nose)
  const fusFwd = new THREE.CylinderGeometry(0.75, 1.15, 3.0, HS, 1);
  fusFwd.rotateX(Math.PI / 2);
  fusFwd.translate(0, 1.15, 7.5);
  p.push({ geo: fusFwd, color: BODY });

  // Nose cone (rounded tip — sphere-like)
  const noseCone = new THREE.CylinderGeometry(0.10, 0.75, 2.0, HS, 1);
  noseCone.rotateX(Math.PI / 2);
  noseCone.translate(0, 1.15, 10.0);
  p.push({ geo: noseCone, color: BODY });
  // Radome tip sphere
  const radome = new THREE.SphereGeometry(0.14, HS, HS);
  radome.translate(0, 1.15, 10.95);
  p.push({ geo: radome, color: NOSE_TIP });

  // Aft fuselage taper (barrel → tail)
  const fusAft = new THREE.CylinderGeometry(0.50, 1.15, 4.5, HS, 1);
  fusAft.rotateX(Math.PI / 2);
  fusAft.translate(0, 1.15, -8.25);
  p.push({ geo: fusAft, color: BODY });

  // Tail cone / APU exhaust
  const tailCone = new THREE.CylinderGeometry(0.08, 0.50, 1.5, HS, 1);
  tailCone.rotateX(Math.PI / 2);
  tailCone.translate(0, 1.15, -11.25);
  p.push({ geo: tailCone, color: EXHAUST });

  // Belly fairing (flattened underside strip)
  const belly = new THREE.BoxGeometry(1.8, 0.10, 13.0);
  belly.translate(0, 0.02, -0.5);
  p.push({ geo: belly, color: BELLY });

  // Upper fuselage spine highlight (subtle ridge)
  const spine = new THREE.BoxGeometry(0.3, 0.06, 12.0);
  spine.translate(0, 2.28, 0);
  p.push({ geo: spine, color: BODY });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. COCKPIT WINDSHIELD — multi-pane wraparound
  // ═══════════════════════════════════════════════════════════════════════

  // Four windshield panes (2 upper, 2 lower)
  for (const dx of [-0.22, 0.22]) {
    // Upper pane
    const upPane = new THREE.BoxGeometry(0.38, 0.30, 0.5);
    upPane.translate(dx, 1.72, 8.9);
    p.push({ geo: upPane, color: WINDOW });
    // Lower pane
    const loPane = new THREE.BoxGeometry(0.40, 0.25, 0.45);
    loPane.translate(dx, 1.42, 9.0);
    p.push({ geo: loPane, color: WINDOW });
  }
  // Centre divider frame
  const cDiv = new THREE.BoxGeometry(0.04, 0.55, 0.55);
  cDiv.translate(0, 1.57, 8.95);
  p.push({ geo: cDiv, color: BODY });
  // Horizontal divider
  const hDiv = new THREE.BoxGeometry(0.84, 0.04, 0.5);
  hDiv.translate(0, 1.55, 8.95);
  p.push({ geo: hDiv, color: BODY });
  // Side cockpit windows (one per side)
  for (const dx of [-0.62, 0.62]) {
    const sideW = new THREE.BoxGeometry(0.06, 0.22, 0.35);
    sideW.translate(dx, 1.60, 8.6);
    p.push({ geo: sideW, color: WINDOW });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. PASSENGER WINDOWS — individual oval panes both sides
  // ═══════════════════════════════════════════════════════════════════════

  const winCount = 28;
  const winStart = -5.5;
  const winEnd = 6.0;
  const winSpacing = (winEnd - winStart) / winCount;
  for (let i = 0; i < winCount; i++) {
    const wz = winStart + i * winSpacing + winSpacing / 2;
    for (const dx of [-1.13, 1.13]) {
      // Each window is a small cylinder (round shape) for higher fidelity
      const win = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8);
      win.rotateZ(Math.PI / 2);
      win.translate(dx, 1.55, wz);
      p.push({ geo: win, color: WINDOW });
      // Window frame ring (slightly larger)
      const frame = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8);
      frame.rotateZ(Math.PI / 2);
      frame.translate(dx, 1.55, wz);
      p.push({ geo: frame, color: BODY });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. DOORS — flat polys with frames (2 per side: forward + aft)
  // ═══════════════════════════════════════════════════════════════════════

  for (const dz of [5.0, -2.5]) {
    for (const dx of [-1.16, 1.16]) {
      const sign = dx > 0 ? 1 : -1;
      // Door panel
      const door = new THREE.BoxGeometry(0.05, 1.1, 0.55);
      door.translate(dx, 0.95, dz);
      p.push({ geo: door, color: DOOR });
      // Door frame (outline)
      const frameT = new THREE.BoxGeometry(0.05, 0.05, 0.58);
      frameT.translate(dx, 1.52, dz);
      p.push({ geo: frameT, color: BODY });
      const frameB = new THREE.BoxGeometry(0.05, 0.05, 0.58);
      frameB.translate(dx, 0.40, dz);
      p.push({ geo: frameB, color: BODY });
      // Door window (small rectangle at top)
      const dWin = new THREE.BoxGeometry(0.05, 0.25, 0.30);
      dWin.translate(dx, 1.35, dz);
      p.push({ geo: dWin, color: WINDOW });
      // Door handle
      const handle = new THREE.BoxGeometry(0.06, 0.04, 0.12);
      handle.translate(dx + sign * 0.01, 0.95, dz + 0.15);
      p.push({ geo: handle, color: BELLY });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. T-TAIL ASSEMBLY — tall vertical fin + high horizontal stabilisers
  // ═══════════════════════════════════════════════════════════════════════

  // Vertical fin (tapered: thinner at top)
  const finMain = new THREE.BoxGeometry(0.16, 3.6, 2.8);
  finMain.translate(0, 3.5, -9.2);
  p.push({ geo: finMain, color: TAIL_FIN });
  // Fin leading edge (rounded cylinder)
  const finLE = new THREE.CylinderGeometry(0.08, 0.08, 3.6, HS);
  finLE.translate(0, 3.5, -7.8);
  p.push({ geo: finLE, color: TAIL_FIN });
  // Fin trailing edge (thin taper)
  const finTE = new THREE.BoxGeometry(0.10, 2.8, 0.4);
  finTE.translate(0, 3.2, -10.8);
  p.push({ geo: finTE, color: TAIL_FIN });
  // Fin tip cap (small box)
  const finCap = new THREE.BoxGeometry(0.20, 0.15, 2.4);
  finCap.translate(0, 5.32, -9.2);
  p.push({ geo: finCap, color: TAIL_FIN });
  // Fin root fairing (blends into fuselage)
  const finRoot = new THREE.BoxGeometry(0.40, 0.6, 3.2);
  finRoot.translate(0, 1.9, -9.0);
  p.push({ geo: finRoot, color: TAIL_FIN });

  // Horizontal stabilisers (high-mounted on fin tip)
  for (const side of [-1, 1]) {
    // Main stabiliser spar
    const stab = new THREE.BoxGeometry(3.5, 0.12, 1.5);
    stab.translate(side * 1.75, 5.25, -9.8);
    p.push({ geo: stab, color: TAIL_FIN });
    // Stabiliser leading edge
    const stabLE = new THREE.CylinderGeometry(0.06, 0.06, 3.5, HS);
    stabLE.rotateZ(Math.PI / 2);
    stabLE.translate(side * 1.75, 5.28, -9.05);
    p.push({ geo: stabLE, color: TAIL_FIN });
    // Stabiliser tip (tapered end)
    const stabTip = new THREE.BoxGeometry(0.5, 0.10, 1.0);
    stabTip.translate(side * 3.7, 5.25, -10.0);
    p.push({ geo: stabTip, color: TAIL_FIN });
    // Elevator hinge line
    const elev = new THREE.BoxGeometry(3.0, 0.08, 0.15);
    elev.translate(side * 1.75, 5.22, -10.5);
    p.push({ geo: elev, color: TAIL_FIN });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. WINGS — swept, tapered, with control surfaces and details
  // ═══════════════════════════════════════════════════════════════════════

  for (const side of [-1, 1]) {
    // ── Wing root fairing (blends into fuselage) ──
    const rootFair = new THREE.BoxGeometry(1.8, 0.35, 3.5);
    rootFair.translate(side * 0.9, 0.45, -0.5);
    p.push({ geo: rootFair, color: BODY });

    // ── Inner wing panel (root to engine) ──
    const innerWing = new THREE.BoxGeometry(3.0, 0.26, 3.2);
    innerWing.translate(side * 2.6, 0.45, -0.8);
    p.push({ geo: innerWing, color: WING });

    // ── Outer wing panel (engine to tip, swept back) ──
    const outerWing = new THREE.BoxGeometry(4.5, 0.20, 2.2);
    outerWing.translate(side * 6.35, 0.55, -1.4);
    p.push({ geo: outerWing, color: WING });

    // ── Wing tip (tapered) ──
    const tipBlock = new THREE.BoxGeometry(1.0, 0.14, 1.2);
    tipBlock.translate(side * 9.1, 0.6, -1.8);
    p.push({ geo: tipBlock, color: WING });

    // ── Winglet (upturned) ──
    const winglet = new THREE.BoxGeometry(0.10, 0.9, 0.5);
    winglet.translate(side * 9.6, 1.0, -1.9);
    p.push({ geo: winglet, color: TAIL_FIN });

    // ── Leading edge (rounded cylinder along span) ──
    // Inner
    const leInner = new THREE.CylinderGeometry(0.12, 0.12, 3.0, HS);
    leInner.rotateZ(Math.PI / 2);
    leInner.translate(side * 2.6, 0.50, 0.8);
    p.push({ geo: leInner, color: WING });
    // Outer
    const leOuter = new THREE.CylinderGeometry(0.10, 0.10, 4.5, HS);
    leOuter.rotateZ(Math.PI / 2);
    leOuter.translate(side * 6.35, 0.60, -0.3);
    p.push({ geo: leOuter, color: WING });

    // ── Trailing edge flaps (3 segments) ──
    for (let f = 0; f < 3; f++) {
      const flapX = side * (2.0 + f * 2.2);
      const flapZ = -2.0 - f * 0.3;
      const flapW = 1.8;
      const flap = new THREE.BoxGeometry(flapW, 0.08, 0.6);
      flap.translate(flapX, 0.35, flapZ);
      p.push({ geo: flap, color: WING });
      // Flap track fairing
      const fairing = new THREE.BoxGeometry(0.4, 0.18, 0.25);
      fairing.translate(flapX, 0.28, flapZ + 0.2);
      p.push({ geo: fairing, color: BELLY });
    }

    // ── Aileron (outboard) ──
    const aileron = new THREE.BoxGeometry(2.0, 0.06, 0.4);
    aileron.translate(side * 7.5, 0.50, -2.5);
    p.push({ geo: aileron, color: WING });

    // ── Slats (leading edge, 2 segments) ──
    for (let s = 0; s < 2; s++) {
      const slatX = side * (2.5 + s * 3.0);
      const slat = new THREE.BoxGeometry(2.5, 0.08, 0.3);
      slat.translate(slatX, 0.55, 1.1 - s * 0.2);
      p.push({ geo: slat, color: WING });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. ENGINE NACELLES — hex-cylinder pods on underwing struts
  // ═══════════════════════════════════════════════════════════════════════

  for (const side of [-1, 1]) {
    const ex = side * 3.8;  // engine X position (under inner wing)

    // ── Pylon / strut (connects wing to nacelle) ──
    const pylon = new THREE.BoxGeometry(0.16, 0.8, 1.8);
    pylon.translate(ex, 0.05, -0.5);
    p.push({ geo: pylon, color: WING });
    // Pylon fairing (streamlined)
    const pylonFair = new THREE.BoxGeometry(0.30, 0.3, 2.0);
    pylonFair.translate(ex, 0.30, -0.5);
    p.push({ geo: pylonFair, color: WING });

    // ── Nacelle body (hex-cylinder as per reference) ──
    const nacBody = new THREE.CylinderGeometry(0.55, 0.52, 3.8, 6, 1);
    nacBody.rotateX(Math.PI / 2);
    nacBody.translate(ex, -0.35, -0.4);
    p.push({ geo: nacBody, color: ENGINE });

    // ── Intake cowl (slightly wider ring) ──
    const intake = new THREE.CylinderGeometry(0.62, 0.60, 0.20, HS, 1);
    intake.rotateX(Math.PI / 2);
    intake.translate(ex, -0.35, 1.5);
    p.push({ geo: intake, color: BELLY });

    // ── Fan face (visible disc) ──
    const fan = new THREE.CylinderGeometry(0.55, 0.55, 0.06, HS, 1);
    fan.rotateX(Math.PI / 2);
    fan.translate(ex, -0.35, 1.55);
    p.push({ geo: fan, color: NOSE_TIP });

    // ── Fan spinner (cone in centre) ──
    const spinner = new THREE.CylinderGeometry(0.06, 0.22, 0.35, HS, 1);
    spinner.rotateX(Math.PI / 2);
    spinner.translate(ex, -0.35, 1.65);
    p.push({ geo: spinner, color: NOSE_TIP });

    // ── Fan blades (8 flat planes radially) ──
    for (let b = 0; b < 8; b++) {
      const angle = (b / 8) * Math.PI * 2;
      const blade = new THREE.BoxGeometry(0.04, 0.38, 0.08);
      blade.translate(0, 0.22, 0);
      blade.rotateZ(angle);
      blade.translate(ex, -0.35, 1.56);
      p.push({ geo: blade, color: BELLY });
    }

    // ── Exhaust nozzle (tapered) ──
    const exhOuter = new THREE.CylinderGeometry(0.35, 0.52, 0.6, HS, 1);
    exhOuter.rotateX(Math.PI / 2);
    exhOuter.translate(ex, -0.35, -2.6);
    p.push({ geo: exhOuter, color: EXHAUST });
    // Inner exhaust cone
    const exhInner = new THREE.CylinderGeometry(0.20, 0.30, 0.5, HS, 1);
    exhInner.rotateX(Math.PI / 2);
    exhInner.translate(ex, -0.35, -2.55);
    p.push({ geo: exhInner, color: NOSE_TIP });

    // ── Thrust reverser cowl lines (rings on nacelle) ──
    for (const rz of [-0.8, -1.4]) {
      const ring = new THREE.CylinderGeometry(0.57, 0.57, 0.06, HS, 1);
      ring.rotateX(Math.PI / 2);
      ring.translate(ex, -0.35, rz);
      p.push({ geo: ring, color: BELLY });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. LANDING GEAR — nose gear + main gear bogies with detail
  // ═══════════════════════════════════════════════════════════════════════

  // ── Nose gear ──
  // Main strut
  const nStrut = new THREE.CylinderGeometry(0.06, 0.06, 1.3, HS);
  nStrut.translate(0, -0.50, 7.0);
  p.push({ geo: nStrut, color: GEAR });
  // Oleo (telescoping section, slightly thicker)
  const nOleo = new THREE.CylinderGeometry(0.08, 0.06, 0.5, HS);
  nOleo.translate(0, -0.90, 7.0);
  p.push({ geo: nOleo, color: GEAR });
  // Axle
  const nAxle = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8);
  nAxle.rotateZ(Math.PI / 2);
  nAxle.translate(0, -1.15, 7.0);
  p.push({ geo: nAxle, color: GEAR });
  // Wheels (2, side by side)
  for (const dx of [-0.15, 0.15]) {
    const nw = new THREE.CylinderGeometry(0.24, 0.24, 0.14, HS);
    nw.rotateZ(Math.PI / 2);
    nw.translate(dx, -1.15, 7.0);
    p.push({ geo: nw, color: GEAR });
    // Tire tread (slightly larger ring)
    const tread = new THREE.TorusGeometry(0.24, 0.03, 8, HS);
    tread.rotateY(Math.PI / 2);
    tread.translate(dx, -1.15, 7.0);
    p.push({ geo: tread, color: 0x111111 });
  }
  // Nose gear door (2 panels)
  for (const dx of [-0.25, 0.25]) {
    const ngd = new THREE.BoxGeometry(0.35, 0.04, 0.9);
    ngd.translate(dx, 0.02, 7.0);
    p.push({ geo: ngd, color: BELLY });
  }
  // Steering linkage
  const steerLink = new THREE.BoxGeometry(0.12, 0.3, 0.04);
  steerLink.translate(0.08, -0.30, 7.05);
  p.push({ geo: steerLink, color: GEAR });

  // ── Main gear (2 bogies, one per side) ──
  for (const side of [-1, 1]) {
    const gx = side * 1.6;

    // Main strut
    const mStrut = new THREE.CylinderGeometry(0.07, 0.07, 1.5, HS);
    mStrut.translate(gx, -0.55, -1.0);
    p.push({ geo: mStrut, color: GEAR });
    // Oleo
    const mOleo = new THREE.CylinderGeometry(0.09, 0.07, 0.6, HS);
    mOleo.translate(gx, -1.05, -1.0);
    p.push({ geo: mOleo, color: GEAR });

    // Bogie beam
    const beam = new THREE.BoxGeometry(0.14, 0.10, 1.0);
    beam.translate(gx, -1.30, -1.0);
    p.push({ geo: beam, color: GEAR });

    // Side brace (angled strut to fuselage)
    const brace = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
    brace.rotateZ(side * 0.3);
    brace.translate(gx * 0.7, -0.2, -1.0);
    p.push({ geo: brace, color: GEAR });

    // Wheels (4: 2 axles × 2 per axle)
    for (const dz of [-0.30, 0.30]) {
      // Axle
      const axle = new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8);
      axle.rotateZ(Math.PI / 2);
      axle.translate(gx, -1.35, -1.0 + dz);
      p.push({ geo: axle, color: GEAR });
      for (const dxW of [-0.18, 0.18]) {
        const mw = new THREE.CylinderGeometry(0.30, 0.30, 0.16, HS);
        mw.rotateZ(Math.PI / 2);
        mw.translate(gx + dxW, -1.35, -1.0 + dz);
        p.push({ geo: mw, color: GEAR });
        // Tire tread
        const tread = new THREE.TorusGeometry(0.30, 0.035, 8, HS);
        tread.rotateY(Math.PI / 2);
        tread.translate(gx + dxW, -1.35, -1.0 + dz);
        p.push({ geo: tread, color: 0x111111 });
      }
    }

    // Main gear doors (2 panels)
    const mgd1 = new THREE.BoxGeometry(0.7, 0.04, 1.2);
    mgd1.translate(gx, 0.02, -1.0);
    p.push({ geo: mgd1, color: BELLY });
    const mgd2 = new THREE.BoxGeometry(0.4, 0.04, 0.8);
    mgd2.translate(gx + side * 0.4, 0.02, -1.0);
    p.push({ geo: mgd2, color: BELLY });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. SURFACE DETAILS — panel lines, antennas, lights
  // ═══════════════════════════════════════════════════════════════════════

  // Wing root panel lines (horizontal seams on fuselage sides)
  for (const dx of [-1.14, 1.14]) {
    for (const z of [2.0, -2.0, -5.0]) {
      const line = new THREE.BoxGeometry(0.06, 0.02, 0.8);
      line.translate(dx, 0.45, z);
      p.push({ geo: line, color: BELLY });
    }
  }

  // Belly antennas (2 small fins)
  for (const az of [3.0, -3.5]) {
    const ant = new THREE.BoxGeometry(0.04, 0.15, 0.30);
    ant.translate(0, -0.05, az);
    p.push({ geo: ant, color: BELLY });
  }

  // Dorsal antenna (top of fuselage)
  const dorsalAnt = new THREE.BoxGeometry(0.04, 0.18, 0.25);
  dorsalAnt.translate(0, 2.35, 1.0);
  p.push({ geo: dorsalAnt, color: BELLY });

  // Navigation lights (wingtip)
  for (const side of [-1, 1]) {
    const navLight = new THREE.SphereGeometry(0.06, 8, 8);
    navLight.translate(side * 9.65, 0.6, -1.8);
    p.push({ geo: navLight, color: side > 0 ? 0x22c55e : 0xef4444 });
  }

  // Tail navigation light (white, aft)
  const tailNav = new THREE.SphereGeometry(0.05, 8, 8);
  tailNav.translate(0, 1.15, -11.95);
  p.push({ geo: tailNav, color: 0xffffff });

  // Anti-collision beacon (top of fin)
  const beacon = new THREE.SphereGeometry(0.06, 8, 8);
  beacon.translate(0, 5.45, -9.2);
  p.push({ geo: beacon, color: 0xef4444 });

  // Landing lights (on belly near nose gear)
  for (const dx of [-0.35, 0.35]) {
    const lLight = new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8);
    lLight.translate(dx, -0.02, 6.0);
    p.push({ geo: lLight, color: 0xfef3c7 });
  }

  return _mergeGeomsColored(p);
}

/** Helper: rounded box approximation — a box body + 4 lengthwise edge
 *  cylinders so the silhouette reads as rounded, especially at night. */
function _roundedBody(w, h, len, segs = 6) {
  const parts = [];
  // Core box slightly inset
  const rr = Math.min(w, h) * 0.22;  // corner radius
  const bw = w - rr * 2;
  const bh = h - rr * 2;
  parts.push(new THREE.BoxGeometry(w, bh, len));       // tall centre slab
  parts.push(new THREE.BoxGeometry(bw, h, len));       // wide centre slab
  // 4 edge cylinders along Z
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cyl = new THREE.CylinderGeometry(rr, rr, len, segs);
      cyl.rotateX(Math.PI / 2);
      cyl.translate(sx * bw / 2, sy * bh / 2, 0);
      parts.push(cyl);
    }
  }
  const merged = _mergeGeoms(parts);
  return merged;
}

// ── High-poly train builder ─────────────────────────────────────────────────
const S = 20;  // cylinder segments for smooth curves

/**
 * Build the cab (front/rear face) of a train car. Each variant calls this
 * with different cab geometry to get angular vs. sloped vs. flat profiles.
 * `dir` is +1 for front (facing +Z) or -1 for rear (facing -Z).
 */
function _buildCab(p, palette, cabZ, dir, style) {
  const { BODY, WINDOW, CAB_FACE, CHEVRON, HEADLIGHT, LOWER } = palette;
  const d = dir;  // +1 front, -1 rear

  if (style === 'angular') {
    // ── Skånetrafiken Påinter: high angular cab ──
    // Flat front face (full width, slightly raked at top)
    const face = new THREE.BoxGeometry(2.8, 3.2, 0.15);
    face.translate(0, 1.8, cabZ + d * 0.08);
    p.push({ geo: face, color: CAB_FACE });
    // Windshield — large, raked (two-piece split)
    const wind = new THREE.BoxGeometry(2.2, 1.2, 0.12);
    wind.translate(0, 2.8, cabZ + d * 0.12);
    p.push({ geo: wind, color: WINDOW });
    // Lower windshield / destination display
    const dest = new THREE.BoxGeometry(1.6, 0.3, 0.1);
    dest.translate(0, 3.45, cabZ + d * 0.12);
    p.push({ geo: dest, color: 0x111827 });
    // Safety chevron (yellow V-shape at bottom)
    const chevL = new THREE.BoxGeometry(1.2, 0.5, 0.1);
    chevL.translate(-0.5, 0.6, cabZ + d * 0.12);
    p.push({ geo: chevL, color: CHEVRON });
    const chevR = new THREE.BoxGeometry(1.2, 0.5, 0.1);
    chevR.translate(0.5, 0.6, cabZ + d * 0.12);
    p.push({ geo: chevR, color: CHEVRON });
    // Headlights
    for (const dx of [-1.0, 1.0]) {
      const hl = new THREE.CylinderGeometry(0.18, 0.18, 0.1, S);
      hl.rotateX(Math.PI / 2);
      hl.translate(dx, 1.2, cabZ + d * 0.15);
      p.push({ geo: hl, color: HEADLIGHT });
    }

  } else if (style === 'sloped') {
    // ── SJ Train: aerodynamic sloped front (NOT a cone) ──
    // Raked front face — angled slab (taller at top, shorter at bottom)
    // Upper face (wide, at body top)
    const upperFace = new THREE.BoxGeometry(2.6, 1.6, 0.15);
    upperFace.translate(0, 2.6, cabZ + d * 0.08);
    p.push({ geo: upperFace, color: CAB_FACE });
    // Lower face (narrower, stepped forward to create rake angle)
    const lowerFace = new THREE.BoxGeometry(2.4, 1.2, 0.15);
    lowerFace.translate(0, 1.0, cabZ + d * 0.8);
    p.push({ geo: lowerFace, color: CAB_FACE });
    // Sloped panel connecting upper to lower (angled surface)
    const slope = new THREE.BoxGeometry(2.5, 0.3, 1.0);
    slope.translate(0, 1.7, cabZ + d * 0.5);
    p.push({ geo: slope, color: CAB_FACE });
    // Windshield — wide panoramic
    const wind = new THREE.BoxGeometry(2.3, 1.0, 0.1);
    wind.translate(0, 2.8, cabZ + d * 0.12);
    p.push({ geo: wind, color: WINDOW });
    // Headlights — integrated into lower face
    for (const dx of [-0.9, 0.9]) {
      const hl = new THREE.CylinderGeometry(0.15, 0.15, 0.12, S);
      hl.rotateX(Math.PI / 2);
      hl.translate(dx, 0.8, cabZ + d * 0.9);
      p.push({ geo: hl, color: HEADLIGHT });
    }

  } else {
    // ── SL Suburban: flat angular front with blue chevron ──
    // Full flat face
    const face = new THREE.BoxGeometry(2.8, 3.2, 0.15);
    face.translate(0, 1.8, cabZ + d * 0.08);
    p.push({ geo: face, color: CAB_FACE });
    // Large windshield
    const wind = new THREE.BoxGeometry(2.4, 1.3, 0.12);
    wind.translate(0, 2.7, cabZ + d * 0.12);
    p.push({ geo: wind, color: WINDOW });
    // Blue chevron / stripe on lower face
    const chevron = new THREE.BoxGeometry(2.4, 0.6, 0.1);
    chevron.translate(0, 1.0, cabZ + d * 0.12);
    p.push({ geo: chevron, color: CHEVRON });
    // Destination display
    const dest = new THREE.BoxGeometry(1.4, 0.25, 0.1);
    dest.translate(0, 3.4, cabZ + d * 0.12);
    p.push({ geo: dest, color: 0x111827 });
    // Headlights
    for (const dx of [-1.05, 1.05]) {
      const hl = new THREE.CylinderGeometry(0.15, 0.15, 0.1, S);
      hl.rotateX(Math.PI / 2);
      hl.translate(dx, 1.5, cabZ + d * 0.15);
      p.push({ geo: hl, color: HEADLIGHT });
    }
  }

  // Coupler / bumper beam at the very front/rear
  const coupler = new THREE.BoxGeometry(1.0, 0.25, 0.2);
  coupler.translate(0, 0.25, cabZ + d * 0.2);
  p.push({ geo: coupler, color: LOWER });
}

/**
 * Build a complete train consist. `cabStyle` controls the front/rear
 * profile shape ('angular', 'sloped', 'flat').
 */
function _trainCommon(palette, numCars, cabStyle) {
  const { BODY, STRIPE, WINDOW, BOGIE, ROOF, LOWER } = palette;
  const p = [];
  const carLen = 9.0;
  const gap = 1.0;
  const totalLen = numCars * carLen + (numCars - 1) * gap;
  const startZ = totalLen / 2;

  for (let c = 0; c < numCars; c++) {
    const cz = startZ - c * (carLen + gap) - carLen / 2;
    const isLead = (c === 0);
    const isTail = (c === numCars - 1);

    // ── Car body — main rectangular slab ──
    const bodyMain = new THREE.BoxGeometry(2.8, 2.0, carLen);
    bodyMain.translate(0, 1.6, cz);
    p.push({ geo: bodyMain, color: BODY });

    // Lower body / skirt (slightly wider)
    const skirt = new THREE.BoxGeometry(2.85, 0.4, carLen);
    skirt.translate(0, 0.4, cz);
    p.push({ geo: skirt, color: LOWER });

    // Upper body (above window line to roof)
    const upperBody = new THREE.BoxGeometry(2.75, 0.6, carLen);
    upperBody.translate(0, 2.9, cz);
    p.push({ geo: upperBody, color: BODY });

    // ── Window band (both sides) ──
    for (const dx of [-1.42, 1.42]) {
      const winBand = new THREE.BoxGeometry(0.06, 0.9, carLen - 1.5);
      winBand.translate(dx, 2.15, cz);
      p.push({ geo: winBand, color: WINDOW });
    }

    // Individual window panes (panels between pillars)
    const windowCount = Math.floor(carLen / 1.2);
    for (let w = 0; w < windowCount; w++) {
      const wz = cz - carLen / 2 + 0.8 + w * (carLen - 1.2) / windowCount;
      for (const dx of [-1.43, 1.43]) {
        const pane = new THREE.BoxGeometry(0.05, 0.75, 0.7);
        pane.translate(dx, 2.15, wz);
        p.push({ geo: pane, color: WINDOW });
      }
    }

    // ── Livery stripe (horizontal colour band) ──
    for (const dx of [-1.43, 1.43]) {
      const stripe = new THREE.BoxGeometry(0.05, 0.2, carLen - 0.5);
      stripe.translate(dx, 1.2, cz);
      p.push({ geo: stripe, color: STRIPE });
    }

    // ── Doors (2 per side per car) ──
    for (const dz of [carLen * 0.25, -carLen * 0.25]) {
      for (const dx of [-1.44, 1.44]) {
        // Door frame
        const frame = new THREE.BoxGeometry(0.05, 2.2, 1.0);
        frame.translate(dx, 1.7, cz + dz);
        p.push({ geo: frame, color: LOWER });
        // Door window
        const dWin = new THREE.BoxGeometry(0.05, 0.7, 0.6);
        dWin.translate(dx, 2.3, cz + dz);
        p.push({ geo: dWin, color: WINDOW });
      }
    }

    // ── Roof — flat top ──
    const roof = new THREE.BoxGeometry(2.8, 0.18, carLen - 0.3);
    roof.translate(0, 3.25, cz);
    p.push({ geo: roof, color: ROOF });

    // Roof equipment (AC units — rectangular boxes)
    for (const eqZ of [-1.5, 1.5]) {
      const ac = new THREE.BoxGeometry(1.6, 0.2, 1.8);
      ac.translate(0, 3.55, cz + eqZ);
      p.push({ geo: ac, color: ROOF });
    }

    // ── Bogies (2 per car, near each end) ──
    for (const endSign of [-1, 1]) {
      const bz = cz + endSign * (carLen / 2 - 1.3);
      // Bogie frame
      const frame = new THREE.BoxGeometry(2.4, 0.35, 1.8);
      frame.translate(0, 0.0, bz);
      p.push({ geo: frame, color: BOGIE });
      // Side frames
      for (const dx of [-1.1, 1.1]) {
        const sf = new THREE.BoxGeometry(0.15, 0.5, 1.6);
        sf.translate(dx, 0.0, bz);
        p.push({ geo: sf, color: BOGIE });
      }
      // Wheels (4 per bogie — 2 axles × 2 sides)
      for (const dx of [-1.15, 1.15]) {
        for (const wdz of [-0.4, 0.4]) {
          const wh = new THREE.CylinderGeometry(0.4, 0.4, 0.3, S);
          wh.rotateZ(Math.PI / 2);
          wh.translate(dx, -0.1, bz + wdz);
          p.push({ geo: wh, color: BOGIE });
        }
      }
    }

    // ── Cab faces on lead and tail cars ──
    if (isLead) {
      _buildCab(p, palette, startZ, +1, cabStyle);
    }
    if (isTail) {
      _buildCab(p, palette, -startZ, -1, cabStyle);
    }
  }

  // ── Inter-car gangway connections ──
  for (let j = 0; j < numCars - 1; j++) {
    const jz = startZ - (j + 1) * carLen - j * gap - gap / 2;
    // Gangway body
    const gang = new THREE.BoxGeometry(2.0, 2.2, gap - 0.15);
    gang.translate(0, 1.7, jz);
    p.push({ geo: gang, color: LOWER });
    // Gangway bellows ribs
    for (const ribOff of [-0.2, 0, 0.2]) {
      const rib = new THREE.BoxGeometry(2.3, 2.4, 0.06);
      rib.translate(0, 1.7, jz + ribOff);
      p.push({ geo: rib, color: BOGIE });
    }
  }

  return _mergeGeomsColored(p);
}

// ── Train A: Skånetrafiken Påinter (blue, angular cab, 3 cars) ──
function _buildTrainGeometry() {
  return _trainCommon(_trainPalettes[0], 3, 'angular');
}

function _buildTrainBGeometry() {
  return _trainCommon(_trainPalettes[1], 4, 'sloped');
}

function _buildTrainCGeometry() {
  return _trainCommon(_trainPalettes[2], 3, 'flat');
}

// ── Öresundståg (Bombardier Contessa X31K) ─────────────────────────────────
// Dedicated high-poly model (~10k faces) for cities in the Öresund corridor.
// Distinctive features: dark rubber "nose" cab surround, silver body, red
// doors, orange accent stripe.  Reference: Skånetrafiken/DSB livery.
function _buildOresundstagGeometry() {
  const BODY       = 0xc8cdd3;   // silver-grey body
  const LOWER      = 0x6b7280;   // dark grey skirt
  const WINDOW     = 0x111827;   // very dark glass
  const ROOF       = 0x9ca3af;   // grey roof
  const BOGIE      = 0x1c1917;   // black
  const CAB_RUBBER = 0x2d2d2d;   // dark charcoal rubber surround
  const DOOR       = 0xdc2626;   // bright red doors
  const STRIPE_ORG = 0xe88c30;   // orange accent stripe
  const STRIPE_RED = 0xcc3333;   // red "ØRESUNDSTÅG" branding band
  const HEADLIGHT  = 0xfef3c7;   // warm white
  const DEST       = 0x111827;   // destination display
  const PANTO      = 0x44403c;   // pantograph
  const HS = 24;  // high segments for smooth rubber surround

  const p = [];
  const numCars = 3;
  const carLen = 9.0;
  const gap = 1.0;
  const totalLen = numCars * carLen + (numCars - 1) * gap;
  const startZ = totalLen / 2;

  for (let c = 0; c < numCars; c++) {
    const cz = startZ - c * (carLen + gap) - carLen / 2;
    const isLead = (c === 0);
    const isTail = (c === numCars - 1);

    // ── Car body (rounded) ──
    const bodyMain = _roundedBody(2.9, 2.0, carLen, HS);
    bodyMain.translate(0, 1.6, cz);
    p.push({ geo: bodyMain, color: BODY });

    // Lower skirt
    const skirt = new THREE.BoxGeometry(2.95, 0.4, carLen);
    skirt.translate(0, 0.4, cz);
    p.push({ geo: skirt, color: LOWER });

    // Upper body above window line
    const upperBody = new THREE.BoxGeometry(2.85, 0.55, carLen);
    upperBody.translate(0, 2.9, cz);
    p.push({ geo: upperBody, color: BODY });

    // ── Window band (both sides) ──
    for (const dx of [-1.47, 1.47]) {
      const winBand = new THREE.BoxGeometry(0.06, 0.85, carLen - 1.8);
      winBand.translate(dx, 2.15, cz);
      p.push({ geo: winBand, color: WINDOW });
    }

    // Individual window panes with pillars between
    const windowCount = 8;
    const winSpacing = (carLen - 2.4) / windowCount;
    for (let w = 0; w < windowCount; w++) {
      const wz = cz - carLen / 2 + 1.4 + w * winSpacing;
      for (const dx of [-1.48, 1.48]) {
        // Window pane
        const pane = new THREE.BoxGeometry(0.05, 0.72, winSpacing * 0.7);
        pane.translate(dx, 2.15, wz);
        p.push({ geo: pane, color: WINDOW });
        // Pillar between windows
        const pillar = new THREE.BoxGeometry(0.06, 0.85, 0.08);
        pillar.translate(dx, 2.15, wz + winSpacing * 0.42);
        p.push({ geo: pillar, color: BODY });
      }
    }

    // ── Orange accent stripe at window level ──
    for (const dx of [-1.48, 1.48]) {
      const stripe = new THREE.BoxGeometry(0.05, 0.10, carLen - 0.8);
      stripe.translate(dx, 2.62, cz);
      p.push({ geo: stripe, color: STRIPE_ORG });
    }

    // ── Red branding strip (lower body) ──
    for (const dx of [-1.48, 1.48]) {
      const redStripe = new THREE.BoxGeometry(0.05, 0.14, carLen * 0.35);
      redStripe.translate(dx, 1.35, cz - carLen * 0.05);
      p.push({ geo: redStripe, color: STRIPE_RED });
    }

    // ── RED DOORS (2 per side per car) — the distinctive feature ──
    for (const dz of [carLen * 0.28, -carLen * 0.28]) {
      for (const dx of [-1.49, 1.49]) {
        // Door panel (bright red)
        const door = new THREE.BoxGeometry(0.06, 2.1, 1.1);
        door.translate(dx, 1.65, cz + dz);
        p.push({ geo: door, color: DOOR });
        // Door window (upper half)
        const dWin = new THREE.BoxGeometry(0.06, 0.65, 0.7);
        dWin.translate(dx, 2.35, cz + dz);
        p.push({ geo: dWin, color: WINDOW });
        // Door frame outline
        for (const edgeDz of [-0.58, 0.58]) {
          const frame = new THREE.BoxGeometry(0.07, 2.1, 0.04);
          frame.translate(dx, 1.65, cz + dz + edgeDz);
          p.push({ geo: frame, color: LOWER });
        }
      }
    }

    // ── Roof (slightly arched via box) ──
    const roof = new THREE.BoxGeometry(2.8, 0.18, carLen - 0.3);
    roof.translate(0, 3.22, cz);
    p.push({ geo: roof, color: ROOF });

    // Roof edge trim (darker band)
    for (const dx of [-1.42, 1.42]) {
      const edge = new THREE.BoxGeometry(0.06, 0.18, carLen - 0.3);
      edge.translate(dx, 3.22, cz);
      p.push({ geo: edge, color: LOWER });
    }

    // AC units (rectangular boxes, 2 per car)
    for (const eqZ of [-1.5, 1.5]) {
      const ac = new THREE.BoxGeometry(1.5, 0.22, 1.8);
      ac.translate(0, 3.48, cz + eqZ);
      p.push({ geo: ac, color: ROOF });
      // AC grille lines
      for (let g = -2; g <= 2; g++) {
        const grille = new THREE.BoxGeometry(1.3, 0.02, 0.04);
        grille.translate(0, 3.60, cz + eqZ + g * 0.35);
        p.push({ geo: grille, color: LOWER });
      }
    }

    // Pantograph on middle car
    if (c === 1) {
      // Base insulator
      const base = new THREE.BoxGeometry(0.8, 0.15, 0.6);
      base.translate(0, 3.55, cz);
      p.push({ geo: base, color: PANTO });
      // Lower arm
      const armL = new THREE.BoxGeometry(0.08, 1.0, 0.08);
      armL.translate(-0.15, 4.05, cz);
      p.push({ geo: armL, color: PANTO });
      const armR = new THREE.BoxGeometry(0.08, 1.0, 0.08);
      armR.translate(0.15, 4.05, cz);
      p.push({ geo: armR, color: PANTO });
      // Upper arm (angled)
      const upper = new THREE.BoxGeometry(0.06, 0.7, 0.06);
      upper.translate(0, 4.85, cz);
      p.push({ geo: upper, color: PANTO });
      // Contact strip
      const contact = new THREE.BoxGeometry(1.6, 0.04, 0.06);
      contact.translate(0, 5.20, cz);
      p.push({ geo: contact, color: PANTO });
      // Horn tips
      for (const dx of [-0.85, 0.85]) {
        const horn = new THREE.BoxGeometry(0.04, 0.12, 0.04);
        horn.translate(dx, 5.18, cz);
        p.push({ geo: horn, color: PANTO });
      }
    }

    // ── Bogies (2 per car) ──
    for (const endSign of [-1, 1]) {
      const bz = cz + endSign * (carLen / 2 - 1.3);
      // Bogie frame
      const bFrame = new THREE.BoxGeometry(2.5, 0.35, 1.8);
      bFrame.translate(0, 0.0, bz);
      p.push({ geo: bFrame, color: BOGIE });
      // Side frames
      for (const dx of [-1.15, 1.15]) {
        const sf = new THREE.BoxGeometry(0.15, 0.5, 1.6);
        sf.translate(dx, 0.0, bz);
        p.push({ geo: sf, color: BOGIE });
      }
      // Wheels (4 per bogie)
      for (const dx of [-1.2, 1.2]) {
        for (const wdz of [-0.4, 0.4]) {
          const wh = new THREE.CylinderGeometry(0.42, 0.42, 0.3, HS);
          wh.rotateZ(Math.PI / 2);
          wh.translate(dx, -0.1, bz + wdz);
          p.push({ geo: wh, color: BOGIE });
        }
      }
      // Brake discs (visible between wheels)
      for (const wdz of [-0.4, 0.4]) {
        const disc = new THREE.CylinderGeometry(0.3, 0.3, 0.06, HS);
        disc.rotateZ(Math.PI / 2);
        disc.translate(0, -0.1, bz + wdz);
        p.push({ geo: disc, color: LOWER });
      }
    }

    // ── Cab faces on lead and tail cars ──
    // The Öresundståg's signature: thick dark rubber surround with
    // rounded corners, large inset windshield.
    if (isLead || isTail) {
      const d = isLead ? +1 : -1;
      const cabZ = isLead ? startZ : -startZ;

      // Rubber surround — thick frame that protrudes forward
      // Main rubber face block (full width/height of the end)
      const rubberFace = _roundedBody(3.0, 3.2, 0.5, HS);
      rubberFace.translate(0, 1.75, cabZ + d * 0.35);
      p.push({ geo: rubberFace, color: CAB_RUBBER });

      // Deeper rubber extension at centre (the "nose" bulge)
      const noseBulge = _roundedBody(2.6, 2.6, 0.2, HS);
      noseBulge.translate(0, 1.85, cabZ + d * 0.55);
      p.push({ geo: noseBulge, color: CAB_RUBBER });

      // Windshield — large, inset into the rubber surround
      // Main windshield pane
      const windMain = new THREE.BoxGeometry(2.0, 1.1, 0.08);
      windMain.translate(0, 2.55, cabZ + d * 0.45);
      p.push({ geo: windMain, color: WINDOW });

      // Windshield divider (centre pillar)
      const divider = new THREE.BoxGeometry(0.06, 1.1, 0.10);
      divider.translate(0, 2.55, cabZ + d * 0.46);
      p.push({ geo: divider, color: CAB_RUBBER });

      // Side windows (wrap-around, smaller panes flanking main)
      for (const dx of [-1.15, 1.15]) {
        const sideWin = new THREE.BoxGeometry(0.35, 0.85, 0.08);
        sideWin.translate(dx, 2.55, cabZ + d * 0.42);
        p.push({ geo: sideWin, color: WINDOW });
      }

      // Number display panel (upper left)
      const numPanel = new THREE.BoxGeometry(0.4, 0.22, 0.06);
      numPanel.translate(-0.7, 3.15, cabZ + d * 0.50);
      p.push({ geo: numPanel, color: DEST });

      // Destination display (top centre)
      const dest = new THREE.BoxGeometry(1.2, 0.2, 0.06);
      dest.translate(0, 3.2, cabZ + d * 0.50);
      p.push({ geo: dest, color: DEST });

      // Lower face panel (below windshield, body-coloured)
      const lowerPanel = new THREE.BoxGeometry(2.2, 0.8, 0.12);
      lowerPanel.translate(0, 1.2, cabZ + d * 0.40);
      p.push({ geo: lowerPanel, color: BODY });

      // Headlights (rectangular, recessed into rubber)
      for (const dx of [-0.85, 0.85]) {
        // Headlight housing
        const hlHousing = new THREE.BoxGeometry(0.4, 0.25, 0.12);
        hlHousing.translate(dx, 0.85, cabZ + d * 0.50);
        p.push({ geo: hlHousing, color: CAB_RUBBER });
        // Headlight lens
        const hlLens = new THREE.CylinderGeometry(0.1, 0.1, 0.08, HS);
        hlLens.rotateX(Math.PI / 2);
        hlLens.translate(dx, 0.85, cabZ + d * 0.56);
        p.push({ geo: hlLens, color: HEADLIGHT });
      }

      // Tail lights (red, at lower corners)
      for (const dx of [-1.1, 1.1]) {
        const tl = new THREE.BoxGeometry(0.2, 0.15, 0.06);
        tl.translate(dx, 0.65, cabZ + d * 0.52);
        p.push({ geo: tl, color: 0xdc2626 });
      }

      // Rubber edge trim (raised rim around entire face)
      // Top edge
      const topRim = new THREE.BoxGeometry(2.8, 0.15, 0.55);
      topRim.translate(0, 3.4, cabZ + d * 0.35);
      p.push({ geo: topRim, color: CAB_RUBBER });
      // Bottom edge
      const botRim = new THREE.BoxGeometry(2.8, 0.15, 0.55);
      botRim.translate(0, 0.25, cabZ + d * 0.35);
      p.push({ geo: botRim, color: CAB_RUBBER });
      // Side edges
      for (const dx of [-1.45, 1.45]) {
        const sideRim = new THREE.BoxGeometry(0.15, 3.0, 0.55);
        sideRim.translate(dx, 1.85, cabZ + d * 0.35);
        p.push({ geo: sideRim, color: CAB_RUBBER });
      }

      // Coupler (below cab)
      const coupler = new THREE.BoxGeometry(0.8, 0.25, 0.2);
      coupler.translate(0, 0.25, cabZ + d * 0.6);
      p.push({ geo: coupler, color: BOGIE });
    }
  }

  // ── Inter-car gangway connections ──
  for (let j = 0; j < numCars - 1; j++) {
    const jz = startZ - (j + 1) * carLen - j * gap - gap / 2;
    const gang = new THREE.BoxGeometry(2.0, 2.2, gap - 0.15);
    gang.translate(0, 1.7, jz);
    p.push({ geo: gang, color: LOWER });
    // Bellows ribs
    for (const ribOff of [-0.25, -0.08, 0.08, 0.25]) {
      const rib = new THREE.BoxGeometry(2.3, 2.4, 0.05);
      rib.translate(0, 1.7, jz + ribOff);
      p.push({ geo: rib, color: BOGIE });
    }
  }

  return _mergeGeomsColored(p);
}

function _buildOresundstagHeadlightGeometry() { return _trainHeadlight(3); }

// ── Swedish Passenger Ferry (Waxholmsbolaget-style) ─────────────────────────
// High-poly ~20k faces.  White hull, blue+yellow Swedish livery stripes,
// two passenger decks, articulated bow ramp, bridge, radar mast, funnel.
function _buildFerryGeometry() {
  const HULL    = 0xf0ede8;   // white hull
  const DECK    = 0xd4cfc8;   // light grey deck surface
  const BELOW   = 0x2d2d2d;   // dark waterline / keel
  const WINDOW  = 0x0f1a2b;   // very dark glass
  const BLUE    = 0x005ca9;   // Swedish blue stripe
  const YELLOW  = 0xfecc02;   // Swedish yellow stripe
  const RAIL    = 0xc8c4be;   // deck railings
  const BRIDGE  = 0xe8e4de;   // bridge superstructure
  const MAST    = 0x888888;   // mast/antenna grey
  const FUNNEL  = 0xf0ede8;   // funnel body (white)
  const DOOR    = 0x374151;   // dark doors
  const RAMP    = 0x9ca3af;   // bow ramp metal
  const HS = 20;
  const p = [];

  // Dimensions (metres, model scale — ferries are big)
  const hullLen = 28;
  const hullW = 6.5;
  const halfL = hullLen / 2;
  const halfW = hullW / 2;

  // ═══════════════════════════════════════════════════════════════
  // 1. HULL — above-waterline box + smooth curved underwater hull
  // ═══════════════════════════════════════════════════════════════

  // Above-waterline hull: box sides (from waterline up to deck)
  const waterY = -0.5;  // waterline Y position
  const freeboard = 1.5; // height above waterline
  const hullTop = waterY + freeboard;

  // Mid-section walls (above waterline, vertical sides)
  const hullAbove = new THREE.BoxGeometry(hullW, freeboard, hullLen * 0.6);
  hullAbove.translate(0, waterY + freeboard / 2, -hullLen * 0.05);
  p.push({ geo: hullAbove, color: HULL });

  // Bow taper — narrowing forward section (above waterline)
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const bw = hullW * (1.0 - t * 0.7);
    const bz = halfL - hullLen * 0.2 + (hullLen * 0.22) * t;
    const bl = hullLen * 0.03;
    const bowH = freeboard * (1.0 - t * 0.3);
    const bow = new THREE.BoxGeometry(bw, bowH, bl);
    bow.translate(0, waterY + bowH / 2, bz);
    p.push({ geo: bow, color: HULL });
  }
  // Bow tip (sharp prow)
  const bowTip = new THREE.BoxGeometry(hullW * 0.15, freeboard * 0.5, 0.6);
  bowTip.translate(0, waterY + freeboard * 0.35, halfL + 0.3);
  p.push({ geo: bowTip, color: HULL });

  // Stern transom (flat rear wall)
  const stern = new THREE.BoxGeometry(hullW, freeboard, 0.2);
  stern.translate(0, waterY + freeboard / 2, -halfL - 0.05);
  p.push({ geo: stern, color: HULL });

  // ── Underwater hull: smooth half-ellipsoid (bathtub / canoe shape) ──
  // A stretched bottom-hemisphere gives a natural boat curve that
  // is widest at midships and tapers at bow and stern.
  const draft = 1.3;  // depth below waterline
  const hullBottom = new THREE.SphereGeometry(
    1, HS * 2, Math.ceil(HS / 2),
    0, Math.PI * 2,
    Math.PI / 2, Math.PI / 2   // bottom hemisphere only
  );
  hullBottom.scale(halfW * 0.98, draft, halfL * 0.95);
  hullBottom.translate(0, waterY, -hullLen * 0.02);
  p.push({ geo: hullBottom, color: HULL });

  // Stern underwater extension (the ellipsoid tapers, but stern should
  // stay relatively full — add a small curved cap)
  const sternCap = new THREE.SphereGeometry(
    1, HS, Math.ceil(HS / 2),
    0, Math.PI * 2,
    Math.PI / 2, Math.PI / 2
  );
  sternCap.scale(halfW * 0.85, draft * 0.7, 1.5);
  sternCap.translate(0, waterY, -halfL + 0.5);
  p.push({ geo: sternCap, color: HULL });

  // Waterline accent (thin dark line at the water surface)
  for (const dx of [-halfW * 0.99, halfW * 0.99]) {
    const wl = new THREE.BoxGeometry(0.05, 0.08, hullLen * 0.7);
    wl.translate(dx, waterY, -hullLen * 0.02);
    p.push({ geo: wl, color: BELOW });
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. BLUE + YELLOW LIVERY STRIPES
  // ═══════════════════════════════════════════════════════════════

  for (const dx of [-halfW - 0.02, halfW + 0.02]) {
    // Blue stripe (wider, lower)
    const blue = new THREE.BoxGeometry(0.06, 0.25, hullLen * 0.75);
    blue.translate(dx, 0.3, -hullLen * 0.02);
    p.push({ geo: blue, color: BLUE });
    // Yellow stripe (thinner, above blue)
    const yellow = new THREE.BoxGeometry(0.06, 0.15, hullLen * 0.75);
    yellow.translate(dx, 0.60, -hullLen * 0.02);
    p.push({ geo: yellow, color: YELLOW });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. LOWER DECK (main car/passenger deck)
  // ═══════════════════════════════════════════════════════════════

  // Deck floor
  const deck1 = new THREE.BoxGeometry(hullW - 0.2, 0.15, hullLen * 0.85);
  deck1.translate(0, 1.0, -hullLen * 0.02);
  p.push({ geo: deck1, color: DECK });

  // Lower deck walls (with window cutouts approximated by alternating hull/window)
  for (const dx of [-halfW + 0.05, halfW - 0.05]) {
    // Solid wall base
    const wallBase = new THREE.BoxGeometry(0.12, 0.8, hullLen * 0.6);
    wallBase.translate(dx, 1.5, -hullLen * 0.08);
    p.push({ geo: wallBase, color: HULL });
    // Window band
    const winBand = new THREE.BoxGeometry(0.08, 0.55, hullLen * 0.55);
    winBand.translate(dx, 1.65, -hullLen * 0.06);
    p.push({ geo: winBand, color: WINDOW });
    // Individual window panes (10 per side)
    for (let w = 0; w < 10; w++) {
      const wz = -hullLen * 0.3 + w * (hullLen * 0.55 / 10);
      const pane = new THREE.BoxGeometry(0.06, 0.45, hullLen * 0.04);
      pane.translate(dx, 1.65, wz);
      p.push({ geo: pane, color: WINDOW });
      // Pillar between windows
      const pillar = new THREE.BoxGeometry(0.13, 0.8, 0.08);
      pillar.translate(dx, 1.5, wz + hullLen * 0.025);
      p.push({ geo: pillar, color: HULL });
    }
  }

  // Lower deck doors (2 per side, near bow and midships)
  for (const dx of [-halfW + 0.04, halfW - 0.04]) {
    for (const dz of [hullLen * 0.15, -hullLen * 0.15]) {
      const door = new THREE.BoxGeometry(0.14, 1.6, 0.8);
      door.translate(dx, 1.5, dz);
      p.push({ geo: door, color: DOOR });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. UPPER DECK (passenger saloon)
  // ═══════════════════════════════════════════════════════════════

  // Upper deck floor
  const deck2 = new THREE.BoxGeometry(hullW - 0.5, 0.15, hullLen * 0.65);
  deck2.translate(0, 2.15, -hullLen * 0.08);
  p.push({ geo: deck2, color: DECK });

  // Upper deck walls + windows
  for (const dx of [-halfW + 0.3, halfW - 0.3]) {
    const uWall = new THREE.BoxGeometry(0.10, 1.2, hullLen * 0.55);
    uWall.translate(dx, 2.85, -hullLen * 0.06);
    p.push({ geo: uWall, color: HULL });
    // Upper window band
    const uWin = new THREE.BoxGeometry(0.07, 0.7, hullLen * 0.5);
    uWin.translate(dx, 2.95, -hullLen * 0.05);
    p.push({ geo: uWin, color: WINDOW });
    // Individual upper windows (8 per side)
    for (let w = 0; w < 8; w++) {
      const wz = -hullLen * 0.25 + w * (hullLen * 0.5 / 8);
      const pane = new THREE.BoxGeometry(0.06, 0.6, hullLen * 0.045);
      pane.translate(dx, 2.95, wz);
      p.push({ geo: pane, color: WINDOW });
      const pillar = new THREE.BoxGeometry(0.11, 1.2, 0.06);
      pillar.translate(dx, 2.85, wz + hullLen * 0.03);
      p.push({ geo: pillar, color: HULL });
    }
  }

  // Upper deck roof
  const roof2 = new THREE.BoxGeometry(hullW - 0.4, 0.12, hullLen * 0.56);
  roof2.translate(0, 3.5, -hullLen * 0.07);
  p.push({ geo: roof2, color: HULL });

  // ═══════════════════════════════════════════════════════════════
  // 5. BRIDGE / WHEELHOUSE (set back towards stern on upper deck)
  // ═══════════════════════════════════════════════════════════════

  const bridgeZ = -hullLen * 0.18;
  const bridgeW = hullW - 1.2;
  const bridgeLen = 3.5;

  // Bridge walls
  const bridgeBox = new THREE.BoxGeometry(bridgeW, 1.8, bridgeLen);
  bridgeBox.translate(0, 4.45, bridgeZ);
  p.push({ geo: bridgeBox, color: BRIDGE });

  // Bridge roof
  const bridgeRoof = new THREE.BoxGeometry(bridgeW + 0.5, 0.12, bridgeLen + 0.6);
  bridgeRoof.translate(0, 5.4, bridgeZ);
  p.push({ geo: bridgeRoof, color: BRIDGE });

  // Bridge windshield (panoramic, wrap-around)
  // Front
  const bWindFront = new THREE.BoxGeometry(bridgeW - 0.3, 1.0, 0.08);
  bWindFront.translate(0, 4.6, bridgeZ + bridgeLen / 2 + 0.04);
  p.push({ geo: bWindFront, color: WINDOW });
  // Side windows
  for (const dx of [-(bridgeW / 2 + 0.02), bridgeW / 2 + 0.02]) {
    const bWindSide = new THREE.BoxGeometry(0.08, 1.0, bridgeLen - 0.3);
    bWindSide.translate(dx, 4.6, bridgeZ);
    p.push({ geo: bWindSide, color: WINDOW });
  }
  // Rear window
  const bWindRear = new THREE.BoxGeometry(bridgeW * 0.6, 0.7, 0.08);
  bWindRear.translate(0, 4.7, bridgeZ - bridgeLen / 2 - 0.04);
  p.push({ geo: bWindRear, color: WINDOW });

  // Bridge console (dark strip at bottom of windshield)
  const console = new THREE.BoxGeometry(bridgeW - 0.4, 0.3, 0.15);
  console.translate(0, 3.9, bridgeZ + bridgeLen / 2 + 0.03);
  p.push({ geo: console, color: BELOW });

  // ═══════════════════════════════════════════════════════════════
  // 6. RADAR MAST + NAVIGATION EQUIPMENT
  // ═══════════════════════════════════════════════════════════════

  // Main mast (vertical pole)
  const mast = new THREE.CylinderGeometry(0.08, 0.08, 3.5, HS);
  mast.translate(0, 7.1, bridgeZ);
  p.push({ geo: mast, color: MAST });

  // Radar dome
  const radarDome = new THREE.SphereGeometry(0.35, HS, HS);
  radarDome.translate(0, 8.9, bridgeZ);
  p.push({ geo: radarDome, color: HULL });

  // Radar scanner bar
  const radarBar = new THREE.BoxGeometry(2.8, 0.06, 0.18);
  radarBar.translate(0, 8.4, bridgeZ);
  p.push({ geo: radarBar, color: MAST });

  // Cross-tree / yardarm
  const yardarm = new THREE.BoxGeometry(2.0, 0.04, 0.04);
  yardarm.translate(0, 7.8, bridgeZ);
  p.push({ geo: yardarm, color: MAST });

  // Navigation lights on yardarm tips
  for (const dx of [-1.0, 1.0]) {
    const navLight = new THREE.SphereGeometry(0.05, 8, 8);
    navLight.translate(dx, 7.85, bridgeZ);
    p.push({ geo: navLight, color: dx > 0 ? 0x22c55e : 0xef4444 });
  }

  // Antennas (2 whip antennas)
  for (const dx of [-0.3, 0.3]) {
    const ant = new THREE.CylinderGeometry(0.02, 0.02, 2.0, 6);
    ant.translate(dx, 7.5, bridgeZ + 0.5);
    p.push({ geo: ant, color: MAST });
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. FUNNEL (short, with Swedish blue+yellow band)
  // ═══════════════════════════════════════════════════════════════

  const funnelZ = bridgeZ - 2.5;
  // Funnel body
  const funnel = new THREE.CylinderGeometry(0.5, 0.6, 1.8, HS);
  funnel.translate(0, 4.5, funnelZ);
  p.push({ geo: funnel, color: FUNNEL });
  // Funnel top cap (dark exhaust ring)
  const funnelTop = new THREE.CylinderGeometry(0.45, 0.5, 0.15, HS);
  funnelTop.translate(0, 5.45, funnelZ);
  p.push({ geo: funnelTop, color: BELOW });
  // Blue band on funnel
  const funnelBlue = new THREE.CylinderGeometry(0.52, 0.56, 0.35, HS);
  funnelBlue.translate(0, 4.35, funnelZ);
  p.push({ geo: funnelBlue, color: BLUE });
  // Yellow band on funnel
  const funnelYellow = new THREE.CylinderGeometry(0.51, 0.55, 0.15, HS);
  funnelYellow.translate(0, 4.58, funnelZ);
  p.push({ geo: funnelYellow, color: YELLOW });

  // ═══════════════════════════════════════════════════════════════
  // 8. BOW RAMP (articulated, distinctive feature)
  // ═══════════════════════════════════════════════════════════════

  const rampZ = halfL + 0.3;
  // Ramp frame (raised position — closed during sailing)
  const rampPanel = new THREE.BoxGeometry(hullW * 0.6, 2.0, 0.15);
  rampPanel.translate(0, 1.6, rampZ);
  p.push({ geo: rampPanel, color: RAMP });
  // Ramp hinge brackets
  for (const dx of [-hullW * 0.25, hullW * 0.25]) {
    const hinge = new THREE.BoxGeometry(0.2, 0.3, 0.3);
    hinge.translate(dx, 0.6, rampZ);
    p.push({ geo: hinge, color: BELOW });
  }
  // Ramp surface detail (horizontal ribs for traction)
  for (let r = 0; r < 5; r++) {
    const rib = new THREE.BoxGeometry(hullW * 0.55, 0.04, 0.12);
    rib.translate(0, 0.8 + r * 0.35, rampZ + 0.02);
    p.push({ geo: rib, color: MAST });
  }
  // Ramp arm (curved support, simplified as angled box)
  for (const dx of [-hullW * 0.28, hullW * 0.28]) {
    const arm = new THREE.BoxGeometry(0.12, 1.8, 0.12);
    arm.translate(dx, 1.5, rampZ - 0.2);
    p.push({ geo: arm, color: RAMP });
  }

  // ═══════════════════════════════════════════════════════════════
  // 9. DECK RAILINGS (both decks, bow and stern)
  // ═══════════════════════════════════════════════════════════════

  // Upper deck railings (open aft sun-deck area)
  for (const dx of [-halfW + 0.4, halfW - 0.4]) {
    // Aft section (behind bridge)
    for (let r = 0; r < 4; r++) {
      const rz = -halfL + 1.0 + r * 1.2;
      const post = new THREE.BoxGeometry(0.04, 0.9, 0.04);
      post.translate(dx, 2.6, rz);
      p.push({ geo: post, color: RAIL });
    }
    // Horizontal rail
    const hRail = new THREE.BoxGeometry(0.03, 0.03, 5.0);
    hRail.translate(dx, 3.0, -halfL + 3.0);
    p.push({ geo: hRail, color: RAIL });
  }

  // Lower deck bow railings
  for (const dx of [-halfW + 0.15, halfW - 0.15]) {
    for (let r = 0; r < 3; r++) {
      const rz = halfL - 3.0 + r * 1.0;
      const post = new THREE.BoxGeometry(0.04, 0.8, 0.04);
      post.translate(dx, 1.4, rz);
      p.push({ geo: post, color: RAIL });
    }
    const hRailBow = new THREE.BoxGeometry(0.03, 0.03, 3.0);
    hRailBow.translate(dx, 1.75, halfL - 2.0);
    p.push({ geo: hRailBow, color: RAIL });
  }

  // Stern railings
  for (const dx of [-halfW + 0.15, halfW - 0.15]) {
    for (let r = 0; r < 2; r++) {
      const post = new THREE.BoxGeometry(0.04, 0.8, 0.04);
      post.translate(dx, 1.4, -halfL + 0.3 + r * 1.0);
      p.push({ geo: post, color: RAIL });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 10. DETAILS — bollards, stern platform, flag
  // ═══════════════════════════════════════════════════════════════

  // Stern platform / swim deck
  const sternPlat = new THREE.BoxGeometry(hullW * 0.7, 0.12, 1.2);
  sternPlat.translate(0, -0.1, -halfL - 0.5);
  p.push({ geo: sternPlat, color: DECK });

  // Bollards (4 — 2 bow, 2 stern)
  for (const dz of [halfL - 1.5, -halfL + 0.5]) {
    for (const dx of [-halfW + 0.5, halfW - 0.5]) {
      const bollard = new THREE.CylinderGeometry(0.08, 0.1, 0.35, HS);
      bollard.translate(dx, 1.2, dz);
      p.push({ geo: bollard, color: BELOW });
    }
  }

  // Swedish flag at stern (simplified as blue rectangle + yellow cross)
  const flagPole = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6);
  flagPole.translate(0, 1.8, -halfL - 0.3);
  p.push({ geo: flagPole, color: MAST });
  const flagBlue = new THREE.BoxGeometry(0.04, 0.6, 0.9);
  flagBlue.translate(0, 2.7, -halfL - 0.3);
  p.push({ geo: flagBlue, color: BLUE });
  // Yellow cross (horizontal + vertical bars)
  const crossH = new THREE.BoxGeometry(0.05, 0.12, 0.9);
  crossH.translate(0, 2.7, -halfL - 0.3);
  p.push({ geo: crossH, color: YELLOW });
  const crossV = new THREE.BoxGeometry(0.05, 0.6, 0.12);
  crossV.translate(0, 2.7, -halfL - 0.55);
  p.push({ geo: crossV, color: YELLOW });

  // Searchlight on bridge roof
  const searchlight = new THREE.CylinderGeometry(0.12, 0.12, 0.2, HS);
  searchlight.rotateX(Math.PI / 2);
  searchlight.translate(0, 5.55, bridgeZ + bridgeLen / 2 + 0.2);
  p.push({ geo: searchlight, color: 0xfef3c7 });

  // Lifebuoys (4, mounted on railings)
  for (const [dx, dz] of [[-halfW + 0.1, 2], [halfW - 0.1, 2],
                           [-halfW + 0.1, -4], [halfW - 0.1, -4]]) {
    const buoy = new THREE.TorusGeometry(0.22, 0.06, 8, HS);
    buoy.rotateY(Math.PI / 2);
    buoy.translate(dx, 1.7, dz);
    p.push({ geo: buoy, color: 0xef4444 }); // red/orange
  }

  return _mergeGeomsColored(p);
}

function _buildFerryHeadlightGeometry() {
  // Headlights at bow, similar approach to train headlights
  const hullLen = 28;
  const frontZ = hullLen / 2 + 0.5;
  const parts = [];
  for (const dx of [-0.8, 0.8]) {
    parts.push(..._buildHeadlightCluster(dx, 1.5, frontZ));
  }
  const beam = new THREE.CylinderGeometry(0.3, 1.6, 14.0, S);
  beam.rotateX(Math.PI / 2);
  beam.translate(0, 1.4, frontZ + 7.5);
  parts.push(beam);
  const spill = new THREE.CylinderGeometry(2.0, 2.0, 0.15, S);
  spill.translate(0, 0.15, frontZ + 1.0);
  parts.push(spill);
  return _mergeGeoms(parts);
}

function _buildTramGeometry() {
  // High-poly 4-car articulated tram (~5k faces).
  // Chamfered rectangular cars, detailed windows with individual panes,
  // articulated bellows with ribs, detailed bogies, pantograph,
  // front/rear cab faces with headlights.
  const BODY     = _tramBodyColor;
  const TRIM     = _darkenCol(_tramBodyColor, 0.45);
  const WINDOW   = 0x111827;
  const ROOF     = 0x6b7280;
  const BELLOW   = 0x374151;
  const BOGIE    = 0x1c1917;
  const PANTO    = 0x44403c;
  const DEST     = 0xf59e0b;
  const HEADLT   = 0xfef3c7;
  const DOOR     = _darkenCol(_tramBodyColor, 0.55);
  const p = [];

  const carLen   = 5.5;
  const carW     = 2.5;
  const bellowW  = 0.7;
  const numCars  = 4;
  const totalLen = numCars * carLen + (numCars - 1) * bellowW;
  const startZ   = totalLen / 2;

  for (let c = 0; c < numCars; c++) {
    const cz = startZ - c * (carLen + bellowW) - carLen / 2;

    // ── Car body (chamfered via _roundedBody) ──
    const body = _roundedBody(carW, 2.0, carLen, S);
    body.translate(0, 1.3, cz);
    p.push({ geo: body, color: BODY });

    // Lower skirt
    const skirt = new THREE.BoxGeometry(carW + 0.04, 0.25, carLen);
    skirt.translate(0, 0.15, cz);
    p.push({ geo: skirt, color: TRIM });

    // Trim line (darker green strip between body and windows)
    for (const dx of [-carW / 2 - 0.02, carW / 2 + 0.02]) {
      const trim = new THREE.BoxGeometry(0.05, 0.12, carLen - 0.3);
      trim.translate(dx, 1.95, cz);
      p.push({ geo: trim, color: TRIM });
    }

    // ── Window band ──
    // Upper body section (window area)
    const upper = new THREE.BoxGeometry(carW - 0.08, 0.8, carLen - 0.3);
    upper.translate(0, 2.5, cz);
    p.push({ geo: upper, color: WINDOW });

    // Individual window panes (6 per side per car)
    const paneCount = 6;
    const paneSpacing = (carLen - 1.0) / paneCount;
    for (let w = 0; w < paneCount; w++) {
      const wz = cz - carLen / 2 + 0.5 + w * paneSpacing + paneSpacing / 2;
      for (const dx of [-(carW / 2 + 0.01), (carW / 2 + 0.01)]) {
        const pane = new THREE.BoxGeometry(0.04, 0.7, paneSpacing * 0.7);
        pane.translate(dx, 2.5, wz);
        p.push({ geo: pane, color: WINDOW });
      }
    }

    // Pillars between windows
    for (let w = 1; w < paneCount; w++) {
      const wz = cz - carLen / 2 + 0.5 + w * paneSpacing;
      for (const dx of [-(carW / 2 + 0.02), (carW / 2 + 0.02)]) {
        const pillar = new THREE.BoxGeometry(0.05, 0.8, 0.08);
        pillar.translate(dx, 2.5, wz);
        p.push({ geo: pillar, color: BODY });
      }
    }

    // ── Doors (1 per side per car) ──
    for (const dx of [-(carW / 2 + 0.02), (carW / 2 + 0.02)]) {
      const doorFrame = new THREE.BoxGeometry(0.04, 1.8, 0.9);
      doorFrame.translate(dx, 1.4, cz);
      p.push({ geo: doorFrame, color: DOOR });
      const doorWin = new THREE.BoxGeometry(0.04, 0.6, 0.6);
      doorWin.translate(dx, 2.2, cz);
      p.push({ geo: doorWin, color: WINDOW });
    }

    // ── Roof (flat top) ──
    const roof = new THREE.BoxGeometry(carW, 0.18, carLen - 0.15);
    roof.translate(0, 2.98, cz);
    p.push({ geo: roof, color: ROOF });

    // ── Bogies (2 per car) ──
    for (const endSign of [-1, 1]) {
      const bz = cz + endSign * (carLen / 2 - 0.9);
      // Frame
      const frame = new THREE.BoxGeometry(2.1, 0.2, 1.3);
      frame.translate(0, -0.05, bz);
      p.push({ geo: frame, color: BOGIE });
      // Side frames
      for (const dx of [-0.9, 0.9]) {
        const sf = new THREE.BoxGeometry(0.12, 0.35, 1.2);
        sf.translate(dx, -0.05, bz);
        p.push({ geo: sf, color: BOGIE });
      }
      // Wheels (4 per bogie: 2 axles × 2 sides)
      for (const dx of [-0.85, 0.85]) {
        for (const wdz of [-0.3, 0.3]) {
          const wh = new THREE.CylinderGeometry(0.3, 0.3, 0.25, S);
          wh.rotateZ(Math.PI / 2);
          wh.translate(dx, -0.1, bz + wdz);
          p.push({ geo: wh, color: BOGIE });
        }
      }
    }
  }

  // ── Articulated bellows ──
  for (let j = 0; j < numCars - 1; j++) {
    const jz = startZ - (j + 1) * carLen - j * bellowW - bellowW / 2;
    const bellow = new THREE.BoxGeometry(carW - 0.3, 2.0, bellowW - 0.1);
    bellow.translate(0, 1.3, jz);
    p.push({ geo: bellow, color: BELLOW });
    // 5 accordion ribs per joint
    for (let r = -2; r <= 2; r++) {
      const rib = new THREE.BoxGeometry(carW - 0.15, 2.1, 0.05);
      rib.translate(0, 1.3, jz + r * (bellowW / 5));
      p.push({ geo: rib, color: BOGIE });
    }
    // Gangway floor
    const floor = new THREE.BoxGeometry(carW - 0.4, 0.1, bellowW - 0.15);
    floor.translate(0, 0.25, jz);
    p.push({ geo: floor, color: BELLOW });
  }

  // ── Front cab face ──
  const fz = startZ;
  // Full face
  const fFace = new THREE.BoxGeometry(carW, 2.4, 0.12);
  fFace.translate(0, 1.5, fz + 0.06);
  p.push({ geo: fFace, color: BODY });
  // Large windshield
  const fWind = new THREE.BoxGeometry(carW - 0.5, 1.0, 0.1);
  fWind.translate(0, 2.4, fz + 0.08);
  p.push({ geo: fWind, color: WINDOW });
  // Windshield divider
  const fDiv = new THREE.BoxGeometry(0.06, 1.0, 0.11);
  fDiv.translate(0, 2.4, fz + 0.09);
  p.push({ geo: fDiv, color: BODY });
  // Destination display
  const fDest = new THREE.BoxGeometry(1.4, 0.28, 0.08);
  fDest.translate(0, 2.95, fz + 0.08);
  p.push({ geo: fDest, color: DEST });
  // Lower front panel
  const fLower = new THREE.BoxGeometry(carW - 0.2, 0.6, 0.1);
  fLower.translate(0, 0.9, fz + 0.08);
  p.push({ geo: fLower, color: TRIM });
  // Headlights
  for (const dx of [-0.85, 0.85]) {
    const hl = new THREE.CylinderGeometry(0.15, 0.15, 0.1, S);
    hl.rotateX(Math.PI / 2);
    hl.translate(dx, 1.5, fz + 0.12);
    p.push({ geo: hl, color: HEADLT });
  }
  // Bumper
  const fBump = new THREE.BoxGeometry(carW, 0.18, 0.12);
  fBump.translate(0, 0.18, fz + 0.1);
  p.push({ geo: fBump, color: BOGIE });
  // Coupler
  const fCoup = new THREE.BoxGeometry(0.4, 0.2, 0.3);
  fCoup.translate(0, 0.3, fz + 0.2);
  p.push({ geo: fCoup, color: BOGIE });

  // ── Rear cab face (mirror of front) ──
  const rz = -startZ;
  const rFace = new THREE.BoxGeometry(carW, 2.4, 0.12);
  rFace.translate(0, 1.5, rz - 0.06);
  p.push({ geo: rFace, color: BODY });
  const rWind = new THREE.BoxGeometry(carW - 0.5, 1.0, 0.1);
  rWind.translate(0, 2.4, rz - 0.08);
  p.push({ geo: rWind, color: WINDOW });
  const rDiv = new THREE.BoxGeometry(0.06, 1.0, 0.11);
  rDiv.translate(0, 2.4, rz - 0.09);
  p.push({ geo: rDiv, color: BODY });
  const rDest = new THREE.BoxGeometry(1.4, 0.28, 0.08);
  rDest.translate(0, 2.95, rz - 0.08);
  p.push({ geo: rDest, color: DEST });
  const rLower = new THREE.BoxGeometry(carW - 0.2, 0.6, 0.1);
  rLower.translate(0, 0.9, rz - 0.08);
  p.push({ geo: rLower, color: TRIM });
  for (const dx of [-0.85, 0.85]) {
    // Tail lights (red)
    const tl = new THREE.CylinderGeometry(0.12, 0.12, 0.1, S);
    tl.rotateX(Math.PI / 2);
    tl.translate(dx, 1.5, rz - 0.12);
    p.push({ geo: tl, color: 0xdc2626 });
  }
  const rBump = new THREE.BoxGeometry(carW, 0.18, 0.12);
  rBump.translate(0, 0.18, rz - 0.1);
  p.push({ geo: rBump, color: BOGIE });
  const rCoup = new THREE.BoxGeometry(0.4, 0.2, 0.3);
  rCoup.translate(0, 0.3, rz - 0.2);
  p.push({ geo: rCoup, color: BOGIE });

  // ── Pantograph (on car 1 roof) ──
  const pantoZ = startZ - 1 * (carLen + bellowW) - carLen / 2;
  // Base insulators
  for (const dx of [-0.25, 0.25]) {
    const insul = new THREE.CylinderGeometry(0.08, 0.08, 0.2, S);
    insul.translate(dx, 3.15, pantoZ);
    p.push({ geo: insul, color: PANTO });
  }
  // Base frame
  const pBase = new THREE.BoxGeometry(0.8, 0.1, 0.5);
  pBase.translate(0, 3.25, pantoZ);
  p.push({ geo: pBase, color: PANTO });
  // Lower arm (angled)
  const armL = new THREE.BoxGeometry(0.08, 1.0, 0.08);
  armL.translate(-0.15, 3.7, pantoZ - 0.1);
  p.push({ geo: armL, color: PANTO });
  const armR = new THREE.BoxGeometry(0.08, 1.0, 0.08);
  armR.translate(0.15, 3.7, pantoZ + 0.1);
  p.push({ geo: armR, color: PANTO });
  // Upper arm
  const armU = new THREE.BoxGeometry(0.06, 0.8, 0.06);
  armU.translate(0, 4.4, pantoZ);
  p.push({ geo: armU, color: PANTO });
  // Contact strip
  const contact = new THREE.BoxGeometry(1.4, 0.04, 0.04);
  contact.translate(0, 4.8, pantoZ);
  p.push({ geo: contact, color: PANTO });
  // Cross brace
  const brace = new THREE.BoxGeometry(0.5, 0.04, 0.04);
  brace.translate(0, 4.2, pantoZ);
  p.push({ geo: brace, color: PANTO });

  return _mergeGeomsColored(p);
}

// ── High-poly bus helper ────────────────────────────────────────────────────
// Shared builder for all 3 bus variants. Accepts colour palette + length.

function _busCommon(palette, busLen) {
  const { BODY, LOWER, WINDOW, BUMPER, WHEEL, GRILLE, ROOF_AC, MIRROR, STRIPE } = palette;
  const halfL = busLen / 2;
  const p = [];

  // ── 1. Main body — rounded rectangle with high segment count ──
  const bodyLow = _roundedBody(2.5, 1.6, busLen, S);
  bodyLow.translate(0, 1.1, 0);
  p.push({ geo: bodyLow, color: BODY });

  // Lower skirt (darker trim)
  const skirt = new THREE.BoxGeometry(2.55, 0.3, busLen);
  skirt.translate(0, 0.15, 0);
  p.push({ geo: skirt, color: LOWER });

  // Upper body (window band area)
  const bodyUp = new THREE.BoxGeometry(2.4, 1.2, busLen - 0.3);
  bodyUp.translate(0, 2.5, 0);
  p.push({ geo: bodyUp, color: WINDOW });

  // Body pillars between windows (every ~1.5m)
  const pillarCount = Math.floor(busLen / 1.5);
  for (let i = 1; i < pillarCount; i++) {
    const pz = -halfL + i * (busLen / pillarCount);
    for (const dx of [-1.22, 1.22]) {
      const pillar = new THREE.BoxGeometry(0.06, 1.2, 0.1);
      pillar.translate(dx, 2.5, pz);
      p.push({ geo: pillar, color: BODY });
    }
  }

  // Horizontal stripe (livery accent line)
  if (STRIPE) {
    for (const dx of [-1.28, 1.28]) {
      const str = new THREE.BoxGeometry(0.06, 0.12, busLen - 0.6);
      str.translate(dx, 1.95, 0);
      p.push({ geo: str, color: STRIPE });
    }
  }

  // ── 2. Roof (flat top) ──
  const roof = new THREE.BoxGeometry(2.5, 0.18, busLen - 0.2);
  roof.translate(0, 3.18, 0);
  p.push({ geo: roof, color: BODY });

  // AC unit
  const acUnit = new THREE.BoxGeometry(1.4, 0.3, 2.4);
  acUnit.translate(0, 3.5, -1.0);
  p.push({ geo: acUnit, color: ROOF_AC });

  // ── 3. Front face ──
  const windshield = new THREE.BoxGeometry(2.2, 1.3, 0.12);
  windshield.translate(0, 2.5, halfL + 0.02);
  p.push({ geo: windshield, color: WINDOW });
  // Destination display
  const dest = new THREE.BoxGeometry(1.4, 0.3, 0.08);
  dest.translate(0, 3.1, halfL + 0.04);
  p.push({ geo: dest, color: 0xf59e0b });
  // Front grille panel
  const frontPanel = new THREE.BoxGeometry(2.4, 0.8, 0.15);
  frontPanel.translate(0, 1.3, halfL);
  p.push({ geo: frontPanel, color: GRILLE });
  // Headlight housings
  for (const dx of [-0.85, 0.85]) {
    const hl = new THREE.CylinderGeometry(0.2, 0.2, 0.15, S);
    hl.rotateX(Math.PI / 2);
    hl.translate(dx, 1.0, halfL + 0.08);
    p.push({ geo: hl, color: 0xfef3c7 });
  }
  // Front bumper
  const bumper = new THREE.BoxGeometry(2.5, 0.35, 0.25);
  bumper.translate(0, 0.45, halfL + 0.05);
  p.push({ geo: bumper, color: BUMPER });

  // ── 4. Rear face ──
  const rearPanel = new THREE.BoxGeometry(2.4, 1.8, 0.12);
  rearPanel.translate(0, 2.0, -halfL - 0.02);
  p.push({ geo: rearPanel, color: BODY });
  const rearGrille = new THREE.BoxGeometry(2.2, 0.7, 0.15);
  rearGrille.translate(0, 0.65, -halfL - 0.04);
  p.push({ geo: rearGrille, color: GRILLE });
  // Tail lights
  for (const dx of [-0.9, 0.9]) {
    const tl = new THREE.BoxGeometry(0.3, 0.2, 0.1);
    tl.translate(dx, 1.6, -halfL - 0.06);
    p.push({ geo: tl, color: 0xdc2626 });
  }
  const rearBumper = new THREE.BoxGeometry(2.5, 0.35, 0.25);
  rearBumper.translate(0, 0.45, -halfL - 0.05);
  p.push({ geo: rearBumper, color: BUMPER });

  // ── 5. Wheels (high-poly cylinders) ──
  // Front axle
  for (const dx of [-1.3, 1.3]) {
    const wf = new THREE.CylinderGeometry(0.55, 0.55, 0.4, S);
    wf.rotateZ(Math.PI / 2);
    wf.translate(dx, 0.55, halfL - 1.8);
    p.push({ geo: wf, color: WHEEL });
    // Hub cap
    const hub = new THREE.CylinderGeometry(0.25, 0.25, 0.42, S);
    hub.rotateZ(Math.PI / 2);
    hub.translate(dx, 0.55, halfL - 1.8);
    p.push({ geo: hub, color: GRILLE });
  }
  // Rear axle — dual wheels
  for (const dx of [-1.2, 1.2]) {
    for (const mult of [0.85, 1.15]) {
      const w = new THREE.CylinderGeometry(0.55, 0.55, 0.25, S);
      w.rotateZ(Math.PI / 2);
      w.translate(dx * mult, 0.55, -halfL + 1.8);
      p.push({ geo: w, color: WHEEL });
    }
  }

  // ── 6. Wheel arches ──
  for (const dz of [halfL - 1.8, -halfL + 1.8]) {
    const arch = new THREE.CylinderGeometry(0.72, 0.72, 2.6, S, 1, false, 0, Math.PI);
    arch.rotateZ(Math.PI / 2);
    arch.translate(0, 0.55, dz);
    p.push({ geo: arch, color: LOWER });
  }

  // ── 7. Side mirrors ──
  for (const dx of [-1.4, 1.4]) {
    const arm = new THREE.BoxGeometry(0.35, 0.06, 0.3);
    arm.translate(dx, 2.6, halfL - 0.2);
    p.push({ geo: arm, color: MIRROR });
    const glass = new THREE.BoxGeometry(0.2, 0.2, 0.12);
    glass.translate(dx, 2.55, halfL);
    p.push({ geo: glass, color: WINDOW });
  }

  // ── 8. Doors (2 per side) ──
  for (const dz of [halfL - 3.0, -0.5]) {
    for (const dx of [-1.27, 1.27]) {
      const door = new THREE.BoxGeometry(0.06, 2.0, 0.9);
      door.translate(dx, 1.6, dz);
      p.push({ geo: door, color: WINDOW });
    }
  }

  return _mergeGeomsColored(p);
}

// Bus variants — colours driven by operator branding from _configureBranding()
function _buildBusGeometry()  { return _busCommon(_busPalettes[0], 9.5); }
function _buildBusBGeometry() { return _busCommon(_busPalettes[1], 9.5); }
function _buildBusCGeometry() { return _busCommon(_busPalettes[2], 8.5); }

// Headlights use spheres for soft glow + a tapered cylinder beam cone.
// Overlapping additive layers compound brightness in the centre.

function _buildHeadlightCluster(centerX, lampY, lampZ) {
  const parts = [];
  // Outer halo — sphere
  const halo = new THREE.SphereGeometry(0.8, 8, 6);
  halo.translate(centerX, lampY, lampZ);
  parts.push(halo);
  // Mid glow
  const mid = new THREE.SphereGeometry(0.5, 8, 6);
  mid.translate(centerX, lampY, lampZ);
  parts.push(mid);
  // Bright core
  const core = new THREE.SphereGeometry(0.25, 6, 4);
  core.translate(centerX, lampY, lampZ);
  parts.push(core);
  return parts;
}

function _busHeadlight(frontZ) {
  const parts = [];
  for (const dx of [-0.8, 0.8]) {
    parts.push(..._buildHeadlightCluster(dx, 1.0, frontZ));
  }
  const beam = new THREE.CylinderGeometry(0.3, 1.3, 10.0, S);
  beam.rotateX(Math.PI / 2);
  beam.translate(0, 0.9, frontZ + 5.5);
  parts.push(beam);
  const spill = new THREE.CylinderGeometry(1.5, 1.5, 0.15, S);
  spill.translate(0, 0.15, frontZ + 1.0);
  parts.push(spill);
  return _mergeGeoms(parts);
}
function _buildBusHeadlightGeometry()  { return _busHeadlight(9.5 / 2 + 0.1); }
function _buildBusBHeadlightGeometry() { return _busHeadlight(9.5 / 2 + 0.1); }
function _buildBusCHeadlightGeometry() { return _busHeadlight(8.5 / 2 + 0.1); }

function _buildTramHeadlightGeometry() {
  // Tram front is at z ≈ 10.9 (totalLen/2 = 21.8/2)
  const frontZ = 10.9;
  const parts = [];
  for (const dx of [-0.6, 0.6]) {
    parts.push(..._buildHeadlightCluster(dx, 1.0, frontZ + 0.3));
  }
  const beam = new THREE.CylinderGeometry(0.2, 1.2, 9.0, 8);
  beam.rotateX(Math.PI / 2);
  beam.translate(0, 0.9, frontZ + 5.0);
  parts.push(beam);
  const spill = new THREE.CylinderGeometry(1.3, 1.3, 0.15, 8);
  spill.translate(0, 0.1, frontZ + 1.0);
  parts.push(spill);
  return _mergeGeoms(parts);
}

function _trainHeadlight(numCars) {
  // Front face is at totalLen/2 (flush with body — no cone)
  const totalLen = numCars * 9.0 + (numCars - 1) * 1.0;
  const frontZ = totalLen / 2 + 0.3;
  const parts = [];
  // Dual headlights at cab height
  for (const dx of [-0.9, 0.9]) {
    parts.push(..._buildHeadlightCluster(dx, 1.3, frontZ));
  }
  const beam = new THREE.CylinderGeometry(0.3, 1.4, 12.0, S);
  beam.rotateX(Math.PI / 2);
  beam.translate(0, 1.2, frontZ + 6.5);
  parts.push(beam);
  const spill = new THREE.CylinderGeometry(1.6, 1.6, 0.15, S);
  spill.translate(0, 0.15, frontZ + 0.8);
  parts.push(spill);
  return _mergeGeoms(parts);
}
function _buildTrainHeadlightGeometry()  { return _trainHeadlight(3); }
function _buildTrainBHeadlightGeometry() { return _trainHeadlight(4); }
function _buildTrainCHeadlightGeometry() { return _trainHeadlight(3); }

/**
 * Merge geometry parts that each carry a colour tag. Returns a single
 * BufferGeometry with a per-vertex `color` attribute baked in.
 * @param {Array<{geo: BufferGeometry, color: number}>} entries
 */
function _mergeGeomsColored(entries) {
  const geoms  = entries.map(e => e.geo);
  const merged = _mergeGeoms(geoms);

  // Walk entries again, painting vertex colours into the merged buffer.
  const count  = merged.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  let vOff = 0;
  for (const entry of entries) {
    c.setHex(entry.color);
    const n = entry.geo.attributes.position.count;
    for (let i = 0; i < n; i++) {
      colors[(vOff + i) * 3    ] = c.r;
      colors[(vOff + i) * 3 + 1] = c.g;
      colors[(vOff + i) * 3 + 2] = c.b;
    }
    vOff += n;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

/** Cheap geometry merge by concatenating attribute arrays. Three.js has a
 *  proper utility but we'd need to import it; this hand-rolled version
 *  works for our merge case (all BoxGeometries, position+normal only). */
function _mergeGeoms(geoms) {
  let posCount = 0, normCount = 0, indexCount = 0;
  let hasIndex = true;
  for (const g of geoms) {
    posCount += g.attributes.position.count;
    if (g.attributes.normal) normCount += g.attributes.normal.count;
    if (g.index) indexCount += g.index.count;
    else hasIndex = false;
  }

  const positions = new Float32Array(posCount * 3);
  const normals = new Float32Array(normCount * 3);
  const IndexArray = posCount > 65535 ? Uint32Array : Uint16Array;
  const indices = hasIndex ? new IndexArray(indexCount) : null;
  let pOff = 0, nOff = 0, iOff = 0, vOff = 0;

  for (const g of geoms) {
    const p = g.attributes.position.array;
    positions.set(p, pOff * 3);
    if (g.attributes.normal) {
      normals.set(g.attributes.normal.array, nOff * 3);
    }
    if (hasIndex && g.index) {
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i++) {
        indices[iOff + i] = idx[i] + vOff;
      }
      iOff += idx.length;
    }
    vOff += g.attributes.position.count;
    pOff += g.attributes.position.count;
    nOff += g.attributes.normal ? g.attributes.normal.count : 0;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (hasIndex) merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}


export function setBusPalette(i, hex) { _busPalettes[i] = _deriveBusPalette(hex); }
export function setTrainPalette(i, hex) { _trainPalettes[i] = _deriveTrainPalette(hex); }
export const buildBus      = () => _buildBusGeometry();
export const buildBusB     = () => _buildBusBGeometry();
export const buildBusLen   = (paletteIdx, len) => _busCommon(_busPalettes[paletteIdx], len);
export const buildTrain    = () => _buildTrainGeometry();
export const buildTrainB   = () => _buildTrainBGeometry();
export const buildOresund  = () => _buildOresundstagGeometry();
export const buildTram     = () => _buildTramGeometry();
export const buildPlane    = () => _buildPlaneGeometry();
export const mergeColored  = (entries) => _mergeGeomsColored(entries);
