const { getSoftLaunchStatus } = require("../utils/roleSeparationSoftLaunch");
const {
  readStateAsync,
  summarizeForAdmin,
  summarizeRedirectStats,
} = require("../utils/adminReadinessStore");
const {
  PORTAL_DEFINITIONS,
  PREVIEW_PORTAL_KEYS,
  LEGACY_ACCESS_KEYS,
} = require("../utils/adminRoleTaxonomy");

const PORTAL_KEYS = ["merchant", "driver", "service", "transport"];
const LEGACY_KEYS = ["store-dashboard", "order-board", "driver-app", "services-provider"];

function periodSince(hours, startedAt) {
  const now = Date.now();
  const windowStart = now - Math.max(Number(hours) || 48, 1) * 3600000;
  const launchStart = startedAt ? new Date(startedAt).getTime() : windowStart;
  const sinceMs = Math.max(windowStart, launchStart);
  return new Date(sinceMs).toISOString();
}

function buildRecommendations(input) {
  const recs = [];
  const { redirect_statistics: rs, portal_usage: pu, legacy_usage: lu, soft_launch: sl } = input;

  if (!sl.enabled) {
    recs.push({ level: "critical", text: "Soft Launch غير مفعّل — فعّل التوجيه إلى البوابات الجديدة." });
    return recs;
  }

  if (rs.failed > 0) {
    recs.push({
      level: rs.failed > 5 ? "warning" : "info",
      text:
        "فشل " +
        rs.failed +
        " إعادة توجيه من أصل " +
        rs.total +
        " — راجع Failed Redirects في Role Separation Monitor.",
    });
  }

  const unknown = input.redirect_errors?.unknown_role?.count || 0;
  if (unknown > 0) {
    recs.push({
      level: "warning",
      text: unknown + " حدث Unknown Role — راجع السجلات دون منع الدخول (fallback إلى المنصة الرئيسية).",
    });
  }

  const previewTotal = PORTAL_KEYS.reduce((n, k) => n + (pu[k]?.visits || 0), 0);
  const legacyTotal = LEGACY_KEYS.reduce((n, k) => n + (lu[k]?.visits || 0), 0);

  if (previewTotal === 0 && legacyTotal === 0) {
    recs.push({
      level: "info",
      text: "لا توجد زيارات مسجّلة بعد — انتظر حركة مستخدمين حقيقية أو تحقق من beacon على البوابات.",
    });
  } else if (legacyTotal > previewTotal * 0.5 && legacyTotal > 10) {
    recs.push({
      level: "info",
      text:
        "استخدام Legacy مرتفع نسبياً (" +
        legacyTotal +
        " زيارة) — طبيعي في Soft Launch؛ راقب الانتقال التدريجي.",
    });
  }

  if (rs.total >= 10 && rs.success_rate >= 95 && unknown === 0) {
    recs.push({
      level: "success",
      text: "معدل نجاح التوجيه ممتاز (" + rs.success_rate + "%) — يُنصح بالاستمرار في Soft Launch.",
    });
  } else if (rs.total < 10) {
    recs.push({
      level: "info",
      text: "عيّنة توجيه صغيرة (" + rs.total + ") — انتظر 48 ساعة كاملة قبل قرار نهائي.",
    });
  }

  if (!recs.some((r) => r.level === "warning" || r.level === "critical")) {
    recs.push({
      level: "success",
      text: "لا توجد ملاحظات حرجة — استمر في Soft Launch مع مراقبة يومية.",
    });
  }

  return recs;
}

async function buildSoftLaunchReport(options = {}) {
  const hours = Math.max(Number(options.hours) || 48, 1);
  const softLaunch = getSoftLaunchStatus();
  const state = await readStateAsync();
  const tracking = summarizeForAdmin(state);
  const sinceIso = periodSince(hours, softLaunch.started_at);
  const redirectStats = summarizeRedirectStats(state, sinceIso);

  const portalUsage = {};
  PORTAL_KEYS.forEach((key) => {
    const preview = tracking.preview_visits[key] || {};
    const portal = tracking.portal_visits[key] || {};
    portalUsage[key] = {
      label: PORTAL_DEFINITIONS[key]?.labelAr || key,
      path: PREVIEW_PORTAL_KEYS[key] || null,
      visits: Math.max(preview.visits || 0, portal.visits || 0),
      unique_users: Math.max(preview.unique_users || 0, portal.unique_users || 0),
      active_users: preview.active_users || 0,
      last_at: preview.last_at || portal.last_at || null,
    };
  });

  const legacyUsage = {};
  LEGACY_KEYS.forEach((key) => {
    const row = tracking.legacy_access[key] || {};
    legacyUsage[key] = {
      label: LEGACY_ACCESS_KEYS[key]?.labelAr || key,
      path: LEGACY_ACCESS_KEYS[key]?.path || null,
      visits: row.visits || 0,
      unique_users: row.unique_users || 0,
      last_at: row.last_at || null,
    };
  });

  const payload = {
    generated_at: new Date().toISOString(),
    period_hours: hours,
    period_since: sinceIso,
    soft_launch: softLaunch,
    portal_usage: portalUsage,
    redirect_statistics: redirectStats,
    redirect_errors: tracking.redirect_errors,
    legacy_usage: legacyUsage,
    redirect_events_recent: redirectStats.recent,
  };

  payload.recommendations = buildRecommendations(payload);
  payload.continue_soft_launch = !payload.recommendations.some((r) => r.level === "critical");

  return payload;
}

module.exports = {
  buildSoftLaunchReport,
  buildRecommendations,
  PORTAL_KEYS,
  LEGACY_KEYS,
};
