// 8Ball server entry. Static client from public/, shared sim modules at /shared
// (the client imports the exact modules this server runs), Socket.IO for tables.
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 4880;

const app = express();
app.use(express.json());

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use(express.static(path.join(ROOT, 'public')));

const server = createServer(app);

// Every game on this box binds loopback; nginx is the only public listener.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`8ball listening on 127.0.0.1:${PORT}`);
});
