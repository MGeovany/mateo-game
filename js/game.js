/* ============ Mateo game state machine ============
 * Phases:
 *  lobby | peek | turn | drawn | swapDiscard | combine
 *  power7 | power8 | power9a | power9b | burn | roundEnd | gameOver
 */
const Game = (() => {
  const PEEK_LIMIT = 2;
  const MATEO_PENALTY = 15;
  const LOSE_SCORE = 100;

  const state = {
    phase: 'lobby',
    round: 1,
    players: [],          // { name, hand: [card], score, ready, peeked: Set }
    deck: [],
    discard: [],          // top = last element
    current: 0,
    startingPlayer: 0,
    drawn: null,          // card held after drawing
    ctx: {},              // transient selection context (burn / combine / power 9)
    roundResult: null,    // { reason, caller, success, rows: [{name, roundScore, total}] }
    gameOver: null,       // { winner, loser }
  };

  function setup(names) {
    state.players = names.map((name) => ({
      name, hand: [], score: 0, ready: false, peeked: new Set(),
    }));
    state.round = 1;
    state.startingPlayer = 0;
    state.gameOver = null;
    dealRound();
  }

  function dealRound() {
    state.deck = shuffle(buildDeck());
    state.discard = [];
    state.drawn = null;
    state.ctx = {};
    state.roundResult = null;
    state.current = state.startingPlayer;
    for (const p of state.players) {
      p.hand = state.deck.splice(0, 4);
      p.ready = false;
      p.peeked = new Set();
    }
    state.phase = 'peek';
  }

  /* ---------- peek phase ---------- */
  function peekCard(playerIdx, cardIdx) {
    const p = state.players[playerIdx];
    if (state.phase !== 'peek' || p.ready) return false;
    if (p.peeked.has(cardIdx)) return false;
    if (p.peeked.size >= PEEK_LIMIT) return false;
    p.peeked.add(cardIdx);
    return true;
  }

  function setReady(playerIdx) {
    const p = state.players[playerIdx];
    if (state.phase !== 'peek' || p.ready) return false;
    p.ready = true;
    p.peeked = new Set();
    if (state.players.every((pl) => pl.ready)) {
      state.phase = 'turn';
      return 'allReady';
    }
    return true;
  }

  /* ---------- deck helpers ---------- */
  function drawCard() {
    if (state.deck.length === 0) {
      // Reshuffle everything under the top discard back into the deck
      if (state.discard.length <= 1) return null;
      const top = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [top];
    }
    return state.deck.pop();
  }

  function currentPlayer() {
    return state.players[state.current];
  }

  function discardTop() {
    return state.discard[state.discard.length - 1] || null;
  }

  /* ---------- turn actions ---------- */
  function drawFromDeck() {
    if (state.phase !== 'turn') return null;
    const card = drawCard();
    if (!card) return endRound('deck');
    state.drawn = card;
    state.ctx.drawnFrom = 'deck';
    state.phase = 'drawn';
    return card;
  }

  function takeDiscard() {
    if (state.phase !== 'turn' || !discardTop()) return null;
    state.drawn = state.discard.pop();
    state.ctx.drawnFrom = 'discard';
    state.phase = 'swapDiscard';
    return state.drawn;
  }

  // Swap the held card with one of the current player's cards
  function swapWithDrawn(cardIdx) {
    if (state.phase !== 'drawn' && state.phase !== 'swapDiscard') return null;
    const p = currentPlayer();
    const replaced = p.hand[cardIdx];
    p.hand[cardIdx] = state.drawn;
    state.discard.push(replaced);
    state.drawn = null;
    return { replaced, endTurn: endTurn() };
  }

  // Discard the drawn card without keeping it (only when drawn from deck)
  function discardDrawn() {
    if (state.phase !== 'drawn') return null;
    const card = state.drawn;
    state.discard.push(card);
    state.drawn = null;
    return { card, endTurn: endTurn() };
  }

  /* ---------- special powers (7 / 8 / 9) ---------- */
  function canUsePower() {
    return state.phase === 'drawn' && ['7', '8', '9'].includes(state.drawn.rank);
  }

  function usePower() {
    if (!canUsePower()) return null;
    const rank = state.drawn.rank;
    state.phase = rank === '7' ? 'power7' : rank === '8' ? 'power8' : 'power9a';
    return rank;
  }

  // Returns an action descriptor for the UI (reveal / swap animations)
  function powerTarget(playerIdx, cardIdx) {
    const me = state.current;
    if (state.phase === 'power7') {
      if (playerIdx !== me) return null;
      finishPower();
      return { type: 'peekOwn', player: playerIdx, card: cardIdx, endTurn: endTurn() };
    }
    if (state.phase === 'power8') {
      if (playerIdx === me) return null;
      finishPower();
      return { type: 'peekOther', player: playerIdx, card: cardIdx, endTurn: endTurn() };
    }
    if (state.phase === 'power9a') {
      if (playerIdx !== me) return null;
      state.ctx.swapOwn = cardIdx;
      state.phase = 'power9b';
      return { type: 'pickedOwn' };
    }
    if (state.phase === 'power9b') {
      if (playerIdx === me) return null;
      const mine = state.players[me].hand[state.ctx.swapOwn];
      state.players[me].hand[state.ctx.swapOwn] = state.players[playerIdx].hand[cardIdx];
      state.players[playerIdx].hand[cardIdx] = mine;
      finishPower();
      return { type: 'blindSwap', player: playerIdx, card: cardIdx, endTurn: endTurn() };
    }
    return null;
  }

  function finishPower() {
    state.discard.push(state.drawn);
    state.drawn = null;
    delete state.ctx.swapOwn;
  }

  /* ---------- combine (drop a trio) ---------- */
  function startCombine() {
    if (state.phase !== 'drawn') return false;
    state.phase = 'combine';
    state.ctx.combinePicks = [];
    return true;
  }

  function combinePick(cardIdx) {
    if (state.phase !== 'combine') return null;
    const picks = state.ctx.combinePicks;
    if (picks.includes(cardIdx)) return null;
    picks.push(cardIdx);
    if (picks.length < 2) return { type: 'picked' };

    const p = currentPlayer();
    const [a, b] = picks.map((i) => p.hand[i]);
    const success = a.rank === state.drawn.rank && b.rank === state.drawn.rank;
    const revealed = [...picks];
    if (success) {
      // All three cards leave play, drawn card on top of the pile
      p.hand = p.hand.filter((_, i) => !picks.includes(i));
      state.discard.push(a, b, state.drawn);
      state.drawn = null;
      state.ctx.combinePicks = [];
      if (p.hand.length === 0) {
        return { type: 'combineOk', revealed, cards: [a, b], roundEnd: endRound('empty', state.current) };
      }
      return { type: 'combineOk', revealed, cards: [a, b], endTurn: endTurn() };
    }
    // Failed: cards stay, drawn card is lost to the pile, +1 penalty card
    state.discard.push(state.drawn);
    state.drawn = null;
    state.ctx.combinePicks = [];
    const penalty = drawCard();
    if (penalty) p.hand.push(penalty);
    return { type: 'combineFail', revealed, cards: [a, b], endTurn: endTurn() };
  }

  function cancelSelect() {
    if (['combine', 'power7', 'power8', 'power9a', 'power9b'].includes(state.phase)) {
      state.ctx.combinePicks = [];
      delete state.ctx.swapOwn;
      state.phase = 'drawn';
      return true;
    }
    if (state.phase === 'burn') {
      state.phase = 'turn';
      delete state.ctx.burner;
      return true;
    }
    return false;
  }

  /* ---------- burn ---------- */
  function startBurn(playerIdx) {
    if (state.phase !== 'turn' || !discardTop()) return false;
    if (state.players[playerIdx].hand.length === 0) return false;
    state.phase = 'burn';
    state.ctx.burner = playerIdx;
    return true;
  }

  function burnPick(cardIdx) {
    if (state.phase !== 'burn') return null;
    const burner = state.ctx.burner;
    const p = state.players[burner];
    const card = p.hand[cardIdx];
    const target = discardTop();
    delete state.ctx.burner;
    state.phase = 'turn';

    if (card.rank === target.rank) {
      p.hand.splice(cardIdx, 1);
      state.discard.push(card);
      if (p.hand.length === 0) {
        return { type: 'burnOk', burner, card, roundEnd: endRound('empty', burner) };
      }
      return { type: 'burnOk', burner, card };
    }
    // Failed: keep the card and draw a penalty card
    const penalty = drawCard();
    if (penalty) p.hand.push(penalty);
    return { type: 'burnFail', burner, card };
  }

  /* ---------- turn / round flow ---------- */
  function endTurn() {
    const p = currentPlayer();
    if (p.hand.length === 0) return endRound('empty', state.current);
    state.current = (state.current + 1) % state.players.length;
    state.phase = 'turn';
    return null;
  }

  function declareMateo() {
    if (state.phase !== 'turn') return null;
    return endRound('mateo', state.current);
  }

  function handValue(p) {
    return p.hand.reduce((sum, c) => sum + cardValue(c), 0);
  }

  function endRound(reason, actor = null) {
    let success = false;
    if (reason === 'mateo') {
      const caller = state.players[actor];
      const minOthers = Math.min(
        ...state.players.filter((_, i) => i !== actor).map((p) => p.hand.length)
      );
      success = caller.hand.length < minOthers;
    }
    const rows = state.players.map((p, i) => {
      let roundScore;
      if (reason === 'mateo' && i === actor) {
        roundScore = success ? 0 : MATEO_PENALTY + handValue(p);
      } else {
        roundScore = handValue(p);
      }
      p.score += roundScore;
      return { name: p.name, roundScore, total: p.score };
    });

    state.roundResult = { reason, caller: actor, success, rows };
    state.phase = 'roundEnd';

    if (state.players.some((p) => p.score >= LOSE_SCORE)) {
      const sorted = [...state.players].sort((a, b) => a.score - b.score);
      state.gameOver = { winner: sorted[0].name, loser: sorted[sorted.length - 1].name };
      state.phase = 'gameOver';
    }
    return state.roundResult;
  }

  function nextRound() {
    if (state.phase !== 'roundEnd') return false;
    state.round += 1;
    state.startingPlayer = (state.startingPlayer + 1) % state.players.length;
    dealRound();
    return true;
  }

  return {
    state, setup, peekCard, setReady,
    drawFromDeck, takeDiscard, swapWithDrawn, discardDrawn,
    canUsePower, usePower, powerTarget,
    startCombine, combinePick, cancelSelect,
    startBurn, burnPick,
    declareMateo, nextRound,
    currentPlayer, discardTop, handValue,
  };
})();
