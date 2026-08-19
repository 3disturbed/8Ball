// AI legality + a full headless AI-vs-AI game driven through the real sim and
// rules — the strongest cheap integration test we have before multiplayer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rackBalls } from '../shared/physics/Rack.js';
import { runShot, isLegalPlacement } from '../shared/physics/Simulation.js';
import { newMatch, applyMatchShot } from '../shared/rules/Match.js';
import { respotEight, newRack } from '../shared/rules/RulesEngine.js';
import { makeConfig } from '../shared/rules/Presets.js';
import { chooseShot, DIFFICULTY } from '../shared/ai/SimpleAI.js';
import { xorshift32 } from '../shared/physics/StateHash.js';
import { TIP_MAX, STATE } from '../shared/Constants.js';

function assertValidInput(input, balls, rack) {
  const m = Math.hypot(input.dir.dx, input.dir.dy);
  assert.ok(Math.abs(m - 1) < 1e-3, `unit direction (|d|=${m})`);
  assert.ok(input.power >= 1 && input.power <= 1000, 'power in range');
  assert.ok(Math.abs(input.tip.ox) <= TIP_MAX && Math.abs(input.tip.oy) <= TIP_MAX, 'tip in range');
  if (rack.ballInHand && rack.phase !== 'break' && input.place) {
    assert.ok(isLegalPlacement(balls, input.place.x, input.place.y, false), 'legal placement');
  }
}

test('AI produces legal inputs at every difficulty', () => {
  for (const difficulty of Object.keys(DIFFICULTY)) {
    const rand = xorshift32(1234);
    const balls = rackBalls();
    const rack = newRack('B');
    const config = makeConfig('standard');
    const input = chooseShot({ balls, rack, seat: 'B', config, difficulty, rand });
    assertValidInput(input, balls, rack);
  }
});

test('AI handles ball-in-hand and an 8-only table', () => {
  const rand = xorshift32(99);
  let balls = rackBalls();
  // Leave only the 8 and the cue: B is on the 8 with ball in hand
  balls = balls.map((b) => (b.id !== 0 && b.id !== 8 ? { ...b, state: STATE.POCKETED, x: -1, y: -1 } : b));
  const rack = {
    ...newRack('B'), phase: 'play', open: false,
    groups: { A: 'solids', B: 'stripes' }, turn: 'B', ballInHand: true, kitchenOnly: false,
  };
  const config = makeConfig('standard');
  const input = chooseShot({ balls, rack, seat: 'B', config, difficulty: 'hard', rand });
  assertValidInput(input, balls, rack);
  assert.ok(input.place, 'AI placed the cue ball');
  assert.notEqual(input.calledPocket, null, 'AI called the 8');
});

test('AI vs AI: a full match completes legally within 250 shots', () => {
  const rand = xorshift32(0xabcdef);
  const config = makeConfig('casual'); // no re-break loops, fastest to converge
  let match = newMatch(config, 'A');
  let balls = rackBalls();
  let shots = 0;

  while (!match.winner && shots < 250) {
    const seat = match.rack.turn;
    const isBreak = match.rack.phase === 'break';
    const input = {
      shotId: `ai-${shots}`,
      seq: shots,
      ...chooseShot({
        balls, rack: match.rack, seat, config, difficulty: 'medium', rand,
      }),
    };
    const result = runShot(balls, input, { isBreak });
    balls = result.balls;
    const out = applyMatchShot(match, balls, result.events, input);
    match = out.match;
    if (out.ruling.respot8) respotEight(balls);
    if (out.nextBalls) balls = out.nextBalls;
    shots += 1;
  }

  assert.ok(match.winner, `match completed (took ${shots} shots)`);
});
