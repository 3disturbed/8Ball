// Pre-game lobby overlay: the invite link, who's here, waiting state.

export function makeLobby(container) {
  const el = document.createElement('div');
  el.className = 'lobby hidden';
  el.innerHTML = `
    <div class="lobby-card">
      <h2>Your table is ready</h2>
      <p class="lobby-sub">Send this link — your friend taps it and the game starts.</p>
      <div class="lobby-link-row">
        <input class="lobby-link" readonly>
        <button class="lobby-copy">Copy</button>
      </div>
      <p class="lobby-share"></p>
      <p class="lobby-who">Waiting for an opponent…</p>
    </div>`;
  container.appendChild(el);

  const link = el.querySelector('.lobby-link');
  const copy = el.querySelector('.lobby-copy');
  const who = el.querySelector('.lobby-who');
  const share = el.querySelector('.lobby-share');

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      copy.textContent = 'Copied!';
    } catch {
      link.select();
      document.execCommand('copy');
      copy.textContent = 'Copied!';
    }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });

  if (navigator.share) {
    const btn = document.createElement('button');
    btn.className = 'lobby-copy';
    btn.textContent = 'Share…';
    btn.addEventListener('click', () => {
      navigator.share({ title: '8Ball', text: 'Play me at pool 🎱', url: link.value }).catch(() => {});
    });
    share.appendChild(btn);
  }

  return {
    update(snap) {
      if (!snap) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      link.value = `${location.origin}/?invite=${encodeURIComponent(snap.inviteToken)}`;
      const names = [];
      if (snap.seats?.A) names.push(snap.seats.A.name);
      if (snap.seats?.B) names.push(snap.seats.B.name);
      const specs = snap.spectators ? ` · ${snap.spectators} watching` : '';
      who.textContent = names.length < 2
        ? `${names.join(' · ')} — waiting for an opponent…${specs}`
        : `${names.join(' vs ')}${specs}`;
    },
    destroy() { el.remove(); },
  };
}
