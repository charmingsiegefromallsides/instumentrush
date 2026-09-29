// Track builder — click a staff position to append notes, then play back.
//
// Written as a factory so the same editor can be instantiated more than once:
// `SaxBuilder` itself is the Track Builder tab (DOM ids prefixed "tb-"), and
// `SaxBuilder.create(prefix, opts)` builds another one against ids prefixed
// `<prefix>-` (the MIDI Mixer uses two: a read-only source view and a full
// editor for the assembled track). Optional elements may be absent.
window.SaxBuilder = (() => {
  const T = SaxTheory, ST = SaxStaff, A = SaxAudio;
  const Y_E4 = 190, FIRST_X = 120, DX = 52;
  const BEATS = { w: 4, h: 2, q: 1, e: 0.5 };
  const STORE_KEY = "saxtrainer.tracks";
  const DUR_WORD = { w: "whole", h: "half", q: "quarter", e: "eighth" };
  const DUR_STEPS = [["e", 0.5], ["q", 1], ["h", 2], ["w", 4]];

  // Length of an item in beats; a dot adds half again.
  const itemBeats = it => BEATS[it.dur] * (it.dot ? 1.5 : 1);
  const isEighth = it => !it.rest && it.dur === "e" && !it.dot;

  // Snap an arbitrary beat length to the nearest supported length: {dur} or,
  // when dots are allowed, {dur, dot:true}.
  function snapBeats(beats, dots) {
    let best = { dur: "q" }, bestErr = Infinity;
    const cands = [];
    for (const [d, b] of DUR_STEPS) cands.push([{ dur: d }, b]);
    if (dots) for (const [d, b] of DUR_STEPS) cands.push([{ dur: d, dot: true }, b * 1.5]);
    for (const [it, b] of cands) {
      const err = Math.abs(Math.log2(b) - Math.log2(beats)); // musical (ratio) distance
      if (err < bestErr - 1e-9) { bestErr = err; best = it; }
    }
    return { ...best };
  }

  function savedTracks() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function create(prefix, opts = {}) {
    const readOnly = !!opts.readOnly;
    const el = id => document.getElementById(prefix + "-" + id);
    const all = sel => document.querySelectorAll(`#${prefix}-${sel}`);

    let svg, staff, active = false;
    let track = []; // {rest:true, dur} | {name, dur}  (dur = "w"|"h"|"q"|"e")
    let groups = [];
    let curDur = "q", curAcc = null;
    let ghostG = null, ghostStep = null;
    let playing = false, rafId = null, playIdx = -1;
    let playT0 = 0, playSpb = 0.5, playEvents = [], playNext = 0; // live playback clock
    let editMode = false, selectedIdx = -1; // select mode is the default
    let history = []; // snapshots of `track` taken before each change, for undo
    let tempoValue = 100; // used when there is no tempo slider in the DOM
    let copied = new Set(); // indices drawn with a green "already copied" band
    let keyK = 0;                       // key signature: +n sharps / -n flats
    let curDot = false, curTie = false; // tool state for notes added next
    const FING_KEY = "saxtrainer.builderFingering";
    let fingOn = true;                  // show the fingering panel (Track Builder tab)
    try { fingOn = localStorage.getItem(FING_KEY) !== "0"; } catch (e) { /* default on */ }
    const keyMap = () => T.keySig(keyK);
    const fx = () => FIRST_X + Math.abs(keyK) * 10; // first note x (room for the key signature)
    // a note is tied to the next one only if that next note has the same pitch
    const tiedNext = i => { const a = track[i], b = track[i + 1]; return !!(a && b && a.tie && !a.rest && !b.rest && a.name === b.name); };
    const tiedPrev = i => i > 0 && tiedNext(i - 1);
    let bpb = opts.beatsPerBar || 4; // beats per bar for barlines / bar navigation

    // Snapshot the track before a mutating action so Undo can restore it.
    function pushHistory() {
      history.push(track.map(it => ({ ...it })));
      if (history.length > 200) history.shift();
    }

    function widthFor() { return Math.max(1100, fx() + (track.length + 2) * DX); }

    // acc: "#" | "b" | "n" (explicit natural) | null (follow the key signature)
    function noteAt(step, acc) {
      // step is diatonic (0 = E4); derive letter/octave then apply accidental
      const diatonic = step + 30;
      const letter = T.LETTERS[((diatonic % 7) + 7) % 7];
      const octave = Math.floor(diatonic / 7);
      const a = acc === "n" ? null : (acc || keyMap()[letter] || null);
      try {
        const inst = SaxInstrument.get();
        const n = T.noteByName(letter + (a || "") + octave);
        if (n.midi < inst.low || n.midi > inst.high) return null;
        return n;
      } catch (e) { return null; }
    }

    function render() {
      const width = widthFor();
      svg.setAttribute("viewBox", `0 0 ${width} 320`);
      svg.style.width = width + "px";
      svg.innerHTML = "";
      staff = ST.create(svg, { yE4: Y_E4, left: 16, right: width - 12 });
      staff.drawLines();
      if (keyK) staff.drawKeySig(keyK);
      // "already copied" bands go under the notes
      for (const i of copied) {
        if (i < 0 || i >= track.length) continue;
        ST.el("rect", {
          x: fx() + i * DX - DX / 2 + 2, y: 30, width: DX - 4, height: 262, rx: 6,
          fill: "var(--good)", opacity: 0.18, class: "copied"
        }, svg);
      }
      // pair up eighths that start on a beat so they can share a beam
      const starts = []; let sb = 0;
      for (const it of track) { starts.push(sb); sb += itemBeats(it); }
      const stemUp = new Map(), pairs = [];
      for (let i = 0; i + 1 < track.length; i++) {
        if (isEighth(track[i]) && isEighth(track[i + 1]) && Math.abs(starts[i] - Math.round(starts[i])) < 1e-9) {
          const s1 = T.noteByName(track[i].name).step, s2 = T.noteByName(track[i + 1].name).step;
          const up = (s1 + s2) / 2 < 4;
          stemUp.set(i, up); stemUp.set(i + 1, up); pairs.push(i);
          i++;
        }
      }
      const km = keyMap(), barAcc = new Map(); // accidentals already in force this bar
      let beatsAcc = 0;
      groups = track.map((item, i) => {
        const x = fx() + i * DX;
        let g;
        if (item.rest) {
          g = staff.drawRest(x, { dur: item.dur, dot: !!item.dot });
        } else {
          const n = T.noteByName(item.name), k = n.letter + n.octave;
          const inForce = barAcc.has(k) ? barAcc.get(k) : (km[n.letter] || null);
          const want = n.acc || null;
          barAcc.set(k, want);
          g = staff.drawNote(n, x, {
            dur: item.dur, dot: !!item.dot, stemUp: stemUp.get(i),
            showAcc: want === inForce ? null : (want || "n")
          });
        }
        g.dataset.index = i;
        g.style.cursor = "pointer";
        const before = beatsAcc;
        beatsAcc += itemBeats(item);
        // a barline after any note that ends on or past a bar boundary, so the
        // drawn bars always agree with the barIndices windows of bpb beats
        if (Math.floor(beatsAcc / bpb + 1e-9) > Math.floor(before / bpb + 1e-9) && i < track.length - 1) {
          staff.drawBarline(x + DX / 2);
          barAcc.clear();
        }
        return g;
      });
      for (const i of pairs) {
        staff.beam(groups[i], groups[i + 1], fx() + i * DX, fx() + (i + 1) * DX,
          T.noteByName(track[i].name).step, T.noteByName(track[i + 1].name).step, stemUp.get(i));
      }
      for (let i = 0; i < track.length - 1; i++) {
        if (!tiedNext(i)) continue;
        const step = T.noteByName(track[i].name).step;
        staff.drawTie(fx() + i * DX, fx() + (i + 1) * DX, step,
          { up: stemUp.has(i) ? stemUp.get(i) : step < 4 });
      }
      // insertion marker at the next slot (edit mode only): where a click
      // would drop the next note
      if (editMode) {
        const nx = fx() + track.length * DX;
        ST.el("line", {
          x1: nx, x2: nx, y1: staff.yOf(10), y2: staff.yOf(-4),
          stroke: "var(--accent)", "stroke-width": 1.5, "stroke-dasharray": "4 4", opacity: 0.6
        }, svg);
      }
      ghostG = null;
      if (selectedIdx >= track.length) selectedIdx = -1;
      if (selectedIdx >= 0 && groups[selectedIdx]) ST.setColor(groups[selectedIdx], "var(--good)");
      updateStats();
      refreshFlags();
      updateFingering(fingIdx());
    }

    // Reflect dot/tie state on their buttons: the selected note, else the tool.
    function refreshFlags() {
      const it = selectedIdx >= 0 ? track[selectedIdx] : null;
      const d = el("dot"), t = el("tie");
      if (d) d.classList.toggle("sel", it ? !!it.dot : curDot);
      if (t) t.classList.toggle("sel", it ? tiedNext(selectedIdx) : curTie);
    }

    // ---- fingering panel (optional element; Track Builder tab only) ----
    function fingIdx() {
      return playing && playIdx >= 0 ? playIdx : (selectedIdx >= 0 ? selectedIdx : playIdx);
    }
    function updateFingering(idx) {
      const panel = el("fing");
      if (!panel) return;
      panel.style.display = fingOn ? "" : "none";
      if (!fingOn) return;
      const nm = el("fing-name"), sv = el("fing-svg"), it = idx >= 0 ? track[idx] : null;
      if (!it) { nm.textContent = "–"; sv.innerHTML = ""; return; }
      if (it.rest) { nm.textContent = "(rest)"; sv.innerHTML = ""; return; }
      const n = T.noteByName(it.name);
      nm.textContent = n.name;
      try { SaxFingering.render(sv, n.midi); } catch (e) { sv.innerHTML = ""; }
    }

    function updateStats() {
      const st = el("stats");
      if (!st) return;
      if (selectedIdx >= 0 && track[selectedIdx]) {
        const it = track[selectedIdx];
        st.textContent = `Selected: ${it.rest ? "rest" : it.name} (${it.dot ? "dotted " : ""}${DUR_WORD[it.dur]}${tiedNext(selectedIdx) ? ", tied to next" : ""}) — note ${selectedIdx + 1} of ${track.length}`;
        return;
      }
      const beats = track.reduce((s, it) => s + itemBeats(it), 0);
      if (!track.length) {
        st.textContent = readOnly ? "No notes in this track"
          : editMode ? "Empty track — click on the staff to add your first note"
                     : "Empty track — press C to enter Edit mode and add notes";
        return;
      }
      st.textContent = `${track.length} notes · ${beats} beats · ${Math.ceil(beats / bpb)} bars` +
        (readOnly || editMode ? "" : " · Select mode — press C to edit");
    }

    function selectNote(idx, { play = true } = {}) {
      if (selectedIdx >= 0 && groups[selectedIdx]) ST.setColor(groups[selectedIdx], "var(--ink)");
      selectedIdx = idx;
      if (idx >= 0 && groups[idx]) {
        ST.setColor(groups[idx], "var(--good)");
        const it = track[idx];
        if (play && !it.rest) A.playNote(T.noteByName(it.name).midi, { dur: 0.4, vel: 0.5 });
        syncToolbar(it); // reflect this note's duration/accidental on the buttons
      }
      updateStats();
      refreshFlags();
      updateFingering(fingIdx());
      if (opts.onPosition) opts.onPosition(idx);
    }

    // Highlight the toolbar duration/accidental buttons matching an item.
    // No accidental button is lit when the note simply follows the key signature.
    function syncToolbar(it) {
      all("durs button").forEach(x => x.classList.toggle("sel", x.dataset.dur === it.dur));
      let shown = null;
      if (!it.rest) {
        const n = T.noteByName(it.name), keyAcc = keyMap()[n.letter] || null;
        shown = (n.acc || null) === keyAcc ? null : (n.acc || "n");
      }
      all("accs button").forEach(x => x.classList.toggle("sel", (x.dataset.acc || null) === shown));
    }

    function setMode(edit) {
      if (readOnly) edit = false;
      editMode = edit;
      if (edit) selectedIdx = -1; // adding uses the tool defaults, not a selection
      const b = el("mode");
      if (b) {
        b.textContent = edit ? "✏ Edit mode" : "🖱 Select mode";
        b.classList.toggle("sel", edit);
      }
      if (!edit) onLeave(); // drop the ghost preview
      render();
    }

    function svgPoint(ev) {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    function stepFromY(y) {
      const step = Math.round((Y_E4 - y) / ST.HALF);
      return Math.max(-3, Math.min(15, step)); // B3..F6 diatonic positions
    }

    function onMove(ev) {
      if (playing || !editMode) return;
      const p = svgPoint(ev);
      const step = stepFromY(p.y);
      if (step === ghostStep && ghostG) return;
      ghostStep = step;
      if (ghostG) ghostG.remove();
      const n = noteAt(step, curAcc);
      if (!n) { ghostG = null; return; }
      ghostG = staff.drawNote(n, fx() + track.length * DX, { dur: curDur, dot: curDot, key: keyMap(), ghost: true, color: "var(--accent)" });
    }

    function onLeave() {
      if (ghostG) { ghostG.remove(); ghostG = null; ghostStep = null; }
    }

    function onClick(ev) {
      if (playing) return;
      const g = ev.target.closest("g[data-index]");
      const onNote = g && ev.target.tagName !== "svg";

      if (!editMode) {
        // select mode: highlight (and play) a note without changing it
        selectNote(onNote ? +g.dataset.index : -1);
        if (opts.onSelect) opts.onSelect(selectedIdx);
        return;
      }

      // edit mode: click a note to delete it, click empty staff to add one
      if (onNote) {
        const idx = +g.dataset.index;
        pushHistory();
        track.splice(idx, 1);
        if (selectedIdx === idx) selectedIdx = -1;
        else if (selectedIdx > idx) selectedIdx--;
        render();
        return;
      }
      const p = svgPoint(ev);
      const n = noteAt(stepFromY(p.y), curAcc);
      if (!n) return;
      pushHistory();
      const name = n.letter + (n.acc || "") + n.octave, prev = track[track.length - 1];
      track.push({ name, dur: curDur, ...(curDot ? { dot: true } : {}) });
      if (curTie) { // tie tool: join this note to the previous one if they match
        if (prev && !prev.rest && prev.name === name) prev.tie = true;
        curTie = false;
      }
      A.playNote(n.midi, { dur: 0.3, vel: 0.5 });
      render();
      scrollToEnd();
    }

    // Move the selected note up/down one staff step (keeps its accidental).
    function moveSelected(dir) {
      if (readOnly || selectedIdx < 0) return;
      const it = track[selectedIdx];
      if (!it || it.rest) return;
      const cur = T.noteByName(it.name);
      const keyAcc = keyMap()[cur.letter] || null;
      const keep = (cur.acc || null) === keyAcc ? null : (cur.acc || "n"); // key-following notes keep following the key
      const next = noteAt(cur.step + dir, keep);
      if (!next) return; // would leave the instrument's range
      pushHistory();
      it.name = next.letter + (next.acc || "") + next.octave;
      render();
      A.playNote(next.midi, { dur: 0.35, vel: 0.5 });
      scrollToSelected();
    }

    // Select the previous/next item (works in any mode; wraps nothing).
    function step(dir) {
      if (!track.length) return;
      if (playing) stop();
      let idx = selectedIdx >= 0 ? selectedIdx : (playIdx >= 0 ? playIdx : (dir > 0 ? -1 : track.length));
      idx = Math.max(0, Math.min(track.length - 1, idx + dir));
      selectNote(idx);
      scrollToSelected();
    }

    function scrollToSelected() {
      const wrap = el("scroll");
      if (selectedIdx < 0 || !wrap) return;
      const x = fx() + selectedIdx * DX;
      wrap.scrollTo({ left: Math.max(0, x - wrap.clientWidth / 2), behavior: document.visibilityState === "visible" ? "smooth" : "auto" });
    }

    // Change the selected note's duration to `dur` (works on notes and rests).
    function setSelectedDur(dur) {
      if (readOnly || selectedIdx < 0 || !track[selectedIdx]) return;
      pushHistory();
      track[selectedIdx].dur = dur;
      render();
      const it = track[selectedIdx];
      if (!it.rest) A.playNote(T.noteByName(it.name).midi, { dur: 0.35, vel: 0.5 });
      scrollToSelected();
    }

    // Re-spell the selected note with the given accidental ("#", "b", or null).
    function setSelectedAcc(acc) {
      const it = track[selectedIdx];
      if (readOnly || !it || it.rest) return;
      const cur = T.noteByName(it.name);
      const re = noteAt(cur.step, acc); // same staff line/space, new accidental
      if (!re) return;                  // out of the instrument's range
      pushHistory();
      it.name = re.letter + (re.acc || "") + re.octave;
      render();
      A.playNote(re.midi, { dur: 0.35, vel: 0.5 });
      scrollToSelected();
    }

    // Dot: with a selection, toggle it on that item; otherwise toggle the tool
    // that dots the next note you add.
    function toggleDot() {
      if (readOnly || playing) return;
      const it = selectedIdx >= 0 ? track[selectedIdx] : null;
      if (it) {
        pushHistory();
        if (it.dot) delete it.dot; else it.dot = true;
        render();
        if (!it.rest) A.playNote(T.noteByName(it.name).midi, { dur: 0.35, vel: 0.5 });
        scrollToSelected();
      } else {
        curDot = !curDot;
        refreshFlags();
      }
    }

    // Tie: with a selection, join it to the next note (same pitch) or undo the
    // tie; otherwise arm the tool so the next note added ties to the previous one.
    function toggleTie() {
      if (readOnly || playing) return;
      const it = selectedIdx >= 0 ? track[selectedIdx] : null;
      if (!it) { curTie = !curTie; refreshFlags(); return; }
      if (it.rest) return;
      if (tiedNext(selectedIdx)) {
        pushHistory(); delete it.tie; render();
      } else if (track[selectedIdx + 1] && !track[selectedIdx + 1].rest && track[selectedIdx + 1].name === it.name) {
        pushHistory(); it.tie = true; render();
      } else if (el("stats")) {
        el("stats").textContent = "A tie joins two notes of the same pitch in a row. Select the first note and make sure the next one is the same pitch.";
      }
    }

    function setKey(k) {
      keyK = Math.max(-7, Math.min(7, Math.round(+k) || 0));
      if (el("key")) el("key").value = String(keyK);
      if (svg) render();
    }

    function toggleFingering() {
      fingOn = !fingOn;
      try { localStorage.setItem(FING_KEY, fingOn ? "1" : "0"); } catch (e) { /* not persisted */ }
      const b = el("fing-toggle");
      if (b) b.classList.toggle("sel", fingOn);
      updateFingering(fingIdx());
    }

    // Turn the selected note into a rest of the same length.
    function makeSelectedRest() {
      const it = track[selectedIdx];
      if (readOnly || !it || it.rest) return;
      pushHistory();
      track[selectedIdx] = { rest: true, dur: it.dur, ...(it.dot ? { dot: true } : {}) };
      render();
      scrollToSelected();
    }

    function scrollToEnd() {
      const wrap = el("scroll");
      if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    }

    function addRest() {
      if (readOnly || playing) return;
      pushHistory();
      track.push({ rest: true, dur: curDur, ...(curDot ? { dot: true } : {}) });
      render();
      scrollToEnd();
    }

    // Append ready-made items (from the MIDI Mixer's S/D picks).
    function appendItems(items) {
      if (readOnly || !items.length) return;
      if (playing) stop();
      pushHistory();
      for (const it of items) track.push({ ...it });
      selectedIdx = -1;
      render();
      scrollToEnd();
    }

    // Undo reverses the last change (add, delete, move, rest, clear, or import)
    // by restoring the previous snapshot — not just popping the final note.
    function undo() {
      if (readOnly || playing || !history.length) return;
      track = history.pop();
      selectedIdx = -1;
      render();
      scrollToEnd();
    }

    function clearAll() {
      if (readOnly || playing || !track.length) return;
      pushHistory(); track = []; selectedIdx = -1; render();
      if (opts.onClear) opts.onClear(); // host may reset related state (e.g. copied marks)
    }

    function setTempo(tempo) {
      tempoValue = tempo;
      if (el("tempo")) { el("tempo").value = tempo; }
      if (el("tempo-val")) el("tempo-val").textContent = tempo + " bpm";
    }
    function getTempo() { return el("tempo") ? +el("tempo").value : tempoValue; }

    // Import notes for editing/viewing (pitches exact; rhythm snapped to the
    // whole/half/quarter/eighth grid). Never writes to the source.
    function loadSong(notes, tempo, name) {
      if (playing) stop();
      if (track.length && !readOnly) pushHistory();
      selectedIdx = -1; playIdx = -1; copied = new Set();
      keyK = 0; if (el("key")) el("key").value = "0";
      track = notes.map(([n, beats]) => {
        const len = snapBeats(beats, !readOnly); // editable copies keep dotted rhythms
        return n === null ? { rest: true, ...len } : { name: n, ...len };
      });
      if (tempo) setTempo(tempo);
      if (el("name") && name !== undefined) el("name").value = (name || "Untitled") + " (my version)";
      render();
      if (readOnly) { const w = el("scroll"); if (w) w.scrollLeft = 0; } else scrollToEnd();
    }

    function play() {
      if (playing || !track.length) return;
      playing = true;
      if (el("play")) el("play").textContent = "⏸ Pause";
      playSpb = 60 / getTempo();
      const from = selectedIdx >= 0 ? selectedIdx : 0; // resume from the selected note
      playT0 = A.now() + 0.15;
      const events = [];
      let beat = 0;
      for (let i = from; i < track.length; i++) {
        events.push({ i, start: beat, end: beat + itemBeats(track[i]), cont: i > from && tiedPrev(i) });
        beat += itemBeats(track[i]);
      }
      playEvents = events; playNext = 0;
      const total = beat;
      // Schedule audio just-in-time (~1s lookahead). Scheduling thousands of
      // notes up front floods the audio thread and Chrome goes silent on long
      // tracks (e.g. 3000-note MIDI arpeggios) while the visuals keep moving.
      let lastIdx = -1;
      const tick = () => {
        if (!playing) return;
        const now = A.now();
        const cur = (now - playT0) / playSpb;
        while (playNext < events.length) {
          const e = events[playNext];
          const at = playT0 + e.start * playSpb;
          if (at >= now + 1) break;
          const item = track[e.i];
          if (!item.rest && !e.cont && at >= now - 0.05) {
            const n = T.noteByName(item.name);
            let len = itemBeats(item);
            for (let j = e.i; tiedNext(j); ) { j++; len += itemBeats(track[j]); } // ring through the tie
            A.playNote(n.midi, { dur: Math.max(0.15, len * playSpb * 0.92), when: Math.max(0, at - now) });
          }
          playNext++;
        }
        const ev = events.find(e => cur >= e.start && cur < e.end);
        const idx = ev ? ev.i : -1;
        if (idx !== lastIdx) {
          if (lastIdx >= 0 && groups[lastIdx]) ST.setColor(groups[lastIdx], "var(--ink)");
          if (idx >= 0 && groups[idx]) {
            ST.setColor(groups[idx], "var(--accent)");
            playIdx = idx;
            updateFingering(idx);
            const wrap = el("scroll");
            if (wrap) { // keep the sounding note in view, centred once past mid-screen
              const x = fx() + idx * DX;
              const want = Math.max(0, x - wrap.clientWidth / 2);
              if (Math.abs(wrap.scrollLeft - want) > DX) wrap.scrollLeft = want;
            }
            if (opts.onPlayNote) opts.onPlayNote(idx);
            if (opts.onPosition) opts.onPosition(idx);
          }
          lastIdx = idx;
        }
        if (cur < total + 0.5) rafId = A.raf(tick);
        else stop();
      };
      rafId = A.raf(tick);
    }

    function stop() {
      playing = false;
      if (el("play")) el("play").textContent = "▶ Play";
      if (rafId) A.caf(rafId);
      A.stopAll();
      render();
      // leave the last-played note lit so S/D know what "current" means
      if (playIdx >= 0 && groups[playIdx] && selectedIdx < 0) ST.setColor(groups[playIdx], "var(--accent)");
    }

    // ---- save / load (localStorage) ----
    function refreshLoadList() {
      const sel = el("load");
      if (!sel) return;
      const names = Object.keys(savedTracks());
      sel.innerHTML = "";
      const first = document.createElement("option");
      first.value = ""; first.textContent = "Load a saved track…";
      sel.appendChild(first);
      for (const n of names) { // build as text nodes — names come from storage
        const o = document.createElement("option");
        o.value = n; o.textContent = n;
        sel.appendChild(o);
      }
    }
    function save() {
      const name = el("name") ? el("name").value.trim() : "";
      if (!name || !track.length) return;
      const all = savedTracks();
      all[name] = { tempo: getTempo(), key: keyK, items: track };
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
      refreshLoadList();
      if (el("load")) el("load").value = name;
      if (el("stats")) el("stats").textContent = `Saved “${name}” to My Tracks — find it in Play Songs.`;
    }
    function load(name) {
      const allT = savedTracks();
      if (!allT[name]) return;
      if (playing) stop();
      if (track.length) pushHistory();
      selectedIdx = -1;
      // old saves were a bare array; new ones are {tempo, items}
      const t = allT[name];
      track = Array.isArray(t) ? t : t.items;
      if (!Array.isArray(t) && t.tempo) setTempo(t.tempo);
      keyK = Array.isArray(t) ? 0 : Math.max(-7, Math.min(7, Math.round(+t.key) || 0));
      if (el("key")) el("key").value = String(keyK);
      if (el("name")) el("name").value = name;
      render();
    }
    function removeSaved() {
      const name = el("load") ? el("load").value : "";
      if (!name) return;
      const allT = savedTracks();
      delete allT[name];
      localStorage.setItem(STORE_KEY, JSON.stringify(allT));
      refreshLoadList();
    }

    // Indices of the bar containing item `idx` (bars are 4 beats, as drawn).
    function barIndices(idx) {
      if (idx < 0 || idx >= track.length) return [];
      let beat = 0, start = 0;
      for (let i = 0; i < track.length; i++) {
        if (i === idx) { start = Math.floor(beat / bpb + 1e-9) * bpb; break; }
        beat += itemBeats(track[i]);
      }
      const out = []; beat = 0;
      for (let i = 0; i < track.length; i++) {
        if (beat >= start - 1e-9 && beat < start + bpb - 1e-9) out.push(i);
        beat += itemBeats(track[i]);
        if (beat >= start + bpb - 1e-9) break;
      }
      return out;
    }
    // { bar, ord } — 0-based bar number and position of `idx` within that bar
    function barPos(idx) {
      if (idx < 0 || idx >= track.length) return null;
      const ids = barIndices(idx);
      return { bar: Math.floor(beatOf(idx) / bpb + 1e-9), ord: Math.max(0, ids.indexOf(idx)), count: ids.length };
    }
    function setBeatsPerBar(n) { bpb = Math.max(1, n || 4); if (svg) render(); }
    function barItems(idx) { return barIndices(idx).map(i => ({ ...track[i] })); }

    function setCopied(indices) { copied = new Set(indices); render(); }
    function addCopied(indices) { for (const i of indices) copied.add(i); render(); }

    // ---- time-position helpers (beats are cumulative, as drawn) ----
    function beatOf(idx) {
      let b = 0;
      for (let i = 0; i < Math.min(idx, track.length); i++) b += itemBeats(track[i]);
      return b;
    }
    // Index of the item sounding at `beat` (last item if beyond the end).
    function indexAtBeat(beat) {
      if (!track.length) return -1;
      let b = 0;
      for (let i = 0; i < track.length; i++) {
        const d = itemBeats(track[i]);
        if (beat < b + d) return i;
        b += d;
      }
      return track.length - 1;
    }
    // Current position: the sounding note while playing, else selection / last played.
    function currentBeat() {
      const idx = playing && playIdx >= 0 ? playIdx : (selectedIdx >= 0 ? selectedIdx : playIdx);
      return idx >= 0 ? beatOf(idx) : 0;
    }
    // Index of the current position: sounding note while playing, else selection / last played.
    function currentIndex() {
      return playing && playIdx >= 0 ? playIdx : (selectedIdx >= 0 ? selectedIdx : playIdx);
    }
    // Indices of the items in bar number `barNo` (0-based, 4-beat bars as drawn).
    function barIndicesAt(barNo) {
      const out = []; let b = 0;
      for (let i = 0; i < track.length; i++) {
        const bar = Math.floor(b / bpb + 1e-9);
        if (bar === barNo) out.push(i); else if (bar > barNo) break;
        b += itemBeats(track[i]);
      }
      return out;
    }
    function select(idx, { play = true } = {}) {
      if (idx < 0 || idx >= track.length) return;
      selectNote(idx, { play });
      scrollToSelected();
    }

    // C toggles select/edit mode; ↑/↓ move pitch and ←/→ step, but only while
    // a note is selected so a host (the MIDI Mixer) can use the arrows otherwise.
    function onKeyDown(ev) {
      if (!active || readOnly || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const a = document.activeElement;
      const typing = a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable ||
        (a.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "submit"].includes(a.type)));
      if (typing) return;
      if (ev.key === "c" || ev.key === "C") { setMode(!editMode); ev.preventDefault(); return; }
      if (ev.key === ".") { toggleDot(); ev.preventDefault(); return; }
      if (ev.key === "t" || ev.key === "T") { toggleTie(); ev.preventDefault(); return; }
      if (selectedIdx < 0) return;
      if (ev.key === "ArrowUp") { moveSelected(1); ev.preventDefault(); }
      else if (ev.key === "ArrowDown") { moveSelected(-1); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft") { step(-1); ev.preventDefault(); }
      else if (ev.key === "ArrowRight") { step(1); ev.preventDefault(); }
    }

    function init() {
      svg = el("staff");
      render();
      svg.addEventListener("mousemove", onMove);
      svg.addEventListener("mouseleave", onLeave);
      svg.addEventListener("click", onClick);

      all("durs button").forEach(b =>
        b.addEventListener("click", () => {
          curDur = b.dataset.dur;
          all("durs button").forEach(x => x.classList.toggle("sel", x === b));
          if (selectedIdx >= 0) setSelectedDur(curDur); // modify the selected note
        }));
      all("accs button").forEach(b =>
        b.addEventListener("click", () => {
          const want = b.dataset.acc || null;
          curAcc = curAcc === want ? null : want; // click again: follow the key signature
          all("accs button").forEach(x => x.classList.toggle("sel", (x.dataset.acc || null) === curAcc));
          if (selectedIdx >= 0) setSelectedAcc(curAcc); // re-spell the selected note
        }));

      const on = (id, evt, fn) => { const e = el(id); if (e) e.addEventListener(evt, fn); };
      on("mode", "click", () => setMode(!editMode));
      on("rest", "click", () => { if (selectedIdx >= 0) makeSelectedRest(); else addRest(); });
      on("dot", "click", () => { toggleDot(); el("dot").blur(); });
      on("tie", "click", () => { toggleTie(); el("tie").blur(); });
      on("fing-toggle", "click", () => { toggleFingering(); el("fing-toggle").blur(); });
      if (el("fing-toggle")) el("fing-toggle").classList.toggle("sel", fingOn);
      if (el("key")) {
        for (const [k, label] of T.KEYS) {
          const o = document.createElement("option");
          o.value = String(k); o.textContent = label;
          el("key").appendChild(o);
        }
        el("key").value = "0";
        el("key").addEventListener("change", () => { setKey(el("key").value); el("key").blur(); });
      }
      on("undo", "click", undo);
      on("clear", "click", clearAll);
      on("play", "click", () => playing ? stop() : play());
      on("tempo", "input", () => {
        if (el("tempo-val")) el("tempo-val").textContent = el("tempo").value + " bpm";
        if (!playing) return;
        // change tempo live: keep the current beat, reschedule what's ahead
        const now = A.now();
        const cur = (now - playT0) / playSpb;
        playSpb = 60 / getTempo();
        playT0 = now - cur * playSpb;
        A.stopAll();
        playNext = playEvents.findIndex(e => e.end > cur);
        if (playNext < 0) playNext = playEvents.length;
      });
      on("save", "click", save);
      on("load", "change", ev => load(ev.target.value));
      on("delete", "click", removeSaved);
      if (!readOnly) document.addEventListener("keydown", onKeyDown);
      setMode(false); // start in select mode
      refreshLoadList();
    }

    return {
      init, loadSong, appendItems, undo, step, play, stop,
      togglePlay() { playing ? stop() : play(); },
      isPlaying: () => playing,
      hasSelection: () => selectedIdx >= 0,
      clearSelection() { if (selectedIdx >= 0) selectNote(-1); },
      // index S/D act on: the selected note, else the note last sounded
      captureIndex: () => selectedIdx >= 0 ? selectedIdx : playIdx,
      itemAt: i => track[i] ? { ...track[i] } : null,
      barItems, barIndices, setCopied, addCopied,
      getCopied: () => [...copied],
      length: () => track.length,
      beatOf, indexAtBeat, currentBeat, currentIndex, barIndicesAt, select, barPos, setBeatsPerBar,
      beatsPerBar: () => bpb,
      getItems: () => track.map(it => ({ ...it })),
      getTempo, setTempo, setKey, getKey: () => keyK,
      activate() { active = true; refreshLoadList(); },
      deactivate() { active = false; if (playing) stop(); }
    };
  }

  const main = create("tb");
  main.create = create;
  return main;
})();
