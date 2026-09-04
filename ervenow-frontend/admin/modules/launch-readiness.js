/** Admin — Launch Readiness */
import { app } from "./shared.js";
import "./api.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

app.loadLaunchReadinessPanel = async function () {
  var bandEl = document.getElementById("launchReadinessBand");
  var pctEl = document.getElementById("launchReadinessPercent");
  var ordEl = document.getElementById("launchReadinessOrdering");
  var tableEl = document.getElementById("launchReadinessTable");
  var trendEl = document.getElementById("launchReadinessTrend");
  var hint = document.getElementById("launchOrderingHint");
  try {
    var j = await app.PlatformAPI.api("/api/admin/launch-readiness");
    var trend = await app.PlatformAPI.api("/api/admin/launch-trend").catch(function () {
      return { days: [] };
    });
    var percent = Number(j.percent || 0);
    var band = String(j.band || "NOT_READY");
    if (bandEl) bandEl.textContent = band.replace(/_/g, " ");
    if (pctEl) pctEl.textContent = "Launch Readiness: " + percent + "%";
    app.setBadge("badgeLaunchReadiness", Math.round(percent));
    var po = j.public_ordering || {};
    if (ordEl) {
      ordEl.textContent =
        "الطلبات العامة: " +
        (po.enabled ? "ON" : "OFF") +
        " — المصدر: " +
        (po.source || "—") +
        " — لا فتح تلقائي";
    }
    if (hint) {
      hint.textContent = po.enabled
        ? "الطلبات مفتوحة يدوياً. الإغلاق يحتاج تأكيد DISABLE_PUBLIC_ORDERING."
        : "وضع التسجيل المسبق. الفتح يحتاج تأكيد ENABLE_PUBLIC_ORDERING ولن يحدث تلقائياً.";
    }
    var c = j.counts || {};
    var t = j.targets || {};
    var rows = [
      ["عملاء مسجّلون", c.customers_registered || 0, "—"],
      ["عملاء موثّقو OTP", c.customers_verified || 0, t.customers_verified],
      ["تسجيلات عملاء اليوم", c.customers_today || 0, "—"],
      ["تسجيلات عملاء 7 أيام", c.customers_last_7_days || 0, "—"],
      ["مناديب مسجّلون", c.drivers_registered || 0, t.drivers_registered],
      ["مناديب جاهزون / نشطون", c.drivers_ready || 0, t.drivers_ready],
      ["مطاعم مسجّلة / جاهزة", (c.restaurants_registered || 0) + " / " + (c.restaurants_ready || 0), t.restaurants_ready],
      ["سوبرماركت مسجّل / جاهز", (c.supermarkets_registered || 0) + " / " + (c.supermarkets_ready || 0), t.supermarkets_ready],
      ["صيدليات مسجّلة / جاهزة", (c.pharmacies_registered || 0) + " / " + (c.pharmacies_ready || 0), t.pharmacies_ready],
      ["سطحات مسجّلة / جاهزة", (c.tow_trucks_registered || 0) + " / " + (c.tow_trucks_ready || 0), t.tow_trucks_ready],
      ["غاز مسجّل / جاهز", (c.gas_registered || 0) + " / " + (c.gas_ready || 0), t.gas_ready],
    ];
    if (tableEl) {
      tableEl.innerHTML = rows
        .map(function (r) {
          return (
            '<div class="item"><div class="line"><strong>' +
            esc(r[0]) +
            "</strong> " +
            esc(r[1]) +
            " / " +
            esc(r[2]) +
            "</div></div>"
          );
        })
        .join("");
    }
    var days = (trend && trend.days) || [];
    if (trendEl) {
      if (!days.length) trendEl.innerHTML = '<p class="muted">لا بيانات بعد</p>';
      else {
        trendEl.innerHTML = days
          .map(function (d) {
            return (
              '<div class="item"><div class="line">' +
              esc(d.date) +
              " — عملاء " +
              esc(d.customers) +
              " · مناديب " +
              esc(d.drivers) +
              " · تجار/مزودون " +
              esc(d.merchants_providers) +
              "</div></div>"
            );
          })
          .join("");
      }
    }
  } catch (e) {
    if (bandEl) bandEl.textContent = e.message || "فشل التحميل";
  }
};

app.togglePublicOrdering = async function (enabled) {
  var phrase = enabled ? "ENABLE_PUBLIC_ORDERING" : "DISABLE_PUBLIC_ORDERING";
  var typed = window.prompt(
    enabled
      ? "فتح الطلبات العامة قرار يدوي وليس تلقائياً. اكتب ENABLE_PUBLIC_ORDERING للتأكيد."
      : "إغلاق الطلبات العامة. اكتب DISABLE_PUBLIC_ORDERING للتأكيد."
  );
  if (String(typed || "").trim() !== phrase) {
    window.alert("لم يُؤكد التغيير.");
    return;
  }
  try {
    await app.PlatformAPI.api("/api/admin/public-ordering", {
      method: "POST",
      body: { enabled: !!enabled, confirm: phrase },
    });
    await app.loadLaunchReadinessPanel();
  } catch (e) {
    window.alert(e.message || "فشل حفظ الإعداد");
  }
};
