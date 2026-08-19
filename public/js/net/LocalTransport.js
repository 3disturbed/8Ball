// Offline transport: the client sim IS the outcome. M1 sandbox keeps it
// rule-free (pot anything, scratch respots); M2 layers the rules engine and
// the AI opponent on this same seam.

import { STATE } from '/shared/Constants.js';

export class LocalTransport {
  constructor({ mode = 'sandbox' } = {}) {
    this.mode = mode;
    this.controller = null;
  }

  attach(controller) {
    this.controller = controller;
  }

  sendShot() {
    // Sandbox: nothing to validate; the animation is the truth.
  }

  onLocalSettle({ balls }) {
    const cue = balls.find((b) => b.id === 0);
    const scratched = cue.state === STATE.POCKETED;
    this.controller.setTurn({
      canShoot: true,
      ballInHand: scratched,
      banner: scratched ? 'Scratch — place the cue ball' : null,
    });
  }
}
