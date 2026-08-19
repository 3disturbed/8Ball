// Leaderboard REST: the site and the end screen can show top rated players.

export function bindStatsApi(app, stats) {
  app.get('/api/leaderboard', (_req, res) => {
    res.json({ players: stats ? stats.top(20) : [] });
  });
}
