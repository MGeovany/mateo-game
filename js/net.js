/* ============ Networking: Socket.IO client → authoritative server ============
 * The server owns the rooms and the game logic; this is a thin adapter.
 * Message shapes ('lobby' / 'state' / 'event') are unchanged from the old
 * P2P version, so the UI code is mostly agnostic.
 */
// Must match the server's PROTOCOL_VERSION (server/index.js)
const PROTOCOL_VERSION = 6;

// Backend URL: local server during development; in production, CloudFront
// (HTTPS/WSS) in front of the EC2 'mateo-server' instance (AWS 851725556357).
const SERVER_URL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? `http://${location.hostname}:4377`
    : 'https://143-47-100-210.sslip.io';

const Net = (() => {
  let socket = null;
  const handlers = {};       // message type → fn(msg)
  let session = null;        // { code, name } for auto-rejoin after a drop
  let everConnected = false;

  function on(type, fn) { handlers[type] = fn; }

  function fire(type, msg) {
    if (handlers[type]) handlers[type](msg);
  }

  function connect() {
    if (socket) return;
    socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

    ['lobby', 'state', 'event', 'rejected'].forEach((t) => {
      socket.on(t, (msg) => fire(t, msg));
    });

    socket.on('connect', () => {
      // Transparent rejoin after a network drop / phone screen lock
      if (everConnected && session) {
        socket.emit('join', { ...session, v: PROTOCOL_VERSION, cosmetics: Economy.cosmetics() }, (res) => {
          if (res && res.error) fire('_dropped', { fatal: true });
        });
      }
      everConnected = true;
      fire('_connected', {});
    });

    socket.on('disconnect', () => fire('_dropped', { fatal: false }));
  }

  function createRoom(name, cb) {
    connect();
    const fail = setTimeout(() => cb({ type: 'timeout' }), 12000);
    socket.emit('create', { name, v: PROTOCOL_VERSION, cosmetics: Economy.cosmetics() }, (res) => {
      clearTimeout(fail);
      if (!res || res.error) return cb({ type: (res && res.error) || 'unknown' });
      session = { code: res.code, name };
      cb(null, res.code);
    });
  }

  function joinRoom(code, name, cb) {
    connect();
    const fail = setTimeout(() => cb({ type: 'timeout' }), 12000);
    socket.emit('join', { code: code.toUpperCase(), name, v: PROTOCOL_VERSION, cosmetics: Economy.cosmetics() }, (res) => {
      clearTimeout(fail);
      if (!res || res.error) return cb({ type: (res && res.error) || 'unknown' });
      session = { code: res.code, name };
      cb(null);
    });
  }

  // Kept for UI compatibility: every game message goes to the server
  function sendToHost(msg) {
    if (socket && socket.connected && msg && msg.t === 'action') {
      socket.emit('action', msg);
    }
  }

  return { on, createRoom, joinRoom, sendToHost };
})();
