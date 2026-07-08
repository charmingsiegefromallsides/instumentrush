// Tab 2: Fingering chart — hover/click a note on the staff to see its fingering.
window.SaxChart = (() => {
  const T = SaxTheory, ST = SaxStaff, A = SaxAudio, F = SaxFingering;
  const Y_E4 = 200, FIRST_X = 140, DX = 36;
  let svg, staff, active = false;
  let pool = [], hits = [], selected = -1, naturalsOnly = false;

  const $ = id => document.getElementById(id);

  function rebuild() {
    const inst = SaxInstrument.get();
    pool = naturalsOnly ? inst.naturals : inst.chromatic;
    const width = FIRST_X + pool.length * DX + 20;
    svg.setAttribute("viewBox", `0 0 ${width} 300`);
    svg.style.width = width + "px";
    svg.innerHTML = "";
    staff = ST.create(svg, { yE4: Y_E4, left: 16, right: width - 12 });
    staff.drawLines();
    hits = pool.map((n, i) => {
      const x = FIRST_X + i * DX;
      const g = staff.drawNote(n, x, { dur: "w" });
      // generous invisible hit area for hover/click
      const hit = ST.el("rect", {
        x: x - DX / 2, y: 0, width: DX, height: 300,
        fill: "transparent", style: "cursor:pointer"
      }, g);
      hit.addEventListener("mouseenter", () => select(i, false));
      hit.addEventListener("click", () => select(i, true));
      return g;
    });
    select(Math.min(Math.max(selected, 0), pool.length - 1), false);
  }

  function select(i, play) {
    if (i < 0 || i >= pool.length) return;
    if (selected >= 0 && hits[selected]) ST.setColor(hits[selected], "var(--ink)");
    selected = i;
    const note = pool[i];
    ST.setColor(hits[i], "var(--accent)");
    $("fc-name").textContent = note.name;
    $("fc-desc").textContent = F.describe(note.midi);
    const alt = F.alt(note.midi);
    $("fc-alt").textContent = alt;
    $("fc-alt").style.display = alt ? "" : "none";
    F.render($("fc-diagram"), note.midi);
    // keep the hovered note in view when navigating by keyboard
    if (play) {
      A.playNote(note.midi, { dur: 0.6, vel: 0.55 });
      hits[i].querySelector(".head").closest("g").scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }

  function onKeyDown(ev) {
    if (!active || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === "ArrowRight") { select(selected + 1, true); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { select(selected - 1, true); ev.preventDefault(); }
    else if (ev.key === " ") { select(selected, true); ev.preventDefault(); }
  }

  function init() {
    svg = $("fc-staff");
    $("fc-toggle").addEventListener("change", ev => {
      naturalsOnly = ev.target.checked;
      selected = 0;
      rebuild();
    });
    $("fc-play").addEventListener("click", () => select(selected, true));
    document.addEventListener("keydown", onKeyDown);
    SaxInstrument.onChange(() => { selected = 2; rebuild(); });
    selected = 2; // C4 area to start
    rebuild();
  }

  return { init, activate() { active = true; }, deactivate() { active = false; } };
})();
