/** Admin Dashboard — panels */
import { app } from "./shared.js";
import "./api.js";

app.loadNotifications = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/driver-notifications");
    app.cacheNotifications = j.items || [];
    app.setBadge("badgeNotifications", app.cacheNotifications.length);
    app.renderNotifications();
  } catch (e) {
    app.showError(e.message || "فشل تحميل الإشعارات");
  }
}

app.renderNotifications = function () {
  var root = document.getElementById("notifications");
  if (!root) return;
  var q = app.getSearch("searchNotifications");
  var rows = app.cacheNotifications.filter(function (n) {
    return app.hasQueryMatch(q, [n.phone, n.driver_name, n.status, n.note, n.order_id, n.order_number]);
  });
  if (!rows.length) {
    root.innerHTML = '<div class="item">لا توجد إشعارات مطابقة</div>';
    return;
  }
  root.innerHTML = rows
    .map(function (n) {
      var st = String(n.status || "").toLowerCase();
      var stLabel = st === "sent" ? "تم الإرسال" : st === "failed" ? "فشل" : st || "—";
      var retry = Number(n.retry_count || 0);
      return (
        '<div class="item">' +
        '<div class="line"><strong>' + (n.phone || "—") + "</strong></div>" +
        '<div class="line">الحالة: <span class="badge">' + stLabel + "</span></div>" +
        '<div class="line">إعادات المحاولة: ' + retry + "</div>" +
        '<div class="line">الطلب: ' + (n.order_id || n.order_number || "—") + "</div>" +
        '<div class="muted">' + app.fmtWhen(n.created_at) + "</div>" +
        "</div>"
      );
    })
    .join("");
}

app.loadCustomers = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/customers");
    app.cacheCustomers = j.customers || [];
    app.setBadge("badgeCustomers", app.cacheCustomers.length);
    app.renderCustomers();
  } catch (e) {
    app.showError(e.message || "فشل تحميل العملاء");
  }
}

app.renderCustomers = function () {
  var list = document.getElementById("customersList");
  if (!list) return;
  var q = app.getSearch("searchCustomers");
  var rows = app.cacheCustomers.filter(function (u) {
    return app.hasQueryMatch(q, [u.name, u.phone, u.status, u.role]);
  });
  list.innerHTML = "";
  rows.forEach(function (u) {
    var item = document.createElement("div");
    item.className = "item";
    var status = String(u.status || "active").toLowerCase();
    var blocked = status === "blocked";
    item.innerHTML =
      "<strong>" + (u.name || "زائر المنصة") + "</strong>" +
      "<div>الجوال: " + (u.phone || "—") + "</div>" +
      "<div>الحالة: " + (blocked ? "محظور" : "نشط") + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    row.appendChild(app.mkAction("حظر", "btn-ghost", app.safeClick(async function () {
      try { await app.PlatformAPI.api("/api/admin/block-customer", { method: "POST", body: { id: u.id } }); app.showSuccess("تم حظر حساب زائر المنصة"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
    })));
    row.appendChild(app.mkAction("تفعيل", "btn-primary", app.safeClick(async function () {
      try { await app.PlatformAPI.api("/api/admin/activate-customer", { method: "POST", body: { id: u.id } }); app.showSuccess("تم تفعيل حساب زائر المنصة"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
    })));
    item.appendChild(row);
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا يوجد عملاء مطابقون</div>';
}

app.loadStores = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/store-requests");
    app.cacheStores = j.requests || [];
    var pending = 0;
    app.cacheStores.forEach(function (s) {
      if (String(s.status || "").toLowerCase() === "pending") pending += 1;
    });
    app.setBadge("badgeStores", pending);
    app.renderStores();
  } catch (e) {
    app.showError(e.message || "فشل تحميل بوابة المتاجر");
  }
}

app.renderStores = function () {
  var list = document.getElementById("storesList");
  if (!list) return;
  var q = app.getSearch("searchStores");
  var rows = app.cacheStores.filter(function (s) {
    return app.hasQueryMatch(q, [s.name, s.phone, s.type, s.status]);
  });
  list.innerHTML = "";
  rows.forEach(function (s) {
    var item = document.createElement("div");
    item.className = "item";
    item.innerHTML =
      "<strong>" + (s.name || "—") + "</strong>" +
      "<div>الجوال: " + (s.phone || "—") + "</div>" +
      "<div>النوع: " + (s.type || "—") + "</div>" +
      "<div>الحالة: " + (s.status || "pending") + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    row.appendChild(app.mkAction("قبول", "btn-primary", app.safeClick(async function () {
      try {
        var res = await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(s.id), {
          method: "PATCH",
          body: { action: "approve" },
        });
        var panel = (res && res.merchant_panel_url) || "/store-dashboard";
        app.showSuccess(
          "تم قبول المتجر. لوحة التحكم للتاجر: " + panel + " (دخول كتاجر بنفس الجوال)"
        );
        app.loadStores();
      } catch (e) { app.showError(e.message || "فشل"); }
    })));
    if (String(s.status || "").toLowerCase() === "approved") {
      var panelNote = document.createElement("div");
      panelNote.className = "sub";
      panelNote.style.marginTop = "6px";
      panelNote.innerHTML =
        'لوحة التحكم: <a href="/store-dashboard" target="_blank" rel="noopener">/store-dashboard</a> · ' +
        '<a href="/store.html?id=' + encodeURIComponent(s.id) + '" target="_blank" rel="noopener">صفحة العملاء</a>';
      item.appendChild(panelNote);
    }
    row.appendChild(app.mkAction("رفض", "btn-ghost", app.safeClick(async function () {
      try {
        await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(s.id), {
          method: "PATCH",
          body: { action: "reject" },
        });
        app.showSuccess("تم رفض المتجر");
        app.loadStores();
      } catch (e) { app.showError(e.message || "فشل"); }
    })));
    item.appendChild(row);
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا توجد طلبات متاجر مطابقة</div>';
}

app.loadJobs = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/job-applications");
    app.cacheJobs = j.applications || [];
    var pending = 0;
    app.cacheJobs.forEach(function (r) {
      if (String(r.status || "").toLowerCase() === "pending") pending += 1;
    });
    app.setBadge("badgeJobs", pending);
    app.renderJobs();
  } catch (e) {
    app.showError(e.message || "فشل تحميل بوابة التوظيف");
  }
}

app.renderJobs = function () {
  var list = document.getElementById("jobsList");
  if (!list) return;
  var q = app.getSearch("searchJobs");
  var rows = app.cacheJobs.filter(function (r) {
    return app.hasQueryMatch(q, [r.name, r.phone, r.city, r.role_wanted, r.status, r.note]);
  });
  list.innerHTML = "";
  rows.forEach(function (r) {
    var item = document.createElement("div");
    item.className = "item";
    item.innerHTML =
      "<strong>" + (r.name || "—") + "</strong>" +
      "<div>الجوال: " + (r.phone || "—") + "</div>" +
      "<div>المدينة: " + (r.city || "—") + "</div>" +
      "<div>الوظيفة: " + (r.role_wanted || "—") + "</div>" +
      "<div>الحالة: " + (r.status || "pending") + "</div>" +
      "<div>نبذة: " + (r.note || "—") + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    row.appendChild(app.mkAction("قبول", "btn-primary", app.safeClick(async function () {
      try {
        await app.PlatformAPI.api("/api/admin/job-applications/" + encodeURIComponent(r.id) + "/decision", {
          method: "POST",
          body: { action: "approve" },
        });
        app.showSuccess("تم قبول المتقدم");
        app.loadJobs();
      } catch (e) { app.showError(e.message || "فشل"); }
    })));
    row.appendChild(app.mkAction("رفض", "btn-ghost", app.safeClick(async function () {
      try {
        await app.PlatformAPI.api("/api/admin/job-applications/" + encodeURIComponent(r.id) + "/decision", {
          method: "POST",
          body: { action: "reject" },
        });
        app.showSuccess("تم رفض المتقدم");
        app.loadJobs();
      } catch (e) { app.showError(e.message || "فشل"); }
    })));
    item.appendChild(row);
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا توجد طلبات توظيف مطابقة</div>';
}

app.loadComplaints = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/complaints");
    app.cacheComplaints = j.complaints || [];
    var openCount = 0;
    app.cacheComplaints.forEach(function (c) {
      if (String(c.status || "").toLowerCase() !== "resolved") openCount += 1;
    });
    app.setBadge("badgeComplaints", openCount);
    app.renderComplaints();
  } catch (e) {
    app.showError(e.message || "فشل تحميل الشكاوى");
  }
}

app.renderComplaints = function () {
  var list = document.getElementById("complaintsList");
  if (!list) return;
  var q = app.getSearch("searchComplaints");
  var rows = app.cacheComplaints.filter(function (c) {
    return app.hasQueryMatch(q, [c.name, c.phone, c.order_id, c.message, c.status]);
  });
  list.innerHTML = "";
  rows.forEach(function (c) {
    var item = document.createElement("div");
    item.className = "item";
    item.innerHTML =
      "<div><strong>الطلب:</strong> " + (c.order_id || "—") + "</div>" +
      "<div><strong>النص:</strong> " + (c.message || "—") + "</div>" +
      "<div><strong>الحالة:</strong> " + (c.status || "open") + "</div>";
    if (c.status !== "resolved") {
      var row = document.createElement("div");
      row.className = "row";
      row.appendChild(app.mkAction("تم الحل", "btn-primary", app.safeClick(async function () {
        try {
          await app.PlatformAPI.api("/api/admin/resolve-complaint", {
            method: "POST",
            body: { id: c.id },
          });
          app.showSuccess("تم إغلاق الشكوى");
          app.loadComplaints();
        } catch (e) {
          app.showError(e.message || "فشل تحديث الشكوى");
        }
      })));
      item.appendChild(row);
    }
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا توجد شكاوى مطابقة</div>';
}
