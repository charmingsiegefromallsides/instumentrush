// Tab 4: Play mode — pick a jingle, then either Listen (follow along with
// highlighted notes + live fingering) or Play Along (timed rhythm game).
window.SaxPlayer = (() => {
  const T = SaxTheory, ST = SaxStaff, A = SaxAudio, F = SaxFingering;
  const PX_PER_BEAT = 52, Y_E4 = 190, FIRST_X = 90;
  const HIT_X = 170, WINDOW = 0.45, PERFECT = 0.18;
  let active = false, mode = null; // null | "listen" | "game"
  let song = null, timeline = [], rafId = null, running = false;
  let t0 = 0, spb = 0.5, speed = 1, countIn = 4;
  let listenGroups = [], gameGroups = [], gameLayer = null;
  let score = 0, streak = 0, bestStreak = 0, hits = 0, perfects = 0, misses = 0;

  const $ = id => document.getElementById(id);

  function buildTimeline(s) {
    const out = [];
    let beat = 0;
    for (const [name, beats] of s.notes) {
      out.push({ note: name ? T.noteByName(name) : null, start: beat, beats, status: "pending" });
      beat += beats;
    }
    return { events: out, total: beat };
  }

  // ---------- song list (library + saved builder tracks) ----------
  let filterLevel = "", searchText = "";
  const DUR_BEATS = { w: 4, h: 2, q: 1, e: 0.5 };

  // Builder items -> [name|null, beats]; dots lengthen, and a tie merges a note into the previous one.
  function itemsToNotes(items) {
    const beatsOf = it => (DUR_BEATS[it.dur] || 1) * (it.dot ? 1.5 : 1);
    const notes = [];
    items.forEach((it, i) => {
      const prev = items[i - 1];
      if (it.rest) notes.push([null, beatsOf(it)]);
      else if (prev && prev.tie && !prev.rest && prev.name === it.name && notes.length) notes[notes.length - 1][1] += beatsOf(it);
      else notes.push([String(it.name), beatsOf(it)]);
    });
    return notes;
  }

  function userSongs() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("saxtrainer.tracks") || "{}"); }
    catch (e) { return []; }
    const out = [];
    for (const [name, t] of Object.entries(saved)) {
      try { // a corrupted entry should be skipped, not take the whole tab down
        const items = Array.isArray(t) ? t : (t && t.items);
        if (!Array.isArray(items)) continue;
        const tempo = Number(!Array.isArray(t) && t.tempo) || 100;
        out.push({
          id: "user:" + name, title: String(name),
          tempo: Math.max(30, Math.min(300, tempo)), meter: 4, level: "My Tracks",
          notes: itemsToNotes(items)
        });
      } catch (e) { /* skip bad entry */ }
    }
    return out;
  }

  function renderSongList() {
    const wrap = $("pm-songs");
    wrap.innerHTML = "";
    const q = searchText.trim().toLowerCase();
    const shown = [...SaxSongs, ...userSongs()].filter(s =>
      (!filterLevel || s.level === filterLevel) &&
      (!q || s.title.toLowerCase().includes(q)))
      .sort(SaxRatings.cmp(s => s.id, s => s.title)); // highest rated first, then A→Z
    $("pm-count").textContent = `${shown.length} song${shown.length === 1 ? "" : "s"}`;
    for (const s of shown) {
      const card = document.createElement("div");
      card.className = "song-card";
      card.innerHTML = `
        <div class="song-title"></div>
        <div class="card-stars"></div>
        <div class="song-meta"></div>
        <div class="song-actions">
          <button class="btn accent" data-act="listen">▶ Listen</button>
        </div>`;
      card.querySelector(".song-title").textContent = s.title;
      card.querySelector(".card-stars").textContent = SaxRatings.stars(SaxRatings.get(s.id));
      // text, never markup: level/tempo/meter can come from localStorage
      card.querySelector(".song-meta").textContent = `${s.level} · ${Number(s.tempo)} bpm · ${Number(s.meter)}/4`;
      card.querySelector("[data-act=listen]").addEventListener("click", () => start(s, "listen"));
      wrap.appendChild(card);
    }
    if (!shown.length) wrap.innerHTML = `<p class="dim">No songs match — try another search or category.</p>`;
  }

  // Nearest note glyph (with optional dot) for a length in beats.
  const GLYPHS = [[6, "w", true], [4, "w", false], [3, "h", true], [2, "h", false], [1.5, "q", true], [1, "q", false], [0.75, "e", true], [0.5, "e", false]];
  function glyphFor(beats) {
    let best = GLYPHS[GLYPHS.length - 1], err = Infinity;
    for (const g of GLYPHS) {
      const e = Math.abs(Math.log2(g[0]) - Math.log2(Math.max(beats, 0.25)));
      if (e < err - 1e-9) { err = e; best = g; }
    }
    return { dur: best[1], dot: best[2] };
  }

  // ---------- shared staff rendering of a song ----------
  function renderSongStaff(svg, s, tl) {
    const width = FIRST_X + 60 + tl.total * PX_PER_BEAT;
    svg.setAttribute("viewBox", `0 0 ${width} 330`);
    svg.style.width = mode === "listen" ? width + "px" : "";
    svg.innerHTML = "";
    const staff = ST.create(svg, { yE4: Y_E4, left: 12, right: width - 8, clef: mode === "listen" });
    const layer = ST.el("g", {}, svg);
    // draw staff lines full width inside layer for game (they scroll with notes)
    staff.drawLines();
    for (let b = s.meter; b < tl.total; b += s.meter) {
      staff.drawBarline(FIRST_X + b * PX_PER_BEAT - PX_PER_BEAT * 0.45, { parent: layer });
    }
    const groups = tl.events.map(ev => {
      const x = FIRST_X + ev.start * PX_PER_BEAT;
      const { dur, dot } = glyphFor(ev.beats);
      if (!ev.note) return staff.drawRest(x, { dur, dot, parent: layer });
      return staff.drawNote(ev.note, x, { dur, dot, parent: layer });
    });
    return { staff, layer, groups, width };
  }

  // ---------- start / stop ----------
  function start(s, m) {
    stop(true);
    song = s;
    mode = m;
    const tl = buildTimeline(s);
    timeline = tl;
    $("pm-songs").style.display = "none";
    $("pm-filters").style.display = "none";
    $("pm-stage").style.display = "";
    $("pm-title").textContent = s.title + (m === "game" ? " — play along!" : "");
    $("pm-listen").style.display = m === "listen" ? "" : "none";
    $("pm-game-wrap").style.display = m === "game" ? "" : "none";
    $("pm-speed").style.display = m === "game" ? "" : "none";
    $("pm-edit").style.display = m === "listen" ? "" : "none";
    if ($("pm-rating")) SaxRatings.widget($("pm-rating"), s.id);
    $("pm-summary").style.display = "none";
    speed = +$("pm-speed-sel").value;
    spb = m === "listen" ? 60 / (s.tempo * listenSpeed) : 60 / (s.tempo * speed);
    countIn = s.meter;
    score = 0; streak = 0; bestStreak = 0; hits = 0; perfects = 0; misses = 0;
    updateHud();

    if (m === "listen") {
      const r = renderSongStaff($("pm-staff"), s, tl);
      listenGroups = r.groups;
      // full-height click zone per note → seek there
      const inst = SaxInstrument.get();
      const showTab = inst.id === "guitar" && inst.positions;
      listenGroups.forEach((g, i) => {
        const ev = tl.events[i];
        const x = FIRST_X + ev.start * PX_PER_BEAT;
        // guitar tab lane: string letter over fret number under each note
        if (showTab && ev.note) {
          const p = inst.positions(ev.note.midi)[0];
          if (p) {
            const ts = ST.el("text", {
              x, y: 310, "text-anchor": "middle", "font-size": 11,
              fill: "var(--muted)", "font-family": "inherit"
            }, g);
            ts.textContent = inst.stringNames[p.s];
            const tf = ST.el("text", {
              x, y: 326, "text-anchor": "middle", "font-size": 15,
              "font-weight": 700, fill: "var(--ink)", "font-family": "inherit"
            }, g);
            tf.textContent = p.f;
          }
        }
        ST.el("rect", {
          x: x - 14, y: 0,
          width: Math.max(ev.beats * PX_PER_BEAT, 28), height: 330,
          fill: "transparent"
        }, g);
        g.style.cursor = "pointer";
        g.addEventListener("click", () => seekListen(ev.start));
      });
      startListenPlayback();
    } else {
      const r = renderSongStaff($("pm-game-staff"), s, tl);
      gameGroups = r.groups;
      gameLayer = r.layer;
      // hit line + zone drawn on top, fixed
      const svg = $("pm-game-staff");
      const vb = `0 0 1000 330`;
      svg.setAttribute("viewBox", vb);
      svg.style.width = "";
      ST.el("rect", { x: HIT_X - 26, y: 30, width: 52, height: 270, fill: "var(--accent)", opacity: 0.10, rx: 8 }, svg);
      ST.el("line", { x1: HIT_X, x2: HIT_X, y1: 30, y2: 300, stroke: "var(--accent)", "stroke-width": 2, opacity: 0.8 }, svg);
      svg.insertBefore(gameLayer, null); // keep notes above the zone? zone behind: move layer last
      startGame();
    }
  }

  // Listen playback schedules audio incrementally (~1s lookahead) so pause,
  // mute, and loop take effect immediately instead of fighting a fully
  // pre-scheduled WebAudio queue.
  let listenPaused = false, listenMuted = false, listenLoop = false;
  let pausedBeat = 0, nextNoteIdx = 0, listenSpeed = 1, listenIdx = -1;

  function firstEventAtOrAfter(beat) {
    const i = timeline.events.findIndex(e => e.start >= beat);
    return i < 0 ? timeline.events.length : i;
  }

  // Keep the current note centered once it passes mid-view; never scroll
  // before the start (so the opening keeps its left-edge context).
  function centerListen(beat) {
    const wrap = $("pm-scroll");
    const x = FIRST_X + beat * PX_PER_BEAT;
    const target = Math.max(0, x - wrap.clientWidth / 2);
    // smooth scrolling stalls in hidden tabs (rAF-driven) — fall back to instant
    wrap.scrollTo({ left: target, behavior: document.visibilityState === "visible" ? "smooth" : "auto" });
  }

  // Single source of truth for the highlighted note: recolors staff, updates
  // the fingering panel, and scrolls. Everything (playback, seek, arrows) goes
  // through here so the shown note and the step reference never disagree.
  function highlightListen(idx, { scroll = true } = {}) {
    if (idx === listenIdx) return;
    if (listenIdx >= 0 && listenGroups[listenIdx]) ST.setColor(listenGroups[listenIdx], "var(--ink)");
    listenIdx = idx;
    const ev = timeline.events[idx];
    if (!ev) return;
    ST.setColor(listenGroups[idx], "var(--accent)");
    if (scroll) centerListen(ev.start);
    if (ev.note) {
      F.render($("pm-fing"), ev.note.midi);
      $("pm-fing-name").textContent = ev.note.name;
    } else {
      $("pm-fing-name").textContent = "(rest)";
    }
  }

  // Ctrl+←/→: jump to the start of the previous / next bar (song's meter).
  function skipBarListen(dir) {
    if (mode !== "listen" || !timeline.events || !timeline.events.length) return;
    const bpb = (song && song.meter) || 4;
    const cur = Math.floor(currentListenBeat() / bpb);
    const lastBar = Math.floor(Math.max(0, timeline.total - 0.01) / bpb);
    const target = Math.max(0, Math.min(lastBar, cur + dir));
    if (target === cur && dir > 0) return; // already in the last bar
    seekListen(target * bpb);
  }

  function currentListenBeat() {
    if (listenPaused) return pausedBeat;
    if (running) return (A.now() - t0) / spb;
    const ev = timeline.events[listenIdx];
    return ev ? ev.start : 0;
  }

  // ←/→: jump to the previous/next actual note (rests skipped), relative to
  // the note currently highlighted on screen.
  function stepListen(dir) {
    if (mode !== "listen" || !timeline.events) return;
    let i = listenIdx;
    // find the next event in `dir` that carries a note
    for (i += dir; i >= 0 && i < timeline.events.length; i += dir) {
      if (timeline.events[i].note) { seekListen(timeline.events[i].start); return; }
    }
  }

  function updateListenButtons() {
    $("pm-pause").textContent = listenPaused ? "▶ Resume" : "⏸ Pause";
    $("pm-mute").textContent = listenMuted ? "🔇 Sound: off" : "🔊 Sound: on";
    $("pm-loop").textContent = listenLoop ? "🔁 Loop: on" : "🔁 Loop: off";
    $("pm-loop").classList.toggle("sel", listenLoop);
  }

  function startListenPlayback(fromBeat = 0) {
    running = true;
    listenPaused = false;
    nextNoteIdx = firstEventAtOrAfter(fromBeat);
    $("pm-listen-end").style.display = "none";
    updateListenButtons();
    if (fromBeat === 0) { $("pm-fing-name").textContent = "–"; listenIdx = -1; }
    t0 = A.now() + 0.2 - fromBeat * spb;
    const tick = () => {
      if (!running || mode !== "listen") return;
      if (listenPaused) { rafId = A.raf(tick); return; }
      const now = A.now();
      const cur = (now - t0) / spb;
      // schedule upcoming notes just-in-time
      while (nextNoteIdx < timeline.events.length) {
        const ev = timeline.events[nextNoteIdx];
        const at = t0 + ev.start * spb;
        if (at >= now + 1) break;
        if (!listenMuted && ev.note && at >= now - 0.05) {
          A.playNote(ev.note.midi, {
            dur: Math.max(0.18, ev.beats * spb * 0.92),
            when: Math.max(0, at - now)
          });
        }
        nextNoteIdx++;
      }
      const idx = timeline.events.findIndex(e => cur >= e.start && cur < e.start + e.beats);
      if (idx >= 0) highlightListen(idx);
      if (cur < timeline.total + 1) {
        rafId = A.raf(tick);
      } else if (listenLoop) {
        if (listenIdx >= 0) ST.setColor(listenGroups[listenIdx], "var(--ink)");
        listenIdx = -1;
        $("pm-scroll").scrollLeft = 0;
        startListenPlayback();
      } else {
        running = false;
        $("pm-listen-end").style.display = "";
      }
    };
    rafId = A.raf(tick);
  }

  function toggleListenPause() {
    if (!running || mode !== "listen") return;
    if (!listenPaused) {
      pausedBeat = (A.now() - t0) / spb;
      listenPaused = true;
      A.stopAll();
      nextNoteIdx = firstEventAtOrAfter(pausedBeat); // resume from here
    } else {
      t0 = A.now() - pausedBeat * spb; // re-anchor the clock
      listenPaused = false;
    }
    updateListenButtons();
  }

  // Click a note (or arrow-step) on the listen staff → jump playback to it
  function seekListen(beat) {
    if (mode !== "listen") return;
    A.stopAll();
    const i = timeline.events.findIndex(e => beat >= e.start && beat < e.start + e.beats);
    if (!running) {
      // song had ended — restart playback from the clicked note
      startListenPlayback(beat);
      if (i >= 0) highlightListen(i);
      return;
    }
    t0 = A.now() + 0.15 - beat * spb;
    nextNoteIdx = firstEventAtOrAfter(beat);
    if (listenPaused) pausedBeat = beat;
    if (i >= 0) highlightListen(i);
  }

  // ± playback speed; re-anchor the clock so the current position holds
  function changeListenSpeed(delta) {
    const next = Math.round(Math.max(30, Math.min(200, listenSpeed * 100 + delta * 100))) / 100;
    if (next === listenSpeed) return;
    const wasBeat = (mode === "listen" && (running || listenPaused)) ? currentListenBeat() : null;
    listenSpeed = next;
    $("pm-speed-val").textContent = Math.round(listenSpeed * 100) + "%";
    if (mode !== "listen" || wasBeat === null) return;
    spb = 60 / (song.tempo * listenSpeed);
    if (running && !listenPaused) {
      A.stopAll();
      t0 = A.now() - wasBeat * spb;
      nextNoteIdx = firstEventAtOrAfter(wasBeat);
    }
    // paused: resume re-anchors from pausedBeat with the new spb on its own
  }

  function toggleListenMute() {
    listenMuted = !listenMuted;
    if (listenMuted) {
      A.stopAll(); // cut anything already scheduled in the lookahead window
    } else if (running && mode === "listen" && !listenPaused) {
      // rewind the scheduler so notes silently skipped in the lookahead play
      nextNoteIdx = firstEventAtOrAfter((A.now() - t0) / spb);
    }
    updateListenButtons();
  }

  // ---------- play-along game ----------
  let nextTickBeat = 0;
  function startGame() {
    running = true;
    t0 = A.now() + 0.2 + countIn * spb; // beat 0 lands after the count-in
    nextTickBeat = -countIn;
    const tick = () => {
      if (!running) return;
      const cur = (A.now() - t0) / spb;
      // schedule metronome ~1s ahead
      while ((nextTickBeat * spb + t0) < A.now() + 1 && nextTickBeat < timeline.total) {
        A.playTick({ when: nextTickBeat * spb + t0 - A.now(), strong: ((nextTickBeat % song.meter) + song.meter) % song.meter === 0 });
        nextTickBeat++;
      }
      // scroll the note layer so beat `cur` sits at the hit line
      gameLayer.setAttribute("transform", `translate(${HIT_X - FIRST_X - cur * PX_PER_BEAT} 0)`);
      // misses: pending notes that drifted past the window
      timeline.events.forEach((ev, i) => {
        if (ev.note && ev.status === "pending" && cur > ev.start + WINDOW) {
          ev.status = "miss";
          misses++;
          streak = 0;
          ST.setColor(gameGroups[i], "var(--bad)");
          updateHud();
        }
      });
      if (cur >= -countIn && cur < 0) $("pm-count").textContent = Math.ceil(-cur);
      else $("pm-count").textContent = "";
      if (cur < timeline.total + 1.2) rafId = A.raf(tick);
      else finishGame();
    };
    rafId = A.raf(tick);
  }

  function judge(letter) {
    if (!running || mode !== "game") return;
    const cur = (A.now() - t0) / spb;
    let best = -1, bestOff = Infinity;
    timeline.events.forEach((ev, i) => {
      if (!ev.note || ev.status !== "pending") return;
      const off = Math.abs(cur - ev.start);
      if (off <= WINDOW && off < bestOff) { best = i; bestOff = off; }
    });
    if (best < 0) return; // nothing hittable — ignore stray presses
    const ev = timeline.events[best];
    if (letter === ev.note.letter) {
      const perfect = bestOff <= PERFECT;
      ev.status = "hit";
      hits++;
      if (perfect) perfects++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      score += perfect ? 100 : 50;
      ST.setColor(gameGroups[best], "var(--good)");
      A.playNote(ev.note.midi, { dur: Math.max(0.18, ev.beats * spb * 0.9) });
      flashJudgment(perfect ? "Perfect!" : "Good", perfect ? "good" : "ok");
    } else {
      ev.status = "miss";
      misses++;
      streak = 0;
      ST.setColor(gameGroups[best], "var(--bad)");
      A.playBuzz();
      flashJudgment(`✗ that was ${ev.note.letter}`, "bad");
    }
    updateHud();
  }

  function flashJudgment(text, cls) {
    const j = $("pm-judge");
    j.textContent = text;
    j.className = "judge " + cls;
    j.classList.remove("show");
    void j.offsetWidth;
    j.classList.add("show");
  }

  function updateHud() {
    $("pm-score").textContent = score;
    $("pm-streak").textContent = streak;
    const total = timeline.events ? timeline.events.filter(e => e.note).length : 0;
    $("pm-progress").textContent = `${hits + misses}/${total}`;
  }

  function finishGame() {
    running = false;
    const total = timeline.events.filter(e => e.note).length;
    $("pm-summary").style.display = "";
    $("pm-summary-body").innerHTML = `
      <div class="sum-score">${score}</div>
      <div class="sum-line">${hits}/${total} notes hit · ${perfects} perfect · best streak ${bestStreak}</div>
      <div class="sum-line">${total ? Math.round((hits / total) * 100) : 0}% accuracy${hits === total ? " — flawless! 🏆" : ""}</div>`;
  }

  function stop(silent) {
    running = false;
    if (rafId) A.caf(rafId);
    A.stopAll();
    if (!silent) backToSongs();
  }

  function backToSongs() {
    running = false;
    if (rafId) A.caf(rafId);
    A.stopAll();
    mode = null;
    $("pm-stage").style.display = "none";
    $("pm-songs").style.display = "";
    $("pm-filters").style.display = "";
    renderSongList(); // pick up any rating change in the ordering
  }

  function onKeyDown(ev) {
    if (!active || ev.altKey) return;
    if (ev.ctrlKey || ev.metaKey) {
      if (mode === "listen" && ev.key === "ArrowRight") { skipBarListen(1); ev.preventDefault(); }
      else if (mode === "listen" && ev.key === "ArrowLeft") { skipBarListen(-1); ev.preventDefault(); }
      return;
    }
    if (mode === "listen") {
      if (ev.key === "ArrowRight") { stepListen(1); ev.preventDefault(); return; }
      if (ev.key === "ArrowLeft") { stepListen(-1); ev.preventDefault(); return; }
      if (ev.key === " ") {
        if (running) toggleListenPause();
        else start(song, "listen"); // ended → replay from the top
        ev.preventDefault();
        return;
      }
    }
    if (ev.repeat) return;
    const k = ev.key.toUpperCase();
    if (k === "ESCAPE") { if (mode) backToSongs(); return; }
    if (T.LETTERS.includes(k)) judge(k);
  }

  function init() {
    renderSongList();
    $("pm-search").addEventListener("input", ev => { searchText = ev.target.value; renderSongList(); });
    document.querySelectorAll("#pm-levels button").forEach(b =>
      b.addEventListener("click", () => {
        filterLevel = b.dataset.level;
        document.querySelectorAll("#pm-levels button").forEach(x => x.classList.toggle("sel", x === b));
        renderSongList();
      }));
    $("pm-back").addEventListener("click", backToSongs);
    $("pm-replay").addEventListener("click", () => start(song, mode || "game"));
    $("pm-pause").addEventListener("click", toggleListenPause);
    $("pm-mute").addEventListener("click", toggleListenMute);
    $("pm-loop").addEventListener("click", () => { listenLoop = !listenLoop; updateListenButtons(); });
    $("pm-again").addEventListener("click", () => start(song, "listen"));
    $("pm-slower").addEventListener("click", () => changeListenSpeed(-0.1));
    $("pm-faster").addEventListener("click", () => changeListenSpeed(0.1));
    $("pm-edit").addEventListener("click", () => {
      if (!song) return;
      SaxBuilder.loadSong(song.notes, song.tempo, song.title);
      backToSongs();
      document.querySelector('#tabs button[data-tab="build"]').click();
    });
    $("pm-speed-sel").addEventListener("change", () => { if (mode === "game") start(song, "game"); });
    document.addEventListener("keydown", onKeyDown);
    const keys = $("pm-keys");
    for (const l of ["A", "B", "C", "D", "E", "F", "G"]) {
      const b = document.createElement("button");
      b.textContent = l;
      b.addEventListener("click", () => judge(l));
      keys.appendChild(b);
    }
  }

  return {
    init,
    activate() { active = true; renderSongList(); }, // pick up newly saved tracks
    deactivate() { active = false; if (mode) backToSongs(); }
  };
})();
