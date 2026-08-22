// End-to-end socket smoke (SDD §10): boot the real server on an ephemeral
// port, connect two socket.io clients, create -> invite-join -> break shot ->
// identical authoritative result on both -> duplicate-shot idempotency ->
// wrong-turn rejection -> reconnect snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { MSG } from '../shared/MessageTypes.js';

const A_ID = 'player-alice-1111';
const B_ID = 'player-bob-2222';

function client(port) {
  return connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
}

// Buffered event inbox so racing snapshots never get lost between awaits.
function inbox(socket, events) {
  const queues = new Map(events.map((e) => [e, []]));
  const waiters = new Map();
  for (const e of events) {
    socket.on(e, (payload) => {
      const w = waiters.get(e);
      if (w && w.length) w.shift()(payload);
      else queues.get(e).push(payload);
    });
  }
  return {
    next(event, timeout = 5000) {
      const q = queues.get(event);
      if (q.length) return Promise.resolve(q.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
        if (!waiters.has(event)) waiters.set(event, []);
        waiters.get(event).push((p) => { clearTimeout(t); resolve(p); });
      });
    },
  };
}

const EVENTS = [
  MSG.HELLO_OK, MSG.TABLE_SNAPSHOT, MSG.SHOT_RESULT, MSG.TABLE_ERROR,
  MSG.TABLE_UPDATE, MSG.MATCH_END,
];

test('two clients: create, link join, identical break, idempotency, reconnect', async () => {
  const { httpServer, io } = await createGameServer({ withStore: false });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();

  const a = client(port);
  const boxA = inbox(a, EVENTS);
  a.emit(MSG.HELLO, { playerId: A_ID, name: 'Alice' });
  await boxA.next(MSG.HELLO_OK);

  a.emit(MSG.TABLE_CREATE, { preset: 'casual' });
  const lobbySnap = await boxA.next(MSG.TABLE_SNAPSHOT);
  assert.equal(lobbySnap.you, 'A');
  assert.equal(lobbySnap.phase, 'LOBBY');
  assert.ok(lobbySnap.inviteToken.length > 20);

  // Social-layer room lookup by invite token (GET /api/rooms/:token)
  const roomRes = await fetch(`http://127.0.0.1:${port}/api/rooms/${lobbySnap.inviteToken}`);
  assert.equal(roomRes.status, 200);
  const room = await roomRes.json();
  assert.deepEqual(
    { code: room.code, players: room.players, max: room.max, phase: room.phase, joinable: room.joinable },
    { code: lobbySnap.inviteToken, players: 1, max: 2, phase: 'LOBBY', joinable: true },
  );
  const missing = await fetch(`http://127.0.0.1:${port}/api/rooms/ZZZZZZ`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_found' });

  // B joins via the invite link token
  const b = client(port);
  const boxB = inbox(b, EVENTS);
  b.emit(MSG.HELLO, { playerId: B_ID, name: 'Bob', inviteToken: lobbySnap.inviteToken });
  const bSnap = await boxB.next(MSG.TABLE_SNAPSHOT);
  assert.equal(bSnap.you, 'B');
  const aPlaying = await boxA.next(MSG.TABLE_SNAPSHOT);
  assert.equal(aPlaying.phase, 'PLAYING');
  assert.equal(aPlaying.match.rack.phase, 'break');
  assert.equal(aPlaying.match.rack.turn, 'A');

  // A breaks; both clients receive the identical authoritative result
  const breakInput = {
    shotId: 'smoke-break-1', seq: 1, dir: { dx: 1, dy: 0 }, power: 950,
    tip: { ox: 0, oy: -18 }, place: null, calledPocket: null,
  };
  a.emit(MSG.SHOT_TAKE, breakInput);
  const [ra, rb] = await Promise.all([boxA.next(MSG.SHOT_RESULT), boxB.next(MSG.SHOT_RESULT)]);
  assert.equal(ra.stateHash, rb.stateHash, 'both clients got the same table');
  assert.equal(ra.seat, 'A');
  assert.ok(ra.next, 'next turn announced');
  assert.deepEqual(ra.input.dir, breakInput.dir);

  // duplicate shot id: cached result, same hash, no double-simulation
  a.emit(MSG.SHOT_TAKE, breakInput);
  const dup = await boxA.next(MSG.SHOT_RESULT);
  assert.equal(dup.stateHash, ra.stateHash);

  // wrong-turn shot is rejected
  const wrong = ra.next.turn === 'A' ? b : a;
  const wrongBox = ra.next.turn === 'A' ? boxB : boxA;
  wrong.emit(MSG.SHOT_TAKE, { ...breakInput, shotId: 'smoke-wrong-1' });
  const err = await wrongBox.next(MSG.TABLE_ERROR);
  assert.match(err.message, /not your turn/i);

  // reconnect: B drops, returns with the same playerId, gets a live snapshot
  b.disconnect();
  const b2 = client(port);
  const boxB2 = inbox(b2, EVENTS);
  b2.emit(MSG.HELLO, { playerId: B_ID, name: 'Bob' });
  const back = await boxB2.next(MSG.TABLE_SNAPSHOT);
  assert.equal(back.you, 'B');
  assert.equal(back.phase, 'PLAYING');
  assert.equal(back.balls.length, 16);
  assert.ok(back.activeShot, 'recent shot included for catch-up');

  a.disconnect();
  b2.disconnect();
  // io.close() tears down engine.io timers too — without it the runner hangs
  await new Promise((resolve) => { io.close(resolve); });
});
