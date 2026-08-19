# 8Ball — Implementation Plan

Executed by Claude Code on the DarksGames production box. Authoring repo: `/root/8Ball`. Deploy target: `/srv/darksgames/games/8ball`. Design: [SDD.md](SDD.md).

## Status

| Milestone | Scope | Done |
|---|---|---|
| M0 | Scaffold, SDD, README, first push | [x] |
| M1 | Deterministic physics + playable sandbox | [x] (human feel-check owed at M6) |
| M2 | Rules engine, AI, complete solo game | [x] |
| M3 | Private multiplayer with invite links | [x] |
| M4 | Public lobby, spectators, timer, rematch | [x] |
| M5 | dg-accounts sign-in, ELO stats, polish | [x] (live-domain sign-in verified at M6) |
| M6 | Deploy to 8ball.darksgames.app | [x] :3025, cert to 2026-11-17, live wss smoke PASS (human 2-device playtest owed) |
| M7 | Game Card on darksgames.app, launch | [ ] |

## Ground rules

1. **This server IS production.** Other games are live on it. No experiments outside `/root/8Ball` and (from M6) `/srv/darksgames/games/8ball`.
2. Every milestone ends: `npm run check` green → commit `M<N>: <summary>` → `git push`. Main only, no branches. Never leave main red.
3. Dev port **4880** (`PORT=4880 npm run dev`); verify free with `ss -ltnH 'sport = :4880'`. Kill dev processes when done — RAM is tight (~94% used; check `free -m`).
4. `.env` is never committed, never rsynced, and stays `600 darks:darks` in production. Runtime state lives only in `data/` (systemd sandbox).
5. **Deploy gates** (M6): DNS must resolve correctly FIRST — `dig +short A 8ball.darksgames.app` = box IP AND `dig +short AAAA` empty or ending `::1` (the wildcard AAAA is broken today; `.app` is HSTS-preloaded so on-box curl cannot see the failure). Never hardcode the port — read it from `.env` after `add-game`.
6. Site catalog changes (M7) follow the drift-safe runbook: WIP-commit, two-way diff repo↔live, reconcile, **re-read live `sw.js`/`index.html` immediately before bumping** `?v=` + `VERSION` in lockstep (parallel jobs bump versions).

## M0 — Scaffold, docs, first push
Repo structure per SDD §7/§9 as stubs; README; SDD; this plan; zero-dep check script.
**Accept:** `npm run check` green · `PORT=4880 npm start` then `curl -fsS http://127.0.0.1:4880/healthz` → `{"ok":true}` · `git push -u origin main` succeeds.

## M1 — Physics sandbox
**Session prompt:** *Implement `shared/Constants.js` + `shared/physics/{Simulation,Collisions,Rack,StateHash}.js` per SDD §2, the canvas renderer with rolling-decal balls (SDD §6), aim/power/spin input, and a LocalTransport-driven sandbox screen (no rules): break a rack, hit balls, tune feel. Add `test/test-physics-determinism.js` with golden hashes.*
**Accept:** determinism suite green incl. 1000-shot golden hashes · human feel check: break looks lively, draw/follow/english visibly work, near-miss pockets rattle · commit+push.

## M2 — Solo game
**Session prompt:** *Implement `shared/rules/{RulesEngine,Presets}.js` per SDD §3 with table-driven tests, the rack/break/turn FSM in `public/js/game/Controller.js`, trajectory guide, HUD, `shared/ai/SimpleAI.js` (3 difficulties), procedural WebAudio sounds pass 1.*
**Accept:** rules tests cover every foul/win/loss case per preset · full offline game vs AI to a win in a browser · AI test green · commit+push.

## M3 — Private multiplayer
**Session prompt:** *Implement `server/index.js` (Express+Socket.IO, 127.0.0.1:$PORT, /shared static), `server/lobby/{TableService,InviteStore}.js`, `server/network/{messageRouter,CommandGuard,handlers/*}.js`, client `SocketTransport`, `?invite=` deep link flow, reconnect snapshot + 60 s grace, 10 Hz volatile aim streaming. SDD §4–5.*
**Accept:** `test/smoke/two-client.mjs` green (shot exchange, equal hashes) · two browser tabs complete a shot via invite link · mid-game tab refresh reclaims the seat · commit+push.

## M4 — Social layer
**Session prompt:** *Implement `GET /api/tables` + `POST /api/quickmatch` + lobby browser UI, spectator flow, winner-stays-on queue, rematch votes, server-deadline shot clock, host rules configuration UI.*
**Accept:** `test/smoke/full-game.mjs` reaches a correct winner · third client spectates live and rotates in · timer expiry forfeits correctly · commit+push.

## M5 — Identity, stats, polish
**Session prompt:** *Implement `server/auth/dgVerify.js` (JWKS RS256, aud `8ball`), hub SDK sign-in chip (guests untouched), `server/stats/PlayerStats.js` (atomic JSON, ELO K=32, rated only when both seats signed in), full juice pass (SDD §6), mobile touch tuning, audio pass 2.*
**Accept:** auth unit tests (good/bad aud, expired, guest) · ELO math tests · juice visible in browser · end-to-end sign-in remains an open box until M6 (needs apps row): [ ]
**Accept (deferred from M6):** [ ] sign-in works on the live domain.

## M6 — Deploy  ⚠️ USER GATE: DNS fix at provider first
Runbook (as root): check `free -m` (>120 MB) → DNS gates (rule 5) → rsync to `/srv/darksgames/games/8ball` (exclude `node_modules .env db/ data/ .git *.db*`) → `chown -R darks:darks` → `sudo -u darks npm ci --omit=dev` → `add-game 8ball.darksgames.app 8ball` → read PORT from `.env` → add staging `X-Robots-Tag: noindex` to vhost → `sudo -u darks node scripts/seed-apps.js` in dg-accounts (capture printed secret once) → systemd drop-in `MemoryHigh=160M MemoryMax=224M`.
**Accept:** `systemctl is-active darksgame@8ball` · `ss` shows 127.0.0.1 bind only · clean journal · `curl -fsS https://8ball.darksgames.app/healthz` · cert listed by `certbot certificates` · **human test: full game between two devices over the internet (one cellular), third spectates, reconnect works** · `free -m` >100 MB after.

## M7 — Game Card + launch
Drift-safe site runbook in `/root/DarksGamesSite`: WIP-commit dirty tree → fetch → two-way diff `site/` vs `/srv/darksgames/site/`, reconcile live→repo (explicit decision on any untracked in-flight files) → append 8ball entry to `site/games.js` (glyph 🎱, status `live`) → re-read live versions → lockstep bump every `?v=` + `sw.js VERSION` → commit, rsync `site/`, verify `curl https://darksgames.app/sw.js`, push → remove noindex header from 8ball vhost.
**Accept:** card renders and opens the game · noindex gone · `git tag v1.0.0` pushed · watch journal + `free -m` for a day.

## Sizing
S = one focused session · M = one long session · M0 S · M1 M · M2 M · M3 M · M4 M · M5 M · M6 S · M7 S.
