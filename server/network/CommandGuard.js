// Idempotent command handling (earthborn pattern): a resent shot — retry
// after a dropped ack, or a reconnect replay — re-emits the cached result
// instead of re-simulating.

const CAP = 32;

export class CommandGuard {
  constructor() {
    this.results = new Map(); // shotId -> cached payload
  }

  check(id) {
    return this.results.get(id);
  }

  store(id, payload) {
    this.results.set(id, payload);
    if (this.results.size > CAP) {
      const oldest = this.results.keys().next().value;
      this.results.delete(oldest);
    }
  }
}
