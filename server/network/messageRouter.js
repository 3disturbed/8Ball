// Socket.IO <-> TableService binding. Sockets join `player:<id>` on hello and
// their table's room on create/join/rejoin; the service emits to rooms only.

import { MSG } from '../../shared/MessageTypes.js';

export function bindSockets(io, service) {
  io.on('connection', (socket) => {
    const fail = (err) => socket.emit(MSG.TABLE_ERROR, { message: err.message || 'Something broke.' });

    const requireId = () => {
      const id = socket.data.playerId;
      if (!id) throw new Error('Say hello first.');
      return id;
    };

    socket.on(MSG.HELLO, (payload = {}) => {
      try {
        const playerId = String(payload.playerId || '').slice(0, 64);
        if (playerId.length < 8) throw new Error('Bad player id.');
        socket.data.playerId = playerId;
        socket.join(service.playerRoom(playerId));
        service.setName(playerId, payload.name);

        if (payload.inviteToken) {
          const { table } = service.joinByInvite(playerId, payload.inviteToken);
          socket.join(service.room(table));
          socket.emit(MSG.TABLE_SNAPSHOT, service.snapshotFor(table, playerId));
          return;
        }
        const existing = service.tableOf(playerId);
        if (existing) {
          service.rejoin(existing, playerId);
          socket.join(service.room(existing));
          socket.emit(MSG.TABLE_SNAPSHOT, service.snapshotFor(existing, playerId));
          return;
        }
        socket.emit(MSG.HELLO_OK, { name: service.nameOf(playerId) });
      } catch (err) { fail(err); }
    });

    socket.on(MSG.TABLE_CREATE, (payload = {}) => {
      try {
        const playerId = requireId();
        const table = service.createTable(playerId, {
          preset: String(payload.preset || 'standard'),
          overrides: typeof payload.overrides === 'object' && payload.overrides ? payload.overrides : {},
          visibility: payload.visibility === 'public' ? 'public' : 'private',
        });
        socket.join(service.room(table));
        socket.emit(MSG.TABLE_SNAPSHOT, service.snapshotFor(table, playerId));
      } catch (err) { fail(err); }
    });

    socket.on(MSG.TABLE_JOIN, (payload = {}) => {
      try {
        const playerId = requireId();
        const { table } = service.joinByInvite(playerId, payload.inviteToken);
        socket.join(service.room(table));
        socket.emit(MSG.TABLE_SNAPSHOT, service.snapshotFor(table, playerId));
      } catch (err) { fail(err); }
    });

    socket.on(MSG.TABLE_LEAVE, () => {
      try {
        const playerId = requireId();
        const t = service.tableOf(playerId);
        if (t) socket.leave(service.room(t));
        service.leave(playerId);
      } catch (err) { fail(err); }
    });

    socket.on(MSG.SHOT_TAKE, (payload = {}) => {
      try {
        service.handleShot(requireId(), payload);
      } catch (err) { fail(err); }
    });

    socket.on(MSG.AIM_UPDATE, (payload = {}) => {
      try { service.relayAim(requireId(), payload, MSG.AIM_UPDATE); } catch { /* volatile */ }
    });

    socket.on(MSG.CUE_PLACE, (payload = {}) => {
      try { service.relayAim(requireId(), payload, MSG.CUE_PLACE); } catch { /* volatile */ }
    });

    socket.on(MSG.REMATCH_VOTE, () => {
      try { service.rematchVote(requireId()); } catch (err) { fail(err); }
    });

    socket.on(MSG.QUEUE_JOIN, () => {
      try { service.queueJoin(requireId()); } catch (err) { fail(err); }
    });

    socket.on(MSG.QUEUE_LEAVE, () => {
      try { service.queueLeave(requireId()); } catch (err) { fail(err); }
    });

    socket.on(MSG.CLAIM_WIN, () => {
      try { service.claimWin(requireId()); } catch (err) { fail(err); }
    });

    socket.on('disconnect', async () => {
      const playerId = socket.data.playerId;
      if (!playerId) return;
      const remaining = await io.in(service.playerRoom(playerId)).fetchSockets();
      if (remaining.length === 0) service.disconnect(playerId);
    });
  });
}
