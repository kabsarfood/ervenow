/**
 * ERVENOW — Transport Portal Preview
 * Portal Framework v1 — existing /api/services APIs only.
 */
(function (global) {
  "use strict";

  var TRANSPORT_TYPES = {
    pickup_truck: 1,
    car_transport: 1,
    vehicle_transfer: 1,
    furniture_move: 1,
    gas_cylinder_swap: 1,
    gas_central_refill: 1,
    gas_delivery: 1,
  };

  var TYPE_FILTER_LABELS = {
    all: "الكل",
    pickup_truck: "سطحة",
    furniture_move: "نقل أثاث",
    gas_delivery: "توصيل غاز",
  };

  var shell = null;
  var W = null;
  var notifOpsApi = null;
  var pollTimer = null;
  var POLL_MS = 8000;

  var state = {
    dashboard: null,
    profile: null,
    bookings: [],
    stats: {},
    serviceLabel: "",
    panelTitle: "",
    ordersTab: "new",
    typeFilter: "all",
    transactions: [],
    fleet: { vehicles: [], activity: [] },
    pricing: null,
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return iso;
    }
  }

  function api(path, opts) {
    if (!global.PlatformAPI || !PlatformAPI.api) throw new Error("PlatformAPI غير متاح");
    return PlatformAPI.api(path, opts);
  }

  function isTransportType(t) {
    return !!TRANSPORT_TYPES[String(t || "").toLowerCase()];
  }

  function isTransportProfile(p) {
    return isTransportType(p && p.service_type);
  }

  function providerId() {
    return state.profile && state.profile.id ? String(state.profile.id) : "";
  }

  function bookingStatus(b) {
    return String((b && b.status) || "")
      .toLowerCase()
      .trim();
  }

  function isToday(iso) {
    if (!iso) return false;
    var d = new Date(iso);
    var t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  function ordersTodayCount() {
    return (state.bookings || []).filter(function (b) {
      return isToday(b.created_at);
    }).length;
  }

  function statusLabel(v, booking) {
    var s = String(v || "").toLowerCase();
    if (s === "new" || s === "pending") return "جديد — متاح للحجز";
    if (s === "accepted") return "محجوز — قيد التنفيذ";
    if (s === "delivering") {
      if (booking && booking.customer_confirmed_at) return "بانتظار تأكيد المزود";
      return "تم التنفيذ — بانتظار تأكيد العضو";
    }
    if (s === "delivered") return "تمت المهمة";
    if (s === "cancelled") return "ملغي";
    return s || "—";
  }

  function payLabel(v) {
    return String(v || "").toLowerCase() === "paid" ? "مدفوع" : "كاش عند الإتمام";
  }

  function bucketBooking(b) {
    var st = bookingStatus(b);
    var mine = String(b.provider_id || "") === providerId();
    if (st === "delivered") return "done";
    if (mine && (st === "accepted" || st === "delivering")) return "active";
    if ((st === "new" || st === "pending") && !b.provider_id) return "new";
    if (mine) return "active";
    return "new";
  }

  function typeLabel(t) {
    var Op = global.ErvenowPortalFramework && ErvenowPortalFramework.Operational;
    var labels = (Op && Op.TRANSPORT_TYPE_LABELS) || {};
    return labels[t] || t || "—";
  }

  function matchesTypeFilter(b) {
    if (state.typeFilter === "all") return true;
    var st = String((b && b.service_type) || "").toLowerCase();
    if (state.typeFilter === "gas_delivery") {
      return st === "gas_delivery" || st === "gas_cylinder_swap" || st === "gas_central_refill";
    }
    if (state.typeFilter === "pickup_truck") {
      return st === "pickup_truck" || st === "car_transport" || st === "vehicle_transfer";
    }
    return st === state.typeFilter;
  }

  function filterBookings(tab) {
    return (state.bookings || []).filter(function (b) {
      return bucketBooking(b) === tab && matchesTypeFilter(b);
    });
  }

  function transportRouteHtml(b, d) {
    var fromLink = d.pickup_maps_url || d.from_maps_url || d.from || "";
    var toLink = d.drop_maps_url || d.to_maps_url || "";
    var maps =
      b.location && String(b.location).indexOf(",") !== -1
        ? "https://www.google.com/maps?q=" + encodeURIComponent(b.location)
        : toLink || null;
    if (fromLink || maps) {
      return (
        "<p>من: " +
        (fromLink
          ? '<a href="' + esc(fromLink) + '" target="_blank" rel="noopener">فتح الاستلام</a>'
          : esc(d.pickup_address || "—")) +
        "</p><p>إلى: " +
        (maps
          ? '<a href="' + esc(maps) + '" target="_blank" rel="noopener">فتح التسليم</a>'
          : esc(d.drop_address || b.location || "—")) +
        "</p>"
      );
    }
    return "<p>الموقع: " + esc(b.location || "—") + "</p>";
  }

  function renderBookingCard(b) {
    var st = bookingStatus(b);
    var mine = String(b.provider_id || "") === providerId();
    var canReserve = (st === "new" || st === "pending") && !b.provider_id;
    var canProviderExecute = mine && st === "accepted";
    var d = b.data && typeof b.data === "object" ? b.data : {};
    return (
      '<article class="tp-booking' +
      (mine ? " is-mine" : "") +
      '" data-booking-id="' +
      esc(b.id) +
      '">' +
      "<p><strong>نوع المهمة:</strong> " +
      esc(typeLabel(b.service_type)) +
      "</p>" +
      "<p><strong>" +
      esc(b.service_name || state.serviceLabel || "نقل") +
      "</strong> — " +
      esc(statusLabel(b.status, b)) +
      "</p>" +
      (d.distance_km || d.distance
        ? "<p><strong>المسافة:</strong> " + esc(String(d.distance_km || d.distance)) + " كم</p>"
        : "") +
      "<p>رقم: " +
      esc(b.service_order_number || b.order_number || "—") +
      "</p>" +
      "<p>" +
      (String(b.service_type || "").toLowerCase() === "pickup_truck" ? "المدينة" : "الحي") +
      ": " +
      esc(b.district || "—") +
      "</p>" +
      "<p>جوال العضو: " +
      esc(b.customer_phone || "—") +
      "</p>" +
      transportRouteHtml(b, d) +
      "<p>الدفع: " +
      esc(payLabel(b.payment_status)) +
      " — " +
      esc(fmtMoney(b.total_amount || 0)) +
      " ريال</p>" +
      "<p>عمولة المنصة: " +
      esc(fmtMoney(b.platform_commission || 0)) +
      " ريال</p>" +
      (b.rating ? "<p>تقييم: " + esc(b.rating) + "/5</p>" : "") +
      '<div class="tp-booking__actions">' +
      (canReserve
        ? '<button type="button" class="pf-btn pf-btn--primary tp-reserve" data-id="' + esc(b.id) + '">حجز الطلب</button>'
        : "") +
      (canProviderExecute
        ? '<button type="button" class="pf-btn tp-complete" data-id="' + esc(b.id) + '">تم التنفيذ</button>'
        : st === "delivering" && mine
          ? '<span style="font-size:0.82rem;color:var(--pf-muted)">بانتظار تأكيد العضو</span>'
          : "") +
      "</div></article>"
    );
  }

  function locationReady() {
    var Loc = global.ErvenowPortalProviderLocation;
    if (Loc && Loc.isReady && Loc.isReady(state.profile)) return true;
    return !!(state.stats && state.stats.location_ready);
  }

  function locationBannerHtml() {
    if (locationReady()) return "";
    return global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.renderBanner
      ? ErvenowPortalProviderLocation.renderBanner()
      : "";
  }

  async function activateOrderLocation() {
    var Loc = global.ErvenowPortalProviderLocation;
    if (!Loc) return;
    try {
      if (typeof Loc.ensureForOrders === "function") {
        await Loc.ensureForOrders("transport", state.profile);
      } else if (typeof Loc.captureAndSave === "function") {
        await Loc.captureAndSave("transport");
      }
      if (typeof Loc.startPresenceLoop === "function") {
        Loc.startPresenceLoop("transport", 15000);
      }
    } catch (e) {
      if (shell) {
        shell.showMessage((e && e.message) || "فعّل الموقع من القائمة لاستقبال الطلبات", false);
      }
    }
  }

  function renderDashboard() {
    var s = state.stats || {};
    var ratingVal =
      Number(s.rating_count) > 0 ? Number(s.rating_avg || 0).toFixed(1) + " ★" : "—";
    var chips = Object.keys(TYPE_FILTER_LABELS)
      .map(function (key) {
        return (
          '<button type="button" class="pf-type-chip' +
          (state.typeFilter === key ? " is-active" : "") +
          '" data-tp-type="' +
          key +
          '">' +
          esc(TYPE_FILTER_LABELS[key]) +
          "</button>"
        );
      })
      .join("");
    var newList = filterBookings("new").slice(0, 5);
    return (
      locationBannerHtml() +
      W.sectionHeader(state.panelTitle || "الرئيسية", "بيئة عمل مزوّد النقل") +
      W.kpiGrid([
        { label: "طلبات جديدة", value: String(s.new_orders || filterBookings("new").length) },
        { label: "جارية", value: String(s.active_jobs || filterBookings("active").length) },
        { label: "مكتملة", value: String(s.completed_jobs || filterBookings("done").length) },
        { label: "أرباح اليوم", value: fmtMoney(s.wallet_earned_sar || 0), suffix: "ر.س" },
        { label: "الرصيد", value: fmtMoney(s.wallet_balance_sar || 0), suffix: "ر.س" },
        { label: "التقييم", value: ratingVal },
      ]) +
      '<div class="pf-type-chips" role="tablist" aria-label="أنواع الطلبات">' +
      chips +
      "</div>" +
      '<div class="pf-home-block"><div class="pf-home-block__head"><h3>طلبات متاحة للحجز</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="transport-orders">عرض الكل</button></div>' +
      (newList.length
        ? newList.map(renderBookingCard).join("")
        : '<p class="pf-empty">لا طلبات نقل في هذا التصنيف حالياً.</p>') +
      "</div>"
    );
  }

  function renderTransportOrders() {
    var tab = state.ordersTab;
    var list = filterBookings(tab);
    var counts = {
      new: filterBookings("new").length,
      active: filterBookings("active").length,
      done: filterBookings("done").length,
    };
    var listHtml = list.length
      ? list.map(renderBookingCard).join("")
      : '<p class="pf-empty">لا توجد طلبات في هذا القسم.</p>';
    return (
      locationBannerHtml() +
      W.sectionHeader("طلبات النقل", "Transport Orders — جديدة · جارية · مكتملة") +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="pf-btn" id="tpRefreshOrders">تحديث</button></div>' +
      '<div class="pf-tabs">' +
      '<button type="button" class="pf-tab' +
      (tab === "new" ? " is-active" : "") +
      '" data-orders-tab="new">جديدة (' +
      counts.new +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "active" ? " is-active" : "") +
      '" data-orders-tab="active">جارية (' +
      counts.active +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "done" ? " is-active" : "") +
      '" data-orders-tab="done">مكتملة (' +
      counts.done +
      ")</button></div>" +
      listHtml
    );
  }

  function renderFleet() {
    var fleet = state.fleet || {};
    var vehicles = fleet.vehicles || [];
    var activity = fleet.activity || [];
    var vLabels = {
      flatbed: "سطحة",
      flatbed_hydraulic: "سطحة هيدروليك",
      tow: "ونش",
      car_carrier: "ناقلة سيارات",
      other: "أخرى",
      available: "متاحة",
      busy: "مشغولة",
    };
    var vehHtml = vehicles.length
      ? vehicles
          .map(function (v) {
            return (
              '<div class="pf-card"><h3 class="pf-card__title">' +
              esc(vLabels[v.type] || v.type || "مركبة") +
              "</h3>" +
              "<p>اللوحة: " +
              esc(v.plate || "—") +
              "</p>" +
              "<p>الحالة: " +
              esc(v.status === "busy" ? "مشغولة" : "متاحة") +
              "</p>" +
              "<p>السائق: " +
              esc(v.driver_name || "—") +
              "</p></div>"
            );
          })
          .join("")
      : '<p class="pf-empty">لا توجد بيانات مركبة مسجّلة — حدّث ملفك من الإعدادات.</p>';
    var actHtml = activity.length
      ? activity
          .slice(0, 8)
          .map(function (b) {
            return (
              "<p>• " +
              esc(b.service_order_number || b.order_number || b.id) +
              " — " +
              esc(b.service_type || "نقل") +
              "</p>"
            );
          })
          .join("")
      : "<p class='pf-empty'>لا نشاط جاري حالياً.</p>";
    return (
      W.sectionHeader("الأسطول", "Fleet — المركبات والنشاط") +
      '<button type="button" class="pf-btn" id="tpRefreshFleet" style="margin-bottom:12px">تحديث</button>' +
      vehHtml +
      '<div class="pf-card" style="margin-top:12px"><h3 class="pf-card__title">النشاط الجاري</h3>' +
      actHtml +
      "</div>"
    );
  }

  function renderPricing() {
    var p = state.pricing || {};
    var gas = p.gas || {};
    var samples = p.samples || [];
    var rows = samples
      .map(function (s) {
        return (
          "<tr><td>" +
          esc(s.label) +
          "</td><td>" +
          fmtMoney(s.fee) +
          " ر.س</td></tr>"
        );
      })
      .join("");
    return (
      W.sectionHeader("التسعير", "Pricing — أسعار النقل والغاز") +
      '<button type="button" class="pf-btn" id="tpRefreshPricing" style="margin-bottom:12px">تحديث</button>' +
      W.kpiGrid([
        { label: "أسطوانة غاز", value: fmtMoney(gas.cylinder_one || 0), suffix: "ر.س" },
        { label: "أسطوانتان", value: fmtMoney(gas.cylinder_two || 0), suffix: "ر.س" },
        { label: "غاز مركزي / لتر", value: fmtMoney(gas.central_per_liter || 0), suffix: "ر.س" },
      ]) +
      '<div class="pf-card"><h3 class="pf-card__title">عينات التسعير (مسافات)</h3>' +
      (rows
        ? '<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>الخدمة</th><th>السعر</th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<p class="pf-empty">لا بيانات تسعير.</p>') +
      (p.note ? '<p style="font-size:0.85rem;color:var(--pf-muted);margin-top:8px">' + esc(p.note) + "</p>" : "") +
      "</div>"
    );
  }

  function renderNotifications() {
    return W.sectionHeader("الإشعارات", "Notifications") + '<div id="tpNotifHost"></div>';
  }

  function renderWallet() {
    var s = state.stats || {};
    var rows = (state.transactions || [])
      .slice(0, 20)
      .map(function (t) {
        var amt = Number(t.amount) || 0;
        var sign = amt >= 0 ? "+" : "";
        return (
          "<tr><td>" +
          esc(fmtDate(t.created_at)) +
          "</td><td>" +
          esc(t.type_label || t.type || t.description || "—") +
          "</td><td>" +
          esc(sign + fmtMoney(amt)) +
          " ر.س</td></tr>"
        );
      })
      .join("");
    return (
      W.sectionHeader("المحفظة", "Wallet — الرصيد والعمليات") +
      W.kpiGrid([
        { label: "الرصيد المتاح", value: fmtMoney(s.wallet_balance_sar || 0), suffix: "ر.س" },
        { label: "إجمالي الأرباح", value: fmtMoney(s.wallet_earned_sar || 0), suffix: "ر.س" },
        {
          label: "عمولة معلّقة",
          value: fmtMoney(s.commission_pending_sar || s.wallet_commission_sar || 0),
          suffix: "ر.س",
        },
      ]) +
      (global.ErvenowPortalWalletWithdraw && ErvenowPortalWalletWithdraw.renderWithdrawPanel
        ? ErvenowPortalWalletWithdraw.renderWithdrawPanel({ prefix: "tp", minAmount: 20 })
        : "") +
      '<div class="pf-card">' +
      '<h3 class="pf-card__title">آخر العمليات</h3>' +
      (rows
        ? '<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<p class="pf-empty">لا توجد عمليات بعد.</p>') +
      "</div>"
    );
  }

  function vehicleLine(p) {
    var vLabels = {
      flatbed: "سطحة",
      flatbed_hydraulic: "سطحة هيدروليك",
      tow: "ونش",
      car_carrier: "ناقلة سيارات",
      other: "أخرى",
    };
    var vType = p.service_vehicle_type || "";
    if (!vType && !p.service_plate_number && !p.service_vehicle_model) return "";
    var modelYear = p.service_vehicle_model || "";
    return (
      "<p><strong>المركبة:</strong> " +
      esc(vLabels[vType] || vType || "—") +
      " · لوحة " +
      esc(p.service_plate_number || "—") +
      (modelYear ? " · سنة " + esc(modelYear) : "") +
      "</p>"
    );
  }

  function renderSettings() {
    var p = state.profile || {};
    var areaLabel = String(p.service_type || "").toLowerCase() === "pickup_truck" ? "المدينة" : "الحي";
    var payPanel =
      global.ErvenowPortalProviderPayment && ErvenowPortalProviderPayment.renderPanel
        ? ErvenowPortalProviderPayment.renderPanel("tp")
        : "";
    return (
      W.sectionHeader("الإعدادات", "Settings — بيانات مزود النقل") +
      '<div class="pf-card">' +
      "<p><strong>الاسم:</strong> " +
      esc(p.name || "—") +
      "</p>" +
      "<p><strong>الجوال:</strong> " +
      esc(p.phone || "—") +
      "</p>" +
      "<p><strong>نوع النشاط:</strong> " +
      esc(state.serviceLabel || p.service_type || "—") +
      "</p>" +
      "<p><strong>" +
      esc(areaLabel) +
      " المسجّل:</strong> " +
      esc(p.service_district || "—") +
      "</p>" +
      vehicleLine(p) +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
      '<a class="pf-btn" href="/login?role=service">إدارة الحساب</a></div></div>' +
      payPanel
    );
  }

  function renderSection(id) {
    if (id === "dashboard") return renderDashboard();
    if (id === "transport-orders") return renderTransportOrders();
    if (id === "wallet") return renderWallet();
    if (id === "fleet") return renderFleet();
    if (id === "pricing") return renderPricing();
    if (id === "notifications") return renderNotifications();
    if (id === "settings") return renderSettings();
    return '<p class="pf-empty">قسم غير معروف.</p>';
  }

  function paintHeader() {
    var p = state.profile || {};
    shell.updateHeader({
      subtitle: p.name || "مزود النقل",
      sidebarName: p.name || "مزود النقل",
    });
    if (global.ErvenowPortalProviderLocation) {
      ErvenowPortalProviderLocation.syncButtonLabel(p);
    }
  }

  async function reserveBooking(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الحجز...";
    }
    try {
      var Loc = global.ErvenowPortalProviderLocation;
      if (Loc) {
        if (typeof Loc.ensureForOrders === "function") {
          await Loc.ensureForOrders("transport", state.profile);
        } else if (typeof Loc.captureAndSave === "function") {
          await Loc.captureAndSave("transport");
        }
      }
      var coords = Loc && Loc.getLastCoords ? Loc.getLastCoords() : null;
      var body = coords ? { lat: coords.lat, lng: coords.lng } : {};
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/reserve", {
        method: "POST",
        body: body,
      });
      shell.showMessage(j.message || "تم حجز الطلب", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الحجز", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "حجز الطلب";
      }
    }
  }

  async function completeBooking(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الإتمام...";
    }
    try {
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/complete", {
        method: "POST",
        body: { step: "provider" },
      });
      shell.showMessage(j.message || "تم التحديث", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الإتمام", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "تم التنفيذ";
      }
    }
  }

  function wireSectionEvents() {
    var main = shell.getMainEl();
    if (!main) return;
    main.querySelectorAll("[data-tp-type]").forEach(function (btn) {
      btn.onclick = function () {
        state.typeFilter = btn.getAttribute("data-tp-type") || "all";
        renderMain(shell.getActiveSection());
      };
    });
    main.querySelectorAll("[data-orders-tab]").forEach(function (btn) {
      btn.onclick = function () {
        state.ordersTab = btn.getAttribute("data-orders-tab") || "new";
        renderMain(shell.getActiveSection());
      };
    });
    var ref = main.querySelector("#tpRefreshOrders");
    if (ref) {
      ref.onclick = function () {
        loadData()
          .then(function () {
            renderMain(shell.getActiveSection());
            shell.showMessage("تم التحديث", true);
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر التحديث", false);
          });
      };
    }
    main.querySelectorAll(".tp-reserve").forEach(function (btn) {
      btn.onclick = function () {
        reserveBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".tp-complete").forEach(function (btn) {
      btn.onclick = function () {
        completeBooking(btn.getAttribute("data-id"), btn);
      };
    });
    var refFleet = main.querySelector("#tpRefreshFleet");
    if (refFleet) {
      refFleet.onclick = function () {
        loadFleet()
          .then(function () {
            renderMain("fleet");
            shell.showMessage("تم التحديث", true);
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر التحديث", false);
          });
      };
    }
    var refPrice = main.querySelector("#tpRefreshPricing");
    if (refPrice) {
      refPrice.onclick = function () {
        loadPricing()
          .then(function () {
            renderMain("pricing");
            shell.showMessage("تم التحديث", true);
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر التحديث", false);
          });
      };
    }
  }

  async function loadFleet() {
    try {
      var j = await api("/api/services/me/fleet");
      state.fleet = { vehicles: j.vehicles || [], activity: j.activity || [] };
    } catch (_) {
      state.fleet = { vehicles: [], activity: [] };
    }
  }

  async function loadPricing() {
    try {
      state.pricing = await api("/api/services/me/pricing");
    } catch (_) {
      state.pricing = null;
    }
  }

  function renderMain(section) {
    shell.setContent(renderSection(section));
    paintHeader();
    wireSectionEvents();
    if (section === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("tpNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "transport-notif");
    }
    if (section === "fleet") {
      loadFleet().then(function () {
        shell.setContent(renderSection("fleet"));
        wireSectionEvents();
      });
    }
    if (section === "pricing") {
      loadPricing().then(function () {
        shell.setContent(renderSection("pricing"));
        wireSectionEvents();
      });
    }
    if (section === "wallet" && global.ErvenowPortalWalletWithdraw) {
      ErvenowPortalWalletWithdraw.wireWithdrawPanel({
        prefix: "tp",
        minAmount: 20,
        onMessage: function (text, ok) {
          if (text && shell) shell.showMessage(text, ok);
        },
        onSuccess: function () {
          loadData().then(function () {
            renderMain("wallet");
          });
        },
      });
    }
    if (section === "settings" && global.ErvenowPortalProviderPayment) {
      ErvenowPortalProviderPayment.loadAndWire({
        prefix: "tp",
        onMessage: function (text, ok) {
          if (text && shell) shell.showMessage(text, ok);
        },
      });
    }
  }

  async function loadData() {
    var j = await api("/api/services/me/dashboard");
    state.dashboard = j;
    state.profile = j.profile || {};
    state.bookings = Array.isArray(j.bookings) ? j.bookings : [];
    state.stats = j.stats || {};
    state.serviceLabel = j.service_label || "";
    state.panelTitle = j.panel_title || "لوحة النقل";
    try {
      var txRes = await api("/api/wallet/transactions");
      state.transactions = Array.isArray(txRes.transactions) ? txRes.transactions : [];
    } catch (_) {
      state.transactions = [];
    }
    if (global.ErvenowPortalProviderJobGps && ErvenowPortalProviderJobGps.syncJobGps) {
      ErvenowPortalProviderJobGps.syncJobGps(state.bookings);
    }
  }

  function sectionsWithLiveBookings(section) {
    return section === "dashboard" || section === "transport-orders";
  }

  async function pollTick() {
    if (!shell) return;
    var section = shell.getActiveSection();
    await loadData();
    paintHeader();
    if (sectionsWithLiveBookings(section)) renderMain(section);
    if (notifOpsApi && notifOpsApi.refresh) await notifOpsApi.refresh();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      pollTick().catch(function () {});
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function stopAll() {
    stopPolling();
    if (global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.stopPresenceLoop) {
      ErvenowPortalProviderLocation.stopPresenceLoop();
    }
  }

  function canAccessTransport(me) {
    if (!me || !me.profile) return false;
    var role = String(me.profile.role || "").toLowerCase();
    if (role === "admin") return true;
    if (!isTransportProfile(me.profile)) return false;
    return role === "service" || role === "driver";
  }

  async function init() {
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      console.error("Portal Framework غير محمّل");
      return;
    }

    var portalCfg = ErvenowPortalFramework.RoleContext.getConfig("transport");
    if (ErvenowPortalFramework.PortalPlatformModules) {
      portalCfg = await ErvenowPortalFramework.PortalPlatformModules.filterConfig(portalCfg);
    }

    shell = ErvenowPortalFramework.PortalShell.create({
      role: "transport",
      config: portalCfg,
      app: "#tpApp",
      loginEl: "#tpLogin",
      hashBase: "/transport-preview",
      notifKey: "transport-preview-header",
      operationalV2: true,
      portalTitle: "بوابة النقل",
      onReserveBooking: function (bookingId) {
        return reserveBooking(bookingId, null);
      },
      onNotificationDetails: function (bookingId) {
        state.ordersTab = "active";
        renderMain("transport-orders");
      },
      onNavigate: function (section) {
        renderMain(section);
      },
    });
    W = shell.getWidgets();
    shell.mountChrome();

    global.addEventListener("ervenow:provider-location-updated", function (ev) {
      var d = (ev && ev.detail) || {};
      if (d.lat != null && d.lng != null) {
        state.profile = Object.assign({}, state.profile || {}, { lat: d.lat, lng: d.lng });
        if (state.stats) state.stats.location_ready = true;
        paintHeader();
      }
      if (d.silent) {
        loadData()
          .then(function () {
            if (shell && sectionsWithLiveBookings(shell.getActiveSection())) {
              renderMain(shell.getActiveSection());
            }
          })
          .catch(function () {});
        return;
      }
      loadData()
        .then(function () {
          paintHeader();
          renderMain(shell.getActiveSection());
        })
        .catch(function () {});
    });

    global.addEventListener("ervenow:auth-changed", function () {
      global.location.reload();
    });

    if (!global.PlatformAPI || !PlatformAPI.getToken()) {
      shell.showLogin();
      return;
    }

    try {
      var me = null;
      if (global.ErvenowAuthGuard) {
        me = await ErvenowAuthGuard.ensureApprovedAccount({ loginUrl: "/login?role=service" });
      } else {
        me = await api("/api/core/me");
      }
      if (!canAccessTransport(me)) {
        shell.showLogin();
        var loginEl = document.getElementById("tpLogin");
        if (loginEl && loginEl.querySelector("p")) {
          loginEl.querySelector("p").textContent =
            "هذا الحساب ليس مزوّد نقل — استخدم حساب نقل مركبات/ونيت للمعاينة.";
        }
        return;
      }
      await loadData();
      await activateOrderLocation();
      if (global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.isReady(state.profile)) {
        await loadData();
      }
      shell.showApp();
      renderMain(shell.getActiveSection());
      notifOpsApi = await shell.mountNotifications();
      startPolling();
    } catch (e) {
      shell.showLogin();
      shell.showMessage((e && e.message) || "تعذّر تحميل البوابة", false);
    }
  }

  global.ErvenowTransportPreview = { init: init, refresh: loadData, stop: stopAll };
})(typeof window !== "undefined" ? window : global);
