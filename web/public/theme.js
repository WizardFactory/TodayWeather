/* Applies the saved theme before first paint; the app bundle loads later. */
(function () {
  var colors = {
    light: "#f5f7fb",
    dark: "#111c2b",
    photo: "#edf4fb",
    classic: "#f3f7f5",
  };
  try {
    var saved = JSON.parse(
      localStorage.getItem("tw.web.v1.preferences") || "null",
    );
    var theme = saved && saved.settings && saved.settings.theme;
    if (!colors[theme]) return;
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", colors[theme]);
  } catch (e) {
    /* Storage unavailable: the default theme applies. */
  }
})();
