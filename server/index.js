/* ============ Mateo server: rooms over Socket.IO ============
 * Authoritative game server. Rooms live in memory (a restart clears them).
 * Frontend (GitHub Pages or localhost) connects here via websocket.
 */
const http = require('http');
const { Server } = require('socket.io');
const { createRoom } = require('./room');

// Must match the client's PROTOCOL_VERSION (js/net.js)
const PROTOCOL_VERSION = 4;
const PORT = process.env.PORT || 4377;
const ROOM_TTL_MS = 15 * 60 * 1000; // drop rooms abandoned for 15 min

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map(); // code → room

function randomCode() {
  let code = '';
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, v: PROTOCOL_VERSION }));
});

const io = new Server(server, {
  cors: { origin: '*' }, // game state carries no secrets beyond the room code
});

io.on('connection', (socket) => {
  socket.on('create', (data, ack) => {
    if (typeof ack !== 'function') return;
    if (!data || data.v !== PROTOCOL_VERSION) return ack({ error: 'version' });
    const code = randomCode();
    const room = createRoom(code);
    rooms.set(code, room);
    const res = room.addPlayer(data.name, socket);
    socket.data.code = code;
    socket.data.idx = res.idx;
    ack({ code });
  });

  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') return;
    if (!data || data.v !== PROTOCOL_VERSION) return ack({ error: 'version' });
    const room = rooms.get(String(data.code || '').toUpperCase());
    if (!room) return ack({ error: 'not-found' });
    const res = room.addPlayer(data.name, socket);
    if (res.error) return ack({ error: res.error });
    socket.data.code = room.code;
    socket.data.idx = res.idx;
    ack({ code: room.code });
  });

  socket.on('action', (msg) => {
    const room = rooms.get(socket.data.code);
    if (!room || typeof socket.data.idx !== 'number') return;
    if (!msg || typeof msg.a !== 'string') return;
    room.handleAction(socket.data.idx, msg);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (room) {
      room.dropBySocket(socket);
      if (room.playerCount === 0) rooms.delete(room.code);
    }
  });
});

// Sweep rooms whose players all left a while ago
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.abandoned && (room.emptySince === null || now - room.emptySince > ROOM_TTL_MS)) {
      rooms.delete(code);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`Mateo server listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});
