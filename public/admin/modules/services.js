/** Admin — مزودو الخدمات */
import { app } from "./shared.js";
import "./api.js";

app.loadServicesPanel = async function () {
  if (!app.hasPermission("providers")) return;
  var root = document.getElementById("servicesProvidersList");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var j = await app.PlatformAPI.api("/api/admin/providers");
    var users = j.providers || [];
    var stores = j.stores || [];
    var rows = users.concat(
      stores.map(function (s) {
        return {
          name: s.name,
          phone: s.phone,
          role: s.type || "store",
          status: s.status,
          public_store_url: s.id ? "/store.html?id=" + encodeURIComponent(s.id) : "",
        };
      })
    );
    if (!rows.length) {
      root.innerHTML = '<div class="item">لا يوجد مزودو خدمات مسجلون.</div>';
      return;
    }
    root.innerHTML = rows
      .map(function (p) {
        var name = p.name || p.store_name || p.business_name || "—";
        var phone = p.phone || "—";
        var role = p.role || p.service_type || "service";
        var st = p.status || "active";
        return (
          '<div class="item">' +
          "<strong>" +
          name +
          "</strong>" +
          "<div>الجوال: " +
          phone +
          "</div>" +
          "<div>النوع: " +
          role +
          " · " +
          st +
          "</div>" +
          (p.public_store_url
            ? '<div><a href="' +
              p.public_store_url +
              '" target="_blank" rel="noopener">عرض الصفحة</a></div>'
            : "") +
          "</div>"
        );
      })
      .join("");
  } catch (e) {
    root.innerHTML = '<div class="item">' + (e.message || "فشل التحميل") + "</div>";
  }
};

app.applyServicesPanelVisibility = function () {
  var show = app.hasPermission("providers");
  var btn = document.getElementById("panelServicesBtn");
  var panel = document.getElementById("panelServices");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel && !show) panel.style.display = "none";
};
