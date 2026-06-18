/**
 * توجيه ذكي بعد تسجيل الدخول — Role Routing Engine + تعدد الأدوار
 */
const {
  resolvePortalRole,
  portalPathForRole,
  portalLabelAr,
  MERCHANT_DB_ROLES,
} = require("./resolvePortalRole");

const DRIVER_HOME_PATH = portalPathForRole("driver");
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

const BLOCKED_DESTINATION = { path: "/blocked-complaints", label: "الدعم" };

function destinationForPortalRole(portalRole) {
  const r = String(portalRole || "customer").toLowerCase();
  return {
    role: r,
    path: portalPathForRole(r),
    label: portalLabelAr(r),
  };
}

function addDestination(list, seen, entry) {
  const portalRole = String(entry.portalRole || entry.role || "customer").toLowerCase();
  const path = canonicalAccountPath(entry.path || portalPathForRole(portalRole), portalRole);
  const key = path + "|" + portalRole;
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    role: portalRole,
    portalRole,
    path,
    label: entry.label || portalLabelAr(portalRole),
    primary: !!entry.primary,
    extra: !!entry.extra,
    rawRole: entry.rawRole || null,
  });
}

async function resolveLoginDestinations(sb, userRow) {
  const destinations = [];
  const seen = new Set();

  if (!userRow || !userRow.id) {
    addDestination(destinations, seen, { portalRole: "customer", ...destinationForPortalRole("customer"), primary: true });
    return destinations;
  }

  const rawRole = String(userRow.role || "customer").toLowerCase();
  const status = String(userRow.status || "").toLowerCase();
  const phone = String(userRow.phone || "").replace(/\D/g, "");

  if (rawRole === "blocked" || status === "blocked") {
    addDestination(destinations, seen, {
      portalRole: "customer",
      path: BLOCKED_DESTINATION.path,
      label: BLOCKED_DESTINATION.label,
      rawRole: "blocked",
      primary: true,
    });
    return destinations;
  }

  const primary = resolvePortalRole(userRow);
  addDestination(destinations, seen, {
    portalRole: primary.portalRole,
    path: portalPathForRole(primary.portalRole),
    label: portalLabelAr(primary.portalRole),
    rawRole: primary.rawRole,
    primary: true,
  });

  if (phone && sb) {
    try {
      const { data: drv } = await sb
        .from("drivers")
        .select("id, status, active")
        .eq("phone", phone)
        .maybeSingle();
      if (drv && String(drv.status || "") === "approved" && drv.active === true && primary.portalRole !== "driver") {
        addDestination(destinations, seen, {
          portalRole: "driver",
          ...destinationForPortalRole("driver"),
          rawRole: "driver",
          extra: true,
        });
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
      const hasApprovedStore = (stores || []).length > 0;
      if (hasApprovedStore && !MERCHANT_DB_ROLES.has(rawRole) && primary.portalRole !== "merchant") {
        addDestination(destinations, seen, {
          portalRole: "merchant",
          ...destinationForPortalRole("merchant"),
          rawRole: "store",
          extra: true,
        });
      }
    } catch (_) {
      /* stores table optional */
    }
  }

  if (userRow.service_type && rawRole !== "service") {
    const svc = resolvePortalRole({ role: "service", service_type: userRow.service_type });
    if (svc.portalRole !== primary.portalRole) {
      addDestination(destinations, seen, {
        portalRole: svc.portalRole,
        path: portalPathForRole(svc.portalRole),
        label: portalLabelAr(svc.portalRole),
        rawRole: "service",
        extra: true,
      });
    }
  }

  if (!destinations.length) {
    addDestination(destinations, seen, { portalRole: "customer", ...destinationForPortalRole("customer"), primary: true });
  }

  return destinations;
}

function pickDefaultDestination(destinations, preferredRole) {
  const list = Array.isArray(destinations) ? destinations : [];
  if (!list.length) {
    const resolved = resolvePortalRole({ role: preferredRole });
    const path = portalPathForRole(resolved.portalRole);
    return {
      role: resolved.portalRole,
      portalRole: resolved.portalRole,
      path: canonicalAccountPath(path, resolved.portalRole),
      label: portalLabelAr(resolved.portalRole),
    };
  }

  const pref = String(preferredRole || "").toLowerCase();
  if (pref) {
    const prefPortal = MERCHANT_DB_ROLES.has(pref)
      ? "merchant"
      : pref === "user"
        ? "customer"
        : pref;
    const match = list.find((d) => d.portalRole === prefPortal || d.role === prefPortal || d.rawRole === pref);
    if (match) {
      return { ...match, path: canonicalAccountPath(match.path, match.portalRole || match.role) };
    }
  }

  const primary = list.find((d) => d.primary);
  if (primary) return { ...primary, path: canonicalAccountPath(primary.path, primary.portalRole || primary.role) };
  const first = list[0];
  return { ...first, path: canonicalAccountPath(first.path, first.portalRole || first.role) };
}

/** @deprecated استخدم resolvePortalRole — للتوافق */
const ROLE_DESTINATIONS = {
  customer: destinationForPortalRole("customer"),
  driver: destinationForPortalRole("driver"),
  store: destinationForPortalRole("merchant"),
  merchant: destinationForPortalRole("merchant"),
  restaurant: destinationForPortalRole("merchant"),
  service: destinationForPortalRole("service"),
  transport: destinationForPortalRole("transport"),
  admin: destinationForPortalRole("admin"),
  blocked: BLOCKED_DESTINATION,
};

function destinationForRole(role) {
  const resolved = resolvePortalRole({ role });
  if (String(role || "").toLowerCase() === "blocked") return BLOCKED_DESTINATION;
  return destinationForPortalRole(resolved.portalRole);
}

module.exports = {
  DRIVER_HOME_PATH,
  canonicalAccountPath,
  ROLE_DESTINATIONS,
  STORE_PANEL_ROLES: MERCHANT_DB_ROLES,
  destinationForRole,
  destinationForPortalRole,
  resolveLoginDestinations,
  pickDefaultDestination,
};
