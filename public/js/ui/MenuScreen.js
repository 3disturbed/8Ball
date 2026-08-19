// Main menu. Buttons light up as their milestones land.

import { getName, setName } from '../net/identity.js';

export function makeMenu(container, { onSandbox, onSolo, onPrivate, onPublic }) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <h1>8<span>Ball</span></h1>
    <p class="menu-sub">real physics · one link, one table</p>
    <input class="menu-name" maxlength="18" placeholder="Your name" spellcheck="false">
    <div class="menu-buttons">
      <button data-mode="solo" class="ready">Solo Practice <small>free table or vs AI</small></button>
      <div class="menu-sublist hidden" data-sub="solo">
        <button data-solo="sandbox">Free Table</button>
        <button data-solo="easy">AI · Easy</button>
        <button data-solo="medium">AI · Medium</button>
        <button data-solo="hard">AI · Hard</button>
      </div>
      <button data-mode="private" class="ready">Private Match <small>send a friend the link</small></button>
      <button data-mode="public" class="ready">Public Lobby <small>open tables &amp; quick match</small></button>
    </div>
    <p class="menu-foot"><a href="https://darksgames.app">darksgames.app</a></p>`;
  container.appendChild(el);

  const nameInput = el.querySelector('.menu-name');
  nameInput.value = getName();
  nameInput.addEventListener('change', () => setName(nameInput.value));

  const toggle = (key) => {
    const target = el.querySelector(`[data-sub="${key}"]`);
    const wasHidden = target.classList.contains('hidden');
    for (const sub of el.querySelectorAll('.menu-sublist')) sub.classList.add('hidden');
    if (wasHidden) target.classList.remove('hidden');
  };

  el.querySelector('[data-mode="solo"]').addEventListener('click', () => toggle('solo'));
  el.querySelector('[data-mode="private"]').addEventListener('click', () => {
    setName(nameInput.value);
    onPrivate();
  });
  el.querySelector('[data-mode="public"]').addEventListener('click', () => {
    setName(nameInput.value);
    onPublic();
  });

  for (const b of el.querySelectorAll('[data-solo]')) {
    b.addEventListener('click', () => {
      setName(nameInput.value);
      const kind = b.dataset.solo;
      if (kind === 'sandbox') onSandbox();
      else onSolo(kind);
    });
  }

  return { destroy() { el.remove(); } };
}
