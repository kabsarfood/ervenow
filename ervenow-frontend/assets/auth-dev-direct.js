/**
 * لوحة «وضع التطوير» — تبقى ظاهرة دائماً (لا إخفاء عبر API).
 */
(function (global) {
  function initDevDirectButton(btnId) {
    var btn = btnId ? document.getElementById(btnId) : null;
    if (!btn) return;
    var panel = btn.closest(".auth-dev-panel");
    if (panel) {
      panel.hidden = false;
      panel.removeAttribute("hidden");
      panel.setAttribute("aria-hidden", "false");
    }
    btn.hidden = false;
    btn.removeAttribute("hidden");
  }

  global.ErvenowAuthDevDirect = {
    initDevDirectButton: initDevDirectButton,
  };
})(window);
