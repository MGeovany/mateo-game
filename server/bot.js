/* ============ CPU opponents (server-side bot brains) ============
 * A bot is just a seat with no socket. Each one carries a "brain": a private
 * memory of the cards it has legitimately seen (its own peeks, power reveals,
 * cards it drew) plus phase-by-phase decision logic. Difficulty scales how
 * good the memory is, how fast it reacts, and how sharp its choices are — so
 * a 'facil' bot forgets cards and fumbles, a 'dificil' one never forgets and
 * plays tight. Bots have every shop item unlocked, so each gets a random
 * cosmetic set, and they taunt the table with dances mid-game.
 */
const { RANKS } = require('./game');

function cardValue(card) {
  if (!card) return 0;
  if (card.rank === 'Q' && card.suit === '♥') return 0; // wildcard
  return RANKS.indexOf(card.rank) + 1;
}

const UNKNOWN_EST = 7; // expected value of a card the bot has never seen

const DIFFICULTY = {
  facil:   { memProb: 0.55, react: [1500, 2800], think: [1200, 2200], burnChance: 0.40, mateoMax: 4, mateoAllKnown: true,  takeMax: 3, powerChance: 0.40, mistake: 0.30, danceChance: 0.30 },
  medio:   { memProb: 0.85, react: [800, 1500],  think: [800, 1500],  burnChance: 0.80, mateoMax: 6, mateoAllKnown: true,  takeMax: 4, powerChance: 0.70, mistake: 0.12, danceChance: 0.22 },
  dificil: { memProb: 1.00, react: [350, 800],   think: [450, 950],   burnChance: 0.97, mateoMax: 9, mateoAllKnown: false, takeMax: 5, powerChance: 0.92, mistake: 0.00, danceChance: 0.18 },
};

// Computing / math / logic flavored names (no human names), each ≤10 chars
const NAMES = [
  'ALGOR', 'LAMBDA', 'BINARIO', 'NODO', 'KERNEL', 'VECTOR', 'MATRIX', 'BIT', 'BYTE', 'HASH',
  'LOGICA', 'DELTA', 'SIGMA', 'THETA', 'COSENO', 'TANGENTE', 'TENSOR', 'PIXEL', 'CACHE', 'BUCLE',
  'PRIMO', 'MODULO', 'DAEMON', 'REGEX', 'PIVOTE', 'HEAP', 'STACK', 'BOOLEANO', 'ENTROPIA', 'FRACTAL',
  'NEXO', 'QUANTUM', 'AXIOMA', 'TEOREMA', 'INTEGRAL', 'ASINTOTA', 'MANTISA', 'NIBBLE', 'SOCKET', 'PUNTERO',
  'RADIX', 'OCTETO', 'ESCALAR', 'GRAFO', 'ARBOL', 'SUFIJO', 'CIFRADO', 'COMPILA', 'NUCLEO', 'FLOTANTE',
];

const AVATARS = ['🤖', '👽', '🐸', '🐱', '🦊', '💀', '🤡', '👾'];
const HATS = ['', '🧢', '🎩', '🎓', '🪖', '👑'];
const FACES = ['', '😎', '😤', '🤪', '😈', '🥱'];
const SHOES = ['', '👟', '🥾', '👠', '👢'];
const DANCES = ['💃', '🕺', '🦆', '🐔', '🪩'];
const TABLES = ['table-default', 'table-ocean', 'table-matrix', 'table-gold', 'table-blood'];
const CARDS = ['cards-default', 'cards-red', 'cards-gold', 'cards-matrix', 'cards-purple'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() < p; }

function randomName() { return rand(NAMES); }

// Everything unlocked: a random full cosmetic set (hat+avatar+face+shoes,
// plus a dance, table theme and card back).
function randomCosmetics() {
  const avatar = [rand(HATS), rand(AVATARS), rand(FACES), rand(SHOES)].join('');
  return { avatar, dance: rand(DANCES), table: rand(TABLES), cards: rand(CARDS) };
}

function createBrain(difficulty) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medio;
  const mem = new Map(); // `${owner}:${idx}` -> card object
  const key = (o, i) => `${o}:${i}`;
  return {
    difficulty, cfg,
    // Record a seen card — easier bots remember it with lower probability
    note(owner, idx, card) {
      if (!card) return;
      if (Math.random() <= cfg.memProb) mem.set(key(owner, idx), card);
    },
    forget(owner, idx) { mem.delete(key(owner, idx)); },
    get(owner, idx) { return mem.get(key(owner, idx)); },
    has(owner, idx) { return mem.has(key(owner, idx)); },
    thinkDelay() { return rint(cfg.think[0], cfg.think[1]); },
    reactDelay() { return rint(cfg.react[0], cfg.react[1]); },
  };
}

/* ---------- helpers over the (public) hand shape ---------- */
// Indices of real cards (holes — burned/combined slots — are null)
function ownSlots(state, me) {
  const out = [];
  state.players[me].hand.forEach((c, i) => { if (c !== null) out.push(i); });
  return out;
}

// Known cards in a hand, as { i, v, rank }
function knownCards(brain, owner, slots) {
  return slots
    .filter((i) => brain.has(owner, i))
    .map((i) => { const c = brain.get(owner, i); return { i, v: cardValue(c), rank: c.rank }; });
}

function highest(known) {
  return known.length ? known.reduce((a, b) => (b.v > a.v ? b : a)) : null;
}

/* ---------- per-phase decisions ---------- */
function decidePeek(brain, state, me) {
  const p = state.players[me];
  if (p.ready) return null;
  if (p.peeked.size < 2) {
    const cand = [];
    p.hand.forEach((c, i) => { if (c !== null && !p.peeked.has(i)) cand.push(i); });
    if (cand.length) return { a: 'peek', i: rand(cand) };
  }
  return { a: 'ready' };
}

function decideTurn(brain, state, me) {
  const cfg = brain.cfg;
  const slots = ownSlots(state, me);
  const known = knownCards(brain, me, slots);
  const allKnown = known.length === slots.length;
  const knownSum = known.reduce((s, k) => s + k.v, 0);
  const unknownCount = slots.length - known.length;
  const myEst = knownSum + unknownCount * UNKNOWN_EST;
  const maxKnown = highest(known);

  // Call MATEO when our hand is confidently low and likely the lowest
  const canMateo = (!cfg.mateoAllKnown || allKnown) && knownSum <= cfg.mateoMax;
  if (canMateo && !chance(cfg.mistake)) {
    let minOpp = Infinity;
    state.players.forEach((pl, idx) => {
      if (idx === me) return;
      let est = 0;
      pl.hand.forEach((c, i) => {
        if (c === null) return;
        est += brain.has(idx, i) ? cardValue(brain.get(idx, i)) : UNKNOWN_EST;
      });
      minOpp = Math.min(minOpp, est);
    });
    if (myEst < minOpp) return { a: 'mateo' };
  }

  // Grab the center card if it's low and we have a high card to dump it on
  const top = state.discard[state.discard.length - 1];
  if (top && !chance(cfg.mistake)) {
    const dv = cardValue(top);
    const haveHigher = maxKnown && maxKnown.v > dv;
    if (dv <= cfg.takeMax && (haveHigher || dv <= 3)) return { a: 'takeDiscard' };
  }

  return { a: 'draw' };
}

function decideDrawn(brain, state, me) {
  const cfg = brain.cfg;
  const drawn = state.drawn; // our own drawn card — fair to know
  const dv = cardValue(drawn);
  const slots = ownSlots(state, me);
  const known = knownCards(brain, me, slots);

  // Drop a trio if we remember two more of the drawn rank
  const matches = known.filter((k) => k.rank === drawn.rank);
  if (matches.length >= 2 && !chance(cfg.mistake)) return { a: 'combineStart' };

  // Swap out our highest known card if the drawn one is cheaper
  const maxKnown = highest(known);
  if (maxKnown && maxKnown.v > dv && !chance(cfg.mistake)) return { a: 'swap', i: maxKnown.i };

  // High power cards are worth using for their ability, not keeping
  if (['7', '8', '9'].includes(drawn.rank) && chance(cfg.powerChance)) return { a: 'usePower' };

  // A very low card is worth gambling into an unknown slot
  if (dv <= 3) {
    const unknown = slots.filter((i) => !brain.has(me, i));
    if (unknown.length) return { a: 'swap', i: rand(unknown) };
  }

  return { a: 'discardDrawn' };
}

function decideSwapDiscard(brain, state, me) {
  const slots = ownSlots(state, me);
  const known = knownCards(brain, me, slots);
  const maxKnown = highest(known);
  if (maxKnown) return { a: 'swap', i: maxKnown.i };
  return { a: 'swap', i: slots.length ? rand(slots) : 0 };
}

function decidePower7(brain, state, me) {
  const slots = ownSlots(state, me);
  const unknown = slots.filter((i) => !brain.has(me, i));
  const pick = unknown.length ? rand(unknown) : (slots.length ? rand(slots) : 0);
  return { a: 'powerTarget', p: me, i: pick };
}

function opponentCards(state, me) {
  const out = [];
  state.players.forEach((pl, idx) => {
    if (idx === me) return;
    pl.hand.forEach((c, i) => { if (c !== null) out.push({ idx, i }); });
  });
  return out;
}

function decidePower8(brain, state, me) {
  const opps = opponentCards(state, me);
  if (!opps.length) return { a: 'cancel' };
  const unknown = opps.filter((o) => !brain.has(o.idx, o.i));
  const pick = rand(unknown.length ? unknown : opps);
  return { a: 'powerTarget', p: pick.idx, i: pick.i };
}

function decidePower9a(brain, state, me) {
  const slots = ownSlots(state, me);
  const known = knownCards(brain, me, slots);
  const maxKnown = highest(known);
  if (maxKnown) return { a: 'powerTarget', p: me, i: maxKnown.i };
  return { a: 'powerTarget', p: me, i: slots.length ? rand(slots) : 0 };
}

function decidePower9b(brain, state, me) {
  const opps = opponentCards(state, me);
  if (!opps.length) return { a: 'cancel' };
  // Steal the lowest opponent card we actually know about
  const known = opps
    .filter((o) => brain.has(o.idx, o.i))
    .map((o) => ({ ...o, v: cardValue(brain.get(o.idx, o.i)) }));
  if (known.length) {
    const low = known.reduce((a, b) => (b.v < a.v ? b : a));
    return { a: 'powerTarget', p: low.idx, i: low.i };
  }
  const pick = rand(opps);
  return { a: 'powerTarget', p: pick.idx, i: pick.i };
}

function decideCombine(brain, state, me) {
  const drawn = state.drawn;
  const picks = state.ctx.combinePicks || [];
  const slots = ownSlots(state, me);
  const match = slots.find(
    (i) => !picks.includes(i) && brain.has(me, i) && brain.get(me, i).rank === drawn.rank
  );
  if (match !== undefined) return { a: 'combinePick', i: match };
  return { a: 'cancel' };
}

function decideBurn(brain, state, me) {
  const target = state.burnTarget;
  if (!target) return { a: 'cancel' };
  const slots = ownSlots(state, me);
  const match = slots.find((i) => brain.has(me, i) && brain.get(me, i).rank === target.rank);
  if (match !== undefined) return { a: 'burnPick', i: match };
  return { a: 'cancel' };
}

// The single decision entry point — returns an action message or null
function decide(brain, state, me) {
  switch (state.phase) {
    case 'peek': return decidePeek(brain, state, me);
    case 'turn': return decideTurn(brain, state, me);
    case 'drawn': return decideDrawn(brain, state, me);
    case 'swapDiscard': return decideSwapDiscard(brain, state, me);
    case 'power7': return decidePower7(brain, state, me);
    case 'power8': return decidePower8(brain, state, me);
    case 'power9a': return decidePower9a(brain, state, me);
    case 'power9b': return decidePower9b(brain, state, me);
    case 'combine': return decideCombine(brain, state, me);
    case 'burn': return decideBurn(brain, state, me);
    default: return null;
  }
}

// Does this bot hold (and remember) a card that can burn the current target?
// Returns the slot index, or -1.
function wantsBurn(brain, state, me) {
  const target = state.burnTarget;
  if (!target || state.phase !== 'turn') return -1;
  const slots = ownSlots(state, me);
  const match = slots.find((i) => brain.has(me, i) && brain.get(me, i).rank === target.rank);
  return match === undefined ? -1 : match;
}

module.exports = {
  createBrain, decide, wantsBurn, randomName, randomCosmetics, cardValue, DIFFICULTY,
};
