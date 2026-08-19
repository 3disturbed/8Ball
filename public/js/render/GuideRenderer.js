// Geometric aiming guide (SDD §6): ray-cast the cue path to the first ball or
// cushion, ghost ball at contact, object-ball stub, cue tangent stub. Pure
// geometry — deliberately NOT a mini-simulation.

import { BALL_R, TABLE_L, TABLE_W, STATE } from '/shared/Constants.js';
import { TABLE } from '/shared/physics/Collisions.js';

const STUB = 0.28; // object/tangent stub length in meters

export function computeGuide(balls, cue, dx, dy, mode, tipOy = 0) {
  if (mode === 'off') return null;
  const maxLen = mode === 'short' ? 0.9 : 5;

  let bestT = Infinity;
  let hitBall = null;

  for (const b of balls) {
    if (b.id === 0 || b.state === STATE.POCKETED) continue;
    const px = b.x - cue.x;
    const py = b.y - cue.y;
    const proj = px * dx + py * dy;
    if (proj <= 0) continue;
    const perp2 = px * px + py * py - proj * proj;
    const rr = 4 * BALL_R * BALL_R;
    if (perp2 >= rr) continue;
    const t = proj - Math.sqrt(rr - perp2);
    if (t > 0 && t < bestT) { bestT = t; hitBall = b; }
  }

  // Cushion fallback: intersect with rail lines at BALL_R offset
  if (!hitBall) {
    for (const s of TABLE.segments) {
      const d0 = (cue.x - s.x1) * s.nx + (cue.y - s.y1) * s.ny;
      const dv = dx * s.nx + dy * s.ny;
      if (d0 * dv >= 0) continue;
      const side = d0 >= 0 ? 1 : -1;
      const t = (side * BALL_R - d0) / dv;
      if (t <= 0 || t >= bestT) continue;
      const ax = cue.x + dx * t - s.x1;
      const ay = cue.y + dy * t - s.y1;
      const along = ax * s.dx + ay * s.dy;
      if (along >= 0 && along <= s.len) bestT = t;
    }
  }

  const t = Math.min(bestT === Infinity ? maxLen : bestT, maxLen);
  const gx = cue.x + dx * t;
  const gy = cue.y + dy * t;
  const guide = { from: { x: cue.x, y: cue.y }, to: { x: gx, y: gy } };

  if (hitBall && bestT <= maxLen) {
    // Object ball travels along ghost-center line
    let ox = hitBall.x - gx;
    let oy = hitBall.y - gy;
    const om = Math.hypot(ox, oy) || 1;
    ox /= om; oy /= om;
    guide.object = {
      from: { x: hitBall.x, y: hitBall.y },
      to: { x: hitBall.x + ox * STUB, y: hitBall.y + oy * STUB },
    };
    // Cue tangent: perpendicular, picked to the side the cue deflects,
    // bent forward for follow / backward for draw.
    let tx = -oy;
    let ty = ox;
    if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
    const bend = tipOy / 120; // follow(+)/draw(-) visual hint
    let bx = tx + dx * bend;
    let by = ty + dy * bend;
    const bm = Math.hypot(bx, by) || 1;
    guide.tangent = {
      from: { x: gx, y: gy },
      to: { x: gx + (bx / bm) * STUB * 0.75, y: gy + (by / bm) * STUB * 0.75 },
    };
  }

  clampPoint(guide.to);
  return guide;
}

function clampPoint(p) {
  p.x = Math.max(-0.05, Math.min(TABLE_L + 0.05, p.x));
  p.y = Math.max(-0.05, Math.min(TABLE_W + 0.05, p.y));
}
