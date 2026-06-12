(function () {
  "use strict";

  var STORE_CATEGORIES = [
    { id: "supermarket", icon: "🛒", label: "سوبر ماركت" },
    { id: "pharmacy", icon: "💊", label: "صيدليات" },
    { id: "vegetables", icon: "🥬", label: "خضار" },
    { id: "flowers_gifts", icon: "💐", label: "ورود وهدايا" },
    { id: "sweets", icon: "🍰", label: "حلويات" },
    { id: "home_business", icon: "🏠", label: "أسر منتجة" },
  ];

  function storeMatchesCategoryFilter(store, filter) {
    var t = String(store.type || store.category || "").toLowerCase();
    if (!filter) return t !== "restaurant";
    if (filter === "supermarket") return t === "supermarket" || t === "minimarket";
    if (filter === "pharmacy") return t === "pharmacy";
    if (filter === "vegetables") return t === "vegetables";
    if (filter === "flowers_gifts") return t === "flowers_gifts";
    if (filter === "sweets") return t === "sweets";
    if (filter === "home_business") return t === "home_business";
    return t === filter && t !== "restaurant";
  }

  ErvenowSectionHub.init({
    entityPlural: "متاجر",
    ctaLabel: "عرض المتجر",
    searchPlaceholder: "ابحث باسم المتجر…",
    emptyNoneTitle: "لا متاجر معروضة بعد",
    urlTypeKey: "type",
    guestNoteId: "guestNote",
    catBarId: "storesCategoryBar",
    categories: STORE_CATEGORIES,
    filterStore: function (s) {
      return storeMatchesCategoryFilter(s, "");
    },
    matchCategory: storeMatchesCategoryFilter,
    buildApiParams: function (cat) {
      if (cat) return ["type=" + encodeURIComponent(cat)];
      return [];
    },
  });
})();
