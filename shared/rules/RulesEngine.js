// 8-ball rules as a pure shared module (SDD §3): interprets the sim's ordered
// event log against the rack state. Zero I/O — identical on client and server.
// Seats are 'A'/'B'; mapping seats to people is the table layer's job.

import { STATE, FOOT_SPOT, TABLE_L, BALL_R } from '../Constants.js';

export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];

export function otherSeat(seat) {
  return seat === 'A' ? 'B' : 'A';
}

export function newRack(breaker) {
  return {
    phase: 'break',            // break | play | over
    turn: breaker,
    breaker,
    open: true,
    groups: { A: null, B: null },
    ballInHand: true,          // break starts as cue-in-kitchen
    kitchenOnly: true,
    winner: null,
  };
}

export function groupOf(id) {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null;
}

export function remaining(balls, group) {
  const ids = group === 'solids' ? SOLIDS : STRIPES;
  let n = 0;
  for (const b of balls) {
    if (ids.includes(b.id) && b.state !== STATE.POCKETED) n += 1;
  }
  return n;
}

export function onEight(rack, balls, seat) {
  const g = rack.groups[seat];
  return g !== null && remaining(balls, g) === 0;
}

// What the seat may legally hit first right now (used by UI + AI).
export function legalTargets(rack, balls, seat) {
  if (rack.open) return [...SOLIDS, ...STRIPES];
  const g = rack.groups[seat];
  if (g === null) return [...SOLIDS, ...STRIPES];
  if (remaining(balls, g) === 0) return [8];
  return g === 'solids' ? [...SOLIDS] : [...STRIPES];
}

function analyze(events) {
  const potted = [];
  let firstContact = null;
  let firstContactIdx = -1;
  let contactAfterRail = false;
  const objectRailBalls = new Set();
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.type === 'ball' && firstContact === null && (e.a === 0 || e.b === 0)) {
      firstContact = e.a === 0 ? e.b : e.a;
      firstContactIdx = i;
    }
    if (e.type === 'pocket') potted.push({ ball: e.ball, pocket: e.pocket, idx: i });
    if (e.type === 'rail' && e.ball !== 0) objectRailBalls.add(e.ball);
    if (e.type === 'rail' && firstContactIdx >= 0 && i > firstContactIdx) contactAfterRail = true;
    if (e.type === 'pocket' && firstContactIdx >= 0 && i > firstContactIdx) contactAfterRail = true;
  }
  return {
    potted,
    pottedIds: potted.map((p) => p.ball),
    firstContact,
    railOrPotAfterContact: contactAfterRail,
    objectRailCount: objectRailBalls.size,
    scratch: potted.some((p) => p.ball === 0),
    potted8: potted.find((p) => p.ball === 8) || null,
  };
}

// The heart: settle balls + event log -> ruling + next rack state.
// `input.calledPocket` is the pocket id (0-5) or null.
export function applyShot(config, rack, balls, events, input) {
  const seat = rack.turn;
  const opp = otherSeat(seat);
  const a = analyze(events);
  const ruling = {
    seat,
    foul: null,
    turnPasses: true,
    ballInHand: false,
    kitchenOnly: false,
    respot8: false,
    reBreak: false,
    rackOver: false,
    winner: null,
    groupsAssigned: null,
    potted: a.pottedIds,
    message: '',
  };
  const next = { ...rack, groups: { ...rack.groups } };

  const foul = (reason, message) => {
    ruling.foul = { reason };
    ruling.message = message;
    ruling.turnPasses = true;
    ruling.ballInHand = true;
  };

  if (rack.phase === 'break') {
    // ---- break shot -------------------------------------------------
    if (a.potted8) {
      // 8 off the break: re-rack, same breaker (never a loss)
      ruling.reBreak = true;
      ruling.turnPasses = false;
      ruling.message = '8-ball off the break — re-rack';
      next.phase = 'break';
      next.ballInHand = true;
      next.kitchenOnly = true;
      return { rack: next, ruling };
    }
    const objectPots = a.pottedIds.filter((id) => id !== 0 && id !== 8).length;
    if (config.breakRequirement === 'fourRails' && objectPots === 0 && a.objectRailCount < 4) {
      ruling.reBreak = true;
      ruling.turnPasses = false;
      ruling.message = 'Weak break — re-rack';
      next.phase = 'break';
      next.ballInHand = true;
      next.kitchenOnly = true;
      return { rack: next, ruling };
    }
    next.phase = 'play';
    if (a.scratch || a.firstContact === null) {
      foul(a.scratch ? 'scratch' : 'noContact', 'Foul on the break — ball in hand behind the line');
      ruling.kitchenOnly = true; // classic: break scratch = kitchen placement
      next.turn = opp;
      next.ballInHand = true;
      next.kitchenOnly = true;
      return { rack: next, ruling };
    }
    if (objectPots > 0) {
      ruling.turnPasses = false;
      ruling.message = 'Nice break — shoot again (table open)';
    } else {
      next.turn = opp;
      ruling.message = 'Table open';
    }
    next.ballInHand = false;
    next.kitchenOnly = false;
    return { rack: next, ruling };
  }

  // ---- normal play ---------------------------------------------------
  const own = rack.groups[seat];
  const pottedOwnFirst = a.potted.find((p) => {
    const g = groupOf(p.ball);
    return g !== null && (rack.open ? true : g === own);
  }) || null;

  const wasOn8 = onEight(rack, balls.map((b) => (
    a.pottedIds.includes(b.id) && b.id !== 0
      ? { ...b, state: STATE.STATIONARY } // rewind pots to see the pre-shot table
      : b
  )), seat);

  // Fouls, in precedence order
  if (a.scratch) foul('scratch', 'Scratch — ball in hand');
  else if (a.firstContact === null) foul('noContact', 'No contact — ball in hand');
  else {
    const fcGroup = groupOf(a.firstContact);
    if (a.firstContact === 8 && !wasOn8) foul('wrongBall', 'Hit the 8 first — ball in hand');
    else if (!rack.open && !wasOn8 && fcGroup !== own) foul('wrongBall', 'Wrong group first — ball in hand');
    else if (wasOn8 && a.firstContact !== 8) foul('wrongBall', 'Must hit the 8 first — ball in hand');
    else if (config.railAfterContact && !a.railOrPotAfterContact) {
      foul('noRail', 'No rail after contact — ball in hand');
    }
  }

  // 8-ball outcomes
  if (a.potted8) {
    if (!wasOn8) {
      // early 8 = loss of rack
      next.phase = 'over';
      next.winner = opp;
      ruling.rackOver = true;
      ruling.winner = opp;
      ruling.foul = { reason: 'earlyEight' };
      ruling.message = '8-ball down early — rack lost';
      return { rack: next, ruling };
    }
    const wrongPocket = config.callPocket !== 'none'
      && input.calledPocket !== null && input.calledPocket !== undefined
      ? a.potted8.pocket !== input.calledPocket
      : false;
    const uncalled = config.callPocket !== 'none'
      && (input.calledPocket === null || input.calledPocket === undefined);
    if (a.scratch || wrongPocket || uncalled) {
      if (config.scratchOnEightLoss) {
        next.phase = 'over';
        next.winner = opp;
        ruling.rackOver = true;
        ruling.winner = opp;
        ruling.message = a.scratch ? 'Scratched on the 8 — rack lost'
          : 'The 8 needed a called pocket — rack lost';
        return { rack: next, ruling };
      }
      // casual mercy: re-spot the 8, foul
      ruling.respot8 = true;
      if (!ruling.foul) foul('badEight', 'The 8 comes back — ball in hand');
      ruling.message = 'The 8 comes back — ball in hand';
    } else {
      next.phase = 'over';
      next.winner = seat;
      ruling.rackOver = true;
      ruling.winner = seat;
      ruling.turnPasses = false;
      ruling.message = 'Rack won!';
      return { rack: next, ruling };
    }
  }

  // Group assignment on an open table
  if (rack.open && !ruling.foul && pottedOwnFirst) {
    const g = groupOf(pottedOwnFirst.ball);
    next.open = false;
    next.groups = { [seat]: g, [opp]: g === 'solids' ? 'stripes' : 'solids' };
    ruling.groupsAssigned = next.groups;
  }

  // Continuation
  if (!ruling.foul && !a.potted8) {
    let keeps = pottedOwnFirst !== null;
    if (keeps && config.callPocket === 'all') {
      keeps = input.calledPocket !== null && input.calledPocket !== undefined
        && a.potted.some((p) => {
          const g = groupOf(p.ball);
          const mine = rack.open ? g !== null : g === (next.groups[seat] || own);
          return mine && p.pocket === input.calledPocket;
        });
      if (pottedOwnFirst && !keeps) ruling.message = 'Wrong pocket — it stays down, turn passes';
    }
    ruling.turnPasses = !keeps;
    if (keeps && !ruling.message) ruling.message = 'Keep shooting';
  }

  next.turn = ruling.turnPasses ? opp : seat;
  next.ballInHand = Boolean(ruling.foul);
  next.kitchenOnly = false;
  ruling.kitchenOnly = false;
  return { rack: next, ruling };
}

// Timer expiry / forfeit-by-clock: a synthetic foul ruling.
export function timeoutRuling(rack) {
  const seat = rack.turn;
  const opp = otherSeat(seat);
  const next = { ...rack, groups: { ...rack.groups }, turn: opp, ballInHand: true, kitchenOnly: false };
  if (next.phase === 'break') next.phase = 'play';
  return {
    rack: next,
    ruling: {
      seat,
      foul: { reason: 'timeout' },
      turnPasses: true,
      ballInHand: true,
      kitchenOnly: false,
      respot8: false,
      reBreak: false,
      rackOver: false,
      winner: null,
      groupsAssigned: null,
      potted: [],
      message: 'Shot clock — ball in hand',
    },
  };
}

// Put the 8 back on the foot spot (or the nearest free spot along the long
// string). Mutates the passed balls array — callers own that copy.
export function respotEight(balls) {
  const eight = balls.find((b) => b.id === 8);
  const free = (x, y) => balls.every((b) => {
    if (b.id === 8 || b.state === STATE.POCKETED) return true;
    const dx = b.x - x;
    const dy = b.y - y;
    return dx * dx + dy * dy >= 4 * BALL_R * BALL_R;
  });
  let x = FOOT_SPOT.x;
  while (x < TABLE_L - BALL_R && !free(x, FOOT_SPOT.y)) x += BALL_R;
  if (!free(x, FOOT_SPOT.y)) {
    x = FOOT_SPOT.x;
    while (x > BALL_R && !free(x, FOOT_SPOT.y)) x -= BALL_R;
  }
  eight.x = x;
  eight.y = FOOT_SPOT.y;
  eight.vx = 0; eight.vy = 0; eight.wx = 0; eight.wy = 0; eight.wz = 0;
  eight.state = STATE.STATIONARY;
  return eight;
}
