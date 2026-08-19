# 8Ball — Software Design Document

Status: living document. Numbers marked *(knob)* are starting values; they live in `shared/Constants.js` and get tuned in the M1 sandbox.

## 1. Vision & scope

A browser 8-ball pool game whose differentiator is **feel**: instant response, believable spin, juicy feedback. Benchmark: Miniclip 8 Ball Pool, minus the coin-grind.

Modes: **Solo Practice** (open table or vs AI), **Private Match** (invite link), **Public Lobby** (browse/quick-match). 2 seats per table; unlimited spectators; winner-stays-on rotation. Guests play freely; optional Darks Games sign-in enables rated play (ELO) when *both* seats are signed in.

Non-goals (v1): jump/massé shots (2D sim), 9-ball/snooker variants, tournaments, in-game currency, native apps.

## 2. Physics — `shared/physics/`

Custom deterministic 2D sim. Meters, y-down. Fixed **120 Hz** timestep (`DT = 1/120`).

### 2.1 Geometry
| Constant | Value |
|---|---|
| Playfield | 2.24 × 1.12 m (9ft, 2:1) |
| `BALL_R` | 0.0286 m |
| Corner pocket capture radius | 0.075 m ≈ 2.6R *(knob — oversized for fun; real ≈ 2.25R)* |
| Side pocket capture radius | 0.065 m *(knob)* |
| Head string (break line) | x = 0.56 |
| Foot spot (rack apex) | (1.68, 0.56) |

Cushions: a polyline of **18 segments** — 6 straight rail spans (4 long-rail halves + 2 short rails) + 12 angled jaw segments at the 6 pocket mouths. Pockets are capture circles centered slightly outside the rail line at each mouth: ball center enters circle → pocketed. Jaw segments make near-misses rattle naturally; no explicit jaw physics.

### 2.2 Ball state
`{ id, x, y, vx, vy, wx, wy, wz, state }`, state ∈ SLIDING | ROLLING | STATIONARY | POCKETED. `wz` = english (vertical-axis spin); `wx, wy` = horizontal spin (follow/draw + roll). Ball ids: 0 cue, 1–7 solids, 8, 9–15 stripes.

### 2.3 Motion model (per step, before movement)
Slip velocity at the cloth contact: `u = (vx − R·wy, vy + R·wx)`.

- **SLIDING** (`|u| ≥ U_ROLL = 0.005`): `v̇ = −μ_slide·g·û` with `μ_slide = 0.20` *(knob)*; coupled `ẇx = −(5·μ_slide·g/2R)·û_y`, `ẇy = +(5·μ_slide·g/2R)·û_x` (slip decays at 7/2·μg — this is what makes draw/follow work). If the step would overshoot, snap to exact roll.
- **ROLLING**: `v̇ = −μ_roll·g·v̂`, `μ_roll = 0.010` *(knob)*; `wx, wy` held consistent with rolling (`wy = vx/R`, `wx = −vy/R`).
- **English decay**: `ẇz = −sign(wz)·(5·μ_spin·g/2R)`, `μ_spin = 0.022` *(knob)*.
- **Rest snap**: `|v| < 0.005` and `|wz| < 0.5` → all components set to exact 0 (required for determinism and settle detection).

### 2.4 Cue strike
Input: unit direction `(dx,dy)`, `power ∈ [0,1000]` (integer), tip offset `(ox,oy)` in hundredths of R, clamped `|o| ≤ 50` (miscue circle).
`v0 = (power/1000)·V_MAX`, `V_MAX = 6.5` m/s (break: 9.0) *(knobs)*. English `wz0 = (5/2R)·v0·(ox/100)·SPIN_EFF`; follow/draw sets `wx0, wy0` from `(oy/100)` about the axis perpendicular to travel. `SPIN_EFF = 0.85` *(knob — >1 goes arcade)*.

### 2.5 Collisions
Within a step, velocities are constant (friction applied up front), so motion is linear → continuous collision detection is exact with quadratics only:

- **Ball–ball**: earliest root of `|p_rel + v_rel·t| = 2R`. Response: equal-mass impulse along the center line with restitution `e_bb = 0.94` *(knob)*; tangential throw impulse `μ_bb = 0.06` *(knob)* opposing relative surface velocity (includes `R·(wz_a + wz_b)`), which yields cut-induced throw and english transfer. `wx, wy` pass through the collision — follow/draw then emerges naturally from the sliding regime.
- **Ball–cushion segment**: linear time-of-impact to the offset line, plus endpoint circles. Response: `v_n' = −e_cush·v_n` (`e_cush = 0.75` *(knob)*); tangential `v_t' = v_t·(1−μ_cush) + wz·R·μ_cush·K_SPIN_RAIL` (`μ_cush = 0.20`, `K_SPIN_RAIL = 0.6` *(knobs)*) — sidespin visibly bends rebounds; `wz *= 0.7` per cushion.
- **Pocket capture**: checked at every sub-advance.

Event loop per step: resolve up to 8 earliest-event sub-steps, deterministic tie-break by (time, type, ball indices). Hard cap 3600 steps (30 s) per shot → force-settle.

### 2.6 Determinism contract
1. Only `+ − × ÷` and `Math.sqrt` inside the sim — IEEE-754 correctly-rounded everywhere. **No transcendentals**: the shot input is a quantized *direction vector*, never an angle.
2. All state quantized to the 1e-7 grid (`Math.round(x·1e7)/1e7`) at every step end.
3. **State hash**: FNV-1a over the float64 bit patterns of all 16 quantized ball states after settle — one 32-bit number compared across client/server per shot.
4. Rack break jitter (±0.0002 m *(knob)*) is seeded from the FNV hash of the shot input itself: varied breaks, exact replays.
5. Golden-hash test suite: 1000 scripted shots must reproduce recorded hashes on any engine.

## 3. Rules engine — `shared/rules/`

Pure shared module, zero I/O: `createRules(config)` interprets the sim's event log against the rack state. Config keys:

| Key | Values | Casual | Standard | Pro |
|---|---|---|---|---|
| `railAfterContact` | bool | false | true | true |
| `callPocket` | none/eight/all | none | eight | all |
| `scratchOnEightLoss` | bool | false | true | true |
| `breakRequirement` | none/fourRails | none | fourRails | fourRails |
| `turnTimer` (s) | 0/30/15 | 0 | 30 | 15 |
| `guideline` | full/short/off | full | short | off |
| `bestOf` | 1/3/5 | 1 | 1 | 1 |

Fixed rules: ball-in-hand anywhere after any foul; potting the 8 early = loss of rack; open table after break (any first contact legal except the 8); groups assigned by first legally potted ball on a non-break shot; missed called pocket → ball stays down, turn passes. Timer expiry = foul.

Host picks a preset then may flip individual toggles.

## 4. Netcode — deterministic input relay

**No mid-shot position streaming, ever.** The shooter's client simulates locally (zero-latency feel) and sends only the input; the server replays it authoritatively through the identical shared sim; opponent and spectators replay it too.

### 4.1 Protocol (`shared/MessageTypes.js`, `namespace:verb`)
Client→server: `hello`, `table:create`, `table:join`, `table:ready`, `table:rules`, `table:leave`, `queue:join/leave`, `shot:take`, `aim:update` (volatile, ≤10 Hz), `cue:place` (volatile), `chat:emote`, `rematch:vote`.
Server→client: `table:snapshot`, `table:update`, `turn:start`, `shot:result`, `turn:timeout`, `match:end`, `server:error`.

`shot:take { shotId (uuid, idempotency key), seq, place?, dir:{dx,dy}, power, tip:{ox,oy}, calledPocket? }` — all quantized ints/1e-7 floats.
`shot:result { shotId, input, events, ruling, finalBalls, stateHash, nextTurn:{playerId, deadline, serverNow} }`.

The server validates seat/phase/ranges, runs the sim synchronously (<10 ms), rules the event log, broadcasts. Shooter compares `stateHash` on local settle — mismatch cross-fades to `finalBalls` over 200 ms and logs an anomaly (should never happen; the hash is the tripwire).

### 4.2 Timing & reconnect
Shot clock is server-authoritative: `deadline` + `serverNow` in every turn message; the client renders from a one-time clock offset. Identity is a persistent `playerId` (localStorage UUID), never the socket id. Reconnect (`hello {playerId, tableToken}`) rebinds the seat and returns a full `table:snapshot` including any in-flight shot input for mid-animation catch-up. 60 s disconnect grace, then the opponent may claim the win or keep waiting. All commands idempotent via `shotId`/seq (CommandGuard).

## 5. Tables & lobby — `server/lobby/`

Table FSM: `LOBBY → RACKING → BREAK → TURN{AIM|BALL_IN_HAND|RESOLVING} → RACK_END → (next rack | MATCH_END) → LOBBY`.

- Everyone at a table joins Socket.IO room `table:<id>`; spectators are room members without seats.
- **Private**: opaque `inviteToken` (`randomBytes(24) base64url`), URL `https://8ball.darksgames.app/?invite=<token>`, 7-day expiry, persisted via atomic tmp+rename JSON in `data/` (systemd allows writes only inside the game dir). Links survive restarts; in-progress racks deliberately do not ("rack void" banner).
- **Public**: `GET /api/tables` (open, non-stale, public tables), `POST /api/quickmatch` (oldest open seat or create). Browser polls every 5 s.
- **Winner-stays-on**: at MATCH_END with queue non-empty: loser to back of queue, next spectator seats, 15 s ready-up. Otherwise mutual rematch (loser breaks).
- Reaping: empty tables after 10 min; hostless public LOBBY tables after 2 min.
- **Solo practice creates no server table.** The client `Controller` talks to a Transport interface; `LocalTransport` runs the same shared sim + rules + AI entirely client-side. `SocketTransport` is the online implementation. One game screen, two transports.

## 6. Client UI & feel — `public/js/`

- **Aim**: drag anywhere on the felt rotates the cue around the cue ball; angular sensitivity scales with drag distance (far = fine control). Desktop: pointer aims, arrows nudge.
- **Power**: dedicated pull-down slider, right edge. Release fires; drag back to zero cancels.
- **Spin**: cue-ball button opens a large face; drag the tip dot inside the miscue circle.
- **Ball-in-hand**: drag the ghost ball; illegal spots tint red and refuse.
- **Guide** (rules-gated): ghost-ball contact circle + object-ball line stub + cue tangent stub (bent by follow/draw sign) + one cushion continuation on `full`. Geometric, not simulated.
- **Balls**: procedural "rolling decal" — each ball carries a 3D orientation vector rotated by the sim's ω; number spot foreshortens with `z`, stripes are ellipse-arc bands; gradient shade + specular + cloth shadow. Balls visibly roll.
- **Cue**: draw-back + strike animation (~120 ms) before the local sim starts.
- **Audio** (WebAudio, procedurally synthesized — no asset files): velocity-scaled clack with ±5% pitch, cushion thud, two-part pocket drop, cue tip strike, break layer. Unlocked on first gesture.
- **Juice**: break screen-shake, pocket flash, potted-ball rail tray, turn banner, sub-5s clock pulse, win confetti. Haptics via `navigator.vibrate` where present.
- Responsive canvas, portrait and landscape; touch-first hit targets.

## 7. HTTP surface

`GET /healthz` → `{ok:true}` · `GET /api/tables` · `POST /api/quickmatch` · `POST /api/tables` (create, returns invite URL) · static `public/` · `express.static('shared')` at `/shared` (the client imports the sim from it). Server binds `127.0.0.1:$PORT` hardcoded; nginx terminates TLS and proxies websockets.

## 8. Accounts, stats, ELO

Optional. Client: Darks Games hub SDK (`https://darksgames.app/sdk/dg-account.v1.js`) sign-in chip. Server: RS256 JWT verify against `https://darksgames.app/api/v1/jwks` (5-min key cache), issuer `https://darksgames.app`, **audience `8ball`** — no s2s secret needed on a subdomain. Guests are untouched.

Stats keyed by JWT `sub` in `data/players.json` (atomic tmp+rename, in-memory Map — zero native deps, server-authoritative so ratings can't be forged via the user-bearer saves API). ELO K=32, updated at MATCH_END only when both seats are signed in; otherwise the game is unrated. Exposed on the end screen and a small profile card.

## 9. Server constraints (production box — hard requirements)

- Runs as `darksgame@8ball` (systemd template): `npm start`, user `darks`, `EnvironmentFile=.env`, `ProtectSystem=strict` — **writes only inside `/srv/darksgames/games/8ball/`** (hence `data/` for all runtime state).
- `public/` is the nginx static root (mandatory name); everything else falls through to Node; websocket upgrade headers are provided by the shared proxy snippet; `proxy_read_timeout 300s` (Socket.IO 25 s ping covers it).
- Bind `127.0.0.1` hardcoded. Read `PORT` from env — never assume a number.
- Memory budget ≤ 150 MB RSS (box is RAM-tight); systemd drop-in caps `MemoryHigh=160M`, `MemoryMax=224M`.
- No build step, no native modules, runtime deps limited to `express` + `socket.io`.

## 10. Test plan

- `test/test-physics-determinism.js` — 1000 scripted shots vs golden hashes; replay-identity; rest-snap convergence.
- `test/test-rules-engine.js` — table-driven: every foul/win/loss/group-assignment case per preset.
- `test/test-table-service.js` — FSM transitions, invite join, seats/spectators/queue, reaping, restart-void.
- `test/test-command-idempotency.js` — duplicate `shotId` replay is a no-op.
- `test/test-ai.js` — AI produces legal shots from random positions at all difficulties.
- `test/smoke/two-client.mjs` — two socket.io-clients: create → invite-join → shot exchange → hash equality.
- `test/smoke/full-game.mjs` — scripted rack to a correct winner incl. timer forfeit path.
