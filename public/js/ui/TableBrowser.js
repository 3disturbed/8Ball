// Public lobby (SDD §5): browse open tables (5s poll), quick match, host.

export function makeBrowser(container, { onJoin, onHost, onQuick, onBack }) {
  const el = document.createElement('div');
  el.className = 'browser';
  el.innerHTML = `
    <div class="browser-head">
      <button class="hud-back">‹ Menu</button>
      <h2>Public tables</h2>
      <span></span>
    </div>
    <div class="browser-actions">
      <button class="browser-quick">⚡ Quick Match</button>
      <button class="browser-host">Host a table</button>
    </div>
    <div class="browser-list"><p class="browser-empty">Looking for tables…</p></div>`;
  container.appendChild(el);

  el.querySelector('.hud-back').addEventListener('click', onBack);
  el.querySelector('.browser-quick').addEventListener('click', onQuick);
  el.querySelector('.browser-host').addEventListener('click', onHost);
  const list = el.querySelector('.browser-list');

  let timer = 0;
  async function refresh() {
    try {
      const res = await fetch('/api/tables');
      const { tables } = await res.json();
      if (!tables.length) {
        list.innerHTML = '<p class="browser-empty">No open tables — host one or hit Quick Match.</p>';
        return;
      }
      list.innerHTML = '';
      for (const t of tables) {
        const row = document.createElement('div');
        row.className = 'browser-row';
        const state = t.phase === 'PLAYING' ? 'in play' : 'waiting';
        const extras = [
          t.turnTimer ? `⏱ ${t.turnTimer}s` : null,
          t.bestOf > 1 ? `race ${t.bestOf}` : null,
          t.spectators ? `${t.spectators} watching` : null,
        ].filter(Boolean).join(' · ');
        row.innerHTML = `
          <div class="browser-info">
            <strong>${t.hostName}</strong>
            <small>${t.preset} · ${t.seatsFilled}/2 seats · ${state}${extras ? ` · ${extras}` : ''}</small>
          </div>
          <button>${t.seatsFilled < 2 ? 'Join' : 'Watch'}</button>`;
        row.querySelector('button').addEventListener('click', () => onJoin(t.inviteToken));
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<p class="browser-empty">Lobby unreachable — retrying…</p>';
    }
  }
  refresh();
  timer = setInterval(refresh, 5000);

  return {
    destroy() {
      clearInterval(timer);
      el.remove();
    },
  };
}
