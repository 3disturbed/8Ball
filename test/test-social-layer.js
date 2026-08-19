// M4 coverage: winner-stays-on rotation, shot clock forfeits, claim-win after
// disconnect grace, public table listing and quick match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TableService } from '../server/lobby/TableService.js';
import { MSG, DISCONNECT_GRACE_MS } from '../shared/MessageTypes.js';

const P1 = 'player-aaaa-1111';
const P2 = 'player-bbbb-2222';
const P3 = 'player-cccc-3333';

function makeService(nowRef = { t: 1_000_000 }) {
  const log = [];
  const service = new TableService({
    emitter: (room, event, payload) => log.push({ room, event, payload }),
    store: null,
    now: () => nowRef.t,
  });
  return { service, log, nowRef };
}

test('winner-stays-on: loser rotates out, queued spectator takes the seat', () => {
  const { service, log } = makeService();
  service.setName(P3, 'Cara');
  const t = service.createTable(P1, { preset: 'casual', visibility: 'public' });
  service.joinByInvite(P2, t.inviteToken);
  service.joinByInvite(P3, t.inviteToken);
  service.queueJoin(P3);
  assert.deepEqual(t.queue, [P3]);

  service.finishMatch(t, 'A', 'played');
  const end = log.findLast((e) => e.event === MSG.MATCH_END);
  assert.equal(end.payload.winner, 'A');
  assert.equal(end.payload.rotation.incoming, 'Cara');
  assert.equal(t.seats.B.playerId, P3, 'challenger seated');
  assert.ok(t.spectators.has(P2), 'loser now spectates');
  assert.deepEqual(t.queue, [P2], 'loser queued for another go');

  // the rotation timer would fire startMatch; simulate it directly
  service.startMatch(t, 'B');
  assert.equal(t.phase, 'PLAYING');
  assert.equal(t.match.rack.breaker, 'B', 'incoming challenger breaks');
});

test('shot clock: expiry passes the turn with ball in hand', () => {
  const { service, log, nowRef } = makeService();
  const t = service.createTable(P1, { preset: 'standard' }); // 30s clock
  service.joinByInvite(P2, t.inviteToken);
  assert.ok(t.deadline, 'deadline set at match start');

  const turnBefore = t.match.rack.turn;
  nowRef.t = t.deadline + 1;
  service.fireTimeout(t.id);
  const to = log.findLast((e) => e.event === MSG.TURN_TIMEOUT);
  assert.ok(to, 'timeout broadcast');
  assert.equal(to.payload.ruling.foul.reason, 'timeout');
  assert.notEqual(t.match.rack.turn, turnBefore, 'turn passed');
  assert.ok(t.match.rack.ballInHand);
  assert.ok(t.deadline > nowRef.t, 'next deadline scheduled');
});

test('shot clock: stale timer fires harmlessly', () => {
  const { service, nowRef } = makeService();
  const t = service.createTable(P1, { preset: 'standard' });
  service.joinByInvite(P2, t.inviteToken);
  const turnBefore = t.match.rack.turn;
  nowRef.t = t.deadline - 5000; // not yet expired
  service.fireTimeout(t.id);
  assert.equal(t.match.rack.turn, turnBefore, 'nothing happened');
});

test('claim win: blocked inside grace, walkover after it', () => {
  const { service, nowRef, log } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  service.disconnect(P2);

  assert.throws(() => service.claimWin(P1), /time to reconnect/);
  nowRef.t += DISCONNECT_GRACE_MS + 1;
  service.claimWin(P1);
  assert.equal(t.phase, 'END');
  const end = log.findLast((e) => e.event === MSG.MATCH_END);
  assert.equal(end.payload.winner, 'A');
  assert.equal(end.payload.reason, 'claimed');
});

test('public listing and quickmatch ignore private tables', () => {
  const { service } = makeService();
  service.createTable(P1, { preset: 'casual', visibility: 'private' });
  assert.equal(service.publicTables().length, 0);
  assert.deepEqual(service.quickmatch(), { create: true });

  const pub = service.createTable(P2, { preset: 'standard', visibility: 'public' });
  const list = service.publicTables();
  assert.equal(list.length, 1);
  assert.equal(list[0].seatsFilled, 1);
  assert.equal(list[0].preset, 'standard');
  assert.deepEqual(service.quickmatch(), { inviteToken: pub.inviteToken });

  service.joinByInvite(P3, pub.inviteToken); // both seats now filled
  assert.deepEqual(service.quickmatch(), { create: true }, 'full tables are not quickmatch targets');
});

test('queue join requires spectating at the table', () => {
  const { service } = makeService();
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  service.queueJoin(P1); // seated player: no-op
  assert.deepEqual(t.queue, []);
});
