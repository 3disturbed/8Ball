// Practice opponent (SDD §6-AI): heuristic pot selection with difficulty via
// injected aim/power error. Runs client-side in solo; shared so a server bot
// stays possible. Trig is fine here — the CHOSEN shot becomes a normal
// quantized input; the deterministic sim never sees an angle.

import { BALL_R, TABLE_L, TABLE_W, STATE } from '../Constants.js';
import { TABLE } from '../physics/Collisions.js';
import { legalTargets, onEight } from '../rules/RulesEngine.js';
import { isLegalPlacement, runShot } from '../physics/Simulation.js';
import { q } from '../physics/StateHash.js';

export const DIFFICULTY = {
  easy: { aimSigma: 0.05, powerErr: 0.15, dryRun: false },
  medium: { aimSigma: 0.02, powerErr: 0.08, dryRun: false },
  hard: { aimSigma: 0.008, powerErr: 0.03, dryRun: true },
};

function gaussian(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clearPath(balls, from, to, ignore) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const ux = dx / len;
  const uy = dy / len;
  for (const b of balls) {
    if (b.state === STATE.POCKETED || ignore.includes(b.id)) continue;
    const px = b.x - from.x;
    const py = b.y - from.y;
    const proj = px * ux + py * uy;
    if (proj < 0 || proj > len) continue;
    const perp = Math.abs(px * uy - py * ux);
    if (perp < 2 * BALL_R * 0.98) return false;
  }
  return true;
}

function candidateShots(balls, cue, targets) {
  const shots = [];
  for (const b of balls) {
    if (!targets.includes(b.id) || b.state === STATE.POCKETED) continue;
    for (const p of TABLE.pockets) {
      const bpx = p.x - b.x;
      const bpy = p.y - b.y;
      const bpd = Math.hypot(bpx, bpy);
      const gx = b.x - (bpx / bpd) * 2 * BALL_R; // ghost-ball point
      const gy = b.y - (bpy / bpd) * 2 * BALL_R;
      const cgx = gx - cue.x;
      const cgy = gy - cue.y;
      const cgd = Math.hypot(cgx, cgy);
      if (cgd < 1e-4) continue;
      const cut = (cgx * bpx + cgy * bpy) / (cgd * bpd); // cos(cut angle)
      if (cut < 0.17) continue; // cut > ~80°: hopeless
      if (!clearPath(balls, cue, { x: gx, y: gy }, [0, b.id])) continue;
      if (!clearPath(balls, b, p, [0, b.id])) continue;
      const corner = p.id === 1 || p.id === 4 ? -0.12 : 0; // side pockets are tighter
      const score = 1.2 * cut
        - 0.3 * (cgd / TABLE_L)
        - 0.4 * (bpd / TABLE_L)
        + corner;
      shots.push({
        score,
        pocket: p.id,
        dir: { dx: cgx / cgd, dy: cgy / cgd },
        travel: cgd + bpd,
        cut,
      });
    }
  }
  return shots.sort((x, y) => y.score - x.score);
}

function powerFor(shot) {
  const energy = shot.travel * (1 + 1.6 * (1 - shot.cut));
  return Math.max(0.18, Math.min(0.85, 0.16 + energy / 2.6));
}

function safetyShot(balls, cue, targets, rand) {
  // Softest legal contact: roll gently at the nearest legal ball.
  let best = null;
  let bd = Infinity;
  for (const b of balls) {
    if (!targets.includes(b.id) || b.state === STATE.POCKETED) continue;
    const d = Math.hypot(b.x - cue.x, b.y - cue.y);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return null;
  const ang = Math.atan2(best.y - cue.y, best.x - cue.x) + (rand() - 0.5) * 0.02;
  return {
    dir: { dx: Math.cos(ang), dy: Math.sin(ang) },
    power: 0.2 + rand() * 0.06,
    pocket: null,
  };
}

function pickPlacement(balls, targets, rand) {
  let best = null;
  for (let i = 0; i < 40; i += 1) {
    const x = BALL_R + rand() * (TABLE_L - 2 * BALL_R);
    const y = BALL_R + rand() * (TABLE_W - 2 * BALL_R);
    if (!isLegalPlacement(balls, x, y, false)) continue;
    const shots = candidateShots(balls, { x, y }, targets);
    const s = shots.length ? shots[0].score : -1;
    if (!best || s > best.s) best = { x, y, s };
  }
  return best ? { x: q(best.x), y: q(best.y) } : null;
}

// -> a complete shot input for Controller.playShot / server validation.
export function chooseShot({
  balls, rack, seat, config, difficulty = 'medium', rand = Math.random,
}) {
  const diff = DIFFICULTY[difficulty] || DIFFICULTY.medium;
  const targets = legalTargets(rack, balls, seat);
  const isBreak = rack.phase === 'break';

  let place = null;
  let cue = balls.find((b) => b.id === 0);
  if (rack.ballInHand && !isBreak) {
    place = pickPlacement(balls, targets, rand);
    if (place) cue = { x: place.x, y: place.y };
  } else if (isBreak) {
    place = { x: q(0.56), y: q(0.56) };
    cue = place;
  }

  let choice = null;
  if (isBreak) {
    // Full-power straight break at the apex with a touch of draw.
    const apex = balls.find((b) => b.id === 1) || { x: 1.68, y: 0.56 };
    const d = Math.hypot(apex.x - cue.x, apex.y - cue.y) || 1;
    choice = {
      dir: { dx: (apex.x - cue.x) / d, dy: (apex.y - cue.y) / d },
      power: 0.95,
      pocket: null,
    };
  } else {
    const shots = candidateShots(balls, cue, targets);
    for (const s of shots.slice(0, diff.dryRun ? 3 : 1)) {
      const candidate = { dir: s.dir, power: powerFor(s), pocket: s.pocket };
      if (!diff.dryRun) { choice = candidate; break; }
      const probe = buildInput(candidate, place, rand, { aimSigma: 0, powerErr: 0 }, config, rack, balls, seat);
      const out = runShot(balls, probe, { isBreak: false });
      const scratched = out.balls.find((b) => b.id === 0).state === STATE.POCKETED;
      if (!scratched) { choice = candidate; break; }
    }
    if (!choice) choice = shots.length ? { dir: shots[0].dir, power: powerFor(shots[0]), pocket: shots[0].pocket } : null;
    if (!choice) choice = safetyShot(balls, cue, targets, rand);
    if (!choice) {
      choice = { dir: { dx: 1, dy: 0 }, power: 0.3, pocket: null }; // desperation
    }
  }

  return buildInput(choice, place, rand, diff, config, rack, balls, seat);
}

function buildInput(choice, place, rand, diff, config, rack, balls, seat) {
  const err = gaussian(rand) * diff.aimSigma;
  const cos = Math.cos(err);
  const sin = Math.sin(err);
  const dx = choice.dir.dx * cos - choice.dir.dy * sin;
  const dy = choice.dir.dx * sin + choice.dir.dy * cos;
  const power = choice.power * (1 + gaussian(rand) * diff.powerErr);

  let calledPocket = null;
  if (config.callPocket === 'all' && choice.pocket !== null) calledPocket = choice.pocket;
  if (config.callPocket === 'eight' && onEight(rack, balls, seat)) calledPocket = choice.pocket;

  return {
    dir: { dx: q(dx), dy: q(dy) },
    power: Math.max(60, Math.min(1000, Math.round(power * 1000))),
    tip: { ox: 0, oy: rack.phase === 'break' ? -18 : 0 },
    place,
    calledPocket,
  };
}
