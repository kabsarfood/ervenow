/** Admin — مركز الإعلانات (Broadcast) */
import { app } from "./shared.js";

var lastBroadcastResult = null;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return app.fmtWhen ? app.fmtWhen(iso) : new Date(iso).toLocaleString("ar-SA");
  } catch (_e) {
    return String(iso);
  }
}

app.renderBroadcastPanel = function () {
  var root = document.getElementById("broadcastPanelForm");
  if (!root) return;
  root.innerHTML =
    '<div class="broadcast-form">' +
    '<label class="broadcast-field"><span>العنوان</span>' +
    '<input type="text" id="broadcastTitle" class="search-input" maxlength="120" placeholder="عنوان الإعلان" style="width:100%;font-size:16px" /></label>' +
    '<label class="broadcast-field"><span>الرسالة</span>' +
    '<textarea id="broadcastMessage" class="search-input" rows="4" maxlength="500" placeholder="نص الإعلان للمستخدمين" style="width:100%;font-size:16px"></textarea></label>' +
    '<label class="broadcast-field"><span>الفئة</span>' +
    '<select id="broadcastCategory" class="search-input" style="width:100%;font-size:16px">' +
    '<option value="announcement">إعلان</option>' +
    '<option value="alert">تنبيه</option>' +
    '<option value="development">تطوير</option>' +
    '<option value="maintenance">صيانة</option>' +
    '<option value="offer">عرض</option>' +
    "</select></label>" +
    '<label class="broadcast-field"><span>الاستهداف</span>' +
    '<select id="broadcastTarget" class="search-input" style="width:100%;font-size:16px">' +
    '<option value="all">الجميع</option>' +
    '<option value="everyone">الجميع (قديم)</option>' +
    '<option value="customers">العملاء</option>' +
    '<option value="drivers">السائقون</option>' +
    '<option value="merchants">التجار</option>' +
    '<option value="services">مزودو الخدمات</option>' +
    '<option value="providers">مزودو الخدمات (قديم)</option>' +
    '<option value="transport">النقل</option>' +
    "</select></label>" +
    '<button type="button" class="btn btn-primary" id="sendBroadcastBtn" style="margin-top:12px;min-height:48px">📢 إرسال الإعلان</button>' +
    '<p class="ledger-tx-updated" id="broadcastPanelStatus" style="margin-top:10px">—</p>' +
    '<div id="broadcastLastResult" hidden></div>' +
    "</div>" +
    '<div class="card" style="margin-top:16px" id="broadcastAnalyticsWrap">' +
    "<h4 style=\"margin:0 0 10px\">إحصائيات البث</h4>" +
    '<div class="grid" id="broadcastAnalyticsKpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:12px"></div>' +
    "<h4 style=\"margin:12px 0 8px\">Broadcast History</h4>" +
    '<div id="broadcastHistoryList"></div>' +
    "</div>";

  var sendBtn = document.getElementById("sendBroadcastBtn");
  if (sendBtn) {
    sendBtn.onclick = app.safeClick(app.sendBroadcastFromPanel);
  }
};

app.renderBroadcastAnalytics = function (data) {
  var kpiRoot = document.getElementById("broadcastAnalyticsKpis");
  var histRoot = document.getElementById("broadcastHistoryList");
  if (!kpiRoot || !histRoot) return;
  var totals = (data && data.totals) || {};
  var cards = [
    ["مرسلة", totals.sent || 0],
    ["مقروء", totals.read || 0],
    ["غير مقروء", totals.unread || 0],
    ["نسبة القراءة", (totals.read_rate != null ? totals.read_rate : 0) + "%"],
  ];
  kpiRoot.innerHTML = cards
    .map(function (pair) {
      return (
        '<div class="card" style="margin:0;padding:12px"><div class="sub">' +
        esc(pair[0]) +
        '</div><div class="stat">' +
        esc(pair[1]) +
        "</div></div>"
      );
    })
    .join("");

  var broadcasts = (data && data.broadcasts) || [];
  var history = (data && data.history) || [];
  var rows = broadcasts.length ? broadcasts : history;
  if (!rows.length) {
    histRoot.innerHTML = '<p class="ledger-tx-updated">لا يوجد سجل بث بعد.</p>';
    return;
  }
  histRoot.innerHTML =
    '<div class="finance-table-wrap"><table class="finance-table" aria-label="سجل البث">' +
    "<thead><tr><th>العنوان</th><th>الاستهداف</th><th>مرسل</th><th>مقروء</th><th>القراءة</th><th>التاريخ</th></tr></thead><tbody>" +
    rows
      .map(function (b) {
        var sent = b.sent != null ? b.sent : b.recipients || 0;
        var read = b.read != null ? b.read : "—";
        var rate = b.read_rate != null ? b.read_rate + "%" : "—";
        return (
          "<tr><td>" +
          esc(b.title || "—") +
          "</td><td>" +
          esc(b.target || "—") +
          "</td><td>" +
          esc(sent) +
          "</td><td>" +
          esc(read) +
          "</td><td>" +
          esc(rate) +
          "</td><td>" +
          fmtWhen(b.created_at || b.at) +
          "</td></tr>"
        );
      })
      .join("") +
    "</tbody></table></div>";
};

app.loadBroadcastAnalytics = async function () {
  try {
    var data = await app.PlatformAPI.api("/api/admin/broadcast/analytics");
    app.renderBroadcastAnalytics(data);
  } catch (e) {
    var histRoot = document.getElementById("broadcastHistoryList");
    if (histRoot) histRoot.innerHTML = '<p class="item">' + esc(e.message || "فشل تحميل الإحصائيات") + "</p>";
  }
};

app.loadBroadcastPanel = async function () {
  app.renderBroadcastPanel();
  var hint = document.getElementById("broadcastPanelHint");
  if (hint) hint.textContent = "أرسل إعلاناً يظهر في مركز الإشعارات لدى المستهدفين.";
  if (lastBroadcastResult) {
    var box = document.getElementById("broadcastLastResult");
    if (box) {
      box.hidden = false;
      box.innerHTML =
        "<p class='ledger-tx-updated'>آخر إرسال: " +
        esc(lastBroadcastResult.sent) +
        " / " +
        esc(lastBroadcastResult.recipients) +
        " مستلم</p>";
    }
  }
  await app.loadBroadcastAnalytics();
};

app.sendBroadcastFromPanel = async function () {
  var title = String(document.getElementById("broadcastTitle")?.value || "").trim();
  var message = String(document.getElementById("broadcastMessage")?.value || "").trim();
  var category = String(document.getElementById("broadcastCategory")?.value || "announcement");
  var target = String(document.getElementById("broadcastTarget")?.value || "everyone");
  var status = document.getElementById("broadcastPanelStatus");
  var btn = document.getElementById("sendBroadcastBtn");

  if (!title) {
    if (status) status.textContent = "العنوان مطلوب.";
    return;
  }
  if (!message) {
    if (status) status.textContent = "الرسالة مطلوبة.";
    return;
  }
  if (btn) btn.disabled = true;
  if (status) status.textContent = "جاري الإرسال…";

  try {
    var res = await app.PlatformAPI.api("/api/admin/broadcast", {
      method: "POST",
      body: { title: title, message: message, category: category, target: target },
    });
    lastBroadcastResult = res || {};
    if (status) {
      status.textContent =
        "تم الإرسال: " +
        String(res.sent || 0) +
        " إشعار من أصل " +
        String(res.recipients || 0) +
        " مستهدف.";
    }
    app.showSuccess("تم إرسال الإعلان بنجاح");
    var box = document.getElementById("broadcastLastResult");
    if (box) {
      box.hidden = false;
      box.innerHTML =
        "<p class='ledger-tx-updated'>معرّف البث: " +
        esc(res.broadcast_id || "—") +
        " · فشل: " +
        esc(res.failed || 0) +
        "</p>";
    }
    await app.loadBroadcastAnalytics();
  } catch (e) {
    if (status) status.textContent = e.message || "تعذّر الإرسال";
    app.showError(e.message || "تعذّر الإرسال");
  } finally {
    if (btn) btn.disabled = false;
  }
};
