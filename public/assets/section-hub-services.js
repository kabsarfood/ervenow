(function () {
  "use strict";

  var SERVICE_CATEGORIES = [
    { id: "plumber", icon: "🔧", label: "سباك" },
    { id: "electrician", icon: "⚡", label: "كهربائي" },
    { id: "nursery", icon: "🪴", label: "مشتل" },
    { id: "agricultural_engineer", icon: "🌾", label: "مهندس زراعي" },
    { id: "pickup_truck", icon: "🛻", label: "سائق سطحى" },
    { id: "ac_technician", icon: "❄️", label: "فني مكيفات" },
    { id: "cleaning_villa", icon: "🧼", label: "غسيل درج فيلا" },
    { id: "cleaning_building", icon: "🏢", label: "غسيل درج عمارة" },
  ];

  var HOME_SERVICE_TYPES = {
    plumber: 1,
    electrician: 1,
    nursery: 1,
    agricultural_engineer: 1,
    pickup_truck: 1,
    laundry_estates: 1,
    ac_technician: 1,
    cleaning: 1,
    cleaning_villa: 1,
    cleaning_building: 1,
    services: 1,
  };

  var MARKET_TYPES = {
    supermarket: 1,
    minimarket: 1,
    vegetables: 1,
    butcher: 1,
    fish: 1,
    sweets: 1,
    flowers_gifts: 1,
    home_business: 1,
  };

  function storeBucket(store) {
    var t = String(store.type || store.category || "").toLowerCase();
    if (t === "restaurant") return "restaurant";
    if (t === "pharmacy") return "pharmacy";
    if (MARKET_TYPES[t]) return "market";
    return "service";
  }

  function isHomeServiceStore(store) {
    var t = String(store.type || store.category || "").toLowerCase();
    if (t === "restaurant") return false;
    if (MARKET_TYPES[t]) return false;
    if (t === "pharmacy") return false;
    if (HOME_SERVICE_TYPES[t]) return true;
    return storeBucket(store) === "service";
  }

  function storeMatchesServiceFilter(store, filter) {
    var t = String(store.type || store.category || "").toLowerCase();
    var cat = String(store.category || "").toLowerCase();
    if (!isHomeServiceStore(store)) return false;
    if (!filter) return true;
    if (t === filter) return true;
    if (filter === "cleaning_villa" && t === "cleaning") return true;
    if (t === "services" && cat === filter) return true;
    return cat === filter;
  }

  function syncServiceHeader(cat) {
    var sub = document.getElementById("servicesHeaderSub");
    if (!sub) return;
    if (!cat) {
      sub.textContent = "سباك، كهرباء، تكييف، تنظيف، وأكثر — احجز بخطوات بسيطة";
      return;
    }
    for (var i = 0; i < SERVICE_CATEGORIES.length; i++) {
      if (SERVICE_CATEGORIES[i].id === cat) {
        sub.textContent = SERVICE_CATEGORIES[i].label + " — احجز بخطوات بسيطة";
        return;
      }
    }
  }

  ErvenowSectionHub.init({
    entityPlural: "مقدّمو خدمات",
    ctaLabel: "عرض الخدمة",
    searchPlaceholder: "ابحث باسم مقدّم الخدمة…",
    emptyNoneTitle: "لا مقدّمي خدمات معروضين بعد",
    urlTypeKey: "type",
    guestNoteId: "guestNote",
    catBarId: "storesCategoryBar",
    categories: SERVICE_CATEGORIES,
    filterStore: isHomeServiceStore,
    matchCategory: storeMatchesServiceFilter,
    buildApiParams: function () {
      return ["type=service"];
    },
    onCategoryChange: function (cat) {
      syncServiceHeader(cat === "all" ? "" : cat);
      if (window.__svcSelectOrderType) window.__svcSelectOrderType(cat || "all");
    },
    onOpenStore: function (id, store) {
      if (window.ErvenowMobileServicesFlow && ErvenowMobileServicesFlow.isMobile()) {
        var name = store && (store.name || store.label);
        ErvenowMobileServicesFlow.openSheet(name ? String(name).trim() : "");
        if (store && store.type) {
          var t = String(store.type || store.category || "").toLowerCase();
          if (t === "cleaning") t = "cleaning_villa";
          if (window.__svcSelectOrderType) window.__svcSelectOrderType(t || "all");
        }
        return;
      }
      window.location.href = "/store.html?id=" + encodeURIComponent(id);
    },
    onUrlParams: function (p) {
      var type = String(p.get("type") || "").trim().toLowerCase();
      if (type === "restaurant") {
        location.replace("/restaurants");
        return;
      }
      var marketTypes = ["supermarket", "pharmacy", "vegetables", "flowers_gifts", "sweets", "home_business"];
      if (marketTypes.indexOf(type) !== -1) {
        location.replace("/stores?type=" + encodeURIComponent(type === "minimarket" ? "supermarket" : type));
        return;
      }
      if (type === "cleaning") type = "cleaning_villa";
      if (type === "service" || type === "services") type = "";
      var valid = SERVICE_CATEGORIES.map(function (c) {
        return c.id;
      });
      if (valid.indexOf(type) !== -1) {
        syncServiceHeader(type);
        if (window.__svcSelectOrderType) window.__svcSelectOrderType(type || "all");
      }
    },
  });
})();
