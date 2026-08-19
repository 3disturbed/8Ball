// Rack layout and ball construction. The rack template is fixed (legal: 8 in
// the middle, back corners split solid/stripe); break variety comes from
// seeded sub-millimeter jitter applied inside the sim, not from the template.

import { BALL_R, FOOT_SPOT, HEAD_SPOT, RACK_SPACING, STATE } from '../Constants.js';
import { q } from './StateHash.js';

export function makeBall(id, x, y) {
  return {
    id,
    x: q(x), y: q(y),
    vx: 0, vy: 0,
    wx: 0, wy: 0, wz: 0,
    state: STATE.STATIONARY,
  };
}

// Rows point away from the breaker (+x), apex on the foot spot.
const TEMPLATE = [
  [1],
  [9, 2],
  [3, 8, 10],
  [11, 4, 12, 5],
  [6, 13, 15, 14, 7],
];

export function rackBalls() {
  const balls = [makeBall(0, HEAD_SPOT.x, HEAD_SPOT.y)];
  const rowStep = RACK_SPACING * Math.sqrt(3) / 2;
  for (let row = 0; row < TEMPLATE.length; row += 1) {
    const ids = TEMPLATE[row];
    const x = FOOT_SPOT.x + row * rowStep;
    for (let i = 0; i < ids.length; i += 1) {
      const y = FOOT_SPOT.y + (i - row / 2) * RACK_SPACING;
      balls.push(makeBall(ids[i], x, y));
    }
  }
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

export function cloneBalls(balls) {
  return balls.map((b) => ({ ...b }));
}

export { BALL_R };
