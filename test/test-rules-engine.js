// Table-driven rules coverage (SDD §3): every foul, win, loss and
// group-assignment case per preset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rackBalls } from '../shared/physics/Rack.js';
import { STATE, FOOT_SPOT } from '../shared/Constants.js';
import {
  newRack, applyShot, timeoutRuling, respotEight, remaining,
} from '../shared/rules/RulesEngine.js';
import { makeConfig } from '../shared/rules/Presets.js';
import { newMatch, applyMatchShot } from '../shared/rules/Match.js';

const contact = (a, b) => ({ type: 'ball', a, b, speed: 1 });
const rail = (ball) => ({ type: 'rail', ball, speed: 1 });
const pocket = (ball, p = 0) => ({ type: 'pocket', ball, pocket: p });

// Balls AFTER the shot: `potted` are POCKETED (this shot or earlier).
function tableWith(potted = []) {
  const balls = rackBalls();
  for (const b of balls) {
    if (potted.includes(b.id)) {
      b.state = STATE.POCKETED;
      b.x = -1; b.y = -1;
    }
  }
  return balls;
}

const shot = (calledPocket = null) => ({
  dir: { dx: 1, dy: 0 }, power: 500, tip: { ox: 0, oy: 0 }, place: null, calledPocket,
});

const std = makeConfig('standard');
const casual = makeConfig('casual');
const pro = makeConfig('pro');

function playRack(groups = { A: 'solids', B: 'stripes' }, turn = 'A') {
  return { ...newRack('A'), phase: 'play', open: false, groups, turn, ballInHand: false, kitchenOnly: false };
}

test('break: weak break re-racks under fourRails, passes under none', () => {
  const rack = newRack('A');
  const events = [contact(0, 1), rail(0)]; // cue only touched + one cue rail
  let r = applyShot(std, rack, tableWith(), events, shot());
  assert.ok(r.ruling.reBreak);
  assert.equal(r.rack.phase, 'break');
  r = applyShot(casual, rack, tableWith(), events, shot());
  assert.ok(!r.ruling.reBreak);
  assert.equal(r.rack.phase, 'play');
  assert.equal(r.rack.turn, 'B');
});

test('break: scratch gives opponent kitchen ball-in-hand', () => {
  const rack = newRack('A');
  const events = [contact(0, 1), rail(1), rail(2), rail(3), rail(9), pocket(0, 0)];
  const { rack: next, ruling } = applyShot(std, rack, tableWith([0]), events, shot());
  assert.equal(ruling.foul.reason, 'scratch');
  assert.ok(ruling.kitchenOnly);
  assert.equal(next.turn, 'B');
  assert.ok(next.ballInHand);
  assert.equal(next.phase, 'play');
});

test('break: pot keeps the breaker at an open table', () => {
  const rack = newRack('A');
  const events = [contact(0, 1), rail(1), pocket(3, 2)];
  const { rack: next, ruling } = applyShot(std, rack, tableWith([3]), events, shot());
  assert.ok(!ruling.turnPasses);
  assert.equal(next.turn, 'A');
  assert.ok(next.open);
});

test('break: 8 down means re-rack, never loss', () => {
  const rack = newRack('A');
  const events = [contact(0, 1), rail(1), rail(2), rail(3), rail(9), pocket(8, 1)];
  const { ruling } = applyShot(std, rack, tableWith([8]), events, shot());
  assert.ok(ruling.reBreak);
  assert.ok(!ruling.rackOver);
});

test('open table: first pot assigns groups and continues', () => {
  const rack = { ...newRack('A'), phase: 'play', ballInHand: false, kitchenOnly: false };
  const events = [contact(0, 3), rail(0), pocket(3, 0)];
  const { rack: next, ruling } = applyShot(std, rack, tableWith([3]), events, shot());
  assert.deepEqual(ruling.groupsAssigned, { A: 'solids', B: 'stripes' });
  assert.ok(!ruling.turnPasses);
  assert.ok(!next.open);
});

test('open table: hitting the 8 first is a foul', () => {
  const rack = { ...newRack('A'), phase: 'play', ballInHand: false };
  const events = [contact(0, 8), rail(0)];
  const { ruling } = applyShot(std, rack, tableWith(), events, shot());
  assert.equal(ruling.foul.reason, 'wrongBall');
});

test('closed table: wrong group first is ball-in-hand', () => {
  const rack = playRack();
  const events = [contact(0, 9), rail(9)];
  const { rack: next, ruling } = applyShot(std, rack, tableWith(), events, shot());
  assert.equal(ruling.foul.reason, 'wrongBall');
  assert.ok(next.ballInHand);
  assert.equal(next.turn, 'B');
});

test('closed table: potting your ball continues, opponent ball only passes', () => {
  const rack = playRack();
  let r = applyShot(std, rack, tableWith([2]), [contact(0, 2), pocket(2, 5)], shot());
  assert.ok(!r.ruling.turnPasses);
  // own group struck first, opponent ball drops: legal, stays down, turn passes
  r = applyShot(std, rack, tableWith([9]), [contact(0, 2), rail(2), pocket(9, 5)], shot());
  assert.equal(r.ruling.foul, null);
  assert.ok(r.ruling.turnPasses);
});

test('rail-after-contact foul only when configured', () => {
  const rack = playRack();
  const events = [contact(0, 2)]; // soft nudge, nothing reaches a rail
  let r = applyShot(std, rack, tableWith(), events, shot());
  assert.equal(r.ruling.foul.reason, 'noRail');
  r = applyShot(casual, rack, tableWith(), events, shot());
  assert.equal(r.ruling.foul, null);
});

test('play scratch: ball in hand anywhere', () => {
  const rack = playRack();
  const events = [contact(0, 2), rail(2), pocket(0, 3)];
  const { rack: next, ruling } = applyShot(std, rack, tableWith([0]), events, shot());
  assert.equal(ruling.foul.reason, 'scratch');
  assert.ok(!ruling.kitchenOnly);
  assert.ok(next.ballInHand);
});

test('early 8 loses the rack — even alongside your last ball', () => {
  const rack = playRack();
  // A had one solid (7) left; pots 7 AND the 8 in one shot
  const balls = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 7), pocket(7, 0), pocket(8, 0)];
  const { ruling } = applyShot(std, rack, balls, events, shot(0));
  assert.ok(ruling.rackOver);
  assert.equal(ruling.winner, 'B');
});

test('on the 8: clean called pot wins', () => {
  const rack = playRack();
  const balls = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 8), pocket(8, 4)];
  const { ruling } = applyShot(std, rack, balls, events, shot(4));
  assert.ok(ruling.rackOver);
  assert.equal(ruling.winner, 'A');
});

test('on the 8: callPocket none needs no call', () => {
  const rack = playRack();
  const balls = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 8), pocket(8, 4)];
  const { ruling } = applyShot(casual, rack, balls, events, shot(null));
  assert.equal(ruling.winner, 'A');
});

test('on the 8: wrong pocket loses on standard, respots when loss toggle is off', () => {
  const balls = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 8), rail(8), pocket(8, 2)];
  let r = applyShot(std, playRack(), balls, events, shot(4));
  assert.equal(r.ruling.winner, 'B');
  // call still required, but the harsh-loss toggle is off: the 8 comes back
  const lenient = makeConfig('standard', { scratchOnEightLoss: false });
  r = applyShot(lenient, playRack(), balls, events, shot(4));
  assert.ok(!r.ruling.rackOver);
  assert.ok(r.ruling.respot8);
  assert.ok(r.ruling.ballInHand);
  // casual (no call at all): any pocket wins
  r = applyShot(casual, playRack(), balls, events, shot(null));
  assert.equal(r.ruling.winner, 'A');
});

test('on the 8: scratch while potting loses on standard, respots on casual', () => {
  const balls = tableWith([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 8), pocket(8, 4), pocket(0, 0)];
  let r = applyShot(std, playRack(), balls, events, shot(4));
  assert.equal(r.ruling.winner, 'B');
  r = applyShot(casual, playRack(), balls, events, shot(4));
  assert.ok(r.ruling.respot8);
  assert.equal(r.ruling.foul.reason, 'scratch');
});

test('pro call-all: right pocket continues, wrong pocket stays down and passes', () => {
  const rack = playRack();
  let r = applyShot(pro, rack, tableWith([2]), [contact(0, 2), pocket(2, 5)], shot(5));
  assert.ok(!r.ruling.turnPasses);
  r = applyShot(pro, rack, tableWith([2]), [contact(0, 2), pocket(2, 3)], shot(5));
  assert.equal(r.ruling.foul, null);
  assert.ok(r.ruling.turnPasses);
});

test('timeout is a ball-in-hand foul', () => {
  const rack = playRack();
  const { rack: next, ruling } = timeoutRuling(rack);
  assert.equal(ruling.foul.reason, 'timeout');
  assert.equal(next.turn, 'B');
  assert.ok(next.ballInHand);
});

test('respotEight lands on the foot spot, or slides when blocked', () => {
  let balls = tableWith([8]);
  // clear the rack area first: everything except the 8 back to random spots is
  // overkill — just check the happy path on a mostly-potted table
  balls = balls.map((b) => (b.id !== 8 && b.id !== 0 ? { ...b, state: STATE.POCKETED, x: -1, y: -1 } : b));
  const eight = respotEight(balls);
  assert.equal(eight.state, STATE.STATIONARY);
  assert.ok(Math.abs(eight.x - FOOT_SPOT.x) < 1e-9);

  // blocked foot spot: a stationary ball sits exactly there
  balls = tableWith([8]);
  balls = balls.map((b) => (b.id !== 8 && b.id !== 0 && b.id !== 1 ? { ...b, state: STATE.POCKETED, x: -1, y: -1 } : b));
  const blocker = balls.find((b) => b.id === 1);
  blocker.x = FOOT_SPOT.x;
  blocker.y = FOOT_SPOT.y;
  const e2 = respotEight(balls);
  assert.ok(e2.x > FOOT_SPOT.x, '8 slid off the occupied spot');
});

test('match: bestOf 3 advances racks, loser breaks, first to 2 wins', () => {
  const config = makeConfig('casual', { bestOf: 3 });
  let match = newMatch(config, 'A');
  match.rack = playRack(); // skip to play
  const balls = tableWith([1, 2, 3, 4, 5, 6, 7, 8]);
  const events = [contact(0, 8), pocket(8, 4)];

  let out = applyMatchShot(match, balls, events, shot());
  assert.equal(out.match.score.A, 1);
  assert.equal(out.match.winner, null);
  assert.ok(out.nextBalls, 'new rack dealt');
  assert.equal(out.match.rack.breaker, 'B', 'loser breaks');

  out.match.rack = playRack({ A: 'solids', B: 'stripes' }, 'A');
  out = applyMatchShot(out.match, balls, events, shot());
  assert.equal(out.match.winner, 'A');
  assert.equal(out.nextBalls, null);
});

test('remaining counts only on-table group balls', () => {
  const balls = tableWith([1, 2, 9]);
  assert.equal(remaining(balls, 'solids'), 5);
  assert.equal(remaining(balls, 'stripes'), 6);
});
