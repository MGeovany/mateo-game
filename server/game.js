/* ============ Mateo game engine (server-side) ============
 * One instance per room: const game = createGame()
 * Ported from the original browser engine; the API is unchanged.
 */
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Point value of a card. Q♥ is the wildcard and worth 0.
function cardValue(card) {
  if (card.rank === 'Q' && card.suit === '♥') return 0;
  return RANKS.indexOf(card.rank) + 1; // A=1 ... 10=10, J=11, Q=12, K=13
}

function createGame() {
  const PEEK_LIMIT = 2;
  const LOSE_SCORE = 100; // whoever reaches this loses the game
  const MATEO_PENALTY = 15; // extra points for calling Mateo and not winning
  const EMPTY_BONUS = -10; // getting rid of every card

  const state = {
    phase: 'lobby',
    round: 1,
    players: [],          // { name, hand: [card], score, ready, peeked: Set }
    deck: [],
    discard: [],          // top = last element
    eliminated: [],       // burned cards: out of the game, never reshuffled
    fresh: null,          // the freshly discarded card — the only card the
                          // next player may TAKE; a successful burn removes it
    burnTarget: null,     // the card burns must match. Starts as the fresh
                          // discard; after a burn, the burner's card becomes
                          // the new target, so chains are possible (e.g. burn
                          // both of your Ks onto a discarded K). Any new
                          // discard resets it
    current: 0,
    startingPlayer: 0,
    drawn: null,          // card held after drawing
    ctx: {},              // transient selection context (burn / combine / power 9)
    roundResult: null,    // { reason, caller, callerWon, rows: [{name, points, sum, total}] }
    gameOver: null,       // { loser, winner }
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
    state.eliminated = [];
    state.fresh = null;
    state.burnTarget = null;
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
    state.burnTarget = card;
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

  // On your turn you may grab the top card of the discard pile (the center),
  // whether it is the freshly discarded card or an older one
  function takeDiscard() {
    if (state.phase !== 'turn' || state.discard.length === 0) return null;
    state.drawn = state.discard.pop();
    state.fresh = null;
    state.burnTarget = null; // the card left the table: nothing to burn against
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
   * Anyone may burn the current burn target with a same-rank card. The phase
   * lock means only the first claimer gets the attempt. A successful burn
   * eliminates both cards and clears the target: once a card has been burned,
   * nobody (not even the burner) can burn that card again. Only a new discard
   * creates a fresh burn target.
   */
  function startBurn(playerIdx) {
    if (state.phase !== 'turn' || !state.burnTarget) return false;
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
    const target = state.burnTarget;
    delete state.ctx.burner;
    state.phase = 'turn';

    if (card.rank === target.rank) {
      p.hand.splice(cardIdx, 1);
      // The freshly discarded card still sits on the pile: remove it
      if (discardTop() === target) state.discard.pop();
      if (!state.eliminated.includes(target)) state.eliminated.push(target);
      state.eliminated.push(card);
      state.fresh = null;
      state.burnTarget = null; // burned card is done — no further burns on it
      if (p.hand.length === 0) {
        return { type: 'burnOk', burner, card, roundWin: endRound('empty', burner) };
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

  /* Mateo: calling ALWAYS ends the round — there is no tie that lets play
   * continue. Scoring is handled in endRound: the caller wins (0 points) only
   * if they hold the strictly-lowest card value; otherwise they take their
   * card value plus a penalty. */
  function declareMateo() {
    if (state.phase !== 'turn') return null;
    return endRound('mateo', state.current);
  }

  /* Score everyone, accumulate totals, and decide whether the game is over.
   *   reason 'mateo'  → caller wins (0) if strictly lowest, else sum + 15
   *   empty hand      → -10 (got rid of every card)
   *   everyone else   → the sum of their card values
   * Whoever reaches LOSE_SCORE loses; the lowest total wins. */
  function endRound(reason, caller) {
    const sums = state.players.map((p) =>
      p.hand.reduce((s, c) => s + cardValue(c), 0));
    const minSum = Math.min(...sums);
    // The caller only "wins" if they are the sole, strictly-lowest hand
    const lowestCount = sums.filter((s) => s === minSum).length;
    const soleLowest = lowestCount === 1 ? sums.indexOf(minSum) : -1;
    const callerWon = reason === 'mateo' && caller === soleLowest;

    const rows = state.players.map((p, i) => {
      let points;
      if (p.hand.length === 0) {
        points = EMPTY_BONUS;
      } else if (reason === 'mateo' && i === caller) {
        points = callerWon ? 0 : sums[i] + MATEO_PENALTY;
      } else {
        points = sums[i];
      }
      p.score += points;
      return { name: p.name, points, sum: sums[i], total: p.score };
    });

    state.roundResult = { reason, caller, callerWon, rows };

    // Game over once anyone reaches the losing threshold
    const maxTotal = Math.max(...state.players.map((p) => p.score));
    if (maxTotal >= LOSE_SCORE) {
      let loser = 0, winner = 0;
      state.players.forEach((p, i) => {
        if (p.score > state.players[loser].score) loser = i;
        if (p.score < state.players[winner].score) winner = i;
      });
      state.gameOver = {
        loser: state.players[loser].name,
        winner: state.players[winner].name,
      };
      state.phase = 'gameOver';
    } else {
      state.phase = 'roundEnd';
    }
    return state.roundResult;
  }

  // Deck and discard exhausted: everyone simply banks their card values
  function endRoundNoWinner() {
    return endRound('deck', null);
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
}

module.exports = { createGame, buildDeck, shuffle, SUITS, RANKS };
