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
  facil:   { memProb: 0.55, react: [1500, 2800], think: [1200, 2200], burnChance: 0.40, mateoMax: 4, mateoAllKnown: true,  mateoMargin: 0, takeMax: 3, powerChance: 0.40, mistake: 0.30, danceChance: 0.30 },
  medio:   { memProb: 0.85, react: [800, 1500],  think: [800, 1500],  burnChance: 0.80, mateoMax: 6, mateoAllKnown: true,  mateoMargin: 1, takeMax: 4, powerChance: 0.70, mistake: 0.12, danceChance: 0.22 },
  // Hard knows its whole hand and never fumbles. It plays MATEO ADAPTIVELY:
  // the safety margin scales with how blind it is to the leading opponent —
  // it pounces when it can see their hand, stays cautious when it can't.
  // It also grabs any discard that lowers its hand (takeSmart) and spies the
  // most threatening opponent with the 8-power to sharpen those calls.
  dificil: { memProb: 1.00, react: [150, 450],   think: [250, 600],   burnChance: 0.99, mateoMax: 8, mateoAllKnown: true,  mateoMargin: 3, mateoAdaptive: true, mateoUnknownPenalty: 1.5, takeMax: 5, takeSmart: true, powerChance: 0.97, mistake: 0.00, danceChance: 0.18 },
};

// Geeky reddit/X-style handles; bots show up as "CPU-<handle>"
const HANDLES = [
  'n00b_slayer', 'xX_v0id_Xx', 'l33t_h4x0r', 'sudo_rm_rf', 'based_dev42', 'g1t_gud',
  'pixel_chad', 'crypto_bro', 'null_ptr', 'seg_fault', 'byte_lord', '420_blazeit',
  'th3_arch1tect', 'k3rn3l_p4nic', 'dark_matter', 'quantum_chad', 'rm_rf_star', 'st4ck0verflow',
  'mr_robot', 'doge_coder', 'big_endian', 'cyb3r_punk', 'ed_lord', 'vim_exit',
  'ratio_d', 'touch_grass', 'gg_ez', 'no_cap_fr', 'sigma_dev', 'gigachad99',
];

const AVATARS = ['🤖', '👽', '🐸', '🐱', '🦊', '💀', '🤡', '👾', '🦩', '🦄', '🐙', '🐉', '🐧', '🦖', '👻', '🐵', '🦈'];
const HATS = ['', '🧢', '🎩', '🎓', '🪖', '👑'];
const FACES = ['', '😎', '😤', '🤪', '😈', '🥱'];
const DANCES = ['💃', '🕺', '🦆', '🐔', '🪩', '🫏'];
const TABLES = ['table-default', 'table-ocean', 'table-matrix', 'table-gold', 'table-blood', 'table-pink'];
const CARDS = ['cards-default', 'cards-red', 'cards-gold', 'cards-matrix', 'cards-purple', 'cards-pink'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function chance(p) { return Math.random() < p; }

function randomName() { return 'CPU ' + rand(HANDLES); }

// Everything unlocked: a random full cosmetic set (hat+avatar+face,
// plus a dance, table theme and card back).
function randomCosmetics() {
  const avatar = [rand(HATS), rand(AVATARS), rand(FACES)].join('');
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
    let minOpp = Infinity, minUnknown = 0;
    state.players.forEach((pl, idx) => {
      if (idx === me) return;
      let est = 0, unk = 0;
      pl.hand.forEach((c, i) => {
        if (c === null) return;
        if (brain.has(idx, i)) est += cardValue(brain.get(idx, i));
        else { est += UNKNOWN_EST; unk++; }
      });
      if (est < minOpp) { minOpp = est; minUnknown = unk; }
    });
    // Only call when clearly ahead: a tie or near-tie loses (caller must be the
    // SOLE strictly-lowest hand). Adaptive bots scale the margin with how blind
    // they are to the LEADING opponent — zero buffer when we can see their whole
    // hand, more for each card we're guessing at. Others use a flat margin.
    const margin = cfg.mateoAdaptive
      ? minUnknown * (cfg.mateoUnknownPenalty || 1.5)
      : (cfg.mateoMargin || 0);
    if (myEst + margin < minOpp) return { a: 'mateo' };
  }

  // Grab the center card if it lowers our hand. Smart bots take any card below
  // our highest known one (a guaranteed swap-down); others cap it by takeMax.
  const top = state.discard[state.discard.length - 1];
  if (top && !chance(cfg.mistake)) {
    const dv = cardValue(top);
    const haveHigher = maxKnown && maxKnown.v > dv;
    if (haveHigher && (cfg.takeSmart || dv <= cfg.takeMax)) return { a: 'takeDiscard' };
    if (dv <= 3) return { a: 'takeDiscard' };
  }

  return { a: 'draw' };
}

function decideDrawn(brain, state, me) {
  const cfg = brain.cfg;
  const drawn = state.drawn; // our own drawn card — fair to know
  const dv = cardValue(drawn);
  const slots = ownSlots(state, me);
  const known = knownCards(brain, me, slots);
  const allKnown = known.length === slots.length;

  // Drop a trio if we remember two more of the drawn rank
  const matches = known.filter((k) => k.rank === drawn.rank);
  if (matches.length >= 2 && !chance(cfg.mistake)) return { a: 'combineStart' };

  // Swap out our highest known card if the drawn one is cheaper
  const maxKnown = highest(known);
  if (maxKnown && maxKnown.v > dv && !chance(cfg.mistake)) return { a: 'swap', i: maxKnown.i };

  // 8 (spy a rival) and 9 (spy + steal) are always worth their ability. The 7
  // only peeks our OWN card, so it's wasted once we already know our whole hand.
  const usefulPower = drawn.rank === '8' || drawn.rank === '9' || (drawn.rank === '7' && !allKnown);
  if (usefulPower && chance(cfg.powerChance)) return { a: 'usePower' };

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
  if (!unknown.length) { const pick = rand(opps); return { a: 'powerTarget', p: pick.idx, i: pick.i }; }
  // Spy the most threatening rival (lowest estimated hand) — learning the cards
  // that actually decide the round, which in turn sharpens our MATEO calls.
  const est = {};
  state.players.forEach((pl, idx) => {
    if (idx === me) return;
    let s = 0;
    pl.hand.forEach((c, i) => { if (c !== null) s += brain.has(idx, i) ? cardValue(brain.get(idx, i)) : UNKNOWN_EST; });
    est[idx] = s;
  });
  const pick = unknown.reduce((a, b) => (est[b.idx] < est[a.idx] ? b : a));
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
