const { roleLabelAr, normalizeAccountStatus } = require("../utils/accountApproval");
const { isTransportServiceType } = require("../utils/adminRoleTaxonomy");

function normalizeDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function storeTypeLabelAr(type) {
  const t = String(type || "").toLowerCase();
  if (t === "restaurant") return "مطعم";
  if (t === "supermarket") return "بقالة";
  if (t === "pharmacy") return "صيدلية";
  return t || "متجر";
}

function mapUserRow(u) {
  const status = normalizeAccountStatus(u.status, u.role);
  return {
    kind: "user",
    id: u.id,
    name: String(u.name || "").trim() || "—",
    phone: u.phone || "",
    created_at: u.created_at || null,
    account_type: roleLabelAr(u.role, u.service_type),
    role: u.role,
    service_type: u.service_type || null,
    status,
    approved: status === "active",
    last_activity_at: u.updated_at || u.created_at || null,
    detail: {
      role: u.role,
      service_type: u.service_type,
      service_district: u.service_district || null,
    },
  };
}

function mapStoreRow(s) {
  const status = String(s.status || "pending").toLowerCase();
  return {
    kind: "store",
    id: s.id,
    name: s.name || "—",
    phone: s.phone || "",
    created_at: s.created_at || null,
    account_type: storeTypeLabelAr(s.type),
    role: "store",
    status,
    approved: status === "approved",
    last_activity_at: s.updated_at || s.created_at || null,
    detail: {
      type: s.type,
      location_text: s.location_text || null,
      is_active: s.is_active,
    },
  };
}

function mapDriverRow(d) {
  const status = String(d.status || "pending").toLowerCase();
  return {
    kind: "driver",
    id: d.id,
    name: d.name || "—",
    phone: d.phone || "",
    created_at: d.created_at || null,
    account_type: "مندوب",
    role: "driver",
    status,
    approved: status === "approved" && d.active === true,
    last_activity_at: d.updated_at || d.created_at || null,
    detail: {
      car_type: d.car_type,
      plate_number: d.plate_number,
      active: d.active,
    },
  };
}

function matchesTypeFilter(item, typeFilter) {
  const f = String(typeFilter || "all").toLowerCase();
  if (!f || f === "all") return true;
  if (f === "customer") return item.kind === "user" && ["customer", "user"].includes(String(item.role || "").toLowerCase());
  if (f === "store") return item.kind === "store";
  if (f === "service") {
    return (
      item.kind === "user" &&
      String(item.role || "").toLowerCase() === "service" &&
      !isTransportServiceType(item.service_type)
    );
  }
  if (f === "transport") {
    return (
      item.kind === "user" &&
      String(item.role || "").toLowerCase() === "service" &&
      isTransportServiceType(item.service_type)
    );
  }
  if (f === "driver") return item.kind === "driver";
  return true;
}

function matchesStatusFilter(item, statusFilter) {
  const f = String(statusFilter || "").toLowerCase();
  if (!f || f === "all") return true;
  const st = String(item.status || "").toLowerCase();
  if (f === "pending" || f === "in_review") return st === "pending";
  if (f === "approved") return item.approved === true || st === "approved" || st === "active";
  if (f === "rejected") return st === "rejected";
  if (f === "new") {
    if (st !== "pending") return false;
    const created = item.created_at ? new Date(item.created_at).getTime() : 0;
    if (!created) return true;
    return Date.now() - created < 48 * 60 * 60 * 1000;
  }
  return st === f;
}

function buildSummary(items) {
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let recentPending = 0;
  const now = Date.now();
  items.forEach((it) => {
    const st = String(it.status || "").toLowerCase();
    if (st === "pending") {
      pending += 1;
      const c = it.created_at ? new Date(it.created_at).getTime() : 0;
      if (!c || now - c < 48 * 60 * 60 * 1000) recentPending += 1;
    } else if (it.approved || st === "approved" || st === "active") approved += 1;
    else if (st === "rejected") rejected += 1;
  });
  return {
    new_requests: recentPending,
    in_review: pending,
    approved,
    rejected,
    total: items.length,
  };
}

async function loadRegistrationApprovalItems(sb, options = {}) {
  const typeFilter = options.type || "all";
  const statusFilter = options.status || "all";
  const items = [];

  const wantUsers =
    !typeFilter ||
    typeFilter === "all" ||
    typeFilter === "customer" ||
    typeFilter === "service" ||
    typeFilter === "transport";
  const wantStores = !typeFilter || typeFilter === "all" || typeFilter === "store";
  const wantDrivers = !typeFilter || typeFilter === "all" || typeFilter === "driver";

  if (wantUsers) {
    const roles =
      typeFilter === "service" || typeFilter === "transport"
        ? ["service"]
        : typeFilter === "customer"
          ? ["customer", "user"]
          : ["customer", "user", "service", "store", "merchant", "restaurant"];
    let q = await sb
      .from("users")
      .select("id, phone, role, status, name, service_type, service_district, created_at, updated_at")
      .in("role", roles)
      .order("created_at", { ascending: false })
      .limit(500);
    if (q.error && /name|service_district|column/i.test(String(q.error.message || ""))) {
      q = await sb
        .from("users")
        .select("id, phone, role, status, service_type, created_at, updated_at")
        .in("role", roles)
        .order("created_at", { ascending: false })
        .limit(500);
    }
    if (!q.error) {
      (q.data || []).forEach((u) => {
        const st = normalizeAccountStatus(u.status, u.role);
        if (typeFilter === "customer" && !["customer", "user"].includes(String(u.role || "").toLowerCase())) return;
        if (typeFilter === "service" && isTransportServiceType(u.service_type)) return;
        if (typeFilter === "transport" && !isTransportServiceType(u.service_type)) return;
        if (st === "blocked") return;
        items.push(mapUserRow(u));
      });
    }
  }

  if (wantStores) {
    const { data: stores, error: sErr } = await sb
      .from("stores")
      .select("id, name, phone, type, status, is_active, location_text, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!sErr) (stores || []).forEach((s) => items.push(mapStoreRow(s)));
  }

  if (wantDrivers) {
    const { data: drivers, error: dErr } = await sb
      .from("drivers")
      .select("id, name, phone, car_type, plate_number, status, active, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!dErr) (drivers || []).forEach((d) => items.push(mapDriverRow(d)));
  }

  items.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  const filtered = items.filter(
    (it) => matchesTypeFilter(it, typeFilter) && matchesStatusFilter(it, statusFilter)
  );

  return {
    summary: buildSummary(items),
    items: filtered,
    filters: { type: typeFilter, status: statusFilter },
  };
}

module.exports = {
  loadRegistrationApprovalItems,
  mapUserRow,
  mapStoreRow,
  mapDriverRow,
  normalizeDigits,
};
