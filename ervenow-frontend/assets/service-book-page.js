(function (global) {
  "use strict";

  var SERVICE_IMG_BASE = "/assets/services";

  var BOOKABLE_TYPES = [
    "plumber",
    "electrician",
    "ac_technician",
    "agricultural_engineer",
    "cleaning_villa",
    "cleaning_building",
  ];

  var DEFAULT_SERVICE_SUBTYPES = {
    plumber: [
      { code: "leak_repair", label: "إصلاح تسريب" },
      { code: "unclog", label: "تسليك" },
      { code: "faucet_install", label: "تركيب خلاط" },
      { code: "toilet_install", label: "تركيب كرسي" },
      { code: "heater_install", label: "تركيب سخان" },
      { code: "other", label: "أخرى" },
    ],
    electrician: [
      { code: "fault_repair", label: "إصلاح أعطال" },
      { code: "lighting_install", label: "تركيب إنارة" },
      { code: "outlet_install", label: "تركيب أفياش" },
      { code: "breaker_install", label: "تركيب قواطع" },
      { code: "other", label: "أخرى" },
    ],
    ac_technician: [
      { code: "cleaning", label: "تنظيف" },
      { code: "freon_refill", label: "تعبئة فريون" },
      { code: "maintenance", label: "صيانة" },
      { code: "removal", label: "فك" },
      { code: "installation", label: "تركيب" },
      { code: "removal_install", label: "فك وتركيب" },
    ],
    agricultural_engineer: [
      { code: "planting", label: "تشجير" },
      { code: "tree_trimming", label: "قص أشجار" },
      { code: "irrigation_net", label: "شبكة ري" },
      { code: "garden_design", label: "تنسيق حدائق" },
      { code: "maintenance", label: "صيانة" },
    ],
  };

  var FALLBACK_CATALOG = {
    plumber: {
      label: "سباك",
      image: SERVICE_IMG_BASE + "/plumber.png",
      price: 60,
      priceLabel: "60 ريال معاينة وتقييم",
      inspectionOnly: true,
      desc: "معاينة وتقييم الأعطال — يُحسب الإصلاح لاحقاً.",
    },
    electrician: {
      label: "كهربائي",
      image: SERVICE_IMG_BASE + "/electrician.png",
      price: 60,
      priceLabel: "60 ريال معاينة وتقييم",
      inspectionOnly: true,
      desc: "معاينة وتقييم الأعطال الكهربائية.",
    },
    ac_technician: {
      label: "فني مكيفات",
      image: SERVICE_IMG_BASE + "/ac_technician.png",
      price: 60,
      priceLabel: "60 ريال معاينة وتقييم",
      inspectionOnly: true,
      desc: "معاينة وتقييم أعطال المكيف.",
    },
    agricultural_engineer: {
      label: "مهندس زراعي",
      image: SERVICE_IMG_BASE + "/agricultural_engineer.png",
      price: 60,
      priceLabel: "60 ريال معاينة وتقييم",
      inspectionOnly: true,
      desc: "معاينة الموقع والنباتات.",
    },
    cleaning_villa: {
      label: "غسيل درج فيلا",
      image: SERVICE_IMG_BASE + "/cleaning_villa.png",
      price: 60,
      priceLabel: "60 ريال ثابت",
      inspectionOnly: false,
      desc: "غسيل درج فيلا — سعر ثابت.",
    },
    cleaning_building: {
      label: "غسيل درج عمارة",
      image: SERVICE_IMG_BASE + "/cleaning_building.png",
      price: 120,
      priceLabel: "120 ريال (3 أدوار)",
      inspectionOnly: false,
      desc: "غسيل درج عمارة حتى 3 أدوار.",
    },
  };

  function normalizeType(raw) {
    var t = String(raw || "").trim().toLowerCase();
    if (t === "cleaning") return "cleaning_villa";
    if (t === "nursery") return "agricultural_engineer";
    return t;
  }

  function isBookableType(type) {
    return BOOKABLE_TYPES.indexOf(normalizeType(type)) !== -1;
  }

  function catalogImageUrl(type) {
    return SERVICE_IMG_BASE + "/" + normalizeType(type) + ".png";
  }

  function subtypeImageUrl(serviceType, code) {
    return SERVICE_IMG_BASE + "/" + normalizeType(serviceType) + "/" + String(code || "").trim() + ".png";
  }

  function attachSubtypeImages(type, list) {
    return (list || []).map(function (row) {
      return Object.assign({}, row, {
        image: row.image || subtypeImageUrl(type, row.code),
      });
    });
  }

  function enrichSubtypesMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (type) {
      out[type] = attachSubtypeImages(type, map[type]);
    });
    return out;
  }

  DEFAULT_SERVICE_SUBTYPES = enrichSubtypesMap(DEFAULT_SERVICE_SUBTYPES);

  function serviceBookUrl(type) {
    var t = normalizeType(type);
    if (t === "car_polishing") return "/car-polishing.html";
    if (!isBookableType(t)) return "/services";
    return "/service-book.html?type=" + encodeURIComponent(t);
  }

  function serviceCardImageHtml(entry, className) {
    var cls = className || "svc-order-card__img";
    var img = entry && entry.image ? String(entry.image) : entry && entry.type ? catalogImageUrl(entry.type) : "";
    var alt = (entry && (entry.label || entry.title)) || "خدمة";
    if (!img) return "";
    return (
      '<img class="' +
      cls +
      '" src="' +
      img +
      '" alt="' +
      alt.replace(/"/g, "&quot;") +
      '" loading="lazy" />'
    );
  }

  function subtypeCardMediaHtml(row, serviceType) {
    var img =
      (row && row.image) ||
      (serviceType && row && row.code ? subtypeImageUrl(serviceType, row.code) : "");
    if (!img) return "";
    return (
      '<span class="sb-subtype-card__media">' +
      '<img class="sb-subtype-card__img" src="' +
      img +
      '" alt="' +
      String((row && row.label) || "").replace(/"/g, "&quot;") +
      '" loading="lazy" /></span>'
    );
  }

  function applyHeroMedia(opts) {
    opts = opts || {};
    var imgEl = opts.imgEl;
    var fallbackEl = opts.fallbackEl;
    if (!imgEl) return;
    var src = opts.src || "";
    if (src) {
      imgEl.src = src;
      imgEl.alt = opts.alt || "";
      imgEl.hidden = false;
      if (fallbackEl) fallbackEl.hidden = true;
      imgEl.onerror = function () {
        imgEl.hidden = true;
        if (fallbackEl) fallbackEl.hidden = false;
      };
    } else {
      imgEl.removeAttribute("src");
      imgEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = false;
    }
  }

  function subtypePickHtml(row, serviceType) {
    if (!row) return "";
    var img =
      row.image || (serviceType && row.code ? subtypeImageUrl(serviceType, row.code) : "");
    if (img) {
      return (
        '<img class="sb-subtype-pick__img" src="' +
        img +
        '" alt="" loading="lazy" /> ' +
        row.label
      );
    }
    return row.label;
  }

  global.ErvenowServiceBook = {
    SERVICE_IMG_BASE: SERVICE_IMG_BASE,
    BOOKABLE_TYPES: BOOKABLE_TYPES,
    DEFAULT_SERVICE_SUBTYPES: DEFAULT_SERVICE_SUBTYPES,
    FALLBACK_CATALOG: FALLBACK_CATALOG,
    normalizeType: normalizeType,
    isBookableType: isBookableType,
    catalogImageUrl: catalogImageUrl,
    subtypeImageUrl: subtypeImageUrl,
    attachSubtypeImages: attachSubtypeImages,
    serviceBookUrl: serviceBookUrl,
    serviceCardImageHtml: serviceCardImageHtml,
    subtypeCardMediaHtml: subtypeCardMediaHtml,
    applyHeroMedia: applyHeroMedia,
    subtypePickHtml: subtypePickHtml,
  };
})(window);
