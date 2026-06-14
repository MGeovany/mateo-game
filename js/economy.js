/* ============ Economy: coins, shop, cosmetics ============
 * Wallet lives in localStorage on this device. Rewards:
 *   +10 compartir el enlace de invitación (una vez por sala)
 *   +10 ganar una ronda (terminar con 0 o menos puntos)
 *   +30 ganar la partida
 * Cosmetics are sent to the server on create/join so every player
 * sees your avatar; the HOST's table and card styles dress the whole
 * table (es su mesa).
 */
const Economy = (() => {
  const KEY = 'mateo-wallet-v1';

  /* ---------- catalog ---------- */
  const CATALOG = [
    // base avatars
    { id: 'av-default', cat: 'avatar', emoji: '🙂', name: 'CLÁSICO', price: 0 },
    { id: 'av-robot', cat: 'avatar', emoji: '🤖', name: 'ROBOT', price: 60 },
    { id: 'av-alien', cat: 'avatar', emoji: '👽', name: 'ALIEN', price: 60 },
    { id: 'av-frog', cat: 'avatar', emoji: '🐸', name: 'RANA', price: 50 },
    { id: 'av-cat', cat: 'avatar', emoji: '🐱', name: 'GATO', price: 50 },
    { id: 'av-fox', cat: 'avatar', emoji: '🦊', name: 'ZORRO', price: 60 },
    { id: 'av-skull', cat: 'avatar', emoji: '💀', name: 'CALAVERA', price: 80 },
    { id: 'av-clown', cat: 'avatar', emoji: '🤡', name: 'PAYASO', price: 70 },
    { id: 'av-invader', cat: 'avatar', emoji: '👾', name: 'INVADER', price: 90 },
    // hats
    { id: 'hat-none', cat: 'hat', emoji: '', name: 'SIN SOMBRERO', price: 0 },
    { id: 'hat-cap', cat: 'hat', emoji: '🧢', name: 'GORRA', price: 25 },
    { id: 'hat-top', cat: 'hat', emoji: '🎩', name: 'GALERA', price: 30 },
    { id: 'hat-grad', cat: 'hat', emoji: '🎓', name: 'GRADUADO', price: 35 },
    { id: 'hat-helmet', cat: 'hat', emoji: '🪖', name: 'CASCO', price: 40 },
    { id: 'hat-crown', cat: 'hat', emoji: '👑', name: 'CORONA', price: 100 },
    // facial expressions (badge)
    { id: 'face-none', cat: 'face', emoji: '', name: 'NEUTRAL', price: 0 },
    { id: 'face-cool', cat: 'face', emoji: '😎', name: 'COOL', price: 20 },
    { id: 'face-angry', cat: 'face', emoji: '😤', name: 'FURIOSO', price: 20 },
    { id: 'face-crazy', cat: 'face', emoji: '🤪', name: 'LOCO', price: 20 },
    { id: 'face-evil', cat: 'face', emoji: '😈', name: 'DIABLILLO', price: 30 },
    { id: 'face-sleepy', cat: 'face', emoji: '🥱', name: 'DORMIDO', price: 15 },
    // shoes
    { id: 'shoe-none', cat: 'shoes', emoji: '', name: 'DESCALZO', price: 0 },
    { id: 'shoe-sneaker', cat: 'shoes', emoji: '👟', name: 'TENIS', price: 25 },
    { id: 'shoe-boot', cat: 'shoes', emoji: '🥾', name: 'BOTAS', price: 25 },
    { id: 'shoe-heel', cat: 'shoes', emoji: '👠', name: 'TACONES', price: 30 },
    { id: 'shoe-cowboy', cat: 'shoes', emoji: '👢', name: 'VAQUERO', price: 30 },
    // dances (taunts shown to everyone mid-game)
    { id: 'dance-none', cat: 'dance', emoji: '', name: 'SIN BAILE', price: 0 },
    { id: 'dance-salsa', cat: 'dance', emoji: '💃', name: 'SALSA', price: 40 },
    { id: 'dance-disco', cat: 'dance', emoji: '🕺', name: 'DISCO', price: 40 },
    { id: 'dance-duck', cat: 'dance', emoji: '🦆', name: 'PATITO', price: 35 },
    { id: 'dance-chicken', cat: 'dance', emoji: '🐔', name: 'GALLINA', price: 35 },
    { id: 'dance-party', cat: 'dance', emoji: '🪩', name: 'FIESTA', price: 60 },
    // table styles (host's table dresses the room)
    { id: 'table-default', cat: 'table', emoji: '🟣', name: 'NEÓN ROSA', price: 0 },
    { id: 'table-ocean', cat: 'table', emoji: '🔵', name: 'OCÉANO', price: 80 },
    { id: 'table-matrix', cat: 'table', emoji: '🟢', name: 'MATRIX', price: 90 },
    { id: 'table-gold', cat: 'table', emoji: '🟡', name: 'ORO', price: 120 },
    { id: 'table-blood', cat: 'table', emoji: '🔴', name: 'SANGRE', price: 100 },
    // card back styles (host's deck)
    { id: 'cards-default', cat: 'cards', emoji: '🂠', name: 'AZUL CLÁSICO', price: 0 },
    { id: 'cards-red', cat: 'cards', emoji: '🟥', name: 'ROJO DIAMANTE', price: 50 },
    { id: 'cards-gold', cat: 'cards', emoji: '🟨', name: 'ORO REAL', price: 80 },
    { id: 'cards-matrix', cat: 'cards', emoji: '🟩', name: 'MATRIX', price: 70 },
    { id: 'cards-purple', cat: 'cards', emoji: '🟪', name: 'ESTRELLA PÚRPURA', price: 60 },
  ];

  const CATS = [
    { key: 'avatar', label: 'AVATAR' },
    { key: 'hat', label: 'SOMBRERO' },
    { key: 'face', label: 'CARA' },
    { key: 'shoes', label: 'ZAPATOS' },
    { key: 'dance', label: 'BAILE' },
    { key: 'table', label: 'MESA' },
    { key: 'cards', label: 'CARTAS' },
  ];

  const FREE_IDS = CATALOG.filter((x) => x.price === 0).map((x) => x.id);

  /* ---------- wallet ---------- */
  let wallet = load();

  function load() {
    try {
      const w = JSON.parse(localStorage.getItem(KEY));
      if (w && typeof w.coins === 'number') {
        w.owned = [...new Set([...w.owned, ...FREE_IDS])];
        return w;
      }
    } catch { /* corrupted: start fresh */ }
    return {
      coins: 0,
      owned: [...FREE_IDS],
      equipped: {
        avatar: 'av-default', hat: 'hat-none', face: 'face-none',
        shoes: 'shoe-none', dance: 'dance-none',
        table: 'table-default', cards: 'cards-default',
      },
      sharedRooms: [],
    };
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(wallet)); }

  function item(id) { return CATALOG.find((x) => x.id === id); }

  function earn(amount, label) {
    wallet.coins += amount;
    save();
    renderCoins();
    toast(`+${amount} 🪙 ${label}`);
    if (typeof AudioFX !== 'undefined') AudioFX.coin();
  }

  // Share reward: once per room code, forever
  function earnShare(code) {
    if (!code || wallet.sharedRooms.includes(code)) return;
    wallet.sharedRooms.push(code);
    earn(10, 'por invitar');
  }

  function buy(id) {
    const it = item(id);
    if (!it || wallet.owned.includes(id) || wallet.coins < it.price) return false;
    wallet.coins -= it.price;
    wallet.owned.push(id);
    save();
    return true;
  }

  function equip(id) {
    const it = item(id);
    if (!it || !wallet.owned.includes(id)) return false;
    wallet.equipped[it.cat] = id;
    save();
    return true;
  }

  // What other players see: "🎩🤖😎👟" (hat + avatar + face + shoes)
  function avatarString() {
    const e = wallet.equipped;
    return ['hat', 'avatar', 'face', 'shoes']
      .map((c) => (item(e[c]) || {}).emoji || '')
      .join('');
  }

  function cosmetics() {
    return {
      avatar: avatarString(),
      dance: (item(wallet.equipped.dance) || {}).emoji || '',
      table: wallet.equipped.table,
      cards: wallet.equipped.cards,
    };
  }

  /* ---------- coin toast ---------- */
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'coin-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* ---------- shop UI ---------- */
  const $ = (sel) => document.querySelector(sel);
  let activeCat = 'avatar';

  function renderCoins() {
    document.querySelectorAll('.coin-balance').forEach((el) => {
      el.textContent = `🪙 ${wallet.coins}`;
    });
  }

  function renderShop() {
    renderCoins();
    const tabs = $('#shop-tabs');
    tabs.innerHTML = '';
    CATS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'shop-tab' + (c.key === activeCat ? ' active' : '');
      b.textContent = c.label;
      b.addEventListener('click', () => { activeCat = c.key; renderShop(); });
      tabs.appendChild(b);
    });

    const grid = $('#shop-grid');
    grid.innerHTML = '';
    CATALOG.filter((x) => x.cat === activeCat).forEach((it) => {
      const owned = wallet.owned.includes(it.id);
      const equipped = wallet.equipped[it.cat] === it.id;
      const card = document.createElement('div');
      card.className = 'shop-item' + (equipped ? ' equipped' : '');
      const preview = it.emoji || '∅';
      card.innerHTML =
        `<div class="shop-emoji">${preview}</div>` +
        `<div class="shop-name">${it.name}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn shop-btn';
      if (equipped) {
        btn.textContent = '✔ EQUIPADO';
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = 'USAR';
        btn.classList.add('btn-success');
        btn.addEventListener('click', () => {
          AudioFX.click();
          equip(it.id);
          renderShop();
        });
      } else {
        btn.textContent = `🪙 ${it.price}`;
        if (wallet.coins < it.price) btn.classList.add('cant-afford');
        btn.addEventListener('click', () => {
          if (!buy(it.id)) { AudioFX.burnFail(); return; }
          AudioFX.coin();
          equip(it.id);
          renderShop();
        });
      }
      card.appendChild(btn);
      grid.appendChild(card);
    });
  }

  function openShop() {
    AudioFX.unlock();
    AudioFX.click();
    renderShop();
    $('#screen-shop').classList.add('active');
    $('#screen-lobby').classList.remove('active');
  }

  function closeShop() {
    AudioFX.click();
    $('#screen-shop').classList.remove('active');
    $('#screen-lobby').classList.add('active');
    renderCoins();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#btn-shop').addEventListener('click', openShop);
    $('#btn-close-shop').addEventListener('click', closeShop);
    renderCoins();
  });

  return { earn, earnShare, cosmetics, avatarString, renderCoins, item };
})();
