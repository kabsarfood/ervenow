(() => {
  const API_BASE = "https://kabsar-delivery-production.up.railway.app";
  const {
    qs,
    setMsg,
    api,
    requireAuthOrRedirect,
    beep,
    getToken
  } = window.KABSAR;

  requireAuthOrRedirect();

  async function logout() {
    try {
      await api("/logout", { method: "POST" });
    } catch {
      /* يُكمل التنظيف والتحويل حتى عند فشل الخادم */
    } finally {
      localStorage.removeItem("driverToken");
      localStorage.removeItem("driver");
      window.location.href = "/delivery/login.html";
    }
  }

  const msg = qs("#msgOrders");
  const list = qs("#list");
  const listMine = qs("#listMine");
  const mineOrdersPanel = qs("#mineOrdersPanel");
  const kpiMineBox = qs("#kpiMineBox");
  const btnRefresh = qs("#btnRefresh");
  const btnLogout = qs("#btnLogout");
  const kpiNew = qs("#kpiNew");
  const kpiMine = qs("#kpiMine");
  const driverNameEl = qs("#driverName");
  const connStatusEl = qs("#connStatus");
  const connLabelEl = qs("#connLabel");
  const activeSection = qs("#activeSection");
  const activePanel = qs("#activePanel");
  const alertSound = qs("#alertSound");
  const tagLive = qs("#tagLive");

  const ordersById = new Map();
  let lastPoolLenForAlert = 0;
  let initialSyncDone = false;
  let lastActiveRenderKey = "";
  let socket = null;
  let socketHadDisconnect = false;
  let locationTimer = null;
  let trackingOrderId = null;
  let lastMineActive = null;
  let minePanelOpen = false;
  /** معرّف المندوب (UUID) — لـ POST /api/driver/update-location */
  let driverRowId = null;

  const DRIVER_LOC_INTERVAL_MS = 5000;

  function digits(p) {
    return String(p || "").replace(/\D/g, "");
  }

  function isMine(order) {
    if (!driverRowId || !order.driverId) return false;
    return String(order.driverId) === String(driverRowId);
  }

  function isPoolOrder(o) {
    return (
      (o.status === "pending" || o.status === "new" || o.status === "preparing") &&
      !o.driverId
    );
  }

  function isPastMineOrder(o) {
    return isMine(o) && o.status === "delivered";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function orderNumberDisplay(o) {
    const n = String(o?.orderNumber || "").trim();
    if (n) return n;
    return String(o?.hijriDisplayNumber || "").trim();
  }

  /** عرض جزء التاريخ: 2903 → 0329 (تبديل زوجين) — التسلسل يبقى كما في الخادم */
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
        `<span class="order-number__prefix">${esc(dateShown)}</span>` +
        `<span class="order-number__sep">-</span>` +
        `<span class="order-number__serial">${esc(serial)}</span>` +
        `</span>`
      );
    }
    const tail = s.match(/^(.+)-(\d+)$/);
    if (tail) {
      const prefix = tail[1];
      const serial = tail[2];
      return (
        `<span class="order-number" dir="ltr" translate="no">` +
        `<span class="order-number__prefix">${esc(prefix)}</span>` +
        `<span class="order-number__sep">-</span>` +
        `<span class="order-number__serial">${esc(serial)}</span>` +
        `</span>`
      );
    }
    return (
      `<span class="order-number" dir="ltr" translate="no">` +
      `<span class="order-number__mono">${esc(s)}</span>` +
      `</span>`
    );
  }

  function vehicleLabel(o) {
    const v = String(o?.vehicleType || "").toLowerCase();
    if (v === "car") return "سيارة";
    if (v === "motorcycle") return "دراجة نارية";
    return o?.vehicleType ? String(o.vehicleType) : "";
  }

  function statusTag(status) {
    const map = {
      pending: { t: "في التجمّع", cls: "gold" },
      new: { t: "جديد", cls: "gold" },
      preparing: { t: "جاري التحضير", cls: "gold" },
      accepted: { t: "مستلم", cls: "" },
      onroad: { t: "قيد التوصيل", cls: "" },
      delivering: { t: "جاري التسليم", cls: "" },
      delivered: { t: "تم التسليم", cls: "ok" }
    };
    const v = map[status] || { t: status, cls: "" };
    return `<span class="tag tag--status ${v.cls}">${v.t}</span>`;
  }

  function formatPhoneDisplay(p) {
    if (!p) return "—";
    const d = digits(p);
    if (d.length < 8) return esc(p);
    return esc(d.slice(0, 4) + "****" + d.slice(-3));
  }

  function customerPhoneRaw(o) {
    return String(o.phone || o.customerPhone || "").trim();
  }

  function pickupMapHref(o) {
    const la = o.pickupLat;
    const ln = o.pickupLng;
    if (
      la != null &&
      ln != null &&
      !Number.isNaN(Number(la)) &&
      !Number.isNaN(Number(ln))
    ) {
      return `https://maps.google.com/?q=${la},${ln}`;
    }
    return "";
  }

  function deliveryMapHref(o) {
    const a = String(o.address || "").trim();
    if (a.startsWith("http")) return a;
    const la = o.locationLat;
    const ln = o.locationLng;
    if (
      la != null &&
      ln != null &&
      !Number.isNaN(Number(la)) &&
      !Number.isNaN(Number(ln))
    ) {
      return `https://maps.google.com/?q=${la},${ln}`;
    }
    return "";
  }

  function orderTypeLabelAr(o) {
    const t = String(o?.orderType || "").toLowerCase().trim();
    if (t === "store") return "متجر";
    if (t === "family") return "عائلي";
    if (t === "individual") return "فردي";
    const st = String(o?.storeType || "").trim();
    if (st) return st;
    return "—";
  }

  function stripUrls(text) {
    return String(text || "")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function waUrlForPhone(phone) {
    let d = digits(phone);
    if (!d) return "";
    if (d.startsWith("0")) d = "966" + d.slice(1);
    else if (d.length === 9 && d.startsWith("5")) d = "966" + d;
    return `https://wa.me/${d}`;
  }

  function setLiveConnected(ok) {
    if (!connStatusEl || !connLabelEl) return;
    connStatusEl.classList.toggle("driver-header__conn--live", !!ok);
    const dot = connStatusEl.querySelector(".conn-dot");
    if (dot) {
      dot.classList.toggle("conn-dot--live", !!ok);
      dot.classList.toggle("conn-dot--off", !ok);
    }
    connLabelEl.textContent = ok
      ? "🟢 متصل — تحديث لحظي (Socket)"
      : "🔴 انقطع الاتصال — جرّب «تحديث الآن»";
  }

  function stopDriverLocationStream() {
    if (locationTimer != null) {
      clearInterval(locationTimer);
      locationTimer = null;
    }
    trackingOrderId = null;
  }

  function startDriverLocationStream(orderId) {
    stopDriverLocationStream();
    const oid = String(orderId || "").trim();
    if (!oid) return;

    trackingOrderId = oid;

    const emitOnce = () => {
      if (!trackingOrderId) return;
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          api("/update-location", {
            method: "POST",
            body: { lat, lng }
          })
            .then((r) => {
              console.log("[orders] update-location sent", {
                lat,
                lng,
                ok: r && r.success
              });
            })
            .catch((e) => {
              console.error("[orders] update-location error:", e);
            });
        },
        (err) => {
          console.error("[orders] geolocation error:", err);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 8000,
          timeout: 15000
        }
      );
    };

    emitOnce();
    locationTimer = setInterval(emitOnce, DRIVER_LOC_INTERVAL_MS);
  }

  function syncDriverLocationStream(mineActive) {
    stopDriverLocationStream();
    const active =
      mineActive &&
      ["accepted", "onroad", "delivering"].includes(mineActive.status) &&
      isMine(mineActive);
    if (active) startDriverLocationStream(mineActive._id);
  }

  function htmlToElement(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function orderUiSig(o) {
    return [
      o.status,
      o.driverId || "",
      Number(o.total) || 0,
      o.customerName || "",
      o.deliveryDistanceKm ?? "",
      o.updatedAt || o.createdAt || "",
      o.notes || ""
    ].join("|");
  }

  function sortOrdersByIdDesc(arr) {
    return arr.slice().sort((a, b) => String(b._id).localeCompare(String(a._id)));
  }

  function applyFullSnapshot(ordersArr) {
    const incoming = new Set();
    for (const o of ordersArr || []) {
      const id = String(o._id);
      incoming.add(id);
      ordersById.set(id, o);
    }
    for (const id of [...ordersById.keys()]) {
      if (!incoming.has(id)) ordersById.delete(id);
    }
  }

  function upsertLiveOrder(order) {
    if (!order || order._id == null) return;
    ordersById.set(String(order._id), order);
  }

  function ensurePoolEmptyEl(container) {
    let el = container.querySelector("[data-pool-empty]");
    if (!el) {
      el = document.createElement("div");
      el.dataset.poolEmpty = "";
      el.className = "meta driver-empty-pool";
      el.style.padding = "16px";
      el.style.textAlign = "center";
      el.style.fontSize = "12px";
      el.textContent = "لا توجد طلبات متاحة للاستلام حالياً.";
      container.appendChild(el);
    }
    return el;
  }

  function ensureHistoryEmptyEl(container) {
    let el = container.querySelector("[data-history-empty]");
    if (!el) {
      el = document.createElement("div");
      el.dataset.historyEmpty = "";
      el.className = "meta";
      el.style.textAlign = "center";
      el.style.padding = "10px";
      el.style.fontSize = "12px";
      el.textContent = "لا توجد طلبات منتهية في سجلّك.";
      container.appendChild(el);
    }
    return el;
  }

  function reconcilePoolDom(sortedPool) {
    if (!list) return;
    const emptyEl = ensurePoolEmptyEl(list);
    emptyEl.hidden = sortedPool.length > 0;

    const want = new Set(sortedPool.map((o) => String(o._id)));
    for (const node of [...list.querySelectorAll(".order.order-card[data-order-id]")]) {
      if (!want.has(node.dataset.orderId)) node.remove();
    }

    for (const o of sortedPool) {
      const id = String(o._id);
      const sig = orderUiSig(o);
      let el = list.querySelector(`.order.order-card[data-order-id="${id}"]`);
      if (!el) {
        el = htmlToElement(orderCard(o));
        el.dataset.orderId = id;
        el.dataset.uiSig = sig;
        el.classList.add("order-card--enter");
        list.appendChild(el);
        requestAnimationFrame(() => el.classList.remove("order-card--enter"));
      } else if (el.dataset.uiSig !== sig) {
        const nu = htmlToElement(orderCard(o));
        nu.dataset.orderId = id;
        nu.dataset.uiSig = sig;
        el.replaceWith(nu);
      }
    }

    for (let i = 0; i < sortedPool.length; i++) {
      const el = list.querySelector(`.order.order-card[data-order-id="${String(sortedPool[i]._id)}"]`);
      const nextO = sortedPool[i + 1];
      const nextEl = nextO
        ? list.querySelector(`.order.order-card[data-order-id="${String(nextO._id)}"]`)
        : null;
      if (el) list.insertBefore(el, nextEl);
    }

    if (!emptyEl.hidden) list.insertBefore(emptyEl, list.firstChild);
  }

  function reconcileHistoryDom(sortedPast) {
    if (!listMine) return;
    const emptyEl = ensureHistoryEmptyEl(listMine);
    emptyEl.hidden = sortedPast.length > 0;

    const want = new Set(sortedPast.map((o) => String(o._id)));
    for (const node of [...listMine.querySelectorAll(".order.order-card[data-order-id]")]) {
      if (!want.has(node.dataset.orderId)) node.remove();
    }

    for (const o of sortedPast) {
      const id = String(o._id);
      const sig = orderUiSig(o);
      let el = listMine.querySelector(`.order.order-card[data-order-id="${id}"]`);
      if (!el) {
        el = htmlToElement(orderCard(o, { history: true }));
        el.dataset.orderId = id;
        el.dataset.uiSig = sig;
        listMine.appendChild(el);
      } else if (el.dataset.uiSig !== sig) {
        const nu = htmlToElement(orderCard(o, { history: true }));
        nu.dataset.orderId = id;
        nu.dataset.uiSig = sig;
        el.replaceWith(nu);
      }
    }

    for (let i = 0; i < sortedPast.length; i++) {
      const el = listMine.querySelector(
        `.order.order-card[data-order-id="${String(sortedPast[i]._id)}"]`
      );
      const nextO = sortedPast[i + 1];
      const nextEl = nextO
        ? listMine.querySelector(`.order.order-card[data-order-id="${String(nextO._id)}"]`)
        : null;
      if (el) listMine.insertBefore(el, nextEl);
    }

    if (!emptyEl.hidden) listMine.insertBefore(emptyEl, listMine.firstChild);
  }

  function reconcileAll(opts = {}) {
    const all = [...ordersById.values()];

    const mineActive = all.find(
      (o) =>
        isMine(o) &&
        (o.status === "accepted" ||
          o.status === "onroad" ||
          o.status === "delivering")
    );

    const poolOrders = sortOrdersByIdDesc(all.filter(isPoolOrder));
    const pastMine = sortOrdersByIdDesc(all.filter((o) => isPastMineOrder(o)));

    if (mineActive) {
      const key = `${mineActive._id}|${mineActive.status}|${orderUiSig(mineActive)}`;
      if (key !== lastActiveRenderKey) {
        lastActiveRenderKey = key;
        renderActiveOrder(mineActive);
      }
      activeSection.hidden = false;
    } else {
      lastActiveRenderKey = "";
      hideActive();
    }

    lastMineActive = mineActive;
    syncDriverLocationStream(mineActive);

    reconcilePoolDom(poolOrders);
    reconcileHistoryDom(pastMine);

    if (kpiNew) kpiNew.textContent = poolOrders.length;
    if (kpiMine) kpiMine.textContent = pastMine.length;

    if (initialSyncDone && poolOrders.length > lastPoolLenForAlert && lastPoolLenForAlert > 0) {
      beep();
      try {
        alertSound?.play?.();
      } catch {
        /* ignore */
      }
    }
    lastPoolLenForAlert = poolOrders.length;
    if (!initialSyncDone) initialSyncDone = true;

    if (!opts.silentMsg) {
      if (!poolOrders.length && !mineActive && !pastMine.length) {
        setMsg(msg, "لا توجد طلبات حالياً.", "");
      } else {
        const t = new Date().toLocaleTimeString("ar-SA");
        setMsg(msg, socket?.connected ? `متصل — آخر تحديث ${t}` : `آخر مزامنة ${t}`, "ok");
      }
    }
  }

  async function syncFromServer(options = {}) {
    const { silentMsg = false } = options;
    try {
      if (!silentMsg) setMsg(msg, "جارٍ المزامنة…", "");
      const [poolRes, mineRes] = await Promise.all([
        api("/orders"),
        api("/my-orders").catch(() => ({ orders: [] }))
      ]);
      const pool = poolRes.orders || [];
      const mine = mineRes.orders || [];
      const seen = new Set();
      const orders = [];
      for (const o of [...pool, ...mine]) {
        const id = String(o._id || o.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        orders.push(o);
      }
      console.log("[orders] sync pool:", pool.length, "mine:", mine.length, "merged:", orders.length);
      applyFullSnapshot(orders);
      reconcileAll({ silentMsg });
    } catch (e) {
      lastMineActive = null;
      stopDriverLocationStream();
      setLiveConnected(false);
      if (e.status === 401) return logout();
      setMsg(msg, e.message, "bad");
    }
  }

  function initDriverSocket() {
    if (typeof io === "undefined") {
      if (tagLive) tagLive.textContent = "بدون Socket";
      return;
    }
    socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socket.on("connect", () => {
      setLiveConnected(true);
      if (tagLive) tagLive.textContent = "Live — Socket";
      if (socketHadDisconnect) {
        socketHadDisconnect = false;
        syncFromServer({ silentMsg: true });
      }
      syncDriverLocationStream(lastMineActive);
    });
    socket.on("disconnect", () => {
      socketHadDisconnect = true;
      stopDriverLocationStream();
      setLiveConnected(false);
      if (tagLive) tagLive.textContent = "إعادة اتصال…";
    });
    socket.on("order_live", (payload) => {
      const order = payload && payload.order;
      if (!order) return;
      upsertLiveOrder(order);
      reconcileAll({ silentMsg: true });
    });
  }

  function itemsBlock(o) {
    const items = o.items || [];
    if (!items.length) return `<div class="meta">🛒 لا تفاصيل أصناف</div>`;
    return items
      .map((i) => {
        const qty = Number(i.qty) || 1;
        const price = Number(i.price) || 0;
        const line = (price * qty).toFixed(2);
        return `<div class="meta">• ${esc(i.name)} ×${qty} — ${line} ر.س</div>`;
      })
      .join("");
  }

  function locationBlock(o) {
    const p = pickupMapHref(o);
    const d = deliveryMapHref(o);
    if (!p && !d) {
      return `<div class="order-loc-row" aria-hidden="true"><span class="order-loc-muted">📍</span></div>`;
    }
    if (p && d && p === d) {
      return `<div class="order-loc-row order-card__locs">
      <a class="order-loc-icon" href="${esc(p)}" target="_blank" rel="noopener" title="الخريطة" aria-label="فتح الخريطة">📍</a>
    </div>`;
    }
    const parts = [];
    if (p) {
      parts.push(
        `<a class="order-loc-icon" href="${esc(p)}" target="_blank" rel="noopener" title="موقع الاستلام" aria-label="فتح موقع الاستلام">📍</a>`
      );
    }
    if (d && d !== p) {
      parts.push(
        `<a class="order-loc-icon" href="${esc(d)}" target="_blank" rel="noopener" title="موقع التسليم" aria-label="فتح موقع التسليم">📍</a>`
      );
    } else if (d && !p) {
      parts.push(
        `<a class="order-loc-icon" href="${esc(d)}" target="_blank" rel="noopener" title="موقع التسليم" aria-label="فتح موقع التسليم">📍</a>`
      );
    }
    return `<div class="order-loc-row order-card__locs">${parts.join("")}</div>`;
  }

  function setMinePanel(open) {
    minePanelOpen = !!open;
    if (mineOrdersPanel) {
      mineOrdersPanel.hidden = !minePanelOpen;
      mineOrdersPanel.setAttribute("aria-hidden", minePanelOpen ? "false" : "true");
    }
    if (kpiMineBox) {
      kpiMineBox.setAttribute("aria-expanded", minePanelOpen ? "true" : "false");
    }
  }

  function renderActiveOrder(o) {
    const phone = customerPhoneRaw(o);
    const wa = waUrlForPhone(phone);
    const orderNoRaw = displayOrderNumber(o);
    const srcLabel = getSourceLabel(o);
    const orderHeader = `
      <div class="order-card__num-row">
        <div class="order-number" style="${getOrderStyle(o)}">${esc(orderNoRaw)}</div>
        ${srcLabel ? `<div class="order-source">${esc(srcLabel)}</div>` : ""}
      </div>`;
    const veh = vehicleLabel(o);
    const vehLine = veh
      ? `<div class="meta">🚗 نوع المركبة (الطلب): ${esc(veh)}</div>`
      : "";
    const earnLine =
      o.driverNetEarning != null && Number(o.driverNetEarning) >= 0
        ? `<div class="meta ok-line">💰 ربحك (تقريبي): ${Number(o.driverNetEarning).toFixed(2)} ر.س</div>`
        : "";
    const commLine =
      o.platformCommission != null && Number(o.platformCommission) >= 0
        ? `<div class="meta">🧾 عمولة المنصة: ${Number(o.platformCommission).toFixed(2)} ر.س</div>`
        : "";

    const callBtn = phone
      ? `<a class="btn" href="tel:${esc(phone)}">📲 اتصال بالعميل</a>`
      : "";
    const waBtn = wa
      ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">💬 واتساب العميل</a>`
      : "";
    const activeNotesClean = stripUrls(o.notes || "");

    activePanel.innerHTML = `
      <div class="active-order-card__hd">
        <h2>طلبك الحالي</h2>
        ${statusTag(o.status)}
      </div>
      <div class="active-order-card__bd">
        <div class="active-order-card__row active-order-card__row--highlight">
          ${orderHeader}
        </div>
        <p class="order-card__customer" style="margin-top:10px">${esc(o.customerName || "عميل")}</p>
        <div class="meta" style="margin-top:8px">📞 ${esc(phone || "—")}</div>
        <div class="meta">📡 اسمح للمتصفح بالموقع: يُبث مسارك للعميل مباشرة (كل ~5 ث) عبر الشبكة وواجهة التتبع.</div>
        ${vehLine}
        ${earnLine}
        ${commLine}
        <div class="order-card__items">${itemsBlock(o)}</div>
        ${locationBlock(o)}
        <div class="meta" style="margin-top:10px"><strong>💰 ${Number(o.total || 0).toFixed(2)} ر.س</strong></div>
        ${activeNotesClean ? `<div class="meta">📝 ${esc(activeNotesClean)}</div>` : ""}
        <div class="active-order-card__actions">
          ${callBtn}
          ${waBtn}
          <button type="button" class="btn primary" data-act-panel="done" data-id="${esc(o._id)}">✅ تم التسليم</button>
        </div>
      </div>
    `;
    activeSection.hidden = false;
  }

  function hideActive() {
    activeSection.hidden = true;
    activePanel.innerHTML = "";
  }

  async function loadDriverProfile() {
    try {
      const data = await api("/me");
      if (data.driver?._id != null) {
        driverRowId = String(data.driver._id);
      }
      if (data.driver?.name && driverNameEl) {
        driverNameEl.textContent = data.driver.name;
      }
    } catch {
      /* optional */
    }
  }

  function orderCard(o, opts = {}) {
    const history = opts.history === true;
    const mine = isMine(o);
    const canTakePool =
      !history &&
      (o.status === "pending" || o.status === "new" || o.status === "preparing") &&
      !o.driverId;

    const btnTake =
      canTakePool && !mine
        ? `<button type="button" class="btn primary btn-take-order" data-act="take" data-id="${esc(o._id)}">استلام الطلب</button>`
        : "";

    const orderNoRaw = displayOrderNumber(o);
    const srcLabel = getSourceLabel(o);
    const orderHeader = `
      <div class="order-card__num-row">
        <div class="order-number" style="${getOrderStyle(o)}">${esc(orderNoRaw)}</div>
        ${srcLabel ? `<div class="order-source">${esc(srcLabel)}</div>` : ""}
      </div>`;

    const typeLabel = orderTypeLabelAr(o);
    const distRow =
      o.deliveryDistanceKm != null && !Number.isNaN(Number(o.deliveryDistanceKm))
        ? `<div class="order-card__summary-row"><span class="order-card__label">المسافة</span><span class="order-card__value">${Number(o.deliveryDistanceKm).toFixed(2)} كم</span></div>`
        : "";

    const veh = vehicleLabel(o);
    const vehLine = veh
      ? `<div class="meta">🚗 نوع المركبة: ${esc(veh)}</div>`
      : "";
    const earnLine =
      o.driverNetEarning != null && Number(o.driverNetEarning) >= 0
        ? `<div class="meta">💰 ربحك: ${Number(o.driverNetEarning).toFixed(2)} ر.س</div>`
        : "";
    const commLine =
      o.platformCommission != null && Number(o.platformCommission) >= 0
        ? `<div class="meta">🧾 عمولة المنصة: ${Number(o.platformCommission).toFixed(2)} ر.س</div>`
        : "";

    const extras = [];
    if (o.branch) extras.push(`🏪 ${esc(o.branch)}`);
    if (o.paymentMethod) extras.push(`💳 ${esc(o.paymentMethod)}`);
    const extraLine = extras.length
      ? `<div class="meta">${extras.join(" · ")}</div>`
      : "";

    const vatLine =
      o.vatAmount != null && Number(o.vatAmount) > 0
        ? `<div class="meta">📊 ضريبة: ${Number(o.vatAmount).toFixed(2)} ر.س</div>`
        : "";

    const notesClean = stripUrls(o.notes || "");
    const notesLine = notesClean ? `<div class="meta">📝 ${esc(notesClean)}</div>` : "";

    const detailsInner = `
        <div class="order-card__items">${itemsBlock(o)}</div>
        <div class="meta order-card__phone">📞 ${formatPhoneDisplay(o.phone || o.customerPhone)}</div>
        ${vehLine}
        ${earnLine}
        ${commLine}
        ${extraLine}
        ${vatLine}
        ${notesLine}
    `;

    const detailsBlock = `<details class="order-card__details">
        <summary class="order-card__details-sum">تفاصيل إضافية</summary>
        <div class="order-card__details-bd">
          ${detailsInner}
        </div>
      </details>`;

    const summaryBlock = `
      <div class="order-card__summary">
        <div class="order-card__summary-row"><span class="order-card__label">اسم العميل</span><span class="order-card__value">${esc(o.customerName || "عميل")}</span></div>
        <div class="order-card__summary-row"><span class="order-card__label">نوع الطلب</span><span class="order-card__value">${esc(typeLabel)}</span></div>
        <div class="order-card__summary-row"><span class="order-card__label">السعر</span><span class="order-card__value">${Number(o.total || 0).toFixed(2)} ر.س</span></div>
        ${distRow}
      </div>
      ${locationBlock(o)}
      ${detailsBlock}
    `;

    const body = `
      <div class="order-card__body">
        <div class="order-card__top">
          ${orderHeader}
          ${statusTag(o.status)}
          ${mine && !history ? `<span class="tag ok">طلبك</span>` : ""}
        </div>
        ${summaryBlock}
      </div>
    `;

    const actions = history
      ? ""
      : `<div class="order-actions order-actions--take">${btnTake}</div>`;

    return `
      <div class="order order-card ${history ? "order-card--history" : ""}" data-order-id="${esc(String(o._id))}">
        ${body}
        ${actions}
      </div>
    `;
  }

  async function take(id) {
    try {
      if (!driverRowId) {
        setMsg(msg, "تعذر تحديد المندوب.", "bad");
        return;
      }
      console.log("[orders] accept-order:", id, "driver:", driverRowId);
      const accData = await api("/accept-order", {
        method: "POST",
        body: { order_id: id, driver_id: driverRowId }
      });
      if (accData && accData.success === false) {
        setMsg(msg, accData.message || "تعذر الاستلام", "bad");
        return;
      }
      setMsg(msg, "تم استلام الطلب.", "ok");
      await syncFromServer({ silentMsg: true });
    } catch (e) {
      if (e.status === 401) return logout();
      setMsg(msg, e.message, "bad");
    }
  }

  async function completeDelivery(id) {
    try {
      console.log("[orders] complete-order:", id);
      const doneData = await api("/complete-order", {
        method: "POST",
        body: { order_id: id }
      });
      if (doneData && doneData.success === false) {
        setMsg(msg, doneData.message || "تعذر إكمال التسليم", "bad");
        return;
      }
      setMsg(msg, "تم تسجيل التسليم.", "ok");
      await syncFromServer({ silentMsg: true });
    } catch (e) {
      if (e.status === 401) return logout();
      throw e;
    }
  }

  list?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act");
    if (act === "take" && id) take(id);
  });

  activePanel?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act-panel]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const act = btn.getAttribute("data-act-panel");
    if (act === "done" && id) {
      completeDelivery(id).catch((e) => setMsg(msg, e.message, "bad"));
    }
  });

  kpiMineBox?.addEventListener("click", () => setMinePanel(!minePanelOpen));
  kpiMineBox?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setMinePanel(!minePanelOpen);
    }
  });

  btnRefresh?.addEventListener("click", () => syncFromServer({ silentMsg: false }));
  btnLogout?.addEventListener("click", logout);

  setMinePanel(false);
  initDriverSocket();
  (async () => {
    await loadDriverProfile();
    await syncFromServer({ silentMsg: false });
  })();

})();
