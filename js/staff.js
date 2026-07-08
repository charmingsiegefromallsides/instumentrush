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

    // Draws a note glyph; returns its <g>. Color is changeable later via setColor.
    function drawNote(note, x, { dur = "q", color = "var(--ink)", parent = svg, ghost = false } = {}) {
      const g = el("g", { class: "note", "data-dur": dur }, parent);
      if (ghost) g.setAttribute("opacity", "0.45");
      const y = yOf(note.step);

      for (const e of ledgerSteps(note.step)) {
        el("line", {
          x1: x - 18, x2: x + 18, y1: yOf(e), y2: yOf(e),
          stroke: "var(--staffline)", "stroke-width": 1.6
        }, g);
      }

      if (note.acc) {
        const t = el("text", {
          x: x - 20, y: y + (note.acc === "b" ? -3 : 0),
          "text-anchor": "middle", "font-size": 26, fill: color,
          "dominant-baseline": "central", class: "acc",
          "font-family": "'Segoe UI Symbol',serif"
        }, g);
        t.textContent = note.acc === "#" ? "♯" : "♭";
      }

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
        const up = note.step < 4;
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
      return g;
    }

    // Rest glyphs from Segoe UI Symbol, drawn around the middle of the staff
    const REST_GLYPHS = { w: "\u{1D13B}", h: "\u{1D13C}", q: "\u{1D13D}", e: "\u{1D13E}" };
    function drawRest(x, { dur = "q", color = "var(--muted)", parent = svg } = {}) {
      const g = el("g", { class: "rest", "data-dur": dur }, parent);
      const t = el("text", {
        x, y: yOf(4), "text-anchor": "middle", "font-size": 42, fill: color,
        "dominant-baseline": "central", class: "head",
        "font-family": "'Segoe UI Symbol','Noto Music',serif"
      }, g);
      t.textContent = REST_GLYPHS[dur] || REST_GLYPHS.q;
      return g;
    }

    function drawBarline(x, { parent = svg } = {}) {
      return el("line", {
        x1: x, x2: x, y1: yOf(8), y2: yOf(0),
        stroke: "var(--staffline)", "stroke-width": 1.4, opacity: 0.7
      }, parent);
    }

    return { svg, el, yOf, drawLines, drawNote, drawRest, drawBarline, ledgerSteps, left, right, yE4 };
  }

  // Recolor a note group produced by drawNote
  function setColor(g, color) {
    const head = g.querySelector(".head");
    if (head) {
      if (parseFloat(head.getAttribute("stroke-width")) > 0) head.setAttribute("stroke", color);
      else head.setAttribute("fill", color);
    }
    for (const cls of ["stem", "flag", "acc"]) {
      const n = g.querySelector("." + cls);
      if (!n) continue;
      n.setAttribute(n.tagName === "line" ? "stroke" : "fill", color);
    }
  }

  return { create, el, setColor, HALF, NS };
})();
