// CommandGuard: replayed shot ids return the cached payload; the cache stays
// bounded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandGuard } from '../server/network/CommandGuard.js';

test('guard caches and replays by id', () => {
  const g = new CommandGuard();
  assert.equal(g.check('a'), undefined);
  g.store('a', { n: 1 });
  assert.deepEqual(g.check('a'), { n: 1 });
});

test('guard evicts oldest beyond the cap', () => {
  const g = new CommandGuard();
  for (let i = 0; i < 40; i += 1) g.store(`id-${i}`, i);
  assert.equal(g.check('id-0'), undefined, 'oldest evicted');
  assert.equal(g.check('id-39'), 39, 'newest kept');
});
