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

  function providerServiceType() {
    return String((state.profile && state.profile.service_type) || "").toLowerCase();
  }

  function isGasCentralProvider() {
    return providerServiceType() === "gas_central_refill";
  }

  function bookingGasMode(b) {
    var d = b && b.data && typeof b.data === "object" ? b.data : {};
    return String(b.gas_mode || d.gas_mode || "").toLowerCase();
  }

  function isGasCentralBooking(b) {
    var mode = bookingGasMode(b);
    return mode === "central_refill" || mode === "bulk";
  }

  function isServicePhaseBooking(b) {
    var st = String((b && b.service_type) || "").toLowerCase();
    if (st === "car_polishing") return false;
    if (st === "gas_delivery") {
      var mode = bookingGasMode(b);
      return mode !== "central_refill" && mode !== "bulk";
    }
    return (
      ["plumber", "electrician", "ac_technician", "agricultural_engineer", "nursery", "cleaning_villa", "cleaning_building", "cleaning", "laundry_estates"].indexOf(
        st
      ) !== -1
    );
  }

  function isServicePhaseProviderForBooking(b) {
    if (!isServicePhaseBooking(b)) return false;
    var pt = providerServiceType();
    var st = String(b.service_type || "").toLowerCase();
    if (pt === "gas_cylinder_swap" && st === "gas_delivery") return true;
    if (pt === "laundry_estates") {
      return ["cleaning_villa", "cleaning_building", "cleaning", "laundry_estates"].indexOf(st) !== -1;
    }
    if (pt === "nursery") pt = "agricultural_engineer";
    return pt === st;
  }

  function findBooking(id) {
    return (state.bookings || []).find(function (b) {
      return String(b.id) === String(id);
    });
  }

  function carPolishingCpStatus(b) {
    var d = b && b.data && typeof b.data === "object" ? b.data : {};
    if (b.cp_status) return String(b.cp_status).toLowerCase();
    if (d.cp_status) return String(d.cp_status).toLowerCase();
    var st = bookingStatus(b);
    if (st === "accepted") {
      return String(d.schedule_mode || b.schedule_mode || "").toLowerCase() === "scheduled" &&
        (d.scheduled_at || b.scheduled_at)
        ? "scheduled"
        : "accepted";
    }
    if (st === "delivering") {
      if (d.cp_phase === "in_progress" || d.cp_status === "in_progress") return "in_progress";
      return "on_the_way";
    }
    if (st === "delivered") return "completed";
    if (st === "cancelled") return "cancelled";
    return "new";
  }

  function gasCentralLiters(b) {
    var d = b && b.data && typeof b.data === "object" ? b.data : {};
    return b.gas_liters || d.gas_liters || b.service_qty || d.qty || "—";
  }

  function gasCentralFacility(b, d) {
    return d.establishment_name || b.district || b.service_name || "—";
  }

  function servicePhaseStatus(b) {
    var d = b && b.data && typeof b.data === "object" ? b.data : {};
    if (b.sp_status) return String(b.sp_status).toLowerCase();
    if (d.sp_status) return String(d.sp_status).toLowerCase();
    var st = bookingStatus(b);
    if (st === "accepted") {
      return String(d.schedule_mode || b.schedule_mode || "").toLowerCase() === "scheduled" &&
        (d.scheduled_at || b.scheduled_at)
        ? "scheduled"
        : "accepted";
    }
    if (st === "delivering") {
      if (d.sp_phase === "in_progress" || d.sp_status === "in_progress") return "in_progress";
      return "on_the_way";
    }
    if (st === "delivered") return "completed";
    if (st === "cancelled") return "cancelled";
    return "new";
  }

  function spScheduleText(b) {
    return cpScheduleText(b);
  }

  function servicePhaseDetail(b) {
    if (!isServicePhaseBooking(b)) return "";
    var d = b.data && typeof b.data === "object" ? b.data : {};
    var subtype = b.service_subtype_label || d.service_subtype_label || d.service_subtype || "";
    var photos = Array.isArray(b.service_photos)
      ? b.service_photos
      : Array.isArray(d.service_photos)
        ? d.service_photos
        : [];
    var notes = String(b.notes || d.order_notes || d.customer_notes || "").trim();
    var html =
      (subtype ? "<p>نوع الخدمة: " + esc(subtype) + "</p>" : "") +
      "<p>الموعد: " +
      esc(spScheduleText(b)) +
      "</p>" +
      "<p>الحالة: " +
      esc(cpStatusLabelAr(servicePhaseStatus(b))) +
      "</p>" +
      (notes ? "<p>ملاحظات: " + esc(notes) + "</p>" : "");
    if (photos.length) {
      html +=
        '<p style="margin-bottom:6px">صور الطلب (' +
        photos.length +
        "):</p><div class=\"sp-cp-photos\">" +
        photos
          .slice(0, 10)
          .map(function (item, i) {
            var url = typeof item === "string" ? item : item && item.url ? item.url : "";
            if (!url) return "";
            return (
              '<a href="' +
              esc(String(url)) +
              '" target="_blank" rel="noopener" title="صورة ' +
              (i + 1) +
              '"><img src="' +
              esc(String(url)) +
              '" alt="صورة ' +
              (i + 1) +
              '" loading="lazy" /></a>'
            );
          })
          .join("") +
        "</div>";
    }
    return html;
  }

  function cpStatusLabelAr(status) {
    var map = {
      new: "جديدة",
      accepted: "مقبولة",
      scheduled: "مجدولة",
      on_the_way: "في الطريق",
      in_progress: "قيد التنفيذ",
      completed: "مكتملة",
      cancelled: "ملغاة",
    };
    return map[String(status || "").toLowerCase()] || status || "—";
  }

  function cpScheduleText(b) {
    var d = b && b.data && typeof b.data === "object" ? b.data : {};
    var mode = String(d.schedule_mode || b.schedule_mode || "immediate").toLowerCase();
    if (mode === "scheduled") {
      var when = d.scheduled_at || b.scheduled_at;
      return when ? "مجدول — " + fmtDate(when) : "مجدول";
    }
    return "تنفيذ فوري — الآن";
  }

  var CP_REJECT_REASONS = [
    { code: "workload", label: "ضغط عمل" },
    { code: "out_of_area", label: "خارج نطاق الخدمة" },
    { code: "bad_schedule", label: "الموعد غير مناسب" },
    { code: "other", label: "سبب آخر" },
  ];

  var CP_CANCEL_REASONS = [
    { code: "workload", label: "ضغط عمل" },
    { code: "vehicle_breakdown", label: "عطل مركبة" },
    { code: "emergency", label: "ظرف طارئ" },
    { code: "other", label: "سبب آخر" },
  ];

  var PHOTO_SLOT_LABELS = { front: "أمامية", back: "خلفية", side: "جانبية", extra: "إضافية" };

  function pickReasonCode(reasons, promptTitle) {
    var lines = (reasons || []).map(function (r, i) {
      return i + 1 + ") " + r.label + " [" + r.code + "]";
    });
    var raw = global.prompt(promptTitle + "\n\n" + lines.join("\n") + "\n\nأدخل رقم السبب أو الكود:", "1");
    if (raw == null) return null;
    var t = String(raw).trim().toLowerCase();
    var byIdx = Number(t);
    if (Number.isInteger(byIdx) && byIdx >= 1 && byIdx <= reasons.length) return reasons[byIdx - 1].code;
    var hit = (reasons || []).find(function (r) {
      return r.code === t;
    });
    return hit ? hit.code : "other";
  }

  function carPolishingDetail(b) {
    if (String(b.service_type || "").toLowerCase() !== "car_polishing") return "";
    var d = b.data && typeof b.data === "object" ? b.data : {};
    var labels = { sedan: "سيدان", jeep: "جيب", van: "فان", bus: "باص" };
    var vt = String(d.vehicle_type || "").toLowerCase();
    var addons = [];
    if (d.addon_engine_wash) addons.push("غسيل المحرك");
    if (d.addon_wheels) addons.push("تلميع الجنوط");
    if (d.addon_exterior) addons.push("البدي الخارجي");
    var photos = Array.isArray(b.vehicle_photos)
      ? b.vehicle_photos
      : Array.isArray(d.vehicle_photos)
        ? d.vehicle_photos
        : [];
    var notes = String(b.notes || d.order_notes || d.customer_notes || "").trim();
    var html =
      "<p>نوع المركبة: " +
      esc(labels[vt] || vt || "—") +
      "</p>" +
      (addons.length ? "<p>الخدمات المختارة: " + esc(addons.join(" · ")) + "</p>" : "") +
      "<p>الموعد: " +
      esc(cpScheduleText(b)) +
      "</p>" +
      "<p>الحالة: " +
      esc(cpStatusLabelAr(carPolishingCpStatus(b))) +
      "</p>" +
      "<p>السعر: " +
      esc(fmtMoney(b.total_amount || 0)) +
      " ر.س</p>" +
      (notes ? "<p>ملاحظات: " + esc(notes) + "</p>" : "");
    if (photos.length) {
      html +=
        '<p style="margin-bottom:6px">صور المركبة (' +
        photos.length +
        "):</p><div class=\"sp-cp-photos\">" +
        photos
          .slice(0, 10)
          .map(function (item, i) {
            var url = typeof item === "string" ? item : item && item.url ? item.url : "";
            var slot =
              typeof item === "object" && item && item.slot
                ? PHOTO_SLOT_LABELS[item.slot] || item.slot
                : "صورة " + (i + 1);
            if (!url) return "";
            return (
              '<a href="' +
              esc(String(url)) +
              '" target="_blank" rel="noopener" title="' +
              esc(slot) +
              '"><img src="' +
              esc(String(url)) +
              '" alt="' +
              esc(slot) +
              '" loading="lazy" /></a>'
            );
          })
          .join("") +
        "</div>";
    }
    return html;
  }

  function isCarPolishingProvider() {
    return providerServiceType() === "car_polishing";
  }

  function actualLitersFromCard(cardEl) {
    if (!cardEl) return null;
    var input = cardEl.querySelector(".sp-gas-actual-liters");
    if (!input) return null;
    var n = Number(String(input.value || "").trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
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
    if (booking && String(booking.service_type || "").toLowerCase() === "car_polishing") {
      return cpStatusLabelAr(carPolishingCpStatus(booking));
    }
    if (booking && isServicePhaseBooking(booking)) {
      return cpStatusLabelAr(servicePhaseStatus(booking));
    }
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

  function renderCarPolishingActions(b, mine, canReserve) {
    var cp = carPolishingCpStatus(b);
    var html = "";
    if (canReserve && isCarPolishingProvider()) {
      html +=
        '<button type="button" class="pf-btn pf-btn--primary sp-reserve" data-id="' +
        esc(b.id) +
        '">قبول</button>' +
        '<button type="button" class="pf-btn sp-reject" data-id="' +
        esc(b.id) +
        '">رفض</button>';
      return html;
    }
    if (!mine) return "";
    if (cp === "accepted" || cp === "scheduled") {
      html +=
        '<button type="button" class="pf-btn sp-en-route" data-id="' +
        esc(b.id) +
        '">في الطريق</button>' +
        '<button type="button" class="pf-btn sp-cancel-task" data-id="' +
        esc(b.id) +
        '">إلغاء المهمة</button>';
    } else if (cp === "on_the_way") {
      html +=
        '<button type="button" class="pf-btn sp-cp-progress" data-id="' +
        esc(b.id) +
        '">بدء التنفيذ</button>' +
        '<button type="button" class="pf-btn sp-cancel-task" data-id="' +
        esc(b.id) +
        '">إلغاء المهمة</button>';
    } else if (cp === "in_progress") {
      html +=
        '<button type="button" class="pf-btn pf-btn--primary sp-complete" data-id="' +
        esc(b.id) +
        '" data-default-label="إتمام الخدمة">إتمام الخدمة</button>' +
        '<button type="button" class="pf-btn sp-cancel-task" data-id="' +
        esc(b.id) +
        '">إلغاء المهمة</button>';
    }
    return html;
  }

  function renderServicePhaseActions(b, mine, canReserve) {
    var sp = servicePhaseStatus(b);
    var html = "";
    if (canReserve && isServicePhaseProviderForBooking(b)) {
      html +=
        '<button type="button" class="pf-btn pf-btn--primary sp-reserve" data-id="' +
        esc(b.id) +
        '">قبول</button>';
      return html;
    }
    if (!mine || !isServicePhaseProviderForBooking(b)) return "";
    if (sp === "accepted" || sp === "scheduled") {
      html +=
        '<button type="button" class="pf-btn sp-en-route" data-id="' +
        esc(b.id) +
        '">في الطريق</button>';
    } else if (sp === "on_the_way") {
      html +=
        '<button type="button" class="pf-btn sp-sp-progress" data-id="' +
        esc(b.id) +
        '">بدء التنفيذ</button>';
    } else if (sp === "in_progress") {
      html +=
        '<button type="button" class="pf-btn pf-btn--primary sp-complete" data-id="' +
        esc(b.id) +
        '" data-default-label="إتمام الخدمة">إتمام الخدمة</button>';
    }
    return html;
  }

  function renderBookingCard(b) {
    var st = bookingStatus(b);
    var mine = String(b.provider_id || "") === providerId();
    var canReserve = (st === "new" || st === "pending") && !b.provider_id;
    var isCpBooking = String(b.service_type || "").toLowerCase() === "car_polishing";
    var isSpBooking = isServicePhaseBooking(b) && !isGasCentralBooking(b);
    var canProviderExecute = mine && st === "accepted" && !isCpBooking && !isSpBooking;
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
    var extraGasCentral =
      isGasCentralBooking(b) || (isGasCentralProvider() && String(b.service_type || "").toLowerCase() === "gas_delivery")
        ? "<div class='sp-gas-central'>" +
          "<p><strong>تعبئة غاز مركزي</strong></p>" +
          "<p>المنشأة / الحي: " +
          esc(gasCentralFacility(b, d)) +
          "</p>" +
          "<p>اللترات المطلوبة: " +
          esc(String(gasCentralLiters(b))) +
          " لتر</p>" +
          (d.actual_liters_delivered
            ? "<p>اللترات الفعلية: " + esc(String(d.actual_liters_delivered)) + " لتر</p>"
            : "") +
          (canProviderExecute || (mine && st === "delivering")
            ? "<label class='sp-gas-liters-label'>اللترات الفعلية المُسلَّمة" +
              "<input type='number' class='sp-gas-actual-liters pf-input' min='1' step='1' " +
              'placeholder="' +
              esc(String(gasCentralLiters(b))) +
              '" value="' +
              esc(String(d.actual_liters_delivered || gasCentralLiters(b) || "")) +
              '" /></label>'
            : "") +
          "</div>"
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
      extraGasCentral +
      carPolishingDetail(b) +
      servicePhaseDetail(b) +
      (maps && !extraInternal && !extraGasCentral && !carPolishingDetail(b) && !servicePhaseDetail(b)
        ? '<p><a href="' + esc(maps) + '" target="_blank" rel="noopener">فتح الموقع على الخرائط</a></p>'
        : !extraInternal && !extraGasCentral
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
      (isCpBooking && isCarPolishingProvider()
        ? renderCarPolishingActions(b, mine, canReserve)
        : isSpBooking
          ? renderServicePhaseActions(b, mine, canReserve)
          : "") +
      (!isCpBooking || !isCarPolishingProvider()) && !isSpBooking
        ? (canReserve
            ? '<button type="button" class="pf-btn pf-btn--primary sp-reserve" data-id="' +
              esc(b.id) +
              '">حجز الطلب</button>'
            : "") +
          (mine && st === "accepted" && !isGasCentralBooking(b)
            ? '<button type="button" class="pf-btn sp-en-route" data-id="' + esc(b.id) + '">في الطريق</button>'
            : "") +
          (canProviderExecute && isGasCentralBooking(b)
            ? '<button type="button" class="pf-btn sp-gas-start" data-id="' +
              esc(b.id) +
              '">بدء التعبئة</button>'
            : canProviderExecute
              ? '<button type="button" class="pf-btn sp-complete" data-id="' +
                esc(b.id) +
                '">تم التنفيذ</button>'
              : mine && st === "delivering" && isGasCentralBooking(b)
                ? '<button type="button" class="pf-btn pf-btn--primary sp-gas-finish" data-id="' +
                  esc(b.id) +
                  '">إنهاء المهمة</button>'
                : st === "delivering" && mine
                  ? '<span style="font-size:0.82rem;color:var(--pf-muted)">بانتظار تأكيد العضو</span>'
                  : "")
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
        await Loc.ensureForOrders("service", state.profile);
      } else if (typeof Loc.captureAndSave === "function") {
        await Loc.captureAndSave("service");
      }
      if (typeof Loc.startPresenceLoop === "function") {
        Loc.startPresenceLoop("service", 15000);
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
    var newList = filterBookings("new").slice(0, 4);
    var activeList = filterBookings("active").slice(0, 4);
    var doneList = filterBookings("done").slice(0, 4);
    return (
      locationBannerHtml() +
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
      locationBannerHtml() +
      W.sectionHeader(
        isCarPolishingProvider() ? "طلبات تلميع المركبات" : "الطلبات",
        "Requests — جديدة · جارية · مكتملة"
      ) +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="pf-btn" id="spRefreshRequests">تحديث</button></div>' +
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
      (global.ErvenowPortalWalletWithdraw && ErvenowPortalWalletWithdraw.renderWithdrawPanel
        ? ErvenowPortalWalletWithdraw.renderWithdrawPanel({ prefix: "sp", minAmount: 20 })
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
    var payPanel =
      global.ErvenowPortalProviderPayment && ErvenowPortalProviderPayment.renderPanel
        ? ErvenowPortalProviderPayment.renderPanel("sp")
        : "";
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
      '<a class="pf-btn" href="/login?role=service">إدارة الحساب</a></div></div>' +
      payPanel
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
    if (global.ErvenowPortalProviderLocation) {
      ErvenowPortalProviderLocation.syncButtonLabel(p);
    }
  }

  async function reserveBooking(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = isCarPolishingProvider() ? "جاري القبول..." : "جاري الحجز...";
    }
    try {
      var Loc = global.ErvenowPortalProviderLocation;
      if (Loc) {
        if (typeof Loc.ensureForOrders === "function") {
          await Loc.ensureForOrders("service", state.profile);
        } else if (typeof Loc.captureAndSave === "function") {
          await Loc.captureAndSave("service");
        }
      }
      var coords = Loc && Loc.getLastCoords ? Loc.getLastCoords() : null;
      var body = coords ? { lat: coords.lat, lng: coords.lng } : {};
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/reserve", {
        method: "POST",
        body: body,
      });
      shell.showMessage(j.message || (isCarPolishingProvider() ? "تم قبول الطلب" : "تم حجز الطلب"), true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الحجز", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = isCarPolishingProvider() ? "قبول" : "حجز الطلب";
      }
    }
  }

  async function rejectBooking(id, btn) {
    var reasonCode = pickReasonCode(CP_REJECT_REASONS, "سبب رفض الطلب");
    if (!reasonCode) return;
    var reasonText = "";
    if (reasonCode === "other") {
      reasonText = String(global.prompt("اكتب سبب الرفض:", "") || "").trim();
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الرفض...";
    }
    try {
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/reject", {
        method: "POST",
        body: { reason_code: reasonCode, reason_text: reasonText },
      });
      shell.showMessage(j.message || "تم رفض الطلب", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الرفض", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "رفض";
      }
    }
  }

  async function cancelTaskBooking(id, btn) {
    if (!global.confirm("إلغاء المهمة وإعادة نشر الطلب لمزود آخر؟")) return;
    var reasonCode = pickReasonCode(CP_CANCEL_REASONS, "سبب إلغاء المهمة");
    if (!reasonCode) return;
    var reasonText = "";
    if (reasonCode === "other") {
      reasonText = String(global.prompt("اكتب سبب الإلغاء:", "") || "").trim();
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الإلغاء...";
    }
    try {
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/cancel-task", {
        method: "POST",
        body: { reason_code: reasonCode, reason_text: reasonText },
      });
      shell.showMessage(j.message || "تم إلغاء المهمة", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الإلغاء", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "إلغاء المهمة";
      }
    }
  }

  async function enRouteBooking(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري التحديث...";
    }
    try {
      var b = findBooking(id);
      var body = b && isServicePhaseBooking(b)
        ? { sp_status: "on_the_way" }
        : isCarPolishingProvider()
          ? { cp_status: "on_the_way" }
          : { status: "delivering" };
      await api("/api/services/bookings/" + encodeURIComponent(id) + "/status", {
        method: "PATCH",
        body: body,
      });
      shell.showMessage("تم تحديث الحالة — المزود في الطريق", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر التحديث", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "في الطريق";
      }
    }
  }

  async function startCpProgress(id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري البدء...";
    }
    try {
      var b = findBooking(id);
      var body = b && isServicePhaseBooking(b) ? { sp_status: "in_progress" } : { cp_status: "in_progress" };
      await api("/api/services/bookings/" + encodeURIComponent(id) + "/status", {
        method: "PATCH",
        body: body,
      });
      shell.showMessage("بدأ التنفيذ", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر التحديث", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "بدء التنفيذ";
      }
    }
  }

  async function completeBooking(id, btn, body) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جاري الإتمام...";
    }
    try {
      var bk = findBooking(id);
      var payload =
        body ||
        (isCarPolishingProvider() || (bk && isServicePhaseBooking(bk) && servicePhaseStatus(bk) === "in_progress")
          ? { actor: "both" }
          : { step: "provider" });
      var j = await api("/api/services/bookings/" + encodeURIComponent(id) + "/complete", {
        method: "POST",
        body: payload,
      });
      shell.showMessage(j.message || "تم التحديث", true);
      await loadData();
      renderMain(shell.getActiveSection());
    } catch (e) {
      shell.showMessage((e && e.message) || "تعذر الإتمام", false);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.getAttribute("data-default-label") || "تم التنفيذ";
      }
    }
  }

  async function startGasRefill(id, btn) {
    if (btn) btn.setAttribute("data-default-label", "بدء التعبئة");
    await completeBooking(id, btn, { step: "provider" });
  }

  async function finishGasRefill(id, btn) {
    var card = btn && btn.closest ? btn.closest("[data-booking-id]") : null;
    var liters = actualLitersFromCard(card);
    if (!liters) {
      shell.showMessage("أدخل اللترات الفعلية المُسلَّمة", false);
      return;
    }
    if (btn) btn.setAttribute("data-default-label", "إنهاء المهمة");
    await completeBooking(id, btn, { step: "legacy", actual_liters: liters });
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
    main.querySelectorAll(".sp-reject").forEach(function (btn) {
      btn.onclick = function () {
        rejectBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-cancel-task").forEach(function (btn) {
      btn.onclick = function () {
        cancelTaskBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-cp-progress, .sp-sp-progress").forEach(function (btn) {
      btn.onclick = function () {
        startCpProgress(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-en-route").forEach(function (btn) {
      btn.onclick = function () {
        enRouteBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-complete").forEach(function (btn) {
      btn.onclick = function () {
        completeBooking(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-gas-start").forEach(function (btn) {
      btn.onclick = function () {
        startGasRefill(btn.getAttribute("data-id"), btn);
      };
    });
    main.querySelectorAll(".sp-gas-finish").forEach(function (btn) {
      btn.onclick = function () {
        finishGasRefill(btn.getAttribute("data-id"), btn);
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
    if (section === "wallet" && global.ErvenowPortalWalletWithdraw) {
      ErvenowPortalWalletWithdraw.wireWithdrawPanel({
        prefix: "sp",
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
    if (section === "schedule") {
      loadSchedule().then(function () {
        shell.setContent(renderSection("schedule"));
        wireSectionEvents();
      });
    }
    if (section === "settings" && global.ErvenowPortalProviderPayment) {
      ErvenowPortalProviderPayment.loadAndWire({
        prefix: "sp",
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
    state.panelTitle = j.panel_title || "لوحة مزود الخدمة";
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

  function stopAll() {
    stopPolling();
    if (global.ErvenowPortalProviderLocation && ErvenowPortalProviderLocation.stopPresenceLoop) {
      ErvenowPortalProviderLocation.stopPresenceLoop();
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

  global.ErvenowServicePreview = { init: init, refresh: loadData, stop: stopAll };
})(typeof window !== "undefined" ? window : global);
