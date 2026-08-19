// M0 placeholder: proves the test runner wiring. Real suites land in M1+.
import test from 'node:test';
import assert from 'node:assert/strict';

test('scaffold: test runner works', () => {
  assert.equal(1 + 1, 2);
});
