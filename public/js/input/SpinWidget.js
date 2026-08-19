// Spin control: a small cue-ball button that opens a large cue-ball face;
// drag the tip dot anywhere inside the miscue circle (SDD §6).

import { TIP_MAX } from '/shared/Constants.js';

export function attachSpin(container, controller) {
  const btn = document.createElement('button');
  btn.className = 'spin-btn';
  btn.innerHTML = '<span class="spin-dot"></span>';
  container.appendChild(btn);
  const miniDot = btn.querySelector('.spin-dot');

  const modal = document.createElement('div');
  modal.className = 'spin-modal hidden';
  modal.innerHTML = `
    <div class="spin-face">
      <span class="spin-cross"></span>
      <span class="spin-dot big"></span>
    </div>
    <p class="spin-hint">Drag to set spin — top: follow, bottom: draw, sides: english</p>`;
  container.appendChild(modal);
  const face = modal.querySelector('.spin-face');
  const bigDot = modal.querySelector('.spin-dot.big');

  function paint() {
    const { ox, oy } = controller.aim.tip;
    // oy is world "above center" = screen up = negative CSS offset
    miniDot.style.transform = `translate(${(ox / TIP_MAX) * 9}px, ${(-oy / TIP_MAX) * 9}px)`;
    bigDot.style.transform = `translate(${(ox / TIP_MAX) * 62}px, ${(-oy / TIP_MAX) * 62}px)`;
  }

  btn.addEventListener('click', () => {
    if (!controller.canShoot) return;
    modal.classList.toggle('hidden');
    paint();
  });

  let active = false;
  function setTip(e) {
    const rect = face.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ox = ((e.clientX - cx) / (rect.width / 2)) * TIP_MAX;
    let oy = -((e.clientY - cy) / (rect.height / 2)) * TIP_MAX;
    const m = Math.hypot(ox, oy);
    if (m > TIP_MAX) { ox = (ox / m) * TIP_MAX; oy = (oy / m) * TIP_MAX; }
    controller.aim.tip.ox = Math.round(ox);
    controller.aim.tip.oy = Math.round(oy);
    paint();
  }

  face.addEventListener('pointerdown', (e) => {
    active = true;
    face.setPointerCapture(e.pointerId);
    setTip(e);
  });
  face.addEventListener('pointermove', (e) => { if (active) setTip(e); });
  face.addEventListener('pointerup', () => { active = false; });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  return {
    refresh: paint,
    close() { modal.classList.add('hidden'); },
  };
}
