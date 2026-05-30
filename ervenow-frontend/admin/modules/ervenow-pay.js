/** Admin Dashboard — ERVENOW PAY (شحن STC + أكواد) */
import { app } from "./shared.js";
import "./api.js";

var ervPaySettingsCache = null;

function esc(s) {
  if (s == null || s === "") return "—";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
  } catch (_e) {
    return String(iso);
  }
}

function statusLabel(st) {
  var s = String(st || "").toLowerCase();
  if (s === "pending") return "قيد المراجعة";
  if (s === "approved") return "مقبول";
  if (s === "rejected") return "مرفوض";
  return s || "—";
}

app.renderErvenowPaySettingsForm = function (settings) {
  var root = document.getElementById("ervenowPaySettingsForm");
  if (!root) return;
  var s = settings || {};
  var toggles = [
    { key: "wallet_topup_enabled", label: "تفعيل الشحن" },
    { key: "wallet_withdraw_enabled", label: "تفعيل السحب" },
    { key: "wallet_transfer_enabled", label: "تفعيل التحويل" },
    { key: "payment_gateways_enabled", label: "تفعيل بوابات الدفع" },
    { key: "stcpay_enabled", label: "STC Pay" },
    { key: "mada_enabled", label: "مدى" },
    { key: "visa_enabled", label: "Visa" },
  ];
  var html = toggles
    .map(function (t) {
      var on = s[t.key] === true;
      return (
        '<label class="finance-feature-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0">' +
        "<span>" +
        esc(t.label) +
        "</span>" +
        '<input type="checkbox" data-pay-key="' +
        esc(t.key) +
        '" ' +
        (on ? "checked" : "") +
        " />" +
        "</label>"
      );
    })
    .join("");
  html +=
    '<div style="display:grid;gap:10px;margin-top:12px;grid-template-columns:1fr 1fr">' +
    '<label>الحد الأدنى (ر.س)<input type="number" id="paySettingMinTopup" min="1" value="' +
    esc(String(s.min_topup_amount != null ? s.min_topup_amount : 30)) +
    '" class="search-input" style="width:100%;margin-top:4px" /></label>' +
    '<label>الحد الأعلى (ر.س)<input type="number" id="paySettingMaxTopup" min="1" value="' +
    esc(String(s.max_topup_amount != null ? s.max_topup_amount : 5000)) +
    '" class="search-input" style="width:100%;margin-top:4px" /></label>' +
    '</div><label style="display:block;margin-top:10px">رقم STC Pay للعرض<input type="text" id="paySettingStcNumber" value="' +
    esc(s.stcpay_display_number || "") +
    '" class="search-input" style="width:100%;margin-top:4px" dir="ltr" /></label>';
  root.innerHTML = html;
};

app.collectErvenowPaySettingsFromForm = function () {
  var root = document.getElementById("ervenowPaySettingsForm");
  var out = {};
  if (root) {
    root.querySelectorAll("input[data-pay-key]").forEach(function (inp) {
      out[inp.getAttribute("data-pay-key")] = inp.checked ? "true" : "false";
    });
  }
  var minEl = document.getElementById("paySettingMinTopup");
  var maxEl = document.getElementById("paySettingMaxTopup");
  var stcEl = document.getElementById("paySettingStcNumber");
  if (minEl) out.min_topup_amount = String(minEl.value || "30");
  if (maxEl) out.max_topup_amount = String(maxEl.value || "5000");
  if (stcEl) out.stcpay_display_number = String(stcEl.value || "").trim();
  return out;
};

app.loadErvenowPaySettings = async function () {
  var hint = document.getElementById("ervenowPaySettingsHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/pay-settings");
    ervPaySettingsCache = j.settings || j;
    app.renderErvenowPaySettingsForm(ervPaySettingsCache);
    if (hint) hint.textContent = "GET/POST /api/admin/pay-settings";
  } catch (e) {
    if (hint) hint.textContent = e.message || "تعذّر تحميل الإعدادات";
  }
};

app.saveErvenowPaySettings = async function () {
  if (!app.hasPermission("finance")) return;
  try {
    var body = app.collectErvenowPaySettingsFromForm();
    var j = await app.PlatformAPI.api("/api/admin/pay-settings", { method: "POST", body: body });
    ervPaySettingsCache = j.settings || j;
    app.renderErvenowPaySettingsForm(ervPaySettingsCache);
    app.showSuccess(j.message || "تم حفظ الإعدادات");
  } catch (e) {
    app.showError(e.message || "تعذّر الحفظ");
  }
};

app.renderTopupRequestsTable = function (rows) {
  var body = document.getElementById("topupRequestsBody");
  if (!body) return;
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="finance-msg">لا توجد طلبات</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(function (r) {
      var st = String(r.status || "").toLowerCase();
      var actions =
        st === "pending"
          ? '<button type="button" class="btn btn-primary btn-sm topup-approve-btn" data-id="' +
            esc(r.id) +
            '">قبول</button> ' +
            '<button type="button" class="btn btn-ghost btn-sm topup-reject-btn" data-id="' +
            esc(r.id) +
            '">رفض</button>'
          : "—";
      return (
        "<tr>" +
        "<td dir=\"ltr\">" +
        esc(r.phone) +
        "</td>" +
        "<td>" +
        app.fmtMoney(r.amount) +
        "</td>" +
        "<td>" +
        esc(statusLabel(r.status)) +
        "</td>" +
        "<td>" +
        esc(fmtWhen(r.created_at)) +
        "</td>" +
        "<td>" +
        actions +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
  body.querySelectorAll(".topup-approve-btn").forEach(function (btn) {
    btn.onclick = app.safeClick(async function () {
      var id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("تأكيد قبول الطلب وإرسال كود واتساب؟")) return;
      try {
        var j = await app.PlatformAPI.api("/api/admin/topup-approve/" + encodeURIComponent(id), {
          method: "POST",
          body: {},
        });
        app.showSuccess(j.message || "تمت الموافقة");
        if (j.code && !j.whatsapp_sent) {
          app.showError("الكود: " + j.code + " — لم يُرسل واتساب تلقائياً");
        }
        await app.loadErvenowPayPanel();
      } catch (e) {
        app.showError(e.message || "فشل القبول");
      }
    });
  });
  body.querySelectorAll(".topup-reject-btn").forEach(function (btn) {
    btn.onclick = app.safeClick(async function () {
      var id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("رفض طلب الشحن؟")) return;
      try {
        await app.PlatformAPI.api("/api/admin/topup-reject/" + encodeURIComponent(id), {
          method: "POST",
          body: {},
        });
        app.showSuccess("تم الرفض");
        await app.loadErvenowPayPanel();
      } catch (e) {
        app.showError(e.message || "فشل الرفض");
      }
    });
  });
};

app.renderTopupCodesTable = function (rows) {
  var body = document.getElementById("topupCodesBody");
  if (!body) return;
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="finance-msg">لا توجد أكواد</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map(function (c) {
      var used = c.is_used === true;
      return (
        "<tr>" +
        '<td dir="ltr"><strong>' +
        esc(c.code) +
        "</strong></td>" +
        "<td>" +
        app.fmtMoney(c.amount) +
        "</td>" +
        '<td dir="ltr">' +
        esc(c.phone) +
        "</td>" +
        "<td>" +
        (used ? "مستخدم" : "غير مستخدم") +
        "</td>" +
        "<td>" +
        esc(fmtWhen(c.expires_at)) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
};

app.updateTopupPendingBadge = function (rows) {
  var n = (rows || []).filter(function (r) {
    return String(r.status || "").toLowerCase() === "pending";
  }).length;
  app.setBadge("badgeTopupPending", n);
};

app.loadErvenowPayPanel = async function () {
  if (!app.hasPermission("finance")) return;
  try {
    var reqs = await app.PlatformAPI.api("/api/admin/topup-requests");
    var codes = await app.PlatformAPI.api("/api/admin/topup-codes");
    var list = reqs.requests || [];
    app.renderTopupRequestsTable(list);
    app.renderTopupCodesTable(codes.codes || []);
    app.updateTopupPendingBadge(list);
    await app.loadErvenowPaySettings();
  } catch (e) {
    var rb = document.getElementById("topupRequestsBody");
    if (rb) rb.innerHTML = '<tr><td colspan="5" class="finance-msg">' + esc(e.message || "خطأ") + "</td></tr>";
  }
};

app.applyErvenowPayVisibility = function () {
  var show = app.hasPermission("finance");
  var btn = document.getElementById("panelErvenowPayBtn");
  var panel = document.getElementById("panelErvenowPay");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel && !show) panel.style.display = "none";
};
