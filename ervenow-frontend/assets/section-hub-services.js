(function () {
  "use strict";

  var SERVICE_CATEGORIES = [
    { id: "car_polishing", label: "تلميع المركبات", image: "/assets/ervenow-car-sedan.png" },
    { id: "plumber", label: "سباك", image: "/assets/services/plumber.png" },
    { id: "electrician", label: "كهربائي", image: "/assets/services/electrician.png" },
    { id: "agricultural_engineer", label: "مهندس زراعي", image: "/assets/services/agricultural_engineer.png" },
    { id: "ac_technician", label: "فني مكيفات", image: "/assets/services/ac_technician.png" },
    { id: "cleaning_villa", label: "غسيل درج فيلا", image: "/assets/services/cleaning_villa.png" },
    { id: "cleaning_building", label: "غسيل درج عمارة", image: "/assets/services/cleaning_building.png" },
  ];

  var HOME_SERVICE_TYPES = {
    plumber: 1,
    electrician: 1,
    nursery: 1,
    agricultural_engineer: 1,
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
    if (filter === "agricultural_engineer" && (t === "nursery" || cat === "nursery")) return true;
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
      if (cat === "car_polishing") {
        location.href = "/car-polishing.html";
        return;
      }
      if (cat && cat !== "all" && window.ErvenowServiceBook && ErvenowServiceBook.isBookableType(cat)) {
        location.href = ErvenowServiceBook.serviceBookUrl(cat);
        return;
      }
    },
    onOpenStore: function (id, store) {
      var t = store && String(store.type || store.category || "").toLowerCase();
      if (t === "cleaning") t = "cleaning_villa";
      if (t === "nursery") t = "agricultural_engineer";
      if (t === "car_polishing") {
        location.href = "/car-polishing.html";
        return;
      }
      if (window.ErvenowServiceBook && ErvenowServiceBook.isBookableType(t)) {
        location.href = ErvenowServiceBook.serviceBookUrl(t);
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
      if (type === "nursery") type = "agricultural_engineer";
      if (type === "car_polishing") {
        location.replace("/car-polishing.html");
        return;
      }
      if (type === "pickup_truck" || type === "vehicle_transfer" || type === "car_transport") {
        location.replace("/delivery-services.html?service=car_transport");
        return;
      }
      if (type === "service" || type === "services") type = "";
      var valid = SERVICE_CATEGORIES.map(function (c) {
        return c.id;
      });
      if (valid.indexOf(type) !== -1) {
        syncServiceHeader(type);
        if (type === "car_polishing") {
          location.replace("/car-polishing.html");
          return;
        }
        if (window.ErvenowServiceBook && ErvenowServiceBook.isBookableType(type)) {
          location.replace(ErvenowServiceBook.serviceBookUrl(type));
        }
      }
    },
  });
})();
