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
    var pending = status === "pending";
    var rejected = status === "rejected";
    var stLabel = blocked ? "محظور" : pending ? "بانتظار الموافقة" : rejected ? "مرفوض" : "معتمد";
    item.innerHTML =
      "<strong>" + (u.name || "زائر المنصة") + "</strong>" +
      "<div>رقم الجوال: " + (u.phone || "—") + "</div>" +
      "<div>تاريخ التسجيل: " + app.fmtWhen(u.created_at) + "</div>" +
      "<div>نوع الحساب: متسوق</div>" +
      "<div>حالة الحساب: " + stLabel + "</div>" +
      "<div>آخر نشاط: " + app.fmtWhen(u.updated_at || u.created_at) + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    if (pending) {
      row.appendChild(app.mkAction("✅ اعتماد", "btn-primary", app.safeClick(async function () {
        try { await app.PlatformAPI.api("/api/admin/activate-customer", { method: "POST", body: { id: u.id } }); app.showSuccess("تم اعتماد المتسوق"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
      row.appendChild(app.mkAction("❌ رفض", "btn-ghost", app.safeClick(async function () {
        try { await app.PlatformAPI.api("/api/admin/reject-user", { method: "POST", body: { id: u.id } }); app.showSuccess("تم الرفض"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    } else if (!blocked && !rejected) {
      row.appendChild(app.mkAction("حظر", "btn-ghost", app.safeClick(async function () {
        try { await app.PlatformAPI.api("/api/admin/block-customer", { method: "POST", body: { id: u.id } }); app.showSuccess("تم حظر حساب زائر المنصة"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    } else {
      row.appendChild(app.mkAction("تفعيل", "btn-primary", app.safeClick(async function () {
        try { await app.PlatformAPI.api("/api/admin/activate-customer", { method: "POST", body: { id: u.id } }); app.showSuccess("تم تفعيل حساب زائر المنصة"); app.loadCustomers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    }
    row.appendChild(app.mkAction("👁️ عرض التفاصيل", "btn-ghost", app.safeClick(function () {
      alert(
        "الاسم: " + (u.name || "—") + "\nالجوال: " + (u.phone || "—") + "\nالحالة: " + stLabel + "\nتاريخ التسجيل: " + app.fmtWhen(u.created_at)
      );
    })));
    var wa = document.createElement("a");
    wa.className = "btn btn-ghost";
    wa.href = "https://wa.me/" + String(u.phone || "").replace(/\D/g, "").replace(/^05/, "9665").replace(/^5(\d{8})$/, "9665$1");
    wa.target = "_blank";
    wa.rel = "noopener";
    wa.textContent = "📞 تواصل";
    row.appendChild(wa);
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
      "<div>رقم الجوال: " + (s.phone || "—") + "</div>" +
      "<div>تاريخ التسجيل: " + app.fmtWhen(s.created_at) + "</div>" +
      "<div>نوع الحساب: " + (s.type || "متجر") + "</div>" +
      "<div>حالة الحساب: " + (s.status || "pending") + "</div>" +
      "<div>آخر نشاط: " + app.fmtWhen(s.updated_at || s.created_at) + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    row.appendChild(app.mkAction("تعديل", "btn-ghost", app.safeClick(function () {
      app.openStoreSetup(s.id);
    })));
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

var __storeSetupRestaurantOptions = [];

app.closeStoreSetup = function () {
  var bd = document.getElementById("storeSetupBackdrop");
  if (bd) bd.hidden = true;
};

app.fillStoreSetupCategorySelect = function (type, current) {
  var sel = document.getElementById("storeSetupCategory");
  var wrap = document.getElementById("storeSetupCatWrap");
  if (!sel || !wrap) return;
  var t = String(type || "").toLowerCase();
  sel.innerHTML = '<option value="">— بدون —</option>';
  var lbl = document.getElementById("storeSetupCatLabel");
  if (lbl) lbl.textContent = t === "restaurant" ? "تصنيف المطعم" : "قسم البقالة / المتجر";
  if (t === "restaurant") {
    __storeSetupRestaurantOptions.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.slug;
      opt.textContent = (o.label || o.slug);
      sel.appendChild(opt);
    });
  } else {
    var marketOpts = [
      ["vegetables", "خضار وفواكه"],
      ["meat", "لحوم"],
      ["dairy", "ألبان"],
      ["bakery", "مخبوزات"],
      ["drinks", "مشروبات"],
      ["snacks", "سناكات"],
      ["frozen", "مجمدات"],
      ["cleaning", "منظفات"],
    ];
    marketOpts.forEach(function (pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      sel.appendChild(opt);
    });
  }
  if (current) sel.value = String(current);
};

app.openStoreSetup = async function (storeId) {
  var bd = document.getElementById("storeSetupBackdrop");
  if (!bd || !storeId) return;
  try {
    var j = await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(storeId) + "/setup");
    var st = j.store || {};
    __storeSetupRestaurantOptions = j.restaurant_category_options || [];
    document.getElementById("storeSetupId").value = st.id || storeId;
    document.getElementById("storeSetupName").value = st.name || "";
    document.getElementById("storeSetupPhone").value = st.phone || "";
    document.getElementById("storeSetupType").value = st.type || "restaurant";
    document.getElementById("storeSetupLocation").value = st.location_text || "";
    document.getElementById("storeSetupAddress").value = st.address || "";
    document.getElementById("storeSetupBio").value = (j.merchant_hub && j.merchant_hub.bio) || "";
    var sub = document.getElementById("storeSetupSubtitle");
    if (sub) {
      sub.textContent =
        "الحالة: " +
        (st.status || "pending") +
        " — يمكنك إعداد الصفحة للتاجر غير المتمرس ثم الاعتماد.";
    }
    var links = document.getElementById("storeSetupLinks");
    if (links) {
      var pub = j.public_store_url || (st.id ? "/store.html?id=" + encodeURIComponent(st.id) : "/stores");
      links.innerHTML =
        '<a href="' +
        pub +
        '" target="_blank" rel="noopener">معاينة صفحة العملاء</a> · ' +
        '<a href="/store-dashboard" target="_blank" rel="noopener">لوحة التاجر</a>';
    }
    var prev = document.getElementById("storeSetupPreview");
    if (prev) {
      var bits = [];
      if (st.logo_url) bits.push("شعار: مرفوع");
      if (j.merchant_hub && j.merchant_hub.banner_url) bits.push("غلاف: مرفوع");
      prev.textContent = bits.length ? bits.join(" · ") : "لم يُرفع شعار/غلاف بعد — أضفهما أدناه.";
    }
    app.fillStoreSetupCategorySelect(st.type, st.category || "");
    var approveBtn = document.getElementById("storeSetupSaveApproveBtn");
    if (approveBtn) {
      approveBtn.style.display =
        String(st.status || "").toLowerCase() === "approved" ? "none" : "inline-flex";
    }
    document.getElementById("storeSetupLogo").value = "";
    document.getElementById("storeSetupBanner").value = "";
    bd.hidden = false;
  } catch (e) {
    app.showError(e.message || "تعذر تحميل بيانات المتجر");
  }
};

app.saveStoreSetup = async function (approveAfter) {
  var id = document.getElementById("storeSetupId").value.trim();
  if (!id) return;
  var body = {
    name: document.getElementById("storeSetupName").value.trim(),
    type: document.getElementById("storeSetupType").value,
    location_text: document.getElementById("storeSetupLocation").value.trim(),
    address: document.getElementById("storeSetupAddress").value.trim(),
    bio: document.getElementById("storeSetupBio").value.trim(),
  };
  var cat = document.getElementById("storeSetupCategory").value.trim();
  if (body.type === "restaurant") body.restaurant_category = cat || null;
  else body.category = cat || null;
  if (approveAfter) body.approve = true;

  var logoF = document.getElementById("storeSetupLogo").files && document.getElementById("storeSetupLogo").files[0];
  var bannerF =
    document.getElementById("storeSetupBanner").files && document.getElementById("storeSetupBanner").files[0];
  try {
    if (logoF && window.compressImageToDataUrl) {
      body.logo_base64 = await window.compressImageToDataUrl(logoF, 0.72, 1280);
      body.logo_file_name = logoF.name || "logo.jpg";
    } else if (logoF) {
      body.logo_base64 = await new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () {
          res(r.result);
        };
        r.onerror = rej;
        r.readAsDataURL(logoF);
      });
      body.logo_file_name = logoF.name || "logo.jpg";
    }
    if (bannerF && window.compressImageToDataUrl) {
      body.banner_base64 = await window.compressImageToDataUrl(bannerF, 0.72, 1600);
      body.banner_file_name = bannerF.name || "banner.jpg";
    } else if (bannerF) {
      body.banner_base64 = await new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () {
          res(r.result);
        };
        r.onerror = rej;
        r.readAsDataURL(bannerF);
      });
      body.banner_file_name = bannerF.name || "banner.jpg";
    }
    var j = await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(id) + "/setup", {
      method: "PUT",
      body: body,
    });
    app.showSuccess(j.message || (approveAfter ? "تم الحفظ والاعتماد" : "تم الحفظ"));
    app.closeStoreSetup();
    app.loadStores();
  } catch (e) {
    app.showError(e.message || "فشل الحفظ");
  }
};

(function wireStoreSetupModal() {
  var bd = document.getElementById("storeSetupBackdrop");
  if (!bd) return;
  document.getElementById("storeSetupCloseBtn").onclick = app.closeStoreSetup;
  bd.addEventListener("click", function (ev) {
    if (ev.target === bd) app.closeStoreSetup();
  });
  document.getElementById("storeSetupSaveBtn").onclick = app.safeClick(function () {
    return app.saveStoreSetup(false);
  });
  document.getElementById("storeSetupSaveApproveBtn").onclick = app.safeClick(function () {
    if (!confirm("حفظ الصفحة واعتماد المتجر على الموقع؟")) return;
    return app.saveStoreSetup(true);
  });
  var typeEl = document.getElementById("storeSetupType");
  if (typeEl) {
    typeEl.onchange = function () {
      app.fillStoreSetupCategorySelect(typeEl.value, "");
    };
  }
})();

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
