/* ============ UI: snapshot-driven rendering for one player's device ============
 * The host sends each device a redacted snapshot: other players' cards arrive
 * as null (face down). Your own seat is always rendered at the bottom.
 */
const UI = (() => {
  const $ = (sel) => document.querySelector(sel);

  let snap = null;       // latest state snapshot from the host
  let myIdx = -1;
  let myName = '';
  let roomCode = '';
  let swapMode = false;  // chose "CAMBIAR": pick one of your cards
  let lastPhase = '';
  let lastTurn = -1;
  let started = false;
  let msgOverride = null; // { text, until }
  let lastScoredKey = '';     // guards round/game coin rewards against re-award
  let danceCooldownUntil = 0; // client-side dance button cooldown
  let soloAutoBegin = false;  // solo-vs-CPU: auto-start once the bots are seated

  const screens = {
    lobby: $('#screen-lobby'),
    wait: $('#screen-wait'),
    game: $('#screen-game'),
    score: $('#screen-score'),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // Seat positions clockwise from your own seat (always bottom)
  const SEAT_LAYOUT = {
    2: ['bottom', 'top'],
    3: ['bottom', 'left', 'right'],
    4: ['bottom', 'left', 'top', 'right'],
  };

  function seatFor(playerIdx) {
    const n = snap.players.length;
    const rel = (playerIdx - myIdx + n) % n;
    return $(`.seat[data-pos="${SEAT_LAYOUT[n][rel]}"]`);
  }

  /* ---------- dispatch: every action goes to the server ---------- */
  function send(action) {
    Net.sendToHost({ t: 'action', ...action });
  }

  // Player 0 (the room creator) controls begin / next round
  function amHost() {
    return myIdx === 0;
  }

  /* ---------- card element ---------- */
  function cardEl(card) {
    const el = document.createElement('div');
    el.className = 'card' + (card ? ' flipped' : '');
    const back = document.createElement('div');
    back.className = 'back';
    el.appendChild(back);
    if (card) {
      const face = document.createElement('div');
      face.className = 'face' + (isRedSuit(card.suit) ? ' red' : '');
      face.innerHTML =
        `<span class="corner">${card.rank}<br>${card.suit}</span>` +
        `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>` +
        `<span class="corner-b">${card.rank}<br>${card.suit}</span>`;
      el.appendChild(face);
    }
    return el;
  }

  /* ---------- what can I click? ---------- */
  function isSelectable(p, i) {
    if (!snap || modalVisible()) return false;
    if (snap.players[p].hand[i] === 'empty') return false; // burned/combined hole
    const me = snap.you;
    const isCurrent = snap.current === me;
    switch (snap.phase) {
      case 'peek': {
        const pl = snap.players[me];
        return p === me && !pl.ready && pl.peeked < 2 && !snap.players[me].hand[i];
      }
      case 'drawn':
        return isCurrent && p === me && swapMode;
      case 'swapDiscard':
        return isCurrent && p === me;
      case 'combine':
        return isCurrent && p === me && !(snap.ctx.combinePicks || []).includes(i);
      case 'power7':
      case 'power9a':
        return isCurrent && p === me;
      case 'power8':
      case 'power9b':
        return isCurrent && p !== me;
      case 'burn':
        return snap.ctx.burner === me && p === me;
      default:
        return false;
    }
  }

  function modalVisible() {
    return !$('#drawn-modal').classList.contains('hidden');
  }

  // The host's equipped table + card styles dress the whole room
  function applyRoomStyle(style) {
    if (!style) return;
    const table = $('#table');
    table.dataset.theme = style.table || 'table-default';
    // The host's deck dresses the central piles (deck + discard)
    table.dataset.deck = style.cards || 'cards-default';
  }

  /* ---------- render ---------- */
  function render() {
    if (!snap) return;
    applyRoomStyle(snap.style);
    $('#table').dataset.players = snap.players.length; // drives card scaling
    const inPlay = !['peek', 'roundEnd', 'gameOver'].includes(snap.phase);

    document.querySelectorAll('.seat').forEach((s) => (s.style.display = 'none'));
    snap.players.forEach((pl, p) => {
      const seat = seatFor(p);
      seat.style.display = '';
      // Each player's own equipped deck shows on THEIR cards for everyone
      seat.dataset.deck = pl.cards || 'cards-default';
      seat.classList.toggle('active-turn', p === snap.current && inPlay);
      seat.querySelector('.player-name').textContent =
        (p === myIdx ? '➤ ' : '') + (pl.avatar || '') + ' ' + pl.name.toUpperCase() + (pl.disconnected ? ' ⛔' : '');
      seat.querySelector('.player-score').textContent =
        snap.phase === 'peek' && !pl.disconnected
          ? (pl.ready ? '✔ LISTO' : '…')
          : `${pl.score} pts`;

      const hand = seat.querySelector('.hand');
      hand.innerHTML = '';
      // 5+ cards (penalty) overlap into a fan so they never overflow the circle
      hand.classList.toggle('crowded', pl.hand.length > 4);
      pl.hand.forEach((card, i) => {
        // 'empty' = a burned/combined hole: render a placeholder so the other
        // cards keep their positions (memory aid)
        if (card === 'empty') {
          const gap = document.createElement('div');
          gap.className = 'card gap';
          hand.appendChild(gap);
          return;
        }
        const el = cardEl(card);
        if (isSelectable(p, i)) {
          el.classList.add('selectable');
          el.addEventListener('click', () => onCardClick(p, i));
        }
        if (p === myIdx && (snap.ctx.combinePicks || []).includes(i) && snap.phase === 'combine') {
          el.classList.add('selected');
        }
        if (p === myIdx && snap.phase === 'power9b' && snap.ctx.swapOwn === i) {
          el.classList.add('selected');
        }
        hand.appendChild(el);
      });
    });

    renderCenter();
    renderBanner();
    renderActions();
    renderMessage();
    updateTauntButton();
    $('#round-indicator').textContent = `RONDA ${snap.round} · SALA ${roomCode}`;
  }

  // The four central piles are always present in fixed positions (deck,
  // discard, burned, drawn). We only swap each pile's CARD content so the
  // layout never reflows — an empty pile keeps its slot instead of letting
  // the others slide to the middle.
  function renderCenter() {
    $('#deck-count').textContent = `(${snap.deckCount})`;
    $('#deck-pile').classList.toggle('clickable',
      snap.phase === 'turn' && snap.current === myIdx);

    // DISCARD (center)
    const dCards = $('#discard-pile .pile-cards');
    dCards.innerHTML = '';
    if (snap.discardTop) {
      const top = cardEl(snap.discardTop);
      // Only the fresh discard glows; a stale top (already burned over or
      // taken past) is dimmed and can't be touched
      top.classList.add(snap.fresh ? 'fresh-glow' : 'stale');
      dCards.appendChild(top);
    } else {
      dCards.innerHTML = '<div class="pile-empty">VACÍO</div>';
    }

    // BURNED (eliminated). While the last burned card is still the active burn
    // target, show its face so players know what to match.
    const bCards = $('#burned-pile .pile-cards');
    bCards.innerHTML = '';
    $('#burned-count').textContent = snap.eliminatedCount > 0 ? `(${snap.eliminatedCount})` : '';
    if (snap.eliminatedCount > 0) {
      const chainActive = snap.burnTarget && snap.eliminatedTop &&
        snap.burnTarget.rank === snap.eliminatedTop.rank &&
        snap.burnTarget.suit === snap.eliminatedTop.suit;
      if (chainActive) {
        const topCard = cardEl(snap.eliminatedTop);
        topCard.classList.add('burn-glow');
        bCards.appendChild(topCard);
      } else {
        bCards.innerHTML = '<div class="burned-stack">🔥</div>';
      }
    } else {
      bCards.innerHTML = '<div class="pile-empty">🔥</div>';
    }

    // DRAWN (face up for the drawer, face down for everyone else)
    const fCards = $('#drawn-float .pile-cards');
    fCards.innerHTML = '';
    if (snap.drawn && !modalVisible()) {
      fCards.appendChild(cardEl(snap.drawn === true ? null : snap.drawn));
    } else {
      fCards.innerHTML = '<div class="pile-empty">—</div>';
    }
  }

  function renderBanner() {
    const banner = $('#turn-banner');
    const inTurn = !['peek', 'roundEnd', 'gameOver'].includes(snap.phase);
    banner.classList.toggle('hidden', !inTurn);
    if (!inTurn) { lastTurn = -1; return; }

    const mine = snap.current === myIdx;
    banner.classList.toggle('other-turn', !mine);
    banner.textContent = mine
      ? '▶ ¡TU TURNO! ◀'
      : `TURNO DE ${snap.players[snap.current].name.toUpperCase()}`;
    if (lastTurn !== snap.current) {
      lastTurn = snap.current;
      banner.style.animation = 'none';
      void banner.offsetWidth;
      banner.style.animation = '';
      AudioFX.turn();
    }
  }

  function renderActions() {
    const bar = $('#action-bar');
    bar.innerHTML = '';
    if (!snap || modalVisible()) return;

    const addBtn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = text;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };

    const me = snap.players[myIdx];
    const isCurrent = snap.current === myIdx;

    // Round end: stay on the revealed table as long as you like, then continue
    if (snap.phase === 'roundEnd' || snap.phase === 'gameOver') {
      addBtn('CONTINUAR ▶', 'btn-success btn-big', () => { AudioFX.click(); showScores(); });
      return;
    }

    if (snap.phase === 'peek' && !me.ready) {
      addBtn('✔ CONFIRMAR', 'btn-success', () => { AudioFX.click(); send({ a: 'ready' }); });
    }
    if (snap.phase === 'turn') {
      if (isCurrent) {
        addBtn('🂠 LEVANTAR DEL MAZO', '', () => send({ a: 'draw' }));
        if (snap.discardTop) addBtn('🤚 TOMAR DEL CENTRO', 'btn-small', () => send({ a: 'takeDiscard' }));
        addBtn('📣 ¡MATEO!', 'btn-danger', () => {
          AudioFX.click();
          if (confirm('¿Cantar ¡MATEO!? Esto TERMINA la ronda al instante. Solo ganas si tienes la suma más baja.')) {
            send({ a: 'mateo' });
          }
        });
      }
      if (snap.burnTarget && me.hand.length > 0) {
        addBtn('🔥 QUEMAR', 'btn-warn', () => { AudioFX.click(); send({ a: 'burnStart' }); });
      }
    }
    if (snap.phase === 'burn' && snap.ctx.burner === myIdx) {
      addBtn('✖ CANCELAR', 'btn-small', () => { AudioFX.click(); send({ a: 'cancel' }); });
    }
    if (['combine', 'power7', 'power8', 'power9a', 'power9b'].includes(snap.phase) && isCurrent) {
      addBtn('✖ CANCELAR', 'btn-small', () => { AudioFX.click(); send({ a: 'cancel' }); });
    }
    if (snap.phase === 'drawn' && isCurrent && swapMode) {
      addBtn('✖ VOLVER', 'btn-small', () => { swapMode = false; openDrawnModal(); });
    }
    // Taunts live on the always-on floating button (see updateTauntButton)
  }

  /* ---------- taunts (always-on dance / tomato button) ---------- */
  function tauntOnCooldown() { return Date.now() < danceCooldownUntil; }

  function updateTauntButton() {
    const btn = $('#btn-taunt');
    if (!btn) return;
    btn.classList.toggle('cooling', tauntOnCooldown());
  }

  function closeTauntMenu() { $('#taunt-menu').classList.add('hidden'); }

  function toggleTauntMenu() {
    const menu = $('#taunt-menu');
    if (!menu.classList.contains('hidden')) { closeTauntMenu(); return; }
    AudioFX.click();
    buildDanceMenu();
    menu.classList.remove('hidden');
  }

  function buildDanceMenu() {
    const menu = $('#taunt-menu');
    menu.innerHTML = '';
    const dances = Economy.ownedDances();
    dances.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'btn btn-small taunt-opt';
      b.textContent = `${d.emoji} ${d.name}`;
      b.addEventListener('click', () => { doDance(d.emoji); closeTauntMenu(); });
      menu.appendChild(b);
    });
    if (Economy.owns('dance-tomato')) {
      const b = document.createElement('button');
      b.className = 'btn btn-small taunt-opt btn-tomato';
      b.textContent = '🍅 TOMATAZO ▸';
      b.addEventListener('click', buildTomatoMenu);
      menu.appendChild(b);
    }
    if (!menu.children.length) {
      const p = document.createElement('p');
      p.className = 'taunt-empty';
      p.textContent = 'compra bailes en la 🛒 TIENDA';
      menu.appendChild(p);
    }
  }

  // Pick who gets the tomato
  function buildTomatoMenu() {
    const menu = $('#taunt-menu');
    menu.innerHTML = '';
    (snap ? snap.players : []).forEach((pl, i) => {
      if (i === myIdx) return;
      const b = document.createElement('button');
      b.className = 'btn btn-small taunt-opt';
      b.textContent = `🍅 a ${pl.avatar || ''} ${pl.name.toUpperCase()}`;
      b.addEventListener('click', () => { throwTomato(i); closeTauntMenu(); });
      menu.appendChild(b);
    });
    const back = document.createElement('button');
    back.className = 'btn btn-small';
    back.textContent = '◀ VOLVER';
    back.addEventListener('click', buildDanceMenu);
    menu.appendChild(back);
  }

  function doDance(emoji) {
    if (tauntOnCooldown()) return;
    danceCooldownUntil = Date.now() + 8000;
    send({ a: 'dance', emoji });
    updateTauntButton();
  }

  function throwTomato(targetIdx) {
    if (tauntOnCooldown()) return;
    danceCooldownUntil = Date.now() + 8000;
    send({ a: 'tomato', target: targetIdx });
    updateTauntButton();
  }

  function renderMessage() {
    if (msgOverride && Date.now() < msgOverride.until) {
      $('#message-bar').textContent = msgOverride.text;
      return;
    }
    msgOverride = null;
    if (snap.phase === 'roundEnd' || snap.phase === 'gameOver') {
      $('#message-bar').textContent = '¡Fin de ronda! Mira las cartas reveladas y pulsa CONTINUAR ▶';
      return;
    }
    const isCurrent = snap.current === myIdx;
    const curName = snap.players[snap.current].name.toUpperCase();
    const me = snap.players[myIdx];

    let msg = '';
    switch (snap.phase) {
      case 'peek':
        msg = me.ready
          ? 'Esperando a que los demás confirmen…'
          : `Toca 2 de tus cartas para verlas (${me.peeked}/2) y CONFIRMA`;
        break;
      case 'turn': {
        const burnHint = snap.burnTarget ? ` (puedes 🔥 QUEMAR un ${snap.burnTarget.rank})` : '';
        msg = isCurrent
          ? 'Levanta del mazo, toma el descarte, quema o grita ¡MATEO!'
          : `${curName} está jugando…${burnHint}`;
        break;
      }
      case 'drawn':
        msg = isCurrent
          ? (swapMode ? 'Elige cuál de tus cartas reemplazar' : '')
          : `${curName} levantó una carta y está decidiendo…`;
        break;
      case 'swapDiscard':
        msg = isCurrent
          ? '🤚 Tomaste el descarte: elige cuál de tus cartas reemplazar'
          : `${curName} tomó el descarte…`;
        break;
      case 'combine':
        msg = isCurrent
          ? 'COMBINAR: elige las 2 cartas que crees que hacen trío'
          : `${curName} intenta combinar un trío…`;
        break;
      case 'power7':
        msg = isCurrent ? '👁 PODER 7: toca una de TUS cartas para verla' : `${curName} usa el PODER 7…`;
        break;
      case 'power8':
        msg = isCurrent ? '👀 PODER 8: toca una carta de OTRO jugador para verla' : `${curName} usa el PODER 8… ¡cuidado!`;
        break;
      case 'power9a':
        msg = isCurrent ? '✋ PODER 9: elige una carta TUYA para intercambiar' : `${curName} usa el PODER 9…`;
        break;
      case 'power9b':
        msg = isCurrent ? '✋ PODER 9: ahora elige la carta de OTRO jugador' : `${curName} usa el PODER 9…`;
        break;
      case 'burn':
        msg = snap.ctx.burner === myIdx
          ? `🔥 Elige tu carta a quemar (¿tienes un ${snap.burnTarget?.rank}?)`
          : `🔥 ${snap.players[snap.ctx.burner].name.toUpperCase()} intenta quemar…`;
        break;
    }
    $('#message-bar').textContent = msg;
  }

  function flash(text, ms = 2600) {
    msgOverride = { text, until: Date.now() + ms };
    $('#message-bar').textContent = text;
  }

  /* ---------- interactions ---------- */
  function onCardClick(p, i) {
    switch (snap.phase) {
      case 'peek':
        send({ a: 'peek', i });
        break;
      case 'drawn':
      case 'swapDiscard':
        send({ a: 'swap', i });
        break;
      case 'combine':
        send({ a: 'combinePick', i });
        break;
      case 'power7':
      case 'power8':
      case 'power9a':
      case 'power9b':
        send({ a: 'powerTarget', p, i });
        break;
      case 'burn':
        send({ a: 'burnPick', i });
        break;
    }
  }

  /* ---------- drawn card modal ---------- */
  function openDrawnModal(fromDeck) {
    const card = snap.drawn;
    if (!card || card === true) return;
    const slot = $('#drawn-card-slot');
    slot.innerHTML = '';
    slot.appendChild(cardEl(card));

    const isWild = card.rank === 'Q' && card.suit === '♥';
    const hints = {
      '7': '👁 PODER: ver una de tus cartas',
      '8': '👀 PODER: ver una carta de otro jugador',
      '9': '✋ PODER: intercambio a ciegas con otro jugador',
    };
    $('#drawn-hint').textContent = isWild
      ? '★ Q DE CORAZONES: ¡COMODÍN! ★'
      : hints[card.rank] || '';

    const actions = $('#drawn-actions');
    actions.innerHTML = '';
    const addBtn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = text;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };

    addBtn('⇄ CAMBIAR', 'btn-success', () => {
      AudioFX.click();
      swapMode = true;
      closeDrawnModal();
      render();
    });
    if (['7', '8', '9'].includes(card.rank)) {
      addBtn(`★ USAR PODER ${card.rank}`, 'btn-warn', () => {
        closeDrawnModal();
        send({ a: 'usePower' });
      });
    }
    addBtn('♦♦♦ COMBINAR TRÍO', 'btn-small', () => {
      AudioFX.click();
      closeDrawnModal();
      send({ a: 'combineStart' });
    });
    addBtn('↓ DESCARTAR', 'btn-danger', () => {
      closeDrawnModal();
      send({ a: 'discardDrawn' });
    });

    $('#drawn-modal').classList.remove('hidden');
    if (fromDeck) animateModalFromDeck();
    render();
  }

  // Make the drawn-card modal fly in from the deck pile, so the player sees the
  // card being pulled from the deck and growing into the modal.
  function animateModalFromDeck() {
    const deck = $('#deck-pile');
    const box = $('#drawn-modal .modal-box');
    if (!deck || !box) return;
    const d = deck.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (!b.width) return;
    const dx = (d.left + d.width / 2) - (b.left + b.width / 2);
    const dy = (d.top + d.height / 2) - (b.top + b.height / 2);
    box.style.animation = 'none';
    box.style.transform = `translate(${dx}px, ${dy}px) scale(0.22)`;
    box.style.opacity = '0';
    requestAnimationFrame(() => {
      box.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.1, 0.5, 1), opacity 0.34s ease-out';
      box.style.transform = 'none';
      box.style.opacity = '1';
    });
    setTimeout(() => {
      box.style.transition = '';
      box.style.transform = '';
      box.style.animation = '';
    }, 660);
  }

  function closeDrawnModal() {
    $('#drawn-modal').classList.add('hidden');
  }

  /* ---------- server messages: lobby / state / events ---------- */
  function onLobby(msg) {
    myIdx = msg.you;
    // Solo-vs-CPU: once the bots have been seated (≥2 players), start at once
    if (soloAutoBegin && amHost() && msg.players.length >= 2) {
      soloAutoBegin = false;
      send({ a: 'begin' });
      return;
    }
    const list = $('#wait-list');
    list.innerHTML = '';
    msg.players.forEach((name, i) => {
      const li = document.createElement('li');
      const avatar = (msg.avatars && msg.avatars[i]) || '';
      li.textContent = `${i + 1}. ${avatar} ${name.toUpperCase()}${i === 0 ? ' 👑' : ''}${i === msg.you ? ' (TÚ)' : ''}`;
      list.appendChild(li);
    });
    for (let i = msg.players.length; i < 4; i++) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = `${i + 1}. esperando…`;
      list.appendChild(li);
    }
    const begin = $('#btn-begin');
    if (amHost()) {
      begin.classList.remove('hidden');
      begin.disabled = msg.players.length < 2;
      $('#wait-hint').textContent = msg.players.length < 2
        ? 'se necesitan al menos 2 jugadores'
        : '¡puedes comenzar cuando estén todos!';
    } else {
      begin.classList.add('hidden');
      $('#wait-hint').textContent = 'esperando a que el anfitrión comience…';
    }
    show('wait');
  }

  function onState(s) {
    snap = s;
    myIdx = s.you;

    const phaseChanged = s.phase !== lastPhase;
    if (phaseChanged) {
      lastPhase = s.phase;
      if (s.phase !== 'drawn') swapMode = false;
    }

    // Round end: reveal everything on the table and wait for the player to
    // press CONTINUAR (no auto-advance) so they can study the cards as long
    // as they want before seeing the score screen.
    if ((s.phase === 'roundEnd' || s.phase === 'gameOver') && phaseChanged) {
      closeDrawnModal();
      show('game');
      render();
      return;
    }
    if (s.phase === 'roundEnd' || s.phase === 'gameOver') return;

    // Covers game start, next round, and mid-game reconnection
    if (!screens.game.classList.contains('active')) {
      show('game');
      started = true;
    }

    // Drawn modal only for the active player who just drew from the deck.
    // On a fresh draw, the modal flies in from the deck (card pulled out).
    // Guard on !modalVisible() so repeated 'drawn' state pushes don't reopen
    // (and re-animate) the dialog — that was making it appear twice.
    if (s.phase === 'drawn' && s.current === myIdx && s.drawn !== true && !swapMode) {
      if (!modalVisible()) openDrawnModal(phaseChanged);
    } else if (s.phase !== 'drawn') {
      closeDrawnModal();
    }

    render();
  }

  function onEvent(ev) {
    const name = (i) => snap.players[i].name.toUpperCase();
    switch (ev.name) {
      case 'deal':
        AudioFX.shuffle();
        show('game');
        render();
        document.querySelectorAll('.hand .card').forEach((c, i) => {
          c.classList.add('dealing');
          c.style.animationDelay = `${i * 0.07}s`;
          if (i % 4 === 0) AudioFX.deal(i / 4);
        });
        break;
      case 'flip': AudioFX.flip(); break;
      case 'start': AudioFX.win(); flash('¡QUE COMIENCE EL JUEGO!'); break;
      case 'draw':
        AudioFX.draw();
        deckPop();
        // The drawer sees the card pop up in their modal; everyone else sees a
        // face-down card glide from the deck to the "LEVANTADA" slot. Slow and
        // deliberate so it's clear the card came from the central deck.
        if (ev.player !== myIdx) flyCard($('#deck-pile .card-back'), $('#drawn-float .pile-cards'), null, 700);
        break;
      case 'tookDiscard': {
        AudioFX.draw();
        flash(`${name(ev.player)} tomó el descarte`);
        const dc = (snap.drawn && snap.drawn.rank) ? snap.drawn : null;
        flyCard($('#discard-pile .pile-cards'), $('#drawn-float .pile-cards'), dc, 700);
        break;
      }
      case 'discard':
        AudioFX.discard();
        // card travels from the player's hand to the discard pile
        flyCard(seatHand(ev.player), $('#discard-pile .pile-cards'), snap.discardTop, 240);
        slamDiscard();
        break;
      case 'swap': AudioFX.swap(); break;
      case 'power': AudioFX.power(); flash(`★ ${name(ev.player)} usa el PODER ${ev.rank}`); break;
      case 'peeked':
        // wiggle the exact card being looked at, float an eye over it (one eye
        // for your own card, two for someone else's) and announce it in the center
        tiltCard(ev.target, ev.card);
        eyeOverCard(ev.target, ev.card, ev.own ? '👁' : '👀');
        centerAnnounce(ev.own
          ? `👁 ${name(ev.player)} está mirando una de SUS cartas`
          : `👀 ${name(ev.player)} está viendo una carta de ${name(ev.target)}`, 4000);
        break;
      case 'blindSwap': {
        AudioFX.swap();
        // power 9 "steal": a hand slowly drags the stolen card from the victim's
        // EXACT slot to the robber's slot (face down — you see WHICH position
        // moved, not the value); the card given back glides quietly the other way.
        const robberSlot = seatCardEl(ev.player, ev.fromCard);
        const victimSlot = seatCardEl(ev.target, ev.toCard);
        flyCard(robberSlot, victimSlot, null, 900);
        flyHandCard(victimSlot, robberSlot, null, 1400);
        flash(`✋ ${name(ev.player)} le robó la carta #${(ev.toCard ?? 0) + 1} a ${name(ev.target)}`, 3800);
        break;
      }
      case 'burnOk':
        AudioFX.burnOk();
        // burned card flies from the burner's hand to the burned pile
        flyCard(seatHand(ev.player), $('#burned-pile .pile-cards'), ev.card, 260);
        flash(`🔥 ¡${name(ev.player)} QUEMÓ ${cardLabel(ev.card)}!`);
        break;
      case 'burnFail':
        AudioFX.burnFail();
        shakeSeat(ev.player);
        flash(`❌ ${name(ev.player)} falló el quemado (era ${cardLabel(ev.card)}) → +1 carta`);
        break;
      case 'combineOk':
        AudioFX.combine();
        // the matched cards fly from the hand to the discard pile
        (ev.cards || []).forEach((cd, i) =>
          flyCard(seatHand(ev.player), $('#discard-pile .pile-cards'), cd, 260 + i * 45));
        slamDiscard();
        flash(`♦♦♦ ¡TRÍO DE ${ev.cards[0].rank}! ${name(ev.player)} descartó 3 cartas`);
        break;
      case 'combineFail':
        AudioFX.burnFail();
        shakeSeat(ev.player);
        flash(`❌ ${name(ev.player)} falló el trío (${cardLabel(ev.cards[0])}, ${cardLabel(ev.cards[1])}) → +1 carta`);
        break;
      case 'mateoCall':
        AudioFX.mateo();
        flash(ev.won
          ? `📣 ¡${name(ev.player)} CANTÓ MATEO Y ACERTÓ!`
          : `📣 ${name(ev.player)} cantó MATEO… ¡y falló! +15 de penitencia`, 3400);
        break;
      case 'roundEnd':
        // 'mateo' already played its sting via the mateoCall event
        if (ev.reason !== 'mateo') AudioFX.win();
        flash('¡FIN DE RONDA! Mira las cartas y pulsa CONTINUAR ▶', 5000);
        break;
      case 'left':
        flash(`⚠ ${name(ev.player)} SE DESCONECTÓ — puede volver a entrar con su nombre y el código`, 6000);
        break;
      case 'rejoined':
        AudioFX.power();
        flash(`✔ ${name(ev.player)} SE RECONECTÓ`, 4000);
        break;
      case 'dance':
        AudioFX.taunt(ev.emoji);
        danceOverSeat(ev.player, ev.emoji);
        flash(ev.player === myIdx
          ? `${ev.emoji} ¡BAILANDO PARA LA MESA!`
          : `${ev.emoji} ¡${name(ev.player)} TE ESTÁ BAILANDO!`, 3000);
        break;
      case 'tomato':
        AudioFX.splat();
        tomatoThrow(ev.player, ev.target);
        flash(ev.target === myIdx
          ? `🍅 ¡${name(ev.player)} TE LANZÓ UN TOMATAZO!`
          : `🍅 ${name(ev.player)} le lanzó un tomatazo a ${name(ev.target)}`, 3000);
        break;
    }
  }

  // A tomato arcs from the thrower's seat to the target's, then splatters
  function tomatoThrow(fromIdx, toIdx) {
    requestAnimationFrame(() => {
      const fromEl = seatFor(fromIdx);
      const toEl = seatFor(toIdx);
      if (!fromEl || !toEl) return;
      const a = centerOf(fromEl);
      const b = centerOf(toEl);
      if (!a.ok || !b.ok) return;
      const t = document.createElement('div');
      t.className = 'tomato-fly';
      t.textContent = '🍅';
      t.style.left = `${a.x - 18}px`;
      t.style.top = `${a.y - 18}px`;
      document.body.appendChild(t);
      requestAnimationFrame(() => {
        t.style.transition = 'transform 0.6s cubic-bezier(0.4, 0, 0.7, 1)';
        t.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px) rotate(540deg)`;
      });
      setTimeout(() => {
        t.textContent = '💥';
        t.classList.add('splat');
        shakeSeat(toIdx);
        setTimeout(() => t.remove(), 700);
      }, 600);
    });
  }

  // Big bouncing emoji + music notes over the dancer's seat for ~3s
  function danceOverSeat(p, emoji) {
    const seat = seatFor(p);
    if (!seat) return;
    const el = document.createElement('div');
    el.className = 'dance-float';
    el.innerHTML =
      `<span class="dance-note">♪</span>` +
      `<span class="dance-emoji">${emoji}</span>` +
      `<span class="dance-note delayed">♫</span>`;
    seat.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function slamDiscard() {
    requestAnimationFrame(() => {
      const top = $('#discard-pile .card');
      if (top) top.classList.add('slam');
    });
  }

  function shakeSeat(p) {
    requestAnimationFrame(() => {
      const seat = seatFor(p);
      if (seat) seat.querySelectorAll('.card').forEach((c) => c.classList.add('shake'));
    });
  }

  // Wiggle a single card (the one being peeked by a 7 / 8 power)
  function tiltCard(p, cardIdx) {
    requestAnimationFrame(() => {
      const seat = seatFor(p);
      if (!seat) return;
      const el = seat.querySelectorAll('.hand .card')[cardIdx];
      if (!el) return;
      el.classList.remove('tilt');
      void el.offsetWidth; // restart the animation
      el.classList.add('tilt');
      setTimeout(() => el.classList.remove('tilt'), 800);
    });
  }

  // Float an eye over the exact card being peeked: 👁 for your own card,
  // 👀 for someone else's. Visible to everyone so the table sees the spy.
  function eyeOverCard(p, cardIdx, emoji) {
    requestAnimationFrame(() => {
      const seat = seatFor(p);
      const el = seat && seat.querySelectorAll('.hand .card')[cardIdx];
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const eye = document.createElement('div');
      eye.className = 'eye-float';
      eye.textContent = emoji;
      eye.style.left = `${r.left + r.width / 2}px`;
      eye.style.top = `${r.top + r.height / 2}px`;
      document.body.appendChild(eye);
      setTimeout(() => eye.remove(), 2600);
    });
  }

  // Big neon message in the middle of the screen (power reveals, etc.)
  function centerAnnounce(text, ms = 2200) {
    const el = document.createElement('div');
    el.className = 'center-announce';
    el.style.animationDuration = `${ms}ms`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms + 60);
  }

  // The hand container of a seat — where a player's cards live
  function seatHand(idx) {
    const seat = seatFor(idx);
    return seat ? (seat.querySelector('.hand') || seat) : null;
  }

  // A specific card slot element in a seat (every slot — real card or hole —
  // renders a .card, so the index matches the hand index). Falls back to the
  // hand container if the slot can't be found.
  function seatCardEl(idx, cardIdx) {
    const seat = seatFor(idx);
    if (!seat) return null;
    return seat.querySelectorAll('.hand .card')[cardIdx] || seatHand(idx);
  }

  // The true on-table card size. Every card (deck, hand, discard) shares
  // --card-w/--card-h, so a moving card should always use these dimensions —
  // never a container's rect (a .hand is several cards wide, which would
  // stretch the flying card out of shape).
  function cardSize() {
    const ref = $('#deck-pile .card-back') || $('.hand .card');
    if (ref) {
      const r = ref.getBoundingClientRect();
      if (r.width) return { w: r.width, h: r.height };
    }
    return { w: 48, h: 68 };
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: !!r.width };
  }

  // Animate a temporary card gliding from one element to another. card=null
  // flies face down; a card object flies face up. The card keeps its real
  // table size the whole way (center → center), so it never deforms.
  function flyCard(fromEl, toEl, card, duration = 260) {
    if (!fromEl || !toEl) return;
    const a = centerOf(fromEl);
    const b = centerOf(toEl);
    if (!a.ok || !b.ok) return;
    const { w, h } = cardSize();
    const wrap = document.createElement('div');
    wrap.className = 'fly-wrap';
    wrap.style.cssText =
      `position:fixed;left:${a.x - w / 2}px;top:${a.y - h / 2}px;` +
      `width:${w}px;height:${h}px;z-index:2000;pointer-events:none;`;
    const c = cardEl(card);
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.transition = 'none';
    wrap.appendChild(c);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.9, 0.35, 1)`;
      wrap.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;
    });
    setTimeout(() => wrap.remove(), duration + 40);
  }

  // Like flyCard, but a hand grabs and drags the card across — used for the
  // power-9 "steal". Slower and more theatrical than a plain glide.
  function flyHandCard(fromEl, toEl, card, duration = 560) {
    if (!fromEl || !toEl) return;
    const a = centerOf(fromEl);
    const b = centerOf(toEl);
    if (!a.ok || !b.ok) return;
    const { w, h } = cardSize();
    const wrap = document.createElement('div');
    wrap.className = 'fly-wrap';
    wrap.style.cssText =
      `position:fixed;left:${a.x - w / 2}px;top:${a.y - h / 2}px;` +
      `width:${w}px;height:${h}px;z-index:2100;pointer-events:none;`;
    const c = cardEl(card);
    c.style.width = '100%';
    c.style.height = '100%';
    c.style.transition = 'none';
    const hand = document.createElement('div');
    hand.className = 'steal-hand';
    hand.textContent = '✋';
    wrap.appendChild(c);
    wrap.appendChild(hand);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.style.transition = `transform ${duration}ms cubic-bezier(0.45, 0.05, 0.3, 1)`;
      wrap.style.transform = `translate(${b.x - a.x}px, ${b.y - a.y}px)`;
    });
    setTimeout(() => wrap.remove(), duration + 60);
  }

  // Small kick on the deck when a card is drawn from it
  function deckPop() {
    const back = $('#deck-pile .card-back');
    if (!back) return;
    back.classList.add('draw-pop');
    setTimeout(() => back.classList.remove('draw-pop'), 240);
  }

  /* ---------- score screen ---------- */
  function showScores() {
    const result = snap.roundResult;
    if (!result) return;
    const over = snap.phase === 'gameOver';

    $('#score-title').textContent = over ? '🏁 ¡FIN DEL JUEGO! 🏁' : `FIN DE RONDA ${snap.round}`;
    let sub = '';
    if (result.reason === 'mateo') {
      const caller = snap.players[result.caller].name.toUpperCase();
      sub = result.callerWon
        ? `📣 ${caller} cantó ¡MATEO! y acertó: 0 puntos`
        : `📣 ${caller} cantó ¡MATEO! y falló: suma sus cartas +15 de penitencia`;
    } else if (result.reason === 'empty') {
      sub = 'Alguien se deshizo de todas sus cartas: −10 puntos';
    } else if (result.reason === 'deck') {
      sub = 'Se agotó el mazo: cada quien suma el valor de sus cartas';
    }
    if (over) {
      sub = `🏆 GANA ${snap.gameOver.winner.toUpperCase()} · 💀 ${snap.gameOver.loser.toUpperCase()} llegó a 100 y pierde`;
    }
    $('#score-subtitle').textContent = sub;

    const tbody = $('#score-table tbody');
    tbody.innerHTML = '';
    // Lowest total first: the leader is whoever is furthest from losing
    const rows = result.rows
      .map((r, i) => ({ ...r, idx: i }))
      .sort((a, b) => a.total - b.total);
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (over && row.name === snap.gameOver.winner) tr.className = 'winner';
      else if (over && row.name === snap.gameOver.loser) tr.className = 'loser';
      const delta = row.points > 0 ? `+${row.points}` : `${row.points}`;
      tr.innerHTML =
        `<td>${row.name.toUpperCase()}</td><td>${delta}</td><td>${row.total}</td>`;
      tbody.appendChild(tr);
    });

    $('#btn-next-round').classList.toggle('hidden', over || !amHost());
    $('#btn-new-game').classList.toggle('hidden', !over || !amHost());
    // At game over anyone can bail back to the home screen
    $('#btn-go-home').classList.toggle('hidden', !over);
    $('#score-hint').textContent = amHost() ? '' : over
      ? 'el anfitrión puede iniciar otro juego'
      : 'esperando a que el anfitrión inicie la siguiente ronda…';
    if (over) AudioFX.lose(); else AudioFX.win();
    show('score');

    // Coin rewards (once per round): +3 for a good round (0 or negative
    // points), +10 for winning the whole game. Guarded so re-renders don't
    // re-award.
    const key = `${snap.round}:${result.reason}`;
    if (key !== lastScoredKey) {
      lastScoredKey = key;
      const myRow = result.rows[myIdx];
      if (myRow && myRow.points <= 0) Economy.earn(20, 'ronda ganada');
      const me = snap.players[myIdx];
      if (over && me && snap.gameOver.winner === me.name) {
        Economy.earn(50, '¡PARTIDA GANADA!');
      }
    }
  }

  /* ---------- lobby wiring ---------- */
  function lobbyError(text) {
    $('#lobby-error').textContent = text;
  }

  $('#btn-create').addEventListener('click', () => {
    AudioFX.unlock();
    AudioFX.click();
    myName = $('#my-name').value.trim();
    if (!myName) return lobbyError('escribe tu nombre primero');
    lobbyError('');
    $('#btn-create').disabled = true;
    Net.createRoom(myName, (err, code) => {
      $('#btn-create').disabled = false;
      if (err) {
        return lobbyError(err.type === 'version'
          ? 'tu página está desactualizada: recárgala (Cmd/Ctrl+Shift+R)'
          : 'sin conexión con el servidor de salas, intenta de nuevo en un momento');
      }
      roomCode = code;
      $('#room-code').textContent = code;
    });
  });

  /* ---------- vs CPU setup ---------- */
  let cpuCount = 1;
  let cpuDiff = 'facil';

  function openCpuModal() {
    AudioFX.unlock();
    AudioFX.click();
    $('#cpu-modal').classList.remove('hidden');
  }

  function closeCpuModal() {
    $('#cpu-modal').classList.add('hidden');
  }

  // Wire the two option rows (single-select toggle buttons)
  function wireCpuOptions(rowSel, attr, setter) {
    document.querySelectorAll(`${rowSel} .cpu-opt`).forEach((btn) => {
      btn.addEventListener('click', () => {
        AudioFX.click();
        document.querySelectorAll(`${rowSel} .cpu-opt`).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        setter(btn.dataset[attr]);
      });
    });
  }

  function startCpuGame() {
    AudioFX.unlock();
    AudioFX.click();
    myName = $('#my-name').value.trim();
    if (!myName) {
      closeCpuModal();
      return lobbyError('escribe tu nombre primero');
    }
    lobbyError('');
    const btn = $('#btn-cpu-start');
    btn.disabled = true;
    soloAutoBegin = true; // set BEFORE creating: the lobby event can beat the ack
    Net.createRoom(myName, { count: cpuCount, difficulty: cpuDiff }, (err, code) => {
      btn.disabled = false;
      if (err) {
        soloAutoBegin = false;
        closeCpuModal();
        return lobbyError(err.type === 'version'
          ? 'tu página está desactualizada: recárgala (Cmd/Ctrl+Shift+R)'
          : 'sin conexión con el servidor de salas, intenta de nuevo en un momento');
      }
      roomCode = code;
      $('#room-code').textContent = code;
      closeCpuModal();
    });
  }

  function tryJoin() {
    AudioFX.unlock();
    AudioFX.click();
    myName = $('#my-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!myName) return lobbyError('escribe tu nombre primero');
    if (code.length !== 4) return lobbyError('el código tiene 4 caracteres');
    lobbyError('');
    $('#btn-join').disabled = true;
    Net.joinRoom(code, myName, (err) => {
      $('#btn-join').disabled = false;
      if (err) {
        const errors = {
          'not-found': 'sala no encontrada: revisa el código',
          'started': 'la partida ya comenzó (si estabas jugando, usa tu mismo nombre para volver)',
          'full': 'la sala está llena',
          'version': 'tu página está desactualizada: recárgala (Cmd/Ctrl+Shift+R)',
          'timeout': 'sin conexión con el servidor de salas: revisa tu internet e intenta de nuevo',
        };
        return lobbyError(errors[err.type] || 'no se pudo entrar a la sala, intenta de nuevo');
      }
      roomCode = code;
      $('#room-code').textContent = code;
    });
  }

  async function copyRoomCode() {
    const code = (roomCode || $('#room-code').textContent).trim();
    if (!code || code === '····' || code.length !== 4) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    AudioFX.click();
    const codeEl = $('#room-code');
    const shareEl = $('#wait-share');
    const prev = shareEl.textContent;
    codeEl.classList.add('copied');
    shareEl.textContent = '¡código copiado!';
    setTimeout(() => {
      codeEl.classList.remove('copied');
      shareEl.textContent = prev;
    }, 2000);
  }

  $('#room-code').addEventListener('click', copyRoomCode);

  $('#btn-join').addEventListener('click', tryJoin);

  $('#btn-vs-cpu').addEventListener('click', openCpuModal);
  $('#btn-cpu-cancel').addEventListener('click', () => { AudioFX.click(); closeCpuModal(); });
  $('#btn-cpu-start').addEventListener('click', startCpuGame);
  wireCpuOptions('#cpu-count', 'count', (v) => { cpuCount = parseInt(v, 10) || 1; });
  wireCpuOptions('#cpu-diff', 'diff', (v) => { cpuDiff = v; });

  $('#join-code').addEventListener('input', (e) => {
    const el = e.target;
    const next = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (el.value !== next) el.value = next;
  });

  $('#join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryJoin();
  });

  $('#btn-begin').addEventListener('click', () => {
    AudioFX.click();
    send({ a: 'begin' });
  });

  $('#btn-next-round').addEventListener('click', () => {
    AudioFX.click();
    send({ a: 'nextRound' });
  });

  $('#btn-new-game').addEventListener('click', () => {
    AudioFX.click();
    send({ a: 'newGame' });
  });

  // Leave the table and return to a fresh home screen
  $('#btn-go-home').addEventListener('click', () => {
    AudioFX.click();
    location.href = location.pathname;
  });

  // Always-on taunt button: opens the dance / tomato menu
  $('#btn-taunt').addEventListener('click', toggleTauntMenu);
  // Close the menu when clicking elsewhere
  document.addEventListener('click', (e) => {
    const menu = $('#taunt-menu');
    if (menu.classList.contains('hidden')) return;
    if (e.target.closest('#taunt-menu') || e.target.closest('#btn-taunt')) return;
    closeTauntMenu();
  });

  $('#deck-pile').addEventListener('click', () => {
    if (snap && snap.phase === 'turn' && snap.current === myIdx) send({ a: 'draw' });
  });

  // Spacebar = QUEMAR when a burn is available (ignored while typing in a field
  // or while a dialog is up).
  function canBurnNow() {
    return snap && screens.game.classList.contains('active') &&
      snap.phase === 'turn' && snap.burnTarget &&
      snap.players[myIdx] && snap.players[myIdx].hand.length > 0 && !modalVisible();
  }
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if (!canBurnNow()) return;
    e.preventDefault();
    AudioFX.click();
    send({ a: 'burnStart' });
  });

  $('#btn-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.remove('hidden');
  });
  $('#btn-close-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.add('hidden');
  });

  /* ---------- network messages ---------- */
  Net.on('lobby', onLobby);
  Net.on('state', onState);
  Net.on('event', onEvent);
  Net.on('rejected', (msg) => {
    show('lobby');
    const reasons = {
      closed: 'el anfitrión cerró la sala',
      started: 'la partida ya comenzó',
      full: 'la sala está llena',
    };
    lobbyError(reasons[msg.reason] || 'no se pudo entrar a la sala');
  });
  // Transient connection drops: Socket.IO reconnects and Net auto-rejoins
  Net.on('_dropped', (info) => {
    if (info.fatal) {
      alert('Se perdió la sesión con el servidor');
      location.reload();
      return;
    }
    if (snap) flash('⚠ CONEXIÓN PERDIDA… reconectando', 8000);
  });
  Net.on('_connected', () => {
    if (snap) flash('✔ RECONECTADO', 2500);
  });

  /* ---------- invite URL ---------- */
  // Pre-fill room code if the page was opened with ?room=XXXX
  (() => {
    const param = new URLSearchParams(location.search).get('room');
    if (param && /^[A-Z0-9]{4}$/i.test(param)) {
      const codeEl = $('#join-code');
      codeEl.value = param.toUpperCase();
      codeEl.readOnly = true;
      codeEl.style.color = 'var(--neon-yellow)';
      $('#my-name').focus();
    }
  })();

  async function shareInviteUrl() {
    const code = (roomCode || $('#room-code').textContent).trim();
    if (!code || code === '····' || code.length !== 4) return;
    const url = `${location.origin}${location.pathname}?room=${code}`;
    const btn = $('#btn-share-url');
    const prev = btn.textContent;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Mateo', text: '¡Unite a mi partida de Mateo!', url });
        Economy.earnShare(code);
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    AudioFX.click();
    Economy.earnShare(code);
    btn.classList.add('copied');
    btn.textContent = '¡ENLACE COPIADO!';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = prev; }, 2000);
  }

  $('#btn-share-url').addEventListener('click', shareInviteUrl);

  return { onLobby, onState, onEvent };
})();
