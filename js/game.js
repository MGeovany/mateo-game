/* ============ Mateo game state machine ============
 * Phases:
 *  lobby | peek | turn | drawn | swapDiscard | combine
 *  power7 | power8 | power9a | power9b | burn | roundEnd | gameOver
 *
 * Scoring: a round is won only by a correct Mateo call (or by running out
 * of cards). The winner earns 1 star; first player to reach 3 stars wins
 * the game. A failed Mateo call loses 1 star and the round continues.
 */
const Game = (() => {
  const PEEK_LIMIT = 2;
  const WIN_STARS = 3;

  const state = {
    phase: 'lobby',
    round: 1,
    players: [],          // { name, hand: [card], stars, ready, peeked: Set }
    deck: [],
    discard: [],          // top = last element
    eliminated: [],       // burned cards: out of the game, never reshuffled
    fresh: null,          // the freshly discarded card — the ONLY card that can
                          // be taken (by the next player) or burned (by anyone);
                          // a successful burn eliminates it
    current: 0,
    startingPlayer: 0,
    drawn: null,          // card held after drawing
    ctx: {},              // transient selection context (burn / combine / power 9)
    roundResult: null,    // { reason, caller, rows: [{name, stars}] }
    gameOver: null,       // { winner }
  };

  function setup(names) {
    state.players = names.map((name) => ({
      name, hand: [], stars: 0, ready: false, peeked: new Set(),
    }));
    state.round = 1;
    state.startingPlayer = 0;
    state.gameOver = null;
    dealRound();
  }

  function dealRound() {
    state.deck = shuffle(buildDeck());
    state.discard = [];
    state.eliminated = [];
    state.fresh = null;
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
      // Reshuffle the discard pile under its top card; eliminated cards
      // stay out of the game permanently
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

  // Place a card face up on the pile as the new takeable/burnable discard
  function discardFresh(card) {
    state.discard.push(card);
    state.fresh = card;
  }

  /* ---------- turn actions ---------- */
  function drawFromDeck() {
    if (state.phase !== 'turn') return null;
    const card = drawCard();
    if (!card) return endRoundNoWinner();
    state.drawn = card;
    state.ctx.drawnFrom = 'deck';
    state.phase = 'drawn';
    return card;
  }

  // Only the player right after the discarder may take the fresh discard
  function takeDiscard() {
    if (state.phase !== 'turn' || !state.fresh) return null;
    state.drawn = state.discard.pop();
    state.fresh = null;
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
    discardFresh(replaced);
    state.drawn = null;
    return { replaced, roundWin: endTurn() };
  }

  // Discard the drawn card without keeping it
  function discardDrawn() {
    if (state.phase !== 'drawn') return null;
    const card = state.drawn;
    discardFresh(card);
    state.drawn = null;
    return { card, roundWin: endTurn() };
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
      return { type: 'peekOwn', player: playerIdx, card: cardIdx, roundWin: endTurn() };
    }
    if (state.phase === 'power8') {
      if (playerIdx === me) return null;
      finishPower();
      return { type: 'peekOther', player: playerIdx, card: cardIdx, roundWin: endTurn() };
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
      return { type: 'blindSwap', player: playerIdx, card: cardIdx, roundWin: endTurn() };
    }
    return null;
  }

  function finishPower() {
    discardFresh(state.drawn);
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
      // All three cards hit the pile; the drawn one stays fresh on top
      const drawn = state.drawn;
      p.hand = p.hand.filter((_, i) => !picks.includes(i));
      state.discard.push(a, b);
      discardFresh(drawn);
      state.drawn = null;
      state.ctx.combinePicks = [];
      return { type: 'combineOk', revealed, cards: [a, b], roundWin: endTurn() };
    }
    // Failed: cards stay, drawn card is lost to the pile, +1 penalty card
    discardFresh(state.drawn);
    state.drawn = null;
    state.ctx.combinePicks = [];
    const penalty = drawCard();
    if (penalty) p.hand.push(penalty);
    return { type: 'combineFail', revealed, cards: [a, b], roundWin: endTurn() };
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

  /* ---------- burn ----------
   * Anyone may burn the fresh discard with a same-rank card. The phase lock
   * means only the first claimer gets the attempt. A successful burn
   * eliminates both cards and kills the next player's right to take it.
   */
  function startBurn(playerIdx) {
    if (state.phase !== 'turn' || !state.fresh) return false;
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
    const target = state.fresh;
    delete state.ctx.burner;
    state.phase = 'turn';

    if (card.rank === target.rank) {
      p.hand.splice(cardIdx, 1);
      state.discard.pop(); // the fresh card is always on top
      state.eliminated.push(target, card);
      state.fresh = null;
      if (p.hand.length === 0) {
        return { type: 'burnOk', burner, card, roundWin: roundWin(burner) };
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
    if (p.hand.length === 0) return roundWin(state.current);
    state.current = (state.current + 1) % state.players.length;
    state.phase = 'turn';
    return null;
  }

  /* Mateo: compare hand COUNTS. Strictly fewest → win the round (+1 star).
   * Tie for fewest → nothing happens. More than someone → lose 1 star.
   * On fail/tie the round continues and the call consumes the turn. */
  function declareMateo() {
    if (state.phase !== 'turn') return null;
    const caller = state.current;
    const counts = state.players.map((p) => p.hand.length);
    const minOthers = Math.min(...counts.filter((_, i) => i !== caller));

    if (counts[caller] < minOthers) {
      return { type: 'mateoWin', caller, counts, roundWin: roundWin(caller) };
    }
    const tie = counts[caller] === minOthers;
    if (!tie && state.players[caller].stars > 0) state.players[caller].stars--;
    state.current = (state.current + 1) % state.players.length;
    state.phase = 'turn';
    return {
      type: tie ? 'mateoTie' : 'mateoFail',
      caller, counts,
      stars: state.players[caller].stars,
    };
  }

  function roundWin(winnerIdx) {
    const p = state.players[winnerIdx];
    p.stars += 1;
    state.roundResult = {
      reason: 'mateo',
      caller: winnerIdx,
      rows: state.players.map((pl) => ({ name: pl.name, stars: pl.stars })),
    };
    if (p.stars >= WIN_STARS) {
      state.gameOver = { winner: p.name };
      state.phase = 'gameOver';
    } else {
      state.phase = 'roundEnd';
    }
    return state.roundResult;
  }

  // Deck and discard exhausted: nobody earns a star, deal the next round
  function endRoundNoWinner() {
    state.roundResult = {
      reason: 'deck',
      caller: null,
      rows: state.players.map((pl) => ({ name: pl.name, stars: pl.stars })),
    };
    state.phase = 'roundEnd';
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
    currentPlayer, discardTop,
  };
})();
