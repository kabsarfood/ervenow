/**
 * ERVENOW — Service Portal Preview
 * Portal Framework v1 — existing /api/services APIs only.
 */
(function (global) {
  "use strict";

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
    requestsTab: "new",
    transactions: [],
    schedule: { today: [], week: [], all: [] },
    scheduleTab: "today",
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

  function filterBookings(tab) {
    return (state.bookings || []).filter(function (b) {
      return bucketBooking(b) === tab;
    });
  }

  function renderBookingCard(b) {
    var st = bookingStatus(b);
    var mine = String(b.provider_id || "") === providerId();
    var canReserve = (st === "new" || st === "pending") && !b.provider_id;
    var canProviderExecute = mine && st === "accepted";
    var d = b.data && typeof b.data === "object" ? b.data : {};
    var maps =
      b.location && String(b.location).indexOf(",") !== -1
        ? "https://www.google.com/maps?q=" + encodeURIComponent(b.location)
        : d.drop_maps_url
          ? String(d.drop_maps_url)
          : null;
    var fromLink = d.pickup_maps_url || d.from || "";
    var extraInternal =
      String(b.service_type || "").toLowerCase() === "internal_delivery"
        ? "<p>الشحنة: " +
          esc(d.shipment_name || "—") +
          "</p><p>من: " +
          (fromLink
            ? '<a href="' + esc(fromLink) + '" target="_blank" rel="noopener">فتح الاستلام</a>'
            : "—") +
          "</p><p>إلى: " +
          (maps ? '<a href="' + esc(maps) + '" target="_blank" rel="noopener">فتح التسليم</a>' : "—") +
          "</p><p>المرسل إليه: " +
          esc(d.recipient_phone || "—") +
          "</p>"
        : "";
    return (
      '<article class="sp-booking' +
      (mine ? " is-mine" : "") +
      '" data-booking-id="' +
      esc(b.id) +
      '">' +
      "<p><strong>" +
      esc(b.service_name || "خدمة") +
      "</strong> — " +
      esc(statusLabel(b.status, b)) +
      "</p>" +
      "<p>رقم: " +
      esc(b.service_order_number || b.order_number || "—") +
      "</p>" +
      "<p>الحي: " +
      esc(b.district || "—") +
      "</p>" +
      "<p>جوال العضو: " +
      esc(b.customer_phone || "—") +
      "</p>" +
      extraInternal +
      (maps && !extraInternal
        ? '<p><a href="' + esc(maps) + '" target="_blank" rel="noopener">فتح الموقع على الخرائط</a></p>'
        : !extraInternal
          ? "<p>الموقع: " + esc(b.location || "—") + "</p>"
          : "") +
      "<p>الدفع: " +
      esc(payLabel(b.payment_status)) +
      " — " +
      esc(fmtMoney(b.total_amount || 0)) +
      " ريال</p>" +
      "<p>عمولة المنصة: " +
      esc(fmtMoney(b.platform_commission || 0)) +
      " ريال</p>" +
      (b.rating ? "<p>تقييم: " + esc(b.rating) + "/5</p>" : "") +
      '<div class="sp-booking__actions">' +
      (canReserve
        ? '<button type="button" class="pf-btn pf-btn--primary sp-reserve" data-id="' + esc(b.id) + '">حجز الطلب</button>'
        : "") +
      (canProviderExecute
        ? '<button type="button" class="pf-btn sp-complete" data-id="' +
          esc(b.id) +
          '">تم التنفيذ</button>'
        : st === "delivering" && mine
          ? '<span style="font-size:0.82rem;color:var(--pf-muted)">بانتظار تأكيد العضو</span>'
          : "") +
      "</div></article>"
    );
  }

  function renderDashboard() {
    var s = state.stats || {};
    var ratingVal =
      Number(s.rating_count) > 0 ? Number(s.rating_avg || 0).toFixed(1) + " ★" : "—";
    var newList = filterBookings("new").slice(0, 4);
    var activeList = filterBookings("active").slice(0, 4);
    var doneList = filterBookings("done").slice(0, 4);
    return (
      W.sectionHeader(state.panelTitle || "الرئيسية", "بيئة عمل مزوّد الخدمة") +
      W.kpiGrid([
        { label: "طلبات جديدة", value: String(s.new_orders || filterBookings("new").length) },
        { label: "طلبات جارية", value: String(s.active_jobs || filterBookings("active").length) },
        { label: "مكتملة", value: String(s.completed_jobs || filterBookings("done").length) },
        { label: "التقييم", value: ratingVal },
        { label: "الرصيد", value: fmtMoney(s.wallet_balance_sar || 0), suffix: "ر.س" },
        { label: "أرباح اليوم", value: fmtMoney(s.wallet_earned_today_sar != null ? s.wallet_earned_today_sar : s.wallet_earned_sar || 0), suffix: "ر.س" },
      ]) +
      '<div class="pf-home-block"><div class="pf-home-block__head"><h3>الطلبات الجديدة</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="requests">عرض الكل</button></div>' +
      (newList.length
        ? newList.map(renderBookingCard).join("")
        : '<p class="pf-empty">لا طلبات جديدة — ستظهر هنا فور وصولها.</p>') +
      "</div>" +
      '<div class="pf-home-block"><div class="pf-home-block__head"><h3>الطلبات الجارية</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="requests">إدارة التنفيذ</button></div>' +
      (activeList.length
        ? activeList.map(renderBookingCard).join("")
        : '<p class="pf-empty">لا مهام جارية حالياً.</p>') +
      "</div>" +
      '<div class="pf-home-block"><div class="pf-home-block__head"><h3>الطلبات المكتملة</h3>' +
      '<button type="button" class="pf-btn" data-pf-section="requests">السجل</button></div>' +
      (doneList.length
        ? doneList.map(renderBookingCard).join("")
        : '<p class="pf-empty">لا مهام مكتملة بعد.</p>') +
      "</div>"
    );
  }

  function renderRequests() {
    var tab = state.requestsTab;
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
      W.sectionHeader("الطلبات", "Requests — جديدة · جارية · مكتملة") +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="pf-btn" id="spRefreshRequests">تحديث</button>' +
      '<a class="pf-btn" href="/services-provider.html">البوابة الكلاسيكية</a></div>' +
      '<div class="pf-tabs">' +
      '<button type="button" class="pf-tab' +
      (tab === "new" ? " is-active" : "") +
      '" data-requests-tab="new">جديدة (' +
      counts.new +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "active" ? " is-active" : "") +
      '" data-requests-tab="active">جارية (' +
      counts.active +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "done" ? " is-active" : "") +
      '" data-requests-tab="done">مكتملة (' +
      counts.done +
      ")</button></div>" +
      listHtml
    );
  }

  function renderScheduleCard(b) {
    var st = bookingStatus(b);
    var mine = String(b.provider_id || "") === providerId();
    var canAccept = (st === "new" || st === "pending") && !b.provider_id;
    var canCancel = mine && (st === "accepted" || st === "pending" || st === "new");
    return (
      '<article class="sp-booking sp-schedule-card" data-booking-id="' +
      esc(b.id) +
      '">' +
      "<p><strong>" +
      esc(b.service_name || "موعد") +
      "</strong></p>" +
      "<p>الموعد: " +
      esc(fmtDate(b.scheduled_at)) +
      "</p>" +
      "<p>الحالة: " +
      esc(statusLabel(b.status, b)) +
      "</p>" +
      "<p>رقم: " +
      esc(b.service_order_number || b.order_number || "—") +
      "</p>" +
      '<div class="sp-booking__actions">' +
      (canAccept
        ? '<button type="button" class="pf-btn pf-btn--primary sp-schedule-accept" data-id="' +
          esc(b.id) +
          '">قبول الموعد</button>'
        : "") +
      (mine
        ? '<button type="button" class="pf-btn sp-schedule-reschedule" data-id="' +
          esc(b.id) +
          '">إعادة الجدولة</button>'
        : "") +
      (canCancel
        ? '<button type="button" class="pf-btn sp-schedule-cancel" data-id="' +
          esc(b.id) +
          '">إلغاء</button>'
        : "") +
      "</div></article>"
    );
  }

  function renderSchedule() {
    var tab = state.scheduleTab || "today";
    var data = state.schedule || {};
    var list = tab === "week" ? data.week || [] : data.today || [];
    return (
      W.sectionHeader("الجدولة", "Schedule — مواعيد اليوم والأسبوع") +
      '<div class="pf-tabs">' +
      '<button type="button" class="pf-tab' +
      (tab === "today" ? " is-active" : "") +
      '" data-schedule-tab="today">اليوم (' +
      (data.today || []).length +
      ')</button>' +
      '<button type="button" class="pf-tab' +
      (tab === "week" ? " is-active" : "") +
      '" data-schedule-tab="week">الأسبوع (' +
      (data.week || []).length +
      ")</button></div>" +
      '<button type="button" class="pf-btn" id="spRefreshSchedule" style="margin-bottom:12px">تحديث</button>' +
      (list.length
        ? list.map(renderScheduleCard).join("")
        : '<p class="pf-empty">لا مواعيد في هذه الفترة.</p>')
    );
  }

  function renderNotifications() {
    return (
      W.sectionHeader("الإشعارات", "Notifications") +
      '<div id="spNotifHost" class="sp-notif-host"></div>'
    );
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
      '<div class="pf-card">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<a class="pf-btn pf-btn--primary" href="/wallet.html">فتح المحفظة</a>' +
      '<a class="pf-btn" href="/services-provider.html">إعدادات الدفع الكلاسيكية</a></div>' +
      '<h3 class="pf-card__title">آخر العمليات</h3>' +
      (rows
        ? '<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<p class="pf-empty">لا توجد عمليات بعد.</p>') +
      "</div>"
    );
  }

  function renderRating() {
    var s = state.stats || {};
    var avg = Number(s.rating_avg) || 0;
    var count = Number(s.rating_count) || 0;
    return (
      W.sectionHeader("التقييم", "Rating — متوسط التقييم وعدد التقييمات") +
      W.kpiGrid([
        { label: "متوسط التقييم", value: count > 0 ? avg.toFixed(1) + " ★" : "—" },
        { label: "عدد التقييمات", value: String(count) },
      ]) +
      '<div class="pf-card"><p style="margin:0;font-weight:600;color:var(--pf-muted)">' +
      (count > 0
        ? "يُحسب التقييم من تقييمات العملاء بعد إتمام المهام."
        : "لا توجد تقييمات بعد — ستظهر هنا بعد أول مهمة مُقيّمة.") +
      "</p></div>"
    );
  }

  function renderSettings() {
    var p = state.profile || {};
    var areaLabel = String(p.service_type || "").toLowerCase() === "pickup_truck" ? "المدينة" : "الحي";
    return (
      W.sectionHeader("الإعدادات", "Settings — بيانات مزوّد الخدمة") +
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
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
      '<a class="pf-btn" href="/login?role=service">إدارة الحساب</a>' +
      '<a class="pf-btn pf-btn--primary" href="/services-provider.html">البوابة الكلاسيكية</a></div></div>'
    );
  }

  function renderSection(id) {
    if (id === "dashboard") return renderDashboard();
    if (id === "requests") return renderRequests();
    if (id === "schedule") return renderSchedule();
    if (id === "notifications") return renderNotifications();
    if (id === "wallet") return renderWallet();
    if (id === "rating") return renderRating();
    if (id === "settings") return renderSettings();
    return '<p class="pf-empty">قسم غير معروف.</p>';
  }

  function paintHeader() {
    var p = state.profile || {};
    shell.updateHeader({
      subtitle: p.name || "مزوّد الخدمة",
      sidebarName: p.name || "مزوّد الخدمة",
    });
  }

  async function reserveBooking(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الحجز...";
    }
    try {
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/reserve", { method: "POST" });
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

  async function loadSchedule() {
    try {
      var j = await api("/api/services/me/schedule");
      state.schedule = {
        today: j.today || [],
        week: j.week || [],
        all: j.all || [],
      };
    } catch (_) {
      state.schedule = { today: [], week: [], all: [] };
    }
  }

  async function cancelBooking(id) {
    await api("/api/services/bookings/" + encodeURIComponent(id) + "/status", {
      method: "PATCH",
      body: { status: "cancelled" },
    });
  }

  async function rescheduleBooking(id) {
    var raw = global.prompt("أدخل الموعد الجديد (YYYY-MM-DDTHH:MM)", "");
    if (!raw) return;
    await api("/api/order/" + encodeURIComponent(id) + "/details", {
      method: "PATCH",
      body: { scheduled_at: new Date(raw).toISOString() },
    });
  }

  function wireSectionEvents() {
    var main = shell.getMainEl();
    if (!main) return;
    main.querySelectorAll("[data-requests-tab]").forEach(function (btn) {
      btn.onclick = function () {
        state.requestsTab = btn.getAttribute("data-requests-tab") || "new";
        renderMain(shell.getActiveSection());
      };
    });
    var ref = main.querySelector("#spRefreshRequests");
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
    main.querySelectorAll(".sp-reserve").forEach(function (btn) {
      btn.onclick = function () {
        reserveBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-complete").forEach(function (btn) {
      btn.onclick = function () {
        completeBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll("[data-schedule-tab]").forEach(function (btn) {
      btn.onclick = function () {
        state.scheduleTab = btn.getAttribute("data-schedule-tab") || "today";
        renderMain(shell.getActiveSection());
      };
    });
    var refSch = main.querySelector("#spRefreshSchedule");
    if (refSch) {
      refSch.onclick = function () {
        loadSchedule()
          .then(function () {
            renderMain(shell.getActiveSection());
            shell.showMessage("تم التحديث", true);
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر التحديث", false);
          });
      };
    }
    main.querySelectorAll(".sp-schedule-accept").forEach(function (btn) {
      btn.onclick = function () {
        reserveBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-schedule-cancel").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("إلغاء هذا الموعد؟")) return;
        cancelBooking(btn.getAttribute("data-id"))
          .then(function () {
            shell.showMessage("تم الإلغاء", true);
            return loadData().then(loadSchedule);
          })
          .then(function () {
            renderMain(shell.getActiveSection());
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر الإلغاء", false);
          });
      };
    });
    main.querySelectorAll(".sp-schedule-reschedule").forEach(function (btn) {
      btn.onclick = function () {
        rescheduleBooking(btn.getAttribute("data-id"))
          .then(function () {
            shell.showMessage("تم تحديث الموعد", true);
            return loadSchedule();
          })
          .then(function () {
            renderMain(shell.getActiveSection());
          })
          .catch(function (e) {
            shell.showMessage((e && e.message) || "تعذر إعادة الجدولة", false);
          });
      };
    });
  }

  function renderMain(section) {
    shell.setContent(renderSection(section));
    paintHeader();
    wireSectionEvents();
    if (section === "notifications" && global.ErvenowPortalInlineNotifications) {
      var host = document.getElementById("spNotifHost");
      if (host) ErvenowPortalInlineNotifications.mountIn(host, "service-notif");
    }
    if (section === "schedule") {
      loadSchedule().then(function () {
        shell.setContent(renderSection("schedule"));
        wireSectionEvents();
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
    state.panelTitle = j.panel_title || "لوحة مزود الخدمة";
    try {
      var txRes = await api("/api/wallet/transactions");
      state.transactions = Array.isArray(txRes.transactions) ? txRes.transactions : [];
    } catch (_) {
      state.transactions = [];
    }
  }

  function sectionsWithLiveBookings(section) {
    return section === "dashboard" || section === "requests" || section === "schedule";
  }

  async function pollTick() {
    if (!shell) return;
    var section = shell.getActiveSection();
    await loadData();
    if (section === "schedule") await loadSchedule();
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

  function isServiceProfile(p) {
    var role = String((p && p.role) || "").toLowerCase();
    if (role !== "service") return false;
    var Op = global.ErvenowPortalFramework && ErvenowPortalFramework.Operational;
    if (Op && Op.isTransportType(p.service_type)) return false;
    return true;
  }

  async function init() {
    if (!global.ErvenowPortalFramework || !ErvenowPortalFramework.PortalShell) {
      console.error("Portal Framework غير محمّل");
      return;
    }

    var portalCfg = ErvenowPortalFramework.RoleContext.getConfig("service");
    if (ErvenowPortalFramework.PortalPlatformModules) {
      portalCfg = await ErvenowPortalFramework.PortalPlatformModules.filterConfig(portalCfg);
    }

    shell = ErvenowPortalFramework.PortalShell.create({
      role: "service",
      config: portalCfg,
      app: "#spApp",
      loginEl: "#spLogin",
      hashBase: "/service-preview",
      notifKey: "service-preview-header",
      operationalV2: true,
      portalTitle: "بوابة الخدمات",
      onReserveBooking: function (bookingId) {
        return reserveBooking(bookingId, null);
      },
      onNotificationDetails: function (bookingId) {
        state.requestsTab = "active";
        renderMain("requests");
      },
      onNavigate: function (section) {
        renderMain(section);
      },
    });
    W = shell.getWidgets();
    shell.mountChrome();

    global.addEventListener("ervenow:auth-changed", function () {
      global.location.reload();
    });

    if (!global.PlatformAPI || !PlatformAPI.getToken()) {
      shell.showLogin();
      return;
    }

    try {
      if (global.ErvenowAuthGuard) {
        var me = await ErvenowAuthGuard.ensureApprovedAccount({ loginUrl: "/login?role=service" });
        var role = String((me.profile && me.profile.role) || "").toLowerCase();
        if (role !== "service" && role !== "admin") {
          shell.showLogin();
          var loginEl = document.getElementById("spLogin");
          if (loginEl && loginEl.querySelector("p")) {
            loginEl.querySelector("p").textContent =
              "هذا الحساب ليس مزوّد خدمة — استخدم حساب مزوّد للمعاينة.";
          }
          return;
        }
        if (role === "service" && !isServiceProfile(me.profile)) {
          shell.showLogin();
          var loginEl2 = document.getElementById("spLogin");
          if (loginEl2 && loginEl2.querySelector("p")) {
            loginEl2.querySelector("p").textContent =
              "حساب نقل — افتح بوابة النقل من /transport-preview";
          }
          return;
        }
      }
      await loadData();
      shell.showApp();
      renderMain(shell.getActiveSection());
      notifOpsApi = await shell.mountNotifications();
      startPolling();
    } catch (e) {
      shell.showLogin();
      shell.showMessage((e && e.message) || "تعذّر تحميل البوابة", false);
    }
  }

  global.ErvenowServicePreview = { init: init, refresh: loadData, stop: stopPolling };
})(typeof window !== "undefined" ? window : global);
