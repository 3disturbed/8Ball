// Public lobby REST (SDD §7): the table browser polls GET /api/tables every
// 5s; quick-match hands back the oldest open public table's invite token (or
// tells the client to host one). Joining always goes through the socket +
// invite-token flow — one join path to secure.

export function bindApi(app, service) {
  app.get('/api/tables', (_req, res) => {
    res.json({ tables: service.publicTables() });
  });

  app.post('/api/quickmatch', (_req, res) => {
    res.json(service.quickmatch());
  });

  // Social-layer room lookup by invite token: no names, always joinable
  // (a full table still takes spectators / the winner-stays queue).
  app.get('/api/rooms/:token', (req, res) => {
    const t = service.findByInvite(String(req.params.token || ''));
    if (!t) return res.status(404).json({ error: 'not_found' });
    const players = ['A', 'B'].filter((s) => t.seats[s]).length;
    res.json({ code: t.inviteToken, players, max: 2, phase: t.phase, spectators: t.spectators.size, joinable: true });
  });
}
