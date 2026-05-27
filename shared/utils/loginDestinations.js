/**
 * توجيه ذكي بعد تسجيل الدخول — يدعم تعدد الأدوار (users.role + drivers + stores)
 */

/** اللوحة الموحدة للمندوب — لا تستخدم /driver-dashboard */
const DRIVER_HOME_PATH = "/driver";

const LEGACY_DRIVER_PATHS = new Set(["/driver-dashboard", "/driver-dashboard.html"]);

function canonicalAccountPath(path, role) {
  let p = String(path || "/").trim().split("?")[0].split("#")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\.html$/i, "");
  if (LEGACY_DRIVER_PATHS.has(p) || (String(role || "").toLowerCase() === "driver" && LEGACY_DRIVER_PATHS.has(p))) {
    return DRIVER_HOME_PATH;
  }
  if (p === "/driver-dashboard") return DRIVER_HOME_PATH;
  return p || "/";
}

const ROLE_DESTINATIONS = {
  customer: { path: "/dashboard", label: "لوحة زائر المنصة" },
  driver: { path: DRIVER_HOME_PATH, label: "لوحة المندوب" },
  merchant: { path: "/store-dashboard", label: "متجر" },
  restaurant: { path: "/store-dashboard", label: "مطعم" },
  service: { path: "/services-provider", label: "مزود خدمة" },
  admin: { path: "/admin-dashboard", label: "لوحة الإدارة" },
  blocked: { path: "/blocked-complaints", label: "الدعم" },
};

function destinationForRole(role) {
  const r = String(role || "customer").toLowerCase();
  return ROLE_DESTINATIONS[r] || ROLE_DESTINATIONS.customer;
}

function addDestination(list, seen, entry) {
  const role = String(entry.role || "customer").toLowerCase();
  const path = canonicalAccountPath(entry.path || destinationForRole(role).path, role);
  const key = path + "|" + role;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    role,
    path,
    label: entry.label || destinationForRole(role).label,
    primary: !!entry.primary,
    extra: !!entry.extra,
  });
}

async function resolveLoginDestinations(sb, userRow) {
  const destinations = [];
  const seen = new Set();
  if (!userRow || !userRow.id) {
    addDestination(destinations, seen, { role: "customer", ...ROLE_DESTINATIONS.customer, primary: true });
    return destinations;
  }

  const role = String(userRow.role || "customer").toLowerCase();
  const status = String(userRow.status || "").toLowerCase();
  const phone = String(userRow.phone || "").replace(/\D/g, "");

  if (role === "blocked" || status === "blocked") {
    addDestination(destinations, seen, { role: "blocked", ...ROLE_DESTINATIONS.blocked, primary: true });
    return destinations;
  }

  addDestination(destinations, seen, {
    role,
    ...destinationForRole(role),
    primary: true,
  });

  if (phone && sb) {
    try {
      const { data: drv } = await sb
        .from("drivers")
        .select("id, status, active")
        .eq("phone", phone)
        .maybeSingle();
      if (drv && String(drv.status || "") === "approved" && drv.active === true && role !== "driver") {
        addDestination(destinations, seen, { role: "driver", ...ROLE_DESTINATIONS.driver, extra: true });
      }
    } catch (_) {
      /* drivers table optional */
    }

    try {
      const { data: stores } = await sb
        .from("stores")
        .select("id, type, status")
        .eq("phone", phone)
        .eq("status", "approved");
      const types = new Set((stores || []).map((s) => String(s.type || "merchant").toLowerCase()));
      if (types.has("restaurant") && role !== "restaurant") {
        addDestination(destinations, seen, { role: "restaurant", ...ROLE_DESTINATIONS.restaurant, extra: true });
      }
      if ((types.has("merchant") || types.has("store") || types.size > 0) && role !== "merchant" && role !== "restaurant") {
        if (!types.has("restaurant") || types.size > 1) {
          addDestination(destinations, seen, { role: "merchant", ...ROLE_DESTINATIONS.merchant, extra: true });
        }
      }
    } catch (_) {
      /* stores table optional */
    }
  }

  if (userRow.service_type && role !== "service") {
    addDestination(destinations, seen, { role: "service", ...ROLE_DESTINATIONS.service, extra: true });
  }

  if (!destinations.length) {
    addDestination(destinations, seen, { role: "customer", ...ROLE_DESTINATIONS.customer, primary: true });
  }

  return destinations;
}

function pickDefaultDestination(destinations, preferredRole) {
  const list = Array.isArray(destinations) ? destinations : [];
  if (!list.length) {
    const r = destinationForRole(preferredRole);
    return { role: String(preferredRole || "customer").toLowerCase(), ...r, path: canonicalAccountPath(r.path, preferredRole) };
  }

  const pref = String(preferredRole || "").toLowerCase();
  if (pref) {
    const match = list.find((d) => d.role === pref);
    if (match) return { ...match, path: canonicalAccountPath(match.path, match.role) };
  }

  const primary = list.find((d) => d.primary);
  if (primary) return { ...primary, path: canonicalAccountPath(primary.path, primary.role) };
  const first = list[0];
  return { ...first, path: canonicalAccountPath(first.path, first.role) };
}

module.exports = {
  DRIVER_HOME_PATH,
  canonicalAccountPath,
  ROLE_DESTINATIONS,
  destinationForRole,
  resolveLoginDestinations,
  pickDefaultDestination,
};
