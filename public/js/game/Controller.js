// The client game loop over the Transport seam (SDD §5): one Controller for
// every mode — sandbox, solo vs AI, online — differing only in transport.

import { DT, STATE, TIP_MAX } from '/shared/Constants.js';
import {
  beginShot, step, settled, finalizeShot, isLegalPlacement,
} from '/shared/physics/Simulation.js';
import { q } from '/shared/physics/StateHash.js';
import { cloneBalls } from '/shared/physics/Rack.js';
import { computeGuide } from '../render/GuideRenderer.js';

const STRIKE_MS = 120;

export class Controller {
  constructor({ renderer, transport, hud }) {
    this.renderer = renderer;
    this.transport = transport;
    this.hud = hud;
    this.balls = [];
    this.phase = 'idle';           // idle | aim | ballInHand | striking | shooting | watching
    this.isBreak = true;
    this.canShoot = true;          // false while watching an opponent (M3)
    this.aim = { angle: Math.PI, power: 0, tip: { ox: 0, oy: 0 } };
    this.pendingPlace = null;      // {x, y, legal}
    this.placeKitchenOnly = false;
    this.guideMode = 'full';
    this.effects = { pocketFlashes: [] };
    this.banner = null;
    this.onEvent = null;           // sim event hook (sounds/haptics, M2+)
    this.onSettled = null;         // shot finished hook
    this.seq = 0;
    this._acc = 0;
    this._last = 0;
    this._strikeT = 0;
    this._pendingInput = null;
    this._eventCursor = 0;
    this._events = [];
    this._raf = 0;
    this._running = false;
    transport.attach(this);
  }

  start(balls, { isBreak = true } = {}) {
    this.balls = cloneBalls(balls);
    this.isBreak = isBreak;
    this.phase = 'aim';
    this._running = true;
    this._last = performance.now();
    cancelAnimationFrame(this._raf);
    const loop = (ts) => {
      if (!this._running) return;
      this.tick(ts);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  // ---------------------------------------------------------------- input

  dir() {
    return { dx: q(Math.cos(this.aim.angle)), dy: q(Math.sin(this.aim.angle)) };
  }

  cueBall() {
    return this.balls.find((b) => b.id === 0);
  }

  setPlace(x, y) {
    const legal = isLegalPlacement(this.balls, x, y, this.placeKitchenOnly);
    this.pendingPlace = { x: q(x), y: q(y), legal };
  }

  canAim() {
    return this.canShoot
      && (this.phase === 'aim' || (this.phase === 'ballInHand' && this.pendingPlace?.legal));
  }

  takeShot() {
    if (!this.canAim() || this.aim.power <= 0.03) { this.aim.power = 0; return; }
    const place = this.phase === 'ballInHand' ? { x: this.pendingPlace.x, y: this.pendingPlace.y } : null;
    const input = {
      shotId: crypto.randomUUID(),
      seq: this.seq += 1,
      dir: this.dir(),
      power: Math.max(1, Math.min(1000, Math.round(this.aim.power * 1000))),
      tip: {
        ox: Math.max(-TIP_MAX, Math.min(TIP_MAX, Math.round(this.aim.tip.ox))),
        oy: Math.max(-TIP_MAX, Math.min(TIP_MAX, Math.round(this.aim.tip.oy))),
      },
      place,
      calledPocket: null,
    };
    this._pendingInput = input;
    this.phase = 'striking';
    this._strikeT = 0;
    this.transport.sendShot(input, { isBreak: this.isBreak });
  }

  // Animate a shot decided elsewhere (opponent / AI / reconnect catch-up).
  playShot(input, { isBreak = false } = {}) {
    this._pendingInput = input;
    this.isBreak = isBreak;
    this.phase = 'striking';
    this._strikeT = 0;
    this.canShoot = false;
  }

  // ---------------------------------------------------------------- loop

  tick(ts) {
    const dtFrame = Math.min((ts - this._last) / 1000, 0.05);
    this._last = ts;

    if (this.phase === 'striking') {
      this._strikeT += dtFrame * 1000;
      if (this._strikeT >= STRIKE_MS) {
        beginShot(this.balls, this._pendingInput, { isBreak: this.isBreak });
        this._events = [];
        this._eventCursor = 0;
        this.phase = 'shooting';
        this._acc = 0;
      }
    } else if (this.phase === 'shooting') {
      this._acc += dtFrame;
      while (this._acc >= DT && !settled(this.balls)) {
        step(this.balls, this._events);
        this._acc -= DT;
      }
      this.drainEvents();
      if (settled(this.balls)) this.finishShot();
    }

    this.updateEffects(dtFrame);
    this.renderer.draw(this.viewState(), dtFrame);
  }

  drainEvents() {
    while (this._eventCursor < this._events.length) {
      const e = this._events[this._eventCursor];
      this._eventCursor += 1;
      if (e.type === 'pocket') this.effects.pocketFlashes.push({ pocket: e.pocket, t: 0 });
      if (this.onEvent) this.onEvent(e, this.balls);
    }
  }

  finishShot() {
    const stateHash = finalizeShot(this.balls);
    const input = this._pendingInput;
    this._pendingInput = null;
    this.aim.power = 0;
    this.aim.tip = { ox: 0, oy: 0 };
    this.pendingPlace = null;
    this.isBreak = false;
    this.phase = 'idle';
    this.transport.onLocalSettle({
      input, stateHash, events: this._events, balls: this.balls,
    });
    if (this.onSettled) this.onSettled();
  }

  // Transport pushes the next turn state here.
  setTurn({ canShoot, ballInHand, kitchenOnly = false, banner = null }) {
    this.canShoot = canShoot;
    this.placeKitchenOnly = kitchenOnly;
    if (banner) this.showBanner(banner);
    if (ballInHand && canShoot) {
      this.phase = 'ballInHand';
      this.pendingPlace = null;
    } else {
      this.phase = canShoot ? 'aim' : 'watching';
    }
  }

  showBanner(text) {
    this.banner = { text, alpha: 0, life: 0 };
  }

  updateEffects(dt) {
    const fl = this.effects.pocketFlashes;
    for (const f of fl) f.t += dt * 2.2;
    this.effects.pocketFlashes = fl.filter((f) => f.t < 1);
    if (this.banner) {
      this.banner.life += dt;
      this.banner.alpha = this.banner.life < 0.25 ? this.banner.life / 0.25
        : this.banner.life > 1.6 ? Math.max(0, 1 - (this.banner.life - 1.6) / 0.4) : 1;
      if (this.banner.life > 2) this.banner = null;
    }
  }

  viewState() {
    const cue = this.cueBall();
    const state = { balls: this.balls, effects: this.effects, banner: this.banner };

    const aimPhase = this.phase === 'aim'
      || (this.phase === 'ballInHand' && this.pendingPlace?.legal);
    if (aimPhase && this.canShoot && cue) {
      const from = this.phase === 'ballInHand'
        ? { x: this.pendingPlace.x, y: this.pendingPlace.y }
        : { x: cue.x, y: cue.y };
      const { dx, dy } = this.dir();
      state.guide = computeGuide(this.balls, from, dx, dy, this.guideMode, this.aim.tip.oy);
      state.cue = { ...from, dx, dy, power: this.aim.power, strike: 0 };
    }
    if (this.phase === 'striking' && cue) {
      const { dx, dy } = this.dir();
      const from = this._pendingInput?.place ?? { x: cue.x, y: cue.y };
      state.cue = {
        ...from, dx, dy, power: this.aim.power, strike: this._strikeT / STRIKE_MS,
      };
    }
    if (this.phase === 'ballInHand' && this.pendingPlace) {
      state.ghost = { ...this.pendingPlace };
    }
    return state;
  }
}
