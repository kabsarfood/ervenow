/**
 * ERVENOW — ارتفاع الشاشة الحقيقي على Android/Samsung (شريط العنوان + لوحة المفاتيح)
 * يضبط --erw-vh و --erw-viewport-h ويقفل التمرير بثبات عند النوافذ المنبثقة.
 */
(function (global) {
  if (global.__ervViewportReady) return;
  global.__ervViewportReady = true;

  var lockCount = 0;
  var savedScrollY = 0;

  function setViewportVars() {
    var vv = global.visualViewport;
    var h = vv && vv.height > 0 ? vv.height : global.innerHeight;
    var w = vv && vv.width > 0 ? vv.width : global.innerWidth;
    var root = document.documentElement;
    root.style.setProperty("--erw-vh", h * 0.01 + "px");
    root.style.setProperty("--erw-vw", w * 0.01 + "px");
    root.style.setProperty("--erw-viewport-h", h + "px");
    root.style.setProperty("--erw-viewport-w", w + "px");
    root.classList.add("erw-viewport-ready");
  }

  function lockScroll() {
    lockCount += 1;
    if (lockCount > 1) return;
    savedScrollY = global.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add("erw-scroll-locked");
    document.body.style.top = "-" + savedScrollY + "px";
  }

  function unlockScroll() {
    if (lockCount <= 0) return;
    lockCount -= 1;
    if (lockCount > 0) return;
    document.body.classList.remove("erw-scroll-locked");
    document.body.style.top = "";
    global.scrollTo(0, savedScrollY);
  }

  setViewportVars();
  global.addEventListener("resize", setViewportVars, { passive: true });
  global.addEventListener("orientationchange", function () {
    setTimeout(setViewportVars, 120);
  });
  if (global.visualViewport) {
    global.visualViewport.addEventListener("resize", setViewportVars, { passive: true });
    global.visualViewport.addEventListener("scroll", setViewportVars, { passive: true });
  }

  global.ErvenowViewport = {
    refresh: setViewportVars,
    lockScroll: lockScroll,
    unlockScroll: unlockScroll,
  };
})(window);
