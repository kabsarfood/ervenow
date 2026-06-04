/**
 * ERVENOW DELIVERY ENGINE 1.0 — اختيار الاستلام/التوصيل + quote قبل الإضافة للسلة.
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

  function precartEnabled() {
    return !!(flags && flags.DELIVERY_ENGINE_PRECART && flags.DELIVERY_ENGINE_POLICY);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fulfillmentOptions(storeMeta) {
    var pol =
      (storeMeta && storeMeta.delivery_engine && storeMeta.delivery_engine.delivery_policy) ||
      (storeMeta && storeMeta.delivery_policy) ||
      "ervenow_delivery";
    var out = [];
    if (pol === "pickup_only") {
      out.push({ id: "pickup", label: "استلام من المتجر" });
      return out;
    }
    if (pol === "store_delivery") {
      out.push({ id: "store_delivery", label: "توصيل بواسطة المتجر" });
      return out;
    }
    if (pol === "ervenow_delivery") {
      out.push({ id: "ervenow_delivery", label: "توصيل بواسطة ERVENOW" });
      return out;
    }
    if (pol === "store_plus_ervenow") {
      out.push({ id: "pickup", label: "استلام من المتجر" });
      out.push({ id: "store_delivery", label: "توصيل بواسطة المتجر" });
      out.push({ id: "ervenow_delivery", label: "توصيل بواسطة ERVENOW" });
      return out;
    }
    out.push({ id: "ervenow_delivery", label: "توصيل" });
    return out;
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

  function assertCartCompatible(snapshot) {
    var cart =
      typeof global.getCart === "function" ? global.getCart() : global.ErvenowCart && global.ErvenowCart.get
        ? global.ErvenowCart.get()
        : [];
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
            '<textarea id="precartAddress" rows="2" placeholder="الحي، الشارع…"></textarea>' +
            "</div>" +
            '<div class="precart-field" style="margin-top:10px">' +
            "<label>🔗 رابط Google Maps (اختياري)</label>" +
            '<input type="url" id="precartMaps" placeholder="https://maps.google.com/…" />' +
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
          '<p class="precart-sub">اختر الاستلام أو التوصيل — سيُحفظ مع المنتج ولن تُعاد الخطوة في السلة.</p>' +
          '<div class="precart-choices">' +
          choicesHtml +
          "</div>" +
          locBlock +
          '<div class="precart-actions" style="margin-top:16px">' +
          '<button type="button" class="btn btn-ghost" id="precartCancel">إلغاء</button>' +
          '<button type="button" class="btn btn-primary" id="precartConfirm" ' +
          (chosen ? "" : "disabled") +
          ">إضافة للسلة</button>" +
          "</div></div></div>"
        );
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
          confirmBtn.onclick = function () {
            if (!chosen) return;
            if (chosen !== "pickup" && (!loc.lat || !loc.lng)) {
              quoteErr = "حدد الموقع أو الصق رابط خرائط ثم احتساب التوصيل";
              paint();
              return;
            }
            var snap = buildSnapshot(storeId, storeMeta, product, chosen, quote, loc);
            var compat = assertCartCompatible(snap);
            if (!compat.ok) {
              quoteErr = compat.message;
              paint();
              return;
            }
            close({ ok: true, snapshot: snap, qty: qty });
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
                quoteErr = "تعذر الوصول للموقع";
                paint();
              },
              { enableHighAccuracy: false, timeout: 12000 }
            );
          };
        }
        var qbtn = overlay.querySelector("#precartQuoteBtn");
        if (qbtn) {
          qbtn.onclick = async function () {
            quoteErr = "";
            var mapsIn = overlay.querySelector("#precartMaps");
            var addrIn = overlay.querySelector("#precartAddress");
            if (mapsIn && mapsIn.value.trim()) {
              try {
                var mr = await fetch(apiUrl("/api/store/resolve-maps-link"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: mapsIn.value.trim() }),
                });
                var mj = await mr.json();
                if (!mj.ok) throw new Error(mj.error || "تعذر قراءة الرابط");
                loc.lat = mj.lat;
                loc.lng = mj.lng;
                loc.maps_url = mapsIn.value.trim();
              } catch (e) {
                quoteErr = e.message || "تعذر قراءة الرابط";
                paint();
                return;
              }
            }
            if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
              quoteErr = "حدد GPS أو الصق رابط خرائط صالح";
              paint();
              return;
            }
            loc.address = addrIn ? addrIn.value.trim() || "عنوان التوصيل" : "عنوان التوصيل";
            var subtotal = (Number(product.price) || 0) * qty;
            var qs =
              "?lat=" +
              encodeURIComponent(loc.lat) +
              "&lng=" +
              encodeURIComponent(loc.lng) +
              "&fulfillment=" +
              encodeURIComponent(chosen) +
              "&subtotal=" +
              encodeURIComponent(subtotal) +
              (product.includes_delivery ? "&includes_delivery=1" : "");
            try {
              var res = await fetch(apiUrl("/api/store/public/" + encodeURIComponent(storeId) + "/delivery-quote" + qs));
              var data = await res.json();
              if (!data.ok) throw new Error(data.error || "تعذر حساب التوصيل");
              quote = data.quote || data;
              paint();
            } catch (e2) {
              quoteErr = e2.message || "خطأ في التوصيل";
              paint();
            }
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
    if (!precartEnabled()) return { handled: false };
    var pol =
      (ctx.storeMeta && ctx.storeMeta.delivery_engine && ctx.storeMeta.delivery_engine.delivery_policy) ||
      "ervenow_delivery";
    if (pol === "pickup_only" && !ctx.forceModal) {
      var snapOnly = buildSnapshot(ctx.storeId, ctx.storeMeta, ctx.product, "pickup", { delivery_free: true }, null);
      var c0 = assertCartCompatible(snapOnly);
      if (!c0.ok) return { handled: true, error: c0.message };
      return { handled: true, snapshot: snapOnly, qty: ctx.qty };
    }
    var result = await openModal(ctx);
    if (!result.ok) return { handled: true, cancelled: true };
    return { handled: true, snapshot: result.snapshot, qty: result.qty };
  }

  global.ErvenowPreCartDelivery = {
    loadFlags: loadFlags,
    interceptAdd: interceptAdd,
    precartEnabled: function () {
      return precartEnabled();
    },
  };
})(window);
