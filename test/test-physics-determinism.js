// Determinism suite (SDD §2.6.5): scripted pseudo-random shots must reproduce
// recorded golden hashes exactly, twice in a row, on any engine. Regenerate
// goldens after a deliberate physics change with:  UPDATE_GOLDEN=1 npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { rackBalls, cloneBalls } from '../shared/physics/Rack.js';
import { runShot, isLegalPlacement, settled } from '../shared/physics/Simulation.js';
import { q, xorshift32, hashBalls, mix } from '../shared/physics/StateHash.js';
import { STATE, TABLE_L, TABLE_W, MAX_STEPS, BALL_R } from '../shared/Constants.js';

// Golden values — regenerate deliberately, never casually.
const GOLDEN = {
  break: null,       // filled below by UPDATE_GOLDEN run
  run100: null,
  run1000: null,
};
// GOLDEN-VALUES-START
GOLDEN.break = 19521268;
GOLDEN.run100 = 1455815234;
GOLDEN.run1000 = 818438481;
// GOLDEN-VALUES-END

function scriptedShot(rand, balls) {
  const cue = balls.find((b) => b.id === 0);
  let place = null;
  if (cue.state === STATE.POCKETED) {
    // scripted ball-in-hand: scan for a legal spot deterministically
    for (let i = 0; i < 200; i += 1) {
      const x = q(BALL_R + rand() * (TABLE_L - 2 * BALL_R));
      const y = q(BALL_R + rand() * (TABLE_W - 2 * BALL_R));
      if (isLegalPlacement(balls, x, y, false)) { place = { x, y }; break; }
    }
    assert.ok(place, 'found a legal placement');
  }
  const ang = rand() * 6.283185307179586;
  // direction via sqrt-free-enough construction is impossible with an angle,
  // so mimic the client: compute once, quantize, and the quantized vector is
  // the canonical input (the sim itself never sees the angle).
  const dx = q(Math.cos(ang));
  const dy = q(Math.sin(ang));
  return {
    dir: { dx, dy },
    power: 100 + Math.floor(rand() * 900),
    tip: { ox: Math.floor(rand() * 101) - 50, oy: Math.floor(rand() * 101) - 50 },
    place,
  };
}

function runSequence(shots) {
  const rand = xorshift32(0xd06f00d);
  let balls = rackBalls();
  let running = 0x811c9dc5 >>> 0;
  let isBreak = true;
  for (let s = 0; s < shots; s += 1) {
    const input = scriptedShot(rand, balls);
    const result = runShot(balls, input, { isBreak });
    assert.ok(result.steps < MAX_STEPS, `shot ${s} settles inside the cap`);
    assert.ok(settled(result.balls), `shot ${s} settled`);
    running = mix(running, result.stateHash);
    balls = result.balls;
    isBreak = false;
    // Re-rack when the table empties out so long sequences stay interesting.
    const onTable = balls.filter((b) => b.id !== 0 && b.state !== STATE.POCKETED);
    if (onTable.length === 0) {
      balls = rackBalls();
      isBreak = true;
    }
  }
  return running >>> 0;
}

test('break shot is reproducible', () => {
  const balls = rackBalls();
  const input = { dir: { dx: 1, dy: 0 }, power: 950, tip: { ox: 0, oy: -20 }, place: null };
  const a = runShot(balls, input, { isBreak: true });
  const b = runShot(balls, input, { isBreak: true });
  assert.equal(a.stateHash, b.stateHash, 'same input, same hash');
  assert.equal(hashBalls(a.balls), hashBalls(b.balls));
  assert.ok(a.events.some((e) => e.type === 'ball'), 'break contacted the rack');
  assert.ok(a.events.filter((e) => e.type === 'rail').length >= 1, 'break reached a rail');
  if (process.env.UPDATE_GOLDEN) console.log(`GOLDEN break = ${a.stateHash}`);
  else assert.equal(a.stateHash, GOLDEN.break, 'golden break hash');
});

test('input mutation changes the outcome', () => {
  const balls = rackBalls();
  const base = { dir: { dx: 1, dy: 0 }, power: 950, tip: { ox: 0, oy: -20 }, place: null };
  const tweaked = { ...base, power: 951 };
  const a = runShot(balls, base, { isBreak: true });
  const b = runShot(balls, tweaked, { isBreak: true });
  assert.notEqual(a.stateHash, b.stateHash);
});

test('balls end on the table or pocketed, never in limbo', () => {
  const rand = xorshift32(42);
  let balls = rackBalls();
  const input = scriptedShot(rand, balls);
  const { balls: out } = runShot(balls, input, { isBreak: true });
  for (const b of out) {
    if (b.state === STATE.POCKETED) continue;
    assert.ok(b.x > 0 && b.x < TABLE_L && b.y > 0 && b.y < TABLE_W, `ball ${b.id} on table`);
    assert.equal(b.vx, 0);
    assert.equal(b.vy, 0);
  }
});

test('100-shot scripted sequence matches golden', () => {
  const h = runSequence(100);
  if (process.env.UPDATE_GOLDEN) console.log(`GOLDEN run100 = ${h}`);
  else assert.equal(h, GOLDEN.run100);
});

test('1000-shot scripted sequence matches golden and replays identically', () => {
  const h1 = runSequence(1000);
  if (process.env.UPDATE_GOLDEN) console.log(`GOLDEN run1000 = ${h1}`);
  else assert.equal(h1, GOLDEN.run1000);
  const h2 = runSequence(1000);
  assert.equal(h1, h2, 'replay identity');
});

test('cloneBalls is a deep copy for sim purposes', () => {
  const balls = rackBalls();
  const copy = cloneBalls(balls);
  copy[0].x = 9;
  assert.notEqual(balls[0].x, 9);
});
