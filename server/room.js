/* ============ Room controller: validates actions, redacts state ============
 * Server-side port of the old browser host. One room per code; player 0
 * (the creator) controls begin/next-round. Each client receives a snapshot
 * where card faces are stripped unless that viewer may see them.
 */
const { createGame } = require('./game');
const Bot = require('./bot');

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function createRoom(code) {
  const game = createGame();
  const S = () => game.state;
  const players = []; // { name, socket | null, disconnected, isBot?, brain? }
  let started = false;
  let reveals = []; // temporary visibility: { player, card, viewers: 'all' | [idx] }
  let emptySince = null; // timestamp when the last connected player left
  let botTimer = null;       // at most one pending bot action at a time
  let lastBurnTarget = null; // detects a new burn target (resets per-bot guards)

  /* ---------- membership ---------- */
  // Cosmetics arrive from the client; cap lengths so nobody injects junk
  function cleanCosmetics(c) {
    c = c || {};
    return {
      avatar: String(c.avatar || '🙂').slice(0, 16),
      dance: String(c.dance || '').slice(0, 4),
      table: String(c.table || 'table-default').slice(0, 20),
      cards: String(c.cards || 'cards-default').slice(0, 20),
    };
  }

  function addPlayer(name, socket, cosmetics) {
    const clean = (name || '').trim().slice(0, 10);
    if (started) {
      // Reconnection: a disconnected player may rejoin with the same name
      const idx = players.findIndex(
        (p) => p.disconnected && p.name.toLowerCase() === clean.toLowerCase()
      );
      if (idx !== -1) {
        players[idx].socket = socket;
        players[idx].disconnected = false;
        players[idx].cosmetics = cleanCosmetics(cosmetics);
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
    players.push({
      name: clean || `Jugador ${players.length + 1}`,
      socket,
      disconnected: false,
      cosmetics: cleanCosmetics(cosmetics),
      lastDance: 0,
    });
    broadcastLobby();
    return { idx: players.length - 1 };
  }

  // CPU opponents: seats with no socket. Everything is unlocked for them, so
  // each gets a random cosmetic set. Names are unique within the room.
  function addBots(count, difficulty) {
    const diff = ['facil', 'medio', 'dificil'].includes(difficulty) ? difficulty : 'medio';
    const used = new Set(players.map((p) => p.name.toLowerCase()));
    for (let n = 0; n < count && players.length < 4; n++) {
      let name;
      do { name = Bot.randomName(); } while (used.has(name.toLowerCase()));
      used.add(name.toLowerCase());
      players.push({
        name,
        socket: null,
        disconnected: false,
        isBot: true,
        difficulty: diff,
        brain: Bot.createBrain(diff),
        cosmetics: cleanCosmetics(Bot.randomCosmetics()),
        lastDance: 0,
        burnTried: false,
      });
    }
    broadcastLobby();
  }

  function isBot(idx) { return !!(players[idx] && players[idx].isBot); }

  // The host's (player 0) table + card style dress the whole room
  function roomStyle() {
    const host = players[0];
    return {
      table: host ? host.cosmetics.table : 'table-default',
      cards: host ? host.cosmetics.cards : 'cards-default',
    };
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
    // Only humans keep a room alive; a room of just bots is abandoned
    const humans = players.filter((p) => !p.isBot);
    if (humans.length && humans.every((p) => p.disconnected || !p.socket)) emptySince = Date.now();
  }

  function lobbyMsg(you) {
    return {
      t: 'lobby',
      players: players.map((x) => x.name),
      avatars: players.map((x) => x.cosmetics.avatar),
      style: roomStyle(),
      you,
    };
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
      style: roomStyle(),
      players: st.players.map((p, idx) => ({
        name: p.name,
        score: p.score,
        ready: p.ready,
        avatar: players[idx] ? players[idx].cosmetics.avatar : '🙂',
        cards: players[idx] ? players[idx].cosmetics.cards : 'cards-default',
        disconnected: players[idx] ? !!players[idx].disconnected : false,
        peeked: viewer === idx ? p.peeked.size : undefined,
        // 'empty' = a burned/combined hole (render a gap); null = a face-down
        // card; an object = a card whose face this viewer is allowed to see
        hand: p.hand.map((card, i) =>
          (card === null ? 'empty' : (isVisible(viewer, idx, i) ? card : null))),
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
    scheduleBotTick();
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

  /* ---------- bot memory ---------- */
  // Every bot learns/forgets a card slot. Public reveals update all bots; a
  // private draw updates only the actor.
  function botForgetAll(owner, idx) {
    players.forEach((p) => { if (p.isBot) p.brain.forget(owner, idx); });
  }
  function botNoteAll(owner, idx, card) {
    players.forEach((p) => { if (p.isBot) p.brain.note(owner, idx, card); });
  }
  function botNoteOne(botIdx, owner, idx, card) {
    const p = players[botIdx];
    if (p && p.isBot) p.brain.note(owner, idx, card);
  }

  /* ---------- bot scheduler ----------
   * One pending bot action at a time, re-derived from live state when its
   * timer fires (the world may have changed while it "thought"). Every
   * pushState reschedules, so the fleet keeps moving until it's a human's turn.
   */
  function scheduleBotTick() {
    if (botTimer) { clearTimeout(botTimer); botTimer = null; }
    if (!started) return;
    const st = S();
    if (['lobby', 'roundEnd', 'gameOver'].includes(st.phase)) return;
    if (!players.some((p) => p.isBot)) return;

    // A fresh burn target clears the per-bot "already tried" guards
    if (st.burnTarget !== lastBurnTarget) {
      lastBurnTarget = st.burnTarget;
      players.forEach((p) => { if (p.isBot) p.burnTried = false; });
    }

    const job = pickBotJob(st);
    if (!job) return;
    botTimer = setTimeout(() => { botTimer = null; runBotJob(job); }, job.delay);
  }

  function pickBotJob(st) {
    // 1) Anyone (even off-turn) may race to burn a fresh discard
    if (st.phase === 'turn' && st.burnTarget) {
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p.isBot || p.burnTried) continue;
        if (Bot.wantsBurn(p.brain, st, i) >= 0 && Math.random() < p.brain.cfg.burnChance) {
          return { bot: i, kind: 'burnStart', delay: p.brain.reactDelay() };
        }
      }
    }
    // 2) A bot that claimed a burn picks the card to burn
    if (st.phase === 'burn' && isBot(st.ctx.burner)) {
      return { bot: st.ctx.burner, kind: 'decide', delay: rint(300, 600) };
    }
    // 3) The current player is a bot, mid-turn
    if (isBot(st.current) && !['peek', 'burn'].includes(st.phase)) {
      return { bot: st.current, kind: 'decide', delay: players[st.current].brain.thinkDelay() };
    }
    // 4) Peek phase: any bot still flipping its starting cards. Bot peeks are
    // private (invisible to the human), so they can be quick.
    if (st.phase === 'peek') {
      for (let i = 0; i < players.length; i++) {
        if (isBot(i) && !st.players[i].ready) return { bot: i, kind: 'decide', delay: rint(150, 400) };
      }
    }
    return null;
  }

  function runBotJob(job) {
    if (!started) return;
    const st = S();
    const p = players[job.bot];
    if (!p || !p.isBot || ['lobby', 'roundEnd', 'gameOver'].includes(st.phase)) {
      scheduleBotTick();
      return;
    }

    let action = null;
    if (job.kind === 'burnStart') {
      if (st.phase === 'turn' && Bot.wantsBurn(p.brain, st, job.bot) >= 0) {
        p.burnTried = true; // one attempt per target, win or lose
        action = { a: 'burnStart' };
      }
    } else {
      action = Bot.decide(p.brain, st, job.bot);
    }

    if (action) handleAction(job.bot, action);
    maybeBotDance(job.bot);
    scheduleBotTick(); // keep the fleet moving even if the action was a no-op
  }

  // Bots taunt the table with their dance now and then (the action enforces
  // an 8s cooldown, so this can't spam).
  function maybeBotDance(botIdx) {
    const st = S();
    if (['peek', 'lobby', 'roundEnd', 'gameOver'].includes(st.phase)) return;
    const p = players[botIdx];
    if (!p || !p.isBot || !p.cosmetics.dance) return;
    if (Math.random() < p.brain.cfg.danceChance) handleAction(botIdx, { a: 'dance' });
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
          // A bot remembers the card it just peeked at
          botNoteOne(from, from, msg.i, st.players[from].hand[msg.i]);
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
        const drawnCard = st.drawn;
        const fromDiscard = st.ctx.drawnFrom === 'discard';
        const res = game.swapWithDrawn(msg.i);
        if (!res) break;
        // The slot now holds the drawn card. A discard take is public (everyone
        // saw it); a deck draw is private to the actor.
        botForgetAll(from, msg.i);
        if (fromDiscard) botNoteAll(from, msg.i, drawnCard);
        else botNoteOne(from, from, msg.i, drawnCard);
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
        // Capture the card we're about to give away (power 9 blind swap)
        const pre9 = st.phase === 'power9b'
          ? { ownIdx: st.ctx.swapOwn, myCard: st.players[actor].hand[st.ctx.swapOwn] }
          : null;
        const res = game.powerTarget(msg.p, msg.i);
        if (!res) break;
        if (res.type === 'pickedOwn') { pushState(); break; }
        if (res.type === 'blindSwap') {
          // We gave our card to the target's slot; our own slot is now a blind
          // unknown. Everyone forgets both slots; the actor knows what it placed.
          botForgetAll(actor, pre9.ownIdx);
          botForgetAll(res.player, res.card);
          if (pre9.myCard) botNoteOne(actor, res.player, res.card, pre9.myCard);
          pushState();
          emitEvent({ name: 'blindSwap', player: actor, target: res.player });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // peekOwn / peekOther: only the power user sees the card — and remembers it
        if (res.type === 'peekOwn') botNoteOne(actor, actor, res.card, st.players[actor].hand[res.card]);
        else botNoteOne(actor, res.player, res.card, st.players[res.player].hand[res.card]);
        // Linger longer so the peeker can clearly read and memorize the card
        addReveal(res.player, res.card, [actor], 4000);
        emitEvent({ name: 'flip' }, actor);
        emitEvent({
          name: 'peeked', player: actor, target: res.player,
          card: res.card, own: res.type === 'peekOwn',
        });
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
          res.revealed.forEach((i) => botForgetAll(actor, i)); // those slots are now holes
          pushState();
          emitEvent({ name: 'combineOk', player: actor, cards: res.cards });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // combineFail: everyone sees the two wrong cards for a moment (and learns them)
        res.revealed.forEach((i) => botNoteAll(actor, i, st.players[actor].hand[i]));
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
          botForgetAll(from, msg.i); // the burned slot is now a hole
          pushState();
          emitEvent({ name: 'burnOk', player: from, card: res.card });
          maybeRoundEnd(res.roundWin);
          break;
        }
        // burnFail: everyone sees the failed card briefly (and learns it)
        botNoteAll(from, msg.i, st.players[from].hand[msg.i]);
        addRevealQuiet(from, msg.i);
        pushState();
        emitEvent({ name: 'burnFail', player: from, card: res.card });
        scheduleRevealClear(2200);
        break;
      }
      case 'dance': {
        // Taunt: broadcast the player's equipped dance. 8s cooldown so
        // nobody floods the table with emojis.
        const p = players[from];
        if (!started || !p || !p.cosmetics.dance) break;
        const now = Date.now();
        if (now - p.lastDance < 8000) break;
        p.lastDance = now;
        emitEvent({ name: 'dance', player: from, emoji: p.cosmetics.dance });
        break;
      }
      case 'mateo': {
        if (!isCurrent || st.phase !== 'turn') break;
        const res = game.declareMateo();
        if (!res) break;
        // Calling Mateo always ends the round — even on a tie. Scoring (win = 0,
        // failed call = card value + penalty) is settled in the engine.
        emitEvent({ name: 'mateoCall', player: from, won: res.callerWon });
        roundEndFlow();
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
    addBots,
    dropBySocket,
    handleAction,
    get playerCount() { return players.length; },
    get humanCount() { return players.filter((p) => !p.isBot).length; },
    get abandoned() {
      const humans = players.filter((p) => !p.isBot);
      return players.length === 0 ||
        (humans.length > 0 && emptySince !== null && humans.every((p) => p.disconnected));
    },
    get emptySince() { return emptySince; },
  };
}

module.exports = { createRoom };
