// Online transport (SDD §4): sends only shot inputs, animates everyone else's
// shots through the same shared sim, snaps to the server's finalBalls +
// stateHash as the safety net.

import { io } from '/socket.io/socket.io.esm.min.js';
import { MSG } from '/shared/MessageTypes.js';
import { cloneBalls } from '/shared/physics/Rack.js';
import { remaining } from '/shared/rules/RulesEngine.js';
import { getPlayerId, getName } from './identity.js';

const AIM_HZ = 10;

export class SocketTransport {
  // action: { create: {preset, visibility} } | { invite: token }
  constructor({ hud, action, onLobby, onPhase }) {
    this.hud = hud;
    this.action = action;
    this.onLobby = onLobby || (() => {});
    this.onPhase = onPhase || (() => {});
    this.controller = null;
    this.socket = null;
    this.mySeat = null;
    this.rules = null;
    this.pendingResult = null;
    this.localSettle = null;
    this.snap = null;
    this._aimTimer = 0;
    this._lastAim = '';
    this.onWin = null;
  }

  attach(controller) {
    this.controller = controller;
  }

  begin() {
    this.socket = io();
    const s = this.socket;

    s.on('connect', () => {
      s.emit(MSG.HELLO, {
        playerId: getPlayerId(),
        name: getName(),
        inviteToken: this.action.invite || undefined,
      });
    });

    s.on(MSG.HELLO_OK, () => {
      if (this.action.create) s.emit(MSG.TABLE_CREATE, this.action.create);
    });

    s.on(MSG.TABLE_SNAPSHOT, (snap) => this.applySnapshot(snap));
    s.on(MSG.TABLE_UPDATE, (u) => {
      if (this.snap) {
        Object.assign(this.snap, u);
        this.onLobby(this.snap);
        this.refreshStatus();
      }
    });
    s.on(MSG.SHOT_RESULT, (r) => this.onShotResult(r));
    s.on(MSG.AIM_UPDATE, (a) => this.onAim(a));
    s.on(MSG.CUE_PLACE, (a) => this.onAim({ ...a, power: 0 }));
    s.on(MSG.MATCH_END, (m) => this.onMatchEnd(m));
    s.on(MSG.REMATCH_VOTE, ({ votes }) => {
      if (this.hud) this.hud.setStatus(`Rematch votes: ${votes.length}/2`);
    });
    s.on(MSG.TABLE_ERROR, ({ message }) => {
      this.controller.showBanner(message);
      this.controller.aim.power = 0;
    });
    s.on('disconnect', () => {
      if (this.hud) this.hud.setStatus('Reconnecting…');
    });

    this._aimTimer = setInterval(() => this.streamAim(), 1000 / AIM_HZ);
  }

  applySnapshot(snap) {
    this.snap = snap;
    this.mySeat = snap.you === 'A' || snap.you === 'B' ? snap.you : null;
    this.rules = snap.rules;
    this.controller.guideMode = snap.rules.guideline;
    this.onPhase(snap.phase, snap);

    if (snap.phase === 'LOBBY') {
      this.onLobby(snap);
      return;
    }
    this.onLobby(null); // hide lobby overlay

    if (snap.phase === 'PLAYING' && snap.balls) {
      const rack = snap.match.rack;
      if (snap.activeShot && snap.activeShot.preBalls) {
        // A shot may still be animating for others: replay it from its start.
        this.controller.start(snap.activeShot.preBalls, { isBreak: snap.activeShot.isBreak });
        this.controller.canShoot = false;
        this.controller.playShot(snap.activeShot.input, { isBreak: snap.activeShot.isBreak });
        return; // turn state arrives with the buffered SHOT_RESULT reconcile
      }
      this.controller.start(snap.balls, { isBreak: rack.phase === 'break' });
      this.pushTurn({
        turn: rack.turn,
        ballInHand: rack.ballInHand && rack.phase !== 'break',
        kitchenOnly: rack.kitchenOnly,
        callRequired: false,
        isBreak: rack.phase === 'break',
        deadline: snap.deadline,
      }, snap.match);
    }
    if (snap.phase === 'END' && snap.balls) {
      this.controller.start(snap.balls, { isBreak: false });
      this.controller.setTurn({ canShoot: false });
      this.onMatchEnd({ winner: snap.match?.winner, score: snap.match?.score, reason: 'played' });
    }
  }

  sendShot(input) {
    this.localSettle = null;
    this.pendingResult = null;
    this.socket.emit(MSG.SHOT_TAKE, input);
  }

  onLocalSettle({ input, stateHash }) {
    this.localSettle = { input, stateHash };
    if (this.pendingResult) this.reconcile();
  }

  onShotResult(r) {
    this.pendingResult = r;
    if (r.seat !== this.mySeat) {
      // opponent / spectator view: replay the exact input through the sim
      if (this.controller.phase === 'shooting' || this.controller.phase === 'striking') {
        // already replaying (aim-streamed play started earlier) — settle will reconcile
      } else {
        this.controller.opponentAim = null;
        this.controller.playShot(r.input, { isBreak: r.isBreak });
      }
      return;
    }
    if (this.localSettle) this.reconcile();
  }

  reconcile() {
    const r = this.pendingResult;
    if (!r) return;
    this.pendingResult = null;

    if (r.seat === this.mySeat && this.localSettle && this.localSettle.stateHash !== r.stateHash) {
      console.warn(`state hash mismatch: local ${this.localSettle.stateHash} vs server ${r.stateHash}`);
    }
    this.localSettle = null;

    // Safety net: the server's settled table is the truth (includes respot-8).
    this.controller.balls = cloneBalls(r.finalBalls);

    if (r.rerack) {
      this.controller.start(r.rerack, { isBreak: true });
    }
    if (r.match?.winner) return; // MATCH_END handles the finale
    if (r.next) this.pushTurn(r.next, r.match, r.ruling?.message);
  }

  pushTurn(next, match, message = null) {
    const canShoot = this.mySeat !== null && next.turn === this.mySeat;
    this.controller.callRequired = Boolean(next.callRequired && canShoot);
    this.controller.setTurn({
      canShoot,
      ballInHand: Boolean(next.ballInHand && canShoot),
      kitchenOnly: Boolean(next.kitchenOnly),
      banner: message,
    });
    this.deadline = next.deadline || null;
    this.refreshStatus(match);
  }

  refreshStatus(match = this.snap?.match) {
    if (!this.hud) return;
    if (!match || !match.rack) return;
    const rack = match.rack;
    const score = `${match.score.A}–${match.score.B}`;
    const seatName = (s) => this.snap?.seats?.[s]?.name || s;
    const who = this.mySeat === null ? `${seatName(rack.turn)} to shoot`
      : rack.turn === this.mySeat ? 'your turn' : `${seatName(rack.turn)}'s turn`;
    let groups = 'table open';
    if (!rack.open && this.controller.balls?.length) {
      const a = `${seatName('A')}: ${rack.groups.A} (${remaining(this.controller.balls, rack.groups.A)})`;
      const b = `${seatName('B')}: ${rack.groups.B} (${remaining(this.controller.balls, rack.groups.B)})`;
      groups = `${a} · ${b}`;
    }
    this.hud.setStatus(`${score} · ${groups} · ${who}`);
  }

  onAim(a) {
    if (this.mySeat !== null && a.seat === this.mySeat) return;
    const cue = this.controller.cueBall();
    if (!cue || this.controller.phase === 'shooting' || this.controller.phase === 'striking') return;
    const base = a.x || a.y ? { x: a.x, y: a.y } : { x: cue.x, y: cue.y };
    this.controller.opponentAim = {
      ...base, dx: a.dx, dy: a.dy, power: a.power || 0, strike: 0,
    };
  }

  streamAim() {
    const c = this.controller;
    if (!this.socket || this.mySeat === null || !c.canShoot) return;
    if (c.phase !== 'aim' && c.phase !== 'ballInHand') return;
    const { dx, dy } = c.dir();
    const place = c.phase === 'ballInHand' && c.pendingPlace ? c.pendingPlace : null;
    const key = `${dx},${dy},${c.aim.power.toFixed(2)},${place?.x},${place?.y}`;
    if (key === this._lastAim) return;
    this._lastAim = key;
    this.socket.volatile.emit(MSG.AIM_UPDATE, {
      dx, dy, power: c.aim.power, x: place?.x || 0, y: place?.y || 0,
    });
  }

  vote() {
    this.socket.emit(MSG.REMATCH_VOTE);
  }

  onMatchEnd({ winner, score, reason }) {
    const won = this.mySeat !== null && winner === this.mySeat;
    const text = this.mySeat === null
      ? `${this.snap?.seats?.[winner]?.name || winner} wins!`
      : won ? (reason === 'left' ? 'Opponent left — you win!' : 'You win the match! 🎱')
        : 'Match lost — rematch?';
    this.controller.setTurn({ canShoot: false, banner: text });
    if (won && this.onWin) this.onWin();
    if (this.hud && this.mySeat !== null) {
      this.hud.clearActions();
      this.hud.addAction('Rematch', () => {
        this.vote();
        this.hud.setStatus('Waiting for opponent to accept…');
      });
    }
    if (score && this.hud) this.hud.setStatus(`Final: ${score.A}–${score.B}`);
  }

  destroy() {
    clearInterval(this._aimTimer);
    if (this.socket) {
      this.socket.emit(MSG.TABLE_LEAVE);
      this.socket.disconnect();
    }
  }
}
