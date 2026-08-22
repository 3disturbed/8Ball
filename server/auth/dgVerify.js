// Optional Darks Games sign-in (SDD §8): verify RS256 JWTs from the hub
// against its JWKS. Subdomain pattern — no shared secret needed. Zero deps:
// node:crypto does the RSA verify. Guests never hit this path.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const DEFAULTS = {
  jwksUrl: 'https://darksgames.app/api/v1/jwks',
  issuer: 'https://darksgames.app',
  audience: '8ball',
  cacheMs: 5 * 60 * 1000,
};

export function makeVerifier(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const fetchImpl = cfg.fetchImpl || fetch;
  let cache = { keys: new Map(), at: 0 };

  async function keyFor(kid) {
    if (Date.now() - cache.at > cfg.cacheMs || !cache.keys.has(kid)) {
      const res = await fetchImpl(cfg.jwksUrl);
      if (!res.ok) throw new Error('jwks fetch failed');
      const { keys } = await res.json();
      cache = {
        keys: new Map(keys.map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })])),
        at: Date.now(),
      };
    }
    const key = cache.keys.get(kid);
    if (!key) throw new Error('unknown kid');
    return key;
  }

  // -> { sub, name, handle } or throws.
  return async function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('malformed token');
    const [h, p, s] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header.alg !== 'RS256') throw new Error('unexpected alg');
    const key = await keyFor(header.kid);
    const ok = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`, 'utf8'),
      key,
      Buffer.from(s, 'base64url'),
    );
    if (!ok) throw new Error('bad signature');

    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    // Party launch tokens (typ:"dg-party") are signed by the same key with
    // aud=8ball; they are not player identities. Access tokens carry no typ.
    if (claims.typ !== undefined) throw new Error('not an access token');
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === 'number' && claims.exp < now) throw new Error('expired');
    if (typeof claims.nbf === 'number' && claims.nbf > now + 30) throw new Error('not yet valid');
    if (claims.iss !== cfg.issuer) throw new Error('wrong issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(cfg.audience)) throw new Error('wrong audience');
    if (!claims.sub) throw new Error('no subject');

    return {
      sub: String(claims.sub),
      name: String(claims.name || claims.username || claims.display_name || '').slice(0, 18) || null,
      handle: claims.handle ? String(claims.handle).slice(0, 32) : null, // "Darko#4821"
    };
  };
}
