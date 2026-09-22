/** لوحة موحدة لموافقات التسجيل */
import { app } from "./shared.js";
import "./api.js";

app.cacheApprovals = [];
app.approvalsFilterType = "all";
app.approvalsFilterStatus = "all";

app.loadApprovalsPanel = async function () {
  try {
    var q =
      "/api/admin/registration-approvals?type=" +
      encodeURIComponent(app.approvalsFilterType || "all") +
      "&status=" +
      encodeURIComponent(app.approvalsFilterStatus || "all");
    var j = await app.PlatformAPI.api(q);
    app.cacheApprovals = j.items || [];
    app.renderApprovalsSummary(j.summary || {});
    app.renderApprovalsList();
    var pending = Number((j.summary && j.summary.in_review) || 0);
    app.setBadge("badgeApprovals", pending);
  } catch (e) {
    app.showError(e.message || "فشل تحميل موافقات التسجيل");
  }
};

app.renderApprovalsSummary = function (s) {
  var map = {
    approvalsStatNew: s.new_requests,
    approvalsStatReview: s.in_review,
    approvalsStatApproved: s.approved,
    approvalsStatRejected: s.rejected,
  };
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = map[id] != null ? String(map[id]) : "0";
  });
};

function waContactHref(phone) {
  var d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
  if (d.startsWith("5") && d.length === 9) d = "966" + d;
  return d ? "https://wa.me/" + d : "#";
}

function statusLabelAr(st, approved) {
  var s = String(st || "").toLowerCase();
  if (approved || s === "active" || s === "approved") return "معتمد";
  if (s === "needs_info") return "استكمال بيانات";
  if (s === "pending") return "بانتظار الموافقة";
  if (s === "rejected") return "مرفوض";
  if (s === "blocked") return "محظور";
  return st || "—";
}

app.approveRegistrationItem = async function (item) {
  if (!item || !item.id) return;
  try {
    if (item.kind === "store") {
      await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(item.id), {
        method: "PATCH",
        body: { action: "approve" },
      });
    } else if (item.kind === "driver") {
      await app.PlatformAPI.api("/api/admin/approve-driver", { method: "POST", body: { id: item.id } });
    } else if (item.kind === "user") {
      await app.PlatformAPI.api("/api/admin/activate-customer", {
        method: "POST",
        body: { id: item.id, role: item.role },
      });
    }
    app.showSuccess("تم الاعتماد");
    await app.loadApprovalsPanel();
  } catch (e) {
    app.showError(e.message || "فشل الاعتماد");
  }
};

app.rejectRegistrationItem = async function (item) {
  if (!item || !item.id) return;
  if (!confirm("رفض هذا الطلب؟")) return;
  try {
    if (item.kind === "store") {
      await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(item.id), {
        method: "PATCH",
        body: { action: "reject" },
      });
    } else if (item.kind === "driver") {
      await app.PlatformAPI.api("/api/admin/reject-driver", { method: "POST", body: { id: item.id } });
    } else if (item.kind === "user") {
      await app.PlatformAPI.api("/api/admin/reject-user", { method: "POST", body: { id: item.id } });
    }
    app.showSuccess("تم الرفض");
    await app.loadApprovalsPanel();
  } catch (e) {
    app.showError(e.message || "فشل الرفض");
  }
};

function escReview(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function typeLabelAr(t) {
  var x = String(t || "").toLowerCase();
  if (x === "restaurant") return "مطعم";
  if (x === "pharmacy") return "صيدلية";
  if (x === "supermarket") return "سوبرماركت / متجر";
  if (x === "clothing") return "ملابس";
  if (x === "beauty_care") return "تجميل وعناية";
  if (x === "flowers_gifts") return "ورود وهدايا";
  return t || "متجر";
}

function mapsEmbedSrc(st) {
  var lat = Number(st && st.lat);
  var lng = Number(st && st.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return "https://maps.google.com/maps?q=" + encodeURIComponent(lat + "," + lng) + "&z=16&output=embed";
  }
  var u = String((st && (st.maps_url || st.location_text)) || "").trim();
  if (u) return "https://maps.google.com/maps?q=" + encodeURIComponent(u) + "&z=15&output=embed";
  return "";
}

app.closeStoreReview = function () {
  var bd = document.getElementById("storeReviewBackdrop");
  if (bd) bd.hidden = true;
  app._storeReviewId = "";
};

app.openStoreReview = async function (storeId) {
  var bd = document.getElementById("storeReviewBackdrop");
  var body = document.getElementById("storeReviewBody");
  if (!bd || !body || !storeId) return;
  app._storeReviewId = storeId;
  body.innerHTML = "<p class='sub'>جارٍ تحميل الطلب…</p>";
  var needsWrap = document.getElementById("storeReviewNeedsWrap");
  var needsMsg = document.getElementById("storeReviewNeedsMsg");
  if (needsWrap) needsWrap.hidden = true;
  if (needsMsg) needsMsg.value = "";
  bd.hidden = false;
  try {
    var j = await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(storeId) + "/setup");
    var st = j.store || {};
    var products = j.products || [];
    var mapSrc = mapsEmbedSrc(st);
    var crImg = st.file_url
      ? "<div><strong>صورة السجل</strong><img src='" + escReview(st.file_url) + "' alt='السجل التجاري' /></div>"
      : "<div><strong>صورة السجل</strong><p class='sub'>غير مرفوعة</p></div>";
    var licImg = st.license_file_url
      ? "<div><strong>صورة الرخصة</strong><img src='" + escReview(st.license_file_url) + "' alt='الرخصة' /></div>"
      : "<div><strong>صورة الرخصة</strong><p class='sub'>غير مرفوعة</p></div>";
    var prodHtml = products.length
      ? products
          .map(function (p) {
            return (
              "<article class='store-review-product'><strong>" +
              escReview(p.name || "—") +
              "</strong><div>" +
              (p.price != null ? Number(p.price).toFixed(2) + " ر.س" : "بدون سعر") +
              "</div>" +
              (p.image_url ? "<img src='" + escReview(p.image_url) + "' alt='' />" : "<p class='sub'>بدون صورة</p>") +
              "</article>"
            );
          })
          .join("")
      : "<p class='sub'>لا منتجات أولية مرفقة</p>";
    body.innerHTML =
      "<div class='store-review-grid'>" +
      "<div><strong>اسم المنشأة</strong><br />" +
      escReview(st.name) +
      "</div>" +
      "<div><strong>رقم الجوال</strong><br /><span dir='ltr'>" +
      escReview(st.phone) +
      "</span></div>" +
      "<div><strong>نوع المنشأة</strong><br />" +
      escReview(typeLabelAr(st.type)) +
      "</div>" +
      "<div><strong>الحالة</strong><br />" +
      escReview(statusLabelAr(st.status, st.status === "approved")) +
      (st.publication_status ? " · نشر: " + escReview(st.publication_status) : "") +
      "</div>" +
      "<div><strong>رقم السجل</strong><br />" +
      escReview(st.commercial_registration || "—") +
      "</div>" +
      "<div><strong>رقم الرخصة</strong><br />" +
      escReview(st.license_number || "—") +
      "</div>" +
      "<div><strong>العنوان</strong><br />" +
      escReview(st.address || st.location_text || "—") +
      "</div></div>" +
      (st.needs_info_message
        ? "<p class='sub'><strong>آخر طلب استكمال:</strong> " + escReview(st.needs_info_message) + "</p>"
        : "") +
      (mapSrc
        ? "<iframe class='store-review-map' title='موقع المنشأة' src='" + escReview(mapSrc) + "' loading='lazy'></iframe>"
        : "<p class='sub'>لا إحداثيات للموقع</p>") +
      "<div class='store-review-docs'>" +
      crImg +
      licImg +
      "</div>" +
      "<h4 style='margin:8px 0 0'>المنتجات الأولية</h4>" +
      "<div class='store-review-products'>" +
      prodHtml +
      "</div>";
  } catch (e) {
    body.innerHTML = "<p class='sub'>" + escReview(e.message || "تعذر تحميل الطلب") + "</p>";
  }
};

app.submitStoreReviewAction = async function (action) {
  var id = app._storeReviewId;
  if (!id) return;
  var extra = {};
  if (action === "needs_info") {
    var ta = document.getElementById("storeReviewNeedsMsg");
    extra.message = ta ? String(ta.value || "").trim() : "";
    if (!extra.message) {
      var wrap = document.getElementById("storeReviewNeedsWrap");
      if (wrap) wrap.hidden = false;
      app.showError("اكتب ما هو الناقص لاستكمال البيانات");
      return;
    }
  }
  if (action === "reject" && !confirm("رفض هذا الطلب؟")) return;
  try {
    await app.PlatformAPI.api("/api/admin/store-requests/" + encodeURIComponent(id), {
      method: "PATCH",
      body: Object.assign({ action: action }, extra),
    });
    app.showSuccess(
      action === "approve" ? "تم اعتماد المنشأة دون نشرها للعملاء" : action === "reject" ? "تم الرفض" : "تم طلب استكمال البيانات"
    );
    app.closeStoreReview();
    await app.loadApprovalsPanel();
  } catch (e) {
    app.showError(e.message || "فشل تنفيذ القرار");
  }
};

(function wireStoreReviewModal() {
  var closeBtn = document.getElementById("storeReviewCloseBtn");
  if (closeBtn) closeBtn.onclick = function () {
    app.closeStoreReview();
  };
  var bd = document.getElementById("storeReviewBackdrop");
  if (bd) {
    bd.addEventListener("click", function (ev) {
      if (ev.target === bd) app.closeStoreReview();
    });
  }
  var approveBtn = document.getElementById("storeReviewApproveBtn");
  if (approveBtn) {
    approveBtn.onclick = app.safeClick(function () {
      return app.submitStoreReviewAction("approve");
    });
  }
  var rejectBtn = document.getElementById("storeReviewRejectBtn");
  if (rejectBtn) {
    rejectBtn.onclick = app.safeClick(function () {
      return app.submitStoreReviewAction("reject");
    });
  }
  var needsBtn = document.getElementById("storeReviewNeedsBtn");
  if (needsBtn) {
    needsBtn.onclick = app.safeClick(function () {
      var wrap = document.getElementById("storeReviewNeedsWrap");
      var ta = document.getElementById("storeReviewNeedsMsg");
      if (wrap && wrap.hidden) {
        wrap.hidden = false;
        if (ta) ta.focus();
        return;
      }
      return app.submitStoreReviewAction("needs_info");
    });
  }
})();

app.showRegistrationDetails = function (item) {
  var lines = [
    "الاسم: " + (item.name || "—"),
    "الجوال: " + (item.phone || "—"),
    "نوع الحساب: " + (item.account_type || "—"),
    "الحالة: " + statusLabelAr(item.status, item.approved),
    "تاريخ التسجيل: " + app.fmtWhen(item.created_at),
    "آخر نشاط: " + app.fmtWhen(item.last_activity_at),
  ];
  if (item.detail) {
    try {
      lines.push("", JSON.stringify(item.detail, null, 2));
    } catch (e) {}
  }
  alert(lines.join("\n"));
};

app.renderApprovalsList = function () {
  var root = document.getElementById("approvalsList");
  if (!root) return;
  var q = app.getSearch("searchApprovals");
  var rows = (app.cacheApprovals || []).filter(function (it) {
    return app.hasQueryMatch(q, [it.name, it.phone, it.account_type, it.status, it.role]);
  });
  root.innerHTML = "";
  if (!rows.length) {
    root.innerHTML = '<div class="item">لا توجد طلبات مطابقة</div>';
    return;
  }
  rows.forEach(function (it) {
    var item = document.createElement("div");
    item.className = "item approval-reg-card";
    var st = String(it.status || "").toLowerCase();
    var canDecide = st === "pending" || st === "needs_info" || (!it.approved && st !== "rejected" && st !== "blocked");
    item.innerHTML =
      "<strong>" +
      (it.name || "—") +
      "</strong>" +
      "<div>رقم الجوال: " +
      (it.phone || "—") +
      "</div>" +
      "<div>تاريخ التسجيل: " +
      app.fmtWhen(it.created_at) +
      "</div>" +
      "<div>نوع الحساب: " +
      (it.account_type || "—") +
      "</div>" +
      "<div>حالة الحساب: " +
      statusLabelAr(it.status, it.approved) +
      "</div>" +
      "<div>آخر نشاط: " +
      app.fmtWhen(it.last_activity_at) +
      "</div>";
    var row = document.createElement("div");
    row.className = "row";
    if (canDecide) {
      row.appendChild(
        app.mkAction("✅ اعتماد", "btn-primary", app.safeClick(function () {
          return app.approveRegistrationItem(it);
        }))
      );
      row.appendChild(
        app.mkAction("❌ رفض", "btn-ghost", app.safeClick(function () {
          return app.rejectRegistrationItem(it);
        }))
      );
    }
    row.appendChild(
      app.mkAction("👁️ عرض التفاصيل", "btn-ghost", app.safeClick(function () {
        if (it.kind === "store") return app.openStoreReview(it.id);
        app.showRegistrationDetails(it);
      }))
    );
    var contact = document.createElement("a");
    contact.className = "btn btn-ghost";
    contact.href = waContactHref(it.phone);
    contact.target = "_blank";
    contact.rel = "noopener";
    contact.textContent = "📞 تواصل";
    row.appendChild(contact);
    if (it.kind === "store" && (st === "pending" || st === "needs_info")) {
      row.appendChild(
        app.mkAction("تعديل الصفحة", "btn-ghost", app.safeClick(function () {
          app.openStoreSetup(it.id);
        }))
      );
    }
    item.appendChild(row);
    root.appendChild(item);
  });
};

(function wireApprovalsPanel() {
  var reload = document.getElementById("reloadApprovalsBtn");
  if (reload) reload.onclick = function () {
    void app.loadApprovalsPanel();
  };
  var typeSel = document.getElementById("approvalsFilterType");
  if (typeSel) {
    typeSel.onchange = function () {
      app.approvalsFilterType = typeSel.value;
      void app.loadApprovalsPanel();
    };
  }
  var statusSel = document.getElementById("approvalsFilterStatus");
  if (statusSel) {
    statusSel.onchange = function () {
      app.approvalsFilterStatus = statusSel.value;
      void app.loadApprovalsPanel();
    };
  }
})();
