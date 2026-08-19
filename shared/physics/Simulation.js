// The deterministic pool simulation. Runs bit-identically on every client and
// the server (SDD §2). Inside the step loop only + - * / and sqrt are used;
// state snaps to a 1e-7 grid at each step end.

import {
  BALL_R, DT, G,
  MU_SLIDE, MU_ROLL, MU_SPIN, MU_BALL, E_BALL, SPIN_TRANSFER,
  E_CUSH, MU_CUSH, K_SPIN_RAIL, RAIL_SPIN_KILL,
  V_MAX, V_MAX_BREAK, SPIN_EFF, TIP_MAX,
  U_ROLL_EPS, V_REST, W_REST,
  MAX_STEPS, MAX_EVENTS_PER_STEP, BREAK_JITTER,
  TABLE_L, TABLE_W, HEADSTRING_X, STATE,
} from '../Constants.js';
import { TABLE, segmentTOI, ballTOI, pocketAt, nearestPocket, outOfBounds } from './Collisions.js';
import { q, hashBalls, hashInput, xorshift32 } from './StateHash.js';
import { cloneBalls } from './Rack.js';

const SLIP_DECEL = 3.5 * MU_SLIDE * G;          // slip decays at (7/2)·μg
const SPIN_DECEL = (5 * MU_SPIN * G) / (2 * BALL_R);
const TWO_R = 2 * BALL_R;

// ---------------------------------------------------------------- strike

// input: { dir:{dx,dy} unit-quantized, power int 0..1000, tip:{ox,oy} int
// hundredths of R, place?:{x,y} } — see SDD §4.1.
export function applyStrike(cue, input, isBreak) {
  const p = Math.max(1, Math.min(1000, input.power | 0)) / 1000;
  const v0 = p * (isBreak ? V_MAX_BREAK : V_MAX);
  const { dx, dy } = input.dir;
  const ox = Math.max(-TIP_MAX, Math.min(TIP_MAX, input.tip.ox | 0)) / 100;
  const oy = Math.max(-TIP_MAX, Math.min(TIP_MAX, input.tip.oy | 0)) / 100;
  const spin = ((5 * v0) / (2 * BALL_R)) * SPIN_EFF;

  cue.vx = dx * v0;
  cue.vy = dy * v0;
  cue.wz = spin * ox;               // english
  cue.wx = -dy * spin * oy;         // follow (+oy) / draw (-oy): natural-roll axis
  cue.wy = dx * spin * oy;
  cue.state = STATE.SLIDING;
}

// ---------------------------------------------------------------- friction

function applyFriction(b) {
  if (b.state === STATE.POCKETED) return;

  // English decays whether moving or not.
  if (b.wz !== 0) {
    const dw = SPIN_DECEL * DT;
    b.wz = b.wz > 0 ? Math.max(0, b.wz - dw) : Math.min(0, b.wz + dw);
  }
  if (b.state === STATE.STATIONARY) return;

  let ux = b.vx - BALL_R * b.wy;
  let uy = b.vy + BALL_R * b.wx;
  let umag = Math.sqrt(ux * ux + uy * uy);
  let tLeft = DT;

  if (umag >= U_ROLL_EPS) {
    b.state = STATE.SLIDING;
    const tRoll = umag / SLIP_DECEL;
    const tau = tRoll < tLeft ? tRoll : tLeft;
    ux /= umag;
    uy /= umag;
    b.vx -= MU_SLIDE * G * ux * tau;
    b.vy -= MU_SLIDE * G * uy * tau;
    const dwc = ((5 * MU_SLIDE * G) / (2 * BALL_R)) * tau;
    b.wx -= dwc * uy;
    b.wy += dwc * ux;
    tLeft -= tau;
    if (tLeft <= 0) { finishRest(b, umag - SLIP_DECEL * tau); return; }
  }

  // Rolling (either from the start, or after the slide phase ran dry).
  b.state = STATE.ROLLING;
  b.wy = b.vx / BALL_R;             // snap to exact roll — kills residual slip
  b.wx = -b.vy / BALL_R;
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (speed > 0) {
    const dv = MU_ROLL * G * tLeft;
    const ns = speed - dv > 0 ? speed - dv : 0;
    const k = ns / speed;
    b.vx *= k;
    b.vy *= k;
    b.wy = b.vx / BALL_R;
    b.wx = -b.vy / BALL_R;
  }
  finishRest(b, 0);
}

function finishRest(b, slipLeft) {
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (speed < V_REST && slipLeft < U_ROLL_EPS) {
    b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
    b.state = STATE.STATIONARY;
  }
}

// ---------------------------------------------------------------- impulses

function resolveBallBall(a, b, events) {
  let nx = b.x - a.x;
  let ny = b.y - a.y;
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist === 0) return;
  nx /= dist;
  ny /= dist;

  const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rvn <= 0) return; // glancing bookkeeping race: not actually approaching

  const j = ((1 + E_BALL) / 2) * rvn;
  a.vx -= j * nx; a.vy -= j * ny;
  b.vx += j * nx; b.vy += j * ny;

  // Throw: contact friction opposes relative surface slip along the tangent.
  const tx = -ny;
  const ty = nx;
  const slip = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + BALL_R * (a.wz + b.wz);
  if (slip !== 0) {
    const cap = slip > 0 ? slip / 2 : -slip / 2;
    let jt = MU_BALL * j;
    if (jt > cap) jt = cap;
    const s = slip > 0 ? 1 : -1;
    a.vx -= s * jt * tx; a.vy -= s * jt * ty;
    b.vx += s * jt * tx; b.vy += s * jt * ty;
    const pass = a.wz * SPIN_TRANSFER;
    b.wz += pass;
    a.wz -= pass;
  }

  a.state = STATE.SLIDING;
  b.state = STATE.SLIDING;
  events.push({ type: 'ball', a: a.id, b: b.id });
}

function resolveCushion(b, nx, ny, events) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const tx = -ny;
  const ty = nx;
  const vt = b.vx * tx + b.vy * ty;
  const vn2 = -E_CUSH * vn;
  const vt2 = vt * (1 - MU_CUSH) + b.wz * BALL_R * MU_CUSH * K_SPIN_RAIL;
  b.vx = vn2 * nx + vt2 * tx;
  b.vy = vn2 * ny + vt2 * ty;
  b.wz *= RAIL_SPIN_KILL;
  b.state = STATE.SLIDING;
  events.push({ type: 'rail', ball: b.id });
}

function pocketBall(b, pocket, events) {
  b.x = -1; b.y = -1;
  b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0;
  b.state = STATE.POCKETED;
  events.push({ type: 'pocket', ball: b.id, pocket: pocket.id });
}

function checkPockets(balls, events) {
  for (const b of balls) {
    if (b.state === STATE.POCKETED || b.state === STATE.STATIONARY) continue;
    const p = pocketAt(b.x, b.y);
    if (p) { pocketBall(b, p, events); continue; }
    if (outOfBounds(b.x, b.y)) pocketBall(b, nearestPocket(b.x, b.y), events);
  }
}

// ---------------------------------------------------------------- stepping

export function step(balls, events) {
  for (const b of balls) applyFriction(b);

  let tLeft = DT;
  for (let iter = 0; iter < MAX_EVENTS_PER_STEP && tLeft > 0; iter += 1) {
    // Earliest event across all pairs and segments; deterministic tie-break
    // by scan order (fixed ball id order, fixed segment order).
    let et = tLeft;
    let hit = null;
    for (let i = 0; i < balls.length; i += 1) {
      const a = balls[i];
      if (a.state === STATE.POCKETED) continue;
      const moving = a.vx !== 0 || a.vy !== 0;
      if (moving) {
        for (const s of TABLE.segments) {
          const r = segmentTOI(a, s, et);
          if (r && r.t < et) { et = r.t; hit = { kind: 'cushion', a, nx: r.nx, ny: r.ny }; }
        }
      }
      for (let k = i + 1; k < balls.length; k += 1) {
        const c = balls[k];
        if (c.state === STATE.POCKETED) continue;
        if (!moving && c.vx === 0 && c.vy === 0) continue;
        const t = ballTOI(a, c, et);
        if (t !== null && t < et) { et = t; hit = { kind: 'ball', a, b: c }; }
      }
    }

    for (const b of balls) {
      if (b.state === STATE.POCKETED) continue;
      b.x += b.vx * et;
      b.y += b.vy * et;
    }
    tLeft -= et;
    checkPockets(balls, events);

    if (!hit) break;
    if (hit.kind === 'ball') resolveBallBall(hit.a, hit.b, events);
    else resolveCushion(hit.a, hit.nx, hit.ny, events);
  }

  if (tLeft > 0) {
    // Event budget exhausted (dogpile): drain the remainder without collision
    // checks — rare, bounded, and identical everywhere.
    for (const b of balls) {
      if (b.state === STATE.POCKETED) continue;
      b.x += b.vx * tLeft;
      b.y += b.vy * tLeft;
    }
    checkPockets(balls, events);
  }

  for (const b of balls) {
    b.x = q(b.x); b.y = q(b.y);
    b.vx = q(b.vx); b.vy = q(b.vy);
    b.wx = q(b.wx); b.wy = q(b.wy); b.wz = q(b.wz);
  }
}

export function settled(balls) {
  for (const b of balls) {
    if (b.state === STATE.POCKETED || b.state === STATE.STATIONARY) continue;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- placement

export function isLegalPlacement(balls, x, y, kitchenOnly) {
  if (x < BALL_R || x > TABLE_L - BALL_R || y < BALL_R || y > TABLE_W - BALL_R) return false;
  if (kitchenOnly && x > HEADSTRING_X) return false;
  for (const b of balls) {
    if (b.id === 0 || b.state === STATE.POCKETED) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < TWO_R * TWO_R) return false;
  }
  return true;
}

// ---------------------------------------------------------------- runShot

// Shot setup shared by runShot AND the client-side animator, so a live
// step-by-step animation is bit-identical to the authoritative replay.
export function beginShot(balls, input, { isBreak = false } = {}) {
  const cue = balls.find((b) => b.id === 0);

  if (input.place) {
    cue.x = q(input.place.x);
    cue.y = q(input.place.y);
    cue.vx = 0; cue.vy = 0; cue.wx = 0; cue.wy = 0; cue.wz = 0;
    cue.state = STATE.STATIONARY;
  }

  if (isBreak) {
    // Seeded sub-mm rack jitter: varied breaks, exact replays (SDD §2.6.4).
    const rand = xorshift32(hashInput(input));
    for (const b of balls) {
      if (b.id === 0) continue;
      b.x = q(b.x + (rand() * 2 - 1) * BREAK_JITTER);
      b.y = q(b.y + (rand() * 2 - 1) * BREAK_JITTER);
    }
  }

  applyStrike(cue, input, isBreak);
  return balls;
}

// Settle bookkeeping shared by runShot and the animator.
export function finalizeShot(balls) {
  for (const b of balls) {
    if (b.state !== STATE.POCKETED && b.state !== STATE.STATIONARY) {
      // 30s cap tripped: force-settle identically everywhere.
      b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0;
      b.state = STATE.STATIONARY;
    }
    b.wz = 0; // residual english is meaningless at rest
  }
  return hashBalls(balls);
}

// The single authoritative entry point: same call on shooter, opponent,
// spectator, and server. Returns settled balls + ordered event log + hash.
export function runShot(startBalls, input, { isBreak = false } = {}) {
  const balls = beginShot(cloneBalls(startBalls), input, { isBreak });
  const events = [];

  let steps = 0;
  while (steps < MAX_STEPS && !settled(balls)) {
    step(balls, events);
    steps += 1;
  }
  const stateHash = finalizeShot(balls);

  return { balls, events, stateHash, steps };
}
