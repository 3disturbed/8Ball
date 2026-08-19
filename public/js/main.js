// Screen router: menu <-> game screens, plus the ?invite= deep link.

import { Renderer } from './render/Renderer.js';
import { Controller } from './game/Controller.js';
import { LocalTransport } from './net/LocalTransport.js';
import { SocketTransport } from './net/SocketTransport.js';
import { attachAim } from './input/AimControl.js';
import { attachPower } from './input/PowerSlider.js';
import { attachSpin } from './input/SpinWidget.js';
import { makeHud } from './ui/Hud.js';
import { makeMenu } from './ui/MenuScreen.js';
import { makeLobby } from './ui/LobbyScreen.js';
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
    onPrivate: (preset) => show(gameScreen, {
      kind: 'online', action: { create: { preset, visibility: 'private' } }, title: 'Private table',
    }),
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
    transport = new SocketTransport({
      hud,
      action,
      onLobby: (snap) => lobby.update(snap),
    });
  } else {
    transport = new LocalTransport({ mode: kind === 'solo' ? 'solo' : 'sandbox', difficulty, hud });
  }

  const controller = new Controller({ renderer, transport, hud });
  controller.onEvent = (e) => playEvent(e);
  controller.onStrike = (p) => playCueStrike(p);
  controller.onSettled = () => { if (controller.canShoot) playChalk(); };
  transport.onWin = () => playWin();

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
      window.removeEventListener('resize', onResize);
      power.setVisible(false);
      spin.close();
      if (lobby) lobby.destroy();
      wrap.remove();
      hud.destroy();
    },
  };
}

const invite = new URLSearchParams(location.search).get('invite');
if (invite) {
  history.replaceState(null, '', location.pathname);
  show(gameScreen, { kind: 'online', action: { invite }, title: 'Joining table…' });
} else {
  show(menuScreen);
}
