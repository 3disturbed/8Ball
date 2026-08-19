# 8Ball 🎱

**Real-physics multiplayer 8-ball pool in the browser — one link brings your opponent to the table.**

Play at **[8ball.darksgames.app](https://8ball.darksgames.app)** *(coming soon — launches with the Darks Games catalog card)*.

Part of [Darks Games](https://darksgames.app): handcrafted browser games, no tracking, no ads.

## What it is

A lobbied multiplayer pool game built around one promise: it *feels* fantastic to hit a ball. A custom deterministic physics engine (real sliding→rolling friction, english, draw, follow, spin-bent rail rebounds) runs identically on your screen, your opponent's screen, and the server — so your shot plays out instantly under your finger, and everyone else watches the exact same shot unfold.

Create a table, send the link, and your friend is racking up in seconds — no account, no install, phone or desktop.

## Features

- **Solo Practice** — open table or three AI difficulties, fully offline-capable client-side play
- **Private Match** — share one link; a friend taps it and takes the seat
- **Public Lobby** — browse open tables or hit Quick Match
- **Host rules** — Casual / Standard / Pro presets plus individual toggles (call-pocket, rail-after-contact, shot clock 15/30s, guideline length, best-of-N)
- **Spectators** — extra people on the link watch live and queue for winner-stays-on
- **Optional Darks Games account** — sign in on both seats for rated games and ELO; guests always welcome
- **Reconnect-safe** — phone lock, tab close, or network blip: your seat waits 60 seconds

## Quick start (development)

```bash
npm install
PORT=4880 npm run dev     # http://localhost:4880
npm run check             # syntax gate + full test suite
```

No build step. Plain ES modules everywhere; the browser loads `public/js/` directly and shares `shared/` (physics, rules, AI) with the server.

## Architecture

- Design document: [docs/SDD.md](docs/SDD.md)
- Build plan & status: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- The one-paragraph version: the shooter's client simulates the shot locally for instant feedback and sends only the **input** (direction vector, power, spin offset) to the server. The server replays it through the *same* deterministic simulation, applies the rules engine to the resulting event log, and broadcasts input + ruling + final state. Opponent and spectators replay the input in real time; a state hash guarantees everyone settled on the identical table.

## Deployment

Runs as a standard Darks Games systemd game (`darksgame@8ball`) behind nginx. `scripts/deploy.sh` is the check-gated deploy loop; first-time registration and runbooks live in the implementation plan.

## Screenshots

*(placeholders — real captures land at launch in `docs/screenshots/`)*
