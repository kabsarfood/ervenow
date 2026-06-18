/** Admin — مزودو النقل */
import { app } from "./shared.js";
import "./api.js";

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

app.loadTransportPanel = async function () {
  if (!app.hasPermission("providers")) return;
  var root = document.getElementById("transportProvidersList");
  if (!root) return;
  root.innerHTML = '<div class="item">جارٍ التحميل…</div>';
  try {
    var q = app.getSearch("searchTransport");
    var url = "/api/admin/providers?segment=transport";
    if (q) url += "&q=" + encodeURIComponent(q);
    var j = await app.PlatformAPI.api(url);
    var rows = j.providers || [];
    if (!rows.length) {
      root.innerHTML =
        '<div class="item">لا يوجد مزودو نقل (مركبات · غاز · شحن · بين المدن).</div>';
      return;
    }
    root.innerHTML = rows
      .map(function (p) {
        var name = p.name || "—";
        var phone = p.phone || "—";
        var typeLabel = p.service_type_label || p.service_type || "نقل";
        var st = p.status || "active";
        return (
          '<div class="item">' +
          "<strong>" +
          esc(name) +
          "</strong>" +
          "<div>الجوال: " +
          esc(phone) +
          "</div>" +
          "<div>نوع النقل: " +
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
