/** Admin Dashboard — drivers */
import { app } from "./shared.js";
import "./api.js";

app.handleAdminDriverUpdate = function (data) {
  app.applyDriverGpsToActiveOrders(data);
  if (app.adminDriverSilentRefreshTimer) clearTimeout(app.adminDriverSilentRefreshTimer);
  app.adminDriverSilentRefreshTimer = setTimeout(function () {
    app.adminDriverSilentRefreshTimer = null;
    void app.silentLoadRecentOrdersForRealtime();
    app.scheduleAdminLiveStatsRefresh();
  }, 420);
}

app.updateDriver = async function (id, action) {
  var path = "/api/admin/" + action;
  await app.PlatformAPI.api(path, { method: "POST", body: { id: id } });
}

app.loadDrivers = async function () {
  try {
    var j = await app.PlatformAPI.api("/api/admin/drivers");
    app.cacheDrivers = j.drivers || [];
    var pendingCount = 0;
    app.cacheDrivers.forEach(function (d) {
      if (String(d.status || "").toLowerCase() === "pending") pendingCount += 1;
    });
    app.setBadge("badgePendingDrivers", pendingCount);
    app.renderDrivers();
    app.syncLiveMapMarkers();
  } catch (e) {
    app.showError(e.message || "فشل تحميل المناديب");
  }
}

app.renderDrivers = function () {
  var list = document.getElementById("driversList");
  if (!list) return;
  var q = app.getSearch("searchDrivers");
  var rows = app.cacheDrivers.filter(function (d) {
    return app.hasQueryMatch(q, [d.name, d.phone, d.car_type, d.plate_number, d.status]);
  });
  list.innerHTML = "";
  rows.forEach(function (d) {
    var item = document.createElement("div");
    item.className = "item";
    item.innerHTML =
      "<strong>" + (d.name || "بدون اسم") + "</strong>" +
      "<div>الجوال: " + (d.phone || "—") + "</div>" +
      "<div>المركبة: " + (d.car_type || "—") + " | اللوحة: " + (d.plate_number || "—") + "</div>" +
      "<div>الحالة: " + (d.status || "pending") + "</div>";
    var row = document.createElement("div");
    row.className = "row";
    var ds = String(d.status || "").toLowerCase();
    var isApprovedActive = ds === "approved" && d.active === true;
    var isBlocked = ds === "blocked" || d.active === false;
    if (isApprovedActive) {
      row.appendChild(app.mkAction("حظر", "btn-ghost", safeClick(async function () {
        try { await app.updateDriver(d.id, "block-driver"); app.showSuccess("تم حظر المندوب"); app.loadDrivers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    } else if (isBlocked) {
      row.appendChild(app.mkAction("تفعيل", "btn-primary", safeClick(async function () {
        try { await app.updateDriver(d.id, "activate-driver"); app.showSuccess("تم تفعيل المندوب"); app.loadDrivers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    } else {
      row.appendChild(app.mkAction("موافقة", "btn-primary", safeClick(async function () {
        try { await app.updateDriver(d.id, "approve-driver"); app.showSuccess("تمت الموافقة"); app.loadDrivers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
      row.appendChild(app.mkAction("رفض", "btn-ghost", safeClick(async function () {
        try { await app.updateDriver(d.id, "reject-driver"); app.showSuccess("تم الرفض"); app.loadDrivers(); } catch (e) { app.showError(e.message || "فشل"); }
      })));
    }
    item.appendChild(row);
    list.appendChild(item);
  });
  if (!rows.length) list.innerHTML = '<div class="item">لا يوجد مناديب مطابقون</div>';
}
