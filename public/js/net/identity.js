// Persistent guest identity (SDD §4.2): a localStorage UUID — never the
// socket id — so reconnects and refreshes reclaim the same seat.

const ID_KEY = '8ball.playerId';
const NAME_KEY = '8ball.name';

export function getPlayerId() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function getName() {
  return localStorage.getItem(NAME_KEY) || '';
}

export function setName(name) {
  localStorage.setItem(NAME_KEY, String(name).slice(0, 18));
}
