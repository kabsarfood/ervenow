/**
 * تصنيفات مطاعم ERVENOW — للعرض والبحث (متزامن مع shared/restaurantCategories.js)
 */
(function (global) {
  var RESTAURANT_CUISINES = [
    { slug: "kabsa_bukhari", icon: "🍚", label: "مطاعم كبسة وبخاري" },
    { slug: "shawarma_grill", icon: "🌯", label: "مطاعم شاورما ومشاوي" },
    { slug: "seafood", icon: "🐟", label: "مطاعم سمك" },
    { slug: "burger", icon: "🍔", label: "مطاعم برقر" },
    { slug: "broasted", icon: "🍗", label: "مطاعم بروستد" },
    { slug: "pizza", icon: "🍕", label: "مطاعم بيتزا" },
    { slug: "cafe", icon: "☕", label: "مقاهي" },
    { slug: "sweets", icon: "🍰", label: "حلويات" },
    { slug: "home_producers", icon: "🏠", label: "أسر منتجة" },
  ];

  /** فلاتر قديمة في روابط قديمة — تطابق عدة slugs */
  var CUISINE_COMBO = {
    burger_broasted: ["broasted", "burger", "burger_broasted"],
    cafe_sweets: ["cafe", "sweets", "dessert_cafe"],
  };

  function storeMatchesCuisineChip(store, slug) {
    if (!slug) return true;
    if (String(store.type || "").toLowerCase() !== "restaurant") return false;
    var c = String(store.category || "")
      .trim()
      .toLowerCase();
    var key = String(slug || "")
      .trim()
      .toLowerCase();
    var combo = CUISINE_COMBO[key];
    if (combo) return combo.indexOf(c) !== -1;
    return c === key;
  }

  function hubLinksHtml() {
    return RESTAURANT_CUISINES.map(function (it) {
      return (
        '<a class="sn-hub-link" href="/restaurants?category=' +
        encodeURIComponent(it.slug) +
        '"><span class="sn-hub-link__ic" aria-hidden="true">' +
        it.icon +
        "</span>" +
        it.label +
        "</a>"
      );
    }).join("");
  }

  function catCardsHtml() {
    return RESTAURANT_CUISINES.map(function (it) {
      return (
        '<a class="cat-card" href="/restaurants?category=' +
        encodeURIComponent(it.slug) +
        '"><span class="cat-card__icon" aria-hidden="true">' +
        it.icon +
        "</span><strong>" +
        it.label +
        "</strong><span>تصفّح مطاعم هذا التصنيف.</span></a>"
      );
    }).join("");
  }

  global.ErvenowRestaurantCuisines = {
    list: RESTAURANT_CUISINES,
    CUISINE_COMBO: CUISINE_COMBO,
    storeMatchesCuisineChip: storeMatchesCuisineChip,
    hubLinksHtml: hubLinksHtml,
    catCardsHtml: catCardsHtml,
  };
})(window);
