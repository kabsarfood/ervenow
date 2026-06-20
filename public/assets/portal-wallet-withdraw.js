/**
 * ERVENOW — سحب المحفظة داخل البوابات (OTP) — نموذج موحّد
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderWithdrawPanel(opts) {
    opts = opts || {};
    var prefix = String(opts.prefix || "pf");
    var minAmt = Number(opts.minAmount) || 20;
    return (
      '<div class="' +
      prefix +
      '-card ' +
      prefix +
      '-form" id="' +
      prefix +
      'WithdrawForm">' +
      "<h3>طلب سحب</h3>" +
      "<label>المبلغ (ريال)</label>" +
      '<input type="number" id="' +
      prefix +
      'WdAmount" min="' +
      minAmt +
      '" step="0.01" inputmode="decimal" />' +
      "<label>رقم الآيبان (SA…)</label>" +
      '<input type="text" id="' +
      prefix +
      'WdIban" autocomplete="off" translate="no" />' +
      '<label style="display:none" id="' +
      prefix +
      'WdOtpWrap">رمز التحقق (OTP)</label>' +
      '<input type="text" id="' +
      prefix +
      'WdOtp" style="display:none" inputmode="numeric" maxlength="6" translate="no" />' +
      '<p class="' +
      prefix +
      '-muted" id="' +
      prefix +
      'WdMsg"></p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button type="button" class="' +
      prefix +
      '-btn ' +
      prefix +
      '-btn--primary" id="' +
      prefix +
      'WdSendOtp">إرسال رمز التحقق</button>' +
      '<button type="button" class="' +
      prefix +
      '-btn ' +
      prefix +
      '-btn--ghost" id="' +
      prefix +
      'WdConfirm" style="display:none">تأكيد السحب</button>' +
      "</div></div>"
    );
  }

  function wireWithdrawPanel(opts) {
    opts = opts || {};
    var prefix = String(opts.prefix || "pf");
    var minAmt = Number(opts.minAmount) || 20;
    var onMsg = typeof opts.onMessage === "function" ? opts.onMessage : function () {};
    var onDone = typeof opts.onSuccess === "function" ? opts.onSuccess : function () {};

    var sendBtn = document.getElementById(prefix + "WdSendOtp");
    var confirmBtn = document.getElementById(prefix + "WdConfirm");
    var otpWrap = document.getElementById(prefix + "WdOtpWrap");
    var otpInput = document.getElementById(prefix + "WdOtp");
    var msgEl = document.getElementById(prefix + "WdMsg");

    function setMsg(text, ok) {
      if (msgEl) msgEl.textContent = text || "";
      onMsg(text, ok);
    }

    if (!sendBtn || !global.PlatformAPI) return;

    sendBtn.onclick = async function () {
      var amt = Number(document.getElementById(prefix + "WdAmount").value);
      var iban = String(document.getElementById(prefix + "WdIban").value || "").trim();
      if (!Number.isFinite(amt) || amt < minAmt) {
        setMsg("الحد الأدنى للسحب " + minAmt + " ر.س", false);
        return;
      }
      if (!/^SA/i.test(iban) || iban.length < 15) {
        setMsg("أدخل رقم آيبان صحيح يبدأ بـ SA", false);
        return;
      }
      sendBtn.disabled = true;
      setMsg("جارٍ إرسال رمز التحقق…", true);
      try {
        await global.PlatformAPI.api("/api/wallet/withdraw/send-otp", {
          method: "POST",
          body: { amount: amt, iban: iban },
        });
        if (otpWrap) otpWrap.style.display = "";
        if (otpInput) otpInput.style.display = "";
        if (confirmBtn) confirmBtn.style.display = "";
        setMsg("تم إرسال رمز التحقق إلى جوالك", true);
      } catch (e) {
        setMsg(e.message || String(e), false);
        sendBtn.disabled = false;
      }
    };

    if (confirmBtn) {
      confirmBtn.onclick = async function () {
        var amt = Number(document.getElementById(prefix + "WdAmount").value);
        var iban = String(document.getElementById(prefix + "WdIban").value || "").trim();
        var otp = String((otpInput && otpInput.value) || "").trim();
        if (!otp) {
          setMsg("أدخل رمز التحقق", false);
          return;
        }
        confirmBtn.disabled = true;
        setMsg("جارٍ تأكيد السحب…", true);
        try {
          await global.PlatformAPI.api("/api/wallet/withdraw/confirm-otp", {
            method: "POST",
            body: { amount: amt, iban: iban, otp: otp },
          });
          setMsg("تم تقديم طلب السحب بنجاح", true);
          onDone();
        } catch (e) {
          setMsg(e.message || String(e), false);
          confirmBtn.disabled = false;
        }
      };
    }
  }

  global.ErvenowPortalWalletWithdraw = {
    renderWithdrawPanel: renderWithdrawPanel,
    wireWithdrawPanel: wireWithdrawPanel,
    fmtMoney: fmtMoney,
    esc: esc,
  };
})(typeof window !== "undefined" ? window : globalThis);
