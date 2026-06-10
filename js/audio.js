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

    mateo() {
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) =>
        tone({ freq: f, dur: 0.13, type: 'square', vol: 0.12, delay: i * 0.12 }));
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
