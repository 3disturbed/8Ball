// Offline transport over the shared rules engine: 'sandbox' (free table) and
// 'solo' (full 8-ball vs the AI, seat A = human, seat B = AI). The online
// SocketTransport implements this same seam in M3.

import { STATE } from '/shared/Constants.js';
import { newMatch, applyMatchShot } from '/shared/rules/Match.js';
import { respotEight, onEight, remaining, otherSeat } from '/shared/rules/RulesEngine.js';
import { makeConfig } from '/shared/rules/Presets.js';
import { chooseShot } from '/shared/ai/SimpleAI.js';
import { rackBalls } from '/shared/physics/Rack.js';

const AI_SEAT = 'B';

export class LocalTransport {
  constructor({ mode = 'sandbox', difficulty = 'medium', config = null, hud = null } = {}) {
    this.mode = mode;
    this.difficulty = difficulty;
    this.config = config || makeConfig('standard', { guideline: 'full', turnTimer: 0 });
    this.hud = hud;
    this.controller = null;
    this.match = null;
    this._aiTimer = 0;
  }

  attach(controller) {
    this.controller = controller;
  }

  begin() {
    const c = this.controller;
    if (this.mode === 'sandbox') {
      c.start(rackBalls(), { isBreak: true });
      c.guideMode = 'full';
      return;
    }
    this.match = newMatch(this.config, 'A');
    c.guideMode = this.config.guideline;
    c.start(rackBalls(), { isBreak: true });
    this.pushTurn('Your break!');
  }

  sendShot() {
    // Offline: the client animation is the truth; rules run at settle.
  }

  onLocalSettle({ input, events, balls }) {
    if (this.mode === 'sandbox') {
      const cue = balls.find((b) => b.id === 0);
      const scratched = cue.state === STATE.POCKETED;
      this.controller.setTurn({
        canShoot: true,
        ballInHand: scratched,
        banner: scratched ? 'Scratch — place the cue ball' : null,
      });
      return;
    }

    const { match, ruling, nextBalls } = applyMatchShot(this.match, balls, events, input);
    this.match = match;

    if (ruling.respot8) respotEight(this.controller.balls);

    if (match.winner) {
      this.finishMatch(match.winner);
      return;
    }
    if (nextBalls) {
      // re-break or next rack
      this.controller.start(nextBalls, { isBreak: true });
      this.pushTurn(ruling.message);
      return;
    }
    // Scratch: cue back in hand — make sure the ghost flow starts clean
    this.pushTurn(ruling.message);
  }

  pushTurn(banner = null) {
    const c = this.controller;
    const rack = this.match.rack;
    if (rack.turn === AI_SEAT) {
      c.setTurn({ canShoot: false, ballInHand: false, banner });
      this.hudStatus('AI is thinking…');
      this.scheduleAI();
    } else {
      const needsCall = this.config.callPocket === 'all'
        || (this.config.callPocket === 'eight' && onEight(rack, c.balls, 'A'));
      c.callRequired = needsCall && rack.phase !== 'break';
      c.setTurn({
        canShoot: true,
        ballInHand: rack.ballInHand && rack.phase !== 'break',
        kitchenOnly: rack.kitchenOnly,
        banner,
      });
      this.hudStatus(this.statusLine());
    }
  }

  statusLine() {
    const rack = this.match.rack;
    const g = rack.groups.A;
    const score = `${this.match.score.A}–${this.match.score.B}`;
    if (rack.phase === 'break') return `Rack ${this.match.rackNo} · ${score} · your break`;
    if (rack.open) return `Rack ${this.match.rackNo} · ${score} · table open`;
    const mine = remaining(this.controller.balls, g);
    const theirs = remaining(this.controller.balls, rack.groups.B);
    const on8 = mine === 0 ? ' — sink the 8!' : '';
    return `${score} · you: ${g} (${mine}) · AI: ${rack.groups.B} (${theirs})${on8}`;
  }

  hudStatus(text) {
    if (this.hud) this.hud.setStatus(text);
  }

  scheduleAI() {
    const think = 1000 + Math.random() * 1500;
    clearTimeout(this._aiTimer);
    this._aiTimer = setTimeout(() => this.aiShoot(), think);
  }

  aiShoot() {
    const c = this.controller;
    const rack = this.match.rack;
    const input = {
      shotId: crypto.randomUUID(),
      seq: 0,
      ...chooseShot({
        balls: c.balls,
        rack,
        seat: AI_SEAT,
        config: this.config,
        difficulty: this.difficulty,
      }),
    };
    // Visible aim sweep before the AI fires (juice: the bot "aims").
    const target = Math.atan2(input.dir.dy, input.dir.dx);
    const from = c.aim.angle;
    const sweep = 650;
    const t0 = performance.now();
    const cue = input.place ?? c.cueBall();
    const animate = (ts) => {
      const k = Math.min((ts - t0) / sweep, 1);
      const ease = 1 - (1 - k) * (1 - k);
      let d = target - from;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      c.aim.angle = from + d * ease;
      c.opponentAim = {
        x: cue.x, y: cue.y,
        dx: Math.cos(c.aim.angle), dy: Math.sin(c.aim.angle),
        power: input.power / 1000 * ease, strike: 0,
      };
      if (k < 1) requestAnimationFrame(animate);
      else {
        c.opponentAim = null;
        c.playShot(input, { isBreak: rack.phase === 'break' });
      }
    };
    requestAnimationFrame(animate);
  }

  finishMatch(winner) {
    const c = this.controller;
    const won = winner === 'A';
    if (won && this.onWin) this.onWin();
    c.setTurn({ canShoot: false, banner: won ? 'You win the match! 🎱' : 'AI takes it — rematch?' });
    this.hudStatus(won ? 'Victory!' : 'Defeat');
    if (this.hud) {
      this.hud.clearActions();
      this.hud.addAction('Rematch', () => {
        this.hud.clearActions();
        this.match = newMatch(this.config, otherSeat(winner)); // loser breaks
        const breakerIsAI = this.match.rack.turn === AI_SEAT;
        c.start(rackBalls(), { isBreak: true });
        if (breakerIsAI) {
          c.setTurn({ canShoot: false, banner: 'AI breaks' });
          this.scheduleAI();
        } else {
          this.pushTurn('Your break!');
        }
      });
    }
  }

  destroy() {
    clearTimeout(this._aiTimer);
  }
}
