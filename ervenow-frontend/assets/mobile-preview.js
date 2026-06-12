/**
 * ERVENOW — Mobile Device Preview Lab
 * /mobile-preview.html
 */
(function () {
  var DEVICES = {
    iphone: { id: "iphone", label: "iPhone", w: 390, h: 844, chip: "iOS · Safari" },
    samsung: { id: "samsung", label: "Samsung Galaxy", w: 360, h: 780, chip: "Android · Chrome" },
    tablet: { id: "tablet", label: "Tablet", w: 768, h: 1024, chip: "iPad · 768px" },
  };

  var PAGES = [
    { path: "/", label: "الرئيسية" },
    { path: "/start-now", label: "ابدأ الآن" },
    { path: "/restaurants", label: "المطاعم" },
    { path: "/stores", label: "المتاجر" },
    { path: "/services", label: "الخدمات" },
    { path: "/checkout", label: "السلة / الدفع" },
  ];

  function qs(name) {
    try {
      return new URLSearchParams(location.search).get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function allowedPage(path) {
    if (!path || path.charAt(0) !== "/") return "/";
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].path === path) return path;
    }
    return "/";
  }

  var page = allowedPage(qs("page"));
  var focus = qs("device");
  var onlyOne = focus && DEVICES[focus];

  function buildPreviewUrl(path) {
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "ervPreview=1";
  }

  function computeScale(deviceW, deviceH, single) {
    if (single) return 1;
    var maxW = Math.min(window.innerWidth - 32, 1280);
    var count = Object.keys(DEVICES).length;
    var slotW = maxW / count - 24;
    var scaleByW = slotW / deviceW;
    var scaleByH = (window.innerHeight - 280) / deviceH;
    return Math.min(1, scaleByW, scaleByH, 0.85);
  }

  function renderPageSelect() {
    var sel = document.getElementById("ervPreviewPage");
    if (!sel) return;
    sel.innerHTML = "";
    PAGES.forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p.path;
      opt.textContent = p.label;
      if (p.path === page) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      var u = new URL(location.href);
      u.searchParams.set("page", sel.value);
      location.href = u.toString();
    });
  }

  function renderLinks() {
    var box = document.getElementById("ervPreviewLinks");
    if (!box) return;
    var base = location.origin + "/mobile-preview.html?page=" + encodeURIComponent(page);
    var rows = [
      { label: "الثلاثة معاً", href: base },
      { label: "iPhone", href: base + "&device=iphone" },
      { label: "Samsung Galaxy", href: base + "&device=samsung" },
      { label: "Tablet", href: base + "&device=tablet" },
      { label: "الرئيسية مباشرة (390px)", href: location.origin + "/?ervPreview=1" },
    ];
    box.innerHTML = "";
    rows.forEach(function (row) {
      var wrap = document.createElement("div");
      wrap.className = "erv-preview-links__row";
      wrap.innerHTML =
        '<span class="erv-preview-links__label"></span>' +
        '<a class="erv-preview-links__a" href=""></a>' +
        '<button type="button" class="erv-preview-links__copy" aria-label="نسخ الرابط">نسخ</button>';
      wrap.querySelector(".erv-preview-links__label").textContent = row.label;
      var a = wrap.querySelector(".erv-preview-links__a");
      a.href = row.href;
      a.textContent = row.href.replace(/^https?:\/\//, "");
      wrap.querySelector(".erv-preview-links__copy").setAttribute("data-copy", row.href);
      box.appendChild(wrap);
    });
  }

  function renderFrames() {
    var grid = document.getElementById("ervPreviewGrid");
    if (!grid) return;
    grid.innerHTML = "";
    var keys = onlyOne ? [focus] : Object.keys(DEVICES);
    var previewUrl = buildPreviewUrl(page);

    keys.forEach(function (key) {
      var d = DEVICES[key];
      var scale = computeScale(d.w, d.h, !!onlyOne);

      var article = document.createElement("article");
      article.className = "erv-preview-device";

      var head = document.createElement("header");
      head.className = "erv-preview-device__head";
      head.innerHTML = "<h2></h2><p class=\"erv-preview-device__meta\"></p>";
      head.querySelector("h2").textContent = d.label;
      head.querySelector(".erv-preview-device__meta").textContent =
        d.w + "×" + d.h + " · " + d.chip + " · " + Math.round(scale * 100) + "%";

      var shell = document.createElement("div");
      shell.className = "erv-preview-device__shell";
      shell.style.setProperty("--erv-dev-w", d.w + "px");
      shell.style.setProperty("--erv-dev-h", d.h + "px");
      shell.style.setProperty("--erv-dev-scale", String(scale));

      var viewport = document.createElement("div");
      viewport.className = "erv-preview-device__viewport";

      var iframe = document.createElement("iframe");
      iframe.className = "erv-preview-device__iframe";
      iframe.title = d.label;
      iframe.src = previewUrl;
      iframe.setAttribute("loading", "eager");

      viewport.appendChild(iframe);
      shell.appendChild(viewport);

      var openLink = document.createElement("a");
      openLink.className = "erv-preview-device__open";
      openLink.href = previewUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.textContent = "فتح بملء الشاشة";

      article.appendChild(head);
      article.appendChild(shell);
      article.appendChild(openLink);
      grid.appendChild(article);
    });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var text = btn.getAttribute("data-copy");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "تم";
        setTimeout(function () {
          btn.textContent = "نسخ";
        }, 1500);
      });
    }
  });

  function init() {
    renderPageSelect();
    renderLinks();
    renderFrames();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.addEventListener("resize", function () {
    renderFrames();
  });
})();
