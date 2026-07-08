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

  function userSongs() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("saxtrainer.tracks") || "{}"); }
    catch (e) { return []; }
    return Object.entries(saved).map(([name, t]) => {
      const items = Array.isArray(t) ? t : t.items;
      return {
        id: "user:" + name, title: name,
        tempo: (!Array.isArray(t) && t.tempo) || 100, meter: 4, level: "My Tracks",
        notes: items.map(it => it.rest ? [null, DUR_BEATS[it.dur]] : [it.name, DUR_BEATS[it.dur]])
      };
    });
  }

  function renderSongList() {
    const wrap = $("pm-songs");
    wrap.innerHTML = "";
    const q = searchText.trim().toLowerCase();
    const shown = [...SaxSongs, ...userSongs()].filter(s =>
      (!filterLevel || s.level === filterLevel) &&
      (!q || s.title.toLowerCase().includes(q)));
    $("pm-count").textContent = `${shown.length} song${shown.length === 1 ? "" : "s"}`;
    for (const s of shown) {
      const card = document.createElement("div");
      card.className = "song-card";
      card.innerHTML = `
        <div class="song-title"></div>
        <div class="song-meta">${s.level} · ${s.tempo} bpm · ${s.meter}/4</div>
        <div class="song-actions">
          <button class="btn accent" data-act="listen">▶ Listen</button>
        </div>`;
      card.querySelector(".song-title").textContent = s.title;
      card.querySelector("[data-act=listen]").addEventListener("click", () => start(s, "listen"));
      wrap.appendChild(card);
    }
    if (!shown.length) wrap.innerHTML = `<p class="dim">No songs match — try another search or category.</p>`;
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
      const dur = ev.beats >= 4 ? "w" : ev.beats >= 2 ? "h" : ev.beats >= 1 ? "q" : "e";
      if (!ev.note) return staff.drawRest(x, { dur, parent: layer });
      return staff.drawNote(ev.note, x, { dur, parent: layer });
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
    $("pm-summary").style.display = "none";
    speed = +$("pm-speed-sel").value;
    spb = 60 / (s.tempo * speed);
    countIn = s.meter;
    score = 0; streak = 0; bestStreak = 0; hits = 0; perfects = 0; misses = 0;
    updateHud();

    if (m === "listen") {
      const r = renderSongStaff($("pm-staff"), s, tl);
      listenGroups = r.groups;
      // full-height click zone per note → seek there
      listenGroups.forEach((g, i) => {
        const ev = tl.events[i];
        ST.el("rect", {
          x: FIRST_X + ev.start * PX_PER_BEAT - 14, y: 0,
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
  let pausedBeat = 0, nextNoteIdx = 0;

  function firstEventAtOrAfter(beat) {
    const i = timeline.events.findIndex(e => e.start >= beat);
    return i < 0 ? timeline.events.length : i;
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
    $("pm-fing-name").textContent = "–";
    t0 = A.now() + 0.2 - fromBeat * spb;
    let lastIdx = -1;
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
      // highlight the sounding note + live fingering
      const idx = timeline.events.findIndex(e => cur >= e.start && cur < e.start + e.beats);
      if (idx !== lastIdx) {
        if (lastIdx >= 0) ST.setColor(listenGroups[lastIdx], "var(--ink)");
        const ev = timeline.events[idx];
        if (ev) {
          ST.setColor(listenGroups[idx], "var(--accent)");
          listenGroups[idx].scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
          if (ev.note) {
            F.render($("pm-fing"), ev.note.midi);
            $("pm-fing-name").textContent = ev.note.name;
          } else {
            $("pm-fing-name").textContent = "(rest)";
          }
        }
        lastIdx = idx;
      }
      if (cur < timeline.total + 1) {
        rafId = A.raf(tick);
      } else if (listenLoop) {
        listenGroups.forEach(g => ST.setColor(g, "var(--ink)"));
        $("pm-scroll").scrollLeft = 0;
        startListenPlayback();
      } else {
        running = false;
        if (lastIdx >= 0) ST.setColor(listenGroups[lastIdx], "var(--ink)");
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

  // Click a note on the listen staff → jump playback to it
  function seekListen(beat) {
    if (mode !== "listen") return;
    A.stopAll();
    listenGroups.forEach(g => ST.setColor(g, "var(--ink)"));
    if (!running) { startListenPlayback(beat); return; }
    t0 = A.now() + 0.15 - beat * spb;
    nextNoteIdx = firstEventAtOrAfter(beat);
    if (listenPaused) {
      pausedBeat = beat;
      // show the seek target while paused
      const i = timeline.events.findIndex(e => beat >= e.start && beat < e.start + e.beats);
      const ev = timeline.events[i];
      if (ev) {
        ST.setColor(listenGroups[i], "var(--accent)");
        if (ev.note) {
          F.render($("pm-fing"), ev.note.midi);
          $("pm-fing-name").textContent = ev.note.name;
        }
      }
    }
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
  }

  function onKeyDown(ev) {
    if (!active || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
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
