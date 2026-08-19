// Procedural "rolling decal" balls (SDD §6): each ball carries a 3D
// orientation vector for its decal axis, rotated every frame by the sim's ω.
// Render-only — trig here never touches the deterministic sim.

import { BALL_R, BALL_COLORS } from '/shared/Constants.js';

const ori = new Map(); // ball id -> {x,y,z} decal axis

function axisFor(id) {
  let a = ori.get(id);
  if (!a) {
    // Deterministic-ish varied start pose per ball; exact values irrelevant.
    const t = id * 2.399963;
    a = { x: Math.cos(t) * 0.8, y: Math.sin(t) * 0.8, z: 0.6 };
    normalize(a);
    ori.set(id, a);
  }
  return a;
}

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= m; v.y /= m; v.z /= m;
}

// Rodrigues rotation of the decal axis by the ball's angular velocity.
export function spinDecals(balls, dt) {
  for (const b of balls) {
    if (b.state === 3) continue; // POCKETED
    const wx = b.wx;
    const wy = b.wy;
    const wz = b.wz;
    const w = Math.hypot(wx, wy, wz);
    if (w < 0.01) continue;
    const a = axisFor(b.id);
    const th = w * dt;
    const ux = wx / w;
    const uy = wy / w;
    const uz = wz / w;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const d = (ux * a.x + uy * a.y + uz * a.z) * (1 - c);
    const nx = a.x * c + (uy * a.z - uz * a.y) * s + ux * d;
    const ny = a.y * c + (uz * a.x - ux * a.z) * s + uy * d;
    const nz = a.z * c + (ux * a.y - uy * a.x) * s + uz * d;
    a.x = nx; a.y = ny; a.z = nz;
    normalize(a);
  }
}

export function resetDecals() {
  ori.clear();
}

export function drawBall(ctx, b, sx, sy, r) {
  const color = BALL_COLORS[b.id];
  const isStripe = b.id >= 9;
  const isCue = b.id === 0;
  const a = axisFor(b.id);

  // Cloth shadow
  ctx.beginPath();
  ctx.ellipse(sx + r * 0.18, sy + r * 0.28, r * 0.95, r * 0.8, 0, 0, 7);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, 7);
  ctx.clip();

  // Base
  ctx.fillStyle = isStripe || isCue ? '#f4f0e6' : color;
  ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);

  // Stripe band: equatorial band around the decal axis, approximated by a
  // thick stroked ellipse whose flattening tracks the axis' z-component.
  if (isStripe) {
    const phi = Math.atan2(a.y, a.x) + Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * 0.98, Math.max(r * Math.abs(a.z), r * 0.02), phi, 0, 7);
    ctx.strokeStyle = color;
    ctx.lineWidth = r * 0.85;
    ctx.stroke();
  }

  // Number spot at the decal pole (visible hemisphere only)
  if (!isCue && a.z > 0.15 && r > 7) {
    const px = sx + a.x * r * 0.62;
    const py = sy + a.y * r * 0.62;
    const pr = r * 0.34 * (0.35 + 0.65 * a.z);
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * (0.4 + 0.6 * a.z), Math.atan2(a.y, a.x), 0, 7);
    ctx.fillStyle = '#f4f0e6';
    ctx.fill();
    if (r > 10 && a.z > 0.45) {
      ctx.fillStyle = '#1a1a1f';
      ctx.font = `700 ${Math.max(6, pr * 1.1)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id), px, py + pr * 0.05);
    }
  }

  // Shading: soft top-left light + ambient occlusion
  const grad = ctx.createRadialGradient(sx - r * 0.4, sy - r * 0.45, r * 0.1, sx, sy, r * 1.25);
  grad.addColorStop(0, 'rgba(255,255,255,0.32)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);

  // Specular dot
  ctx.beginPath();
  ctx.arc(sx - r * 0.38, sy - r * 0.42, r * 0.13, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fill();

  ctx.restore();
}

export { BALL_R };
