// dgVerify unit tests with a locally generated RSA key and a fake JWKS fetch:
// good token, wrong audience, wrong issuer, expired, bad signature, garbage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { makeVerifier } from '../server/auth/dgVerify.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };

const fakeFetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });

function makeToken(claims, { kid = 'test-kid', key = privateKey } = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const base = {
  iss: 'https://darksgames.app',
  aud: '8ball',
  sub: 'user-123',
  name: 'Dark',
  exp: now + 600,
};

const verify = makeVerifier({ fetchImpl: fakeFetch });

test('valid token verifies with sub and name', async () => {
  const out = await verify(makeToken(base));
  assert.equal(out.sub, 'user-123');
  assert.equal(out.name, 'Dark');
});

test('audience array containing 8ball verifies', async () => {
  const out = await verify(makeToken({ ...base, aud: ['hub', '8ball'] }));
  assert.equal(out.sub, 'user-123');
});

test('wrong audience rejected', async () => {
  await assert.rejects(verify(makeToken({ ...base, aud: 'minigolf' })), /audience/);
});

test('wrong issuer rejected', async () => {
  await assert.rejects(verify(makeToken({ ...base, iss: 'https://evil.example' })), /issuer/);
});

test('expired token rejected', async () => {
  await assert.rejects(verify(makeToken({ ...base, exp: now - 10 })), /expired/);
});

test('tampered payload rejected', async () => {
  const token = makeToken(base);
  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...base, sub: 'user-999' })).toString('base64url');
  await assert.rejects(verify(`${h}.${forged}.${s}`), /bad signature/);
});

test('unknown kid rejected', async () => {
  await assert.rejects(verify(makeToken(base, { kid: 'other' })), /unknown kid/);
});

test('garbage rejected, guests never call this path', async () => {
  await assert.rejects(verify('not-a-token'), /malformed/);
});
