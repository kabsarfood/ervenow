/** Admin — عروض بنر منصة ERVENOW */
import { app } from "./shared.js";
import "./api.js";

var offersCache = { enabled: true, slides: [] };

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
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

app.renderOffersEditor = function () {
  var root = document.getElementById("offersEditor");
  if (!root) return;
  var data = offersCache || { enabled: true, slides: [] };
  var slides = Array.isArray(data.slides) ? data.slides : [];
  var html =
    '<label class="finance-feature-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;margin-bottom:10px">' +
    "<span>تفعيل البنر في منصة ERVENOW</span>" +
    '<input type="checkbox" id="offersEnabledToggle" ' +
    (data.enabled !== false ? "checked" : "") +
    " /></label>" +
    '<p class="sub" style="margin:0 0 12px">ارفع صورة <strong>1920×730</strong>، أدخل السعر/العنوان، وحدّد الرابط — تُعرض بـ object-fit: cover في منصة ERVENOW.</p>' +
    '<div id="offersSlidesList"></div>' +
    '<button type="button" class="btn btn-ghost" id="offersAddSlideBtn" style="margin-top:10px">+ إضافة شريحة</button>';
  root.innerHTML = html;
  var list = document.getElementById("offersSlidesList");
  if (!list) return;
  if (!slides.length) {
    list.innerHTML = '<p class="sub">لا توجد شرائح — أضف عرضاً جديداً.</p>';
  } else {
    list.innerHTML = slides
      .map(function (s, idx) {
        return (
          '<div class="item offers-slide-card" data-slide-idx="' +
          idx +
          '">' +
          '<div class="line"><strong>شريحة ' +
          (idx + 1) +
          "</strong></div>" +
          (s.image_url
            ? '<img class="hero-banner-preview" src="' + esc(s.image_url) + '" alt="" />'
            : "") +
          '<label style="display:block;margin:6px 0 2px">العنوان<input class="search-input offers-inp-title" style="width:100%;margin-top:4px" value="' +
          esc(s.title || "") +
          '" /></label>' +
          '<label style="display:block;margin:6px 0 2px">الوصف<input class="search-input offers-inp-subtitle" style="width:100%;margin-top:4px" value="' +
          esc(s.subtitle || "") +
          '" /></label>' +
          '<label style="display:block;margin:6px 0 2px">السعر / التسمية<input class="search-input offers-inp-price" style="width:100%;margin-top:4px" value="' +
          esc(s.price_label || "") +
          '" /></label>' +
          '<label style="display:block;margin:6px 0 2px">نص الزر<input class="search-input offers-inp-cta" style="width:100%;margin-top:4px" value="' +
          esc(s.link_label || "عرض التفاصيل") +
          '" /></label>' +
          '<label style="display:block;margin:6px 0 2px">الرابط<input class="search-input offers-inp-link" style="width:100%;margin-top:4px" dir="ltr" value="' +
          esc(s.link_url || "/browse") +
          '" /></label>' +
          '<label style="display:block;margin:6px 0 2px">صورة (1920×730)<input type="file" accept="image/*" class="offers-inp-file" style="width:100%;margin-top:4px;font-size:16px" /></label>' +
          '<label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" class="offers-inp-active" ' +
          (s.active !== false ? "checked" : "") +
          " /> نشط</label>" +
          '<button type="button" class="btn btn-ghost offers-remove-btn" style="margin-top:8px">حذف الشريحة</button>' +
          "</div>"
        );
      })
      .join("");
  }
  var addBtn = document.getElementById("offersAddSlideBtn");
  if (addBtn) {
    addBtn.onclick = function () {
      offersCache.slides = offersCache.slides || [];
      offersCache.slides.push({
        id: "off-" + Date.now(),
        title: "عرض جديد",
        subtitle: "",
        price_label: "",
        image_url: "",
        link_url: "/browse",
        link_label: "عرض التفاصيل",
        active: true,
        sort_order: offersCache.slides.length,
      });
      app.renderOffersEditor();
    };
  }
  list.querySelectorAll(".offers-remove-btn").forEach(function (btn) {
    btn.onclick = function () {
      var card = btn.closest(".offers-slide-card");
      var idx = card ? Number(card.getAttribute("data-slide-idx")) : -1;
      if (idx >= 0 && offersCache.slides) offersCache.slides.splice(idx, 1);
      app.renderOffersEditor();
    };
  });
};

app.collectOffersFromEditor = async function () {
  var enabledEl = document.getElementById("offersEnabledToggle");
  var cards = document.querySelectorAll(".offers-slide-card");
  var slides = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var idx = Number(card.getAttribute("data-slide-idx"));
    var prev = (offersCache.slides && offersCache.slides[idx]) || {};
    var slide = {
      id: prev.id || "off-" + Date.now() + "-" + i,
      title: (card.querySelector(".offers-inp-title") || {}).value || "",
      subtitle: (card.querySelector(".offers-inp-subtitle") || {}).value || "",
      price_label: (card.querySelector(".offers-inp-price") || {}).value || "",
      link_label: (card.querySelector(".offers-inp-cta") || {}).value || "عرض التفاصيل",
      link_url: (card.querySelector(".offers-inp-link") || {}).value || "/browse",
      image_url: prev.image_url || "",
      active: !!(card.querySelector(".offers-inp-active") || {}).checked,
      sort_order: i,
    };
    var fileInp = card.querySelector(".offers-inp-file");
    if (fileInp && fileInp.files && fileInp.files[0]) {
      slide.imageFileBase64 = await readFileAsDataUrl(fileInp.files[0]);
      slide.imageFileName = fileInp.files[0].name || "offer.jpg";
    }
    slides.push(slide);
  }
  return {
    enabled: enabledEl ? !!enabledEl.checked : true,
    slides: slides,
  };
};

app.loadOffersPanel = async function () {
  if (!app.hasPermission("dashboard")) return;
  var hint = document.getElementById("offersPanelHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/platform-offers");
    offersCache = j.offers || { enabled: true, slides: [] };
    app.renderOffersEditor();
    if (hint) hint.textContent = "GET/POST /api/admin/platform-offers";
  } catch (e) {
    if (hint) hint.textContent = e.message || "تعذّر التحميل";
  }
};

app.saveOffersPanel = async function () {
  if (!app.hasPermission("dashboard")) return;
  try {
    var body = await app.collectOffersFromEditor();
    var j = await app.PlatformAPI.api("/api/admin/platform-offers", { method: "POST", body: { offers: body } });
    offersCache = j.offers || body;
    app.renderOffersEditor();
    app.showSuccess(j.message || "تم حفظ العروض");
  } catch (e) {
    app.showError(e.message || "تعذّر الحفظ");
  }
};

app.applyOffersPanelVisibility = function () {
  var show = app.hasPermission("dashboard");
  var btn = document.getElementById("panelOffersBtn");
  var panel = document.getElementById("panelOffers");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel && !show) panel.style.display = "none";
};
