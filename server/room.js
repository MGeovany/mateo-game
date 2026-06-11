/* ============ Room controller: validates actions, redacts state ============
 * Server-side port of the old browser host. One room per code; player 0
 * (the creator) controls begin/next-round. Each client receives a snapshot
 * where card faces are stripped unless that viewer may see them.
 */
const { createGame } = require('./game');

function createRoom(code) {
  const game = createGame();
  const S = () => game.state;
  const players = []; // { name, socket | null, disconnected }
  let started = false;
  let reveals = []; // temporary visibility: { player, card, viewers: 'all' | [idx] }
  let emptySince = null; // timestamp when the last connected player left

  /* ---------- membership ---------- */
  function addPlayer(name, socket) {
    const clean = (name || '').trim().slice(0, 10);
    if (started) {
      // Reconnection: a disconnected player may rejoin with the same name
      const idx = players.findIndex(
        (p) => p.disconnected && p.name.toLowerCase() === clean.toLowerCase()
      );
      if (idx !== -1) {
        players[idx].socket = socket;
        players[idx].disconnected = false;
        emptySince = null;
        socket.emit('lobby', lobbyMsg(idx));
        socket.emit('state', snapshotFor(idx));
        emitEvent({ name: 'rejoined', player: idx });
        pushState(); // others see the ⛔ flag clear
        return { idx };
      }
      return { error: 'started' };
    }
    if (players.length >= 4) return { error: 'full' };
    players.push({ name: clean || `Jugador ${players.length + 1}`, socket, disconnected: false });
    broadcastLobby();
    return { idx: players.length - 1 };
  }

  function dropBySocket(socket) {
    const idx = players.findIndex((p) => p.socket === socket);
    if (idx === -1) return;
    if (!started) {
      players.splice(idx, 1);
      if (idx === 0 || players.length === 0) {
        // The creator left before starting: close the room
        players.forEach((p) => p.socket && p.socket.emit('rejected', { reason: 'closed' }));
        players.length = 0;
      } else {
        broadcastLobby();
      }
    } else {
      // Keep the seat: the player can reconnect with the same name
      players[idx].socket = null;
      players[idx].disconnected = true;
      emitEvent({ name: 'left', player: idx });
      pushState();
    }
    if (players.every((p) => p.disconnected || !p.socket)) emptySince = Date.now();
  }

  function lobbyMsg(you) {
    return { t: 'lobby', players: players.map((x) => x.name), you };
  }

  function broadcastLobby() {
    players.forEach((p, i) => {
      if (p.socket) p.socket.emit('lobby', lobbyMsg(i));
    });
  }

  /* ---------- state redaction ---------- */
  function isVisible(viewer, owner, cardIdx) {
    const st = S();
    if (st.phase === 'roundEnd' || st.phase === 'gameOver') return true;
    if (st.phase === 'peek' && viewer === owner && st.players[owner].peeked.has(cardIdx)) return true;
    return reveals.some((r) =>
      r.player === owner && r.card === cardIdx &&
      (r.viewers === 'all' || r.viewers.includes(viewer))
    );
  }

  function snapshotFor(viewer) {
    const st = S();
    return {
      t: 'state',
      phase: st.phase,
      round: st.round,
      current: st.current,
      you: viewer,
      players: st.players.map((p, idx) => ({
        name: p.name,
        stars: p.stars,
        ready: p.ready,
        disconnected: players[idx] ? !!players[idx].disconnected : false,
        peeked: viewer === idx ? p.peeked.size : undefined,
        hand: p.hand.map((card, i) => (isVisible(viewer, idx, i) ? card : null)),
      })),
      deckCount: st.deck.length,
      discardTop: game.discardTop(),
      fresh: st.fresh,
      burnTarget: st.burnTarget,
      eliminatedCount: st.eliminated.length,
      eliminatedTop: st.eliminated[st.eliminated.length - 1] || null,
      drawn: st.drawn ? (viewer === st.current ? st.drawn : true) : null,
      ctx: {
        burner: st.ctx.burner,
        drawnFrom: st.ctx.drawnFrom,
        combinePicks: viewer === st.current ? st.ctx.combinePicks : undefined,
        swapOwn: viewer === st.current ? st.ctx.swapOwn : undefined,
      },
      roundResult: st.roundResult,
      gameOver: st.gameOver,
    };
  }

  function pushState() {
    players.forEach((p, i) => {
      if (p.socket) p.socket.emit('state', snapshotFor(i));
    });
  }

  // Send an event to everyone ('all') or a single player index
  function emitEvent(data, to = 'all') {
    const msg = { t: 'event', ...data };
    players.forEach((p, i) => {
      if (to !== 'all' && i !== to) return;
      if (p.socket) p.socket.emit('event', msg);
    });
  }

  function addReveal(player, card, viewers, ms) {
    const r = { player, card, viewers };
    reveals.push(r);
    pushState();
    setTimeout(() => {
      reveals = reveals.filter((x) => x !== r);
      pushState();
    }, ms);
  }

  // Reveal without broadcasting yet (a pushState follows immediately)
  function addRevealQuiet(player, card) {
    reveals.push({ player, card, viewers: 'all' });
  }

  function scheduleRevealClear(ms) {
    setTimeout(() => {
      reveals = reveals.filter((r) => r.viewers !== 'all');
      pushState();
    }, ms);
  }

  function maybeRoundEnd(result) {
    if (result) roundEndFlow();
  }

  function roundEndFlow() {
    reveals = [];
    pushState(); // phase is roundEnd/gameOver → snapshots reveal everything
    emitEvent({ name: 'roundEnd', reason: S().roundResult.reason });
  }

  /* ---------- actions ---------- */
  function handleAction(from, msg) {
    const st = S();
    const isCurrent = from === st.current;

    switch (msg.a) {
      case 'begin': {
        if (from !== 0 || started || players.length < 2) break;
        started = true;
        game.setup(players.map((p) => p.name));
        reveals = [];
        pushState();
        emitEvent({ name: 'deal' });
        break;
      }
      case 'peek': {
        if (game.peekCard(from, msg.i)) {
          pushState();
          emitEvent({ name: 'flip' }, from);
        }
        break;
      }
      case 'ready': {
        const r = game.setReady(from);
        if (!r) break;
        pushState();
        if (r === 'allReady') emitEvent({ name: 'start' });
        break;
      }
      case 'draw': {
        if (!isCurrent) break;
        const res = game.drawFromDeck();
        if (!res) break;
        if (!res.rank) { roundEndFlow(); break; } // deck exhausted
        pushState();
        emitEvent({ name: 'draw', player: from });
        break;
      }
      case 'takeDiscard': {
        if (!isCurrent) break;
        if (!game.takeDiscard()) break;
        pushState();
        emitEvent({ name: 'tookDiscard', player: from });
        break;
      }
      case 'swap': {
        if (!isCurrent || (st.phase !== 'drawn' && st.phase !== 'swapDiscard')) break;
        const res = game.swapWithDrawn(msg.i);
        if (!res) break;
        pushState();
        emitEvent({ name: 'discard', player: from });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'discardDrawn': {
        if (!isCurrent) break;
        const res = game.discardDrawn();
        if (!res) break;
        pushState();
        emitEvent({ name: 'discard', player: from });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'usePower': {
        if (!isCurrent) break;
        const rank = game.usePower();
        if (!rank) break;
        pushState();
        emitEvent({ name: 'power', player: from, rank });
        break;
      }
      case 'powerTarget': {
        if (!isCurrent) break;
        const actor = st.current;
        const res = game.powerTarget(msg.p, msg.i);
        if (!res) break;
        if (res.type === 'pickedOwn') { pushState(); break; }
        if (res.type === 'blindSwap') {
          pushState();
          emitEvent({ name: 'blindSwap', player: actor, target: res.player });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // peekOwn / peekOther: only the power user sees the card
        addReveal(res.player, res.card, [actor], 2500);
        emitEvent({ name: 'flip' }, actor);
        emitEvent({ name: 'peeked', player: actor, target: res.player });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'combineStart': {
        if (!isCurrent) break;
        if (game.startCombine()) pushState();
        break;
      }
      case 'combinePick': {
        if (!isCurrent) break;
        const actor = st.current;
        const res = game.combinePick(msg.i);
        if (!res) break;
        if (res.type === 'picked') { pushState(); break; }
        if (res.type === 'combineOk') {
          pushState();
          emitEvent({ name: 'combineOk', player: actor, cards: res.cards });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // combineFail: everyone sees the two wrong cards for a moment
        res.revealed.forEach((i) => addRevealQuiet(actor, i));
        pushState();
        emitEvent({ name: 'combineFail', player: actor, cards: res.cards });
        scheduleRevealClear(2200);
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'cancel': {
        const allowed = st.phase === 'burn' ? from === st.ctx.burner : isCurrent;
        if (allowed && game.cancelSelect()) pushState();
        break;
      }
      case 'burnStart': {
        if (game.startBurn(from)) pushState();
        break;
      }
      case 'burnPick': {
        if (st.phase !== 'burn' || from !== st.ctx.burner) break;
        const res = game.burnPick(msg.i);
        if (!res) break;
        if (res.type === 'burnOk') {
          pushState();
          emitEvent({ name: 'burnOk', player: from, card: res.card });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // burnFail: everyone sees the failed card briefly
        addRevealQuiet(from, msg.i);
        pushState();
        emitEvent({ name: 'burnFail', player: from, card: res.card });
        scheduleRevealClear(2200);
        break;
      }
      case 'mateo': {
        if (!isCurrent || st.phase !== 'turn') break;
        const res = game.declareMateo();
        if (!res) break;
        if (res.type === 'mateoWin') { roundEndFlow(); break; }
        // Failed or tied call: the round continues; hands stay hidden so the
        // memory game survives — everyone learns the card COUNTS only
        pushState();
        emitEvent({ name: res.type, player: from, counts: res.counts, stars: res.stars });
        break;
      }
      case 'nextRound': {
        if (from !== 0) break;
        if (game.nextRound()) {
          reveals = [];
          pushState();
          emitEvent({ name: 'deal' });
        }
        break;
      }
      case 'newGame': {
        if (from !== 0 || st.phase !== 'gameOver') break;
        game.setup(players.map((p) => p.name));
        reveals = [];
        pushState();
        emitEvent({ name: 'deal' });
        break;
      }
    }
  }

  return {
    code,
    addPlayer,
    dropBySocket,
    handleAction,
    get playerCount() { return players.length; },
    get abandoned() {
      return players.length === 0 ||
        (emptySince !== null && players.every((p) => p.disconnected));
    },
    get emptySince() { return emptySince; },
  };
}

module.exports = { createRoom };
