const fs = require("fs");
const path = require("path");
const {
  saveLogoBase64,
  platformSettingsHelpMessage,
  isMissingPlatformSettingsTable,
} = require("./platformBrandingStore");

const SETTINGS_KEY = "guest_offers_carousel";
const MAX_SLIDES = 12;

const DEFAULT_OFFERS = {
  enabled: true,
  slides: [
    {
      id: "demo-restaurants",
      title: "عروض المطاعم",
      subtitle: "خصومات يومية من مطاعمك المفضلة",
      price_label: "من 15 ر.س",
      image_url:
        "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
      link_url: "/restaurants",
      link_label: "اطلب الآن",
      active: true,
      sort_order: 0,
    },
    {
      id: "demo-stores",
      title: "متاجر وسوبرماركت",
      subtitle: "توصيل سريع لاحتياجاتك اليومية",
      price_label: "عروض حصرية",
      image_url:
        "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=80",
      link_url: "/stores",
      link_label: "تسوق الآن",
      active: true,
      sort_order: 1,
    },
    {
      id: "demo-browse",
      title: "عروض المنصة",
      subtitle: "تصفّح أحدث الخصومات",
      price_label: "وفّر أكثر",
      image_url:
        "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=80",
      link_url: "/browse",
      link_label: "اكتشف العروض",
      active: true,
      sort_order: 2,
    },
  ],
};

function slugId() {
  return "off-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function normalizeSlide(raw, idx) {
  if (!raw || typeof raw !== "object") return null;
  const link = String(raw.link_url || raw.href || "/browse").trim() || "/browse";
  const safeLink = link.startsWith("/") || /^https?:\/\//i.test(link) ? link : "/browse";
  return {
    id: String(raw.id || slugId()).trim() || slugId(),
    title: String(raw.title || "").trim().slice(0, 80),
    subtitle: String(raw.subtitle || raw.description || "").trim().slice(0, 140),
    price_label: String(raw.price_label || raw.price || "").trim().slice(0, 40),
    image_url: String(raw.image_url || "").trim(),
    link_url: safeLink,
    link_label: String(raw.link_label || raw.cta || "عرض التفاصيل").trim().slice(0, 40) || "عرض التفاصيل",
    active: raw.active !== false && raw.active !== "false",
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : idx,
  };
}

function normalizeOffersPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const slidesIn = Array.isArray(src.slides) ? src.slides : [];
  const slides = slidesIn
    .map(function (s, i) {
      return normalizeSlide(s, i);
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    })
    .slice(0, MAX_SLIDES);
  return {
    enabled: src.enabled !== false && src.enabled !== "false",
    slides,
  };
}

function parseStoredJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

async function upsertSetting(sb, value) {
  const row = {
    key: SETTINGS_KEY,
    value: JSON.stringify(value),
    type: "json",
    description: "Guest dashboard offers carousel",
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("platform_settings").upsert(row, { onConflict: "key" });
  if (error && isMissingPlatformSettingsTable(error)) {
    throw new Error(platformSettingsHelpMessage(error));
  }
  if (error) throw error;
}

async function loadOffers(sb, { includeInactive = false } = {}) {
  if (!sb) return { ...DEFAULT_OFFERS, slides: DEFAULT_OFFERS.slides.slice() };
  try {
    const { data, error } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (error) {
      if (isMissingPlatformSettingsTable(error)) return { ...DEFAULT_OFFERS, slides: DEFAULT_OFFERS.slides.slice() };
      throw error;
    }
    const parsed = parseStoredJson(data && data.value);
    if (!parsed || !Array.isArray(parsed.slides) || !parsed.slides.length) {
      return { ...DEFAULT_OFFERS, slides: DEFAULT_OFFERS.slides.slice() };
    }
    const normalized = normalizeOffersPayload(parsed);
    if (!includeInactive) {
      normalized.slides = normalized.slides.filter(function (s) {
        return s.active !== false;
      });
    }
    if (!normalized.slides.length && parsed.enabled !== false) {
      return { ...DEFAULT_OFFERS, enabled: normalized.enabled, slides: DEFAULT_OFFERS.slides.slice() };
    }
    return normalized;
  } catch (e) {
    console.warn("[platformOffers] load:", e && (e.message || String(e)));
    return { ...DEFAULT_OFFERS, slides: DEFAULT_OFFERS.slides.slice() };
  }
}

async function saveOfferImage({ publicRoot, dataUrl, fileName, slideId }) {
  if (!publicRoot) throw new Error("publicRoot مطلوب لرفع صورة العرض");
  const safeId = String(slideId || slugId()).replace(/[^a-zA-Z0-9_-]/g, "");
  const baseName = String(fileName || "offer-" + safeId + ".jpg").replace(/[^a-zA-Z0-9._-]/g, "");
  const url = await saveLogoBase64({
    publicRoot,
    dataUrl,
    fileName: baseName,
    maxBytes: 3 * 1024 * 1024,
  });
  const ext = (baseName.match(/\.([a-z0-9]+)$/i) || [])[1] || "jpg";
  const dir = path.join(publicRoot, "uploads", "platform", "offers");
  await fs.promises.mkdir(dir, { recursive: true });
  const fromPath = path.join(publicRoot, "uploads", "platform", "logo." + ext);
  const toPath = path.join(dir, safeId + "." + ext);
  try {
    await fs.promises.copyFile(fromPath, toPath);
  } catch (_e) {
    return url;
  }
  return `/uploads/platform/offers/${safeId}.${ext}?v=${Date.now()}`;
}

async function applyOffersPatch(sb, patch, { publicRoot } = {}) {
  const current = await loadOffers(sb, { includeInactive: true });
  const body = patch && typeof patch === "object" ? patch : {};
  let slides = Array.isArray(body.slides) ? body.slides : current.slides;

  slides = await Promise.all(
    slides.map(async function (slide, idx) {
      const s = normalizeSlide(slide, idx);
      if (!s) return null;
      if (slide.imageFileBase64) {
        s.image_url = await saveOfferImage({
          publicRoot,
          dataUrl: slide.imageFileBase64,
          fileName: slide.imageFileName || "offer-" + s.id + ".jpg",
          slideId: s.id,
        });
      }
      return s;
    })
  );
  slides = slides.filter(Boolean).slice(0, MAX_SLIDES);

  const out = normalizeOffersPayload({
    enabled: body.enabled != null ? body.enabled : current.enabled,
    slides,
  });
  await upsertSetting(sb, out);
  return out;
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_OFFERS,
  loadOffers,
  applyOffersPatch,
  normalizeOffersPayload,
};
