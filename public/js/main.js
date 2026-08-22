// Screen router: menu <-> game screens, plus the ?invite= deep link.

import { Renderer } from './render/Renderer.js';
import { Controller } from './game/Controller.js';
import { LocalTransport } from './net/LocalTransport.js';
import { SocketTransport } from './net/SocketTransport.js?v=2';
import { attachAim } from './input/AimControl.js';
import { attachPower } from './input/PowerSlider.js';
import { attachSpin } from './input/SpinWidget.js';
import { makeHud } from './ui/Hud.js';
import { makeMenu } from './ui/MenuScreen.js';
import { makeLobby } from './ui/LobbyScreen.js';
import { makeBrowser } from './ui/TableBrowser.js';
import { rulesDialog } from './ui/RulesDialog.js';
import { playEvent, playCueStrike, playChalk, playWin } from './audio/Sounds.js';
import { rackBalls } from '/shared/physics/Rack.js';

const app = document.getElementById('app');
let current = null; // { destroy() }

function show(builder, ...args) {
  if (current) current.destroy();
  app.innerHTML = '';
  current = builder(app, ...args);
}

function menuScreen(container) {
  return makeMenu(container, {
    onSandbox: () => show(gameScreen, { kind: 'sandbox', title: 'Sandbox — break away' }),
    onSolo: (difficulty) => show(gameScreen, {
      kind: 'solo', difficulty, title: `Solo vs AI (${difficulty})`,
    }),
    onPrivate: async () => {
      const rules = await rulesDialog(container, { title: 'Private table' });
      if (!rules) return;
      show(gameScreen, {
        kind: 'online',
        action: { create: { ...rules, visibility: 'private' } },
        title: 'Private table',
      });
    },
    onPublic: () => show(browserScreen),
  });
}

function browserScreen(container) {
  return makeBrowser(container, {
    onBack: () => show(menuScreen),
    onJoin: (inviteToken) => show(gameScreen, {
      kind: 'online', action: { invite: inviteToken }, title: 'Joining table…',
    }),
    onHost: async () => {
      const rules = await rulesDialog(container, { title: 'Host a public table' });
      if (!rules) return;
      show(gameScreen, {
        kind: 'online',
        action: { create: { ...rules, visibility: 'public' } },
        title: 'Public table',
      });
    },
    onQuick: async () => {
      try {
        const res = await fetch('/api/quickmatch', { method: 'POST' });
        const out = await res.json();
        if (out.inviteToken) {
          show(gameScreen, { kind: 'online', action: { invite: out.inviteToken }, title: 'Quick match' });
        } else {
          show(gameScreen, {
            kind: 'online',
            action: { create: { preset: 'standard', visibility: 'public' } },
            title: 'Public table',
          });
        }
      } catch { /* browser row shows unreachable state */ }
    },
  });
}

function gameScreen(container, { kind, difficulty, action, title }) {
  const wrap = document.createElement('div');
  wrap.className = 'game-screen';
  const canvas = document.createElement('canvas');
  canvas.className = 'table-canvas';
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const hud = makeHud(wrap, { onBack: () => show(menuScreen) });
  hud.setStatus(title);

  const renderer = new Renderer(canvas);
  let lobby = null;
  let transport;
  if (kind === 'online') {
    lobby = makeLobby(wrap);
    let queueBtn = null;
    transport = new SocketTransport({
      hud,
      action,
      onSnapshot,
      onLobby: (snap) => lobby.update(snap),
      onPhase: (phase, snap) => {
        // Spectators get a winner-stays-on queue toggle
        if (snap.you === 'spectator' && !queueBtn) {
          queueBtn = hud.addAction('Join queue', () => {
            if (queueBtn.dataset.queued) {
              transport.leaveQueue();
              delete queueBtn.dataset.queued;
              queueBtn.textContent = 'Join queue';
            } else {
              transport.joinQueue();
              queueBtn.dataset.queued = '1';
              queueBtn.textContent = 'Leave queue';
            }
          });
        } else if (snap.you !== 'spectator' && queueBtn) {
          queueBtn.remove();
          queueBtn = null;
        }
      },
    });
  } else {
    transport = new LocalTransport({ mode: kind === 'solo' ? 'solo' : 'sandbox', difficulty, hud });
    soloPresence = { state: 'solo', detail: title };
    publishPresence();
  }

  const controller = new Controller({ renderer, transport, hud });
  const buzz = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* no haptics */ } };
  controller.onEvent = (e) => {
    playEvent(e);
    if (e.type === 'pocket') buzz(20);
    else if (e.type === 'ball' && e.speed > 4) {
      buzz(12);
      const shake = controller.effects.shake;
      if (!shake || shake.amp < 2) controller.effects.shake = { t: 1, amp: 2 };
    }
  };
  controller.onStrike = (p) => playCueStrike(p);
  controller.onSettled = () => { if (controller.canShoot) playChalk(); };
  transport.onWin = () => {
    playWin();
    controller.startConfetti();
    buzz([60, 40, 60]);
  };

  if (kind === 'sandbox') {
    hud.addAction('Re-rack', () => {
      transport.begin();
      hud.setStatus('Sandbox — break away');
    });
  }

  attachAim(canvas, controller, renderer);
  const power = attachPower(wrap, controller);
  const spin = attachSpin(wrap, controller);

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  if (kind === 'online') {
    // idle table for looks until the snapshot arrives
    controller.start(rackBalls(), { isBreak: true });
    controller.setTurn({ canShoot: false });
  }
  transport.begin();

  return {
    destroy() {
      controller.stop();
      if (transport.destroy) transport.destroy();
      currentSnap = null;
      soloPresence = null;
      publishPresence();
      window.removeEventListener('resize', onResize);
      power.setVisible(false);
      spin.close();
      if (lobby) lobby.destroy();
      wrap.remove();
      hud.destroy();
    },
  };
}

// ---------------------------------------------------------------- social
// Darks Games overlay (friends / invites / party launch). The SDKs are
// deferred classic scripts ahead of this module, so `?dg_party` is already
// stripped from the URL by the time the boot branch below reads `?invite=`.

let currentSnap = null;       // latest online table snapshot (null off-table)
let soloPresence = null;      // { state, detail } while a sandbox / solo screen is up
let partyRoomPending = false; // party host: publish the next table as the party room

function publishPresence() {
  const ov = window.DGOverlay;
  if (!ov) return;
  const s = currentSnap;
  if (!s) {
    ov.presence.set(soloPresence
      ? { state: soloPresence.state, detail: String(soloPresence.detail || '').slice(0, 80), join: null }
      : { state: 'menu', detail: '', join: null });
    return;
  }
  const seated = ['A', 'B'].filter((k) => s.seats?.[k]).length;
  const state = s.phase === 'LOBBY' ? 'lobby'
    : s.you === 'spectator' ? 'spectating'
      : `rack ${s.match?.rackNo ?? 1}`;
  let detail = `${s.visibility === 'public' ? 'Public' : 'Private'} table`;
  if (s.rules?.preset) detail += ` · ${s.rules.preset}`;
  if (s.match?.score) detail += ` · ${s.match.score.A}–${s.match.score.B}`;
  ov.presence.set({
    state,
    detail: detail.slice(0, 80),
    // The invite token is the join code, verbatim (catalog joinKind "query").
    // Joinable even with both seats taken: late arrivals spectate / queue.
    join: { joinCode: s.inviteToken, joinable: true, players: seated, max: 2 },
  });
}

// SocketTransport hook: every snapshot / seat update, null on teardown.
function onSnapshot(snap) {
  currentSnap = snap;
  publishPresence();
  if (partyRoomPending && snap?.inviteToken && window.DGOverlay) {
    partyRoomPending = false;
    window.DGOverlay.party.setRoom({ joinCode: snap.inviteToken })
      .catch((e) => console.warn('[social] party.setRoom failed', e));
  }
}

// Overlay "Join" / accepted invite / party room: join in place.
function socialJoin(j) {
  let token = j?.joinCode || null;
  if (!token && j?.joinUrl) {
    let u;
    try { u = new URL(j.joinUrl, location.href); } catch { return false; }
    if (u.origin !== location.origin) return false;
    token = u.searchParams.get('invite');
  }
  if (!token) return false;
  if (currentSnap?.inviteToken === token) return true;
  show(gameScreen, { kind: 'online', action: { invite: token }, title: 'Joining table…' });
  return true;
}

// Party launch: the host creates a private table; the first snapshot's
// invite token becomes the party room (members' joinHandler then fires).
async function onPartyArrived({ isHost, room } = {}) {
  if (!isHost || room) return;
  if (!window.DGOverlay) return;
  // Already waiting alone at a lobby table (e.g. launched from the overlay
  // while on this page): reuse it instead of tearing it down.
  const s = currentSnap;
  if (s?.inviteToken && s.phase === 'LOBBY' && ['A', 'B'].filter((k) => s.seats?.[k]).length < 2) {
    await window.DGOverlay.party.setRoom({ joinCode: s.inviteToken })
      .catch((e) => console.warn('[social] party.setRoom failed', e));
    return;
  }
  partyRoomPending = true;
  show(gameScreen, {
    kind: 'online',
    action: { create: { preset: 'standard', visibility: 'private' } },
    title: 'Party table',
  });
}

async function initSocial() {
  if (!window.DGAccount || !window.DGOverlay) return;
  await window.DGAccount.init({ game: '8ball' }); // MenuScreen also calls init; it is idempotent
  await window.DGOverlay.init({ game: '8ball', accent: '#6bd5fa', joinHandler: socialJoin });
  window.DGOverlay.on('party.arrived', (a) => onPartyArrived(a).catch((e) => console.warn('[social]', e)));
  publishPresence();
}
window.addEventListener('load', () => initSocial().catch((e) => console.warn('[social]', e)), { once: true });

// ------------------------------------------------------------------ boot

const invite = new URLSearchParams(location.search).get('invite');
if (invite) {
  history.replaceState(null, '', location.pathname);
  show(gameScreen, { kind: 'online', action: { invite }, title: 'Joining table…' });
} else {
  show(menuScreen);
}
