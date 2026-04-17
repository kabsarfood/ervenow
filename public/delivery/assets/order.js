(function () {
  const API_BASE = "https://kabsar-delivery-production.up.railway.app";
  const LS_NAME = "kabsarCustomerName";
  const LS_PHONE = "kabsarCustomerPhone";
  const LS_TOKEN = "kabsarCustomerToken";

  const DEFAULT_MAP_CENTER = { lat: 24.7136, lng: 46.6753 };

  /** للعرض فقط — الرقم النهائي يأتي من الخادم */
  function getHijriDate(d = new Date()) {
    try {
      return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(d);
    } catch {
      return "";
    }
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function orderNumberDatePartDisplay(part2) {
    const p = String(part2 || "");
    if (/^\d{4}$/.test(p)) {
      return p.slice(2, 4) + p.slice(0, 2);
    }
    return p;
  }

  function renderOrderNumberHtml(raw) {
    const s = String(raw || "").trim();
    const legacy = s.match(/^(\d+)-(\d+)$/);
    if (legacy) {
      const serial = legacy[1];
      const dateShown = orderNumberDatePartDisplay(legacy[2]);
      return (
        `<span class="order-number" dir="ltr" translate="no">` +
        `<span class="order-number__prefix">${escHtml(dateShown)}</span>` +
        `<span class="order-number__sep">-</span>` +
        `<span class="order-number__serial">${escHtml(serial)}</span>` +
        `</span>`
      );
    }
    const tail = s.match(/^(.+)-(\d+)$/);
    if (tail) {
      const prefix = tail[1];
      const serial = tail[2];
      return (
        `<span class="order-number" dir="ltr" translate="no">` +
        `<span class="order-number__prefix">${escHtml(prefix)}</span>` +
        `<span class="order-number__sep">-</span>` +
        `<span class="order-number__serial">${escHtml(serial)}</span>` +
        `</span>`
      );
    }
    return (
      `<span class="order-number" dir="ltr" translate="no">` +
      `<span class="order-number__mono">${escHtml(s)}</span>` +
      `</span>`
    );
  }

  /** مثال عرض فقط — الشكل النهائي من الخادم: KD-يوم_هجري-تسلسل */
  function formatKdOrderPreviewClient(seq) {
    let n = Number(seq);
    if (!Number.isFinite(n) || n < 1) n = 1;
    const seqStr = String(n).length < 3 ? String(n).padStart(3, "0") : String(n);
    let dayStr = "01";
    try {
      const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
        day: "2-digit",
      }).formatToParts(new Date());
      dayStr = parts.find((p) => p.type === "day")?.value || "01";
    } catch (_e) {
      dayStr = String(new Date().getDate()).padStart(2, "0");
    }
    return `KD-${dayStr}-${seqStr}`;
  }

  const apiBase = API_BASE;

  const cardLogin = document.getElementById("cardLogin");
  const cardOrder = document.getElementById("cardOrder");
  const cardSuccess = document.getElementById("cardSuccess");

  const elPhone = document.getElementById("custPhone");
  const elName = document.getElementById("custName");
  const elOtp = document.getElementById("custOtp");
  const msgLogin = document.getElementById("msgLogin");

  const elOrderName = document.getElementById("orderCustomerName");
  const elOrderPhone = document.getElementById("orderCustomerPhone");
  const elRecipientName = document.getElementById("recipientName");
  const elRecipientPhone = document.getElementById("recipientPhone");
  const elDetails = document.getElementById("orderDetails");
  const elDeliveryText = document.getElementById("deliveryAddressText");
  const elPickupMapLink = document.getElementById("pickupMapLink");
  const elDeliveryMapLink = document.getElementById("deliveryMapLink");
  const msgOrder = document.getElementById("msgOrder");
  const elSuccessOrderWrap = document.getElementById("successOrderNumberWrap");
  const elSuccessFee = document.getElementById("successFeeSummary");
  const elSuccessPayHint = document.getElementById("successPaymentHint");
  const lineDistance = document.getElementById("lineDistance");
  const lineFee = document.getElementById("lineFee");
  const lineHijriHint = document.getElementById("lineHijriHint");
  const linePeak = document.getElementById("linePeak");
  const lineDistanceNote = document.getElementById("lineDistanceNote");

  const pickupPreview = document.getElementById("pickupPreview");
  const deliveryPreview = document.getElementById("deliveryPreview");

  const mapPickerModal = document.getElementById("mapPickerModal");
  const mapPickerTitle = document.getElementById("mapPickerTitle");
  const mapPickerBackdrop = document.getElementById("mapPickerBackdrop");
  const mapPickerConfirm = document.getElementById("mapPickerConfirm");
  const mapPickerCancel = document.getElementById("mapPickerCancel");

  let pickupLat = null;
  let pickupLng = null;
  let deliveryLat = null;
  let deliveryLng = null;
  let orderType = "";
  let vehicleType = "motorcycle";
  let quoteTimer = null;

  let mapPickerTarget = "pickup";
  let mapPickerLeafletMap = null;
  let mapPickerMarker = null;
  let mapPickerTempLat = null;
  let mapPickerTempLng = null;

  /** تصحيح ترتيب lat/lng الشائع في السعودية عند اللصق الخاطئ */
  function maybeSwapForKsa(lat, lng) {
    const ksaLat = lat >= 16 && lat <= 32 && lng >= 34 && lng <= 56;
    const swapped = lng >= 16 && lng <= 32 && lat >= 34 && lat <= 56;
    if (!ksaLat && swapped) return { lat: lng, lng: lat };
    return { lat, lng };
  }

  function parseLatLngFromPaste(raw) {
    const s = decodeURIComponent(String(raw || "").trim());
    if (!s) return null;

    const tryPair = (a, b) => {
      const lat = Number(a);
      const lng = Number(b);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
      return maybeSwapForKsa(lat, lng);
    };

    let m = s.match(/[!?&]3d(-?\d+\.?\d*)[!&]4d(-?\d+\.?\d*)/i);
    if (m) {
      const p = tryPair(m[1], m[2]);
      if (p) return p;
    }

    m = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:[,/z]|z\d|$)/);
    if (m) {
      const p = tryPair(m[1], m[2]);
      if (p) return p;
    }

    m = s.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
    if (m) {
      const p = tryPair(m[1], m[2]);
      if (p) return p;
    }

    m = s.match(/[?&]q=([^&]+)/i);
    if (m) {
      const q = decodeURIComponent(m[1].replace(/\+/g, " "));
      const pair = q.match(/(-?\d+\.?\d+)\s*[,،]\s*(-?\d+\.?\d+)/);
      if (pair) {
        const p = tryPair(pair[1], pair[2]);
        if (p) return p;
      }
    }

    m = s.match(/[/?]dir\/[^?]*\/(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
    if (m) {
      const p = tryPair(m[1], m[2]);
      if (p) return p;
    }

    const loose = s.match(/(-?\d{1,2}\.\d{4,})\s*[,،]\s*(-?\d{1,2}\.\d{4,})/);
    if (loose) {
      const p = tryPair(loose[1], loose[2]);
      if (p) return p;
    }

    return null;
  }

  function geoErrorMessage(code) {
    const map = {
      1: "الموقع محظور من المتصفح. امنح الإذن من شريط العنوان، أو استخدم «فتح خريطة» أو «تطبيق الرابط».",
      2: "تعذر قراءة GPS. جرّب الخريطة أو لصق رابط من خرائط جوجل.",
      3: "انتهت مهلة GPS. جرّب مرة أخرى أو استخدم الخريطة أو الرابط.",
      0: "تعذر تحديد الموقع."
    };
    return map[code] ?? map[0];
  }

  function getGeoWithFallback() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "المتصفح لا يدعم GPS. استخدم «فتح خريطة واختيار النقطة» أو «تطبيق الرابط»."
          )
        );
        return;
      }
      if (!window.isSecureContext) {
        reject(
          new Error(
            "GPS يعمل عادة على https أو localhost فقط. استخدم الخريطة أو لصق رابط الموقع من خرائط جوجل."
          )
        );
        return;
      }
      const once = (opts) =>
        new Promise((res, rej) => {
          navigator.geolocation.getCurrentPosition(res, rej, opts);
        });
      once({ enableHighAccuracy: true, timeout: 14000, maximumAge: 0 })
        .then(resolve)
        .catch((e1) => {
          once({ enableHighAccuracy: false, timeout: 22000, maximumAge: 120000 })
            .then(resolve)
            .catch((e2) => {
              const code = e2?.code ?? e1?.code ?? 0;
              reject(new Error(geoErrorMessage(code)));
            });
        });
    });
  }

  function readCoords(pos) {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude
    };
  }

  function setCoordsPreview(el, lat, lng) {
    if (!el) return;
    el.textContent = `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
  }

  function schedulePricingQuote() {
    if (quoteTimer) clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      fetchPricingQuote().catch(() => {});
    }, 450);
  }

  async function fetchPricingQuote() {
    if (lineHijriHint) {
      const h = getHijriDate();
      lineHijriHint.textContent = h ? `📅 ${h}` : "";
    }
    const ok =
      pickupLat != null &&
      pickupLng != null &&
      deliveryLat != null &&
      deliveryLng != null;
    if (!lineDistance || !lineFee) return;
    if (!ok) {
      lineDistance.textContent = "📏 المسافة: — (حدّد الاستلام والتسليم)";
      lineFee.textContent = "💰 الإجمالي: —";
      if (linePeak) {
        linePeak.hidden = true;
        linePeak.textContent = "";
      }
      if (lineDistanceNote) lineDistanceNote.textContent = "";
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/pricing/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickup: { lat: pickupLat, lng: pickupLng },
          location: { lat: deliveryLat, lng: deliveryLng },
          vehicleType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || "تعذر حساب السعر");

      const km = Number(data.distanceKm);
      const price = Number(data.price);
      lineDistance.textContent = `📏 المسافة (طرق): ${km.toFixed(2)} كم`;
      if (linePeak) {
        if (data.peak) {
          linePeak.hidden = false;
          linePeak.textContent =
            "🔥 وقت الذروة — تسعير أعلى (15:00–18:00 الرياض، أحد–خميس)";
        } else {
          linePeak.hidden = true;
          linePeak.textContent = "";
        }
      }
      lineFee.textContent = `💰 الإجمالي: ${price.toFixed(2)} ر.س`;

      const src = data.distanceSource || "";
      const srcAr =
        src === "openrouteservice"
          ? "OpenRouteService"
          : src === "osrm"
            ? "OSRM (شوارع)"
            : src === "straight_line_fallback"
              ? "احتياطي: خط مستقيم (جرّب OPENROUTESERVICE_API_KEY)"
              : src;
      let seq = parseInt(localStorage.getItem("kabsarHijriPreviewSeq") || "0", 10) + 1;
      localStorage.setItem("kabsarHijriPreviewSeq", String(seq));
      if (lineDistanceNote) {
        lineDistanceNote.textContent = `المصدر: ${srcAr} · مثال تنسيق رقم العرض: ${formatKdOrderPreviewClient(
          seq
        )} (النهائي من الخادم عند الإرسال)`;
      }
    } catch (e) {
      lineDistance.textContent = "📏 المسافة: —";
      lineFee.textContent = "💰 تعذر حساب السعر";
      if (lineDistanceNote) lineDistanceNote.textContent = e.message || "";
      if (linePeak) linePeak.hidden = true;
    }
  }

  function selectedPaymentMethod() {
    const r = document.querySelector('input[name="paymentMethod"]:checked');
    return r ? r.value : "";
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("ok", "bad");
    if (kind) el.classList.add(kind);
  }

  function getSession() {
    return {
      name: localStorage.getItem(LS_NAME) || "",
      phone: localStorage.getItem(LS_PHONE) || "",
      token: localStorage.getItem(LS_TOKEN) || ""
    };
  }

  function saveSession(name, phone, token) {
    localStorage.setItem(LS_NAME, name);
    localStorage.setItem(LS_PHONE, phone);
    localStorage.setItem(LS_TOKEN, token);
  }

  function clearSession() {
    localStorage.removeItem(LS_NAME);
    localStorage.removeItem(LS_PHONE);
    localStorage.removeItem(LS_TOKEN);
  }

  function showLogin() {
    cardLogin.hidden = false;
    cardOrder.hidden = true;
    cardSuccess.hidden = true;
  }

  function closeMapPicker() {
    if (mapPickerModal) {
      mapPickerModal.hidden = true;
      mapPickerModal.setAttribute("aria-hidden", "true");
    }
  }

  function openMapPicker(target) {
    if (typeof window.L === "undefined") {
      setMsg(
        msgOrder,
        "تعذر تحميل مكتبة الخريطة. تحقق من الاتصال بالإنترنت وأعد تحميل الصفحة.",
        "bad"
      );
      return;
    }
    mapPickerTarget = target === "delivery" ? "delivery" : "pickup";
    if (mapPickerTitle) {
      mapPickerTitle.textContent =
        mapPickerTarget === "pickup"
          ? "اختر موقع الاستلام على الخريطة"
          : "اختر موقع التسليم (المستلم) على الخريطة";
    }

    const existingLat =
      mapPickerTarget === "pickup" ? pickupLat : deliveryLat;
    const existingLng =
      mapPickerTarget === "pickup" ? pickupLng : deliveryLng;
    const centerLat =
      existingLat != null
        ? existingLat
        : pickupLat != null
          ? pickupLat
          : DEFAULT_MAP_CENTER.lat;
    const centerLng =
      existingLng != null
        ? existingLng
        : pickupLng != null
          ? pickupLng
          : DEFAULT_MAP_CENTER.lng;
    const zoom = existingLat != null ? 16 : 12;

    mapPickerTempLat = existingLat;
    mapPickerTempLng = existingLng;

    mapPickerModal.hidden = false;
    mapPickerModal.setAttribute("aria-hidden", "false");

    const run = () => {
      const el = document.getElementById("pickerMap");
      if (!el) return;

      if (!mapPickerLeafletMap) {
        mapPickerLeafletMap = window.L.map(el).setView([centerLat, centerLng], zoom);
        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap"
        }).addTo(mapPickerLeafletMap);
        mapPickerLeafletMap.on("click", (e) => {
          mapPickerTempLat = e.latlng.lat;
          mapPickerTempLng = e.latlng.lng;
          if (!mapPickerMarker) {
            mapPickerMarker = window.L.marker(e.latlng).addTo(mapPickerLeafletMap);
          } else {
            mapPickerMarker.setLatLng(e.latlng);
          }
        });
      } else {
        mapPickerLeafletMap.setView([centerLat, centerLng], zoom);
        if (existingLat != null && existingLng != null) {
          if (!mapPickerMarker) {
            mapPickerMarker = window.L
              .marker([existingLat, existingLng])
              .addTo(mapPickerLeafletMap);
          } else {
            mapPickerMarker.setLatLng([existingLat, existingLng]);
          }
        } else {
          if (mapPickerMarker) {
            mapPickerMarker.remove();
            mapPickerMarker = null;
          }
        }
      }
      setTimeout(() => mapPickerLeafletMap && mapPickerLeafletMap.invalidateSize(), 250);
    };

    requestAnimationFrame(() => requestAnimationFrame(run));
  }

  function confirmMapPicker() {
    if (mapPickerTempLat == null || mapPickerTempLng == null) {
      setMsg(msgOrder, "انقر على الخريطة لوضع الدبوس قبل التأكيد.", "bad");
      return;
    }
    if (mapPickerTarget === "pickup") {
      pickupLat = mapPickerTempLat;
      pickupLng = mapPickerTempLng;
      setCoordsPreview(pickupPreview, pickupLat, pickupLng);
    } else {
      deliveryLat = mapPickerTempLat;
      deliveryLng = mapPickerTempLng;
      setCoordsPreview(deliveryPreview, deliveryLat, deliveryLng);
    }
    schedulePricingQuote();
    setMsg(msgOrder, "تم حفظ الموقع من الخريطة.", "ok");
    closeMapPicker();
  }

  function applyPastedLink(target) {
    const input = target === "delivery" ? elDeliveryMapLink : elPickupMapLink;
    const raw = (input?.value || "").trim();
    if (!raw) {
      setMsg(msgOrder, "الصق رابط خرائط جوجل أو إحداثيات (خط عرض، خط طول).", "bad");
      return;
    }
    const p = parseLatLngFromPaste(raw);
    if (!p) {
      setMsg(
        msgOrder,
        "لم نستطع استخراج الإحداثيات. انسخ الرابط الطويل من شريط المتصفح بعد فتح الموقع في خرائط جوجل، أو الصق مثل: 24.7136, 46.6753",
        "bad"
      );
      return;
    }
    if (target === "pickup") {
      pickupLat = p.lat;
      pickupLng = p.lng;
      setCoordsPreview(pickupPreview, pickupLat, pickupLng);
    } else {
      deliveryLat = p.lat;
      deliveryLng = p.lng;
      setCoordsPreview(deliveryPreview, deliveryLat, deliveryLng);
    }
    schedulePricingQuote();
    setMsg(msgOrder, "تم تطبيق الموقع من الرابط.", "ok");
  }

  function showOrderForm() {
    const s = getSession();
    cardLogin.hidden = true;
    cardOrder.hidden = false;
    cardSuccess.hidden = true;
    elOrderName.value = s.name;
    elOrderPhone.value = s.phone;
    if (elRecipientName) elRecipientName.value = "";
    if (elRecipientPhone) elRecipientPhone.value = "";
    pickupLat = null;
    pickupLng = null;
    deliveryLat = null;
    deliveryLng = null;
    pickupPreview.textContent = "لم يُحدَّد بعد";
    deliveryPreview.textContent = "لم يُحدَّد بعد";
    elDetails.value = "";
    elDeliveryText.value = "";
    if (elPickupMapLink) elPickupMapLink.value = "";
    if (elDeliveryMapLink) elDeliveryMapLink.value = "";
    orderType = "";
    vehicleType = "motorcycle";
    document.querySelectorAll(".order-type-btn[data-type]").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".order-type-btn[data-vehicle]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-vehicle") === "motorcycle");
    });
    document.querySelectorAll('input[name="paymentMethod"]').forEach((inp) => {
      inp.checked = inp.value === "cash";
    });
    schedulePricingQuote();
    setMsg(msgOrder, "", "");
    if (elSuccessFee) elSuccessFee.textContent = "";
    if (elSuccessPayHint) elSuccessPayHint.textContent = "";
    if (elSuccessOrderWrap) elSuccessOrderWrap.innerHTML = "";
  }

  function showSuccess(payload) {
    cardLogin.hidden = true;
    cardOrder.hidden = true;
    cardSuccess.hidden = false;
    const p = typeof payload === "object" && payload ? payload : {};

    if (elSuccessOrderWrap) {
      elSuccessOrderWrap.innerHTML = p.orderNumber
        ? renderOrderNumberHtml(p.orderNumber)
        : `<span class="order-number" translate="no">—</span>`;
    }

    if (elSuccessFee) {
      if (p.distanceKm != null && p.deliveryFee != null) {
        const peakTxt = p.peak ? " · ذروة" : "";
        elSuccessFee.textContent = `📏 ${Number(p.distanceKm).toFixed(2)} كم (طرق) · 💰 ${Number(p.deliveryFee).toFixed(2)} ر.س${peakTxt}`;
      } else {
        elSuccessFee.textContent = "";
      }
    }
    if (elSuccessPayHint) {
      if (p.paymentMethod === "cash") {
        elSuccessPayHint.textContent =
          "تذكير: الدفع نقداً (كاش) عند تسليم الطلب للمستلم.";
      } else if (p.paymentMethod === "online") {
        elSuccessPayHint.textContent =
          "تذكير: يمكن السداد بوسائل الدفع المتاحة (بطاقة، محفظة، تحويل، إلخ) حسب ترتيبك مع المندوب عند التسليم.";
      } else {
        elSuccessPayHint.textContent = "";
      }
    }
  }

  document.getElementById("btnSendOtp")?.addEventListener("click", async () => {
    try {
      setMsg(msgLogin, "جارٍ الإرسال…", "");
      const phone = elPhone.value.trim();
      if (!phone) throw new Error("أدخل رقم الجوال");

      const res = await fetch(`${apiBase}/api/customer/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || "تعذر إرسال الرمز");

      const dev = data.devOtp ? ` (رمز تجريبي: ${data.devOtp})` : "";
      setMsg(msgLogin, (data.message || "تم الإرسال") + dev, "ok");
    } catch (e) {
      setMsg(msgLogin, e.message, "bad");
    }
  });

  document.getElementById("btnVerifyOtp")?.addEventListener("click", async () => {
    try {
      setMsg(msgLogin, "جارٍ التحقق…", "");
      const phone = elPhone.value.trim();
      const name = elName.value.trim();
      const code = String(elOtp.value || "").trim();
      if (!phone || !name || !code) throw new Error("أكمل الاسم والجوال والرمز");

      const res = await fetch(`${apiBase}/api/customer/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, name })
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) throw new Error(data.message || "فشل التحقق");

      saveSession(data.customerName, data.customerPhone, data.customerToken);
      showOrderForm();
    } catch (e) {
      setMsg(msgLogin, e.message, "bad");
    }
  });

  document.getElementById("btnLogoutCustomer")?.addEventListener("click", () => {
    clearSession();
    showLogin();
  });

  document.querySelectorAll(".order-type-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".order-type-btn[data-type]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      orderType = btn.getAttribute("data-type") || "";
    });
  });

  document.querySelectorAll(".order-type-btn[data-vehicle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".order-type-btn[data-vehicle]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      vehicleType = btn.getAttribute("data-vehicle") || "motorcycle";
      schedulePricingQuote();
    });
  });

  async function bindGeo(target) {
    try {
      setMsg(
        msgOrder,
        target === "pickup" ? "جارٍ تحديد موقع الاستلام…" : "جارٍ تحديد موقع التسليم…",
        ""
      );
      const pos = await getGeoWithFallback();
      const c = readCoords(pos);
      if (target === "pickup") {
        pickupLat = c.lat;
        pickupLng = c.lng;
        setCoordsPreview(pickupPreview, pickupLat, pickupLng);
        setMsg(msgOrder, "تم حفظ موقع الاستلام (GPS).", "ok");
      } else {
        deliveryLat = c.lat;
        deliveryLng = c.lng;
        setCoordsPreview(deliveryPreview, deliveryLat, deliveryLng);
        setMsg(msgOrder, "تم حفظ موقع التسليم (GPS).", "ok");
      }
      schedulePricingQuote();
    } catch (e) {
      setMsg(msgOrder, e.message || "تعذر تحديد الموقع", "bad");
    }
  }

  document.getElementById("btnPickupGeo")?.addEventListener("click", () => bindGeo("pickup"));
  document.getElementById("btnDeliveryGeo")?.addEventListener("click", () => bindGeo("delivery"));

  document.getElementById("btnPickupMap")?.addEventListener("click", () => openMapPicker("pickup"));
  document.getElementById("btnDeliveryMap")?.addEventListener("click", () =>
    openMapPicker("delivery")
  );

  document.getElementById("btnPickupApplyLink")?.addEventListener("click", () =>
    applyPastedLink("pickup")
  );
  document.getElementById("btnDeliveryApplyLink")?.addEventListener("click", () =>
    applyPastedLink("delivery")
  );

  mapPickerConfirm?.addEventListener("click", confirmMapPicker);
  mapPickerCancel?.addEventListener("click", closeMapPicker);
  mapPickerBackdrop?.addEventListener("click", closeMapPicker);

  document.getElementById("btnSubmitOrder")?.addEventListener("click", async () => {
    try {
      setMsg(msgOrder, "جارٍ الإرسال…", "");
      const s = getSession();
      if (!s.token) {
        showLogin();
        throw new Error("انتهت الجلسة — سجّل الدخول من جديد");
      }

      if (!orderType) throw new Error("اختر نوع الطلب");
      if (vehicleType !== "motorcycle" && vehicleType !== "car") {
        throw new Error("اختر نوع المركبة");
      }
      if (pickupLat == null || pickupLng == null) throw new Error("حدّد موقع الاستلام");
      if (deliveryLat == null || deliveryLng == null) {
        throw new Error("حدّد موقع التسليم لحساب المسافة والأجرة");
      }

      const recName = (elRecipientName?.value || "").trim();
      const recPhone = (elRecipientPhone?.value || "").trim();
      if (!recName || !recPhone) throw new Error("أدخل اسم المستلم وجواله");

      const pay = selectedPaymentMethod();
      if (pay !== "cash" && pay !== "online") throw new Error("اختر وسيلة الدفع");

      const body = {
        customerName: elOrderName.value.trim() || s.name,
        customerPhone: s.phone,
        recipientName: recName,
        recipientPhone: recPhone,
        paymentMethod: pay,
        vehicleType,
        pickup: { lat: pickupLat, lng: pickupLng },
        location: { lat: deliveryLat, lng: deliveryLng },
        orderDetails: elDetails.value.trim(),
        source: "public",
        orderType
      };

      const addr = elDeliveryText.value.trim();
      if (addr) body.deliveryAddress = addr;

      const res = await fetch(`${apiBase}/api/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "تعذر إرسال الطلب");

      showSuccess({
        orderNumber: data.orderNumber,
        deliveryFee: data.deliveryFee,
        distanceKm: data.distanceKm,
        paymentMethod: data.paymentMethod,
        peak: data.peak
      });
    } catch (e) {
      setMsg(msgOrder, e.message, "bad");
    }
  });

  document.getElementById("btnNewOrder")?.addEventListener("click", () => {
    showOrderForm();
  });

  const s = getSession();
  if (s.token && s.name) {
    showOrderForm();
  } else {
    showLogin();
  }
})();
