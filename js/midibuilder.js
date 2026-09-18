// Tab: MIDI Mixer — pick a MIDI from the bundled collection, audition each of
// its instrument tracks in a read-only Track Builder view, and copy notes (S)
// or whole bars (D) into a full Track Builder below, which saves to My Tracks.
//
// Keys: Space play/pause source · ↑/↓ switch track · ←/→ step source notes
//       S copy current note · D copy current bar · Backspace undo last pick
//       (↑/↓/←/→ act on the custom track instead while one of its notes is selected)
window.SaxMidiBuilder = (() => {
  const RAW = "https://raw.githubusercontent.com/AyHa1810/touhou-midi-collection/main/";
  const LO = 55, HI = 88; // fold source notes into a readable range

  let active = false;
  let parsed = null;   // { title, bpm, beatsPerBar, tracks:[{name, notes:[[name,beats]...]}] }
  let curTrack = 0;
  let src = null, out = null; // Track Builder instances

  const $ = id => document.getElementById(id);
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function fold(m) { while (m > HI) m -= 12; while (m < LO) m += 12; return m; }
  function nameOf(m) { m = fold(m); return NAMES[m % 12] + (Math.floor(m / 12) - 1); }

  // ---------------- minimal Standard MIDI File parser ----------------
  function parseMidi(buf) {
    const dv = new DataView(buf);
    let p = 0;
    const str = n => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint8(p++)); return s; };
    const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
    if (str(4) !== "MThd") throw new Error("Not a MIDI file");
    u32(); u16();
    const ntrk = u16();
    const division = u16();
    const ppq = division & 0x8000 ? 480 : division;
    const vlq = () => { let v = 0, b; do { b = dv.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    const rawTracks = [];
    let tempoUs = 500000, tsNum = 4, tsDen = 4;
    for (let t = 0; t < ntrk; t++) {
      if (str(4) !== "MTrk") break;
      const len = u32(), end = p + len;
      let tick = 0, status = 0, name = "";
      const on = {}, notes = [];
      while (p < end) {
        tick += vlq();
        let b = dv.getUint8(p);
        if (b & 0x80) { status = b; p++; } else { b = status; } // running status
        if (b === 0xff) {
          const meta = dv.getUint8(p++); const l = vlq();
          if (meta === 0x03 && !name) { for (let i = 0; i < l; i++) name += String.fromCharCode(dv.getUint8(p + i)); }
          else if (meta === 0x51 && l === 3) { tempoUs = (dv.getUint8(p) << 16) | (dv.getUint8(p + 1) << 8) | dv.getUint8(p + 2); }
          else if (meta === 0x58 && l >= 2) { tsNum = dv.getUint8(p); tsDen = Math.pow(2, dv.getUint8(p + 1)); }
          p += l;
        } else if (b === 0xf0 || b === 0xf7) {
          p += vlq();
        } else {
          const type = b & 0xf0, ch = b & 0x0f;
          const d1 = dv.getUint8(p++);
          const d2 = (type !== 0xc0 && type !== 0xd0) ? dv.getUint8(p++) : 0;
          if (ch !== 9) { // skip drums
            if (type === 0x90 && d2 > 0) { (on[d1] = on[d1] || []).push(tick); }
            else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
              const stack = on[d1];
              if (stack && stack.length) {
                const st = stack.shift();
                notes.push({ midi: d1, start: st / ppq, beats: Math.max(0.0625, (tick - st) / ppq) });
              }
            }
          }
        }
      }
      p = end;
      if (notes.length) rawTracks.push({ name: (name || "").trim(), notes });
    }
    return { rawTracks, bpm: Math.round(60000000 / tempoUs), beatsPerBar: tsNum * (4 / tsDen) };
  }

  // Reduce a raw track to a monophonic line (top note per 16th slot), then to
  // the builder's [name, beats] form with gaps filled by rests.
  function toSongNotes(raw) {
    const slots = {};
    for (const n of raw.notes) {
      const s = Math.round(n.start * 4) / 4;
      if (!(s in slots) || n.midi > slots[s].midi) slots[s] = { midi: n.midi, beats: n.beats };
    }
    const starts = Object.keys(slots).map(Number).sort((a, b) => a - b);
    // Shift the whole track by octaves so its median pitch sits on the staff
    // (around B4): bass and lead parts then read as normal notes instead of a
    // wall of ledger lines, and the melodic contour stays intact.
    if (starts.length) {
      const sorted = starts.map(s => slots[s].midi).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const shift = Math.round((71 - median) / 12) * 12;
      if (shift) for (const s of starts) slots[s].midi += shift;
    }
    const notes = [];
    let cursor = starts.length ? starts[0] : 0; // trim leading silence
    starts.forEach((s, i) => {
      if (s - cursor >= 0.5) notes.push([null, Math.round((s - cursor) * 2) / 2]); // rest for the gap
      const next = starts[i + 1];
      let beats = Math.min(slots[s].beats, next != null ? next - s : slots[s].beats);
      beats = Math.max(0.5, Math.round(beats * 2) / 2);
      notes.push([nameOf(slots[s].midi), beats]);
      cursor = s + beats;
    });
    return notes;
  }

  // ---------------- collection picker ----------------
  function renderPicker(filter) {
    const wrap = $("mb-results");
    // word-based, punctuation-blind search: every typed word must appear
    // somewhere in "title game", in any order ("help me erin" finds
    // "Help me, ERINNNNNN!!")
    const norm = str => str.toLowerCase().replace(/[^a-z0-9À-￿]+/g, " ");
    const words = norm(filter || "").split(" ").filter(Boolean);
    const rows = (window.SaxMidiLib || []).filter(r => {
      if (!words.length) return true;
      const hay = " " + norm(r.t + " " + r.g) + " ";
      return words.every(w => hay.includes(w));
    }).slice(0, 60);
    wrap.innerHTML = "";
    for (const r of rows) {
      const b = document.createElement("button");
      b.className = "mb-row";
      b.innerHTML = `<span class="mb-t"></span><span class="mb-n"></span><span class="mb-g"></span>`;
      b.querySelector(".mb-t").textContent = r.t;
      b.querySelector(".mb-n").textContent = r.n ? `${r.n} track${r.n === 1 ? "" : "s"}` : "";
      b.querySelector(".mb-g").textContent = r.g;
      b.addEventListener("click", () => loadMidi(r));
      wrap.appendChild(b);
    }
    $("mb-count").textContent = (window.SaxMidiLib || []).length
      ? `${rows.length} shown${rows.length === 60 ? " (refine search)" : ""}`
      : "collection index not loaded";
  }

  // Encode every path segment (encodeURI leaves # ? + & alone, which breaks
  // some filenames in the collection).
  const encPath = p => p.split("/").map(encodeURIComponent).join("/");

  // Fetch a MIDI's bytes: raw.githubusercontent first; for filenames the raw
  // host refuses (double-encoded names like "ZuÃ±iga") fall back to the GitHub
  // API blob, which is addressed by sha instead of by path.
  const CDN = "https://cdn.jsdelivr.net/gh/AyHa1810/touhou-midi-collection@main/";

  async function fetchMidi(row) {
    // 1) raw.githubusercontent (skipped for names it is known to refuse, and
    //    for filenames with a comma — Chrome rejects its Content-Disposition)
    if (!row.u) {
      try {
        const res = await fetch(RAW + encPath(row.p));
        if (res.ok) return await res.arrayBuffer();
      } catch (e) { /* fall through */ }
    }
    // 2) jsDelivr's GitHub CDN: clean headers, proper CORS, no API rate limit
    try {
      const res = await fetch(CDN + encPath(row.p));
      if (res.ok) return await res.arrayBuffer();
    } catch (e) { /* fall through */ }
    // 3) GitHub API blob by sha (handles the double-encoded filenames)
    if (!row.s) throw new Error("this file can't be downloaded from GitHub — try another arrangement of the song");
    const api = await fetch(`https://api.github.com/repos/AyHa1810/touhou-midi-collection/git/blobs/${row.s}`,
      { headers: { Accept: "application/vnd.github+json" } });
    if (!api.ok) throw new Error(api.status === 403 ? "GitHub API rate limit reached — try again in a few minutes" : "GitHub API error " + api.status);
    const b64 = (await api.json()).content.split(String.fromCharCode(10)).join("");
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  async function loadMidi(row) {
    $("mb-status").textContent = "Loading " + row.t + "…";
    try {
      const pm = parseMidi(await fetchMidi(row));
      parsed = {
        title: row.t,
        bpm: Math.max(60, Math.min(180, pm.bpm || 120)),
        beatsPerBar: pm.beatsPerBar || 4,
        tracks: pm.rawTracks.map((rt, i) => ({ name: rt.name || `Track ${i + 1}`, notes: toSongNotes(rt) }))
                            .filter(t => t.notes.some(n => n[0]))
      };
      if (!parsed.tracks.length) throw new Error("no playable notes");
      curTrack = 0;
      $("mb-status").textContent = "";
      $("mb-workspace").style.display = "";
      $("mb-picker").style.display = "none";
      $("mb-song-name").textContent = row.t;
      if (!$("mb-out-name").value) $("mb-out-name").value = row.t + " (my mix)";
      out.setTempo(parsed.bpm);
      renderTrackStrip();
      showTrack(0);
    } catch (e) {
      const msg = /Failed to fetch|NetworkError/.test(e.message)
        ? "Couldn't reach GitHub to download the MIDI — check your internet connection and try again."
        : "Couldn't load that MIDI (" + e.message + ").";
      $("mb-status").textContent = msg;
    }
  }

  function backToPicker() {
    src.stop(); out.stop();
    $("mb-workspace").style.display = "none";
    $("mb-picker").style.display = "";
  }

  // ---------------- track strip + source view ----------------
  function renderTrackStrip() {
    const wrap = $("mb-tracks");
    wrap.innerHTML = "";
    parsed.tracks.forEach((tr, i) => {
      const tab = document.createElement("div");
      tab.className = "mb-tab" + (i === curTrack ? " sel" : "");
      const inp = document.createElement("input");
      inp.className = "mb-tab-name"; inp.value = tr.name; inp.title = "Rename this track";
      inp.addEventListener("change", () => { tr.name = inp.value.trim() || tr.name; inp.value = tr.name; updateLabel(); });
      inp.addEventListener("click", e => e.stopPropagation());
      const meta = document.createElement("span");
      meta.className = "mb-tab-meta"; meta.textContent = tr.notes.filter(n => n[0]).length + " notes";
      tab.appendChild(inp); tab.appendChild(meta);
      tab.addEventListener("click", () => showTrack(i));
      wrap.appendChild(tab);
    });
  }

  // Live "bar N · note M" readout — follows playback, selection, stepping.
  function showPos(idx) {
    const el = $("mb-pos");
    if (!el || !parsed) return;
    const p = idx >= 0 ? src.barPos(idx) : null;
    el.textContent = p ? `bar ${p.bar + 1} · note ${p.ord + 1} of ${p.count}` : "bar 1";
  }

  function updateLabel() {
    $("mb-track-label").textContent = `${parsed.tracks[curTrack].name}  ·  track ${curTrack + 1} of ${parsed.tracks.length}`;
  }

  function showTrack(i) {
    if (!parsed || i < 0 || i >= parsed.tracks.length) return;
    curTrack = i;
    document.querySelectorAll("#mb-tracks .mb-tab").forEach((t, k) => t.classList.toggle("sel", k === i));
    src.setBeatsPerBar(parsed.beatsPerBar); // bars follow the MIDI's time signature
    src.loadSong(parsed.tracks[i].notes, parsed.bpm);
    src.setCopied(parsed.tracks[i].copied || []); // restore this track's green bands
    updateLabel();
    showPos(-1);
    const tab = document.querySelectorAll("#mb-tracks .mb-tab")[i];
    if (tab) tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  // ---------------- position-preserving navigation ----------------
  // Ctrl+↑/↓: change track but stay at the same time position (and keep
  // playing if we were). Plain ↑/↓ resets to the start of the new track.
  function switchTrackKeepPosition(dir) {
    const target = curTrack + dir;
    if (!parsed || target < 0 || target >= parsed.tracks.length) return;
    const wasPlaying = src.isPlaying();
    // where are we: which bar, and which note (ordinal) inside that bar
    const curIdx = src.currentIndex();
    const bar = curIdx >= 0 ? Math.floor(src.beatOf(curIdx) / src.beatsPerBar() + 1e-9) : 0;
    const ord = curIdx >= 0 ? Math.max(0, src.barIndices(curIdx).indexOf(curIdx)) : 0;
    showTrack(target); // loads the new track (stops playback)
    if (!src.length()) return;
    // same bar on the new track (or its last bar if it is shorter), then the
    // same ordinal note within that bar (or the bar's last note)
    let ids = src.barIndicesAt(bar);
    let landedBar = bar;
    if (!ids.length) { ids = src.barIndices(src.length() - 1); landedBar = Math.floor(src.beatOf(ids[0]) / src.beatsPerBar() + 1e-9); }
    const idx = ids[Math.min(ord, ids.length - 1)];
    src.select(idx, { play: !wasPlaying });
    if (wasPlaying) src.play(); // play() starts from the selected note
    const shorter = landedBar !== bar ? " (track is shorter — jumped to its last bar)" : "";
    capMsg(`↕ ${parsed.tracks[target].name} — bar ${landedBar + 1}, note ${Math.min(ord, ids.length - 1) + 1}${wasPlaying ? " (still playing)" : ""}${shorter}`);
  }

  // Ctrl+←/→: jump to the start of the next / previous bar.
  function skipBar(dir) {
    if (!parsed || !src.length()) return;
    const cur = Math.max(0, src.captureIndex());
    const bar = src.barIndices(cur);
    let target;
    if (dir > 0) target = bar[bar.length - 1] + 1;
    else { const start = bar[0]; target = start > 0 ? src.barIndices(start - 1)[0] : 0; }
    if (target >= src.length()) { capMsg("Already at the last bar."); return; }
    const wasPlaying = src.isPlaying();
    if (wasPlaying) src.stop();
    src.select(target, { play: !wasPlaying });
    if (wasPlaying) src.play();
    capMsg(`${dir > 0 ? "⇥" : "⇤"} bar ${Math.floor(src.beatOf(target) / src.beatsPerBar() + 1e-9) + 1}`);
  }

  // ---------------- capture ----------------
  function capMsg(text) { $("mb-cap-msg").textContent = text; }

  // Remember which source notes went across (per track) and paint them green.
  function markCopied(indices) {
    const tr = parsed.tracks[curTrack];
    tr.copied = tr.copied || new Set();
    for (const i of indices) tr.copied.add(i);
    src.addCopied(indices);
  }

  function captureNote() {
    const idx = src.captureIndex();
    const it = src.itemAt(idx);
    if (!it) { capMsg("Nothing to copy yet — click a note in the MIDI track (or play it and press S while a note sounds)."); return; }
    out.appendItems([it]);
    markCopied([idx]);
    flash(`✓ copied ${it.rest ? "rest" : it.name}`);
  }
  function captureBar() {
    const idxs = src.barIndices(src.captureIndex());
    if (!idxs.length) { capMsg("Nothing to copy yet — click a note in the MIDI track so I know which bar you mean."); return; }
    out.appendItems(idxs.map(i => src.itemAt(i)));
    markCopied(idxs);
    flash(`✓ copied bar (${idxs.length} notes)`);
  }
  function captureTrack() {
    const items = src.getItems();
    if (!items.length) { capMsg("This track is empty."); return; }
    out.appendItems(items);
    markCopied(items.map((_, i) => i));
    flash(`✓ copied whole track (${items.length} notes)`);
  }
  function flash(text) {
    capMsg(text);
    const el = $("mb-flash");
    el.textContent = text;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  // True only while the user is typing in a text field — range sliders,
  // buttons and checkboxes must not swallow the shortcuts.
  function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    if (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable) return true;
    return a.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "submit"].includes(a.type);
  }

  function onKeyDown(ev) {
    if (!active || ev.altKey) return;
    if (isTyping()) return;
    if (!parsed) return;
    if (ev.ctrlKey || ev.metaKey) { // Ctrl combos always act on the MIDI track
      if (ev.key === "ArrowUp") { switchTrackKeepPosition(-1); ev.preventDefault(); }
      else if (ev.key === "ArrowDown") { switchTrackKeepPosition(1); ev.preventDefault(); }
      else if (ev.key === "ArrowLeft") { skipBar(-1); ev.preventDefault(); }
      else if (ev.key === "ArrowRight") { skipBar(1); ev.preventDefault(); }
      return;
    }
    const outBusy = out.hasSelection(); // arrows belong to the custom track then
    switch (ev.key) {
      case " ": src.togglePlay(); ev.preventDefault(); break;
      case "ArrowUp": if (!outBusy) { showTrack(curTrack - 1); ev.preventDefault(); } break;
      case "ArrowDown": if (!outBusy) { showTrack(curTrack + 1); ev.preventDefault(); } break;
      case "ArrowLeft": if (!outBusy) { src.step(-1); ev.preventDefault(); } break;
      case "ArrowRight": if (!outBusy) { src.step(1); ev.preventDefault(); } break;
      case "s": case "S": if (!ev.repeat) captureNote(); ev.preventDefault(); break;
      case "d": case "D": if (!ev.repeat) captureBar(); ev.preventDefault(); break;
      case "f": case "F": if (!ev.repeat) captureTrack(); ev.preventDefault(); break;
      case "Backspace": if (!ev.repeat) out.undo(); ev.preventDefault(); break;
    }
  }

  function init() {
    const required = ["mb-tracks", "mb-src-staff", "mb-out-staff", "mb-change", "mb-flash"];
    const missing = required.filter(id => !$(id));
    if (missing.length) {
      const st = $("mb-status");
      if (st) st.textContent = "This page is out of date — press Ctrl+F5 (hard refresh) to load the latest version.";
      console.warn("MIDI Mixer: stale page, missing", missing);
      return;
    }
    // source view: read-only builder; clicking it hands the arrows back to it
    src = SaxBuilder.create("mb-src", { readOnly: true, onSelect: () => out.clearSelection(), onPosition: showPos });
    // clearing the custom track also forgets which source notes were copied
    out = SaxBuilder.create("mb-out", { onClear: () => {
      if (parsed) for (const tr of parsed.tracks) tr.copied = new Set();
      src.setCopied([]);
      capMsg("Custom track cleared — copied-note marks reset.");
    } });
    src.init(); out.init();

    renderPicker("");
    $("mb-search").addEventListener("input", e => renderPicker(e.target.value));
    $("mb-change").addEventListener("click", backToPicker);
    $("mb-cap-note").addEventListener("click", captureNote);
    $("mb-cap-bar").addEventListener("click", captureBar);
    $("mb-cap-track").addEventListener("click", captureTrack);
    document.addEventListener("keydown", onKeyDown);
    // Don't let a clicked button/slider keep focus: a focused button would
    // re-trigger on Space and a focused slider would eat the arrow keys.
    const tab = $("tab-midi");
    tab.addEventListener("click", ev => { const b = ev.target.closest("button"); if (b) b.blur(); });
    tab.addEventListener("change", ev => { if (ev.target.type === "range") ev.target.blur(); });
    tab.addEventListener("mouseup", ev => { if (ev.target.type === "range") ev.target.blur(); });
  }

  return {
    init,
    activate() { active = true; if (out) out.activate(); },
    deactivate() { active = false; if (src) src.stop(); if (out) out.deactivate(); }
  };
})();
