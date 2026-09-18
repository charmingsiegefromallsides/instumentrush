// Instrument registry: fingering data + diagram renderers for alto sax and
// trumpet, plus the current-instrument switch. SaxFingering stays as a facade
// (render/describe/alt) that delegates to the selected instrument.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // ======================= ALTO SAX =======================
  const SAX_KEYS = [
    { id: "palmD",  label: "D",   x: 26,  y: 44,  shape: "oval" },
    { id: "palmEb", label: "E♭",  x: 48,  y: 32,  shape: "oval" },
    { id: "palmF",  label: "F",   x: 70,  y: 46,  shape: "oval" },
    { id: "oct",    label: "oct", x: 52,  y: 96,  shape: "thumb" },
    { id: "L1",     label: "1",   x: 118, y: 96,  shape: "main" },
    { id: "bis",    label: "bis", x: 118, y: 122, shape: "small" },
    { id: "L2",     label: "2",   x: 118, y: 148, shape: "main" },
    { id: "L3",     label: "3",   x: 118, y: 200, shape: "main" },
    { id: "LpGs",   label: "G♯",  x: 168, y: 224, shape: "pinky" },
    { id: "LpCs",   label: "C♯",  x: 158, y: 242, shape: "pinky" },
    { id: "LpB",    label: "B",   x: 168, y: 260, shape: "pinky" },
    { id: "LpBb",   label: "B♭",  x: 178, y: 278, shape: "pinky" },
    { id: "sideE",  label: "E",   x: 58,  y: 268, shape: "side" },
    { id: "sideC",  label: "C",   x: 58,  y: 298, shape: "side" },
    { id: "sideBb", label: "B♭",  x: 58,  y: 328, shape: "side" },
    { id: "R1",     label: "1",   x: 118, y: 300, shape: "main" },
    { id: "R2",     label: "2",   x: 118, y: 352, shape: "main" },
    { id: "R3",     label: "3",   x: 118, y: 404, shape: "main" },
    { id: "RpEb",   label: "E♭",  x: 168, y: 424, shape: "pinky" },
    { id: "RpC",    label: "C",   x: 168, y: 444, shape: "pinky" }
  ];

  const SAX_LOW = {
    58: ["L1", "L2", "L3", "R1", "R2", "R3", "LpBb"],
    59: ["L1", "L2", "L3", "R1", "R2", "R3", "LpB"],
    60: ["L1", "L2", "L3", "R1", "R2", "R3", "RpC"],
    61: ["L1", "L2", "L3", "R1", "R2", "R3", "LpCs"],
    62: ["L1", "L2", "L3", "R1", "R2", "R3"],
    63: ["L1", "L2", "L3", "R1", "R2", "R3", "RpEb"],
    64: ["L1", "L2", "L3", "R1", "R2"],
    65: ["L1", "L2", "L3", "R1"],
    66: ["L1", "L2", "L3", "R2"],
    67: ["L1", "L2", "L3"],
    68: ["L1", "L2", "L3", "LpGs"],
    69: ["L1", "L2"],
    70: ["L1", "bis"],
    71: ["L1"],
    72: ["L2"],
    73: []
  };
  const SAX_FINGERINGS = {};
  for (const m in SAX_LOW) SAX_FINGERINGS[m] = SAX_LOW[m];
  for (let m = 74; m <= 85; m++) SAX_FINGERINGS[m] = ["oct", ...SAX_LOW[m - 12]];
  SAX_FINGERINGS[86] = ["oct", "palmD"];
  SAX_FINGERINGS[87] = ["oct", "palmD", "palmEb"];
  SAX_FINGERINGS[88] = ["oct", "palmD", "palmEb", "sideE"];
  SAX_FINGERINGS[89] = ["oct", "palmD", "palmEb", "palmF", "sideE"];

  const SAX_ALTS = {
    70: "Alt: side B♭, or 1 + R1 (“one and one”)",
    82: "Alt: oct + side B♭, or oct + 1 + R1",
    72: "Alt: 1 + side C",
    84: "Alt: oct + 1 + side C",
    66: "Alt: L1-2-3 + R3",
    78: "Alt: oct + L1-2-3 + R3"
  };

  function saxDescribe(midi) {
    const keys = SAX_FINGERINGS[midi];
    if (!keys) return "";
    if (!keys.length) return "All keys open";
    const parts = [];
    if (keys.includes("oct")) parts.push("Octave key");
    const L = ["L1", "L2", "L3"].filter(k => keys.includes(k)).map(k => k[1]);
    if (L.length) parts.push("Left " + L.join("·"));
    if (keys.includes("bis")) parts.push("bis key");
    const R = ["R1", "R2", "R3"].filter(k => keys.includes(k)).map(k => k[1]);
    if (R.length) parts.push("Right " + R.join("·"));
    const extras = {
      LpGs: "G♯ key", LpCs: "low C♯", LpB: "low B", LpBb: "low B♭",
      RpEb: "low E♭", RpC: "low C", palmD: "palm D", palmEb: "palm E♭",
      palmF: "palm F", sideE: "side E", sideC: "side C", sideBb: "side B♭"
    };
    for (const k of keys) if (extras[k]) parts.push(extras[k]);
    return parts.join(" + ");
  }

  function saxRender(svg, midi) {
    svg.setAttribute("viewBox", "0 0 210 470");
    svg.innerHTML = "";
    const pressed = new Set(SAX_FINGERINGS[midi] || []);
    el("line", { x1: 118, y1: 80, x2: 118, y2: 420, stroke: "var(--staffline)", "stroke-width": 1, opacity: 0.35 }, svg);
    const lab = (x, y, txt) => {
      const t = el("text", { x, y, "font-size": 11, fill: "var(--muted)", "text-anchor": "middle", "font-family": "inherit" }, svg);
      t.textContent = txt;
    };
    lab(48, 14, "palm keys");
    lab(58, 250, "side keys");
    for (const k of SAX_KEYS) {
      const on = pressed.has(k.id);
      const fill = on ? "var(--accent)" : "var(--keyoff)";
      const stroke = on ? "var(--accent)" : "var(--keyline)";
      if (k.shape === "main") el("ellipse", { cx: k.x, cy: k.y, rx: 16, ry: 16, fill, stroke, "stroke-width": 2 }, svg);
      else if (k.shape === "small") el("circle", { cx: k.x, cy: k.y, r: 7, fill, stroke, "stroke-width": 2 }, svg);
      else if (k.shape === "thumb") el("circle", { cx: k.x, cy: k.y, r: 10, fill, stroke, "stroke-width": 2 }, svg);
      else if (k.shape === "oval") el("ellipse", { cx: k.x, cy: k.y, rx: 8, ry: 16, fill, stroke, "stroke-width": 2 }, svg);
      else if (k.shape === "side") el("rect", { x: k.x - 8, y: k.y - 13, width: 16, height: 26, rx: 6, fill, stroke, "stroke-width": 2 }, svg);
      else el("rect", { x: k.x - 21, y: k.y - 8, width: 42, height: 16, rx: 7, fill, stroke, "stroke-width": 2 }, svg);
      const isBig = k.shape === "main" || k.shape === "thumb" || k.shape === "pinky";
      const t = el("text", {
        x: k.x, y: k.y, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": isBig ? 12 : 9, "font-weight": 600, "font-family": "inherit",
        fill: on ? "#fff" : "var(--muted)", "pointer-events": "none"
      }, svg);
      t.textContent = k.label;
    }
  }

  // ======================= TRUMPET =======================
  // Standard Bb trumpet fingerings (written pitch), F#3 (54) .. C6 (84).
  // Valve combos by semitones below each open partial: 0=open, 2=v1, 1=v2,
  // 3=v1+2, 4=v2+3, 5=v1+3, 6=v1+2+3.
  const TR_FINGERINGS = {
    54: ["v1", "v2", "v3"], 55: ["v1", "v3"], 56: ["v2", "v3"], 57: ["v1", "v2"],
    58: ["v1"], 59: ["v2"], 60: [],
    61: ["v1", "v2", "v3"], 62: ["v1", "v3"], 63: ["v2", "v3"], 64: ["v1", "v2"],
    65: ["v1"], 66: ["v2"], 67: [],
    68: ["v2", "v3"], 69: ["v1", "v2"], 70: ["v1"], 71: ["v2"], 72: [],
    73: ["v1", "v2"], 74: ["v1"], 75: ["v2"], 76: [],
    77: ["v1"], 78: ["v2"], 79: [],
    80: ["v2", "v3"], 81: ["v1", "v2"], 82: ["v1"], 83: ["v2"], 84: []
  };

  const TR_ALTS = {
    68: "Same valves as low A♭ — higher partial, faster air",
    76: "Alt: valves 1+2 (tune with slides)",
    79: "Open, like C5 — the lips pick the partial",
    84: "Open — high C lives in the air speed, not the valves"
  };

  function trDescribe(midi) {
    const keys = TR_FINGERINGS[midi];
    if (!keys) return "";
    if (!keys.length) return "Open — no valves pressed";
    return (keys.length === 1 ? "Valve " : "Valves ") + keys.map(k => k[1]).join(" + ");
  }

  function trRender(svg, midi) {
    svg.setAttribute("viewBox", "0 0 210 300");
    svg.innerHTML = "";
    const pressed = new Set(TR_FINGERINGS[midi] || []);
    // lead pipe + bell hint
    el("line", { x1: 20, y1: 60, x2: 190, y2: 60, stroke: "var(--keyline)", "stroke-width": 3, "stroke-linecap": "round" }, svg);
    el("path", { d: "M 160 60 L 196 40 L 196 80 Z", fill: "var(--keyoff)", stroke: "var(--keyline)", "stroke-width": 2 }, svg);
    el("circle", { cx: 20, cy: 60, r: 6, fill: "var(--keyoff)", stroke: "var(--keyline)", "stroke-width": 2 }, svg);
    const lab = el("text", { x: 105, y: 24, "font-size": 11, fill: "var(--muted)", "text-anchor": "middle", "font-family": "inherit" }, svg);
    lab.textContent = "1  ·  2  ·  3   (index · middle · ring)";
    // three valves
    [["v1", 65], ["v2", 105], ["v3", 145]].forEach(([id, x], i) => {
      const on = pressed.has(id);
      // valve casing
      el("rect", { x: x - 12, y: 70, width: 24, height: 110, rx: 8, fill: "none", stroke: "var(--keyline)", "stroke-width": 2 }, svg);
      // valve cap: pressed caps sit lower
      const capY = on ? 120 : 96;
      el("line", { x1: x, y1: capY - 14, x2: x, y2: 74, stroke: on ? "var(--accent)" : "var(--keyline)", "stroke-width": 3 }, svg);
      el("circle", {
        cx: x, cy: capY, r: 17,
        fill: on ? "var(--accent)" : "var(--keyoff)",
        stroke: on ? "var(--accent)" : "var(--keyline)", "stroke-width": 2
      }, svg);
      const t = el("text", {
        x, y: capY, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 14, "font-weight": 700, "font-family": "inherit",
        fill: on ? "#fff" : "var(--muted)"
      }, svg);
      t.textContent = String(i + 1);
    });
    const hint = el("text", { x: 105, y: 235, "font-size": 12, fill: "var(--muted)", "text-anchor": "middle", "font-family": "inherit" }, svg);
    hint.textContent = pressed.size ? "" : "no valves — shape the note with your lips";
  }

  // ======================= GUITAR =======================
  // Standard tuning, written pitch (guitar sounds an octave lower than
  // written). Written open strings low→high: E3 A3 D4 G4 B4 E5.
  const GTR_OPEN = [52, 57, 62, 67, 71, 76];
  const GTR_STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
  const GTR_MAX_FRET = 15;

  function gtrPositions(midi) {
    const out = [];
    for (let s = 0; s < 6; s++) {
      const f = midi - GTR_OPEN[s];
      if (f >= 0 && f <= GTR_MAX_FRET) out.push({ s, f });
    }
    // best position: lowest fret wins, open strings best of all
    out.sort((a, b) => a.f - b.f || b.s - a.s);
    return out;
  }

  function gtrDescribe(midi) {
    const pos = gtrPositions(midi);
    if (!pos.length) return "";
    const word = p => p.f === 0
      ? `${GTR_STRING_NAMES[p.s]} string open`
      : `${GTR_STRING_NAMES[p.s]} string, fret ${p.f}`;
    return word(pos[0]);
  }

  function gtrAlt(midi) {
    const pos = gtrPositions(midi).slice(1, 3);
    if (!pos.length) return "";
    return "Also: " + pos.map(p => `${GTR_STRING_NAMES[p.s]} str fret ${p.f}`).join(" · ");
  }

  function gtrRender(svg, midi) {
    svg.setAttribute("viewBox", "0 0 210 300");
    svg.innerHTML = "";
    const pos = gtrPositions(midi);
    if (!pos.length) return;
    // fret window: prefer 0-5, else slide to cover the best position
    const bestF = pos[0].f;
    const startF = bestF <= 5 ? 0 : bestF - 2;
    const FRETS = 5;
    const X0 = 45, XS = 26, Y0 = 60, YS = 42;
    // strings (vertical, low E left)
    for (let s = 0; s < 6; s++) {
      el("line", { x1: X0 + s * XS, y1: Y0, x2: X0 + s * XS, y2: Y0 + FRETS * YS, stroke: "var(--keyline)", "stroke-width": s < 3 ? 2.2 : 1.4 }, svg);
      const t = el("text", { x: X0 + s * XS, y: Y0 - 28, "text-anchor": "middle", "font-size": 12, "font-weight": 600, fill: "var(--muted)", "font-family": "inherit" }, svg);
      t.textContent = GTR_STRING_NAMES[s];
    }
    // nut or start-fret marker
    el("rect", { x: X0 - 3, y: Y0 - (startF === 0 ? 6 : 2), width: 5 * XS + 6, height: startF === 0 ? 6 : 2, fill: "var(--keyline)" }, svg);
    for (let f = 1; f <= FRETS; f++) {
      el("line", { x1: X0 - 3, y1: Y0 + f * YS, x2: X0 + 5 * XS + 3, y2: Y0 + f * YS, stroke: "var(--keyline)", "stroke-width": 1.2, opacity: 0.7 }, svg);
      const t = el("text", { x: X0 - 22, y: Y0 + (f - 0.5) * YS, "font-size": 11, fill: "var(--muted)", "dominant-baseline": "central", "font-family": "inherit" }, svg);
      t.textContent = startF + f;
    }
    // dots for every playable position of this note in the window
    pos.forEach((p, i) => {
      const isBest = i === 0;
      const x = X0 + p.s * XS;
      if (p.f === 0 && startF === 0) {
        el("circle", { cx: x, cy: Y0 - 14, r: 7, fill: isBest ? "var(--accent)" : "none", stroke: isBest ? "var(--accent)" : "var(--keyline)", "stroke-width": 2 }, svg);
      } else if (p.f > startF && p.f <= startF + FRETS) {
        el("circle", { cx: x, cy: Y0 + (p.f - startF - 0.5) * YS, r: 11, fill: isBest ? "var(--accent)" : "var(--keyoff)", stroke: isBest ? "var(--accent)" : "var(--keyline)", "stroke-width": 2 }, svg);
        if (!isBest) {
          const t = el("text", { x, y: Y0 + (p.f - startF - 0.5) * YS, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "var(--muted)", "font-family": "inherit" }, svg);
          t.textContent = p.f;
        }
      }
    });
  }

  // ======================= REGISTRY =======================
  function buildRange(low, high) {
    const chromatic = [];
    for (let m = low; m <= high; m++) chromatic.push(SaxTheory.noteFromMidi(m));
    return { chromatic, naturals: chromatic.filter(n => !n.acc) };
  }

  const DEFS = {
    altosax: {
      id: "altosax", label: "Alto Sax", emoji: "🎷", low: 58, high: 89,
      fingerings: SAX_FINGERINGS, render: saxRender, describe: saxDescribe,
      alt: m => SAX_ALTS[m] || "",
      synth: { mult: 3.2, max: 5200, wave2: "triangle" },
      ...buildRange(58, 89)
    },
    trumpet: {
      id: "trumpet", label: "Trumpet", emoji: "🎺", low: 54, high: 84,
      fingerings: TR_FINGERINGS, render: trRender, describe: trDescribe,
      alt: m => TR_ALTS[m] || "",
      synth: { mult: 5.0, max: 7500, wave2: "square" },
      ...buildRange(54, 84)
    },
    guitar: {
      id: "guitar", label: "Guitar", emoji: "🎸", low: 52, high: 91,
      render: gtrRender, describe: gtrDescribe, alt: gtrAlt,
      positions: gtrPositions, stringNames: GTR_STRING_NAMES, openStrings: GTR_OPEN,
      synth: { mult: 2.6, max: 4200, wave2: "triangle", pluck: true },
      ...buildRange(52, 91)
    }
  };

  const STORE = "saxtrainer.instrument";
  let currentId = localStorage.getItem(STORE);
  if (!DEFS[currentId]) currentId = "altosax";
  const listeners = [];

  window.SaxInstrument = {
    get: () => DEFS[currentId],
    currentId: () => currentId,
    ids: Object.keys(DEFS),
    defs: DEFS,
    set(id) {
      if (!DEFS[id] || id === currentId) return;
      currentId = id;
      localStorage.setItem(STORE, id);
      listeners.forEach(f => { try { f(DEFS[id]); } catch (e) {} });
    },
    onChange(f) { listeners.push(f); }
  };

  // Facade used by chart + player — always the current instrument
  window.SaxFingering = {
    render: (svg, midi) => DEFS[currentId].render(svg, midi),
    describe: midi => DEFS[currentId].describe(midi),
    alt: midi => DEFS[currentId].alt(midi)
  };
})();
