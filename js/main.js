// Tab router + module init. Hash-based so a refresh keeps your tab.
(() => {
  const MODULES = {
    learn: SaxLearner,
    chart: SaxChart,
    scales: SaxScales,
    build: SaxBuilder,
    midi: SaxMidiBuilder,
    play: SaxPlayer
  };
  let currentTab = null;

  function switchTab(name) {
    if (!MODULES[name] || name === currentTab) return;
    if (currentTab) MODULES[currentTab].deactivate();
    currentTab = name;
    document.querySelectorAll("#tabs button").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab").forEach(s =>
      s.classList.toggle("active", s.id === "tab-" + name));
    MODULES[name].activate();
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  }

  document.querySelectorAll("#tabs button").forEach(b =>
    b.addEventListener("click", () => switchTab(b.dataset.tab)));
  window.addEventListener("hashchange", () => switchTab(location.hash.slice(1)));

  // ---- instrument switcher ----
  const INSTRUMENT_NAMES = { altosax: "alto saxophone", trumpet: "trumpet", guitar: "guitar" };
  const BRANDS = {
    altosax: ["Sax <span>Rush</span> 🎷", "Sax Rush"],
    trumpet: ["Trumpet <span>Rush</span> 🎺", "Trumpet Rush"],
    guitar: ["Guitar <span>Rush</span> 🎸", "Guitar Rush"]
  };
  function updateInstrumentUI() {
    const inst = SaxInstrument.get();
    document.querySelectorAll("#instruments button").forEach(b =>
      b.classList.toggle("sel", b.dataset.inst === inst.id));
    const [html, plain] = BRANDS[inst.id] || BRANDS.altosax;
    document.getElementById("app-title").innerHTML = html;
    document.getElementById("ln-inst").textContent = INSTRUMENT_NAMES[inst.id] || inst.label;
    document.title = plain + " — Learn to Play";
  }
  document.querySelectorAll("#instruments button").forEach(b =>
    b.addEventListener("click", () => SaxInstrument.set(b.dataset.inst)));
  SaxInstrument.onChange(updateInstrumentUI);

  for (const name in MODULES) MODULES[name].init();
  updateInstrumentUI();
  switchTab(MODULES[location.hash.slice(1)] ? location.hash.slice(1) : "learn");
})();
