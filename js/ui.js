/* ============ UI: rendering, interactions, animations, sounds ============ */
const UI = (() => {
  const $ = (sel) => document.querySelector(sel);
  const S = Game.state;

  let revealed = new Set(); // keys "player-card" currently face up
  let revealAll = false;
  let busy = false;         // input locked during timed animations
  let modalOpen = false;
  let lastTurn = -1;

  const screens = {
    lobby: $('#screen-lobby'),
    game: $('#screen-game'),
    score: $('#screen-score'),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  const key = (p, i) => `${p}-${i}`;

  /* ---------- card element ---------- */
  function cardEl(card, faceUp) {
    const el = document.createElement('div');
    el.className = 'card' + (faceUp ? ' flipped' : '');
    const back = document.createElement('div');
    back.className = 'back';
    const face = document.createElement('div');
    face.className = 'face' + (isRedSuit(card.suit) ? ' red' : '');
    face.innerHTML =
      `<span class="corner">${card.rank}<br>${card.suit}</span>` +
      `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>` +
      `<span class="corner-b">${card.rank}<br>${card.suit}</span>`;
    el.appendChild(back);
    el.appendChild(face);
    return el;
  }

  /* ---------- selectable logic per phase ---------- */
  function isSelectable(p, i) {
    if (busy || modalOpen) return false;
    const me = S.current;
    switch (S.phase) {
      case 'peek': {
        const pl = S.players[p];
        return !pl.ready && pl.peeked.size < 2 && !pl.peeked.has(i);
      }
      case 'drawn':
      case 'swapDiscard':
        return p === me;
      case 'combine':
        return p === me && !S.ctx.combinePicks.includes(i);
      case 'power7':
      case 'power9a':
        return p === me;
      case 'power8':
      case 'power9b':
        return p !== me;
      case 'burn':
        return p === S.ctx.burner;
      default:
        return false;
    }
  }

  /* ---------- render ---------- */
  function render() {
    // Seats
    S.players.forEach((pl, p) => {
      const seat = $(`#seat-${p}`);
      seat.classList.toggle('active-turn',
        p === S.current && !['peek', 'roundEnd', 'gameOver'].includes(S.phase));
      seat.querySelector('.player-name').textContent = pl.name.toUpperCase();
      seat.querySelector('.player-score').textContent = `${pl.score}pts`;

      const hand = seat.querySelector('.hand');
      hand.innerHTML = '';
      pl.hand.forEach((card, i) => {
        const faceUp = revealAll || revealed.has(key(p, i)) || pl.peeked.has(i);
        const el = cardEl(card, faceUp);
        if (isSelectable(p, i)) {
          el.classList.add('selectable');
          el.addEventListener('click', () => onCardClick(p, i));
        }
        if (S.phase === 'combine' && p === S.current && S.ctx.combinePicks.includes(i)) {
          el.classList.add('selected');
        }
        if (S.phase === 'power9b' && p === S.current && S.ctx.swapOwn === i) {
          el.classList.add('selected');
        }
        hand.appendChild(el);
      });

      // Per-seat buttons
      const actions = seat.querySelector('.seat-actions');
      actions.innerHTML = '';
      if (S.phase === 'peek' && !pl.ready) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-success';
        btn.textContent = '✔ LISTO';
        btn.addEventListener('click', () => onReady(p));
        actions.appendChild(btn);
      } else if (S.phase === 'peek' && pl.ready) {
        actions.innerHTML = '<span style="font-size:7px;color:var(--neon-green)">✔ LISTO</span>';
      }
      if (S.phase === 'turn' && !busy && Game.discardTop() && pl.hand.length > 0) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-warn';
        btn.textContent = '🔥';
        btn.title = 'Quemar el descarte';
        btn.addEventListener('click', () => onStartBurn(p));
        actions.appendChild(btn);
      }
    });

    renderCenter();
    renderBanner();
    renderActions();
    renderMessage();
    $('#round-indicator').textContent = `RONDA ${S.round}`;
  }

  function renderCenter() {
    $('#deck-count').textContent = `(${S.deck.length})`;
    $('#deck-pile').classList.toggle('clickable', S.phase === 'turn' && !busy);

    const pile = $('#discard-pile');
    pile.innerHTML = '';
    const top = Game.discardTop();
    if (top) {
      const el = cardEl(top, true);
      pile.appendChild(el);
    } else {
      pile.innerHTML = '<div class="pile-empty">DESCARTE</div>';
    }
    const label = document.createElement('span');
    label.className = 'pile-label';
    label.textContent = 'DESCARTE';
    pile.appendChild(label);

    // Floating drawn card while selecting (modal closed)
    let drawnPile = $('#drawn-float');
    if (drawnPile) drawnPile.remove();
    if (S.drawn && !modalOpen) {
      drawnPile = document.createElement('div');
      drawnPile.className = 'pile';
      drawnPile.id = 'drawn-float';
      drawnPile.appendChild(cardEl(S.drawn, true));
      const l = document.createElement('span');
      l.className = 'pile-label';
      l.textContent = 'ROBADA';
      drawnPile.appendChild(l);
      $('.table-center').appendChild(drawnPile);
    }
  }

  function renderBanner() {
    const banner = $('#turn-banner');
    const inTurn = !['peek', 'roundEnd', 'gameOver', 'lobby'].includes(S.phase);
    banner.classList.toggle('hidden', !inTurn);
    if (inTurn) {
      banner.textContent = `▶ TU TURNO: ${Game.currentPlayer().name.toUpperCase()} ◀`;
      if (lastTurn !== S.current) {
        lastTurn = S.current;
        banner.style.animation = 'none';
        void banner.offsetWidth; // restart pop animation
        banner.style.animation = '';
        AudioFX.turn();
      }
    } else {
      lastTurn = -1;
    }
  }

  function renderActions() {
    const bar = $('#action-bar');
    bar.innerHTML = '';
    if (busy || modalOpen) return;

    const addBtn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = text;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };

    if (S.phase === 'turn') {
      addBtn('🂠 ROBAR', '', onDraw);
      if (Game.discardTop()) addBtn('⬆ TOMAR DESCARTE', 'btn-small', onTakeDiscard);
      addBtn('📣 ¡MATEO!', 'btn-danger', onMateo);
    }
    if (['burn', 'combine', 'power7', 'power8', 'power9a', 'power9b'].includes(S.phase)) {
      addBtn('✖ CANCELAR', 'btn-small', onCancel);
    }
  }

  function renderMessage() {
    const name = S.players.length ? Game.currentPlayer().name.toUpperCase() : '';
    const msgs = {
      peek: 'MEMORIZA: cada jugador voltea 2 de sus cartas y pulsa LISTO',
      turn: `${name}: roba del mazo, toma el descarte, grita MATEO… o cualquiera puede 🔥 quemar`,
      drawn: 'Elige cuál de tus cartas reemplazar',
      swapDiscard: 'Tomaste el descarte: elige cuál de tus cartas reemplazar',
      combine: `COMBINAR: elige las 2 cartas que crees que son ${S.drawn ? S.drawn.rank : ''}`,
      power7: 'PODER 7: mira una de TUS cartas',
      power8: 'PODER 8: mira una carta de OTRO jugador',
      power9a: 'PODER 9: elige una carta TUYA para intercambiar',
      power9b: 'PODER 9: ahora elige la carta de OTRO jugador',
      burn: S.ctx.burner != null
        ? `🔥 ${S.players[S.ctx.burner].name.toUpperCase()}: elige tu carta a quemar (¿es un ${Game.discardTop()?.rank}?)`
        : '',
    };
    if (!busy) setMessage(msgs[S.phase] || '');
  }

  function setMessage(text) {
    $('#message-bar').textContent = text;
  }

  /* ---------- interactions ---------- */
  function onCardClick(p, i) {
    if (busy || modalOpen) return;
    switch (S.phase) {
      case 'peek': {
        if (Game.peekCard(p, i)) { AudioFX.flip(); render(); }
        break;
      }
      case 'drawn':
      case 'swapDiscard': {
        if (p !== S.current) return;
        const res = Game.swapWithDrawn(i);
        AudioFX.swap();
        slamDiscard();
        afterAction(res);
        break;
      }
      case 'combine':
        handleCombinePick(p, i);
        break;
      case 'power7':
      case 'power8':
      case 'power9a':
      case 'power9b':
        handlePowerTarget(p, i);
        break;
      case 'burn':
        handleBurnPick(p, i);
        break;
    }
  }

  function onReady(p) {
    AudioFX.click();
    const res = Game.setReady(p);
    if (res === 'allReady') {
      setMessage('¡QUE COMIENCE EL JUEGO!');
      AudioFX.win();
    }
    render();
  }

  function onDraw() {
    if (S.phase !== 'turn' || busy) return;
    const res = Game.drawFromDeck();
    if (!res) return;
    if (!res.rank) { roundEndFlow(); return; } // deck exhausted → round over
    AudioFX.draw();
    openDrawnModal();
  }

  function onTakeDiscard() {
    if (S.phase !== 'turn' || busy) return;
    const card = Game.takeDiscard();
    if (!card) return;
    AudioFX.draw();
    render();
  }

  function onMateo() {
    if (S.phase !== 'turn' || busy) return;
    AudioFX.mateo();
    Game.declareMateo();
    roundEndFlow();
  }

  function onStartBurn(p) {
    if (Game.startBurn(p)) { AudioFX.click(); render(); }
  }

  function onCancel() {
    AudioFX.click();
    const wasDrawnSelect = ['combine', 'power7', 'power8', 'power9a', 'power9b'].includes(S.phase);
    if (Game.cancelSelect()) {
      if (wasDrawnSelect) openDrawnModal();
      else render();
    }
  }

  /* ---------- drawn card modal ---------- */
  function openDrawnModal() {
    modalOpen = true;
    const modal = $('#drawn-modal');
    const slot = $('#drawn-card-slot');
    slot.innerHTML = '';
    slot.appendChild(cardEl(S.drawn, true));

    const isWild = S.drawn.rank === 'Q' && S.drawn.suit === '♥';
    const hints = {
      '7': 'PODER: ver una de tus cartas',
      '8': 'PODER: ver una carta de otro jugador',
      '9': 'PODER: intercambio a ciegas con otro jugador',
    };
    $('#drawn-hint').textContent = isWild
      ? '★ Q DE CORAZONES: ¡COMODÍN, VALE 0! ★'
      : hints[S.drawn.rank] || `Valor: ${cardValue(S.drawn)} puntos`;

    const actions = $('#drawn-actions');
    actions.innerHTML = '';
    const addBtn = (text, cls, fn) => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.textContent = text;
      b.addEventListener('click', fn);
      actions.appendChild(b);
    };

    addBtn('⇄ CAMBIAR', 'btn-success', () => { closeDrawnModal(); render(); });
    if (Game.canUsePower()) {
      addBtn(`★ USAR PODER ${S.drawn.rank}`, 'btn-warn', () => {
        AudioFX.power();
        Game.usePower();
        closeDrawnModal();
        render();
      });
    }
    addBtn('♦♦♦ COMBINAR TRÍO', 'btn-small', () => {
      Game.startCombine();
      closeDrawnModal();
      render();
    });
    addBtn('↓ DESCARTAR', 'btn-danger', () => {
      const res = Game.discardDrawn();
      AudioFX.discard();
      closeDrawnModal();
      slamDiscard();
      afterAction(res);
    });

    modal.classList.remove('hidden');
    render();
  }

  function closeDrawnModal() {
    modalOpen = false;
    $('#drawn-modal').classList.add('hidden');
  }

  /* ---------- powers ---------- */
  function handlePowerTarget(p, i) {
    const res = Game.powerTarget(p, i);
    if (!res) return;
    if (res.type === 'pickedOwn') { AudioFX.click(); render(); return; }
    if (res.type === 'blindSwap') {
      AudioFX.swap();
      setMessage('¡CARTAS INTERCAMBIADAS A CIEGAS!');
      busyFor(1200, () => afterAction(res));
      render();
      return;
    }
    // peekOwn / peekOther: reveal for a moment
    AudioFX.power();
    AudioFX.flip();
    revealed.add(key(res.player, res.card));
    setMessage('MEMORÍZALA…');
    busyFor(2500, () => {
      revealed.delete(key(res.player, res.card));
      AudioFX.flip();
      afterAction(res);
    });
    render();
  }

  /* ---------- combine ---------- */
  function handleCombinePick(p, i) {
    const res = Game.combinePick(i);
    if (!res) return;
    if (res.type === 'picked') { AudioFX.click(); render(); return; }

    if (res.type === 'combineOk') {
      AudioFX.combine();
      slamDiscard();
      setMessage(`¡TRÍO DE ${res.cards[0].rank}! ${cardLabel(res.cards[0])} ${cardLabel(res.cards[1])} fuera de juego`);
      busyFor(1800, () => afterAction(res));
      render();
      return;
    }
    // combineFail: show the two wrong cards, shake, penalty already applied
    AudioFX.burnFail();
    res.revealed.forEach((idx) => revealed.add(key(S.current, idx)));
    setMessage(`¡FALLÓ EL TRÍO! Eran ${cardLabel(res.cards[0])} y ${cardLabel(res.cards[1])} → +1 carta de castigo`);
    shakeHand(S.current);
    busyFor(2200, () => {
      res.revealed.forEach((idx) => revealed.delete(key(S.current, idx)));
      afterAction(res);
    });
    render();
  }

  /* ---------- burn ---------- */
  function handleBurnPick(p, i) {
    const burner = p;
    const res = Game.burnPick(i);
    if (!res) return;

    if (res.type === 'burnOk') {
      AudioFX.burnOk();
      slamDiscard();
      setMessage(`🔥 ¡${S.players[burner].name.toUpperCase()} QUEMÓ ${cardLabel(res.card)}!`);
      busyFor(1500, () => {
        if (res.roundEnd) roundEndFlow();
        else render();
      });
      render();
      return;
    }
    // burnFail: card stays, show it briefly + penalty card
    AudioFX.burnFail();
    revealed.add(key(burner, i));
    setMessage(`❌ ${S.players[burner].name.toUpperCase()} FALLÓ: era ${cardLabel(res.card)} → +1 carta de castigo`);
    shakeHand(burner);
    busyFor(2200, () => {
      revealed.delete(key(burner, i));
      render();
    });
    render();
  }

  /* ---------- flow helpers ---------- */
  function afterAction(res) {
    if (res && (res.roundEnd || res.endTurn)) {
      roundEndFlow();
    } else {
      render();
    }
  }

  function busyFor(ms, then) {
    busy = true;
    setTimeout(() => { busy = false; then(); }, ms);
  }

  function slamDiscard() {
    requestAnimationFrame(() => {
      const top = $('#discard-pile .card');
      if (top) { top.classList.add('slam'); AudioFX.discard(); }
    });
  }

  function shakeHand(p) {
    requestAnimationFrame(() => {
      $(`#seat-${p}`).querySelectorAll('.card').forEach((c) => c.classList.add('shake'));
    });
  }

  /* ---------- round end / scores ---------- */
  function roundEndFlow() {
    const result = S.roundResult;
    if (!result) { render(); return; }
    revealAll = true;
    closeDrawnModal();

    let msg = '¡FIN DE RONDA! Todas las cartas reveladas…';
    if (result.reason === 'mateo') {
      const caller = S.players[result.caller].name.toUpperCase();
      msg = result.success
        ? `📣 ¡${caller} CANTÓ MATEO Y GANÓ LA RONDA!`
        : `📣 ¡${caller} CANTÓ MATEO Y FALLÓ! +15 de castigo`;
      if (result.success) AudioFX.win(); else AudioFX.lose();
    } else if (result.reason === 'empty') {
      msg = '🏆 ¡UN JUGADOR SE QUEDÓ SIN CARTAS!';
      AudioFX.win();
    }
    setMessage(msg);
    busyFor(3200, showScores);
    render();
  }

  function showScores() {
    revealAll = false;
    revealed = new Set();
    const result = S.roundResult;
    const over = S.phase === 'gameOver';

    $('#score-title').textContent = over ? '☠ GAME OVER ☠' : `FIN DE RONDA ${S.round}`;
    let sub = '';
    if (result.reason === 'mateo') {
      const caller = S.players[result.caller].name.toUpperCase();
      sub = result.success ? `${caller} cantó MATEO con éxito` : `${caller} falló su MATEO (+15)`;
    }
    if (over) sub = `🏆 GANA ${S.gameOver.winner.toUpperCase()} · PIERDE ${S.gameOver.loser.toUpperCase()}`;
    $('#score-subtitle').textContent = sub;

    const tbody = $('#score-table tbody');
    tbody.innerHTML = '';
    result.rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (over && row.name === S.gameOver.winner) tr.className = 'winner';
      if (over && row.name === S.gameOver.loser) tr.className = 'loser';
      tr.innerHTML = `<td>${row.name.toUpperCase()}</td><td>+${row.roundScore}</td><td>${row.total}</td>`;
      tbody.appendChild(tr);
    });

    $('#btn-next-round').classList.toggle('hidden', over);
    $('#btn-new-game').classList.toggle('hidden', !over);
    if (over) AudioFX.lose();
    show('score');
  }

  /* ---------- deal animation ---------- */
  function dealAnimation() {
    AudioFX.shuffle();
    render();
    document.querySelectorAll('.hand .card').forEach((c, i) => {
      c.classList.add('dealing');
      c.style.animationDelay = `${i * 0.07}s`;
      if (i % 4 === 0) AudioFX.deal(i / 4);
    });
  }

  /* ---------- wiring ---------- */
  $('#btn-start').addEventListener('click', () => {
    AudioFX.unlock();
    AudioFX.click();
    const names = [0, 1, 2, 3].map((i) => $(`#name-${i}`).value.trim() || `Jugador ${i + 1}`);
    Game.setup(names);
    revealed = new Set();
    revealAll = false;
    busy = false;
    lastTurn = -1;
    show('game');
    dealAnimation();
  });

  $('#btn-next-round').addEventListener('click', () => {
    AudioFX.click();
    Game.nextRound();
    revealed = new Set();
    revealAll = false;
    lastTurn = -1;
    show('game');
    dealAnimation();
  });

  $('#btn-new-game').addEventListener('click', () => {
    AudioFX.click();
    show('lobby');
  });

  $('#deck-pile').addEventListener('click', onDraw);
  $('#btn-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.remove('hidden');
  });
  $('#btn-close-rules').addEventListener('click', () => {
    AudioFX.click();
    $('#rules-modal').classList.add('hidden');
  });

  // Dev helper: open with #autostart to skip the lobby
  if (location.hash === '#autostart') $('#btn-start').click();

  return { render };
})();
