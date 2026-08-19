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
}
