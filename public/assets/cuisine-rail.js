/**
 * سحب الماوس فقط. الإصبع يستخدم التمرير الأصلي حتى تبقى الحركة سلسة.
 */
(function () {
  function bind(bar) {
    if (!bar || bar.getAttribute("data-erv-rail") === "1") return;
    bar.setAttribute("data-erv-rail", "1");
    var drag = null;
    var suppressClick = false;

    bar.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (bar.scrollWidth <= bar.clientWidth + 2) return;
      drag = { id: e.pointerId, x: e.clientX, left: bar.scrollLeft, moved: false };
      bar.classList.add("is-dragging");
      try { bar.setPointerCapture(e.pointerId); } catch (_err) {}
    });

    bar.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      bar.scrollLeft = drag.left - dx;
      if (drag.moved) e.preventDefault();
    });

    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (drag.moved) suppressClick = true;
      drag = null;
      bar.classList.remove("is-dragging");
    }

    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
    bar.addEventListener("click", function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    bar.addEventListener("wheel", function (e) {
      if (bar.scrollWidth <= bar.clientWidth + 2) return;
      var useX = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      var delta = useX ? e.deltaX : e.deltaY;
      if (!delta) return;
      var before = bar.scrollLeft;
      bar.scrollLeft = before - delta;
      if (bar.scrollLeft !== before) e.preventDefault();
    }, { passive: false });
  }

  function boot() {
    document.querySelectorAll(".stores-cuisine-scroll, .store-prod-cat__scroll").forEach(bind);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
