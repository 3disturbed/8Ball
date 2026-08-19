// The protocol contract binding client, server, and tests (SDD §4.1).
// namespace:verb strings, payloads are plain JSON.

export const MSG = Object.freeze({
  // session
  HELLO: 'hello',
  HELLO_OK: 'hello:ok',
  // tables
  TABLE_CREATE: 'table:create',
  TABLE_JOIN: 'table:join',
  TABLE_LEAVE: 'table:leave',
  TABLE_SNAPSHOT: 'table:snapshot',
  TABLE_UPDATE: 'table:update',
  TABLE_ERROR: 'table:error',
  // play
  SHOT_TAKE: 'shot:take',
  SHOT_RESULT: 'shot:result',
  AIM_UPDATE: 'aim:update',
  CUE_PLACE: 'cue:place',
  TURN_TIMEOUT: 'turn:timeout',
  // social
  CHAT_EMOTE: 'chat:emote',
  REMATCH_VOTE: 'rematch:vote',
  MATCH_END: 'match:end',
  QUEUE_JOIN: 'queue:join',
  QUEUE_LEAVE: 'queue:leave',
  CLAIM_WIN: 'claim:win',
});

export const ROTATE_DELAY_MS = 4000;

export const DISCONNECT_GRACE_MS = 60_000;
export const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const LOBBY_REAP_MS = 10 * 60 * 1000;
