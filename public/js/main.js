// Screen router: menu <-> game screens. ?invite= deep links arrive in M3.

import { Renderer } from './render/Renderer.js';
import { Controller } from './game/Controller.js';
import { LocalTransport } from './net/LocalTransport.js';
import { attachAim } from './input/AimControl.js';
import { attachPower } from './input/PowerSlider.js';
import { attachSpin } from './input/SpinWidget.js';
import { makeHud } from './ui/Hud.js';
import { makeMenu } from './ui/MenuScreen.js';
import { playEvent, playCueStrike, playChalk, playWin } from './audio/Sounds.js';

const app = document.getElementById('app');
let current = null; // { destroy() }

function show(builder, ...args) {
  if (current) current.destroy();
  app.innerHTML = '';
  current = builder(app, ...args);
}

function menuScreen(container) {
  return makeMenu(container, {
    onSandbox: () => show(gameScreen, { mode: 'sandbox', title: 'Sandbox — break away' }),
    onSolo: (difficulty) => show(gameScreen, {
      mode: 'solo', difficulty, title: `Solo vs AI (${difficulty})`,
    }),
  });
}

function gameScreen(container, { mode, difficulty, title }) {
  const wrap = document.createElement('div');
  wrap.className = 'game-screen';
  const canvas = document.createElement('canvas');
  canvas.className = 'table-canvas';
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const hud = makeHud(wrap, { onBack: () => show(menuScreen) });
  hud.setStatus(title);

  const renderer = new Renderer(canvas);
  const transport = new LocalTransport({ mode, difficulty, hud });
  const controller = new Controller({ renderer, transport, hud });

  controller.onEvent = (e) => playEvent(e);
  controller.onStrike = (p) => playCueStrike(p);
  controller.onSettled = () => { if (controller.canShoot) playChalk(); };

  if (mode === 'sandbox') {
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

  transport.begin();

  return {
    destroy() {
      controller.stop();
      if (transport.destroy) transport.destroy();
      window.removeEventListener('resize', onResize);
      power.setVisible(false);
      spin.close();
      wrap.remove();
      hud.destroy();
    },
  };
}

export { playWin }; // used by transports at match end (M3+ wires this per-screen)

show(menuScreen);
