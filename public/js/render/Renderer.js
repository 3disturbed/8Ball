// Canvas renderer: world<->screen transform (auto-rotates for portrait),
// table, balls, aiming guide, cue stick. Pure drawing — no game state.

import {
  TABLE_L, TABLE_W, BALL_R, HEADSTRING_X, FOOT_SPOT, STATE,
} from '/shared/Constants.js';
import { TABLE } from '/shared/physics/Collisions.js';
import { drawBall, spinDecals } from './BallPainter.js';

const MARGIN = 0.085;           // wood rail width in world units
const FELT = '#0c4526';
const FELT_EDGE = '#0a3a20';
const WOOD = '#3a1f0e';
const WOOD_EDGE = '#241105';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rotated = false;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.rotated = h > w; // portrait: rotate the table 90°
    const worldW = (this.rotated ? TABLE_W : TABLE_L) + 2 * MARGIN;
    const worldH = (this.rotated ? TABLE_L : TABLE_W) + 2 * MARGIN;
    this.scale = Math.min(w / worldW, h / worldH);
    this.ox = (w - worldW * this.scale) / 2 + MARGIN * this.scale;
    this.oy = (h - worldH * this.scale) / 2 + MARGIN * this.scale;
  }

  toScreen(x, y) {
    if (this.rotated) return [this.ox + (TABLE_W - y) * this.scale, this.oy + x * this.scale];
    return [this.ox + x * this.scale, this.oy + y * this.scale];
  }

  toWorld(px, py) {
    if (this.rotated) {
      return [(py - this.oy) / this.scale, TABLE_W - (px - this.ox) / this.scale];
    }
    return [(px - this.ox) / this.scale, (py - this.oy) / this.scale];
  }

  draw(state, dtFrame) {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    this.drawTable(state);
    if (dtFrame) spinDecals(state.balls, dtFrame);

    const r = BALL_R * this.scale;
    for (const b of state.balls) {
      if (b.state === STATE.POCKETED) continue;
      const [sx, sy] = this.toScreen(b.x, b.y);
      drawBall(ctx, b, sx, sy, r);
    }

    if (state.ghost) this.drawGhostCue(state.ghost, r);
    if (state.guide) this.drawGuide(state.guide, r);
    if (state.cue) this.drawCueStick(state.cue, r);
    if (state.banner) this.drawBanner(state.banner);
  }

  drawTable(state) {
    const { ctx } = this;
    const m = MARGIN;
    const [fx, fy] = this.toScreen(-m, this.rotated ? TABLE_W + m : -m);
    const railW = (TABLE_L + 2 * m) * this.scale;
    const railH = (TABLE_W + 2 * m) * this.scale;
    const rw = this.rotated ? railH : railW;
    const rh = this.rotated ? railW : railH;

    // Wood frame
    ctx.fillStyle = WOOD;
    ctx.strokeStyle = WOOD_EDGE;
    ctx.lineWidth = 3;
    roundRect(ctx, fx, fy, rw, rh, 14 + this.scale * 0.02);
    ctx.fill();
    ctx.stroke();

    // Felt
    const [ex, ey] = this.toScreen(0, this.rotated ? TABLE_W : 0);
    const feltW = this.rotated ? TABLE_W * this.scale : TABLE_L * this.scale;
    const feltH = this.rotated ? TABLE_L * this.scale : TABLE_W * this.scale;
    const grad = ctx.createRadialGradient(
      ex + feltW / 2, ey + feltH / 2, feltH * 0.2,
      ex + feltW / 2, ey + feltH / 2, feltH * 0.9,
    );
    grad.addColorStop(0, FELT);
    grad.addColorStop(1, FELT_EDGE);
    ctx.fillStyle = grad;
    ctx.fillRect(ex, ey, feltW, feltH);

    // Head string + foot spot
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const [h1x, h1y] = this.toScreen(HEADSTRING_X, 0);
    const [h2x, h2y] = this.toScreen(HEADSTRING_X, TABLE_W);
    ctx.moveTo(h1x, h1y);
    ctx.lineTo(h2x, h2y);
    ctx.stroke();
    const [fsx, fsy] = this.toScreen(FOOT_SPOT.x, FOOT_SPOT.y);
    ctx.beginPath();
    ctx.arc(fsx, fsy, 3, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();

    // Cushion noses along the rail spans
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(2, this.scale * 0.012);
    for (let i = 0; i < 6; i += 1) {
      const s = TABLE.segments[i];
      const [ax, ay] = this.toScreen(s.x1, s.y1);
      const [bx, by] = this.toScreen(s.x2, s.y2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Pockets
    for (const p of TABLE.pockets) {
      const [px, py] = this.toScreen(p.x, p.y);
      const pr = p.r * this.scale * 1.06;
      const pg = ctx.createRadialGradient(px, py, pr * 0.2, px, py, pr);
      pg.addColorStop(0, '#000');
      pg.addColorStop(0.8, '#0a0a0d');
      pg.addColorStop(1, '#1c1209');
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, 7);
      ctx.fillStyle = pg;
      ctx.fill();
    }

    // Pocket flash effects
    if (state.effects) {
      for (const fx2 of state.effects.pocketFlashes) {
        const p = TABLE.pockets[fx2.pocket];
        const [px, py] = this.toScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(px, py, p.r * this.scale * (1.1 + fx2.t * 0.8), 0, 7);
        ctx.strokeStyle = `rgba(232,193,90,${(1 - fx2.t) * 0.8})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  }

  // Aiming guide: cue path → ghost ball → object stub + cue tangent stub.
  drawGuide(g, r) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const [ax, ay] = this.toScreen(g.from.x, g.from.y);
    const [bx, by] = this.toScreen(g.to.x, g.to.y);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ghost ball at contact
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();

    if (g.object) {
      const [ox, oy] = this.toScreen(g.object.from.x, g.object.from.y);
      const [tx, ty] = this.toScreen(g.object.to.x, g.object.to.y);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (g.tangent) {
      const [ox, oy] = this.toScreen(g.tangent.from.x, g.tangent.from.y);
      const [tx, ty] = this.toScreen(g.tangent.to.x, g.tangent.to.y);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGhostCue(ghost, r) {
    const { ctx } = this;
    const [sx, sy] = this.toScreen(ghost.x, ghost.y);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 7);
    ctx.fillStyle = ghost.legal ? 'rgba(244,240,230,0.55)' : 'rgba(224,90,78,0.55)';
    ctx.fill();
    ctx.strokeStyle = ghost.legal ? 'rgba(255,255,255,0.8)' : 'rgba(224,90,78,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawCueStick(cue, r) {
    const { ctx } = this;
    const [cx, cy] = this.toScreen(cue.x, cue.y);
    // Screen-space angle of the aim direction
    const [hx, hy] = this.toScreen(cue.x + cue.dx * 0.1, cue.y + cue.dy * 0.1);
    const ang = Math.atan2(hy - cy, hx - cx);
    const pull = r * 1.6 + cue.power * r * 5 + cue.strike * r * -4;
    const len = r * 22;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const grad = ctx.createLinearGradient(-pull - len, 0, -pull, 0);
    grad.addColorStop(0, '#5a3a1c');
    grad.addColorStop(0.85, '#c89a62');
    grad.addColorStop(1, '#2a5db0');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-pull, -r * 0.16);
    ctx.lineTo(-pull - len, -r * 0.34);
    ctx.lineTo(-pull - len, r * 0.34);
    ctx.lineTo(-pull, r * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBanner(banner) {
    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.save();
    ctx.globalAlpha = banner.alpha;
    ctx.fillStyle = 'rgba(5,5,12,0.82)';
    ctx.fillRect(0, h * 0.42, w, h * 0.16);
    ctx.fillStyle = '#e8c15a';
    ctx.font = `700 ${Math.round(h * 0.055)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, w / 2, h / 2);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
