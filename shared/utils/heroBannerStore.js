const fs = require("fs");
const path = require("path");
const { saveLogoBase64 } = require("./platformBrandingStore");
const {
  BANNER_TARGETS,
  normalizeBannerTargets,
  bannerHasTarget,
  getAdminSelectableTargets,
  normalizeBannerStatus,
  normalizeBannerType,
  normalizeDisplayMode,
  resolveDisplayMode,
  computeCtr,
  legacyPlacementToDisplayMode,
} = require("./bannerTargets");
const {
  normalizePlacement,
  placementToLegacyKind,
  BANNER_PLACEMENTS,
  DEFAULT_PLACEMENT,
} = require("./bannerPlacements");
const { BANNER_SPEC } = require("./bannerSpec");

const BANNER_KIND_PROMO = "promo";
const BANNER_KIND_PLATFORM = "platform";
const BANNER_KINDS = [BANNER_KIND_PROMO, BANNER_KIND_PLATFORM];

const BASE_COLS =
  "id,image_url,title,description,button1_text,button1_url,button2_text,button2_url,sort_order,is_active,starts_at,ends_at,created_at,updated_at";
const LEGACY_COLS = BASE_COLS + ",banner_kind,placement";
const V2_COLS =
  LEGACY_COLS +
  ",banner_targets,priority,status,banner_type,display_mode,impression_count,click_count";

function isHeroBannersTableMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /42P01|hero_banners|does not exist|schema cache/i.test(msg);
}

function isOptionalColumnMissing(err, col) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return new RegExp(col + "|column .* does not exist", "i").test(msg);
}

function normalizeBannerKind(value) {
  const k = String(value || "").trim().toLowerCase();
  return k === BANNER_KIND_PLATFORM ? BANNER_KIND_PLATFORM : BANNER_KIND_PROMO;
}

function normalizeUrl(url) {
  const link = String(url || "").trim();
  if (!link) return "";
  if (link.startsWith("/") || /^https?:\/\//i.test(link)) return link.slice(0, 2048);
  return ("/" + link).slice(0, 2048);
}

function parseOptionalDate(v) {
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function normalizePriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(999, Math.round(n)));
}

function legacyPlacementFromTargets(targets, displayMode) {
  const primary = (targets && targets[0]) || "home";
  if (primary === "visitor_dashboard") return "guest_dashboard";
  if (primary === "home") return displayMode === "carousel" ? "home_promo" : "home_hero";
  return "guest_dashboard";
}

function normalizeBannerRow(row) {
  if (!row || !row.id) return null;
  const banner_targets = normalizeBannerTargets(row.banner_targets, row.placement, row.banner_kind);
  const display_mode =
    row.display_mode != null && String(row.display_mode).trim()
      ? normalizeDisplayMode(row.display_mode)
      : legacyPlacementToDisplayMode(normalizePlacement(row.placement, row.banner_kind));
  let placement = normalizePlacement(row.placement, row.banner_kind);
  if (row.placement == null || String(row.placement).trim() === "") {
    placement = legacyPlacementFromTargets(banner_targets, resolveDisplayMode({ display_mode, image_url: row.image_url }));
  }
  const impressions = Number(row.impression_count) || 0;
  const clicks = Number(row.click_count) || 0;
  return {
    id: row.id,
    image_url: String(row.image_url || "").trim(),
    title: String(row.title || "").trim().slice(0, 200),
    description: String(row.description || "").trim().slice(0, 500),
    button1_text: String(row.button1_text || "").trim().slice(0, 60),
    button1_url: normalizeUrl(row.button1_url),
    button2_text: String(row.button2_text || "").trim().slice(0, 60),
    button2_url: normalizeUrl(row.button2_url),
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    priority: normalizePriority(row.priority),
    is_active: row.is_active !== false && row.is_active !== "false",
    status: normalizeBannerStatus(row.status || (row.is_active === false ? "paused" : "active")),
    banner_type: normalizeBannerType(row.banner_type),
    display_mode,
    banner_targets,
    placement,
    banner_kind: placementToLegacyKind(placement),
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    impression_count: impressions,
    click_count: clicks,
    ctr: computeCtr(impressions, clicks),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isBannerPublishable(banner, nowInput) {
  if (!banner) return false;
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
  const t = now.getTime();
  if (!Number.isFinite(t)) return false;

  const status = normalizeBannerStatus(banner.status);
  if (status === "paused") return false;
  if (banner.is_active === false && status === "active") return false;

  if (status === "scheduled" && !banner.starts_at) return false;

  if (banner.starts_at) {
    const s = new Date(banner.starts_at).getTime();
    if (Number.isFinite(s) && t < s) return false;
  }
  if (banner.ends_at) {
    const e = new Date(banner.ends_at).getTime();
    if (Number.isFinite(e) && t > e) return false;
  }
  return true;
}

/** @deprecated */
function isWithinSchedule(banner, now) {
  return isBannerPublishable(banner, now);
}

function sortBannersForDisplay(list) {
  return (list || [])
    .slice()
    .sort(function (a, b) {
      const pa = normalizePriority(a.priority);
      const pb = normalizePriority(b.priority);
      if (pa !== pb) return pa - pb;
      const sa = Number(a.sort_order) || 0;
      const sb = Number(b.sort_order) || 0;
      if (sa !== sb) return sa - sb;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
}

async function saveBannerImage({ publicRoot, dataUrl, fileName, bannerId }) {
  if (!publicRoot) throw new Error("publicRoot مطلوب لرفع صورة البنر");
  const safeId = String(bannerId || "hb-" + Date.now()).replace(/[^a-zA-Z0-9_-]/g, "") || "hb";
  const baseName = String(fileName || "hero-" + safeId + ".jpg").replace(/[^a-zA-Z0-9._-]/g, "");
  await saveLogoBase64({
    publicRoot,
    dataUrl,
    fileName: baseName,
    maxBytes: 3 * 1024 * 1024,
  });
  const ext = (baseName.match(/\.([a-z0-9]+)$/i) || [])[1] || "jpg";
  const dir = path.join(publicRoot, "uploads", "hero-banners");
  await fs.promises.mkdir(dir, { recursive: true });
  const fromPath = path.join(publicRoot, "uploads", "platform", "logo." + ext);
  const toPath = path.join(dir, safeId + "." + ext);
  try {
    await fs.promises.copyFile(fromPath, toPath);
  } catch (_e) {
    return `/uploads/platform/logo.${ext}?v=${Date.now()}`;
  }
  return `/uploads/hero-banners/${safeId}.${ext}?v=${Date.now()}`;
}

function resolveTargetsFromBody(body) {
  const src = body && typeof body === "object" ? body : {};
  if (src.banner_targets != null) {
    return normalizeBannerTargets(src.banner_targets, src.placement, src.banner_kind);
  }
  if (src.placement != null || src.banner_kind != null) {
    const placement = normalizePlacement(src.placement, src.banner_kind);
    return normalizeBannerTargets(null, placement, src.banner_kind);
  }
  return ["home"];
}

function buildPatch(body, { keepImageUrl, existing } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const patch = { updated_at: new Date().toISOString() };
  if (src.title != null) patch.title = String(src.title).trim().slice(0, 200);
  if (src.description != null) patch.description = String(src.description).trim().slice(0, 500);
  if (src.button1_text != null) patch.button1_text = String(src.button1_text).trim().slice(0, 60);
  if (src.button1_url != null) patch.button1_url = normalizeUrl(src.button1_url);
  if (src.button2_text != null) patch.button2_text = String(src.button2_text).trim().slice(0, 60);
  if (src.button2_url != null) patch.button2_url = normalizeUrl(src.button2_url);
  if (src.sort_order != null) {
    const n = Number(src.sort_order);
    patch.sort_order = Number.isFinite(n) ? n : 0;
  }
  if (src.priority != null) patch.priority = normalizePriority(src.priority);
  if (src.status != null) patch.status = normalizeBannerStatus(src.status);
  if (src.banner_type != null) patch.banner_type = normalizeBannerType(src.banner_type);
  if (src.display_mode != null) patch.display_mode = "carousel";
  if (src.is_active != null) {
    patch.is_active = src.is_active !== false && src.is_active !== "false";
    if (src.status == null && patch.is_active === false) patch.status = "paused";
    if (src.status == null && patch.is_active === true && existing && existing.status === "paused") {
      patch.status = "active";
    }
  }
  if (src.banner_targets != null || src.placement != null || src.banner_kind != null) {
    patch.banner_targets = resolveTargetsFromBody(src);
    const primary = patch.banner_targets[0] || "home";
    const legacyPlacement =
      primary === "visitor_dashboard"
        ? "guest_dashboard"
        : resolveDisplayMode({ display_mode: patch.display_mode || (existing && existing.display_mode) }) ===
            "carousel"
          ? "home_promo"
          : primary === "home"
            ? "home_hero"
            : "guest_dashboard";
    patch.placement = legacyPlacement;
    patch.banner_kind = placementToLegacyKind(legacyPlacement);
  }
  if (src.starts_at !== undefined) patch.starts_at = parseOptionalDate(src.starts_at);
  if (src.ends_at !== undefined) patch.ends_at = parseOptionalDate(src.ends_at);
  if (keepImageUrl) patch.image_url = keepImageUrl;
  return patch;
}

async function queryBanners(sb, cols, { includeInactive } = {}) {
  let q = sb.from("hero_banners").select(cols).order("priority", { ascending: true }).order("sort_order", { ascending: true });
  if (!includeInactive) q = q.neq("status", "paused");
  return q;
}

async function listBanners(sb, { includeInactive = false, placement = null, kind = null, target = null } = {}) {
  if (!sb) return [];

  async function run(cols) {
    return queryBanners(sb, cols, { includeInactive });
  }

  try {
    let res = await run(V2_COLS);
    if (res.error && (isOptionalColumnMissing(res.error, "banner_targets") || isOptionalColumnMissing(res.error, "priority"))) {
      res = await run(LEGACY_COLS);
    }
    if (res.error && isOptionalColumnMissing(res.error, "banner_kind")) {
      res = await run(BASE_COLS);
    }
    if (res.error) {
      if (isHeroBannersTableMissing(res.error)) return [];
      throw res.error;
    }
    let rows = (res.data || []).map(normalizeBannerRow).filter(Boolean);
    if (!includeInactive) {
      rows = rows.filter(function (b) {
        return b.status !== "paused" && b.is_active !== false;
      });
    }
    if (target) {
      rows = rows.filter(function (b) {
        return bannerHasTarget(b, target);
      });
    } else if (placement) {
      const p = normalizePlacement(placement);
      rows = rows.filter(function (b) {
        return b.placement === p;
      });
    } else if (kind != null) {
      rows = rows.filter(function (b) {
        return b.banner_kind === normalizeBannerKind(kind);
      });
    }
    return sortBannersForDisplay(rows);
  } catch (e) {
    if (isHeroBannersTableMissing(e)) return [];
    throw e;
  }
}

async function getPublishedBannersForTarget(sb, targetId, { now } = {}) {
  const rows = await listBanners(sb, { includeInactive: true, target: targetId });
  const when = now || new Date();
  return sortBannersForDisplay(rows.filter(function (b) {
    return isBannerPublishable(b, when);
  }));
}

async function getActiveBanners(sb, opts) {
  const rows = await listBanners(sb, Object.assign({}, opts, { includeInactive: false }));
  const when = new Date();
  return rows.filter(function (b) {
    return isBannerPublishable(b, when);
  });
}

async function getActiveBanner(sb, opts) {
  const rows = await getActiveBanners(sb, opts);
  return rows[0] || null;
}

async function getActiveBannersByTarget(sb) {
  const out = {};
  for (let i = 0; i < BANNER_TARGETS.length; i += 1) {
    const tid = BANNER_TARGETS[i].id;
    out[tid] = await getPublishedBannersForTarget(sb, tid);
  }
  return out;
}

async function getActiveBannersByPlacement(sb) {
  const byTarget = await getActiveBannersByTarget(sb);
  const home = byTarget.home || [];
  return {
    home_promo: home.filter(function (b) {
      return resolveDisplayMode(b) === "carousel";
    }),
    home_hero: home.filter(function (b) {
      return resolveDisplayMode(b) !== "carousel";
    }),
    guest_dashboard: byTarget.visitor_dashboard || [],
  };
}

async function getActiveBannersGrouped(sb) {
  const byPlacement = await getActiveBannersByPlacement(sb);
  return {
    promo: byPlacement.home_promo || [],
    platform: byPlacement.guest_dashboard || [],
  };
}

async function createBanner(sb, body, { publicRoot } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const title = String(src.title || "").trim();
  if (!title) throw new Error("العنوان الرئيسي مطلوب");
  const banner_targets = resolveTargetsFromBody(src);
  if (!banner_targets.length) throw new Error("اختر مكان ظهور واحد على الأقل");
  const display_mode = "carousel";
  const primary = banner_targets[0];
  const placement =
    primary === "visitor_dashboard"
      ? "guest_dashboard"
      : primary === "home"
        ? "home_promo"
        : "guest_dashboard";
  const now = new Date().toISOString();
  let image_url = String(src.image_url || "").trim();
  if (src.imageFileBase64) {
    image_url = await saveBannerImage({
      publicRoot,
      dataUrl: src.imageFileBase64,
      fileName: src.imageFileName || "hero.jpg",
      bannerId: "new-" + Date.now(),
    });
  }
  const row = {
    image_url: image_url || null,
    title: title.slice(0, 200),
    description: String(src.description || "").trim().slice(0, 500),
    button1_text: String(src.button1_text || "").trim().slice(0, 60) || null,
    button1_url: normalizeUrl(src.button1_url) || null,
    button2_text: String(src.button2_text || "").trim().slice(0, 60) || null,
    button2_url: normalizeUrl(src.button2_url) || null,
    sort_order: Number.isFinite(Number(src.sort_order)) ? Number(src.sort_order) : 0,
    priority: normalizePriority(src.priority),
    status: normalizeBannerStatus(src.status || (src.is_active === false ? "paused" : "active")),
    banner_type: normalizeBannerType(src.banner_type),
    display_mode,
    banner_targets,
    is_active: src.is_active !== false && src.is_active !== "false",
    placement,
    banner_kind: placementToLegacyKind(placement),
    starts_at: parseOptionalDate(src.starts_at),
    ends_at: parseOptionalDate(src.ends_at),
    impression_count: 0,
    click_count: 0,
    created_at: now,
    updated_at: now,
  };

  let { data, error } = await sb.from("hero_banners").insert(row).select(V2_COLS).maybeSingle();
  if (error && isOptionalColumnMissing(error, "banner_targets")) {
    delete row.banner_targets;
    delete row.priority;
    delete row.status;
    delete row.banner_type;
    delete row.display_mode;
    delete row.impression_count;
    delete row.click_count;
    ({ data, error } = await sb.from("hero_banners").insert(row).select(LEGACY_COLS).maybeSingle());
  }
  if (error) {
    if (isHeroBannersTableMissing(error)) {
      throw new Error("جدول hero_banners غير موجود — نفّذ: npm run migrate:hero-banners");
    }
    throw error;
  }
  return normalizeBannerRow(data);
}

async function updateBanner(sb, id, body, { publicRoot } = {}) {
  const bannerId = String(id || "").trim();
  if (!bannerId) throw new Error("معرّف البنر مطلوب");

  let { data: existing, error: fetchErr } = await sb
    .from("hero_banners")
    .select(V2_COLS)
    .eq("id", bannerId)
    .maybeSingle();
  if (fetchErr && isOptionalColumnMissing(fetchErr, "banner_targets")) {
    ({ data: existing, error: fetchErr } = await sb.from("hero_banners").select(LEGACY_COLS).eq("id", bannerId).maybeSingle());
  }
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error("البنر غير موجود");

  const patch = buildPatch(body, { keepImageUrl: existing.image_url, existing: normalizeBannerRow(existing) });
  if (body && body.imageFileBase64) {
    patch.image_url = await saveBannerImage({
      publicRoot,
      dataUrl: body.imageFileBase64,
      fileName: body.imageFileName || "hero-" + bannerId + ".jpg",
      bannerId,
    });
  } else if (body && body.image_url != null) {
    patch.image_url = String(body.image_url).trim() || null;
  }

  let { data, error } = await sb.from("hero_banners").update(patch).eq("id", bannerId).select(V2_COLS).maybeSingle();
  if (error && isOptionalColumnMissing(error, "banner_targets")) {
    delete patch.banner_targets;
    delete patch.priority;
    delete patch.status;
    delete patch.banner_type;
    delete patch.display_mode;
    ({ data, error } = await sb.from("hero_banners").update(patch).eq("id", bannerId).select(LEGACY_COLS).maybeSingle());
  }
  if (error) throw error;
  return normalizeBannerRow(data);
}

async function deleteBanner(sb, id) {
  const bannerId = String(id || "").trim();
  if (!bannerId) throw new Error("معرّف البنر مطلوب");
  const { error } = await sb.from("hero_banners").delete().eq("id", bannerId);
  if (error) throw error;
  return { ok: true, id: bannerId };
}

async function recordBannerImpression(sb, id) {
  const bannerId = String(id || "").trim();
  if (!bannerId || !sb) return { ok: false };
  const { data, error } = await sb.from("hero_banners").select("impression_count").eq("id", bannerId).maybeSingle();
  if (error || !data) return { ok: false };
  const next = (Number(data.impression_count) || 0) + 1;
  await sb.from("hero_banners").update({ impression_count: next, updated_at: new Date().toISOString() }).eq("id", bannerId);
  return { ok: true, impression_count: next };
}

async function recordBannerClick(sb, id) {
  const bannerId = String(id || "").trim();
  if (!bannerId || !sb) return { ok: false };
  const { data, error } = await sb
    .from("hero_banners")
    .select("click_count,impression_count")
    .eq("id", bannerId)
    .maybeSingle();
  if (error || !data) return { ok: false };
  const clicks = (Number(data.click_count) || 0) + 1;
  await sb.from("hero_banners").update({ click_count: clicks, updated_at: new Date().toISOString() }).eq("id", bannerId);
  return {
    ok: true,
    click_count: clicks,
    ctr: computeCtr(data.impression_count, clicks),
  };
}

module.exports = {
  BANNER_KIND_PROMO,
  BANNER_KIND_PLATFORM,
  BANNER_KINDS,
  BANNER_PLACEMENTS,
  BANNER_TARGETS,
  BANNER_SPEC,
  DEFAULT_PLACEMENT,
  V2_COLS,
  normalizeBannerKind,
  normalizePlacement,
  getAdminSelectablePlacements: getAdminSelectableTargets,
  getAdminSelectableTargets,
  getPlacementMeta: require("./bannerTargets").getTargetMeta,
  isHeroBannersTableMissing,
  isWithinSchedule,
  isBannerPublishable,
  sortBannersForDisplay,
  listBanners,
  getActiveBanner,
  getActiveBanners,
  getPublishedBannersForTarget,
  getActiveBannersByTarget,
  getActiveBannersByPlacement,
  getActiveBannersGrouped,
  createBanner,
  updateBanner,
  deleteBanner,
  normalizeBannerRow,
  recordBannerImpression,
  recordBannerClick,
  computeCtr,
};
