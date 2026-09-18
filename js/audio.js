// WebAudio synth: a reedy saw/triangle blend through a lowpass for note tones,
// plus buzz (wrong answer) and tick (metronome) helpers. All scheduling uses
// the AudioContext clock via the optional `when` offset (seconds from now).
window.SaxAudio = (() => {
  let ctx = null;
  const active = new Set();

  function ensure() {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function playNote(midi, { dur = 0.5, when = 0, vel = 0.6, synth = null } = {}) {
    try {
      const c = ensure();
      const t0 = c.currentTime + when;
      const f = SaxTheory.freq(midi);
      const syn = synth || (window.SaxInstrument && SaxInstrument.get().synth) || { mult: 3.2, max: 5200, wave2: "triangle" };
      const saw = c.createOscillator(); saw.type = "sawtooth"; saw.frequency.value = f;
      const tri = c.createOscillator(); tri.type = syn.wave2; tri.frequency.value = f;
      const filt = c.createBiquadFilter();
      filt.type = "lowpass"; filt.frequency.value = Math.min(f * syn.mult, syn.max); filt.Q.value = 1.1;
      const g = c.createGain();
      const peak = 0.22 * vel;
      if (syn.pluck) {
        // plucked string: instant attack, exponential decay (capped by dur)
        const decay = Math.min(Math.max(dur, 0.3), 1.6);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak * 1.25, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
        dur = decay;
      } else {
        const relStart = Math.max(t0 + 0.05, t0 + dur - 0.07);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + 0.035);
        g.gain.setValueAtTime(peak, relStart);
        g.gain.linearRampToValueAtTime(0, t0 + dur);
      }
      saw.connect(filt); tri.connect(filt);
      filt.connect(g).connect(c.destination);
      saw.start(t0); tri.start(t0);
      saw.stop(t0 + dur + 0.05); tri.stop(t0 + dur + 0.05);
      const h = { saw, tri, g };
      active.add(h);
      saw.onended = () => active.delete(h);
    } catch (e) { /* audio unavailable — visuals still work */ }
  }

  function playBuzz() {
    try {
      const c = ensure();
      const osc = c.createOscillator(); osc.type = "square"; osc.frequency.value = 110;
      const g = c.createGain();
      g.gain.setValueAtTime(0.08, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
      osc.connect(g).connect(c.destination);
      osc.start(); osc.stop(c.currentTime + 0.18);
    } catch (e) {}
  }

  function playTick({ when = 0, strong = false } = {}) {
    try {
      const c = ensure();
      const t0 = c.currentTime + when;
      const osc = c.createOscillator(); osc.type = "sine";
      osc.frequency.value = strong ? 1568 : 1047;
      const g = c.createGain();
      g.gain.setValueAtTime(strong ? 0.12 : 0.07, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(g).connect(c.destination);
      osc.start(t0); osc.stop(t0 + 0.07);
    } catch (e) {}
  }

  function stopAll() {
    for (const h of active) {
      try {
        h.g.gain.cancelScheduledValues(0);
        h.g.gain.setValueAtTime(0, ensure().currentTime);
        h.saw.stop(); h.tri.stop();
      } catch (e) {}
    }
    active.clear();
  }

  const now = () => ensure().currentTime;

  // Animation-loop helpers: rAF while visible, setTimeout fallback when the
  // tab is hidden so playback visuals stay in sync with the audio clock.
  function raf(cb) {
    if (document.visibilityState === "visible")
      return { t: "raf", id: requestAnimationFrame(cb) };
    return { t: "to", id: setTimeout(() => cb(performance.now()), 50) };
  }
  function caf(h) {
    if (!h) return;
    if (h.t === "raf") cancelAnimationFrame(h.id); else clearTimeout(h.id);
  }

  return { playNote, playBuzz, playTick, stopAll, now, ensure, raf, caf };
})();
