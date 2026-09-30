// SVG staff renderer shared by all tabs.
// A "staff context" binds an svg element to geometry (yE4 = y of bottom line).
// Durations: "w" whole, "h" half, "q" quarter, "e" eighth.
window.SaxStaff = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const HALF = 8; // px per diatonic step (staff line spacing = 16)

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function create(svg, { yE4 = 200, left = 24, right = 1156, clef = true } = {}) {
    const yOf = step => yE4 - step * HALF;

    function drawLines() {
      for (let i = 0; i < 5; i++) {
        el("line", {
          x1: left, x2: right, y1: yOf(i * 2), y2: yOf(i * 2),
          stroke: "var(--staffline)", "stroke-width": 1.6
        }, svg);
      }
      if (clef) {
        const t = el("text", {
          x: left + 14, y: yOf(4), "font-size": 90, fill: "var(--ink)",
          "dominant-baseline": "central",
          "font-family": "'Segoe UI Symbol','Noto Music',serif"
        }, svg);
        t.textContent = "\u{1D11E}";
      }
    }

    function ledgerSteps(step) {
      const out = [];
      if (step < 0) for (let e = -2; e >= Math.floor(step / 2) * 2; e -= 2) out.push(e);
      if (step > 8) for (let e = 10; e <= Math.ceil(step / 2) * 2; e += 2) out.push(e);
      return out;
    }

    // Key signature after the clef: k sharps (k > 0) or flats (k < 0) at the
    // standard treble positions. Returns the width used.
    const SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4]; // F5 C5 G5 D5 A4 E5 B4
    const FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];  // B4 E5 A4 D5 G4 C5 F4
    function drawKeySig(k, x0 = left + 58) {
      const n = Math.min(7, Math.abs(k));
      const steps = k > 0 ? SHARP_STEPS : FLAT_STEPS;
      for (let i = 0; i < n; i++) {
        const t = el("text", {
          x: x0 + i * 10, y: yOf(steps[i]) + (k < 0 ? -3 : 0),
          "text-anchor": "middle", "font-size": 26, fill: "var(--ink)",
          "dominant-baseline": "central", class: "keysig",
          "font-family": "'Segoe UI Symbol',serif"
        }, svg);
        t.textContent = k > 0 ? "♯" : "♭";
      }
      return n * 10;
    }

    const ACC_GLYPH = { "#": "♯", b: "♭", n: "♮" };
    // Augmentation dot to the right of a head; sits in the space above a line
    function drawDot(x, y, step, color, g) {
      el("circle", { cx: x + 17, cy: step % 2 === 0 ? y - 5 : y, r: 2.6, fill: color, class: "dot" }, g);
    }

    // Draws a note glyph; returns its <g>. Color is changeable later via setColor.
    // `key` (letter -> "#"/"b") hides accidentals the key signature already
    // implies and shows a natural where the note cancels one.
    // showAcc (optional) overrides which accidental is printed: "#", "b", "n" or null.
    // stemUp (optional) forces the stem direction (used for beamed pairs).
    // letter:false skips the (hidden until toggled) note letter inside the head.
    function drawNote(note, x, { dur = "q", dot = false, key = null, showAcc, stemUp, letter = true, color = "var(--ink)", parent = svg, ghost = false } = {}) {
      const g = el("g", { class: "note", "data-dur": dur }, parent);
      if (ghost) g.setAttribute("opacity", "0.45");
      const y = yOf(note.step);

      for (const e of ledgerSteps(note.step)) {
        el("line", {
          x1: x - 18, x2: x + 18, y1: yOf(e), y2: yOf(e),
          stroke: "var(--staffline)", "stroke-width": 1.6
        }, g);
      }

      const keyAcc = key ? (key[note.letter] || null) : null;
      const shown = showAcc !== undefined ? showAcc : ((note.acc || null) === keyAcc ? null : (note.acc || "n"));
      if (shown) {
        const t = el("text", {
          x: x - 20, y: y + (shown === "b" ? -3 : 0),
          "text-anchor": "middle", "font-size": 26, fill: color,
          "dominant-baseline": "central", class: "acc",
          "font-family": "'Segoe UI Symbol',serif"
        }, g);
        t.textContent = ACC_GLYPH[shown];
      }
      if (dot) drawDot(x, y, note.step, color, g);

      if (dur === "w") {
        el("ellipse", { cx: x, cy: y, rx: 12, ry: 8.2, fill: color, class: "head" }, g);
        el("ellipse", {
          cx: x, cy: y, rx: 6.4, ry: 4.6, fill: "var(--paper)",
          transform: `rotate(-24 ${x} ${y})`
        }, g);
      } else {
        const hollow = dur === "h";
        el("ellipse", {
          cx: x, cy: y, rx: 9.5, ry: 7,
          fill: hollow ? "var(--paper)" : color,
          stroke: color, "stroke-width": hollow ? 2.6 : 0,
          class: "head", transform: `rotate(-20 ${x} ${y})`
        }, g);
        const up = stemUp !== undefined ? stemUp : note.step < 4;
        const sx = up ? x + 8.6 : x - 8.6;
        const sy2 = up ? y - 52 : y + 52;
        el("line", {
          x1: sx, y1: y + (up ? -2 : 2), x2: sx, y2: sy2,
          stroke: color, "stroke-width": 2.4, class: "stem"
        }, g);
        if (dur === "e") {
          const d = up
            ? `M ${sx} ${sy2} c 13 5, 17 16, 8 32 c 7 -13, 2 -22, -8 -24 z`
            : `M ${sx} ${sy2} c 13 -5, 17 -16, 8 -32 c 7 13, 2 22, -8 24 z`;
          el("path", { d, fill: color, class: "flag" }, g);
        }
      }
      if (letter) {
        // Learning aid: the note name inside the head. Always drawn, shown only
        // while the shared "letters" setting is on (see html.show-letters in CSS).
        // Filled heads (quarter, eighth) get light text; hollow ones (whole, half) dark.
        const hollow = dur === "w" || dur === "h";
        const t = el("text", {
          x, y: y + 0.5, "text-anchor": "middle", "dominant-baseline": "central",
          "font-size": dur === "w" ? 13 : 11.5, "font-weight": 800, class: "inlabel",
          fill: hollow ? "var(--ink)" : "var(--paper)", "font-family": "'Segoe UI',system-ui,sans-serif"
        }, g);
        t.textContent = note.letter;
      }
      return g;
    }

    // Rest glyphs from Segoe UI Symbol, drawn around the middle of the staff
    const REST_GLYPHS = { w: "\u{1D13B}", h: "\u{1D13C}", q: "\u{1D13D}", e: "\u{1D13E}" };
    function drawRest(x, { dur = "q", dot = false, color = "var(--muted)", parent = svg } = {}) {
      const g = el("g", { class: "rest", "data-dur": dur }, parent);
      const t = el("text", {
        x, y: yOf(4), "text-anchor": "middle", "font-size": 42, fill: color,
        "dominant-baseline": "central", class: "head",
        "font-family": "'Segoe UI Symbol','Noto Music',serif"
      }, g);
      t.textContent = REST_GLYPHS[dur] || REST_GLYPHS.q;
      if (dot) drawDot(x, yOf(5), 5, color, g);
      return g;
    }

    // Tie/slur arc between two note heads at x1 and x2 (steps give the side:
    // below the heads when stems go up, above when they go down).
    function drawTie(x1, x2, step, { parent = svg, color = "var(--ink)", up = step < 4 } = {}) {
      const y = yOf(step);
      const yy = up ? y + 11 : y - 11, c = up ? y + 26 : y - 26;
      return el("path", {
        d: `M ${x1 + 7} ${yy} Q ${(x1 + x2) / 2} ${c} ${x2 - 7} ${yy}`,
        fill: "none", stroke: color, "stroke-width": 2.2, class: "tie"
      }, parent);
    }

    // Replace the flags of two eighth-note groups with one beam (same stem direction only).
    // Both notes must have been drawn with the same stemUp.
    function beam(g1, g2, x1, x2, step1, step2, up) {
      g1.querySelector(".flag")?.remove();
      g2.querySelector(".flag")?.remove();
      const sx1 = up ? x1 + 8.6 : x1 - 8.6, sx2 = up ? x2 + 8.6 : x2 - 8.6;
      const ey1 = yOf(step1) + (up ? -52 : 52), ey2 = yOf(step2) + (up ? -52 : 52);
      el("line", { x1: sx1, y1: ey1, x2: sx2, y2: ey2, stroke: "var(--ink)", "stroke-width": 5, class: "beam" }, g1);
      return true;
    }

    function drawBarline(x, { parent = svg } = {}) {
      return el("line", {
        x1: x, x2: x, y1: yOf(8), y2: yOf(0),
        stroke: "var(--staffline)", "stroke-width": 1.4, opacity: 0.7
      }, parent);
    }

    return { svg, el, yOf, drawLines, drawKeySig, drawNote, drawRest, drawBarline, drawTie, beam, ledgerSteps, left, right, yE4 };
  }

  // ---- shared "show note letters" setting (same key Note Rush always used) ----
  const LETTERS_KEY = "saxtrainer.noteLabels";
  const letterListeners = [];
  let lettersOn = false;
  try { lettersOn = localStorage.getItem(LETTERS_KEY) === "1"; } catch (e) { /* default off */ }
  document.documentElement.classList.toggle("show-letters", lettersOn);
  function setLetters(on) {
    lettersOn = !!on;
    document.documentElement.classList.toggle("show-letters", lettersOn);
    try { localStorage.setItem(LETTERS_KEY, lettersOn ? "1" : "0"); } catch (e) { /* not persisted */ }
    letterListeners.forEach(f => { try { f(lettersOn); } catch (e) { /* ignore */ } });
  }

  // Recolor a note group produced by drawNote
  function setColor(g, color) {
    const head = g.querySelector(".head");
    if (head) {
      if (parseFloat(head.getAttribute("stroke-width")) > 0) head.setAttribute("stroke", color);
      else head.setAttribute("fill", color);
    }
    for (const cls of ["stem", "flag", "acc", "dot"]) {
      const n = g.querySelector("." + cls);
      if (!n) continue;
      n.setAttribute(n.tagName === "line" ? "stroke" : "fill", color);
    }
  }

  return {
    create, el, setColor, HALF, NS,
    lettersOn: () => lettersOn, setLetters, onLettersChange: f => letterListeners.push(f)
  };
})();
