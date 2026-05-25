/** Admin Dashboard — finance */
import { app } from "./shared.js";
import "./api.js";

app.handleFinancialAlertDetail = function (btn) {
  if (!btn) return;
  var type = btn.getAttribute("data-alert-type") || "";
  var userId = btn.getAttribute("data-alert-user") || "";
  if (type === "large_withdrawal") {
    window.location.href = "/admin/withdrawals";
    return;
  }
  if (
    (type === "high_debt" || type === "auto_freeze_warn" || type === "auto_freeze_blocked") &&
    userId
  ) {
    app.showPanel("financePanel");
    void app.loadFinancePanel().then(function () {
      app.openFinanceDrawer(userId);
    });
    return;
  }
  if (type === "abnormal_activity") {
    var txWrap = document.getElementById("ledgerTransactionsBody");
    if (txWrap) txWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  app.showPanel("financePanel");
}

app.renderFinancialAlerts = function (alerts) {
  var root = document.getElementById("financialAlertsList");
  var updatedEl = document.getElementById("financialAlertsUpdated");
  if (!root) return;
  if (updatedEl) updatedEl.textContent = "آخر تحديث: " + app.fmtWhen(new Date().toISOString());
  if (!app.isFinFeatureEnabled("financial_alerts")) {
    root.innerHTML =
      '<p class="financial-alert-empty">التنبيهات المالية معطّلة (Feature Control: OFF)</p>';
    return;
  }
  if (!alerts || !alerts.length) {
    root.innerHTML = '<p class="financial-alert-empty">✅ لا توجد تنبيهات مالية حالياً</p>';
    return;
  }
  root.innerHTML = alerts
    .map(function (a) {
      var sev = a.severity === "danger" ? "danger" : "warn";
      return (
        '<div class="financial-alert-card financial-alert-card--' +
        sev +
        '">' +
        '<div><p class="financial-alert-card__title">🚨 ' +
        app.escapeHtml(a.title || "تنبيه") +
        "</p>" +
        '<p class="financial-alert-card__msg">' +
        app.escapeHtml(a.message || "") +
        (a.payment_link
          ? '<br><a href="' +
            app.escapeHtml(a.payment_link) +
            '" target="_blank" rel="noopener" style="font-size:0.85rem">رابط السداد</a>'
          : "") +
        "</p></div>" +
        '<button type="button" class="btn btn-ghost financial-alert-detail-btn" data-alert-type="' +
        app.escapeHtml(a.type || "") +
        '" data-alert-user="' +
        app.escapeHtml(a.user_id || "") +
        '">عرض التفاصيل</button></div>'
      );
    })
    .join("");
  root.querySelectorAll(".financial-alert-detail-btn").forEach(function (b) {
    b.onclick = function () {
      app.handleFinancialAlertDetail(b);
    };
  });
}

app.renderLedgerTransactionsTable = function (rows) {
  var body = document.getElementById("ledgerTransactionsBody");
  var updatedEl = document.getElementById("ledgerTxLastUpdated");
  if (!body) return;
  if (updatedEl) updatedEl.textContent = "آخر تحديث: " + app.fmtWhen(new Date().toISOString());
  if (!rows || !rows.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="finance-msg">لا توجد عمليات في ervenow_ledger بعد</td></tr>';
    return;
  }
  var esc = function (s) {
    if (s == null || s === "") return "—";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };
  body.innerHTML = rows
    .map(function (tx) {
      var dir = String(tx.direction || "").toLowerCase();
      var dirClass = dir === "credit" ? "ledger-tx-credit" : dir === "debit" ? "ledger-tx-debit" : "";
      return (
        "<tr>" +
        "<td>" +
        esc(tx.type) +
        "</td>" +
        '<td class="' +
        dirClass +
        '">' +
        esc(tx.direction) +
        "</td>" +
        "<td>" +
        esc(app.fmtMoneyShort(tx.amount)) +
        "</td>" +
        "<td>" +
        esc(tx.user_id) +
        "</td>" +
        "<td>" +
        esc(tx.reference_id) +
        "</td>" +
        "<td>" +
        esc(app.fmtWhen(tx.created_at)) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

app.applyLedgerFinanceSummary = function (j) {
  if (!j) return;
  if (j.feature_flags) app.financialFeatureModes = j.feature_flags;
  app.applyFinanceFeatureVisibility();
  var set = function (id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = app.fmtMoney(val || 0);
  };
  set("lfPlatformCommission", j.platform_commission_total);
  set("lfDriverEarnings", j.driver_earnings_total);
  set("lfServiceCommission", j.service_commission_total);
  set("lfStoreEarnings", j.store_earnings_total);
  if (app.isFinFeatureEnabled("financial_alerts")) {
    app.renderFinancialAlerts(j.financial_alerts || []);
  } else {
    app.renderFinancialAlerts([]);
  }
  app.renderLedgerTransactionsTable(j.recent_transactions || []);
}

app.loadLedgerFinanceSummary = async function () {
  if (!app.hasPermission("finance")) return;
  var hint = document.getElementById("ledgerFinanceHint");
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/finance-summary");
    if (!j || j.ok === false) {
      throw new Error((j && j.reason) || "finance-summary failed");
    }
    console.log("[finance dashboard] using ledger");
    app.ledgerFinanceSummary = j;
    app.applyLedgerFinanceSummary(j);
  } catch (e) {
    if (hint) {
      hint.style.display = "block";
      hint.textContent = e.message || "تعذّر تحميل الملخص من ervenow_ledger — تحقق من الهجرات";
    }
    var txBody = document.getElementById("ledgerTransactionsBody");
    if (txBody) {
      txBody.innerHTML =
        '<tr><td colspan="6" class="finance-msg">' +
        (e.message || "تعذّر تحميل العمليات") +
        "</td></tr>";
    }
  }
}

app.financeRiskLevel = function (d) {
  var bal = app.roundMoney2(Number(d && d.balance) || 0);
  var limit = app.financeDebtLimit > 0 ? app.financeDebtLimit : 300;
  if (d && d.debt_blocked) return "danger";
  if (bal >= limit) return "danger";
  if (bal >= limit * 0.7) return "warn";
  return "ok";
}

app.financeLedgerTypeLabel = function (t) {
  var x = String(t || "").toLowerCase();
  if (x === "commission") return "عمولة COD";
  if (x === "payout") return "تحصيل / دفعة";
  if (x === "adjustment") return "تسوية";
  return t || "عملية";
}

app.normalizeFinanceRow = function (raw) {
  var bal = app.roundMoney2(Number(raw.balance) || 0);
  return {
    driver_id: String(raw.driver_id || ""),
    name: raw.name || "مندوب",
    phone: raw.phone || "",
    balance: bal,
    operations_count: Number(raw.operations_count) || 0,
    debt_blocked: !!raw.debt_blocked,
    alert_balance: !!raw.alert_balance || bal > app.financeAlertThreshold,
    notify_status: raw.notify_status || null,
    notify_kind: raw.notify_kind || null,
    notify_at: raw.notify_at || null,
    last_receipt_reference: raw.last_receipt_reference || null,
  };
}

app.financeExtractReceiptRef = function (meta) {
  if (!meta || typeof meta !== "object") return null;
  return meta.receipt_reference || meta.receiptReference || null;
}

app.validateFinanceCollectAmount = function (raw, maxBalance) {
  var n = Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, message: "أدخل رقماً صالحاً (بدون نص أو رموز)" };
  }
  if (n < 0) {
    return { ok: false, message: "لا يُقبل المبلغ السالب" };
  }
  var amount = app.roundMoney2(n);
  if (amount <= 0) {
    return { ok: false, message: "المبلغ يجب أن يكون أكبر من صفر بعد التقريب" };
  }
  var max = app.roundMoney2(Number(maxBalance) || 0);
  if (max > 0 && amount > max + 0.004) {
    return {
      ok: false,
      message:
        "المبلغ " + app.fmtMoney(amount) + " أكبر من الرصيد المستحق " + app.fmtMoney(max),
    };
  }
  var rounded = Math.abs(n - amount) > 0.001;
  return {
    ok: true,
    amount: amount,
    rounded: rounded,
    roundingNote: rounded
      ? "تم تقريب المبلغ إلى هللتين (ريال سعودي): " + app.fmtMoney(amount)
      : "",
  };
}

app.showFinanceReceiptRef = function (ref) {
  var box = document.getElementById("financeReceiptBox");
  var code = document.getElementById("financeReceiptCode");
  if (!box || !code) return;
  if (!ref) {
    box.classList.remove("visible");
    code.innerText = "—";
    return;
  }
  code.innerText = String(ref);
  box.classList.add("visible");
}

app.copyFinanceReceiptRef = function () {
  var code = document.getElementById("financeReceiptCode");
  var text = code ? String(code.innerText || "").trim() : "";
  if (!text || text === "—") return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      if (typeof showSuccess === "function") app.showSuccess("تم نسخ مرجع الإيصال");
    });
    return;
  }
  var ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    if (typeof showSuccess === "function") app.showSuccess("تم نسخ مرجع الإيصال");
  } catch (_e) {}
  document.body.removeChild(ta);
}

app.updateFinanceRoundingHint = function () {
  var inp = document.getElementById("financeCollectAmount");
  var hint = document.getElementById("financeRoundingHint");
  var d = app.getFinanceDriver(app.financeDrawerDriverId);
  if (!inp || !hint) return;
  var v = app.validateFinanceCollectAmount(inp.value, d ? d.balance : 0);
  if (!v.ok) {
    hint.textContent = v.message || "";
    hint.style.color = "#b91c1c";
    return;
  }
  hint.style.color = "#c2410c";
  hint.textContent = v.roundingNote || "التقريب: إلى منزلتين عشريتين (هللة)";
}

app.financeNotifyBadgeHtml = function (d) {
  var st = String((d && d.notify_status) || "").toLowerCase();
  if (st === "sent") {
    var kind =
      d.notify_kind === "threshold"
        ? "تنبيه حد"
        : d.notify_kind === "delivery"
          ? "بعد تسليم"
          : "تم الإرسال";
    return (
      '<span class="finance-notify-badge finance-notify-badge--sent" title="' +
      app.escapeHtml(d.notify_at || "") +
      '">✓ ' +
      app.escapeHtml(kind) +
      "</span>"
    );
  }
  if (st === "failed") {
    return '<span class="finance-notify-badge finance-notify-badge--failed">فشل الإرسال</span>';
  }
  if (st === "pending") {
    return '<span class="finance-notify-badge finance-notify-badge--pending">قيد الإرسال</span>';
  }
  if (d && d.alert_balance && (Number(d.balance) || 0) > 0) {
    return '<span class="finance-notify-badge finance-notify-badge--due">يستحق تنبيه</span>';
  }
  return '<span class="finance-notify-badge finance-notify-badge--none">—</span>';
}

app.getFinanceDriver = function (driverId) {
  for (var i = 0; i < app.cacheFinanceDrivers.length; i++) {
    if (app.cacheFinanceDrivers[i].driver_id === driverId) return app.cacheFinanceDrivers[i];
  }
  return null;
}

app.patchFinanceDriver = function (driverId, patch) {
  for (var i = 0; i < app.cacheFinanceDrivers.length; i++) {
    if (app.cacheFinanceDrivers[i].driver_id === driverId) {
      Object.assign(app.cacheFinanceDrivers[i], patch);
      return app.cacheFinanceDrivers[i];
    }
  }
  return null;
}

app.updateFinanceKpis = function () {
  var totalDebt = 0;
  var blocked = 0;
  var totalOps = 0;
  app.cacheFinanceDrivers.forEach(function (d) {
    var bal = Number(d.balance) || 0;
    if (bal > 0) totalDebt += bal;
    if (d.debt_blocked) blocked += 1;
    totalOps += Number(d.operations_count) || 0;
  });
  var elDebt = document.getElementById("financeKpiTotalDebt");
  if (elDebt) elDebt.innerText = app.fmtMoney(app.roundMoney2(totalDebt));
  var elBlk = document.getElementById("financeKpiBlockedDrivers");
  if (elBlk) elBlk.innerText = String(blocked);
  var elOps = document.getElementById("financeKpiTotalOperations");
  if (elOps) elOps.innerText = String(totalOps);
  app.setBadge("badgeFinanceBlocked", blocked);
}

app.renderFinanceTable = function () {
  var tbody = document.getElementById("financeTableBody");
  if (!tbody) return;
  var q = app.getSearch("financeSearch");
  var filter = String(
    (document.getElementById("financeFilter") && document.getElementById("financeFilter").value) || ""
  );
  var rows = app.cacheFinanceDrivers.filter(function (d) {
    if (filter === "blocked" && !d.debt_blocked) return false;
    if (filter === "active" && d.debt_blocked) return false;
    if (filter === "with_debt" && (Number(d.balance) || 0) <= 0) return false;
    return app.hasQueryMatch(q, [d.name, d.phone, d.driver_id]);
  });
  rows.sort(function (a, b) {
    return (Number(b.balance) || 0) - (Number(a.balance) || 0);
  });
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="finance-msg">لا توجد سجلات مطابقة</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(function (d) {
      var bal = Number(d.balance) || 0;
      var risk = app.financeRiskLevel(d);
      var blocked = !!d.debt_blocked;
      var canCollect = bal > 0;
      return (
        '<tr class="finance-row-clickable finance-row--' +
        risk +
        '" data-finance-driver="' +
        app.escapeHtml(d.driver_id) +
        '">' +
        "<td><strong>" +
        app.escapeHtml(d.name) +
        '</strong><br><span class="muted" style="font-size:.82rem">' +
        app.escapeHtml(d.phone || "—") +
        "</span></td>" +
        '<td><span class="finance-balance-pill finance-balance-pill--' +
        risk +
        '">' +
        app.fmtMoney(bal) +
        "</span></td>" +
        "<td>" +
        String(d.operations_count || 0) +
        "</td>" +
        '<td><span class="finance-status-badge finance-status-badge--' +
        (blocked ? "blocked" : "active") +
        '">' +
        (blocked ? "محظور" : "نشط") +
        "</span></td>" +
        "<td>" +
        app.financeNotifyBadgeHtml(d) +
        "</td>" +
        "<td><div class=\"finance-row-actions\">" +
        (canCollect
          ? '<button type="button" class="finance-btn-collect" data-finance-collect="' +
            app.escapeHtml(d.driver_id) +
            '">تحصيل</button>'
          : "") +
        (bal > 0
          ? '<button type="button" class="finance-btn-remind" data-finance-remind="' +
            app.escapeHtml(d.driver_id) +
            '">تذكير</button>'
          : "") +
        (!canCollect && bal <= 0 ? '<span class="muted">—</span>' : "") +
        "</div></td>" +
        "</tr>"
      );
    })
    .join("");
  var trs = tbody.querySelectorAll("tr[data-finance-driver]");
  for (var i = 0; i < trs.length; i++) {
    trs[i].addEventListener("click", function (ev) {
      if (ev.target.closest("[data-finance-collect], [data-finance-remind]")) return;
      app.openFinanceDrawer(this.getAttribute("data-finance-driver"));
    });
  }
  var cbtns = tbody.querySelectorAll("[data-finance-collect]");
  for (var j = 0; j < cbtns.length; j++) {
    cbtns[j].addEventListener("click", function (ev) {
      ev.stopPropagation();
      app.openFinanceDrawer(this.getAttribute("data-finance-collect"), true);
    });
  }
  var rbtns = tbody.querySelectorAll("[data-finance-remind]");
  for (var k = 0; k < rbtns.length; k++) {
    rbtns[k].addEventListener("click", function (ev) {
      ev.stopPropagation();
      app.sendFinanceReminder(this.getAttribute("data-finance-remind"));
    });
  }
}

app.closeFinanceDrawer = function () {
  var backdrop = document.getElementById("financeDrawerBackdrop");
  if (backdrop) backdrop.hidden = true;
  app.financeDrawerDriverId = null;
  app.financeDrawerLedgerCache = [];
}

app.renderFinanceDrawerLedger = function (entries) {
  var root = document.getElementById("financeDrawerLedger");
  if (!root) return;
  if (!entries || !entries.length) {
    root.innerHTML = '<div class="finance-msg">لا توجد عمليات في السجل</div>';
    return;
  }
  root.innerHTML = entries
    .map(function (e) {
      var typ = String(e.type || "").toLowerCase();
      var amt = app.roundMoney2(Number(e.amount) || 0);
      var sign = typ === "payout" ? "−" : "+";
      var oid = e.order_id ? String(e.order_id).slice(0, 8) : "—";
      var ref = app.financeExtractReceiptRef(e.meta);
      var refLine = ref
        ? '<div class="muted" style="font-size:.78rem;margin-top:3px">إيصال: <code>' +
          app.escapeHtml(ref) +
          "</code></div>"
        : "";
      return (
        '<div class="finance-ledger-item finance-ledger-item--' +
        app.escapeHtml(typ) +
        '">' +
        "<div><strong>" +
        app.escapeHtml(app.financeLedgerTypeLabel(typ)) +
        "</strong> · " +
        sign +
        app.fmtMoney(Math.abs(amt)) +
        "</div>" +
        refLine +
        '<div class="muted" style="font-size:.8rem;margin-top:4px">طلب: ' +
        app.escapeHtml(oid) +
        " · " +
        app.escapeHtml(e.created_at || "") +
        "</div></div>"
      );
    })
    .join("");
}

app.loadFinanceDrawerLedger = async function (driverId) {
  var root = document.getElementById("financeDrawerLedger");
  if (root) root.innerHTML = '<div class="finance-msg">جارٍ تحميل السجل…</div>';
  try {
    var j = await app.PlatformAPI.api(
      "/api/admin/driver-ledger/" + encodeURIComponent(driverId)
    );
    app.financeDrawerLedgerCache = j.entries || [];
    var d = app.getFinanceDriver(driverId);
    if (d && j.operations_count != null) {
      d.operations_count = Number(j.operations_count) || d.operations_count;
    }
    if (d) {
      for (var li = 0; li < app.financeDrawerLedgerCache.length; li++) {
        var ent = app.financeDrawerLedgerCache[li];
        if (String(ent.type || "").toLowerCase() === "payout") {
          var lr = app.financeExtractReceiptRef(ent.meta);
          if (lr) {
            d.last_receipt_reference = lr;
            break;
          }
        }
      }
    }
    app.renderFinanceDrawerLedger(app.financeDrawerLedgerCache);
    if (d) app.showFinanceReceiptRef(d.last_receipt_reference || null);
    return j;
  } catch (e) {
    if (root) {
      root.innerHTML =
        '<div class="finance-msg finance-msg--error">' +
        app.escapeHtml(e.message || "تعذّر تحميل السجل") +
        "</div>";
    }
    return null;
  }
}

app.syncFinanceDrawerMeta = function (d) {
  var meta = document.getElementById("financeDrawerMeta");
  var hint = document.getElementById("financeCollectHint");
  var amtInput = document.getElementById("financeCollectAmount");
  if (!d) return;
  var bal = Number(d.balance) || 0;
  var risk = app.financeRiskLevel(d);
  var riskAr = risk === "danger" ? "دين عالي" : risk === "warn" ? "قريب من الحد" : "طبيعي";
  if (meta) {
    meta.innerHTML =
      "<div><strong>الرصيد المستحق:</strong> " +
      app.fmtMoney(bal) +
      "</div>" +
      "<div><strong>العمليات:</strong> " +
      String(d.operations_count || 0) +
      "</div>" +
      "<div><strong>مستوى المخاطر:</strong> " +
      riskAr +
      "</div>" +
      "<div><strong>حد الحظر:</strong> " +
      app.fmtMoney(app.financeDebtLimit) +
      "</div>" +
      "<div><strong>تنبيه واتساب:</strong> " +
      app.escapeHtml(app.financeNotifyStatusText(d)) +
      "</div>";
  }
  if (amtInput) amtInput.value = bal > 0 ? String(bal) : "";
  if (amtInput) amtInput.max = bal > 0 ? String(bal) : "";
  if (hint) {
    hint.textContent =
      bal > 0
        ? "يمكنك تحصيل جزء أو كامل المبلغ (حد أقصى " +
        app.fmtMoney(bal) +
        "). المبالغ تُقرَّب إلى هللتين."
        : "لا يوجد رصيد مستحق للتحصيل.";
  }
  var collectBtn = document.getElementById("financeCollectBtn");
  if (collectBtn) collectBtn.disabled = bal <= 0;
  var remindBtn = document.getElementById("financeRemindBtn");
  if (remindBtn) remindBtn.disabled = bal <= 0;
  app.showFinanceReceiptRef(d.last_receipt_reference || null);
  app.updateFinanceRoundingHint();
}

app.financeNotifyStatusText = function (d) {
  var st = String((d && d.notify_status) || "").toLowerCase();
  if (st === "sent") {
    return (
      "تم الإرسال اليوم (" +
      (d.notify_kind === "threshold" ? "حد " + app.financeAlertThreshold : "بعد تسليم") +
      ")"
    );
  }
  if (st === "failed") return "فشل الإرسال — راجع إشعارات المندوبين";
  if (st === "pending") return "قيد الإرسال";
  if (d && d.alert_balance && (Number(d.balance) || 0) > 0) {
    return "لم يُرسل بعد — الرصيد فوق " + app.financeAlertThreshold + " ر.س";
  }
  return "لا ينطبق / لم يُرسل اليوم";
}

app.loadFinanceDailyReport = async function () {
  var grid = document.getElementById("financeDailyReportGrid");
  if (!grid || !app.hasPermission("finance")) return;
  try {
    var j = await app.PlatformAPI.api("/api/admin/smart-collection-daily-report");
    var r = j.report || {};
    app.financeLastDailyReport = r;
    if (typeof console !== "undefined" && console.log) {
      console.log("[Smart Collection] تقرير اليوم", r);
    }
    grid.innerHTML =
      "<div><span>عمولات اليوم</span><strong>" +
      app.fmtMoney(r.commissions_accrued_today || 0) +
      "</strong></div>" +
      "<div><span>تحصيلات اليوم</span><strong>" +
      app.fmtMoney(r.collections_today || 0) +
      "</strong></div>" +
      "<div><span>تنبيهات واتساب</span><strong>" +
      String(r.driver_notifications_sent || 0) +
      " ✓ / " +
      String(r.driver_notifications_failed || 0) +
      " ✗</strong></div>" +
      "<div><span>فوق حد التنبيه</span><strong>" +
      String(r.drivers_above_alert || 0) +
      " مندوب</strong></div>" +
      "<div><span>عمليات السجل</span><strong>" +
      String(r.ledger_operations_today || 0) +
      "</strong></div>" +
      "<div><span>إجمالي الديون</span><strong>" +
      app.fmtMoney(r.total_debt || 0) +
      "</strong></div>";
  } catch (e) {
    grid.innerHTML =
      '<div class="finance-msg finance-msg--error">' +
      app.escapeHtml(e.message || "تعذّر تحميل التقرير") +
      "</div>";
  }
}

app.exportFinanceDailyReportCsv = function () {
  var r = app.financeLastDailyReport;
  if (!r || !r.date) {
    if (typeof showError === "function") app.showError("حمّل التقرير أولاً");
    return;
  }
  var rows = [
    ["الحقل", "القيمة"],
    ["التاريخ", r.date],
    ["المنطقة الزمنية", r.timezone || "Asia/Riyadh"],
    ["إجمالي الديون", r.total_debt],
    ["مندوبون بمستحق", r.drivers_with_debt],
    ["محظورون", r.blocked_drivers],
    ["فوق حد التنبيه", r.drivers_above_alert],
    ["عمولات اليوم", r.commissions_accrued_today],
    ["تحصيلات اليوم", r.collections_today],
    ["عمليات السجل اليوم", r.ledger_operations_today],
    ["تنبيهات واتساب ناجحة", r.driver_notifications_sent],
    ["تنبيهات فاشلة", r.driver_notifications_failed],
    ["حد التنبيه", r.alert_threshold],
    ["حد الحظر", r.debt_limit],
  ];
  var csv = rows
    .map(function (row) {
      return row
        .map(function (cell) {
          var s = String(cell == null ? "" : cell);
          if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
          return s;
        })
        .join(",");
    })
    .join("\n");
  var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "smart-collection-" + r.date + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

app.openFinanceBulkModal = function (owing, total) {
  app.financeBulkPending = { drivers: owing, total: total };
  var backdrop = document.getElementById("financeBulkModalBackdrop");
  var s1 = document.getElementById("financeBulkStep1");
  var s2 = document.getElementById("financeBulkStep2");
  var summary = document.getElementById("financeBulkSummary");
  var label = document.getElementById("financeBulkConfirmLabel");
  var chk = document.getElementById("financeBulkConfirmCheck");
  if (summary) {
    summary.innerHTML =
      "<div><strong>عدد المندوبين:</strong> " +
      owing.length +
      "</div>" +
      "<div><strong>إجمالي المبلغ:</strong> " +
      app.fmtMoney(app.roundMoney2(total)) +
      "</div>" +
      '<div class="muted" style="margin-top:8px;font-size:.85rem">يُنشأ <strong>مرجع إيصال</strong> مستقل لكل مندوب.</div>';
  }
  if (label) {
    label.innerText =
      "أؤكد تحصيل " + owing.length + " مندوب بإجمالي " + app.fmtMoney(app.roundMoney2(total));
  }
  if (chk) chk.checked = false;
  var execBtn = document.getElementById("financeBulkExecBtn");
  if (execBtn) execBtn.disabled = true;
  if (s1) s1.hidden = false;
  if (s2) s2.hidden = true;
  if (backdrop) backdrop.hidden = false;
}

app.closeFinanceBulkModal = function () {
  var backdrop = document.getElementById("financeBulkModalBackdrop");
  if (backdrop) backdrop.hidden = true;
  app.financeBulkPending = null;
}

app.runBulkCollectExec = async function () {
  if (!app.financeBulkPending || app.financeCollectAllBusy) return;
  var owing = app.financeBulkPending.drivers || [];
  app.closeFinanceBulkModal();
  app.financeCollectAllBusy = true;
  var btn = document.getElementById("financeCollectAllBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "جارٍ تحصيل الكل…";
  }
  var ok = 0;
  var failN = 0;
  for (var i = 0; i < owing.length; i++) {
    var d = owing[i];
    var v = app.validateFinanceCollectAmount(d.balance, d.balance);
    if (!v.ok) {
      failN += 1;
      continue;
    }
    var amt = v.amount;
    try {
      var j = await app.PlatformAPI.api("/api/admin/collect", {
        method: "POST",
        body: {
          driver_id: d.driver_id,
          amount: amt,
          note: "تحصيل الكل — Smart Collection",
        },
      });
      app.patchFinanceDriver(d.driver_id, {
        balance: app.roundMoney2(j.balance_after != null ? j.balance_after : 0),
        debt_blocked: !!j.debt_blocked,
        last_receipt_reference: j.receipt_reference || null,
      });
      ok += 1;
    } catch (_e) {
      failN += 1;
    }
  }
  app.updateFinanceKpis();
  app.renderFinanceTable();
  await app.loadFinanceDailyReport();
  if (app.financeDrawerDriverId) {
    var openD = app.getFinanceDriver(app.financeDrawerDriverId);
    if (openD) {
      app.syncFinanceDrawerMeta(openD);
      await app.loadFinanceDrawerLedger(app.financeDrawerDriverId);
    }
  }
  if (typeof showSuccess === "function") {
    app.showSuccess("تحصيل الكل: نجح " + ok + (failN ? " — فشل " + failN : ""));
  }
  app.financeCollectAllBusy = false;
  if (btn) {
    btn.disabled = false;
    btn.innerText = "تحصيل الكل";
  }
}

app.collectAllFinanceDebts = async function () {
  if (app.financeCollectAllBusy) return;
  var owing = app.cacheFinanceDrivers.filter(function (d) {
    return (Number(d.balance) || 0) > 0;
  });
  if (!owing.length) {
    if (typeof showError === "function") app.showError("لا يوجد مندوبون بمستحقات للتحصيل");
    return;
  }
  var total = owing.reduce(function (s, d) {
    return s + (Number(d.balance) || 0);
  }, 0);
  app.openFinanceBulkModal(owing, total);
}

app.sendFinanceReminder = async function (driverId) {
  if (!driverId) return;
  var d = app.getFinanceDriver(driverId);
  if (!d || (Number(d.balance) || 0) <= 0) {
    if (typeof showError === "function") app.showError("لا يوجد رصيد مستحق للتذكير");
    return;
  }
  if (!confirm("إرسال تذكير واتساب إلى " + (d.name || "المندوب") + "؟")) return;
  try {
    await app.PlatformAPI.api("/api/admin/smart-collection-remind", {
      method: "POST",
      body: { driver_id: driverId },
    });
    if (typeof showSuccess === "function") {
      app.showSuccess("تم إرسال التذكير عبر واتساب");
    }
    await app.loadFinancePanel();
  } catch (e) {
    if (typeof showError === "function") app.showError(e.message || "فشل إرسال التذكير");
  }
}

app.openFinanceDrawer = async function (driverId, focusCollect) {
  if (!driverId) return;
  var d = app.getFinanceDriver(driverId);
  if (!d) return;
  app.financeDrawerDriverId = driverId;
  var backdrop = document.getElementById("financeDrawerBackdrop");
  var title = document.getElementById("financeDrawerTitle");
  var phone = document.getElementById("financeDrawerPhone");
  if (title) title.innerText = d.name || "مندوب";
  if (phone) phone.innerText = d.phone || "—";
  app.syncFinanceDrawerMeta(d);
  if (backdrop) backdrop.hidden = false;
  await app.loadFinanceDrawerLedger(driverId);
  if (focusCollect) {
    var inp = document.getElementById("financeCollectAmount");
    if (inp) inp.focus();
  }
}

app.submitFinanceCollect = async function () {
  var driverId = app.financeDrawerDriverId;
  if (!driverId) return;
  var d = app.getFinanceDriver(driverId);
  var inp = document.getElementById("financeCollectAmount");
  var btn = document.getElementById("financeCollectBtn");
  var maxBal = d ? Number(d.balance) || 0 : 0;
  var v = app.validateFinanceCollectAmount(inp && inp.value, maxBal);
  if (!v.ok) {
    if (typeof showError === "function") app.showError(v.message || "مبلغ غير صالح");
    return;
  }
  var amount = v.amount;
  if (
    !confirm(
      "تحصيل " +
        app.fmtMoney(amount) +
        " من " +
        (d.name || "المندوب") +
        "؟\nسيُولَّد مرجع إيصال يُحفظ في السجل."
    )
  ) {
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = "جارٍ التحصيل…";
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/collect", {
      method: "POST",
      body: {
        driver_id: driverId,
        amount: amount,
        note: "تحصيل من Finance Control Panel",
      },
    });
    var after = app.roundMoney2(j.balance_after != null ? j.balance_after : 0);
    var blocked = !!j.debt_blocked;
    var ref = j.receipt_reference || null;
    app.patchFinanceDriver(driverId, {
      balance: after,
      debt_blocked: blocked,
      last_receipt_reference: ref,
    });
    app.showFinanceReceiptRef(ref);
    app.updateFinanceKpis();
    app.renderFinanceTable();
    app.syncFinanceDrawerMeta(app.getFinanceDriver(driverId));
    await app.loadFinanceDrawerLedger(driverId);
    await app.loadFinanceDailyReport();
    if (typeof showSuccess === "function") {
      var msg = "تم التحصيل — الرصيد المتبقي: " + app.fmtMoney(after);
      if (ref) msg += " | إيصال: " + ref;
      app.showSuccess(msg);
    }
  } catch (e) {
    if (typeof showError === "function") app.showError(e.message || "فشل التحصيل");
    else alert(e.message || "فشل التحصيل");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "تحصيل";
      var left = app.getFinanceDriver(driverId);
      if (left && (Number(left.balance) || 0) <= 0) btn.disabled = true;
    }
  }
}

app.setupFinanceDrawerUi = function () {
  var closeBtn = document.getElementById("financeDrawerCloseBtn");
  if (closeBtn) closeBtn.onclick = closeFinanceDrawer;
  var backdrop = document.getElementById("financeDrawerBackdrop");
  if (backdrop) {
    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) app.closeFinanceDrawer();
    });
  }
  var collectBtn = document.getElementById("financeCollectBtn");
  if (collectBtn) collectBtn.onclick = submitFinanceCollect;
  var collectAllBtn = document.getElementById("financeCollectAllBtn");
  if (collectAllBtn) collectAllBtn.onclick = collectAllFinanceDebts;
  var copyRefBtn = document.getElementById("financeReceiptCopyBtn");
  if (copyRefBtn) copyRefBtn.onclick = copyFinanceReceiptRef;
  var remindBtn = document.getElementById("financeRemindBtn");
  if (remindBtn) {
    remindBtn.onclick = function () {
      if (app.financeDrawerDriverId) app.sendFinanceReminder(app.financeDrawerDriverId);
    };
  }
  var amtInp = document.getElementById("financeCollectAmount");
  if (amtInp) {
    amtInp.addEventListener("input", updateFinanceRoundingHint);
    amtInp.addEventListener("change", updateFinanceRoundingHint);
  }
  var exportBtn = document.getElementById("financeExportCsvBtn");
  if (exportBtn) exportBtn.onclick = exportFinanceDailyReportCsv;
  var bulkCancel = document.getElementById("financeBulkCancelBtn");
  if (bulkCancel) bulkCancel.onclick = closeFinanceBulkModal;
  var bulkNext = document.getElementById("financeBulkNextBtn");
  if (bulkNext) {
    bulkNext.onclick = function () {
      var s1 = document.getElementById("financeBulkStep1");
      var s2 = document.getElementById("financeBulkStep2");
      if (s1) s1.hidden = true;
      if (s2) s2.hidden = false;
    };
  }
  var bulkBack = document.getElementById("financeBulkBackBtn");
  if (bulkBack) {
    bulkBack.onclick = function () {
      var s1 = document.getElementById("financeBulkStep1");
      var s2 = document.getElementById("financeBulkStep2");
      if (s1) s1.hidden = false;
      if (s2) s2.hidden = true;
    };
  }
  var bulkChk = document.getElementById("financeBulkConfirmCheck");
  var bulkExec = document.getElementById("financeBulkExecBtn");
  if (bulkChk && bulkExec) {
    bulkChk.onchange = function () {
      bulkExec.disabled = !bulkChk.checked;
    };
    bulkExec.onclick = runBulkCollectExec;
  }
  var bulkBackdrop = document.getElementById("financeBulkModalBackdrop");
  if (bulkBackdrop) {
    bulkBackdrop.addEventListener("click", function (ev) {
      if (ev.target === bulkBackdrop) app.closeFinanceBulkModal();
    });
  }
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      if (app.financeDrawerDriverId) app.closeFinanceDrawer();
      app.closeFinanceBulkModal();
    }
  });
}

app.loadFinancePanel = async function () {
  if (!app.hasPermission("finance") || app.financeLoadBusy) return;
  app.financeLoadBusy = true;
  var tbody = document.getElementById("financeTableBody");
  var hint = document.getElementById("financePanelHint");
  if (tbody && !app.cacheFinanceDrivers.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="finance-msg">جارٍ التحميل…</td></tr>';
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/driver-debts");
    if (j.debt_limit != null) app.financeDebtLimit = Number(j.debt_limit) || app.financeDebtLimit;
    if (j.summary && j.summary.debt_limit != null) {
      app.financeDebtLimit = Number(j.summary.debt_limit) || app.financeDebtLimit;
    }
    if (j.summary && j.summary.alert_threshold != null) {
      app.financeAlertThreshold = Number(j.summary.alert_threshold) || app.financeAlertThreshold;
    }
    if (j.smart_collection && j.smart_collection.alert_threshold != null) {
      app.financeAlertThreshold = Number(j.smart_collection.alert_threshold) || app.financeAlertThreshold;
    }
    var thLbl = document.getElementById("financeAlertThresholdLabel");
    if (thLbl) thLbl.innerText = String(app.financeAlertThreshold);
    app.cacheFinanceDrivers = (j.drivers || []).map(normalizeFinanceRow);
    if (hint) {
      hint.textContent =
        "حد الحظر: " +
        app.fmtMoney(app.financeDebtLimit) +
        " | تنبيه المندوب عند " +
        app.financeAlertThreshold +
        " ر.س — أحمر/برتقالي/أخضر حسب المخاطر. اضغط الصف للسجل.";
    }
    app.updateFinanceKpis();
    app.renderFinanceTable();
    await app.loadFinanceDailyReport();
    if (app.financeDrawerDriverId) {
      var openD = app.getFinanceDriver(app.financeDrawerDriverId);
      if (openD) app.syncFinanceDrawerMeta(openD);
    }
  } catch (e) {
    if (hint) hint.textContent = e.message || "تعذّر تحميل البيانات المالية";
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="finance-msg finance-msg--error">' +
        app.escapeHtml(e.message || "تعذّر التحميل") +
        "</td></tr>";
    }
  } finally {
    app.financeLoadBusy = false;
  }
}

app.loadTreasury = async function () {
  var hint = document.getElementById("treasuryHint");
  var panel = document.getElementById("treasuryPanel");
  if (!panel || !app.hasPermission("finance")) return;
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }
  try {
    var j = await app.PlatformAPI.api("/api/admin/platform-treasury");
    var t = j.treasury || {};
    document.getElementById("trPlatformAcc").innerText = app.fmtMoney(t.platform_accounting_balance);
    document.getElementById("trErvSum").innerText = app.fmtMoney(t.ervenow_operational_balance_sum);
    document.getElementById("trStoreSum").innerText = app.fmtMoney(t.store_wallets_balance_sum);
    document.getElementById("trPendingWd").innerText = app.fmtMoney(t.pending_withdraw_requests_sum);
    document.getElementById("trTotalRef").innerText = app.fmtMoney(t.circulating_reference_total);
    var ec = document.getElementById("trErvCnt");
    if (ec) ec.innerText = String(t.ervenow_wallets_count != null ? t.ervenow_wallets_count : 0);
    var sc = document.getElementById("trStoreCnt");
    if (sc) sc.innerText = String(t.store_wallets_count != null ? t.store_wallets_count : 0);
  } catch (e) {
    if (hint) {
      hint.style.display = "block";
      hint.textContent = e.message || "تعذر تحميل محفظة المنصة — تحقق من الهجرة أو الصلاحيات";
    }
  }
}
