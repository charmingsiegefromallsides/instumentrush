// Tab 1: Note Rush — the note-reading game (naturals, alto sax written range).
window.SaxLearner = (() => {
  const T = SaxTheory, ST = SaxStaff, A = SaxAudio;
  const NOTE_COUNT = 16;
  const Y_E4 = 200, FIRST_X = 150;
  let staff, notes = [], groups = [], current = 0;
  let streak = 0, best = 0, correct = 0, attempts = 0;
  let roundOver = false, cheatOn = false, labelsOn = false;
  let svg, active = false;

  const $ = id => document.getElementById(id);
  const NOTE_DX = (1136 - FIRST_X - 20) / (NOTE_COUNT - 1);

  function newRound() {
    roundOver = false;
    current = 0;
    notes = [];
    let prev = null;
    const pool = SaxInstrument.get().naturals;
    for (let i = 0; i < NOTE_COUNT; i++) {
      let n;
      do { n = pool[Math.floor(Math.random() * pool.length)]; }
      while (prev && n.step === prev.step);
      notes.push(n);
      prev = n;
    }
    svg.innerHTML = "";
    staff.drawLines();
    groups = notes.map((n, i) => {
      const x = FIRST_X + i * NOTE_DX;
      const g = staff.drawNote(n, x, { dur: "w", letter: false }); // Note Rush has its own label above the head
      ST.el("path", {
        d: `M ${x - 8} 296 L ${x + 8} 296 L ${x} 282 Z`,
        fill: "var(--accent)", class: "caret", visibility: "hidden"
      }, g);
      ST.el("text", {
        x, y: 322, "text-anchor": "middle", "font-size": 21,
        "font-weight": 700, class: "label", visibility: "hidden",
        "font-family": "inherit"
      }, g);
      // Persistent learning label, sits just above the notehead (toggle-controlled).
      const top = ST.el("text", {
        x, y: staff.yOf(n.step) - 22, "text-anchor": "middle", "font-size": 18,
        "font-weight": 700, class: "toplabel", fill: "var(--muted)",
        visibility: labelsOn ? "visible" : "hidden", "font-family": "inherit"
      }, g);
      top.textContent = n.letter;
      return g;
    });
    setCaret(0);
    setMessage("", "");
    if (cheatOn) setCheat(true);
  }

  function setCaret(i) {
    groups.forEach((g, idx) => {
      g.querySelector(".caret").setAttribute("visibility", idx === i ? "visible" : "hidden");
      if (idx === i) ST.setColor(g, "var(--accent)");
      else if (idx > i) ST.setColor(g, "var(--ink)");
    });
  }

  function setMessage(text, cls) {
    const m = $("ln-message");
    m.textContent = text;
    m.className = "message " + cls;
  }

  function updateScoreboard(bump) {
    const sv = $("ln-streak");
    sv.textContent = streak;
    sv.classList.toggle("streak-hot", streak >= 5);
    if (bump) {
      sv.classList.remove("pop");
      void sv.offsetWidth;
      sv.classList.add("pop");
    }
    $("ln-best").textContent = best;
    $("ln-acc").textContent = attempts ? Math.round((correct / attempts) * 100) + "%" : "–";
  }

  function setCheat(on) {
    cheatOn = on;
    groups.forEach((g, idx) => {
      const label = g.querySelector(".label");
      if (label.dataset.answered) return;
      if (on) {
        label.textContent = notes[idx].letter;
        label.setAttribute("fill", "var(--muted)");
        label.setAttribute("visibility", "visible");
      } else {
        label.setAttribute("visibility", "hidden");
      }
    });
  }

  function setLabels(on) {
    labelsOn = on;
    groups.forEach(g => {
      const t = g.querySelector(".toplabel");
      if (t) t.setAttribute("visibility", on ? "visible" : "hidden");
    });
    const cb = $("ln-labels");
    if (cb) cb.checked = on;
  }

  function answer(letter) {
    if (roundOver || current >= notes.length) return;
    const note = notes[current];
    const g = groups[current];
    const label = g.querySelector(".label");
    const isRight = letter === note.letter;

    attempts++;
    if (isRight) {
      correct++;
      streak++;
      best = Math.max(best, streak);
      ST.setColor(g, "var(--good)");
      g.dataset.result = "good";
      label.setAttribute("fill", "var(--good)");
      A.playNote(note.midi, { dur: 0.35, vel: 0.5 });
      setMessage(streak >= 3 ? `✓ ${note.letter} — streak ${streak}!` : `✓ ${note.letter}`, "good");
    } else {
      streak = 0;
      ST.setColor(g, "var(--bad)");
      g.dataset.result = "bad";
      label.setAttribute("fill", "var(--bad)");
      A.playBuzz();
      setMessage(`✗ You pressed ${letter} — that was ${note.letter}`, "bad");
    }
    label.textContent = note.letter;
    label.dataset.answered = "1";
    label.setAttribute("visibility", "visible");
    updateScoreboard(isRight);

    current++;
    if (current >= notes.length) {
      roundOver = true;
      const roundCorrect = groups.filter(gr => gr.dataset.result === "good").length;
      setMessage(`Round done: ${roundCorrect}/${NOTE_COUNT} — next round coming up…`, roundCorrect >= 12 ? "good" : "");
      setTimeout(() => { if (active) newRound(); }, 1800);
    } else {
      setCaret(current);
    }
  }

  function onKeyDown(ev) {
    if (!active || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "Shift") { setCheat(true); return; }
    const k = ev.key.toUpperCase();
    if (k === "ENTER") { newRound(); return; }
    if (T.LETTERS.includes(k)) {
      answer(k);
      const btn = document.querySelector(`#ln-keys button[data-letter="${k}"]`);
      if (btn) {
        btn.classList.add("pressed");
        setTimeout(() => btn.classList.remove("pressed"), 120);
      }
    }
  }
  function onKeyUp(ev) { if (active && ev.key === "Shift") setCheat(false); }

  function init() {
    svg = $("ln-staff");
    staff = ST.create(svg, { yE4: Y_E4, left: 24, right: 1136 });
    const keysDiv = $("ln-keys");
    for (const l of ["A", "B", "C", "D", "E", "F", "G"]) {
      const b = document.createElement("button");
      b.textContent = l;
      b.dataset.letter = l;
      b.addEventListener("click", () => answer(l));
      keysDiv.appendChild(b);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => setCheat(false));
    SaxInstrument.onChange(() => newRound());
    const cb = $("ln-labels");
    if (cb) {
      labelsOn = ST.lettersOn();
      cb.checked = labelsOn;
      cb.addEventListener("change", () => ST.setLetters(cb.checked)); // shared by every tab
      ST.onLettersChange(on => setLabels(on));
    }
    newRound();
    updateScoreboard(false);
  }

  return {
    init,
    activate() { active = true; },
    deactivate() { active = false; setCheat(false); }
  };
})();
