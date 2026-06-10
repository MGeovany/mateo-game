/* ============ Deck and card helpers ============ */
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

// Q♥ is the absolute wildcard: worth 0 points
function cardValue(card) {
  if (card.rank === 'Q' && card.suit === '♥') return 0;
  const idx = RANKS.indexOf(card.rank);
  return idx + 1; // A=1 ... 10=10, J=11, Q=12, K=13
}

function isRedSuit(suit) {
  return suit === '♥' || suit === '♦';
}

function sameRank(a, b) {
  return a && b && a.rank === b.rank;
}

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}
