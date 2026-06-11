/* ============ P2P networking via PeerJS (host-authoritative) ============
 * The host creates a Peer with id "mateo-<CODE>"; guests connect to it.
 * Messages are plain JSON: guests send actions, host sends state + events.
 */
// Bumped on every release that changes the host<->guest message shape.
// Host and guests must match: a cached old version on one device would
// otherwise break the game silently (e.g. missing snapshot fields).
const PROTOCOL_VERSION = 3;

const Net = (() => {
  let peer = null;
  let isHost = false;
  let hostConn = null;   // guest → host connection
  const conns = [];      // host → guest connections
  const handlers = {};   // message type → fn(msg, conn)

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const JOIN_TIMEOUT_MS = 12000;

  function randomCode(len = 4) {
    let code = '';
    for (let i = 0; i < len; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  function on(type, fn) { handlers[type] = fn; }

  function dispatch(msg, conn) {
    if (msg && msg.t && handlers[msg.t]) handlers[msg.t](msg, conn);
  }

  /* If the websocket to the PeerJS broker drops (phone screen lock, network
   * switch), the room ID gets released and new joins fail with
   * "peer-unavailable". Reconnecting re-registers the same ID. */
  function keepRegistered() {
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && peer && peer.disconnected && !peer.destroyed) {
      peer.reconnect();
    }
  });

  function createRoom(cb) {
    const code = randomCode();
    isHost = true;
    let settled = false;
    const done = (err, c) => { if (!settled) { settled = true; cb(err, c); } };

    peer = new Peer(`mateo-${code}`);
    peer.on('open', () => done(null, code));
    peer.on('error', (err) => done(err));
    keepRegistered();
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.push(conn);
        conn.on('data', (d) => dispatch(d, conn));
        conn.on('close', () => handlers._disconnect && handlers._disconnect({ t: '_disconnect' }, conn));
      });
    });
  }

  function joinRoom(code, cb) {
    isHost = false;
    let settled = false;
    let timer = null;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb(err);
    };
    timer = setTimeout(() => done({ type: 'timeout' }), JOIN_TIMEOUT_MS);

    peer = new Peer();
    peer.on('error', (err) => done(err));
    keepRegistered();
    peer.on('open', () => {
      hostConn = peer.connect(`mateo-${code.toUpperCase()}`, { reliable: true });
      hostConn.on('open', () => done(null));
      hostConn.on('data', (d) => dispatch(d));
      hostConn.on('close', () => handlers._hostLost && handlers._hostLost());
    });
  }

  function sendToHost(msg) {
    if (hostConn && hostConn.open) hostConn.send(msg);
  }

  function sendTo(conn, msg) {
    if (conn && conn.open) conn.send(msg);
  }

  return {
    on, createRoom, joinRoom, sendToHost, sendTo,
    get conns() { return conns; },
    get isHost() { return isHost; },
  };
})();
