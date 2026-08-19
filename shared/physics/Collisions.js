// Table geometry and continuous time-of-impact math. Within one timestep the
// sim moves balls at constant velocity, so every TOI here is exact with only
// + - * / and sqrt (the determinism contract, SDD §2.6).

import {
  TABLE_L, TABLE_W, BALL_R,
  POCKET_R_CORNER, POCKET_R_SIDE, POCKET_OFF_CORNER, POCKET_OFF_SIDE,
  MOUTH_CORNER, MOUTH_SIDE, JAW_DEPTH,
} from '../Constants.js';

function seg(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  // n0 is a fixed-orientation unit normal; collision code picks the ball side.
  return { x1, y1, x2, y2, dx: dx / len, dy: dy / len, len, nx: -dy / len, ny: dx / len };
}

export function buildTable() {
  const L = TABLE_L;
  const W = TABLE_W;
  const mc = MOUTH_CORNER;
  const ms = MOUTH_SIDE;
  const j = JAW_DEPTH;
  const mid = L / 2;

  const segments = [
    // 6 rail spans
    seg(mc, 0, mid - ms, 0),          // bottom left span
    seg(mid + ms, 0, L - mc, 0),      // bottom right span
    seg(mc, W, mid - ms, W),          // top left span
    seg(mid + ms, W, L - mc, W),      // top right span
    seg(0, mc, 0, W - mc),            // left span
    seg(L, mc, L, W - mc),            // right span
    // 12 jaws (angled into the pockets)
    seg(mc, 0, j, -j),                seg(0, mc, -j, j),               // bottom-left corner
    seg(L - mc, 0, L - j, -j),        seg(L, mc, L + j, j),            // bottom-right corner
    seg(mc, W, j, W + j),             seg(0, W - mc, -j, W - j),       // top-left corner
    seg(L - mc, W, L - j, W + j),     seg(L, W - mc, L + j, W - j),    // top-right corner
    seg(mid - ms, 0, mid - ms + 0.02, -j), seg(mid + ms, 0, mid + ms - 0.02, -j), // bottom side
    seg(mid - ms, W, mid - ms + 0.02, W + j), seg(mid + ms, W, mid + ms - 0.02, W + j), // top side
  ];

  const oc = POCKET_OFF_CORNER;
  const os = POCKET_OFF_SIDE;
  const pockets = [
    { id: 0, x: -oc, y: -oc, r: POCKET_R_CORNER },          // bottom-left
    { id: 1, x: mid, y: -os, r: POCKET_R_SIDE },            // bottom-side
    { id: 2, x: L + oc, y: -oc, r: POCKET_R_CORNER },       // bottom-right
    { id: 3, x: -oc, y: W + oc, r: POCKET_R_CORNER },       // top-left
    { id: 4, x: mid, y: W + os, r: POCKET_R_SIDE },         // top-side
    { id: 5, x: L + oc, y: W + oc, r: POCKET_R_CORNER },    // top-right
  ];

  return { segments, pockets };
}

export const TABLE = buildTable();

const EPS = 1e-12;

// Earliest time in [0, tMax] when a ball surface reaches this segment.
// Returns { t, nx, ny } (normal pointing toward the ball's side) or null.
export function segmentTOI(b, s, tMax) {
  let best = null;

  // Infinite-line contact, then verify the touch point lies within the span.
  const d0 = (b.x - s.x1) * s.nx + (b.y - s.y1) * s.ny; // signed distance
  const dv = b.vx * s.nx + b.vy * s.ny;                 // approach rate
  if (d0 * dv < -EPS) {                                 // moving toward the line
    const side = d0 >= 0 ? 1 : -1;
    let t = (side * BALL_R - d0) / dv;
    if (t < 0 && d0 * side <= BALL_R) t = 0;            // already touching: resolve now
    if (t >= 0 && t <= tMax) {
      const px = b.x + b.vx * t;
      const py = b.y + b.vy * t;
      const along = (px - s.x1) * s.dx + (py - s.y1) * s.dy;
      if (along >= 0 && along <= s.len) {
        best = { t, nx: side * s.nx, ny: side * s.ny };
      }
    }
  }

  // Endpoint caps.
  for (const [ex, ey] of [[s.x1, s.y1], [s.x2, s.y2]]) {
    const px = b.x - ex;
    const py = b.y - ey;
    const a = b.vx * b.vx + b.vy * b.vy;
    if (a < EPS) continue;
    const bq = 2 * (px * b.vx + py * b.vy);
    if (bq >= 0) continue; // moving away from the endpoint
    const c = px * px + py * py - BALL_R * BALL_R;
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) continue;
    const t = c < 0 ? 0 : (-bq - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > tMax) continue;
    if (best && t >= best.t) continue;
    const nx = (b.x + b.vx * t - ex) / BALL_R;
    const ny = (b.y + b.vy * t - ey) / BALL_R;
    best = { t, nx, ny };
  }

  return best;
}

// Earliest time in [0, tMax] when two ball surfaces touch, or null.
export function ballTOI(b1, b2, tMax) {
  const px = b2.x - b1.x;
  const py = b2.y - b1.y;
  const vx = b2.vx - b1.vx;
  const vy = b2.vy - b1.vy;
  const bq = 2 * (px * vx + py * vy);
  if (bq >= 0) return null; // separating
  const c = px * px + py * py - 4 * BALL_R * BALL_R;
  if (c < 0) return 0;      // already overlapping and approaching: resolve now
  const a = vx * vx + vy * vy;
  if (a < EPS) return null;
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return null;
  const t = (-bq - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= tMax ? t : null;
}

export function pocketAt(x, y) {
  for (const p of TABLE.pockets) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < p.r * p.r) return p;
  }
  return null;
}

// Escape hatch: a ball that slips through a jaw gap is assigned the nearest
// pocket rather than sailing off the table.
export function nearestPocket(x, y) {
  let best = TABLE.pockets[0];
  let bd = Infinity;
  for (const p of TABLE.pockets) {
    const dx = x - p.x;
    const dy = y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function outOfBounds(x, y) {
  return x < -0.06 || x > TABLE_L + 0.06 || y < -0.06 || y > TABLE_W + 0.06;
}
