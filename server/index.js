// 8Ball server entry. Static client from public/, shared sim modules at
// /shared (the client imports the exact modules this server runs), Socket.IO
// for tables. Exported as a factory so smoke tests can boot it on port 0.
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { TableService } from './lobby/TableService.js';
import { InviteStore } from './lobby/InviteStore.js';
import { bindSockets } from './network/messageRouter.js';
import { bindApi } from './api/tables.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function createGameServer({ withStore = true } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public')));

  const httpServer = createServer(app);
  const io = new Server(httpServer, { serveClient: true });

  const service = new TableService({
    emitter: (room, event, payload) => io.to(room).emit(event, payload),
    store: withStore ? new InviteStore() : null,
  });
  await service.init();
  bindSockets(io, service);
  bindApi(app, service);

  const reaper = setInterval(() => service.reap(), 60_000);
  reaper.unref();

  return { app, httpServer, io, service };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const PORT = Number(process.env.PORT) || 4880;
  const { httpServer } = await createGameServer();
  // Every game on this box binds loopback; nginx is the only public listener.
  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`8ball listening on 127.0.0.1:${PORT}`);
  });
}
