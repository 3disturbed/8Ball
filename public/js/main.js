// Screen router: menu <-> game screens. ?invite= deep links arrive in M3.

import { rackBalls } from '/shared/physics/Rack.js';
import { Renderer } from './render/Renderer.js';
import { Controller } from './game/Controller.js';
import { LocalTransport } from './net/LocalTransport.js';
import { attachAim } from './input/AimControl.js';
import { attachPower } from './input/PowerSlider.js';
import { attachSpin } from './input/SpinWidget.js';
import { makeHud } from './ui/Hud.js';
import { makeMenu } from './ui/MenuScreen.js';

const app = document.getElementById('app');
let current = null; // { destroy() }

function show(builder) {
  if (current) current.destroy();
  app.innerHTML = '';
  current = builder(app);
}

function menuScreen(container) {
  return makeMenu(container, {
    onSandbox: () => show(sandboxScreen),
  });
}

function sandboxScreen(container) {
  const wrap = document.createElement('div');
  wrap.className = 'game-screen';
  const canvas = document.createElement('canvas');
  canvas.className = 'table-canvas';
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const hud = makeHud(wrap, { onBack: () => show(menuScreen) });
  hud.setStatus('Sandbox — break away');

  const renderer = new Renderer(canvas);
  const transport = new LocalTransport({ mode: 'sandbox' });
  const controller = new Controller({ renderer, transport, hud });

  hud.addAction('Re-rack', () => {
    controller.start(rackBalls(), { isBreak: true });
    hud.setStatus('Sandbox — break away');
  });

  attachAim(canvas, controller, renderer);
  const power = attachPower(wrap, controller);
  const spin = attachSpin(wrap, controller);

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  controller.start(rackBalls(), { isBreak: true });

  return {
    destroy() {
      controller.stop();
      window.removeEventListener('resize', onResize);
      power.setVisible(false);
      spin.close();
      wrap.remove();
      hud.destroy();
    },
  };
}

show(menuScreen);
