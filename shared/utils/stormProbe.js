/**
 * عدادات تطوير فقط لعاصفة طلبات Supabase.
 * تعمل عندما NODE_ENV ليس production، أو عند ERVENOW_STORM_PROBE=1.
 * ERVENOW_STORM_PROBE=0 يوقفها دائماً.
 */

const counts = {
  dashboard_http: 0,
  wallet_transactions_http: 0,
  notifications_http: 0,
  dashboard_supabase_queries: 0,
  last_dashboard_supabase_queries: 0,
};

function enabled() {
  const flag = String(process.env.ERVENOW_STORM_PROBE || "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.NODE_ENV !== "production";
}

function noteHttp(kind) {
  if (!enabled()) return;
  if (kind === "dashboard") counts.dashboard_http += 1;
  else if (kind === "wallet_transactions") counts.wallet_transactions_http += 1;
  else if (kind === "notifications") counts.notifications_http += 1;
}

function wrapSb(sb) {
  if (!enabled() || !sb) return { client: sb, count: () => 0 };
  let n = 0;
  const client = new Proxy(sb, {
    get(target, prop, receiver) {
      if (prop === "from" || prop === "rpc") {
        return function countedQuery(...args) {
          n += 1;
          counts.dashboard_supabase_queries += 1;
          return target[prop].apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { client, count: () => n };
}

function logDashboard(queryCount) {
  if (!enabled()) return;
  counts.last_dashboard_supabase_queries = queryCount;
  console.info(
    "[storm-probe] dashboard_http=%d wallet_transactions_http=%d notifications_http=%d last_dashboard_supabase=%d dashboard_supabase_total=%d",
    counts.dashboard_http,
    counts.wallet_transactions_http,
    counts.notifications_http,
    counts.last_dashboard_supabase_queries,
    counts.dashboard_supabase_queries
  );
}

function snapshot() {
  return {
    enabled: enabled(),
    dashboard_http: counts.dashboard_http,
    wallet_transactions_http: counts.wallet_transactions_http,
    notifications_http: counts.notifications_http,
    last_dashboard_supabase_queries: counts.last_dashboard_supabase_queries,
    dashboard_supabase_queries: counts.dashboard_supabase_queries,
  };
}

module.exports = {
  enabled,
  noteHttp,
  wrapSb,
  logDashboard,
  snapshot,
};
