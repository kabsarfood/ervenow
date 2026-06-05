/** Admin — إدارة بنرات الصفحة الرئيسية */
import { app } from "./shared.js";
import "./api.js";

var heroBannersCache = [];

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
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

function bannerCard(b, idx) {
  var id = b.id || "";
  return (
    '<div class="item hero-banner-card" data-banner-id="' +
    esc(id) +
    '" data-banner-idx="' +
    idx +
    '">' +
    '<div class="line"><strong>بنر #' +
    (idx + 1) +
    "</strong> — ترتيب " +
    esc(String(b.sort_order != null ? b.sort_order : 0)) +
    "</div>" +
    (b.image_url
      ? '<img src="' +
        esc(b.image_url) +
        '" alt="" style="width:100%;max-height:140px;object-fit:cover;border-radius:10px;margin:8px 0" />'
      : '<p class="sub" style="margin:8px 0">لا توجد صورة بعد</p>') +
    '<label style="display:block;margin:6px 0 2px">العنوان الرئيسي<input class="search-input hb-inp-title" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(b.title || "") +
    '" placeholder="سطر1|سطر2 مميز" /></label>' +
    '<label style="display:block;margin:6px 0 2px">وصف مختصر<textarea class="search-input hb-inp-desc" rows="2" style="width:100%;margin-top:4px;font-size:16px">' +
    esc(b.description || "") +
    "</textarea></label>" +
    '<label style="display:block;margin:6px 0 2px">نص الزر الأول<input class="search-input hb-inp-btn1-text" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(b.button1_text || "") +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">رابط الزر الأول<input class="search-input hb-inp-btn1-url" style="width:100%;margin-top:4px;font-size:16px" dir="ltr" value="' +
    esc(b.button1_url || "") +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">نص الزر الثاني<input class="search-input hb-inp-btn2-text" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(b.button2_text || "") +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">رابط الزر الثاني<input class="search-input hb-inp-btn2-url" style="width:100%;margin-top:4px;font-size:16px" dir="ltr" value="' +
    esc(b.button2_url || "") +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">ترتيب العرض<input type="number" class="search-input hb-inp-sort" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(String(b.sort_order != null ? b.sort_order : 0)) +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">تاريخ البداية<input type="datetime-local" class="search-input hb-inp-starts" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(toLocalInputValue(b.starts_at)) +
    '" /></label>' +
    '<label style="display:block;margin:6px 0 2px">تاريخ النهاية<input type="datetime-local" class="search-input hb-inp-ends" style="width:100%;margin-top:4px;font-size:16px" value="' +
    esc(toLocalInputValue(b.ends_at)) +
    '" /></label>' +
    '<label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" class="hb-inp-active" ' +
    (b.is_active !== false ? "checked" : "") +
    " /> مفعّل</label>" +
    '<label style="display:block;margin:6px 0 2px">صورة جديدة<input type="file" accept="image/*" class="hb-inp-file" style="width:100%;margin-top:4px;font-size:16px" /></label>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
    '<button type="button" class="btn btn-primary hb-save-btn">حفظ</button>' +
    '<button type="button" class="btn btn-ghost hb-delete-btn">حذف</button>' +
    "</div>" +
    "</div>"
  );
}

app.renderHeroBannersEditor = function () {
  var root = document.getElementById("heroBannersEditor");
  if (!root) return;
  var rows = Array.isArray(heroBannersCache) ? heroBannersCache : [];
  var html =
    '<p class="sub" style="margin:0 0 12px">يُعرض على الصفحة الرئيسية أول بنر مفعّل حسب الترتيب ضمن فترة الجدولة. استخدم <code>|</code> في العنوان لفصل السطر المميز.</p>' +
    '<div id="heroBannersList"></div>' +
    '<button type="button" class="btn btn-ghost" id="heroBannersAddBtn" style="margin-top:10px">+ إضافة بنر</button>';
  root.innerHTML = html;
  var list = document.getElementById("heroBannersList");
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<p class="sub">لا توجد بنرات — أضف بنراً جديداً.</p>';
  } else {
    list.innerHTML = rows.map(bannerCard).join("");
  }
  var addBtn = document.getElementById("heroBannersAddBtn");
  if (addBtn) {
    addBtn.onclick = function () {
      app.createHeroBannerDraft();
    };
  }
  list.querySelectorAll(".hb-save-btn").forEach(function (btn) {
    btn.onclick = function () {
      var card = btn.closest(".hero-banner-card");
      if (card) app.saveHeroBannerCard(card);
    };
  });
  list.querySelectorAll(".hb-delete-btn").forEach(function (btn) {
    btn.onclick = function () {
      var card = btn.closest(".hero-banner-card");
      if (card) app.deleteHeroBannerCard(card);
    };
  });
};

app.collectHeroBannerFromCard = async function (card) {
  var id = card.getAttribute("data-banner-id") || "";
  var idx = Number(card.getAttribute("data-banner-idx"));
  var prev = heroBannersCache[idx] || {};
  var startsVal = (card.querySelector(".hb-inp-starts") || {}).value || "";
  var endsVal = (card.querySelector(".hb-inp-ends") || {}).value || "";
  var body = {
    title: (card.querySelector(".hb-inp-title") || {}).value || "",
    description: (card.querySelector(".hb-inp-desc") || {}).value || "",
    button1_text: (card.querySelector(".hb-inp-btn1-text") || {}).value || "",
    button1_url: (card.querySelector(".hb-inp-btn1-url") || {}).value || "",
    button2_text: (card.querySelector(".hb-inp-btn2-text") || {}).value || "",
    button2_url: (card.querySelector(".hb-inp-btn2-url") || {}).value || "",
    sort_order: Number((card.querySelector(".hb-inp-sort") || {}).value || 0),
    is_active: !!(card.querySelector(".hb-inp-active") || {}).checked,
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

app.createHeroBannerDraft = async function () {
  if (!app.hasPermission("dashboard")) return;
  try {
    var body = {
      title: "عنوان البنر|السطر المميز",
      description: "وصف مختصر للبنر",
      button1_text: "اطلب الآن",
      button1_url: "/start-now",
      button2_text: "",
      button2_url: "",
      sort_order: heroBannersCache.length,
      is_active: false,
    };
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

app.loadHeroBannersPanel = async function () {
  if (!app.hasPermission("dashboard")) return;
  var hint = document.getElementById("heroBannersPanelHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/hero-banners");
    heroBannersCache = j.banners || [];
    app.renderHeroBannersEditor();
    if (hint) hint.textContent = "GET/POST/PUT/DELETE /api/admin/hero-banners";
  } catch (e) {
    if (hint) hint.textContent = e.message || "تعذّر التحميل";
  }
};

app.applyHeroBannersPanelVisibility = function () {
  var show = app.hasPermission("dashboard");
  var btn = document.getElementById("panelHeroBannersBtn");
  var panel = document.getElementById("panelHeroBanners");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel && !show) panel.style.display = "none";
};
