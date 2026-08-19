// Pull-down power slider on the right edge: drag down for power, release to
// fire, drag back to the top to cancel (SDD §6).

export function attachPower(container, controller) {
  const track = document.createElement('div');
  track.className = 'power-track';
  track.innerHTML = '<div class="power-fill"></div><div class="power-knob">⇓</div>';
  container.appendChild(track);
  const fill = track.querySelector('.power-fill');
  const knob = track.querySelector('.power-knob');

  let active = false;

  function setPower(clientY) {
    const rect = track.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientY - rect.top - 24) / (rect.height - 48)));
    controller.aim.power = p;
    fill.style.height = `${p * 100}%`;
    knob.style.top = `${p * (rect.height - 48)}px`;
    track.classList.toggle('hot', p > 0.85);
  }

  track.addEventListener('pointerdown', (e) => {
    if (!controller.canAim()) return;
    active = true;
    track.setPointerCapture(e.pointerId);
    setPower(e.clientY);
    e.preventDefault();
  });

  track.addEventListener('pointermove', (e) => {
    if (active) setPower(e.clientY);
  });

  function done() {
    if (!active) return;
    active = false;
    controller.takeShot(); // no-ops below the 3% cancel threshold
    fill.style.height = '0%';
    knob.style.top = '0px';
    track.classList.remove('hot');
  }
  track.addEventListener('pointerup', done);
  track.addEventListener('pointercancel', done);

  return {
    setVisible(v) { track.style.display = v ? '' : 'none'; },
  };
}
