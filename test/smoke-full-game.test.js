// Full-game socket smoke (SDD §10): two real clients play an entire match to
// a legal winner, shots chosen by the shared AI, plus a spectator who watches
// the stream live. Exercises server sim, rules, turn flow and broadcasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';
import { MSG } from '../shared/MessageTypes.js';
import { chooseShot } from '../shared/ai/SimpleAI.js';
import { xorshift32 } from '../shared/physics/StateHash.js';
import { makeConfig } from '../shared/rules/Presets.js';

const A_ID = 'player-alice-1111';
const B_ID = 'player-bob-2222';
const C_ID = 'player-cara-3333';

function client(port) {
  return connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
}

function waitEvent(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${event}`)), timeout);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });
}

test('full match over sockets: AI-driven to a winner, spectator sees it live', async () => {
  const { httpServer, io } = await createGameServer({ withStore: false });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();

  const a = client(port);
  const b = client(port);
  a.emit(MSG.HELLO, { playerId: A_ID, name: 'Alice' });
  await waitEvent(a, MSG.HELLO_OK);
  a.emit(MSG.TABLE_CREATE, { preset: 'casual' }); // no clock: smoke never stalls
  const lobby = await waitEvent(a, MSG.TABLE_SNAPSHOT);

  const playing = waitEvent(a, MSG.TABLE_SNAPSHOT);
  b.emit(MSG.HELLO, { playerId: B_ID, name: 'Bob', inviteToken: lobby.inviteToken });
  await waitEvent(b, MSG.TABLE_SNAPSHOT);
  const snap = await playing;
  assert.equal(snap.phase, 'PLAYING');

  // spectator joins mid-stream
  const c = client(port);
  c.emit(MSG.HELLO, { playerId: C_ID, name: 'Cara', inviteToken: lobby.inviteToken });
  await waitEvent(c, MSG.TABLE_SNAPSHOT);
  let spectatorSawShots = 0;
  c.on(MSG.SHOT_RESULT, () => { spectatorSawShots += 1; });

  const config = makeConfig('casual');
  const rand = xorshift32(0xfeedbeef);
  const seats = { A: a, B: b };
  let balls = snap.balls;
  let rack = snap.match.rack;
  let winner = null;
  a.on(MSG.MATCH_END, (m) => { winner = m; });

  for (let shots = 0; shots < 200 && !winner; shots += 1) {
    const seat = rack.turn;
    const sock = seats[seat];
    const input = {
      shotId: `fg-${shots}`,
      seq: shots,
      ...chooseShot({ balls, rack, seat, config, difficulty: 'medium', rand }),
    };
    const resultOnA = waitEvent(a, MSG.SHOT_RESULT);
    sock.emit(MSG.SHOT_TAKE, input);
    const r = await resultOnA;
    assert.equal(r.seat, seat, 'server accepted the right seat');
    balls = r.rerack || r.finalBalls;
    rack = r.match.rack;
    if (r.match.winner) {
      // MATCH_END may still be in flight; give it a beat
      await new Promise((res) => setTimeout(res, 200));
      break;
    }
  }

  assert.ok(winner, 'match ended with a winner');
  assert.ok(['A', 'B'].includes(winner.winner));
  assert.ok(spectatorSawShots > 0, `spectator watched live (${spectatorSawShots} shots)`);

  a.disconnect(); b.disconnect(); c.disconnect();
  await new Promise((resolve) => { io.close(resolve); });
});
