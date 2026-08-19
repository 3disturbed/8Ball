// The authoritative table layer (SDD §5): table records, seats/spectators,
// invite join, shot resolution through the shared sim + rules, reconnect.
// Transport-agnostic: emits through an injected emitter(room, event, payload)
// so unit tests run without sockets. Rooms: `table:<id>` and `player:<id>`.

import { randomUUID, randomBytes } from 'node:crypto';
import { MSG, DISCONNECT_GRACE_MS, INVITE_LIFETIME_MS, LOBBY_REAP_MS } from '../../shared/MessageTypes.js';
import { DT, TIP_MAX, STATE } from '../../shared/Constants.js';
import { rackBalls } from '../../shared/physics/Rack.js';
import { runShot, isLegalPlacement } from '../../shared/physics/Simulation.js';
import { q } from '../../shared/physics/StateHash.js';
import { newMatch, applyMatchShot, applyMatchTimeout } from '../../shared/rules/Match.js';
import { respotEight, onEight, otherSeat } from '../../shared/rules/RulesEngine.js';
import { makeConfig } from '../../shared/rules/Presets.js';
import { CommandGuard } from '../network/CommandGuard.js';

const STRIKE_MS = 120;
const LAST_SHOT_TTL = 30_000;

export class TableService {
  constructor({ emitter, store = null, now = Date.now }) {
    this.emit = emitter;
    this.store = store;
    this.now = now;
    this.tables = new Map();      // tableId -> table
    this.playerTable = new Map(); // playerId -> tableId
    this.players = new Map();     // playerId -> { name }
  }

  async init() {
    if (!this.store) return;
    for (const rec of await this.store.load()) {
      if (rec.expiresAt <= this.now()) continue;
      this.tables.set(rec.id, this.blankTable(rec));
    }
  }

  blankTable(rec) {
    return {
      ...rec,
      seats: { A: null, B: null },
      spectators: new Map(),
      queue: [],
      match: null,
      balls: null,
      phase: 'LOBBY',
      lastShot: null,
      guard: new CommandGuard(),
      rematch: new Set(),
      emptySince: this.now(),
      deadline: null,
      timerHandle: null,
    };
  }

  persist() {
    if (!this.store) return;
    const records = [...this.tables.values()].map((t) => ({
      id: t.id,
      inviteToken: t.inviteToken,
      visibility: t.visibility,
      rules: t.rules,
      hostName: t.hostName,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    }));
    this.store.persist(records).catch((err) => console.error('persist failed', err));
  }

  room(t) { return `table:${t.id}`; }

  playerRoom(id) { return `player:${id}`; }

  tableOf(playerId) {
    const id = this.playerTable.get(playerId);
    return id ? this.tables.get(id) || null : null;
  }

  seatOf(t, playerId) {
    if (t.seats.A?.playerId === playerId) return 'A';
    if (t.seats.B?.playerId === playerId) return 'B';
    return null;
  }

  setName(playerId, name) {
    const clean = String(name || '').replace(/[^\w \-'!.]/g, '').slice(0, 18).trim() || `Guest-${playerId.slice(0, 4)}`;
    this.players.set(playerId, { name: clean });
    return clean;
  }

  nameOf(playerId) {
    return this.players.get(playerId)?.name || `Guest-${String(playerId).slice(0, 4)}`;
  }

  // ------------------------------------------------------------ lifecycle

  createTable(playerId, { preset = 'standard', overrides = {}, visibility = 'private' } = {}) {
    this.leave(playerId, { silent: true });
    const rules = makeConfig(preset, overrides);
    const t = this.blankTable({
      id: randomUUID().slice(0, 8),
      inviteToken: randomBytes(24).toString('base64url'),
      visibility: visibility === 'public' ? 'public' : 'private',
      rules,
      hostName: this.nameOf(playerId),
      createdAt: this.now(),
      expiresAt: this.now() + INVITE_LIFETIME_MS,
    });
    t.seats.A = this.newSeat(playerId);
    t.emptySince = null;
    this.tables.set(t.id, t);
    this.playerTable.set(playerId, t.id);
    this.persist();
    return t;
  }

  newSeat(playerId) {
    return { playerId, name: this.nameOf(playerId), connected: true, disconnectedAt: null };
  }

  findByInvite(token) {
    for (const t of this.tables.values()) {
      if (t.inviteToken === token && t.expiresAt > this.now()) return t;
    }
    return null;
  }

  // Returns { table, role } or throws a user-facing error message.
  joinByInvite(playerId, inviteToken) {
    const t = this.findByInvite(String(inviteToken || ''));
    if (!t) throw new Error('This invite is invalid or has expired.');
    const existing = this.tableOf(playerId);
    if (existing && existing !== t) this.leave(playerId, { silent: true });

    if (this.seatOf(t, playerId)) {
      return this.rejoin(t, playerId);
    }
    let role = 'spectator';
    for (const s of ['A', 'B']) {
      if (!t.seats[s]) {
        t.seats[s] = this.newSeat(playerId);
        role = s;
        break;
      }
    }
    if (role === 'spectator') t.spectators.set(playerId, { name: this.nameOf(playerId) });
    this.playerTable.set(playerId, t.id);
    t.emptySince = null;

    if (role !== 'spectator' && t.phase === 'LOBBY' && t.seats.A && t.seats.B) {
      this.startMatch(t, 'A');
    } else {
      this.broadcastSnapshots(t);
    }
    return { table: t, role };
  }

  rejoin(t, playerId) {
    const seat = this.seatOf(t, playerId);
    if (seat) {
      t.seats[seat].connected = true;
      t.seats[seat].disconnectedAt = null;
    }
    t.emptySince = null;
    this.broadcastSnapshots(t);
    return { table: t, role: seat || 'spectator' };
  }

  startMatch(t, breaker) {
    t.match = newMatch(t.rules, breaker);
    t.balls = rackBalls();
    t.phase = 'PLAYING';
    t.lastShot = null;
    t.rematch.clear();
    t.deadline = null;
    this.broadcastSnapshots(t);
  }

  leave(playerId, { silent = false } = {}) {
    const t = this.tableOf(playerId);
    if (!t) return;
    this.playerTable.delete(playerId);
    const seat = this.seatOf(t, playerId);
    if (seat) {
      t.seats[seat] = null;
      if (t.phase === 'PLAYING') {
        // walkover: the remaining player wins the match
        t.phase = 'END';
        t.match = { ...t.match, winner: otherSeat(seat) };
        this.emit(this.room(t), MSG.MATCH_END, {
          winner: otherSeat(seat), reason: 'left', score: t.match.score,
        });
      }
    } else {
      t.spectators.delete(playerId);
    }
    if (!t.seats.A && !t.seats.B && t.spectators.size === 0) t.emptySince = this.now();
    if (!silent) this.broadcastSnapshots(t);
  }

  disconnect(playerId) {
    const t = this.tableOf(playerId);
    if (!t) return;
    const seat = this.seatOf(t, playerId);
    if (seat) {
      t.seats[seat].connected = false;
      t.seats[seat].disconnectedAt = this.now();
      this.emit(this.room(t), MSG.TABLE_UPDATE, this.publicSeats(t));
    } else {
      t.spectators.delete(playerId);
      this.emit(this.room(t), MSG.TABLE_UPDATE, this.publicSeats(t));
    }
    if (!this.anyoneConnected(t)) t.emptySince = this.now();
  }

  anyoneConnected(t) {
    return (t.seats.A?.connected || t.seats.B?.connected || t.spectators.size > 0);
  }

  // ------------------------------------------------------------ snapshots

  publicSeats(t) {
    const seat = (s) => (s ? { name: s.name, connected: s.connected } : null);
    return {
      seats: { A: seat(t.seats.A), B: seat(t.seats.B) },
      spectators: t.spectators.size,
    };
  }

  snapshotFor(t, playerId) {
    const seat = this.seatOf(t, playerId);
    const snap = {
      tableId: t.id,
      inviteToken: t.inviteToken,
      visibility: t.visibility,
      rules: t.rules,
      ...this.publicSeats(t),
      you: seat || 'spectator',
      phase: t.phase,
      match: t.match ? {
        score: t.match.score, rackNo: t.match.rackNo, rack: t.match.rack, winner: t.match.winner,
      } : null,
      balls: t.balls,
      deadline: t.deadline,
      serverNow: this.now(),
    };
    if (t.lastShot && this.now() - t.lastShot.at < LAST_SHOT_TTL) {
      snap.activeShot = {
        input: t.lastShot.input,
        seat: t.lastShot.seat,
        preBalls: t.lastShot.preBalls,
        isBreak: t.lastShot.isBreak,
      };
    }
    return snap;
  }

  broadcastSnapshots(t) {
    for (const s of ['A', 'B']) {
      if (t.seats[s]) {
        this.emit(this.playerRoom(t.seats[s].playerId), MSG.TABLE_SNAPSHOT, this.snapshotFor(t, t.seats[s].playerId));
      }
    }
    for (const pid of t.spectators.keys()) {
      this.emit(this.playerRoom(pid), MSG.TABLE_SNAPSHOT, this.snapshotFor(t, pid));
    }
  }

  // ------------------------------------------------------------ shooting

  callRequiredFor(t, seat) {
    if (!t.match || t.match.rack.phase === 'break') return false;
    const c = t.rules.callPocket;
    return c === 'all' || (c === 'eight' && onEight(t.match.rack, t.balls, seat));
  }

  sanitizeInput(raw) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const input = {
      shotId: String(raw.shotId || randomUUID()).slice(0, 64),
      seq: num(raw.seq),
      dir: { dx: q(num(raw.dir?.dx)), dy: q(num(raw.dir?.dy)) },
      power: Math.max(1, Math.min(1000, Math.round(num(raw.power)))),
      tip: {
        ox: Math.max(-TIP_MAX, Math.min(TIP_MAX, Math.round(num(raw.tip?.ox)))),
        oy: Math.max(-TIP_MAX, Math.min(TIP_MAX, Math.round(num(raw.tip?.oy)))),
      },
      place: raw.place ? { x: q(num(raw.place.x)), y: q(num(raw.place.y)) } : null,
      calledPocket: Number.isInteger(raw.calledPocket) && raw.calledPocket >= 0 && raw.calledPocket <= 5
        ? raw.calledPocket : null,
    };
    const mag = Math.hypot(input.dir.dx, input.dir.dy);
    if (Math.abs(mag - 1) > 1e-3 || mag === 0) throw new Error('Bad shot direction.');
    return input;
  }

  handleShot(playerId, rawInput) {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'PLAYING') throw new Error('No active game.');
    const seat = this.seatOf(t, playerId);
    if (!seat) throw new Error('Spectators watch — join a seat to shoot.');

    // Idempotency FIRST: a resend after a dropped ack arrives when the turn
    // has already advanced — it must replay the cached result, not error.
    const cached = t.guard.check(String(rawInput?.shotId || ''));
    if (cached) {
      this.emit(this.playerRoom(playerId), MSG.SHOT_RESULT, cached);
      return;
    }
    if (t.match.rack.turn !== seat) throw new Error('Not your turn.');

    const input = this.sanitizeInput(rawInput);
    const rack = t.match.rack;
    const isBreak = rack.phase === 'break';
    const needsPlace = rack.ballInHand && !isBreak;
    if (needsPlace) {
      if (!input.place) throw new Error('Place the cue ball first.');
      if (!isLegalPlacement(t.balls, input.place.x, input.place.y, rack.kitchenOnly)) {
        throw new Error('Illegal cue ball placement.');
      }
    } else if (!isBreak) {
      input.place = null;
    }
    // Break: cue starts on the head spot; allow optional kitchen placement.
    if (isBreak && input.place
      && !isLegalPlacement(t.balls, input.place.x, input.place.y, true)) {
      input.place = null;
    }

    const preBalls = t.balls;
    const result = runShot(t.balls, input, { isBreak });
    const out = applyMatchShot(t.match, result.balls, result.events, input);
    t.match = out.match;
    t.balls = result.balls;
    if (out.ruling.respot8) respotEight(t.balls);
    if (out.nextBalls) t.balls = out.nextBalls;

    const animMs = Math.round(result.steps * DT * 1000) + STRIKE_MS;
    const nextTurn = this.nextTurnInfo(t, animMs);

    const payload = {
      shotId: input.shotId,
      seat,
      input,
      isBreak,
      ruling: out.ruling,
      finalBalls: result.balls,
      rerack: out.nextBalls,
      stateHash: result.stateHash,
      match: t.match ? {
        score: t.match.score, rackNo: t.match.rackNo, rack: t.match.rack, winner: t.match.winner,
      } : null,
      next: nextTurn,
      serverNow: this.now(),
    };

    t.guard.store(input.shotId, payload);
    t.lastShot = out.nextBalls ? null : {
      input, seat, preBalls, isBreak, at: this.now(),
    };
    t.deadline = nextTurn?.deadline ?? null;

    this.emit(this.room(t), MSG.SHOT_RESULT, payload);

    if (t.match.winner) {
      t.phase = 'END';
      this.emit(this.room(t), MSG.MATCH_END, {
        winner: t.match.winner, reason: 'played', score: t.match.score,
      });
    }
    return payload;
  }

  nextTurnInfo(t, animMs) {
    if (!t.match || t.match.winner) return null;
    const rack = t.match.rack;
    const timer = t.rules.turnTimer;
    return {
      turn: rack.turn,
      ballInHand: rack.ballInHand && rack.phase !== 'break',
      kitchenOnly: rack.kitchenOnly,
      callRequired: this.callRequiredFor(t, rack.turn),
      isBreak: rack.phase === 'break',
      deadline: timer ? this.now() + animMs + timer * 1000 : null,
      animMs,
    };
  }

  relayAim(playerId, payload, event) {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'PLAYING') return;
    const seat = this.seatOf(t, playerId);
    if (!seat || t.match.rack.turn !== seat) return;
    this.emit(this.room(t), event, {
      seat,
      dx: Number(payload?.dx) || 0,
      dy: Number(payload?.dy) || 0,
      power: Math.max(0, Math.min(1, Number(payload?.power) || 0)),
      x: Number(payload?.x) || 0,
      y: Number(payload?.y) || 0,
    });
  }

  rematchVote(playerId) {
    const t = this.tableOf(playerId);
    if (!t || t.phase !== 'END') return;
    const seat = this.seatOf(t, playerId);
    if (!seat) return;
    t.rematch.add(seat);
    this.emit(this.room(t), MSG.REMATCH_VOTE, { votes: [...t.rematch] });
    if (t.rematch.has('A') && t.rematch.has('B')) {
      // loser breaks the rematch
      const loser = t.match?.winner ? otherSeat(t.match.winner) : 'A';
      this.startMatch(t, loser);
    }
  }

  // ------------------------------------------------------------ reaping

  reap() {
    const now = this.now();
    let changed = false;
    for (const [id, t] of this.tables) {
      const dead = (t.emptySince && now - t.emptySince > LOBBY_REAP_MS)
        || t.expiresAt <= now;
      if (dead) {
        for (const s of ['A', 'B']) {
          if (t.seats[s]) this.playerTable.delete(t.seats[s].playerId);
        }
        for (const pid of t.spectators.keys()) this.playerTable.delete(pid);
        this.tables.delete(id);
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}

export { DISCONNECT_GRACE_MS };
