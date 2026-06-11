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

  /* ---------- dispatch: local for host, network for guests ---------- */
  function send(action) {
    if (Net.isHost) Host.handleAction(myIdx, action);
    else Net.sendToHost({ t: 'action', ...action });
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

  /* ---------- render ---------- */
  function render() {
    if (!snap) return;
    const inPlay = !['peek', 'roundEnd', 'gameOver'].includes(snap.phase);

    document.querySelectorAll('.seat').forEach((s) => (s.style.display = 'none'));
    snap.players.forEach((pl, p) => {
      const seat = seatFor(p);
      seat.style.display = '';
      seat.classList.toggle('active-turn', p === snap.current && inPlay);
      seat.querySelector('.player-name').textContent =
        (p === myIdx ? '★ ' : '') + pl.name.toUpperCase();
      seat.querySelector('.player-score').textContent =
        snap.phase === 'peek' ? (pl.ready ? '✔ LISTO' : '…') : `${pl.score}pts`;

      const hand = seat.querySelector('.hand');
      hand.innerHTML = '';
      pl.hand.forEach((card, i) => {
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
    $('#round-indicator').textContent = `RONDA ${snap.round} · SALA ${roomCode}`;
  }

  function renderCenter() {
    $('#deck-count').textContent = `(${snap.deckCount})`;
    $('#deck-pile').classList.toggle('clickable',
      snap.phase === 'turn' && snap.current === myIdx);

    const pile = $('#discard-pile');
    pile.innerHTML = '';
    if (snap.discardTop) {
      pile.appendChild(cardEl(snap.discardTop));
    } else {
      pile.innerHTML = '<div class="pile-empty">DESCARTE</div>';
    }
    const label = document.createElement('span');
    label.className = 'pile-label';
    label.textContent = 'DESCARTE';
    pile.appendChild(label);

    // Drawn card: face up for the drawer, face down for everyone else
    let float = $('#drawn-float');
    if (float) float.remove();
    if (snap.drawn && !modalVisible()) {
      float = document.createElement('div');
      float.className = 'pile';
      float.id = 'drawn-float';
      float.appendChild(cardEl(snap.drawn === true ? null : snap.drawn));
      const l = document.createElement('span');
      l.className = 'pile-label';
      l.textContent = 'ROBADA';
      float.appendChild(l);
      $('.table-center').appendChild(float);
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

    if (snap.phase === 'peek' && !me.ready) {
      addBtn('✔ CONFIRMAR', 'btn-success', () => { AudioFX.click(); send({ a: 'ready' }); });
    }
    if (snap.phase === 'turn') {
      if (isCurrent) {
        addBtn('🂠 ROBAR', '', () => send({ a: 'draw' }));
        if (snap.discardTop) addBtn('⬆ TOMAR DESCARTE', 'btn-small', () => send({ a: 'takeDiscard' }));
        addBtn('📣 ¡MATEO!', 'btn-danger', () => send({ a: 'mateo' }));
      }
      if (snap.discardTop && me.hand.length > 0) {
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
  }

  function renderMessage() {
    if (msgOverride && Date.now() < msgOverride.until) {
      $('#message-bar').textContent = msgOverride.text;
      return;
    }
    msgOverride = null;
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
      case 'turn':
        msg = isCurrent
          ? 'Roba del mazo, toma el descarte, quema o grita ¡MATEO!'
          : `${curName} está jugando… (puedes 🔥 QUEMAR el descarte)`;
        break;
      case 'drawn':
        msg = isCurrent
          ? (swapMode ? 'Elige cuál de tus cartas reemplazar' : '')
          : `${curName} robó una carta y está decidiendo…`;
        break;
      case 'swapDiscard':
        msg = isCurrent
          ? 'Tomaste el descarte: elige cuál de tus cartas reemplazar'
          : `${curName} tomó el descarte…`;
        break;
      case 'combine':
        msg = isCurrent
          ? 'COMBINAR: elige las 2 cartas que crees que hacen trío'
          : `${curName} intenta combinar un trío…`;
        break;
      case 'power7':
        msg = isCurrent ? 'PODER 7: toca una de TUS cartas para verla' : `${curName} usa el PODER 7…`;
        break;
      case 'power8':
        msg = isCurrent ? 'PODER 8: toca una carta de OTRO jugador para verla' : `${curName} usa el PODER 8… ¡cuidado!`;
        break;
      case 'power9a':
        msg = isCurrent ? 'PODER 9: elige una carta TUYA para intercambiar' : `${curName} usa el PODER 9…`;
        break;
      case 'power9b':
        msg = isCurrent ? 'PODER 9: ahora elige la carta de OTRO jugador' : `${curName} usa el PODER 9…`;
        break;
      case 'burn':
        msg = snap.ctx.burner === myIdx
          ? `🔥 Elige tu carta a quemar (¿tienes un ${snap.discardTop?.rank}?)`
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
  function openDrawnModal() {
    const card = snap.drawn;
    if (!card || card === true) return;
    const slot = $('#drawn-card-slot');
    slot.innerHTML = '';
    slot.appendChild(cardEl(card));

    const isWild = card.rank === 'Q' && card.suit === '♥';
    const hints = {
      '7': 'PODER: ver una de tus cartas',
      '8': 'PODER: ver una carta de otro jugador',
      '9': 'PODER: intercambio a ciegas con otro jugador',
    };
    $('#drawn-hint').textContent = isWild
      ? '★ Q DE CORAZONES: ¡COMODÍN, VALE 0! ★'
      : hints[card.rank] || `Valor: ${cardValue(card)} puntos`;

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
    render();
  }

  function closeDrawnModal() {
    $('#drawn-modal').classList.add('hidden');
  }

  /* ---------- host messages: lobby / state / events ---------- */
  function onLobby(msg) {
    myIdx = msg.you;
    const list = $('#wait-list');
    list.innerHTML = '';
    msg.players.forEach((name, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${name.toUpperCase()}${i === 0 ? ' 👑' : ''}${i === msg.you ? ' (TÚ)' : ''}`;
      list.appendChild(li);
    });
    for (let i = msg.players.length; i < 4; i++) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = `${i + 1}. esperando…`;
      list.appendChild(li);
    }
    const begin = $('#btn-begin');
    if (Net.isHost) {
      begin.classList.remove('hidden');
      begin.disabled = msg.players.length < 2;
      $('#wait-hint').textContent = msg.players.length < 2
        ? 'se necesitan al menos 2 jugadores'
        : '¡puedes comenzar cuando estén todos!';
    } else {
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

    // Round end: reveal everything on the table, then show scores
    if ((s.phase === 'roundEnd' || s.phase === 'gameOver') && phaseChanged) {
      closeDrawnModal();
      show('game');
      render();
      setTimeout(showScores, 3400);
      return;
    }
    if (s.phase === 'roundEnd' || s.phase === 'gameOver') return;

    if (phaseChanged && s.phase === 'peek') {
      show('game');
      started = true;
    }

    // Drawn modal only for the active player who just drew from the deck
    if (s.phase === 'drawn' && s.current === myIdx && s.drawn !== true && !swapMode) {
      openDrawnModal();
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
      case 'draw': AudioFX.draw(); break;
      case 'tookDiscard': AudioFX.draw(); flash(`${name(ev.player)} tomó el descarte`); break;
      case 'discard': AudioFX.discard(); slamDiscard(); break;
      case 'swap': AudioFX.swap(); break;
      case 'power': AudioFX.power(); flash(`★ ${name(ev.player)} usa el PODER ${ev.rank}`); break;
      case 'peeked': flash(`👁 ${name(ev.player)} miró una carta de ${name(ev.target)}`); break;
      case 'blindSwap':
        AudioFX.swap();
        flash(`⇄ ${name(ev.player)} intercambió una carta a ciegas con ${name(ev.target)}`);
        break;
      case 'burnOk':
        AudioFX.burnOk();
        slamDiscard();
        flash(`🔥 ¡${name(ev.player)} QUEMÓ ${cardLabel(ev.card)}!`);
        break;
      case 'burnFail':
        AudioFX.burnFail();
        shakeSeat(ev.player);
        flash(`❌ ${name(ev.player)} falló el quemado (era ${cardLabel(ev.card)}) → +1 carta`);
        break;
      case 'combineOk':
        AudioFX.combine();
        slamDiscard();
        flash(`♦♦♦ ¡TRÍO DE ${ev.cards[0].rank}! ${name(ev.player)} descartó 3 cartas`);
        break;
      case 'combineFail':
        AudioFX.burnFail();
        shakeSeat(ev.player);
        flash(`❌ ${name(ev.player)} falló el trío (${cardLabel(ev.cards[0])}, ${cardLabel(ev.cards[1])}) → +1 carta`);
        break;
      case 'roundEnd':
        if (ev.reason === 'mateo') AudioFX.mateo();
        else AudioFX.win();
        flash('¡FIN DE RONDA! Revelando cartas…', 3400);
        break;
      case 'left':
        flash(`⚠ ${name(ev.player)} SE DESCONECTÓ`, 6000);
        break;
    }
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

  /* ---------- score screen ---------- */
  function showScores() {
    const result = snap.roundResult;
    if (!result) return;
    const over = snap.phase === 'gameOver';

    $('#score-title').textContent = over ? '☠ GAME OVER ☠' : `FIN DE RONDA ${snap.round}`;
    let sub = '';
    if (result.reason === 'mateo') {
      const caller = snap.players[result.caller].name.toUpperCase();
      sub = result.success ? `📣 ${caller} cantó MATEO con éxito` : `📣 ${caller} falló su MATEO (+15)`;
    } else if (result.reason === 'empty') {
      sub = '🏆 ¡alguien se quedó sin cartas!';
    }
    if (over) sub = `🏆 GANA ${snap.gameOver.winner.toUpperCase()} · PIERDE ${snap.gameOver.loser.toUpperCase()}`;
    $('#score-subtitle').textContent = sub;

    const tbody = $('#score-table tbody');
    tbody.innerHTML = '';
    result.rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (over && row.name === snap.gameOver.winner) tr.className = 'winner';
      if (over && row.name === snap.gameOver.loser) tr.className = 'loser';
      tr.innerHTML = `<td>${row.name.toUpperCase()}</td><td>+${row.roundScore}</td><td>${row.total}</td>`;
      tbody.appendChild(tr);
    });

    $('#btn-next-round').classList.toggle('hidden', over || !Net.isHost);
    $('#btn-new-game').classList.toggle('hidden', !over || !Net.isHost);
    $('#score-hint').textContent = Net.isHost ? '' : over
      ? 'el anfitrión puede iniciar otro juego'
      : 'esperando a que el anfitrión inicie la siguiente ronda…';
    if (over) AudioFX.lose();
    show('score');
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
    Net.createRoom((err, code) => {
      $('#btn-create').disabled = false;
      if (err) return lobbyError('error de conexión, intenta de nuevo');
      roomCode = code;
      $('#room-code').textContent = code;
      Host.initLobby(myName);
      Host.broadcastLobby();
    });
  });

  $('#btn-join').addEventListener('click', () => {
    AudioFX.unlock();
    AudioFX.click();
    myName = $('#my-name').value.trim();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!myName) return lobbyError('escribe tu nombre primero');
    if (code.length !== 4) return lobbyError('el código tiene 4 caracteres');
    lobbyError('');
    $('#btn-join').disabled = true;
    Net.joinRoom(code, (err) => {
      $('#btn-join').disabled = false;
      if (err) return lobbyError('sala no encontrada, revisa el código');
      roomCode = code;
      $('#room-code').textContent = code;
      Net.sendToHost({ t: 'join', name: myName });
    });
  });

  $('#btn-begin').addEventListener('click', () => {
    AudioFX.click();
    Host.startGame();
  });

  $('#btn-next-round').addEventListener('click', () => {
    AudioFX.click();
    send({ a: 'nextRound' });
  });

  $('#btn-new-game').addEventListener('click', () => {
    AudioFX.click();
    send({ a: 'newGame' });
  });

  $('#deck-pile').addEventListener('click', () => {
    if (snap && snap.phase === 'turn' && snap.current === myIdx) send({ a: 'draw' });
  });

  $('#btn-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.remove('hidden');
  });
  $('#btn-close-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.add('hidden');
  });

  /* ---------- network messages (guest side) ---------- */
  Net.on('lobby', onLobby);
  Net.on('state', onState);
  Net.on('event', onEvent);
  Net.on('rejected', (msg) => {
    show('lobby');
    lobbyError(msg.reason === 'started' ? 'la partida ya comenzó' : 'la sala está llena');
  });
  Net.on('_hostLost', () => {
    alert('Se perdió la conexión con el anfitrión');
    location.reload();
  });

  return { onLobby, onState, onEvent };
})();
