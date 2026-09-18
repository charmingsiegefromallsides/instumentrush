// 5-star ratings, stored in the browser (localStorage) under a key per item:
// library songs by id, saved tracks "user:<name>", MIDI files "midi:<path>".
window.SaxRatings = (() => {
  const KEY = "saxtrainer.ratings";
  function all() {
    try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
  }
  function get(k) { const v = Number(all()[k]); return v >= 1 && v <= 5 ? Math.round(v) : 0; }
  function set(k, n) {
    const o = all();
    if (n >= 1) o[k] = Math.min(5, Math.round(n)); else delete o[k];
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage unavailable */ }
  }
  const stars = n => "★".repeat(n) + "☆".repeat(5 - n);

  // Clickable 5-star widget; clicking the current rating again clears it.
  function widget(container, key, onChange) {
    container.innerHTML = "";
    container.classList.add("stars");
    const cur = get(key);
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "star" + (i <= cur ? " on" : "");
      b.textContent = i <= cur ? "★" : "☆";
      b.title = i === cur ? "Click again to clear the rating" : `Rate ${i} star${i > 1 ? "s" : ""}`;
      b.addEventListener("click", () => {
        set(key, i === get(key) ? 0 : i);
        b.blur(); // keep Space/arrow shortcuts working afterwards
        widget(container, key, onChange);
        if (onChange) onChange(get(key));
      });
      container.appendChild(b);
    }
  }

  // sort comparator: rating (high first), then title A→Z
  const cmp = (keyOf, titleOf) => (a, b) =>
    (get(keyOf(b)) - get(keyOf(a))) || String(titleOf(a)).localeCompare(String(titleOf(b)), undefined, { sensitivity: "base" });

  return { get, set, stars, widget, cmp };
})();
