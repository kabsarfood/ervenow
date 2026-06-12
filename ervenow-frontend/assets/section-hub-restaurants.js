(function () {
  "use strict";

  function storeCountsAsRestaurant(store) {
    if (window.ErvenowRestaurantCuisines && ErvenowRestaurantCuisines.storeCountsAsRestaurant) {
      return ErvenowRestaurantCuisines.storeCountsAsRestaurant(store);
    }
    return String(store.type || "").toLowerCase() === "restaurant";
  }

  function storeMatchesCuisineChip(store, slug) {
    if (window.ErvenowRestaurantCuisines && ErvenowRestaurantCuisines.storeMatchesCuisineChip) {
      return ErvenowRestaurantCuisines.storeMatchesCuisineChip(store, slug);
    }
    if (!slug) return storeCountsAsRestaurant(store);
    return storeCountsAsRestaurant(store) && String(store.category || "").toLowerCase() === slug;
  }

  function loadRestaurantCategories() {
    var fallback = function () {
      if (window.ErvenowRestaurantCuisines && ErvenowRestaurantCuisines.list) {
        return ErvenowRestaurantCuisines.list.map(function (c) {
          return { id: c.slug, icon: c.icon || "▫", label: c.label || c.slug };
        });
      }
      return [];
    };
    if (!window.PlatformAPI || !PlatformAPI.apiUrl) return Promise.resolve(fallback());
    return fetch(PlatformAPI.apiUrl("/api/categories?type=restaurant&list=canonical&sort=manual"))
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.categories) || [];
        if (!list.length) return fallback();
        return list.map(function (c) {
          return { id: c.slug, icon: c.icon || "▫", label: c.name_ar || c.label_ar || c.slug };
        });
      })
      .catch(function () {
        return fallback();
      });
  }

  ErvenowSectionHub.init({
    entityPlural: "مطاعم",
    ctaLabel: "عرض المطعم",
    searchPlaceholder: "ابحث باسم المطعم…",
    emptyNoneTitle: "لا مطاعم معروضة بعد",
    emptyNoneBody: "لم نجد مطاعم مفعّلة تطابق العرض الحالي.",
    urlCategoryKey: "category",
    guestNoteId: "guestNote",
    catBarId: "storesCuisineBar",
    loadCategories: loadRestaurantCategories,
    filterStore: storeCountsAsRestaurant,
    matchCategory: storeMatchesCuisineChip,
    buildApiParams: function (cat) {
      var parts = ["type=restaurant"];
      if (cat) parts.push("category=" + encodeURIComponent(cat));
      return parts;
    },
  });
})();
