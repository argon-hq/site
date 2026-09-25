// Tema (sistema → claro → escuro) e troca da marca em teste em todas as aplicações.
(function () {
  var root = document.documentElement;
  var THEMES = ["system", "light", "dark"];
  var LABELS = { system: "Tema: sistema", light: "Tema: claro", dark: "Tema: escuro" };

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* armazenamento indisponível */ }
  }

  function applyTheme(theme) {
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    var label = document.querySelector(".js-theme-label");
    if (label) label.textContent = LABELS[theme];
  }

  function applyMark(id) {
    document.querySelectorAll(".js-mark use").forEach(function (use) {
      use.setAttribute("href", "#" + id);
    });
    // Abaixo de 24 px, usa a versão de tela pequena quando ela existe (m4s, m9s).
    var small = document.getElementById(id + "s") ? id + "s" : id;
    document.querySelectorAll(".js-mark-small use").forEach(function (use) {
      use.setAttribute("href", "#" + small);
    });
    document.querySelectorAll(".js-try").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mark === id));
    });
    // Paleta: ocre (padrão da prévia), lilás ou monocromática.
  var PALETTES = ["ocre", "lilas", "mono"];
  function applyPalette(p) {
    if (p === "mono") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", p);
    var sel = document.querySelector(".js-palette");
    if (sel && sel.value !== p) sel.value = p;
  }
  var palette = read("argon-brand-palette");
  if (PALETTES.indexOf(palette) === -1) palette = "ocre";
  applyPalette(palette);
  var palettePicker = document.querySelector(".js-palette");
  if (palettePicker) {
    palettePicker.addEventListener("change", function () {
      applyPalette(palettePicker.value);
      write("argon-brand-palette", palettePicker.value);
    });
  }

  // Acento: no ponto (padrão) ou no traço.
  function applyAccent(a) {
    if (a === "blade") root.setAttribute("data-accent", "blade");
    else root.removeAttribute("data-accent");
    var sel = document.querySelector(".js-accent");
    if (sel && sel.value !== a) sel.value = a;
  }
  var accent = read("argon-brand-accent");
  if (accent !== "blade") accent = "dot";
  applyAccent(accent);
  var accentPicker = document.querySelector(".js-accent");
  if (accentPicker) {
    accentPicker.addEventListener("change", function () {
      applyAccent(accentPicker.value);
      write("argon-brand-accent", accentPicker.value);
    });
  }

  var picker = document.querySelector(".js-picker");
    if (picker && picker.value !== id) picker.value = id;
  }

  var theme = read("argon-brand-theme");
  if (THEMES.indexOf(theme) === -1) theme = "system";
  applyTheme(theme);

  var themeBtn = document.querySelector(".js-theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      applyTheme(theme);
      write("argon-brand-theme", theme);
    });
  }

  // Paleta: ocre (padrão da prévia), lilás ou monocromática.
  var PALETTES = ["ocre", "lilas", "mono"];
  function applyPalette(p) {
    if (p === "mono") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", p);
    var sel = document.querySelector(".js-palette");
    if (sel && sel.value !== p) sel.value = p;
  }
  var palette = read("argon-brand-palette");
  if (PALETTES.indexOf(palette) === -1) palette = "ocre";
  applyPalette(palette);
  var palettePicker = document.querySelector(".js-palette");
  if (palettePicker) {
    palettePicker.addEventListener("change", function () {
      applyPalette(palettePicker.value);
      write("argon-brand-palette", palettePicker.value);
    });
  }

  var picker = document.querySelector(".js-picker");
  var mark = read("argon-brand-mark-4");
  if (!mark || !document.getElementById(mark)) mark = "g33";
  applyMark(mark);

  if (picker) {
    picker.addEventListener("change", function () {
      applyMark(picker.value);
      write("argon-brand-mark-4", picker.value);
    });
  }

  document.querySelectorAll(".js-try").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyMark(btn.dataset.mark);
      write("argon-brand-mark-4", btn.dataset.mark);
      var target = document.getElementById("system-title");
      if (target) target.scrollIntoView({ block: "start" });
    });
  });
})();
