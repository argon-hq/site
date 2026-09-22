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
    // Abaixo de 24 px a variação 4 usa a versão de tela pequena.
    document.querySelectorAll(".js-mark-small use").forEach(function (use) {
      use.setAttribute("href", "#" + (id === "m4" ? "m4s" : id));
    });
    document.querySelectorAll(".js-try").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.mark === id));
    });
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

  var picker = document.querySelector(".js-picker");
  var mark = read("argon-brand-mark");
  if (!mark || !document.getElementById(mark)) mark = "m4";
  applyMark(mark);

  if (picker) {
    picker.addEventListener("change", function () {
      applyMark(picker.value);
      write("argon-brand-mark", picker.value);
    });
  }

  document.querySelectorAll(".js-try").forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyMark(btn.dataset.mark);
      write("argon-brand-mark", btn.dataset.mark);
      var target = document.getElementById("system-title");
      if (target) target.scrollIntoView({ block: "start" });
    });
  });
})();
