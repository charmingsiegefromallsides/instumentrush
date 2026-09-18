// Tab: Guitar Scales — beginner scale shapes on an interactive fretboard.
// Dots are (string, fret) in standard tuning; clicking a dot plays it, the
// Play button runs the scale up and down with highlighting.
window.SaxScales = (() => {
  const A = SaxAudio;
  const NS = "http://www.w3.org/2000/svg";
  const OPEN_SOUND = [40, 45, 50, 55, 59, 64]; // sounding midi, low E → high e
  const STRINGS = ["E", "A", "D", "G", "B", "e"];
  const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  // s: 0 = low E … 5 = high e
  const SCALES = [
    {
      id: "eminpent", name: "E Minor Pentatonic (open)", formula: "1 · ♭3 · 4 · 5 · ♭7",
      root: "E",
      desc: "The easiest scale on the guitar — every string uses only the open string and one fretted note. Five notes, no half-steps to trip over, and it sounds instantly musical over rock and blues in E.",
      tip: "Practice tip: play it slowly with all downstrokes, then try pull-offs to the open strings.",
      dots: [[0,0],[0,3],[1,0],[1,2],[2,0],[2,2],[3,0],[3,2],[4,0],[4,3],[5,0],[5,3]],
      roots: [[0,0],[2,2],[5,0]]
    },
    {
      id: "aminpent", name: "A Minor Pentatonic (box 1)", formula: "1 · ♭3 · 4 · 5 · ♭7",
      root: "A",
      desc: "The most-used lead guitar shape in the world — the “box” at the 5th fret. Two notes per string, first finger on fret 5. Almost every classic rock solo lives inside this pattern.",
      tip: "Practice tip: learn it ascending and descending until your fingers know it blind, then try bending fret 7 on the G string.",
      dots: [[0,5],[0,8],[1,5],[1,7],[2,5],[2,7],[3,5],[3,7],[4,5],[4,8],[5,5],[5,8]],
      roots: [[0,5],[2,7],[5,5]]
    },
    {
      id: "cmajor", name: "C Major (open position)", formula: "1 · 2 · 3 · 4 · 5 · 6 · 7",
      root: "C",
      desc: "Do-re-mi itself. All seven natural notes played in the first three frets — the same notes the app's staff exercises use, so this shape connects what you read to where you fret it.",
      tip: "Practice tip: say each note name out loud as you play it — this doubles as fretboard-learning.",
      dots: [[0,0],[0,1],[0,3],[1,0],[1,2],[1,3],[2,0],[2,2],[2,3],[3,0],[3,2],[4,0],[4,1],[4,3],[5,0],[5,1],[5,3]],
      roots: [[1,3],[4,1]]
    },
    {
      id: "gmajor", name: "G Major (open position)", formula: "1 · 2 · 3 · 4 · 5 · 6 · 7",
      root: "G",
      desc: "C major's neighbor with one sharp (F♯). Home key of an enormous amount of folk, country, and campfire music, and it lies beautifully in open position.",
      tip: "Practice tip: watch for the F♯ — low E string fret 2 and high e string fret 2 — that's the one note that differs from C major.",
      dots: [[0,0],[0,2],[0,3],[1,0],[1,2],[1,3],[2,0],[2,2],[2,4],[3,0],[3,2],[4,0],[4,1],[4,3],[5,0],[5,2],[5,3]],
      roots: [[0,3],[3,0],[5,3]]
    },
    {
      id: "aminor", name: "A Natural Minor (open)", formula: "1 · 2 · ♭3 · 4 · 5 · ♭6 · ♭7",
      root: "A",
      desc: "The sad twin of C major — exact same notes, different home base. Start and end on A and everything turns melancholy. This is the sound of most minor-key melodies in the song library.",
      tip: "Practice tip: play C major, then this scale, and listen for how the same notes change mood when the root moves.",
      dots: [[0,0],[0,1],[0,3],[1,0],[1,2],[1,3],[2,0],[2,2],[2,3],[3,0],[3,2],[4,0],[4,1],[4,3],[5,0],[5,1],[5,3]],
      roots: [[1,0],[3,2]]
    },
    {
      id: "ablues", name: "A Blues (box 1)", formula: "1 · ♭3 · 4 · ♭5 · 5 · ♭7",
      root: "A",
      desc: "A minor pentatonic plus one spicy note — the ♭5 “blue note” (E♭). That single extra note is the difference between playing notes and playing the blues.",
      tip: "Practice tip: treat the blue note as a passing tone — slide through it, don't sit on it.",
      dots: [[0,5],[0,8],[1,5],[1,6],[1,7],[2,5],[2,7],[3,5],[3,7],[3,8],[4,5],[4,8],[5,5],[5,8]],
      roots: [[0,5],[2,7],[5,5]]
    },
    {
      id: "cmajpent", name: "C Major Pentatonic (open)", formula: "1 · 2 · 3 · 5 · 6",
      root: "C",
      desc: "Major scale with the two “tension” notes removed — nothing can clash, everything sounds sweet. The go-to for country and pop melodies, and great for improvising before you know any theory.",
      tip: "Practice tip: put on any song in C from the library and noodle along using only these notes.",
      dots: [[0,0],[0,3],[1,0],[1,3],[2,0],[2,2],[3,0],[3,2],[4,1],[4,3],[5,0],[5,3]],
      roots: [[1,3],[4,1]]
    }
  ];

  let active = false, current = 0, playing = false, playTimer = null;
  let dotEls = []; // aligned with SCALES[current].dots
  const $ = id => document.getElementById(id);

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  const midiOf = (s, f) => OPEN_SOUND[s] + f;

  function renderScale() {
    const sc = SCALES[current];
    $("sc-name").textContent = sc.name;
    $("sc-formula").textContent = sc.formula + "  ·  root: " + sc.root;
    $("sc-desc").textContent = sc.desc;
    $("sc-tip").textContent = sc.tip;
    document.querySelectorAll("#sc-list button").forEach((b, i) =>
      b.classList.toggle("sel", i === current));

    const svg = $("sc-board");
    svg.innerHTML = "";
    const maxFret = Math.max(5, ...sc.dots.map(d => d[1]));
    const FRETS = Math.max(5, maxFret) + 1;
    const X0 = 70, Y0 = 34, YS = 30, W = 900;
    const XS = (W - X0 - 20) / FRETS;
    svg.setAttribute("viewBox", `0 0 ${W} ${Y0 + 5 * YS + 56}`);

    // strings: top line = high e (standard diagram orientation)
    for (let s = 0; s < 6; s++) {
      const y = Y0 + (5 - s) * YS;
      el("line", { x1: X0, y1: y, x2: X0 + FRETS * XS, y2: y, stroke: "var(--keyline)", "stroke-width": 1 + (5 - s) * 0.35 }, svg);
      const t = el("text", { x: X0 - 46, y, "font-size": 13, "font-weight": 700, fill: "var(--muted)", "dominant-baseline": "central", "font-family": "inherit" }, svg);
      t.textContent = STRINGS[s];
    }
    // nut + frets
    el("rect", { x: X0 - 5, y: Y0 - 2, width: 5, height: 5 * YS + 4, fill: "var(--keyline)" }, svg);
    for (let f = 1; f <= FRETS; f++) {
      el("line", { x1: X0 + f * XS, y1: Y0, x2: X0 + f * XS, y2: Y0 + 5 * YS, stroke: "var(--keyline)", "stroke-width": 1.2, opacity: 0.6 }, svg);
    }
    // fret numbers + inlay markers
    for (let f = 1; f <= FRETS; f++) {
      if ([3, 5, 7, 9, 12].includes(f)) {
        el("circle", { cx: X0 + (f - 0.5) * XS, cy: Y0 + 5 * YS + 26, r: 4, fill: "var(--keyline)", opacity: 0.6 }, svg);
        if (f === 12) el("circle", { cx: X0 + (f - 0.5) * XS, cy: Y0 + 5 * YS + 38, r: 4, fill: "var(--keyline)", opacity: 0.6 }, svg);
      }
      const t = el("text", { x: X0 + (f - 0.5) * XS, y: Y0 + 5 * YS + 46, "font-size": 11, fill: "var(--muted)", "text-anchor": "middle", "font-family": "inherit" }, svg);
      t.textContent = f;
    }

    const isRoot = (s, f) => sc.roots.some(r => r[0] === s && r[1] === f);
    dotEls = sc.dots.map(([s, f]) => {
      const y = Y0 + (5 - s) * YS;
      const x = f === 0 ? X0 - 22 : X0 + (f - 0.5) * XS;
      const root = isRoot(s, f);
      const g = el("g", { style: "cursor:pointer" }, svg);
      const c = el("circle", {
        cx: x, cy: y, r: f === 0 ? 9 : 11,
        fill: root ? "var(--accent)" : "var(--paper)",
        stroke: root ? "var(--accent)" : "var(--ink)", "stroke-width": 2, class: "dot"
      }, g);
      const t = el("text", {
        x, y, "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 10, "font-weight": 700, "font-family": "inherit",
        fill: root ? "#fff" : "var(--ink)", "pointer-events": "none"
      }, g);
      t.textContent = NAMES[midiOf(s, f) % 12];
      g.addEventListener("click", () => {
        A.playNote(midiOf(s, f), { dur: 0.8, vel: 0.6, synth: SaxInstrument.defs.guitar.synth });
        flash(c, root);
      });
      return { c, root, midi: midiOf(s, f) };
    });
  }

  function flash(circle, root) {
    circle.setAttribute("fill", "var(--good)");
    circle.setAttribute("stroke", "var(--good)");
    setTimeout(() => {
      circle.setAttribute("fill", root ? "var(--accent)" : "var(--paper)");
      circle.setAttribute("stroke", root ? "var(--accent)" : "var(--ink)");
    }, 350);
  }

  function playScale() {
    if (playing) { stopScale(); return; }
    playing = true;
    $("sc-play").textContent = "⏹ Stop";
    // ascending then descending by pitch
    const asc = [...dotEls].sort((a, b) => a.midi - b.midi);
    const seq = [...asc, ...asc.slice(0, -1).reverse()];
    let i = 0;
    const step = () => {
      if (!playing || i >= seq.length) { stopScale(); return; }
      const d = seq[i++];
      A.playNote(d.midi, { dur: 0.42, vel: 0.6, synth: SaxInstrument.defs.guitar.synth });
      flash(d.c, d.root);
      playTimer = setTimeout(step, 380);
    };
    step();
  }

  function stopScale() {
    playing = false;
    if (playTimer) clearTimeout(playTimer);
    $("sc-play").textContent = "▶ Play scale";
  }

  function init() {
    const list = $("sc-list");
    SCALES.forEach((sc, i) => {
      const b = document.createElement("button");
      b.textContent = sc.name;
      b.addEventListener("click", () => { stopScale(); current = i; renderScale(); });
      list.appendChild(b);
    });
    $("sc-play").addEventListener("click", playScale);
    renderScale();
  }

  return { init, activate() { active = true; }, deactivate() { active = false; stopScale(); } };
})();
