// Tab 3: Track builder — click a staff position to append notes, then play back.
window.SaxBuilder = (() => {
  const T = SaxTheory, ST = SaxStaff, A = SaxAudio;
  const Y_E4 = 190, FIRST_X = 120, DX = 52;
  const BEATS = { w: 4, h: 2, q: 1, e: 0.5 };
  const STORE_KEY = "saxtrainer.tracks";
  let svg, staff, active = false;
  let track = []; // {rest:true, dur} | {name, dur}  (dur = "w"|"h"|"q"|"e")
  let groups = [];
  let curDur = "q", curAcc = null;
  let ghostG = null, ghostStep = null;
  let playing = false, rafId = null;

  const $ = id => document.getElementById(id);

  function widthFor() { return Math.max(1100, FIRST_X + (track.length + 2) * DX); }

  function noteAt(step, acc) {
    // step is diatonic (0 = E4); derive letter/octave then apply accidental
    const diatonic = step + 30;
    const letter = T.LETTERS[((diatonic % 7) + 7) % 7];
    const octave = Math.floor(diatonic / 7);
    try {
      const inst = SaxInstrument.get();
      const n = T.noteByName(letter + (acc || "") + octave);
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
    let beatsAcc = 0;
    groups = track.map((item, i) => {
      const x = FIRST_X + i * DX;
      let g;
      if (item.rest) {
        g = staff.drawRest(x, { dur: item.dur });
      } else {
        g = staff.drawNote(T.noteByName(item.name), x, { dur: item.dur });
      }
      g.dataset.index = i;
      g.style.cursor = "pointer";
      beatsAcc += BEATS[item.dur];
      if (beatsAcc % 4 === 0 && i < track.length - 1) {
        staff.drawBarline(x + DX / 2);
      }
      return g;
    });
    // insertion marker at the next slot
    const nx = FIRST_X + track.length * DX;
    ST.el("line", {
      x1: nx, x2: nx, y1: staff.yOf(10), y2: staff.yOf(-4),
      stroke: "var(--accent)", "stroke-width": 1.5, "stroke-dasharray": "4 4", opacity: 0.6
    }, svg);
    ghostG = null;
    updateStats();
  }

  function updateStats() {
    const beats = track.reduce((s, it) => s + BEATS[it.dur], 0);
    $("tb-stats").textContent = track.length
      ? `${track.length} notes · ${beats} beats · ${Math.ceil(beats / 4)} bars`
      : "Empty track — click on the staff to add your first note";
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
    if (playing) return;
    const p = svgPoint(ev);
    const step = stepFromY(p.y);
    if (step === ghostStep && ghostG) return;
    ghostStep = step;
    if (ghostG) ghostG.remove();
    const n = noteAt(step, curAcc);
    if (!n) { ghostG = null; return; }
    ghostG = staff.drawNote(n, FIRST_X + track.length * DX, { dur: curDur, ghost: true, color: "var(--accent)" });
  }

  function onLeave() {
    if (ghostG) { ghostG.remove(); ghostG = null; ghostStep = null; }
  }

  function onClick(ev) {
    if (playing) return;
    // clicking an existing note removes it
    const g = ev.target.closest("g[data-index]");
    if (g && ev.target.tagName !== "svg") {
      const idx = +g.dataset.index;
      track.splice(idx, 1);
      render();
      return;
    }
    const p = svgPoint(ev);
    const n = noteAt(stepFromY(p.y), curAcc);
    if (!n) return;
    track.push({ name: n.letter + (n.acc || "") + n.octave, dur: curDur });
    A.playNote(n.midi, { dur: 0.3, vel: 0.5 });
    render();
    scrollToEnd();
  }

  function scrollToEnd() {
    const wrap = $("tb-scroll");
    wrap.scrollLeft = wrap.scrollWidth;
  }

  function addRest() {
    if (playing) return;
    track.push({ rest: true, dur: curDur });
    render();
    scrollToEnd();
  }

  function undo() { if (!playing && track.length) { track.pop(); render(); } }
  function clearAll() { if (!playing) { track = []; render(); } }

  function play() {
    if (playing || !track.length) return;
    playing = true;
    $("tb-play").textContent = "⏹ Stop";
    const tempo = +$("tb-tempo").value;
    const spb = 60 / tempo;
    const t0 = A.now() + 0.15;
    const events = [];
    let beat = 0;
    track.forEach((item, i) => {
      if (!item.rest) {
        const n = T.noteByName(item.name);
        A.playNote(n.midi, { dur: Math.max(0.15, BEATS[item.dur] * spb * 0.92), when: (t0 - A.now()) + beat * spb });
      }
      events.push({ i, start: beat, end: beat + BEATS[item.dur] });
      beat += BEATS[item.dur];
    });
    const total = beat;
    let lastIdx = -1;
    const tick = () => {
      const cur = (A.now() - t0) / spb;
      const ev = events.find(e => cur >= e.start && cur < e.end);
      const idx = ev ? ev.i : -1;
      if (idx !== lastIdx) {
        if (lastIdx >= 0 && groups[lastIdx]) ST.setColor(groups[lastIdx], "var(--ink)");
        if (idx >= 0 && groups[idx]) {
          ST.setColor(groups[idx], "var(--accent)");
          groups[idx].scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
    $("tb-play").textContent = "▶ Play";
    if (rafId) A.caf(rafId);
    A.stopAll();
    render();
  }

  // ---- save / load (localStorage) ----
  function savedTracks() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function refreshLoadList() {
    const sel = $("tb-load");
    const names = Object.keys(savedTracks());
    sel.innerHTML = "<option value=''>Load a saved track…</option>" +
      names.map(n => `<option>${n.replace(/</g, "&lt;")}</option>`).join("");
  }
  function save() {
    const name = $("tb-name").value.trim();
    if (!name || !track.length) return;
    const all = savedTracks();
    all[name] = { tempo: +$("tb-tempo").value, items: track };
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    refreshLoadList();
    $("tb-load").value = name;
  }
  function load(name) {
    const all = savedTracks();
    if (!all[name]) return;
    if (playing) stop();
    // old saves were a bare array; new ones are {tempo, items}
    const t = all[name];
    track = Array.isArray(t) ? t : t.items;
    if (!Array.isArray(t) && t.tempo) {
      $("tb-tempo").value = t.tempo;
      $("tb-tempo-val").textContent = t.tempo + " bpm";
    }
    $("tb-name").value = name;
    render();
  }
  function removeSaved() {
    const name = $("tb-load").value;
    if (!name) return;
    const all = savedTracks();
    delete all[name];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
    refreshLoadList();
  }

  function init() {
    svg = $("tb-staff");
    render();
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
    svg.addEventListener("click", onClick);

    document.querySelectorAll("#tb-durs button").forEach(b =>
      b.addEventListener("click", () => {
        curDur = b.dataset.dur;
        document.querySelectorAll("#tb-durs button").forEach(x => x.classList.toggle("sel", x === b));
      }));
    document.querySelectorAll("#tb-accs button").forEach(b =>
      b.addEventListener("click", () => {
        curAcc = b.dataset.acc || null;
        document.querySelectorAll("#tb-accs button").forEach(x => x.classList.toggle("sel", x === b));
      }));

    $("tb-rest").addEventListener("click", addRest);
    $("tb-undo").addEventListener("click", undo);
    $("tb-clear").addEventListener("click", clearAll);
    $("tb-play").addEventListener("click", () => playing ? stop() : play());
    $("tb-tempo").addEventListener("input", () => $("tb-tempo-val").textContent = $("tb-tempo").value + " bpm");
    $("tb-save").addEventListener("click", save);
    $("tb-load").addEventListener("change", ev => load(ev.target.value));
    $("tb-delete").addEventListener("click", removeSaved);
    refreshLoadList();
  }

  return { init, activate() { active = true; }, deactivate() { active = false; if (playing) stop(); } };
})();
