/* ============ Retro sound effects via Web Audio (no asset files) ============ */
const AudioFX = (() => {
  let ctx = null;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, end = null, dur = 0.12, type = 'square', vol = 0.12, delay = 0 }) {
    const c = ac();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end) osc.frequency.exponentialRampToValueAtTime(end, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Short filtered noise burst — card swoosh / shuffle texture
  function noise({ dur = 0.15, vol = 0.18, freq = 2200, delay = 0 }) {
    const c = ac();
    const t0 = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(t0);
  }

  return {
    unlock() { ac(); },

    click()  { tone({ freq: 880, dur: 0.05, vol: 0.08 }); },

    deal(i = 0) { noise({ dur: 0.1, freq: 3000, delay: i * 0.07 }); },

    shuffle() {
      for (let i = 0; i < 6; i++) noise({ dur: 0.06, freq: 2500 + i * 300, delay: i * 0.05, vol: 0.12 });
    },

    flip()   { noise({ dur: 0.12, freq: 2800 }); tone({ freq: 520, end: 900, dur: 0.1, type: 'triangle', vol: 0.07 }); },

    draw()   { noise({ dur: 0.14, freq: 2200 }); tone({ freq: 300, end: 600, dur: 0.12, vol: 0.06 }); },

    swap()   { noise({ dur: 0.1, freq: 2000 }); noise({ dur: 0.1, freq: 2600, delay: 0.09 }); },

    discard() { noise({ dur: 0.12, freq: 1600 }); tone({ freq: 220, dur: 0.08, type: 'triangle', vol: 0.1 }); },

    burnOk() {
      noise({ dur: 0.3, freq: 1200, vol: 0.2 });
      tone({ freq: 900, end: 1800, dur: 0.18, type: 'sawtooth', vol: 0.09 });
      tone({ freq: 1400, end: 2400, dur: 0.2, type: 'square', vol: 0.06, delay: 0.08 });
    },

    burnFail() {
      tone({ freq: 180, end: 90, dur: 0.3, type: 'sawtooth', vol: 0.14 });
      tone({ freq: 140, end: 70, dur: 0.3, type: 'square', vol: 0.1, delay: 0.12 });
    },

    power() {
      tone({ freq: 660, dur: 0.09, vol: 0.1 });
      tone({ freq: 880, dur: 0.09, vol: 0.1, delay: 0.09 });
      tone({ freq: 1320, dur: 0.14, vol: 0.1, delay: 0.18 });
    },

    combine() {
      tone({ freq: 523, dur: 0.08, vol: 0.11 });
      tone({ freq: 659, dur: 0.08, vol: 0.11, delay: 0.08 });
      tone({ freq: 784, dur: 0.08, vol: 0.11, delay: 0.16 });
      tone({ freq: 1046, dur: 0.2, vol: 0.12, delay: 0.24 });
    },

    turn()   { tone({ freq: 700, dur: 0.07, vol: 0.09 }); tone({ freq: 1050, dur: 0.1, vol: 0.09, delay: 0.08 }); },

    coin()   { tone({ freq: 988, dur: 0.08, vol: 0.12 }); tone({ freq: 1319, dur: 0.22, vol: 0.12, delay: 0.08 }); },

    dance() {
      [392, 523, 659, 523, 784, 659, 1046].forEach((f, i) =>
        tone({ freq: f, dur: 0.1, type: 'square', vol: 0.1, delay: i * 0.11 }));
    },

    // Each taunt has its own voice
    quack() {
      tone({ freq: 430, end: 300, dur: 0.13, type: 'sawtooth', vol: 0.15 });
      tone({ freq: 360, end: 230, dur: 0.15, type: 'sawtooth', vol: 0.14, delay: 0.14 });
    },
    cluck() {
      [760, 1020, 760, 1100, 700].forEach((f, i) =>
        tone({ freq: f, dur: 0.05, type: 'square', vol: 0.12, delay: i * 0.08 }));
    },
    bray() { // donkey "hee-haw"
      tone({ freq: 640, end: 560, dur: 0.22, type: 'sawtooth', vol: 0.16 });
      tone({ freq: 210, end: 110, dur: 0.45, type: 'sawtooth', vol: 0.16, delay: 0.24 });
    },
    splat() { // tomato hit
      noise({ dur: 0.2, freq: 600, vol: 0.28 });
      tone({ freq: 170, end: 60, dur: 0.2, type: 'sawtooth', vol: 0.13 });
    },
    disco() {
      [523, 659, 784, 659, 523, 784, 1046].forEach((f, i) =>
        tone({ freq: f, dur: 0.09, type: 'sawtooth', vol: 0.1, delay: i * 0.1 }));
    },
    salsa() {
      [392, 494, 587, 494, 392, 587, 740].forEach((f, i) =>
        tone({ freq: f, dur: 0.1, type: 'triangle', vol: 0.11, delay: i * 0.11 }));
    },
    party() {
      [523, 587, 659, 784, 880, 988, 1046].forEach((f, i) =>
        tone({ freq: f, dur: 0.08, type: 'square', vol: 0.1, delay: i * 0.09 }));
    },
    // Pick the right voice for a given taunt emoji
    taunt(emoji) {
      switch (emoji) {
        case '🦆': return this.quack();
        case '🐔': return this.cluck();
        case '🫏': return this.bray();
        case '🍅': return this.splat();
        case '🕺': return this.disco();
        case '💃': return this.salsa();
        case '🪩': return this.party();
        default: return this.dance();
      }
    },

    mateo() {
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
        tone({ freq: f, dur: 0.13, type: 'square', vol: 0.12, delay: i * 0.12 }));
    },

    // An excited spoken "¡MATEEEOOO!" scream over a rising whoop, so it sounds
    // like a thrilled shout. Layered so there's always SOMETHING even with no
    // installed voice.
    shoutMateo() {
      // rising, vibrato-ish whoop = the rush of excitement
      [440, 560, 700, 880, 1100, 1320].forEach((f, i) =>
        tone({ freq: f, end: f * 1.25, dur: 0.16, type: 'sawtooth', vol: 0.13, delay: i * 0.07 }));
      noise({ dur: 0.3, freq: 3200, vol: 0.1, delay: 0.42 }); // little cheer hiss
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        synth.cancel();
        const u = new SpeechSynthesisUtterance('¡Mateeeooo!');
        const v = synth.getVoices().find((x) => /es[-_]/i.test(x.lang));
        if (v) u.voice = v;
        u.lang = 'es-AR';
        u.rate = 0.8;   // drawn-out
        u.pitch = 1.9;  // high and excited
        u.volume = 1;
        synth.speak(u);
      } catch (e) { /* no speech support — the whoop already played */ }
    },

    // Accelerating snare roll that builds tension before the winner reveal.
    drumroll() {
      let t = 0;
      const hits = 34;
      for (let i = 0; i < hits; i++) {
        const p = i / hits;
        noise({ dur: 0.045, freq: 1700, vol: 0.06 + p * 0.16, delay: t });
        t += 0.11 - p * 0.07; // speed up toward the end
      }
      // low tom rumble underneath
      tone({ freq: 90, dur: t, type: 'triangle', vol: 0.05 });
    },

    // Cymbal crash for the reveal hit.
    crash() {
      noise({ dur: 0.8, freq: 6500, vol: 0.3 });
      noise({ dur: 0.5, freq: 9500, vol: 0.18, delay: 0.02 });
      tone({ freq: 1046, end: 1568, dur: 0.3, type: 'square', vol: 0.1 });
      tone({ freq: 160, dur: 0.4, type: 'triangle', vol: 0.12 });
    },

    win() {
      [523, 659, 784, 1046, 1318, 1568].forEach((f, i) =>
        tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.13, delay: i * 0.13 }));
    },

    lose() {
      [400, 350, 300, 200].forEach((f, i) =>
        tone({ freq: f, end: f * 0.8, dur: 0.25, type: 'sawtooth', vol: 0.11, delay: i * 0.2 }));
    },
  };
})();
