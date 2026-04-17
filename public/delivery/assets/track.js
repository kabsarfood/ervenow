(function () {
  const API_BASE = "https://kabsar-delivery-production.up.railway.app";
  const DEFAULT_CENTER = [24.7136, 46.6753];
  const DEFAULT_ZOOM = 12;

  const elError = document.getElementById("trackError");
  const elLoading = document.getElementById("trackLoading");
  const elContent = document.getElementById("trackContent");
  const orderNumberEl = document.getElementById("orderNumberEl");
  const customerNameEl = document.getElementById("customerNameEl");
  const statusEl = document.getElementById("statusEl");
  const driverNameEl = document.getElementById("driverNameEl");
  const btnCall = document.getElementById("btnCallDriver");
  const btnWa = document.getElementById("btnWaDriver");
  const btnOpenCustomerMap = document.getElementById("btnOpenCustomerMap");

  function orderIdFromPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    return last || "";
  }

  function digits(p) {
    return String(p || "").replace(/\D/g, "");
  }

  function waUrl(phone) {
    let d = digits(phone);
    if (!d) return "#";
    if (d.startsWith("0")) d = "966" + d.slice(1);
    else if (d.length === 9 && d.startsWith("5")) d = "966" + d;
    return `https://wa.me/${d}`;
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

  function statusUi(status) {
    const map = {
      preparing: { text: "قيد التحضير", cls: "is-preparing" },
      accepted: { text: "في الطريق", cls: "is-onroad" },
      onroad: { text: "في الطريق", cls: "is-onroad" },
      delivering: { text: "جاري التسليم", cls: "is-delivering" },
      delivered: { text: "تم التسليم", cls: "is-delivered" }
    };
    return map[status] || { text: status || "—", cls: "" };
  }

  function emojiIcon(emoji) {
    return L.divIcon({
      className: "track-marker-emoji",
      html: `<div style="font-size:26px;line-height:1;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.25)">${emoji}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function showError(msg) {
    elLoading.hidden = true;
    elContent.hidden = true;
    elError.hidden = false;
    elError.textContent = msg;
  }

  function attachLiveSocket(orderId, trackToken, map, driverMarkerRef) {
    if (typeof io === "undefined") return null;

    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socket.emit("join-order", {
      orderId: String(orderId || ""),
      trackToken: String(trackToken || "")
    });

    socket.on("driver-location", ({ lat, lng }) => {
      const la = Number(lat);
      const ln = Number(lng);
      if (Number.isNaN(la) || Number.isNaN(ln)) return;

      const ll = [la, ln];

      if (!driverMarkerRef.marker) {
        driverMarkerRef.marker = L.marker(ll, { icon: emojiIcon("🚚") })
          .addTo(map)
          .bindPopup("المندوب — بث حي");
      } else {
        driverMarkerRef.marker.setLatLng(ll);
      }
    });

    return socket;
  }

  async function run() {
    const trackToken = orderIdFromPath();
    if (!trackToken) {
      showError("رابط التتبع غير صالح.");
      return;
    }

    let res;
    try {
      res = await fetch(`${API_BASE}/api/track/${encodeURIComponent(trackToken)}`);
    } catch {
      showError("تعذر الاتصال بالخادم.");
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      showError("استجابة غير صالحة من الخادم.");
      return;
    }

    if (!res.ok || !data.success) {
      showError("تعذر تحميل الطلب.");
      return;
    }

    elLoading.hidden = true;
    elError.hidden = true;
    elContent.hidden = false;

    if (data.orderNumber) {
      orderNumberEl.innerHTML = renderOrderNumberHtml(data.orderNumber);
    } else {
      orderNumberEl.innerHTML = `<span class="order-number" translate="no">—</span>`;
    }
    customerNameEl.textContent = data.customerName || "عميل";
    if (driverNameEl) driverNameEl.textContent = data.driverName || "—";

    const st = statusUi(data.status);
    statusEl.textContent = st.text;
    statusEl.className = "track-status-pill " + st.cls;

    const phone = data.driverPhone || "";
    if (phone) {
      btnCall.href = "tel:" + phone;
      btnCall.removeAttribute("aria-disabled");
      btnCall.style.opacity = "";
      btnCall.style.pointerEvents = "";
    } else {
      btnCall.href = "#";
      btnCall.setAttribute("aria-disabled", "true");
      btnCall.style.opacity = "0.5";
      btnCall.style.pointerEvents = "none";
    }

    btnWa.href = digits(phone) ? waUrl(phone) : "#";
    if (!digits(phone)) {
      btnWa.style.opacity = "0.5";
      btnWa.style.pointerEvents = "none";
    } else {
      btnWa.style.opacity = "";
      btnWa.style.pointerEvents = "";
    }

    const cl = data.customerLocation || {};
    if (cl.mapUrl) {
      btnOpenCustomerMap.href = cl.mapUrl;
      btnOpenCustomerMap.hidden = false;
    }

    const custLat = cl.lat != null ? Number(cl.lat) : null;
    const custLng = cl.lng != null ? Number(cl.lng) : null;
    const hasCust = custLat != null && custLng != null && !Number.isNaN(custLat) && !Number.isNaN(custLng);

    const dl = data.driverLastLocation;
    const hasDrv =
      dl &&
      dl.lat != null &&
      dl.lng != null &&
      !Number.isNaN(Number(dl.lat)) &&
      !Number.isNaN(Number(dl.lng));

    const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const bounds = [];
    const driverMarkerRef = { marker: null };

    if (hasCust) {
      L.marker([custLat, custLng], { icon: emojiIcon("📍") })
        .addTo(map)
        .bindPopup("موقع التسليم");
      bounds.push([custLat, custLng]);
    }

    if (hasDrv) {
      driverMarkerRef.marker = L.marker([Number(dl.lat), Number(dl.lng)], {
        icon: emojiIcon("🚚")
      })
        .addTo(map)
        .bindPopup("المندوب — آخر موقع محفوظ");
      bounds.push([Number(dl.lat), Number(dl.lng)]);
    }

    if (bounds.length === 2) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      if (!hasCust && !hasDrv) {
        L.popup()
          .setLatLng(DEFAULT_CENTER)
          .setContent(
            "لا تتوفر إحداثيات بعد. انتظر بث المندوب أو استخدم «فتح موقع التسليم»."
          )
          .openOn(map);
      }
    }

    let pollTimer = null;
    function clearPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function tickDriverLocation() {
      const oid = String(data.orderId || "");
      if (!oid) return;
      fetch(
        `${API_BASE}/api/order/driver-location?order_id=` +
          encodeURIComponent(oid) +
          "&track_token=" +
          encodeURIComponent(trackToken)
      )
        .then((r) => r.json())
        .then((j) => {
          console.log("[track.js] driver-location:", j);
          if (!j || !j.success) return;
          if (!j.tracking) {
            clearPoll();
            return;
          }
          if (j.lat == null || j.lng == null) return;
          const la = Number(j.lat);
          const ln = Number(j.lng);
          if (Number.isNaN(la) || Number.isNaN(ln)) return;
          const ll = [la, ln];
          if (!driverMarkerRef.marker) {
            driverMarkerRef.marker = L.marker(ll, { icon: emojiIcon("🚚") })
              .addTo(map)
              .bindPopup("المندوب — بث حي");
          } else {
            driverMarkerRef.marker.setLatLng(ll);
          }
        })
        .catch((e) => {
          console.error("[track.js] driver-location fetch:", e);
        });
    }

    const liveStatuses = ["accepted", "onroad", "delivering"];
    if (liveStatuses.includes(data.status) && data.orderId) {
      attachLiveSocket(data.orderId, trackToken, map, driverMarkerRef);
      tickDriverLocation();
      pollTimer = setInterval(tickDriverLocation, 7000);
    }
  }

  run();
})();
