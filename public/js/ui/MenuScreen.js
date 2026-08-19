// Main menu. Buttons light up as their milestones land.

export function makeMenu(container, { onSandbox, onSolo }) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <h1>8<span>Ball</span></h1>
    <p class="menu-sub">real physics · one link, one table</p>
    <div class="menu-buttons">
      <button data-mode="solo" class="ready">Solo Practice <small>free table or vs AI</small></button>
      <div class="menu-sublist hidden" data-sub="solo">
        <button data-solo="sandbox">Free Table</button>
        <button data-solo="easy">AI · Easy</button>
        <button data-solo="medium">AI · Medium</button>
        <button data-solo="hard">AI · Hard</button>
      </div>
      <button data-mode="private" disabled>Private Match <small>invite a friend — M3</small></button>
      <button data-mode="public" disabled>Public Lobby <small>open tables — M4</small></button>
    </div>
    <p class="menu-foot"><a href="https://darksgames.app">darksgames.app</a></p>`;
  container.appendChild(el);

  const sub = el.querySelector('[data-sub="solo"]');
  el.querySelector('[data-mode="solo"]').addEventListener('click', () => {
    sub.classList.toggle('hidden');
  });
  for (const b of sub.querySelectorAll('[data-solo]')) {
    b.addEventListener('click', () => {
      const kind = b.dataset.solo;
      if (kind === 'sandbox') onSandbox();
      else onSolo(kind);
    });
  }

  return { destroy() { el.remove(); } };
}
