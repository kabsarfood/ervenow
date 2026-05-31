/**
 * ERVENOW — ثبات الشاشة على الجوال (Samsung/Android/iOS)
 * - ارتفاع حقيقي (--erw-vh)
 * - منع التكبير/التصغير باللمس
 * - إعادة المقياس الطبيعي بعد تدوير الشاشة
 */
(function (global) {
  if (global.__ervViewportReady) return;
  global.__ervViewportReady = true;

  var VIEWPORT_LOCKED =
    "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover";

  var lockCount = 0;
  var savedScrollY = 0;

  function enforceViewportMeta() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      document.head.appendChild(meta);
    }
    if (meta.getAttribute("content") !== VIEWPORT_LOCKED) {
      meta.setAttribute("content", VIEWPORT_LOCKED);
    }
  }

  function resetViewportScale() {
    enforceViewportMeta();
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    meta.setAttribute("content", VIEWPORT_LOCKED + ", shrink-to-fit=no");
    global.setTimeout(function () {
      meta.setAttribute("content", VIEWPORT_LOCKED);
      setViewportVars();
    }, 280);
  }

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
    if (vv && vv.scale > 1.02) resetViewportScale();
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

  function blockPinchZoom(e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }

  function blockGestureZoom(e) {
    e.preventDefault();
  }

  enforceViewportMeta();
  setViewportVars();

  document.addEventListener("gesturestart", blockGestureZoom, { passive: false });
  document.addEventListener("gesturechange", blockGestureZoom, { passive: false });
  document.addEventListener("gestureend", blockGestureZoom, { passive: false });
  document.addEventListener("touchmove", blockPinchZoom, { passive: false });

  global.addEventListener("resize", setViewportVars, { passive: true });
  global.addEventListener("orientationchange", function () {
    global.setTimeout(resetViewportScale, 120);
  });
  global.addEventListener("pageshow", function (ev) {
    if (ev.persisted) resetViewportScale();
  });

  if (global.visualViewport) {
    global.visualViewport.addEventListener("resize", setViewportVars, { passive: true });
    global.visualViewport.addEventListener("scroll", setViewportVars, { passive: true });
  }

  global.ErvenowViewport = {
    refresh: setViewportVars,
    resetScale: resetViewportScale,
    lockScroll: lockScroll,
    unlockScroll: unlockScroll,
  };
})(window);
