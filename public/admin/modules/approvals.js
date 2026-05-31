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
    var canDecide = st === "pending" || (!it.approved && st !== "rejected" && st !== "blocked");
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
    if (it.kind === "store" && st === "pending") {
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
