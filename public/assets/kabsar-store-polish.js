/**
 * KABSAR STORE POLISH PACK 1.0 — واجهة المتجر (بدون منطق مالي/سلة).
 */
(function (global) {
  "use strict";

  var SA_ETA_BASE = 25;
  var SA_ETA_PER_KM = 3;

  function roundMoney(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 100) / 100;
  }

  function cityFromStore(store) {
    var a = String((store && (store.address || store.location_text)) || "").trim();
    if (!a) return "السعودية";
    var parts = a.split(/[،,]/);
    var last = parts[parts.length - 1].trim();
    if (last.length > 2 && last.length < 40) return last;
    if (/رياض|جدة|مكة|مدينة|دمام|خبر|طائف/i.test(a)) {
      var m = a.match(/(الرياض|جدة|مكة|المدينة|الدمام|الخبر|الطائف)/);
      if (m) return m[1];
    }
    return parts[0].slice(0, 28) || "السعودية";
  }

  function etaRange(store) {
    var eta = store && store.delivery_eta_minutes != null ? Number(store.delivery_eta_minutes) : NaN;
    if (Number.isFinite(eta) && eta > 0) {
      var lo = Math.max(12, Math.round(eta - 8));
      var hi = Math.round(eta + 12);
      return lo + "–" + hi;
    }
    var km = store && Number.isFinite(Number(store.distance_km)) ? Number(store.distance_km) : 3;
    var lo2 = Math.max(15, Math.round(SA_ETA_BASE + km * SA_ETA_PER_KM * 0.6));
    var hi2 = Math.max(lo2 + 10, Math.round(SA_ETA_BASE + km * SA_ETA_PER_KM * 1.2));
    return lo2 + "–" + hi2;
  }

  function deliveryAvailable(store) {
    var de = store && store.delivery_engine;
    var pol = de && de.delivery_policy ? String(de.delivery_policy) : "ervenow_delivery";
    return pol !== "pickup_only";
  }

  function storeOpenState(store) {
    if (store && store.is_active === false) {
      return { open: false, detail: "المتجر غير نشط حالياً — يفتح عند تفعيل الإدارة" };
    }
    var h = new Date().getHours();
    var m = new Date().getMinutes();
    var mins = h * 60 + m;
    var openAt = 9 * 60;
    var closeAt = 23 * 60 + 30;
    if (mins >= openAt && mins < closeAt) {
      return { open: true, detail: "مفتوح الآن — يغلق الساعة 11:30 م" };
    }
    if (mins < openAt) {
      return { open: false, detail: "مغلق — يفتح اليوم الساعة 9:00 ص" };
    }
    return { open: false, detail: "مغلق — يفتح غداً الساعة 9:00 ص" };
  }

  function renderStatus(store) {
    var el = document.getElementById("storeStatusPill");
    if (!el) return;
    var st = storeOpenState(store);
    el.className = "store-status-pill store-status-pill--" + (st.open ? "open" : "closed");
    el.textContent = (st.open ? "🟢 " : "🔴 ") + (st.open ? "مفتوح الآن" : "مغلق حالياً") + " · " + st.detail;
    el.hidden = false;
  }

  function renderQuickInfo(store) {
    var bar = document.getElementById("storeQuickInfo");
    if (!bar) return;
    var rating = Number(store.average_rating) || 0;
    var ratingTxt = rating > 0 ? "⭐ " + rating.toFixed(1) : "⭐ جديد";
    var delTxt = deliveryAvailable(store) ? "🚚 التوصيل متاح" : "🏪 استلام فقط";
    var etaTxt = "⏱️ " + etaRange(store) + " دقيقة";
    var locTxt = "📍 " + cityFromStore(store);
    bar.innerHTML = [ratingTxt, delTxt, etaTxt, locTxt]
      .map(function (t) {
        return '<span class="store-quick-info__chip">' + t + "</span>";
      })
      .join("");
    bar.hidden = false;
  }

  function renderQuickNav(categories, onPick) {
    var nav = document.getElementById("storeQuickNav");
    var scroll = document.getElementById("storeQuickNavScroll");
    if (!nav || !scroll) return;
    var items = (categories || []).filter(function (c) {
      return c && c.slug;
    });
    if (!items.length) {
      nav.hidden = true;
      return;
    }
    scroll.innerHTML = items
      .map(function (c) {
        return (
          '<button type="button" class="store-quick-nav__chip" data-cat="' +
          String(c.slug).replace(/"/g, "") +
          '">' +
          (c.icon ? c.icon + " " : "") +
          (c.label || c.slug) +
          "</button>"
        );
      })
      .join("");
    nav.hidden = false;
    scroll.querySelectorAll(".store-quick-nav__chip").forEach(function (btn) {
      btn.onclick = function () {
        var slug = btn.getAttribute("data-cat");
        if (onPick) onPick(slug);
        var sec = document.getElementById("productsSection");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  }

  function applyGridSparse() {
    var box = document.getElementById("products");
    if (!box) return;
    var n = box.querySelectorAll(".prod-card").length;
    box.classList.toggle("prod-grid--sparse", n > 0 && n <= 2);
  }

  function cartForStore(storeId) {
    var cart = typeof global.getCart === "function" ? global.getCart() : [];
    var count = 0;
    var sub = 0;
    (cart || []).forEach(function (it) {
      var d = it && it.data;
      if (!d || String(d.store_id) !== String(storeId)) return;
      var q = Number(d.qty) || 1;
      count += q;
      sub += Number(it.price) || 0;
    });
    return { count: count, subtotal: roundMoney(sub) };
  }

  function updateCartLink(storeId) {
    var c = cartForStore(storeId);
    var countEls = document.querySelectorAll("#storeCartLink .store-cart-count, #storeCartLink #cartCount");
    var totalEl = document.getElementById("storeCartTotal");
    countEls.forEach(function (el) {
      el.textContent = String(c.count);
    });
    if (totalEl) {
      totalEl.textContent = c.count > 0 ? "💰 " + c.subtotal.toFixed(2) + " ريال" : "";
      totalEl.style.display = c.count > 0 ? "block" : "none";
    }
    var headerBadges = document.querySelectorAll(".dash-header-cart__badge#cartCount");
    headerBadges.forEach(function (el) {
      el.textContent = String(
        typeof global.getCart === "function"
          ? global.getCart().reduce(function (s, i) {
              return s + (Number(i && i.data && i.data.qty) || 1);
            }, 0)
          : c.count
      );
    });
  }

  function freeDeliveryGap(store, subtotal) {
    var de = store && store.delivery_engine;
    if (!de || de.free_delivery_policy !== "min_order") return null;
    var min = Number(de.free_delivery_min_order);
    if (!Number.isFinite(min) || min <= 0) return null;
    if (subtotal >= min) return { met: true, min: min };
    return { met: false, min: min, need: roundMoney(min - subtotal) };
  }

  function updateFreeNudge(store, storeId) {
    var el = document.getElementById("storeFreeNudge");
    if (!el) return;
    var c = cartForStore(storeId);
    var gap = freeDeliveryGap(store, c.subtotal);
    if (!gap) {
      el.classList.remove("is-visible");
      el.textContent = "";
      return;
    }
    if (gap.met) {
      el.textContent = "🎁 مبروك — طلبك يستحق توصيلاً مجانياً!";
      el.classList.add("is-visible");
      return;
    }
    el.textContent = "🎁 أضف " + gap.need.toFixed(2) + " ريال فقط لتحصل على توصيل مجاني";
    el.classList.add("is-visible");
  }

  function isPopularProduct(p, index) {
    if (!p) return false;
    if (Number(p.sort_order) === 0) return true;
    if (index < 2) return true;
    var r = Number(p.rating);
    return Number.isFinite(r) && r >= 4.5;
  }

  function priceHtmlEnhanced(p) {
    var unit =
      typeof global.effectiveUnitPrice === "function"
        ? global.effectiveUnitPrice(p)
        : Number(p.price) || 0;
    var base = Number(p.price) || 0;
    var hasOffer = unit < base && base > 0;
    if (!hasOffer) {
      return (
        '<div class="prod-card__price-stack"><span class="prod-card__price">' +
        unit.toFixed(2) +
        '<small>ريال</small></span></div>'
      );
    }
    var pct = Math.round((1 - unit / base) * 100);
    return (
      '<div class="prod-card__price-stack">' +
      '<span class="prod-card__price--old">' +
      base.toFixed(2) +
      " ريال</span>" +
      '<span class="prod-card__price">' +
      unit.toFixed(2) +
      '<small>ريال</small></span>' +
      '<span class="prod-badge prod-badge--discount">-' +
      pct +
      "%</span></div>"
    );
  }

  var modalProduct = null;

  function openProductModal(p) {
    var modal = document.getElementById("storeProdModal");
    if (!modal || !p) return;
    modalProduct = p;
    var urls =
      typeof global.productImageUrls === "function" ? global.productImageUrls(p) : [];
    var img = document.getElementById("storeProdModalImg");
    var title = document.getElementById("storeProdModalTitle");
    var desc = document.getElementById("storeProdModalDesc");
    var price = document.getElementById("storeProdModalPrice");
    if (img) img.src = urls[0] || "";
    if (img) img.alt = p.name || "";
    if (title) title.textContent = p.name || "منتج";
    if (desc) desc.textContent = (p.description || "").trim() || "بدون وصف إضافي.";
    if (price) price.innerHTML = priceHtmlEnhanced(p);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeProductModal() {
    var modal = document.getElementById("storeProdModal");
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
    modalProduct = null;
  }

  function wireModal() {
    var modal = document.getElementById("storeProdModal");
    if (!modal || modal.getAttribute("data-wired") === "1") return;
    modal.setAttribute("data-wired", "1");
    modal.addEventListener("click", function (ev) {
      if (ev.target === modal) closeProductModal();
    });
    var closeBtn = document.getElementById("storeProdModalClose");
    if (closeBtn) closeBtn.onclick = closeProductModal;
    var addBtn = document.getElementById("storeProdModalAdd");
    if (addBtn) {
      addBtn.onclick = function () {
        if (modalProduct && typeof global.addProductToCart === "function") {
          void global.addProductToCart(modalProduct, 1);
        }
        closeProductModal();
      };
    }
  }

  function wireImageZoom() {
    var box = document.getElementById("products");
    if (!box || box.getAttribute("data-zoom-wired") === "1") return;
    box.setAttribute("data-zoom-wired", "1");
    box.addEventListener("click", function (ev) {
      if (ev.target.closest(".prod-gallery__dot, .prod-qty, .btn-add-cart")) return;
      var media = ev.target.closest(".prod-card__media--clickable");
      if (!media) return;
      var card = ev.target.closest(".prod-card");
      if (!card) return;
      var btn = card.querySelector(".btn-add-cart");
      var pid = btn && btn.getAttribute("data-pid");
      var list = global.lastProducts || [];
      var p = pid
        ? list.find(function (x) {
            return String(x.id) === String(pid);
          })
        : null;
      if (p) {
        ev.preventDefault();
        openProductModal(p);
      }
    });
  }

  function refresh(store, storeId) {
    renderStatus(store);
    renderQuickInfo(store);
    updateCartLink(storeId);
    updateFreeNudge(store, storeId);
    applyGridSparse();
  }

  global.KabsarStorePolish = {
    renderStatus: renderStatus,
    renderQuickInfo: renderQuickInfo,
    renderQuickNav: renderQuickNav,
    applyGridSparse: applyGridSparse,
    updateCartLink: updateCartLink,
    updateFreeNudge: updateFreeNudge,
    refresh: refresh,
    isPopularProduct: isPopularProduct,
    priceHtmlEnhanced: priceHtmlEnhanced,
    openProductModal: openProductModal,
    closeProductModal: closeProductModal,
    wireModal: wireModal,
    wireImageZoom: wireImageZoom,
    cartForStore: cartForStore,
  };

  wireModal();
})(window);
