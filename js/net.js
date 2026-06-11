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

  function createRoom(cb) {
    const code = randomCode();
    isHost = true;
    peer = new Peer(`mateo-${code}`);
    peer.on('open', () => cb(null, code));
    peer.on('error', (err) => cb(err));
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
    peer = new Peer();
    peer.on('error', (err) => cb(err));
    peer.on('open', () => {
      hostConn = peer.connect(`mateo-${code.toUpperCase()}`, { reliable: true });
      hostConn.on('open', () => cb(null));
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
