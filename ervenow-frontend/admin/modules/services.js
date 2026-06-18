/** Admin — مزودو الخدمات (بدون النقل) */
import { app } from "./shared.js";
import "./api.js";

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

app.loadServicesPanel = async function () {
  if (!app.hasPermission("providers")) return;
  var root = document.getElementById("servicesProvidersList");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var q = app.getSearch("searchServices");
    var url = "/api/admin/providers?segment=service";
    if (q) url += "&q=" + encodeURIComponent(q);
    var j = await app.PlatformAPI.api(url);
    var rows = j.providers || [];
    if (!rows.length) {
      root.innerHTML =
        '<div class="item">لا يوجد مزودو خدمات (كهرباء · سباكة · تكييف · غسيل · تشجير).</div>';
      return;
    }
    root.innerHTML = rows
      .map(function (p) {
        var name = p.name || "—";
        var phone = p.phone || "—";
        var typeLabel = p.service_type_label || p.service_type || "خدمة";
        var st = p.status || "active";
        return (
          '<div class="item">' +
          "<strong>" +
          esc(name) +
          "</strong>" +
          "<div>الجوال: " +
          esc(phone) +
          "</div>" +
          "<div>نوع الخدمة: " +
          esc(typeLabel) +
          " · " +
          esc(st) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
  } catch (e) {
    root.innerHTML = '<div class="item">' + esc(e.message || "فشل التحميل") + "</div>";
  }
};

app.applyServicesPanelVisibility = function () {
  var show = app.hasPermission("providers");
  var btn = document.getElementById("panelServicesBtn");
  var panel = document.getElementById("panelServices");
  if (btn) btn.style.display = show ? "" : "none";
  if (panel && !show) panel.style.display = "none";
  var tbtn = document.getElementById("panelTransportBtn");
  var tpanel = document.getElementById("panelTransport");
  if (tbtn) tbtn.style.display = show ? "" : "none";
  if (tpanel && !show) tpanel.style.display = "none";
};
