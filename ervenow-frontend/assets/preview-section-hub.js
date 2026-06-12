/**
 * معاينة — محرّك مشترك لصفحات الأقسام (preview/*-hub.html)
 */
(function (global) {
  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function initPreviewHub(cfg) {
    if (!cfg || !Array.isArray(cfg.categories) || !Array.isArray(cfg.items)) return;

    var activeCat = "";
    var activeSort = cfg.defaultSort || "nearest";
    var searchEl = document.getElementById("hubSearch");
    var catBar = document.getElementById("catBar");
    var grid = document.getElementById("hubGrid");
    var statusLine = document.getElementById("statusLine");
    var entity = cfg.entityLabel || "عنصر";
    var entityPlural = cfg.entityPlural || entity + "ات";
    var ctaLabel = cfg.ctaLabel || "عرض التفاصيل";

    function buildCats() {
      if (!catBar) return;
      var html =
        '<button type="button" class="preview-rest-cat is-active" data-cat="" role="tab" aria-selected="true">' +
        '<span class="preview-rest-cat__ic">▦</span><span>الكل</span></button>';
      cfg.categories.forEach(function (c) {
        html +=
          '<button type="button" class="preview-rest-cat" data-cat="' +
          esc(c.id) +
          '" role="tab" aria-selected="false">' +
          '<span class="preview-rest-cat__ic">' +
          esc(c.icon) +
          "</span><span>" +
          esc(c.label) +
          "</span></button>";
      });
      catBar.innerHTML = html;
    }

    function filtered() {
      var q = searchEl ? String(searchEl.value || "").trim().toLowerCase() : "";
      var list = cfg.items.filter(function (r) {
        if (activeCat && r.category !== activeCat) return false;
        if (activeSort === "offers" && !r.offer) return false;
        if (q && String(r.name).toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
      list.sort(function (a, b) {
        if (activeSort === "rating") return b.rating - a.rating;
        if (activeSort === "offers") {
          if (a.offer !== b.offer) return a.offer ? -1 : 1;
          return a.km - b.km;
        }
        return a.km - b.km;
      });
      return list;
    }

    function render() {
      var list = filtered();
      var catMeta = cfg.categories.find(function (c) {
        return c.id === activeCat;
      });
      var catLabel = activeCat ? (catMeta && catMeta.label) || activeCat : "كل التصنيفات";
      var sortLabel =
        activeSort === "rating" ? "الأعلى تقييماً" : activeSort === "offers" ? "عروض فقط" : "الأقرب";
      if (statusLine) {
        statusLine.textContent = list.length + " " + entityPlural + " — " + catLabel + " · ترتيب: " + sortLabel;
      }

      if (!grid) return;
      if (!list.length) {
        grid.innerHTML =
          '<div class="preview-rest-empty" role="status">' +
          "<h2>لا نتائج</h2>" +
          "<p>جرّب «الكل» أو غيّر الترتيب أو امسح البحث.</p></div>";
        return;
      }

      grid.innerHTML = list
        .map(function (r) {
          return (
            '<article class="preview-rest-card">' +
            '<div class="preview-rest-card__media">' +
            esc(r.icon) +
            (r.offer ? '<span class="preview-rest-card__offer">عرض</span>' : "") +
            "</div>" +
            '<div class="preview-rest-card__body">' +
            "<h3>" +
            esc(r.name) +
            "</h3>" +
            '<p class="preview-rest-card__type">' +
            esc(r.label) +
            "</p>" +
            '<div class="preview-rest-card__meta">' +
            "<span>⭐ " +
            esc(String(r.rating)) +
            "</span>" +
            "<span>📍 " +
            esc(String(r.km)) +
            " كم</span>" +
            "<span>⏱ ~" +
            esc(String(Math.max(15, Math.round(r.km * 4 + 12)))) +
            " د</span>" +
            "</div>" +
            '<button type="button" class="preview-rest-card__btn" data-id="' +
            esc(r.id) +
            '">' +
            esc(ctaLabel) +
            "</button>" +
            "</div></article>"
          );
        })
        .join("");
    }

    buildCats();
    render();

    if (catBar) {
      catBar.addEventListener("click", function (e) {
        var btn = e.target.closest(".preview-rest-cat");
        if (!btn) return;
        activeCat = btn.getAttribute("data-cat") || "";
        catBar.querySelectorAll(".preview-rest-cat").forEach(function (b) {
          var on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        render();
      });
    }

    document.querySelectorAll(".preview-rest-sort__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        activeSort = btn.getAttribute("data-sort") || "nearest";
        document.querySelectorAll(".preview-rest-sort__btn").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        render();
      });
    });

    if (searchEl) searchEl.addEventListener("input", render);

    if (grid) {
      grid.addEventListener("click", function (e) {
        var b = e.target.closest(".preview-rest-card__btn");
        if (!b) return;
        alert(cfg.previewAlert || "معاينة — في النسخة النهائية يفتح التفاصيل.");
      });
    }

    var p = new URLSearchParams(location.search);
    var qKey = cfg.queryKey || "category";
    var fromUrl = String(p.get(qKey) || "").trim().toLowerCase();
    if (fromUrl && catBar) {
      var chip = catBar.querySelector('.preview-rest-cat[data-cat="' + fromUrl + '"]');
      if (chip) chip.click();
    }
  }

  global.initPreviewHub = initPreviewHub;
})(window);
