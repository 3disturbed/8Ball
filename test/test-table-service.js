// TableService unit tests without sockets: a recorder emitter captures every
// room emit. Covers create/join/spectate, auto-start, shot validation,
// walkover, reconnect and reaping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TableService } from '../server/lobby/TableService.js';
import { MSG, LOBBY_REAP_MS } from '../shared/MessageTypes.js';

function makeService(nowRef = { t: 1_000_000 }) {
  const log = [];
  const service = new TableService({
    emitter: (room, event, payload) => log.push({ room, event, payload }),
    store: null,
    now: () => nowRef.t,
  });
  return { service, log, nowRef };
}

const P1 = 'player-aaaa-1111';
const P2 = 'player-bbbb-2222';
const P3 = 'player-cccc-3333';

const breakShot = (shotId = 'shot-1') => ({
  shotId, seq: 1, dir: { dx: 1, dy: 0 }, power: 950, tip: { ox: 0, oy: -18 }, place: null, calledPocket: null,
});

test('create + invite join auto-starts the match, third joiner spectates', () => {
  const { service, log } = makeService();
  service.setName(P1, 'Alice');
  const t = service.createTable(P1, { preset: 'casual' });
  assert.equal(t.phase, 'LOBBY');
  assert.equal(t.visibility, 'private');

  service.setName(P2, 'Bob');
  const { role } = service.joinByInvite(P2, t.inviteToken);
  assert.equal(role, 'B');
  assert.equal(t.phase, 'PLAYING');
  assert.equal(t.match.rack.phase, 'break');
  assert.equal(t.match.rack.turn, 'A');

  const { role: role3 } = service.joinByInvite(P3, t.inviteToken);
  assert.equal(role3, 'spectator');
  assert.equal(t.spectators.size, 1);

  const snaps = log.filter((e) => e.event === MSG.TABLE_SNAPSHOT);
  assert.ok(snaps.length >= 2, 'snapshots broadcast');
  const forB = service.snapshotFor(t, P2);
  assert.equal(forB.you, 'B');
  assert.ok(forB.inviteToken);
  assert.ok(forB.balls.length === 16);
});

test('bad invite is rejected', () => {
  const { service } = makeService();
  assert.throws(() => service.joinByInvite(P1, 'nope'), /invalid or has expired/);
});

test('shots: turn order, sanitization, spectator rejection', () => {
  const { service } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  service.joinByInvite(P3, t.inviteToken);

  assert.throws(() => service.handleShot(P2, breakShot()), /Not your turn/);
  assert.throws(() => service.handleShot(P3, breakShot()), /Spectators/);
  assert.throws(() => service.handleShot(P1, { ...breakShot(), dir: { dx: 3, dy: 0 } }), /direction/);

  const payload = service.handleShot(P1, breakShot());
  assert.equal(payload.seat, 'A');
  assert.ok(payload.stateHash > 0);
  assert.ok(payload.finalBalls.length === 16);
  assert.ok(payload.next, 'next turn info present');
});

test('duplicate shotId re-emits the cached result, no re-simulation', () => {
  const { service, log } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);

  const first = service.handleShot(P1, breakShot('dup-1'));
  const turnAfter = t.match.rack.turn;
  log.length = 0;
  const again = service.handleShot(P1, breakShot('dup-1'));
  assert.equal(again, undefined, 'cached path returns nothing new');
  const emitted = log.find((e) => e.event === MSG.SHOT_RESULT);
  assert.ok(emitted, 'cached result re-emitted');
  assert.equal(emitted.payload.stateHash, first.stateHash);
  assert.equal(t.match.rack.turn, turnAfter, 'state unchanged');
});

test('ball-in-hand placement is enforced', () => {
  const { service } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  // force a ball-in-hand state for B
  t.match.rack = {
    ...t.match.rack, phase: 'play', turn: 'B', ballInHand: true, kitchenOnly: false,
  };
  assert.throws(() => service.handleShot(P2, { ...breakShot('bih-1'), place: null }), /Place the cue/);
  assert.throws(
    () => service.handleShot(P2, { ...breakShot('bih-2'), place: { x: -5, y: 0.5 } }),
    /Illegal cue ball placement/,
  );
  const ok = service.handleShot(P2, { ...breakShot('bih-3'), place: { x: 0.3, y: 0.3 } });
  assert.equal(ok.seat, 'B');
});

test('leaving mid-game is a walkover; empty tables reap', () => {
  const { service, log, nowRef } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  service.leave(P2);
  assert.equal(t.phase, 'END');
  const end = log.find((e) => e.event === MSG.MATCH_END);
  assert.equal(end.payload.winner, 'A');
  assert.equal(end.payload.reason, 'left');

  service.leave(P1);
  assert.ok(t.emptySince, 'marked empty');
  nowRef.t += LOBBY_REAP_MS + 1;
  service.reap();
  assert.equal(service.tables.size, 0);
  assert.equal(service.tableOf(P1), null);
});

test('disconnect keeps the seat; rejoin restores it with a snapshot', () => {
  const { service } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  service.disconnect(P2);
  assert.equal(t.seats.B.connected, false);
  assert.equal(service.tableOf(P2), t, 'membership survives disconnect');
  const { role } = service.rejoin(t, P2);
  assert.equal(role, 'B');
  assert.equal(t.seats.B.connected, true);
});

test('rematch needs both votes, loser breaks', () => {
  const { service } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  t.phase = 'END';
  t.match = { ...t.match, winner: 'A' };
  service.rematchVote(P1);
  assert.equal(t.phase, 'END');
  service.rematchVote(P2);
  assert.equal(t.phase, 'PLAYING');
  assert.equal(t.match.rack.breaker, 'B', 'loser breaks the rematch');
});
