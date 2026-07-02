/**
 * ERVENOW Marketing Engine — M1 Foundation
 * Home Experience Manager + schema قابل للتوسع (restaurants · stores · services · delivery)
 */

const fs = require("fs");
const path = require("path");

const ENGINE_VERSION = 1;
const SCHEMA_VERSION = 1;
const MODULE_STATUSES = Object.freeze(["visible", "hidden", "scheduled"]);
const TARGET_AUDIENCES = Object.freeze(["all", "guest", "logged_in"]);
const ANIMATIONS = Object.freeze(["none", "fade", "slide"]);
const SURFACES = Object.freeze(["home", "restaurants", "stores", "services", "delivery"]);

const dataRoot = path.join(__dirname, "..", "..", "data", "marketing");
const experiencesDir = path.join(dataRoot, "experiences");
const auditLogPath = path.join(dataRoot, "audit-log.json");
const AUDIT_LOG_MAX = 500;

function ensureDirs() {
  if (!fs.existsSync(experiencesDir)) fs.mkdirSync(experiencesDir, { recursive: true });
}

function experiencePath(surface) {
  return path.join(experiencesDir, `${String(surface || "").trim()}.json`);
}

function normalizeStatus(raw, visibleFallback) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (MODULE_STATUSES.includes(s)) return s;
  if (visibleFallback === true) return "visible";
  if (visibleFallback === false) return "hidden";
  return "visible";
}

function normalizeAnimation(raw) {
  const a = String(raw || "none")
    .trim()
    .toLowerCase();
  return ANIMATIONS.includes(a) ? a : "none";
}

function normalizeAudience(raw) {
  const a = String(raw || "all")
    .trim()
    .toLowerCase();
  return TARGET_AUDIENCES.includes(a) ? a : "all";
}

function normalizeCities(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .slice(0, 64);
}

function moduleRow(base, patch) {
  const src = { ...base, ...(patch || {}) };
  const visible = src.status === "visible" || (src.status !== "hidden" && src.status !== "scheduled" && src.visible !== false);
  return {
    id: String(src.id || "").trim(),
    name: String(src.name || src.id || "").trim(),
    name_ar: String(src.name_ar || src.name || src.id || "").trim(),
    visible: !!visible && src.status !== "hidden",
    priority: Number.isFinite(Number(src.priority)) ? Number(src.priority) : 50,
    display_order: Number.isFinite(Number(src.display_order)) ? Number(src.display_order) : 50,
    animation: normalizeAnimation(src.animation),
    target_audience: normalizeAudience(src.target_audience),
    cities: normalizeCities(src.cities),
    starts_at: src.starts_at ? String(src.starts_at) : null,
    ends_at: src.ends_at ? String(src.ends_at) : null,
    status: normalizeStatus(src.status, src.visible !== false),
    locked: !!src.locked,
    parent: String(src.parent || "body").trim() || "body",
    dom_slot: String(src.dom_slot || src.id || "").trim(),
    reorderable: src.reorderable !== false,
    drag_drop_ready: true,
  };
}

/** تعريفات الوحدات الافتراضية — الصفحة الرئيسية */
const HOME_MODULE_DEFS = Object.freeze([
  {
    id: "header",
    name: "Header",
    name_ar: "الهيدر",
    display_order: 10,
    priority: 100,
    status: "visible",
    locked: true,
    parent: "body",
    reorderable: false,
  },
  {
    id: "announcement_bar",
    name: "Announcement Bar",
    name_ar: "شريط الإعلانات",
    display_order: 15,
    priority: 90,
    status: "hidden",
    parent: "body",
  },
  {
    id: "hero_banner",
    name: "Hero Banner",
    name_ar: "البنر الرئيسي",
    display_order: 20,
    priority: 85,
    status: "visible",
    animation: "fade",
    parent: "body",
  },
  {
    id: "hub_section",
    name: "Hub Section",
    name_ar: "قسم الأقسام والثقة",
    display_order: 30,
    priority: 95,
    status: "visible",
    locked: true,
    parent: "body",
    reorderable: false,
  },
  {
    id: "hub_categories",
    name: "Hub Categories",
    name_ar: "أقسام المنصة",
    display_order: 30,
    priority: 100,
    status: "visible",
    locked: true,
    parent: "hub_section",
    reorderable: false,
  },
  {
    id: "trust_bar",
    name: "Trust Bar",
    name_ar: "شريط الثقة",
    display_order: 40,
    priority: 70,
    status: "visible",
    parent: "hub_section",
  },
  {
    id: "platform_stats",
    name: "Platform Stats",
    name_ar: "أرقام المنصة",
    display_order: 45,
    priority: 65,
    status: "visible",
    parent: "hub_section",
  },
  {
    id: "promotional_cards",
    name: "Promotional Cards",
    name_ar: "بطاقات ترويجية",
    display_order: 50,
    priority: 60,
    status: "hidden",
    parent: "main",
  },
  {
    id: "main",
    name: "Main Content",
    name_ar: "المحتوى الرئيسي",
    display_order: 80,
    priority: 90,
    status: "visible",
    locked: true,
    parent: "body",
    reorderable: false,
  },
  {
    id: "why_section",
    name: "Why ERVENOW",
    name_ar: "كيف تعمل المنصة",
    display_order: 70,
    priority: 55,
    status: "visible",
    parent: "main",
  },
  {
    id: "cta_cards",
    name: "CTA Cards",
    name_ar: "بطاقات التواصل والشراكة",
    display_order: 90,
    priority: 50,
    status: "visible",
    parent: "main",
  },
  {
    id: "featured_collections",
    name: "Featured Collections",
    name_ar: "مجموعات مميزة",
    display_order: 100,
    priority: 40,
    status: "hidden",
    parent: "main",
  },
  {
    id: "featured_merchants",
    name: "Featured Merchants",
    name_ar: "تجار مميزون",
    display_order: 110,
    priority: 35,
    status: "hidden",
    parent: "main",
  },
  {
    id: "app_promotion",
    name: "App Promotion",
    name_ar: "ترويج التطبيق",
    display_order: 120,
    priority: 30,
    status: "hidden",
    parent: "main",
  },
  {
    id: "footer_promotions",
    name: "Footer Promotions",
    name_ar: "عروض الفوتر",
    display_order: 125,
    priority: 25,
    status: "hidden",
    parent: "main",
  },
  {
    id: "footer",
    name: "Footer",
    name_ar: "الفوتر",
    display_order: 130,
    priority: 100,
    status: "visible",
    locked: true,
    parent: "body",
    reorderable: false,
  },
]);

const SURFACE_DEFAULTS = Object.freeze({
  home: HOME_MODULE_DEFS,
});

function buildDefaultExperience(surface) {
  const defs = SURFACE_DEFAULTS[surface];
  if (!defs) {
    throw new Error(`unsupported marketing surface: ${surface}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    experience_id: surface,
    experience_name: surface.charAt(0).toUpperCase() + surface.slice(1),
    experience_name_ar:
      surface === "home"
        ? "الصفحة الرئيسية"
        : surface === "restaurants"
          ? "المطاعم"
          : surface === "stores"
            ? "المتاجر"
            : surface === "services"
              ? "الخدمات"
              : surface === "delivery"
                ? "التوصيل"
                : surface,
    surface,
    drag_drop_ready: true,
    updated_at: new Date().toISOString(),
    modules: defs.map((d) => moduleRow(d, d)),
  };
}

function mergeModulesWithDefaults(surface, incoming) {
  const defaults = buildDefaultExperience(surface).modules;
  const byId = new Map(defaults.map((m) => [m.id, m]));
  const list = Array.isArray(incoming) ? incoming : [];
  for (const patch of list) {
    const id = String(patch?.id || "").trim();
    if (!id || !byId.has(id)) continue;
    byId.set(id, moduleRow(byId.get(id), patch));
  }
  return Array.from(byId.values()).sort((a, b) => a.display_order - b.display_order || a.priority - b.priority);
}

function readExperience(surface) {
  const key = String(surface || "home").trim();
  ensureDirs();
  const fp = experiencePath(key);
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    return {
      ...buildDefaultExperience(key),
      ...raw,
      schema_version: SCHEMA_VERSION,
      engine_version: ENGINE_VERSION,
      experience_id: key,
      surface: key,
      modules: mergeModulesWithDefaults(key, raw.modules),
      updated_at: raw.updated_at || new Date().toISOString(),
      drag_drop_ready: true,
    };
  } catch {
    const fresh = buildDefaultExperience(key);
    writeExperience(key, fresh, { skipAudit: true });
    return fresh;
  }
}

function readAuditLog(limit) {
  ensureDirs();
  const max = Math.min(Math.max(Number(limit) || 50, 1), AUDIT_LOG_MAX);
  try {
    const raw = JSON.parse(fs.readFileSync(auditLogPath, "utf8"));
    const items = Array.isArray(raw.items) ? raw.items : [];
    return items.slice(0, max);
  } catch {
    return [];
  }
}

function appendAuditEntries(entries) {
  if (!entries || !entries.length) return;
  ensureDirs();
  let items = [];
  try {
    const raw = JSON.parse(fs.readFileSync(auditLogPath, "utf8"));
    items = Array.isArray(raw.items) ? raw.items : [];
  } catch {
    items = [];
  }
  const stamped = entries.map((e) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...e,
  }));
  const next = [...stamped, ...items].slice(0, AUDIT_LOG_MAX);
  fs.writeFileSync(auditLogPath, JSON.stringify({ items: next }, null, 2), "utf8");
}

function diffModulesAudit(surface, before, after, actor) {
  const actorId = actor?.id ? String(actor.id) : null;
  const actorPhone = actor?.phone ? String(actor.phone) : null;
  const entries = [];
  const beforeMap = new Map((before || []).map((m) => [m.id, m]));
  for (const mod of after || []) {
    const prev = beforeMap.get(mod.id);
    if (!prev) continue;
    const fields = [
      "status",
      "visible",
      "display_order",
      "priority",
      "animation",
      "target_audience",
      "starts_at",
      "ends_at",
    ];
    for (const field of fields) {
      const oldVal = prev[field];
      const newVal = mod[field];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        entries.push({
          surface,
          module_id: mod.id,
          change_type: `module.${field}`,
          actor_id: actorId,
          actor_phone: actorPhone,
          previous_value: oldVal,
          new_value: newVal,
        });
      }
    }
    if (JSON.stringify(prev.cities) !== JSON.stringify(mod.cities)) {
      entries.push({
        surface,
        module_id: mod.id,
        change_type: "module.cities",
        actor_id: actorId,
        actor_phone: actorPhone,
        previous_value: prev.cities,
        new_value: mod.cities,
      });
    }
  }
  return entries;
}

function writeExperience(surface, data, options) {
  const key = String(surface || "home").trim();
  ensureDirs();
  const before = readExperience(key);
  const merged = {
    ...buildDefaultExperience(key),
    ...data,
    schema_version: SCHEMA_VERSION,
    engine_version: ENGINE_VERSION,
    experience_id: key,
    surface: key,
    drag_drop_ready: true,
    updated_at: new Date().toISOString(),
    modules: mergeModulesWithDefaults(key, data.modules),
  };
  fs.writeFileSync(experiencePath(key), JSON.stringify(merged, null, 2), "utf8");
  if (!options?.skipAudit && options?.actor) {
    const audit = diffModulesAudit(key, before.modules, merged.modules, options.actor);
    if (audit.length) appendAuditEntries(audit);
  }
  return merged;
}

function matchesAudience(mod, ctx) {
  const aud = mod.target_audience || "all";
  if (aud === "all") return true;
  if (aud === "guest") return !ctx?.isLoggedIn;
  if (aud === "logged_in") return !!ctx?.isLoggedIn;
  return true;
}

function matchesCity(mod, ctx) {
  const cities = mod.cities || [];
  if (!cities.length) return true;
  const userCity = String(ctx?.city || "").trim();
  if (!userCity) return true;
  return cities.some((c) => String(c).trim() === userCity);
}

function resolveModuleVisibility(mod, ctx) {
  if (mod.locked) {
    return { effective_status: "visible", resolved_visible: true };
  }
  if (!matchesAudience(mod, ctx) || !matchesCity(mod, ctx)) {
    return { effective_status: "hidden", resolved_visible: false };
  }
  const now = ctx?.now instanceof Date ? ctx.now : new Date();
  const status = normalizeStatus(mod.status, mod.visible !== false);
  if (status === "hidden") {
    return { effective_status: "hidden", resolved_visible: false };
  }
  if (status === "scheduled") {
    const start = mod.starts_at ? new Date(mod.starts_at) : null;
    const end = mod.ends_at ? new Date(mod.ends_at) : null;
    if (start && !Number.isNaN(start.getTime()) && now < start) {
      return { effective_status: "scheduled", resolved_visible: false };
    }
    if (end && !Number.isNaN(end.getTime()) && now > end) {
      return { effective_status: "scheduled", resolved_visible: false };
    }
    return { effective_status: "visible", resolved_visible: true };
  }
  return { effective_status: "visible", resolved_visible: true };
}

function buildPublicExperience(surface, ctx) {
  const exp = readExperience(surface);
  const modules = exp.modules
    .map((mod) => {
      const vis = resolveModuleVisibility(mod, ctx);
      return {
        ...mod,
        visible: vis.resolved_visible,
        effective_status: vis.effective_status,
        resolved_visible: vis.resolved_visible,
      };
    })
    .sort((a, b) => a.display_order - b.display_order || a.priority - b.priority);

  return {
    engine_version: ENGINE_VERSION,
    schema_version: SCHEMA_VERSION,
    surface: exp.surface,
    experience_id: exp.experience_id,
    experience_name: exp.experience_name,
    experience_name_ar: exp.experience_name_ar,
    updated_at: exp.updated_at,
    layout: {
      drag_drop_ready: true,
      parents: ["body", "hub_section", "main"],
    },
    modules,
  };
}

function updateExperienceModules(surface, modulesPatch, actor) {
  const current = readExperience(surface);
  const byId = new Map(current.modules.map((m) => [m.id, m]));
  for (const patch of modulesPatch || []) {
    const id = String(patch?.id || "").trim();
    if (!id || !byId.has(id)) continue;
    const prev = byId.get(id);
    if (prev.locked) {
      const allowed = ["display_order", "priority", "animation", "target_audience", "cities", "starts_at", "ends_at"];
      const safe = { id };
      for (const k of allowed) {
        if (patch[k] !== undefined) safe[k] = patch[k];
      }
      byId.set(id, moduleRow(prev, safe));
      continue;
    }
    byId.set(id, moduleRow(prev, patch));
  }
  return writeExperience(surface, { ...current, modules: Array.from(byId.values()) }, { actor });
}

module.exports = {
  ENGINE_VERSION,
  SCHEMA_VERSION,
  MODULE_STATUSES,
  TARGET_AUDIENCES,
  ANIMATIONS,
  SURFACES,
  HOME_MODULE_DEFS,
  buildDefaultExperience,
  readExperience,
  writeExperience,
  updateExperienceModules,
  resolveModuleVisibility,
  buildPublicExperience,
  readAuditLog,
  appendAuditEntries,
  diffModulesAudit,
  experiencePath,
  auditLogPath,
};
