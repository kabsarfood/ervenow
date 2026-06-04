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
    kabsa_bukhari: ["kabsa_bukhari", "kabsa", "bukhari_mandi"],
    shawarma_grill: ["shawarma_grill", "shawarma", "grill"],
    burger_broasted: ["broasted", "burger", "burger_broasted"],
    burger: ["burger", "burger_broasted"],
    broasted: ["broasted", "burger_broasted"],
    cafe_sweets: ["cafe", "sweets", "dessert_cafe", "breakfast_bakery"],
    cafe: ["cafe", "dessert_cafe", "breakfast_bakery"],
    sweets: ["sweets", "dessert_cafe"],
  };

  function storeCountsAsRestaurant(store) {
    if (!store) return false;
    if (String(store.type || "").toLowerCase() === "restaurant") return true;
    var c = String(store.category || "")
      .trim()
      .toLowerCase();
    var known = {
      kabsa_bukhari: 1,
      kabsa: 1,
      bukhari_mandi: 1,
      shawarma_grill: 1,
      seafood: 1,
      burger: 1,
      broasted: 1,
      pizza: 1,
      cafe: 1,
      sweets: 1,
      home_producers: 1,
      burger_broasted: 1,
      breakfast_bakery: 1,
      dessert_cafe: 1,
      juice_drinks: 1,
    };
    return !!known[c];
  }

  function storeMatchesCuisineChip(store, slug) {
    if (!slug) return storeCountsAsRestaurant(store);
    if (!storeCountsAsRestaurant(store)) return false;
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
    storeCountsAsRestaurant: storeCountsAsRestaurant,
    storeMatchesCuisineChip: storeMatchesCuisineChip,
    hubLinksHtml: hubLinksHtml,
    catCardsHtml: catCardsHtml,
  };
})(window);
