// Tab router + module init. Hash-based so a refresh keeps your tab.
(() => {
  const MODULES = {
    learn: SaxLearner,
    chart: SaxChart,
    build: SaxBuilder,
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
  const INSTRUMENT_NAMES = { altosax: "alto saxophone", trumpet: "trumpet" };
  function updateInstrumentUI() {
    const inst = SaxInstrument.get();
    document.querySelectorAll("#instruments button").forEach(b =>
      b.classList.toggle("sel", b.dataset.inst === inst.id));
    document.getElementById("app-title").innerHTML =
      inst.id === "trumpet" ? "Trumpet <span>Rush</span> 🎺" : "Sax <span>Rush</span> 🎷";
    document.getElementById("ln-inst").textContent = INSTRUMENT_NAMES[inst.id] || inst.label;
    document.title = (inst.id === "trumpet" ? "Trumpet Rush" : "Sax Rush") + " — Learn to Play";
  }
  document.querySelectorAll("#instruments button").forEach(b =>
    b.addEventListener("click", () => SaxInstrument.set(b.dataset.inst)));
  SaxInstrument.onChange(updateInstrumentUI);

  for (const name in MODULES) MODULES[name].init();
  updateInstrumentUI();
  switchTab(MODULES[location.hash.slice(1)] ? location.hash.slice(1) : "learn");
})();
