// Match wrapper over rack-level rules: best-of-N racks, loser breaks next.
// Shared by LocalTransport (solo) and the server TableService.

import { newRack, applyShot, timeoutRuling, otherSeat } from './RulesEngine.js';
import { rackBalls } from '../physics/Rack.js';

export function newMatch(config, firstBreaker = 'A') {
  return {
    config,
    score: { A: 0, B: 0 },
    rackNo: 1,
    rack: newRack(firstBreaker),
    winner: null,
  };
}

export function racksToWin(config) {
  return Math.floor(config.bestOf / 2) + 1;
}

// Applies a settled shot to the match. Returns { match, ruling, nextBalls }.
// nextBalls is non-null when the table must be re-racked (re-break, new rack).
export function applyMatchShot(match, balls, events, input) {
  const { rack, ruling } = applyShot(match.config, match.rack, balls, events, input);
  const next = { ...match, score: { ...match.score }, rack };
  let nextBalls = null;

  if (ruling.reBreak) {
    next.rack = newRack(rack.breaker);
    nextBalls = rackBalls();
  } else if (ruling.rackOver) {
    next.score[ruling.winner] += 1;
    if (next.score[ruling.winner] >= racksToWin(match.config)) {
      next.winner = ruling.winner;
    } else {
      next.rackNo += 1;
      next.rack = newRack(otherSeat(ruling.winner)); // loser breaks
      nextBalls = rackBalls();
    }
  }
  return { match: next, ruling, nextBalls };
}

export function applyMatchTimeout(match) {
  const { rack, ruling } = timeoutRuling(match.rack);
  return { match: { ...match, rack }, ruling };
}
