// Top bar: back button, status line, context action. Grows player chips,
// group indicators and the shot clock in M2-M4.

export function makeHud(container, { onBack }) {
  const bar = document.createElement('div');
  bar.className = 'hud';
  bar.innerHTML = `
    <button class="hud-back">‹ Menu</button>
    <span class="hud-status"></span>
    <span class="hud-actions"></span>`;
  container.appendChild(bar);
  bar.querySelector('.hud-back').addEventListener('click', onBack);
  const status = bar.querySelector('.hud-status');
  const actions = bar.querySelector('.hud-actions');

  return {
    setStatus(text) { status.textContent = text; },
    addAction(label, fn) {
      const b = document.createElement('button');
      b.className = 'hud-action';
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.appendChild(b);
      return b;
    },
    clearActions() { actions.innerHTML = ''; },
    destroy() { bar.remove(); },
  };
}
