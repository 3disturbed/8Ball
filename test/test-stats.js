// PlayerStats: ELO math, records, persistence roundtrip, rated-match wiring
// through TableService.finishMatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PlayerStats } from '../server/stats/PlayerStats.js';
import { TableService } from '../server/lobby/TableService.js';
import { MSG } from '../shared/MessageTypes.js';

test('elo: equal players swing by K/2, favorites gain less', () => {
  const s = new PlayerStats(path.join(mkdtempSync(path.join(tmpdir(), '8b-')), 'p.json'));
  const d1 = s.updateMatch('w', 'l');
  assert.equal(d1.winnerDelta, 16); // 1200 vs 1200 -> +K/2
  assert.equal(d1.loserDelta, -16);

  s.get('strong').elo = 1600;
  s.get('weak').elo = 1200;
  const d2 = s.updateMatch('strong', 'weak');
  assert.ok(d2.winnerDelta < 10, `favorite gains little (${d2.winnerDelta})`);
  const d3 = s.updateMatch('weak2', 'strong2');
  assert.equal(d3.winnerDelta, 16);
});

test('records and self-play guard', () => {
  const s = new PlayerStats(path.join(mkdtempSync(path.join(tmpdir(), '8b-')), 'p.json'));
  s.updateMatch('a', 'b', { winner: 'Ann', loser: 'Ben' });
  assert.equal(s.get('a').wins, 1);
  assert.equal(s.get('b').losses, 1);
  assert.equal(s.get('a').name, 'Ann');
  assert.equal(s.updateMatch('a', 'a'), null, 'same sub never rates');
  assert.equal(s.top(5).length, 2);
  assert.equal(s.top(5)[0].name, 'Ann');
});

test('persistence roundtrip', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), '8b-')), 'p.json');
  const s1 = new PlayerStats(file);
  s1.updateMatch('x', 'y');
  await s1.persist();
  const s2 = new PlayerStats(file);
  await s2.load();
  assert.equal(Math.round(s2.get('x').elo), 1216);
});

test('rated match rates through finishMatch; guests never rate', () => {
  const log = [];
  const stats = new PlayerStats(path.join(mkdtempSync(path.join(tmpdir(), '8b-')), 'p.json'));
  const service = new TableService({
    emitter: (room, event, payload) => log.push({ event, payload }),
    stats,
  });
  const P1 = 'player-aaaa-1111';
  const P2 = 'player-bbbb-2222';
  service.setAccount(P1, { sub: 'sub-1', name: 'Ann' });
  service.setAccount(P2, { sub: 'sub-2', name: 'Ben' });
  const t = service.createTable(P1, { preset: 'casual' });
  service.joinByInvite(P2, t.inviteToken);
  assert.equal(t.rated, true);
  service.finishMatch(t, 'A', 'played');
  const end = log.findLast((e) => e.event === MSG.MATCH_END);
  assert.equal(end.payload.rated, true);
  assert.equal(end.payload.elo.winnerDelta, 16);
  assert.equal(stats.get('sub-1').wins, 1);

  // guest table: no accounts -> unrated
  const log2 = [];
  const service2 = new TableService({ emitter: (r, e, p) => log2.push({ event: e, payload: p }), stats });
  const t2 = service2.createTable(P1, { preset: 'casual' });
  service2.joinByInvite(P2, t2.inviteToken);
  assert.equal(t2.rated, false);
  service2.finishMatch(t2, 'A', 'played');
  const end2 = log2.findLast((e) => e.event === MSG.MATCH_END);
  assert.equal(end2.payload.elo, null);
});
