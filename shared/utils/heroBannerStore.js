const fs = require("fs");
const path = require("path");
const { saveLogoBase64 } = require("./platformBrandingStore");

const SELECT_COLS =
  "id,image_url,title,description,button1_text,button1_url,button2_text,button2_url,sort_order,is_active,starts_at,ends_at,created_at,updated_at";

function isHeroBannersTableMissing(err) {
  if (!err) return false;
  const msg = String(err.message || err.details || "");
  return /42P01|hero_banners|does not exist|schema cache/i.test(msg);
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

function normalizeBannerRow(row) {
  if (!row || !row.id) return null;
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
    is_active: row.is_active !== false && row.is_active !== "false",
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isWithinSchedule(banner, now = new Date()) {
  if (!banner || !banner.is_active) return false;
  const t = now.getTime();
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

function buildPatch(body, { keepImageUrl } = {}) {
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
  if (src.is_active != null) patch.is_active = src.is_active !== false && src.is_active !== "false";
  if (src.starts_at !== undefined) patch.starts_at = parseOptionalDate(src.starts_at);
  if (src.ends_at !== undefined) patch.ends_at = parseOptionalDate(src.ends_at);
  if (keepImageUrl) patch.image_url = keepImageUrl;
  return patch;
}

async function listBanners(sb, { includeInactive = false } = {}) {
  if (!sb) return [];
  try {
    let q = sb.from("hero_banners").select(SELECT_COLS).order("sort_order", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) {
      if (isHeroBannersTableMissing(error)) return [];
      throw error;
    }
    return (data || []).map(normalizeBannerRow).filter(Boolean);
  } catch (e) {
    if (isHeroBannersTableMissing(e)) return [];
    throw e;
  }
}

async function getActiveBanner(sb) {
  const rows = await getActiveBanners(sb);
  return rows[0] || null;
}

async function getActiveBanners(sb) {
  const rows = await listBanners(sb, { includeInactive: false });
  return rows.filter(function (b) {
    return isWithinSchedule(b);
  });
}

async function createBanner(sb, body, { publicRoot } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const title = String(src.title || "").trim();
  if (!title) throw new Error("العنوان الرئيسي مطلوب");
  const now = new Date().toISOString();
  let image_url = String(src.image_url || "").trim();
  if (src.imageFileBase64) {
    const tempId = "new-" + Date.now();
    image_url = await saveBannerImage({
      publicRoot,
      dataUrl: src.imageFileBase64,
      fileName: src.imageFileName || "hero.jpg",
      bannerId: tempId,
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
    is_active: src.is_active !== false && src.is_active !== "false",
    starts_at: parseOptionalDate(src.starts_at),
    ends_at: parseOptionalDate(src.ends_at),
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await sb.from("hero_banners").insert(row).select(SELECT_COLS).maybeSingle();
  if (error) {
    if (isHeroBannersTableMissing(error)) {
      throw new Error("جدول hero_banners غير موجود — نفّذ: npm run migrate:hero-banners أو shared/migration_hero_banners.sql في SQL Editor");
    }
    throw error;
  }
  return normalizeBannerRow(data);
}

async function updateBanner(sb, id, body, { publicRoot } = {}) {
  const bannerId = String(id || "").trim();
  if (!bannerId) throw new Error("معرّف البنر مطلوب");
  const { data: existing, error: fetchErr } = await sb
    .from("hero_banners")
    .select(SELECT_COLS)
    .eq("id", bannerId)
    .maybeSingle();
  if (fetchErr) {
    if (isHeroBannersTableMissing(fetchErr)) {
      throw new Error("جدول hero_banners غير موجود — نفّذ: npm run migrate:hero-banners أو shared/migration_hero_banners.sql في SQL Editor");
    }
    throw fetchErr;
  }
  if (!existing) throw new Error("البنر غير موجود");
  const patch = buildPatch(body, { keepImageUrl: existing.image_url });
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
  const { data, error } = await sb
    .from("hero_banners")
    .update(patch)
    .eq("id", bannerId)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw error;
  return normalizeBannerRow(data);
}

async function deleteBanner(sb, id) {
  const bannerId = String(id || "").trim();
  if (!bannerId) throw new Error("معرّف البنر مطلوب");
  const { error } = await sb.from("hero_banners").delete().eq("id", bannerId);
  if (error) {
    if (isHeroBannersTableMissing(error)) {
      throw new Error("جدول hero_banners غير موجود — نفّذ: npm run migrate:hero-banners أو shared/migration_hero_banners.sql في SQL Editor");
    }
    throw error;
  }
  return { ok: true, id: bannerId };
}

module.exports = {
  SELECT_COLS,
  isHeroBannersTableMissing,
  isWithinSchedule,
  listBanners,
  getActiveBanner,
  getActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  normalizeBannerRow,
};
