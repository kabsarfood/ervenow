/** Admin — إدارة البنرات V2 (6 أقسام ثابتة، أولوية، حالة، إحصائيات) */
import { app } from "./shared.js";
import "./api.js";

var heroBannersCache = [];
var targetOptions = [];
var statusOptions = [];
var bannerSpec = null;
var heroBannersPanelLoaded = false;
var heroBannersFilterStatus = "all";

function heroBannersPanelHintText() {
  return heroBannersCache.length + " بنر — مقاس موحّد 1920×730 — 6 أقسام ثابتة. صور البنرات منفصلة عن شعار المنصة.";
}

var FALLBACK_SECTION_TARGETS = [
  { id: "home", label_ar: "الرئيسية", page: "/" },
  { id: "visitor_dashboard", label_ar: "لوحة زائر المنصة", page: "/dashboard" },
  { id: "services", label_ar: "خدمات", page: "/services" },
  { id: "stores", label_ar: "متاجر", page: "/stores" },
  { id: "restaurants", label_ar: "مطاعم", page: "/restaurants" },
  { id: "delivery", label_ar: "توصيل", page: "/delivery-services.html" },
];

function getSectionTargetOptions() {
  if (Array.isArray(targetOptions) && targetOptions.length) return targetOptions;
  return FALLBACK_SECTION_TARGETS;
}

var TARGET_DEFAULTS = {
  home: {
    title: "اطلب أي خدمة|الآن وبسهولة",
    description: "كل ما تحتاجه — في مكان واحد.",
    button1_text: "اطلب الآن",
    button1_url: "/start-now",
    display_mode: "carousel",
    banner_type: "promotional",
    status: "active",
    priority: 10,
  },
  visitor_dashboard: {
    title: "مرحباً بك في ERVENOW",
    description: "استكشف المطاعم والمتاجر والخدمات — سجّل دخولك لإتمام الطلب.",
    button1_text: "ابدأ الآن",
    button1_url: "/start-now",
    button2_text: "تسجيل الدخول",
    button2_url: "/login?role=customer",
    display_mode: "carousel",
    banner_type: "awareness",
    status: "active",
    priority: 10,
  },
  services: {
    title: "خدمات منزلية|بخطوات بسيطة",
    description: "سباك، كهرباء، تكييف، تنظيف — واحجز من هنا.",
    button1_text: "استكشف الخدمات",
    button1_url: "/services",
    display_mode: "carousel",
    banner_type: "promotional",
    status: "active",
    priority: 10,
  },
  stores: {
    title: "اكتشف المتاجر|قريبة منك",
    description: "سوبرماركت، صيدليات، خضار — مع توصيل سريع.",
    button1_text: "تصفّح المتاجر",
    button1_url: "/stores",
    display_mode: "carousel",
    banner_type: "promotional",
    status: "active",
    priority: 10,
  },
  restaurants: {
    title: "اكتشف المطاعم|المعتمدة",
    description: "مطابخ متنوعة وتوصيل لحد باب بيتك.",
    button1_text: "تصفّح المطاعم",
    button1_url: "/restaurants",
    display_mode: "carousel",
    banner_type: "promotional",
    status: "active",
    priority: 10,
  },
  delivery: {
    title: "خدمات التوصيل|من نقطة لأخرى",
    description: "نقل مركبات، أثاث، غاز — اطلب بسهولة.",
    button1_text: "اطلب توصيل",
    button1_url: "/delivery-services.html",
    display_mode: "carousel",
    banner_type: "operational",
    status: "active",
    priority: 10,
  },
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function labelFor(list, id) {
  var opt = (list || []).find(function (o) {
    return o.id === id;
  });
  return opt ? opt.label_ar || opt.id : id;
}

function bannerHasTargetFilter(b, targetId) {
  if (!targetId || targetId === "all") return true;
  var list = b.banner_targets || [];
  return list.indexOf(targetId) >= 0;
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  var pad = function (n) {
    return String(n).padStart(2, "0");
  };
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ""));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

var SECTION_ICONS = {
  home: "🏠",
  visitor_dashboard: "📋",
  services: "🧰",
  stores: "🛒",
  restaurants: "🍽️",
  delivery: "🚛",
};

var SECTION_PLACEMENT_HINTS = {
  home: "البنر المتحرك يظهر في / تحت الهيدر مباشرة (مكان بطاقة الترحيب) — صورة 1920×730 بكسل.",
  visitor_dashboard: "الشرائح المتحركة في /dashboard — صورة 1920×730 بكسل.",
  services: "بنر متحرك في /services — صورة 1920×730 بكسل.",
  stores: "بنر متحرك في /stores — صورة 1920×730 بكسل.",
  restaurants: "بنر متحرك في /restaurants — صورة 1920×730 بكسل.",
  delivery: "بنر متحرك في /delivery-services.html — صورة 1920×730 بكسل.",
};

function sectionIcon(id) {
  return SECTION_ICONS[id] || "🎨";
}

function bannersForSection(targetId) {
  return heroBannersCache.filter(function (b) {
    return bannerHasTargetFilter(b, targetId);
  });
}

function selectOptionsHtml(list, selected, cls) {
  return (list || [])
    .map(function (opt) {
      return (
        '<option value="' +
        esc(opt.id) +
        '"' +
        (opt.id === selected ? " selected" : "") +
        ">" +
        esc(opt.label_ar || opt.id) +
        "</option>"
      );
    })
    .join("");
}

function statsHtml(b) {
  var imp = Number(b.impression_count) || 0;
  var clk = Number(b.click_count) || 0;
  var ctr = b.ctr != null ? b.ctr : imp > 0 ? Math.round((clk / imp) * 10000) / 100 : 0;
  return (
    '<div class="hero-banners-stats">' +
    "<span>👁 ظهور: <strong>" +
    esc(String(imp)) +
    "</strong></span>" +
    "<span>🖱 نقر: <strong>" +
    esc(String(clk)) +
    "</strong></span>" +
    "<span>CTR: <strong>" +
    esc(String(ctr)) +
    "%</strong></span>" +
    "</div>"
  );
}

function bannerSpecNoticeHtml() {
  var spec = bannerSpec || {
    label_ar: "1920×730",
    admin_hint_ar: "ارفع صورة واحدة بالمقاس 1920×730 — تُعرض بـ object-fit: cover",
  };
  return (
    '<div class="hero-banners-spec-notice" role="note">' +
    "<strong>المقاس الرسمي الموحّد:</strong> " +
    esc(spec.label_ar || "1920×730") +
    " — " +
    esc(spec.admin_hint_ar || "") +
    "</div>"
  );
}

function bannerCard(b, idx, sectionTarget) {
  var id = b.id || "";
  var status = b.status || (b.is_active === false ? "paused" : "active");
  var sectionMeta = getSectionTargetOptions().find(function (o) {
    return o.id === sectionTarget;
  });
  return (
    '<div class="item hero-banner-card" data-banner-id="' +
    esc(id) +
    '" data-banner-idx="' +
    idx +
    '" data-section-target="' +
    esc(sectionTarget || "") +
    '">' +
    '<div class="line"><strong>بنر #' +
    (idx + 1) +
    "</strong> — ترتيب " +
    esc(String(b.sort_order != null ? b.sort_order : 0)) +
    " — " +
    esc(labelFor(statusOptions, status)) +
    "</div>" +
    statsHtml(b) +
    (sectionMeta
      ? '<p class="sub hero-banner-card__place" style="margin:6px 0">يعرض في: <strong>' +
        esc(sectionMeta.label_ar) +
        '</strong> <span dir="ltr" class="hero-banner-card__path">' +
        esc(sectionMeta.page || "") +
        "</span></p>" +
        (SECTION_PLACEMENT_HINTS[sectionTarget]
          ? '<p class="sub hero-banner-card__hint" style="margin:4px 0 8px;line-height:1.55;color:rgba(0,0,0,.62)">' +
            esc(SECTION_PLACEMENT_HINTS[sectionTarget]) +
            "</p>"
          : "")
      : "") +
    '<label style="display:block;margin:6px 0 2px">عنوان البنر<input class="search-input hb-inp-title" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(b.title || "") +
    '" placeholder="سطر1|سطر2 مميز" /></label>' +
    (b.image_url
      ? '<img class="hero-banner-preview" src="' + esc(b.image_url) + '" alt="" />'
      : '<p class="sub" style="margin:8px 0">لم تُرفع صورة بعد — المقاس المطلوب 1920×730</p>') +
    '<label style="display:block;margin:6px 0 2px">صورة البنر (1920×730)<input type="file" accept="image/*" class="hb-inp-file" style="width:100%;margin-top:4px;font-size:16px" /></label>' +
    '<label style="display:block;margin:6px 0 2px">نص الزر<input class="search-input hb-inp-btn1-text" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(b.button1_text || "") +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">رابط الزر<input class="search-input hb-inp-btn1-url" style="width:100%;margin-top:4px;font-size:16px" dir="ltr" value="' +
    esc(b.button1_url || "") +
    '" /></label>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:8px">' +
    '<label style="margin:0">ترتيب الظهور<input type="number" class="search-input hb-inp-sort" style="width:100%;margin-top:4px;font-size:16px;min-height:44px" value="' +
    esc(String(b.sort_order != null ? b.sort_order : 0)) +
    '" /></label>' +
    '<label style="margin:0">حالة التفعيل<select class="search-input hb-inp-status" style="width:100%;margin-top:4px;font-size:16px;min-height:44px">' +
    selectOptionsHtml(statusOptions, status) +
    "</select></label>" +
    "</div>" +
    '<label style="display:block;margin:6px 0 2px">تاريخ البداية<input type="datetime-local" class="search-input hb-inp-starts" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(toLocalInputValue(b.starts_at)) +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">تاريخ النهاية<input type="datetime-local" class="search-input hb-inp-ends" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(toLocalInputValue(b.ends_at)) +
    '" /></label>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
    '<button type="button" class="btn btn-primary hb-save-btn" style="min-height:44px">حفظ</button>' +
    '<button type="button" class="btn btn-ghost hb-delete-btn" style="min-height:44px">حذف</button>' +
    "</div>" +
    "</div>"
  );
}

function wireBannerList(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll(".hb-save-btn").forEach(function (btn) {
    btn.onclick = function () {
      var card = btn.closest(".hero-banner-card");
      if (card) app.saveHeroBannerCard(card);
    };
  });
  listEl.querySelectorAll(".hb-delete-btn").forEach(function (btn) {
    btn.onclick = function () {
      var card = btn.closest(".hero-banner-card");
      if (card) app.deleteHeroBannerCard(card);
    };
  });
  listEl.querySelectorAll(".hb-inp-file").forEach(function (inp) {
    inp.onchange = function () {
      var card = inp.closest(".hero-banner-card");
      if (card && inp.files && inp.files[0]) showBannerImageDimWarn(card, inp.files[0]);
    };
  });
}

function showBannerImageDimWarn(container, file) {
  if (!container || !file) return;
  var warn = container.querySelector(".erv-banner-dim-warn");
  if (!warn) {
    warn = document.createElement("p");
    warn.className = "sub erv-banner-dim-warn";
    warn.style.cssText =
      "margin:8px 0 0;padding:10px 12px;border-radius:10px;background:rgba(166,92,0,0.12);color:#8a4b00;font-weight:700;line-height:1.5";
    var fileInp = container.querySelector(".hb-inp-file");
    if (fileInp && fileInp.parentNode) fileInp.parentNode.insertAdjacentElement("afterend", warn);
    else container.appendChild(warn);
  }
  if (!file.type || !String(file.type).startsWith("image/")) {
    warn.hidden = true;
    return;
  }
  var url = URL.createObjectURL(file);
  var img = new Image();
  img.onload = function () {
    URL.revokeObjectURL(url);
    if (img.naturalWidth === 1920 && img.naturalHeight === 730) {
      warn.hidden = true;
      warn.textContent = "";
      return;
    }
    warn.hidden = false;
    warn.textContent =
      "تنبيه: المقاس الموصى به 1920×730 بكسل. الصورة المختارة " +
      img.naturalWidth +
      "×" +
      img.naturalHeight +
      " — سيُعرض البنر بـ object-fit: cover دون منع الرفع.";
  };
  img.onerror = function () {
    URL.revokeObjectURL(url);
    warn.hidden = true;
  };
  img.src = url;
}

function sectionBlockHtml(opt, filterStatus, sectionIndex) {
  var rows = bannersForSection(opt.id);
  if (filterStatus !== "all") {
    rows = rows.filter(function (b) {
      return (b.status || "active") === filterStatus;
    });
  }
  rows.sort(function (a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });
  var listHtml =
    rows.length > 0
      ? rows
          .map(function (b) {
            return bannerCard(b, heroBannersCache.indexOf(b), opt.id);
          })
          .join("")
      : '<p class="sub hero-banners-section__empty">لا توجد بنرات في هذا القسم — أضف بنراً جديداً.</p>';
  return (
    '<section class="hero-banners-section" id="heroBannersSection-' +
    esc(opt.id) +
    '" data-section-id="' +
    esc(opt.id) +
    '">' +
    '<div class="hero-banners-section__head">' +
    '<div class="hero-banners-section__title-wrap">' +
    '<span class="hero-banners-section__num" aria-hidden="true">' +
    esc(String(sectionIndex)) +
    "</span>" +
    '<span class="hero-banners-section__ic" aria-hidden="true">' +
    sectionIcon(opt.id) +
    "</span>" +
    '<div class="hero-banners-section__meta">' +
    '<h3 class="hero-banners-section__title">' +
    esc(opt.label_ar) +
    "</h3>" +
    '<p class="hero-banners-section__path" dir="ltr">' +
    esc(opt.page || "") +
    ' <span class="hero-banners-section__id">(' +
    esc(opt.id) +
    ")</span></p>" +
    (SECTION_PLACEMENT_HINTS[opt.id]
      ? '<p class="hero-banners-section__hint">' + esc(SECTION_PLACEMENT_HINTS[opt.id]) + "</p>"
      : "") +
    "</div>" +
    "</div>" +
    '<button type="button" class="btn btn-primary hb-section-add-btn" data-section-target="' +
    esc(opt.id) +
    '" style="min-height:44px">+ إضافة بنر</button>' +
    "</div>" +
    '<div class="hero-banners-section__list">' +
    listHtml +
    "</div>" +
    "</section>"
  );
}

function syncHeroBannerDraftsFromDom() {
  document.querySelectorAll(".hero-banner-card").forEach(function (card) {
    var idx = Number(card.getAttribute("data-banner-idx"));
    if (!Number.isFinite(idx) || idx < 0 || !heroBannersCache[idx]) return;
    var b = heroBannersCache[idx];
    var titleEl = card.querySelector(".hb-inp-title");
    var btn1TextEl = card.querySelector(".hb-inp-btn1-text");
    var btn1UrlEl = card.querySelector(".hb-inp-btn1-url");
    var sortEl = card.querySelector(".hb-inp-sort");
    var statusEl = card.querySelector(".hb-inp-status");
    var startsEl = card.querySelector(".hb-inp-starts");
    var endsEl = card.querySelector(".hb-inp-ends");
    if (titleEl) b.title = titleEl.value || "";
    if (btn1TextEl) b.button1_text = btn1TextEl.value || "";
    if (btn1UrlEl) b.button1_url = btn1UrlEl.value || "";
    if (sortEl) b.sort_order = Number(sortEl.value || 0);
    if (statusEl) {
      b.status = statusEl.value || "active";
      b.is_active = b.status !== "paused";
    }
    if (startsEl && startsEl.value) b.starts_at = new Date(startsEl.value).toISOString();
    if (endsEl && endsEl.value) b.ends_at = new Date(endsEl.value).toISOString();
  });
}

app.renderHeroBannersEditor = function () {
  var root = document.getElementById("heroBannersEditor");
  if (!root) return;

  syncHeroBannerDraftsFromDom();

  var liveFilter = document.getElementById("heroBannersFilterStatus");
  if (liveFilter) heroBannersFilterStatus = liveFilter.value || heroBannersFilterStatus;
  var filterStatus = heroBannersFilterStatus || "all";
  var scrollY = window.scrollY || 0;

  var sectionsHtml = getSectionTargetOptions()
    .map(function (opt, i) {
      return sectionBlockHtml(opt, filterStatus, i + 1);
    })
    .join("");

  root.innerHTML =
    bannerSpecNoticeHtml() +
    '<p class="sub" style="margin:0 0 12px;line-height:1.6">البنرات مقسّمة حسب <strong>القسم الثابت</strong>. ارفع صورة واحدة <strong>1920×730</strong> لكل بنر — تُعرض بـ <code dir="ltr">object-fit: cover</code> في جميع الصفحات واللوحات.</p>' +
    '<div class="hero-banners-toolbar" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px">' +
    '<label style="flex:0 1 180px;margin:0">تصفية حسب الحالة<select id="heroBannersFilterStatus" class="search-input" style="width:100%;margin-top:4px;min-height:44px">' +
    '<option value="all"' +
    (filterStatus === "all" ? " selected" : "") +
    ">كل الحالات</option>" +
    statusOptions
      .map(function (s) {
        return (
          '<option value="' +
          esc(s.id) +
          '"' +
          (filterStatus === s.id ? " selected" : "") +
          ">" +
          esc(s.label_ar) +
          "</option>"
        );
      })
      .join("") +
    "</select></label>" +
    "</div>" +
    '<div class="hero-banners-sections">' +
    sectionsHtml +
    "</div>";

  var filterSt = document.getElementById("heroBannersFilterStatus");
  if (filterSt) {
    filterSt.value = filterStatus;
    filterSt.onchange = function () {
      heroBannersFilterStatus = filterSt.value || "all";
      app.renderHeroBannersEditor();
    };
  }

  root.querySelectorAll(".hero-banners-section__list").forEach(wireBannerList);

  root.querySelectorAll(".hb-section-add-btn").forEach(function (btn) {
    btn.onclick = function () {
      app.createHeroBannerDraft(btn.getAttribute("data-section-target") || "home");
    };
  });

  requestAnimationFrame(function () {
    window.scrollTo(0, scrollY);
  });
};

app.collectHeroBannerFromCard = async function (card) {
  var id = card.getAttribute("data-banner-id") || "";
  var idx = Number(card.getAttribute("data-banner-idx"));
  var prev = heroBannersCache[idx] || {};
  var sectionTarget = String(card.getAttribute("data-section-target") || "").trim();
  var targets = [];
  if (sectionTarget) {
    targets = [sectionTarget];
  } else {
    card.querySelectorAll(".hb-inp-target:checked").forEach(function (cb) {
      if (cb.value) targets.push(cb.value);
    });
  }
  var startsVal = (card.querySelector(".hb-inp-starts") || {}).value || "";
  var endsVal = (card.querySelector(".hb-inp-ends") || {}).value || "";
  var body = {
    title: (card.querySelector(".hb-inp-title") || {}).value || "",
    button1_text: (card.querySelector(".hb-inp-btn1-text") || {}).value || "",
    button1_url: (card.querySelector(".hb-inp-btn1-url") || {}).value || "",
    sort_order: Number((card.querySelector(".hb-inp-sort") || {}).value || 0),
    status: (card.querySelector(".hb-inp-status") || {}).value || "active",
    display_mode: "carousel",
    banner_type: "promotional",
    banner_targets: targets,
    is_active: ((card.querySelector(".hb-inp-status") || {}).value || "active") !== "paused",
    starts_at: startsVal ? new Date(startsVal).toISOString() : null,
    ends_at: endsVal ? new Date(endsVal).toISOString() : null,
    image_url: prev.image_url || "",
  };
  var fileInp = card.querySelector(".hb-inp-file");
  if (fileInp && fileInp.files && fileInp.files[0]) {
    body.imageFileBase64 = await readFileAsDataUrl(fileInp.files[0]);
    body.imageFileName = fileInp.files[0].name || "hero.jpg";
  }
  return { id: id, body: body };
};

app.createHeroBannerDraft = async function (targetId) {
  if (!app.hasPermission("dashboard")) return;
  var tid = String(targetId || "home").trim();
  var def = TARGET_DEFAULTS[tid] || TARGET_DEFAULTS.home;
  try {
    var body = Object.assign(
      {
        banner_targets: [tid],
        sort_order: heroBannersCache.length,
        button2_text: "",
        button2_url: "",
      },
      def
    );
    var j = await app.PlatformAPI.api("/api/admin/hero-banners", { method: "POST", body: body });
    if (j.banner) heroBannersCache.push(j.banner);
    app.renderHeroBannersEditor();
    app.showSuccess(j.message || "تم إنشاء البنر");
  } catch (e) {
    app.showError(e.message || "تعذّر الإنشاء");
  }
};

app.saveHeroBannerCard = async function (card) {
  if (!app.hasPermission("dashboard")) return;
  try {
    var collected = await app.collectHeroBannerFromCard(card);
    if (!collected.id) return;
    if (!collected.body.banner_targets || !collected.body.banner_targets.length) {
      app.showError("تعذّر تحديد قسم البنر");
      return;
    }
    var j = await app.PlatformAPI.api("/api/admin/hero-banners/" + collected.id, {
      method: "PUT",
      body: collected.body,
    });
    var idx = Number(card.getAttribute("data-banner-idx"));
    if (j.banner && idx >= 0) heroBannersCache[idx] = j.banner;
    app.renderHeroBannersEditor();
    app.showSuccess(j.message || "تم حفظ البنر");
  } catch (e) {
    app.showError(e.message || "تعذّر الحفظ");
  }
};

app.deleteHeroBannerCard = async function (card) {
  if (!app.hasPermission("dashboard")) return;
  var id = card.getAttribute("data-banner-id");
  if (!id) return;
  if (!window.confirm("حذف هذا البنر؟")) return;
  try {
    await app.PlatformAPI.api("/api/admin/hero-banners/" + id, { method: "DELETE" });
    heroBannersCache = heroBannersCache.filter(function (b) {
      return b.id !== id;
    });
    app.renderHeroBannersEditor();
    app.showSuccess("تم حذف البنر");
  } catch (e) {
    app.showError(e.message || "تعذّر الحذف");
  }
};

app.loadHeroBannersPanel = async function (opts) {
  opts = opts || {};
  var force = !!opts.force;
  if (!app.hasPermission("dashboard")) return;
  var hint = document.getElementById("heroBannersPanelHint");
  if (!force && heroBannersPanelLoaded) {
    if (hint) hint.textContent = heroBannersPanelHintText();
    return;
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/hero-banners");
    heroBannersCache = j.banners || [];
    bannerSpec = j.banner_spec || null;
    targetOptions = j.target_options || j.placement_options || FALLBACK_SECTION_TARGETS.slice();
    statusOptions = j.status_options || [
      { id: "active", label_ar: "نشط" },
      { id: "paused", label_ar: "موقوف" },
      { id: "scheduled", label_ar: "مجدول" },
    ];
    heroBannersPanelLoaded = true;
    app.renderHeroBannersEditor();
    if (hint) hint.textContent = heroBannersPanelHintText();
  } catch (e) {
    if (!targetOptions.length) targetOptions = FALLBACK_SECTION_TARGETS.slice();
    heroBannersPanelLoaded = true;
    if (hint) hint.textContent = (e.message || "تعذّر التحميل") + " — الأقسام الستة معروضة محلياً.";
    app.renderHeroBannersEditor();
  }
};

app.applyHeroBannersPanelVisibility = function () {
  var show = app.hasPermission("dashboard");
  var btn = document.getElementById("panelHeroBannersBtn");
  var panel = document.getElementById("panelHeroBanners");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel) panel.style.display = show ? "" : "none";
};
