// Shared music theory: note spelling, staff positions, frequencies.
// Written pitch for Eb alto sax — range Bb3 (midi 58) to F6 (midi 89).
window.SaxTheory = (() => {
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  // Preferred band spellings per pitch class
  const PC_SPELL = {
    0: ["C", null], 1: ["C", "#"], 2: ["D", null], 3: ["E", "b"],
    4: ["E", null], 5: ["F", null], 6: ["F", "#"], 7: ["G", null],
    8: ["A", "b"], 9: ["A", null], 10: ["B", "b"], 11: ["B", null]
  };
  const ACC_GLYPH = { "#": "♯", "b": "♭" };

  function build(letter, acc, octave) {
    let midi = (octave + 1) * 12 + LETTER_SEMI[letter];
    if (acc === "#") midi++; else if (acc === "b") midi--;
    const diatonic = octave * 7 + LETTERS.indexOf(letter);
    return {
      midi, letter, acc, octave,
      step: diatonic - 30, // 0 = E4, the bottom staff line; each step = line/space
      short: letter + (acc ? ACC_GLYPH[acc] : ""),
      name: letter + (acc ? ACC_GLYPH[acc] : "") + octave
    };
  }

  function noteFromMidi(midi) {
    const [letter, acc] = PC_SPELL[((midi % 12) + 12) % 12];
    return build(letter, acc, Math.floor(midi / 12) - 1);
  }

  function noteByName(name) { // "C5", "F#5", "Bb4"
    const m = /^([A-G])([#b]?)(\d)$/.exec(name);
    if (!m) throw new Error("bad note name: " + name);
    return build(m[1], m[2] || null, +m[3]);
  }

  const RANGE_LOW = 58, RANGE_HIGH = 89;
  const CHROMATIC = [];
  for (let m = RANGE_LOW; m <= RANGE_HIGH; m++) CHROMATIC.push(noteFromMidi(m));
  const NATURALS = CHROMATIC.filter(n => !n.acc);

  const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);

  // Key signatures: k = number of sharps (positive) or flats (negative).
  const KEYS = [
    [-7, "C♭ major · 7♭"], [-6, "G♭ major · 6♭"], [-5, "D♭ major · 5♭"], [-4, "A♭ major · 4♭"],
    [-3, "E♭ major · 3♭"], [-2, "B♭ major · 2♭"], [-1, "F major · 1♭"], [0, "C major · no sharps or flats"],
    [1, "G major · 1♯"], [2, "D major · 2♯"], [3, "A major · 3♯"], [4, "E major · 4♯"],
    [5, "B major · 5♯"], [6, "F♯ major · 6♯"], [7, "C♯ major · 7♯"]
  ];
  const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
  // letter -> "#" | "b" for the letters the key signature alters
  function keySig(k) {
    const m = {};
    if (k > 0) SHARP_ORDER.slice(0, k).forEach(l => { m[l] = "#"; });
    else if (k < 0) FLAT_ORDER.slice(0, -k).forEach(l => { m[l] = "b"; });
    return m;
  }

  return { LETTERS, ACC_GLYPH, noteFromMidi, noteByName, CHROMATIC, NATURALS, freq, RANGE_LOW, RANGE_HIGH, KEYS, keySig };
})();
