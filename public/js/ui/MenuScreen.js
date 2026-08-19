// Main menu. Buttons light up as their milestones land.

export function makeMenu(container, { onSandbox }) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <h1>8<span>Ball</span></h1>
    <p class="menu-sub">real physics · one link, one table</p>
    <div class="menu-buttons">
      <button data-mode="sandbox" class="ready">Sandbox <small>free table — hit stuff</small></button>
      <button data-mode="solo" disabled>Solo Practice <small>vs AI — coming in M2</small></button>
      <button data-mode="private" disabled>Private Match <small>invite a friend — M3</small></button>
      <button data-mode="public" disabled>Public Lobby <small>open tables — M4</small></button>
    </div>
    <p class="menu-foot"><a href="https://darksgames.app">darksgames.app</a></p>`;
  container.appendChild(el);

  el.querySelector('[data-mode="sandbox"]').addEventListener('click', onSandbox);

  return { destroy() { el.remove(); } };
}
