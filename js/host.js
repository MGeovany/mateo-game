/* ============ Host controller: validates actions, redacts state ============
 * Only runs on the host's device. The host is always player 0.
 * Each client receives a snapshot where card faces are stripped unless
 * that specific viewer is allowed to see them.
 */
const Host = (() => {
  const lobby = []; // { name, conn } — conn null for the host itself
  let started = false;
  let reveals = []; // temporary visibility: { player, card, viewers: 'all' | [idx] }

  /* ---------- lobby ---------- */
  function initLobby(hostName) {
    lobby.length = 0;
    lobby.push({ name: hostName, conn: null });
    started = false;
  }

  function addGuest(name, conn) {
    const clean = (name || '').trim().slice(0, 10);
    if (started) {
      // Reconnection: a disconnected player may rejoin with the same name
      const idx = lobby.findIndex(
        (p) => p.disconnected && p.name.toLowerCase() === clean.toLowerCase()
      );
      if (idx !== -1) {
        lobby[idx].conn = conn;
        lobby[idx].disconnected = false;
        Net.sendTo(conn, { t: 'lobby', players: lobby.map((x) => x.name), you: idx });
        Net.sendTo(conn, snapshotFor(idx));
        emit({ name: 'rejoined', player: idx });
        return;
      }
      Net.sendTo(conn, { t: 'rejected', reason: 'started' });
      return;
    }
    if (lobby.length >= 4) {
      Net.sendTo(conn, { t: 'rejected', reason: 'full' });
      return;
    }
    lobby.push({ name: clean || `Jugador ${lobby.length + 1}`, conn });
    broadcastLobby();
  }

  function broadcastLobby() {
    lobby.forEach((p, i) => {
      const msg = { t: 'lobby', players: lobby.map((x) => x.name), you: i };
      if (p.conn) Net.sendTo(p.conn, msg);
      else UI.onLobby(msg);
    });
  }

  function dropGuest(conn) {
    const idx = lobby.findIndex((p) => p.conn === conn);
    if (idx === -1) return;
    if (!started) {
      lobby.splice(idx, 1);
      broadcastLobby();
    } else {
      // Keep the seat: the player can reconnect with the same name
      lobby[idx].conn = null;
      lobby[idx].disconnected = true;
      emit({ name: 'left', player: idx });
    }
  }

  function startGame() {
    if (started || lobby.length < 2) return;
    started = true;
    Game.setup(lobby.map((p) => p.name));
    reveals = [];
    pushState();
    emit({ name: 'deal' });
  }

  /* ---------- state redaction ---------- */
  function isVisible(viewer, owner, cardIdx) {
    const S = Game.state;
    if (S.phase === 'roundEnd' || S.phase === 'gameOver') return true;
    if (S.phase === 'peek' && viewer === owner && S.players[owner].peeked.has(cardIdx)) return true;
    return reveals.some((r) =>
      r.player === owner && r.card === cardIdx &&
      (r.viewers === 'all' || r.viewers.includes(viewer))
    );
  }

  function snapshotFor(viewer) {
    const S = Game.state;
    return {
      t: 'state',
      phase: S.phase,
      round: S.round,
      current: S.current,
      you: viewer,
      players: S.players.map((p, idx) => ({
        name: p.name,
        stars: p.stars,
        ready: p.ready,
        disconnected: lobby[idx] ? !!lobby[idx].disconnected : false,
        peeked: viewer === idx ? p.peeked.size : undefined,
        hand: p.hand.map((card, i) => (isVisible(viewer, idx, i) ? card : null)),
      })),
      deckCount: S.deck.length,
      discardTop: Game.discardTop(),
      fresh: S.fresh,
      eliminatedCount: S.eliminated.length,
      drawn: S.drawn ? (viewer === S.current ? S.drawn : true) : null,
      ctx: {
        burner: S.ctx.burner,
        drawnFrom: S.ctx.drawnFrom,
        combinePicks: viewer === S.current ? S.ctx.combinePicks : undefined,
        swapOwn: viewer === S.current ? S.ctx.swapOwn : undefined,
      },
      roundResult: S.roundResult,
      gameOver: S.gameOver,
    };
  }

  function pushState() {
    lobby.forEach((p, i) => {
      const snap = snapshotFor(i);
      if (p.conn) Net.sendTo(p.conn, snap);
      else UI.onState(snap);
    });
  }

  // Send an event to everyone ('all') or a single player index
  function emit(data, to = 'all') {
    const msg = { t: 'event', ...data };
    lobby.forEach((p, i) => {
      if (to !== 'all' && i !== to) return;
      if (p.conn) Net.sendTo(p.conn, msg);
      else UI.onEvent(msg);
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

  /* ---------- actions ---------- */
  function handleAction(from, msg) {
    const S = Game.state;
    const isCurrent = from === S.current;

    switch (msg.a) {
      case 'peek': {
        if (Game.peekCard(from, msg.i)) {
          pushState();
          emit({ name: 'flip' }, from);
        }
        break;
      }
      case 'ready': {
        const r = Game.setReady(from);
        if (!r) break;
        pushState();
        if (r === 'allReady') emit({ name: 'start' });
        break;
      }
      case 'draw': {
        if (!isCurrent) break;
        const res = Game.drawFromDeck();
        if (!res) break;
        if (!res.rank) { roundEndFlow(); break; } // deck exhausted
        pushState();
        emit({ name: 'draw', player: from });
        break;
      }
      case 'takeDiscard': {
        if (!isCurrent) break;
        if (!Game.takeDiscard()) break;
        pushState();
        emit({ name: 'tookDiscard', player: from });
        break;
      }
      case 'swap': {
        if (!isCurrent || (S.phase !== 'drawn' && S.phase !== 'swapDiscard')) break;
        const res = Game.swapWithDrawn(msg.i);
        if (!res) break;
        pushState();
        emit({ name: 'discard', player: from });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'discardDrawn': {
        if (!isCurrent) break;
        const res = Game.discardDrawn();
        if (!res) break;
        pushState();
        emit({ name: 'discard', player: from });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'usePower': {
        if (!isCurrent) break;
        const rank = Game.usePower();
        if (!rank) break;
        pushState();
        emit({ name: 'power', player: from, rank });
        break;
      }
      case 'powerTarget': {
        if (!isCurrent) break;
        const actor = S.current;
        const res = Game.powerTarget(msg.p, msg.i);
        if (!res) break;
        if (res.type === 'pickedOwn') { pushState(); break; }
        if (res.type === 'blindSwap') {
          pushState();
          emit({ name: 'blindSwap', player: actor, target: res.player });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // peekOwn / peekOther: only the power user sees the card
        addReveal(res.player, res.card, [actor], 2500);
        emit({ name: 'flip' }, actor);
        emit({ name: 'peeked', player: actor, target: res.player });
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'combineStart': {
        if (!isCurrent) break;
        if (Game.startCombine()) pushState();
        break;
      }
      case 'combinePick': {
        if (!isCurrent) break;
        const actor = S.current;
        const res = Game.combinePick(msg.i);
        if (!res) break;
        if (res.type === 'picked') { pushState(); break; }
        if (res.type === 'combineOk') {
          pushState();
          emit({ name: 'combineOk', player: actor, cards: res.cards });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // combineFail: everyone sees the two wrong cards for a moment
        res.revealed.forEach((i) => addRevealQuiet(actor, i));
        pushState();
        emit({ name: 'combineFail', player: actor, cards: res.cards });
        scheduleRevealClear(2200);
        maybeRoundEnd(res.roundWin);
        break;
      }
      case 'cancel': {
        const allowed = S.phase === 'burn' ? from === S.ctx.burner : isCurrent;
        if (allowed && Game.cancelSelect()) pushState();
        break;
      }
      case 'burnStart': {
        if (Game.startBurn(from)) pushState();
        break;
      }
      case 'burnPick': {
        if (S.phase !== 'burn' || from !== S.ctx.burner) break;
        const res = Game.burnPick(msg.i);
        if (!res) break;
        if (res.type === 'burnOk') {
          pushState();
          emit({ name: 'burnOk', player: from, card: res.card });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // burnFail: everyone sees the failed card briefly
        addRevealQuiet(from, msg.i);
        pushState();
        emit({ name: 'burnFail', player: from, card: res.card });
        scheduleRevealClear(2200);
        break;
      }
      case 'mateo': {
        if (!isCurrent || S.phase !== 'turn') break;
        const res = Game.declareMateo();
        if (!res) break;
        if (res.type === 'mateoWin') { roundEndFlow(); break; }
        // Failed or tied call: the round continues; hands stay hidden so the
        // memory game survives — everyone learns the card COUNTS only
        pushState();
        emit({ name: res.type, player: from, counts: res.counts, stars: res.stars });
        break;
      }
      case 'nextRound': {
        if (from !== 0) break;
        if (Game.nextRound()) {
          reveals = [];
          pushState();
          emit({ name: 'deal' });
        }
        break;
      }
      case 'newGame': {
        if (from !== 0 || S.phase !== 'gameOver') break;
        Game.setup(lobby.map((p) => p.name));
        reveals = [];
        pushState();
        emit({ name: 'deal' });
        break;
      }
    }
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
    emit({ name: 'roundEnd', reason: Game.state.roundResult.reason });
  }

  /* ---------- network wiring ---------- */
  Net.on('join', (msg, conn) => addGuest(msg.name, conn));
  Net.on('action', (msg, conn) => {
    const from = lobby.findIndex((p) => p.conn === conn);
    if (from >= 0) handleAction(from, msg);
  });
  Net.on('_disconnect', (_, conn) => dropGuest(conn));

  return { initLobby, broadcastLobby, startGame, handleAction, get playerCount() { return lobby.length; } };
})();
