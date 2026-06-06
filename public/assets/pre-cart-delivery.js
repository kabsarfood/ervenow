/**
 * اختيار الاستلام/التوصيل + تحديد الموقع قبل الإضافة للسلة (صفحة المتجر).
 */
(function (global) {
  var flags = null;
  var flagsPromise = null;

  function apiUrl(path) {
    return global.PlatformAPI && global.PlatformAPI.apiUrl
      ? global.PlatformAPI.apiUrl(path)
      : path;
  }

  function loadFlags() {
    if (flags) return Promise.resolve(flags);
    if (flagsPromise) return flagsPromise;
    flagsPromise = fetch(apiUrl("/api/store/delivery-engine/flags"))
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        flags = j && typeof j === "object" ? j : {};
        return flags;
      })
      .catch(function () {
        flags = {};
        return flags;
      });
    return flagsPromise;
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function storePolicy(storeMeta) {
    return (
      (storeMeta && storeMeta.delivery_engine && storeMeta.delivery_engine.delivery_policy) ||
      (storeMeta && storeMeta.delivery_policy) ||
      "ervenow_delivery"
    );
  }

  function fulfillmentOptions(storeMeta) {
    var pol = storePolicy(storeMeta);
    var out = [];
    if (pol === "pickup_only") {
      out.push({ id: "pickup", label: "الاستلام من المطعم" });
      return out;
    }
    out.push({ id: "pickup", label: "الاستلام من المطعم" });
    if (pol === "store_delivery" || pol === "store_plus_ervenow") {
      out.push({ id: "store_delivery", label: "توصيل بواسطة المتجر" });
    }
    if (pol === "ervenow_delivery" || pol === "store_plus_ervenow") {
      out.push({ id: "ervenow_delivery", label: "توصيل المناديب" });
    }
    if (out.length === 1) {
      out.push({ id: "ervenow_delivery", label: "توصيل المناديب" });
    }
    return out;
  }

  function roughDistanceKm(lat1, lng1, lat2, lng2) {
    var a = Number(lat1);
    var b = Number(lng1);
    var c = Number(lat2);
    var d = Number(lng2);
    if (![a, b, c, d].every(function (x) {
      return Number.isFinite(x);
    }))
      return NaN;
    return Math.sqrt(Math.pow(c - a, 2) + Math.pow(d - b, 2)) * 111;
  }

  function parseLatLngPair(s) {
    var t = String(s || "")
      .trim()
      .replace(/\u060c/g, ",")
      .replace(/،/g, ",");
    if (!t.includes(",")) return null;
    var parts = t.split(/,\s*/);
    if (parts.length < 2) return null;
    var lat = parseFloat(String(parts[0]).trim());
    var lng = parseFloat(String(parts[1]).trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function parseMapsUrlClient(input) {
    var raw = String(input || "").trim();
    if (!raw) return null;
    var direct = parseLatLngPair(raw);
    if (direct) return direct;
    var urlStr = raw;
    if (!/^https?:\/\//i.test(urlStr)) {
      if (/^(maps\.|www\.|goo\.|g\.co)/i.test(urlStr)) urlStr = "https://" + urlStr;
      else if (/google\.com\/maps|maps\.google|goo\.gl|maps\.app/i.test(urlStr)) urlStr = "https://" + urlStr;
    }
    var patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/]|z|\?|$)/i,
      /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[&!]|$)/i,
      /[?&]lat=(-?\d+(?:\.\d+)?)[&]lng=(-?\d+(?:\.\d+)?)/i,
      /\/place\/[^@]*@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = urlStr.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]);
        var lng = parseFloat(m[2]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: lat, lng: lng };
      }
    }
    return null;
  }

  async function resolveMapsLinkClient(url) {
    try {
      var res = await fetch(apiUrl("/api/store/resolve-maps-link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url }),
      });
      var data = await res.json();
      if (data.ok && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
        return { lat: data.lat, lng: data.lng, maps_url: url };
      }
    } catch (_e) {}
    var local = parseMapsUrlClient(url);
    if (local) return { lat: local.lat, lng: local.lng, maps_url: url };
    return null;
  }

  function storeCoords(storeMeta) {
    var raw = storeMeta && storeMeta.raw;
    return {
      lat: Number(storeMeta && storeMeta.lat != null ? storeMeta.lat : raw && raw.lat),
      lng: Number(storeMeta && storeMeta.lng != null ? storeMeta.lng : raw && raw.lng),
      radius:
        storeMeta && Number(storeMeta.delivery_radius_km) > 0
          ? Number(storeMeta.delivery_radius_km)
          : raw && Number(raw.delivery_radius_km) > 0
            ? Number(raw.delivery_radius_km)
            : 5,
      feePerKm:
        storeMeta && Number(storeMeta.delivery_fee_per_km) > 0
          ? Number(storeMeta.delivery_fee_per_km)
          : raw && Number(raw.delivery_fee_per_km) > 0
            ? Number(raw.delivery_fee_per_km)
            : 2.3,
    };
  }

  function clientQuoteFallback(storeMeta, fulfillment, loc, product, qty) {
    if (fulfillment === "pickup") {
      return {
        delivery_free: true,
        delivery_fee: 0,
        distance_km: 0,
        eta_minutes: 0,
        delivery_provider: "pickup",
        delivery_policy: "pickup",
      };
    }
    var coords = storeCoords(storeMeta);
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      throw new Error("المتجر بلا موقع مسجّل");
    }
    var km = roughDistanceKm(coords.lat, coords.lng, loc.lat, loc.lng);
    if (!Number.isFinite(km)) throw new Error("تعذر حساب المسافة");
    var radius = coords.radius;
    if (km > radius) throw new Error("هذا المتجر لا يغطي منطقتك");
    if (product && product.includes_delivery) {
      return {
        delivery_free: true,
        delivery_fee: 0,
        distance_km: Math.round(km * 10) / 10,
        eta_minutes: Math.max(10, Math.round((km / 40) * 60)),
        delivery_provider: fulfillment === "store_delivery" ? "store" : "ervenow",
        delivery_policy: "included",
        free_delivery_message: "🚚 هذا المنتج يشمل التوصيل مجاناً",
      };
    }
    var fee = Math.round(km * coords.feePerKm * 100) / 100;
    return {
      delivery_free: false,
      delivery_fee: fee,
      distance_km: Math.round(km * 10) / 10,
      eta_minutes: Math.max(10, Math.round((km / 40) * 60)),
      delivery_provider: fulfillment === "store_delivery" ? "store" : "ervenow",
      delivery_policy: "paid",
    };
  }

  async function fetchDeliveryQuote(storeId, storeMeta, fulfillment, loc, product, qty) {
    var subtotal = (Number(product && product.price) || 0) * (qty || 1);
    var qs =
      "?lat=" +
      encodeURIComponent(loc.lat) +
      "&lng=" +
      encodeURIComponent(loc.lng) +
      "&fulfillment=" +
      encodeURIComponent(fulfillment) +
      "&subtotal=" +
      encodeURIComponent(subtotal) +
      (product && product.includes_delivery ? "&includes_delivery=1" : "");
    try {
      var res = await fetch(apiUrl("/api/store/public/" + encodeURIComponent(storeId) + "/delivery-quote" + qs));
      var data = await res.json();
      if (data.ok && (data.quote || data.delivery_fee != null)) return data.quote || data;
    } catch (_e2) {}
    return clientQuoteFallback(storeMeta, fulfillment, loc, product, qty);
  }

  function buildSnapshot(storeId, storeMeta, product, fulfillment, quote, loc) {
    var q = quote || {};
    var unit = Number(product && (product.offer_price || product.price)) || 0;
    if (product && product.offer_price != null && Number(product.offer_price) < Number(product.price)) {
      unit = Number(product.offer_price);
    }
    return {
      store_id: storeId,
      store_name: (storeMeta && storeMeta.name) || "",
      product_id: product.id,
      unit_price: unit,
      includes_delivery: !!product.includes_delivery,
      fulfillment_mode: fulfillment,
      delivery_snapshot_version: 1,
      delivery_policy: q.delivery_policy || null,
      delivery_provider: q.delivery_provider || null,
      delivery_free: !!q.delivery_free,
      delivery_free_reason: q.delivery_free_reason || null,
      delivery_fee: Number(q.delivery_fee) || 0,
      distance_km: q.distance_km != null ? Number(q.distance_km) : null,
      eta_minutes: q.eta_minutes != null ? Number(q.eta_minutes) : null,
      drop_lat: loc && loc.lat != null ? loc.lat : null,
      drop_lng: loc && loc.lng != null ? loc.lng : null,
      drop_address: (loc && loc.address) || "",
      drop_maps_url: (loc && loc.maps_url) || null,
      image_url: product.image_url || null,
    };
  }

  function getCartItems() {
    return typeof global.getCart === "function"
      ? global.getCart()
      : global.ErvenowCart && global.ErvenowCart.get
        ? global.ErvenowCart.get()
        : [];
  }

  function assertCartCompatible(snapshot) {
    var cart = getCartItems();
    if (!cart || !cart.length) return { ok: true };
    var sid = String(snapshot.store_id || "");
    for (var i = 0; i < cart.length; i++) {
      var d = cart[i] && cart[i].data;
      if (!d || !d.store_id) continue;
      if (String(d.store_id) !== sid) return { ok: false, message: "لا يمكن خلط منتجات من متجرين مختلفين" };
      if (d.delivery_snapshot_version === 1 && snapshot.delivery_snapshot_version === 1) {
        if (d.fulfillment_mode !== snapshot.fulfillment_mode) {
          return { ok: false, message: "نوع الاستلام/التوصيل يجب أن يكون موحّداً لكل المنتجات" };
        }
        if (
          d.fulfillment_mode !== "pickup" &&
          snapshot.fulfillment_mode !== "pickup" &&
          (Math.abs(Number(d.drop_lat) - Number(snapshot.drop_lat)) > 0.0001 ||
            Math.abs(Number(d.drop_lng) - Number(snapshot.drop_lng)) > 0.0001)
        ) {
          return { ok: false, message: "موقع التوصيل يجب أن يكون واحداً لكل المنتجات" };
        }
      }
    }
    return { ok: true };
  }

  function reuseSnapshotFromCart(ctx) {
    var cart = getCartItems();
    var storeId = String(ctx.storeId || "");
    for (var i = 0; i < cart.length; i++) {
      var d = cart[i] && cart[i].data;
      if (!d || d.delivery_snapshot_version !== 1 || String(d.store_id) !== storeId) continue;
      var snap = buildSnapshot(
        ctx.storeId,
        ctx.storeMeta,
        ctx.product,
        d.fulfillment_mode,
        {
          delivery_policy: d.delivery_policy,
          delivery_provider: d.delivery_provider,
          delivery_free: d.delivery_free,
          delivery_free_reason: d.delivery_free_reason,
          delivery_fee: d.delivery_fee,
          distance_km: d.distance_km,
          eta_minutes: d.eta_minutes,
        },
        {
          lat: d.drop_lat,
          lng: d.drop_lng,
          address: d.drop_address,
          maps_url: d.drop_maps_url,
        }
      );
      var compat = assertCartCompatible(snap);
      if (!compat.ok) return { handled: true, error: compat.message };
      return { handled: true, snapshot: snap, qty: ctx.qty };
    }
    return null;
  }

  function openModal(ctx) {
    return new Promise(function (resolve) {
      var storeMeta = ctx.storeMeta || {};
      var product = ctx.product;
      var storeId = ctx.storeId;
      var qty = ctx.qty || 1;
      var opts = fulfillmentOptions(storeMeta);
      var chosen = opts.length === 1 ? opts[0].id : null;
      var loc = { lat: null, lng: null, address: "", maps_url: null };
      var quote = null;
      var quoteErr = "";
      var busy = false;

      var overlay = document.createElement("div");
      overlay.className = "precart-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "طريقة الاستلام والتوصيل");

      function close(result) {
        overlay.remove();
        resolve(result);
      }

      function renderQuoteBox() {
        if (!quote && !quoteErr) return "";
        if (quoteErr) return '<div class="precart-quote precart-quote--err">' + esc(quoteErr) + "</div>";
        var lines = [];
        if (quote.distance_km != null)
          lines.push("📏 المسافة: " + Number(quote.distance_km).toFixed(1) + " كم");
        if (quote.eta_minutes != null) lines.push("⏱️ الوقت التقريبي: " + quote.eta_minutes + " دقيقة");
        if (quote.delivery_free) lines.push("🎁 التوصيل مجاني");
        else if (quote.delivery_fee != null)
          lines.push("💰 رسوم التوصيل: " + Number(quote.delivery_fee).toFixed(2) + " ر.س");
        if (quote.free_delivery_message) lines.push(esc(quote.free_delivery_message));
        return '<div class="precart-quote">' + lines.join("<br>") + "</div>";
      }

      function renderBody() {
        var choicesHtml = opts
          .map(function (o) {
            return (
              '<button type="button" class="precart-choice' +
              (chosen === o.id ? " is-on" : "") +
              '" data-fulfillment="' +
              esc(o.id) +
              '">' +
              esc(o.label) +
              "</button>"
            );
          })
          .join("");

        var locBlock = "";
        if (chosen && chosen !== "pickup") {
          locBlock =
            '<div class="precart-field" style="margin-top:12px">' +
            "<label>📍 عنوان التوصيل</label>" +
            '<textarea id="precartAddress" rows="2" placeholder="الحي، الشارع…">' +
            esc(loc.address) +
            "</textarea>" +
            "</div>" +
            '<div class="precart-field" style="margin-top:10px">' +
            "<label>🔗 رابط Google Maps (اختياري)</label>" +
            '<input type="url" id="precartMaps" placeholder="https://maps.google.com/…" value="' +
            esc(loc.maps_url || "") +
            '" />' +
            "</div>" +
            '<div class="precart-actions">' +
            '<button type="button" class="btn btn-ghost" id="precartGps">📍 تحديد موقعي</button>' +
            '<button type="button" class="btn" id="precartQuoteBtn">احتساب التوصيل</button>' +
            "</div>" +
            renderQuoteBox();
        }

        return (
          '<div class="precart-modal-wrap">' +
          '<button type="button" class="precart-close" aria-label="إغلاق">×</button>' +
          '<div class="precart-modal">' +
          "<h2>قبل الإضافة للسلة</h2>" +
          '<p class="precart-sub">اختر الاستلام من المطعم أو توصيل المناديب — سيُحفظ مع المنتج ولن تُعاد الخطوة في السلة.</p>' +
          '<div class="precart-choices">' +
          choicesHtml +
          "</div>" +
          locBlock +
          '<div class="precart-actions" style="margin-top:16px">' +
          '<button type="button" class="btn btn-ghost" id="precartCancel">إلغاء</button>' +
          '<button type="button" class="btn btn-primary" id="precartConfirm" ' +
          (chosen && !busy ? "" : "disabled") +
          ">إضافة للسلة</button>" +
          "</div></div></div>"
        );
      }

      async function resolveLocationFromInputs() {
        var mapsIn = overlay.querySelector("#precartMaps");
        var addrIn = overlay.querySelector("#precartAddress");
        if (mapsIn && mapsIn.value.trim()) {
          var resolved = await resolveMapsLinkClient(mapsIn.value.trim());
          if (!resolved) throw new Error("تعذر قراءة رابط الخرائط — جرّب GPS أو رابطاً يحتوي إحداثيات");
          loc.lat = resolved.lat;
          loc.lng = resolved.lng;
          loc.maps_url = resolved.maps_url || mapsIn.value.trim();
        }
        if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
          throw new Error("حدد موقعك عبر GPS أو الصق رابط خرائط صالح");
        }
        loc.address = addrIn ? addrIn.value.trim() || "عنوان التوصيل" : "عنوان التوصيل";
      }

      async function runQuote() {
        quoteErr = "";
        await resolveLocationFromInputs();
        quote = await fetchDeliveryQuote(storeId, storeMeta, chosen, loc, product, qty);
        paint();
      }

      function paint() {
        overlay.innerHTML = renderBody();
        overlay.querySelector(".precart-close").onclick = function () {
          close({ ok: false });
        };
        overlay.querySelector("#precartCancel").onclick = function () {
          close({ ok: false });
        };
        overlay.querySelectorAll(".precart-choice").forEach(function (btn) {
          btn.onclick = function () {
            chosen = btn.getAttribute("data-fulfillment");
            quote = null;
            quoteErr = "";
            paint();
          };
        });
        var confirmBtn = overlay.querySelector("#precartConfirm");
        if (confirmBtn) {
          confirmBtn.onclick = async function () {
            if (!chosen || busy) return;
            busy = true;
            paint();
            try {
              if (chosen === "pickup") {
                quote = clientQuoteFallback(storeMeta, "pickup", null, product, qty);
              } else {
                if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
                  await resolveLocationFromInputs();
                } else {
                  var addrIn = overlay.querySelector("#precartAddress");
                  if (addrIn && addrIn.value.trim()) loc.address = addrIn.value.trim();
                }
                if (!quote) quote = await fetchDeliveryQuote(storeId, storeMeta, chosen, loc, product, qty);
              }
              var snap = buildSnapshot(storeId, storeMeta, product, chosen, quote, loc);
              var compat = assertCartCompatible(snap);
              if (!compat.ok) {
                quoteErr = compat.message;
                busy = false;
                paint();
                return;
              }
              close({ ok: true, snapshot: snap, qty: qty });
              if (
                snap.fulfillment_mode !== "pickup" &&
                Number.isFinite(Number(snap.drop_lat)) &&
                Number.isFinite(Number(snap.drop_lng))
              ) {
                if (global.saveDeliveryLocation && typeof global.saveDeliveryLocation === "function") {
                  global.saveDeliveryLocation({
                    lat: Number(snap.drop_lat),
                    lng: Number(snap.drop_lng),
                    address: snap.drop_address || "",
                    fulfillment_mode: snap.fulfillment_mode,
                    store_id: snap.store_id,
                    maps_url: snap.drop_maps_url || null,
                  });
                }
              }
            } catch (e) {
              quoteErr = e.message || "تعذر إتمام الإضافة";
              busy = false;
              paint();
            }
          };
        }
        var gps = overlay.querySelector("#precartGps");
        if (gps) {
          gps.onclick = function () {
            if (!navigator.geolocation) {
              quoteErr = "المتصفح لا يدعم الموقع";
              paint();
              return;
            }
            navigator.geolocation.getCurrentPosition(
              function (p) {
                loc.lat = p.coords.latitude;
                loc.lng = p.coords.longitude;
                var addr = overlay.querySelector("#precartAddress");
                if (addr && !addr.value.trim()) addr.value = "موقع GPS";
                loc.address = addr ? addr.value.trim() : "موقع GPS";
                quoteErr = "";
                paint();
              },
              function () {
                quoteErr = "تعذر الوصول للموقع — تأكد من إذن الموقع";
                paint();
              },
              { enableHighAccuracy: false, timeout: 12000 }
            );
          };
        }
        var qbtn = overlay.querySelector("#precartQuoteBtn");
        if (qbtn) {
          qbtn.onclick = function () {
            busy = true;
            paint();
            runQuote()
              .catch(function (e) {
                quoteErr = e.message || "خطأ في التوصيل";
                paint();
              })
              .finally(function () {
                busy = false;
                paint();
              });
          };
        }
        overlay.onclick = function (ev) {
          if (ev.target === overlay) close({ ok: false });
        };
      }

      document.body.appendChild(overlay);
      paint();
    });
  }

  async function interceptAdd(ctx) {
    await loadFlags();
    var pol = storePolicy(ctx.storeMeta);
    if (pol === "pickup_only" && !ctx.forceModal) {
      var snapOnly = buildSnapshot(
        ctx.storeId,
        ctx.storeMeta,
        ctx.product,
        "pickup",
        { delivery_free: true, delivery_provider: "pickup", delivery_policy: "pickup" },
        null
      );
      var c0 = assertCartCompatible(snapOnly);
      if (!c0.ok) return { handled: true, error: c0.message };
      return { handled: true, snapshot: snapOnly, qty: ctx.qty };
    }
    var reused = reuseSnapshotFromCart(ctx);
    if (reused) return reused;
    var result = await openModal(ctx);
    if (!result.ok) return { handled: true, cancelled: true };
    return { handled: true, snapshot: result.snapshot, qty: result.qty };
  }

  global.ErvenowPreCartDelivery = {
    loadFlags: loadFlags,
    interceptAdd: interceptAdd,
    precartEnabled: function () {
      return true;
    },
  };
})(window);
