// Server-authoritative ELO + records (SDD §8): atomic tmp+rename JSON keyed
// by the hub JWT `sub`. Rated only when both seats are signed in — ratings
// can never be forged from a client.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const FILE = path.join(ROOT, 'data', 'players.json');

const START_ELO = 1200;
const K = 32;

export class PlayerStats {
  constructor(file = FILE) {
    this.file = file;
    this.players = new Map();
    this.loaded = false;
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.players = new Map(Object.entries(parsed.players || {}));
    } catch {
      this.players = new Map();
    }
    this.loaded = true;
  }

  // Writes are serialised: updateMatch() persists in the background, so two
  // rated matches ending in the same tick (or a test calling persist() right
  // after) must not race on the shared tmp file.
  persist() {
    const write = async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify({ players: Object.fromEntries(this.players) }, null, 2), 'utf8');
      await rename(tmp, this.file);
    };
    this._persistQueue = (this._persistQueue || Promise.resolve()).catch(() => {}).then(write);
    return this._persistQueue;
  }

  get(sub) {
    let p = this.players.get(sub);
    if (!p) {
      p = { name: '', elo: START_ELO, wins: 0, losses: 0, matches: 0, updatedAt: 0 };
      this.players.set(sub, p);
    }
    return p;
  }

  publicStats(sub) {
    const p = this.players.get(sub);
    return p ? { elo: Math.round(p.elo), wins: p.wins, losses: p.losses, matches: p.matches } : null;
  }

  // -> { winnerDelta, loserDelta } (rounded), persisted asynchronously.
  updateMatch(winnerSub, loserSub, names = {}) {
    if (!winnerSub || !loserSub || winnerSub === loserSub) return null;
    const w = this.get(winnerSub);
    const l = this.get(loserSub);
    const expected = 1 / (1 + 10 ** ((l.elo - w.elo) / 400));
    const delta = K * (1 - expected);
    w.elo += delta;
    l.elo -= delta;
    w.wins += 1;
    l.losses += 1;
    w.matches += 1;
    l.matches += 1;
    w.updatedAt = Date.now();
    l.updatedAt = Date.now();
    if (names.winner) w.name = names.winner;
    if (names.loser) l.name = names.loser;
    this.persist().catch((err) => console.error('stats persist failed', err));
    return { winnerDelta: Math.round(delta), loserDelta: -Math.round(delta) };
  }

  top(n = 20) {
    return [...this.players.entries()]
      .filter(([, p]) => p.matches > 0)
      .sort((a, b) => b[1].elo - a[1].elo)
      .slice(0, n)
      .map(([, p]) => ({ name: p.name || 'Anonymous', elo: Math.round(p.elo), wins: p.wins, losses: p.losses }));
  }
}
