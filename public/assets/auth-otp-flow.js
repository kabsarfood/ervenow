/**
 * تدفق OTP موحّد: زر واحد (إرسال الرمز ← تسجيل الدخول) + إظهار حقل الرمز بعد الإرسال + تركيز تلقائي
 */
(function (global) {
  function el(id) {
    return id ? document.getElementById(id) : null;
  }

  function textOf(fnOrStr, fallback) {
    if (typeof fnOrStr === "function") return fnOrStr();
    if (fnOrStr != null && fnOrStr !== "") return String(fnOrStr);
    return fallback;
  }

  function mount(cfg) {
    cfg = cfg || {};
    var phoneEl = el(cfg.phoneId);
    var codeEl = el(cfg.codeId);
    var btn = el(cfg.btnId);
    var codeGroup = cfg.codeGroupId ? el(cfg.codeGroupId) : null;
    var introEl = cfg.introId ? el(cfg.introId) : null;
    if (!phoneEl || !codeEl || !btn) return null;

    var otpSent = false;
    var lastPhone = "";
    var locked = false;

    var labels = Object.assign(
      {
        send: "إرسال الرمز",
        verify: "تسجيل الدخول",
        sending: "جارٍ الإرسال…",
        verifying: "جارٍ التحقق…",
      },
      cfg.labels || {}
    );

    function phoneValid() {
      if (typeof cfg.phoneValid === "function") {
        return cfg.phoneValid(phoneEl.value, phoneEl);
      }
      return true;
    }

    function runNormalize() {
      if (typeof cfg.normalizePhone === "function") {
        return cfg.normalizePhone(phoneEl);
      }
      return (phoneEl.value || "").trim();
    }

    function focusCode() {
      if (!codeEl) return;
      try {
        codeEl.focus({ preventScroll: false });
        if (typeof codeEl.select === "function") codeEl.select();
      } catch (e) {
        codeEl.focus();
      }
    }

    function updateIntro(isVerify) {
      if (!introEl) return;
      if (isVerify) {
        introEl.textContent = textOf(cfg.introVerify, introEl.textContent);
      } else {
        introEl.textContent = textOf(cfg.introSend, introEl.textContent);
      }
    }

    function setStep(isVerify) {
      otpSent = !!isVerify;
      if (isVerify) {
        btn.textContent = textOf(labels.verify, "تسجيل الدخول");
        btn.disabled = false;
        if (codeGroup) codeGroup.hidden = false;
        updateIntro(true);
        global.requestAnimationFrame(function () {
          focusCode();
        });
      } else {
        btn.textContent = textOf(labels.send, "إرسال الرمز");
        btn.disabled = !phoneValid();
        if (codeGroup) codeGroup.hidden = true;
        updateIntro(false);
      }
    }

    function resetFromPhoneChange() {
      var cur = runNormalize();
      if (otpSent && cur !== lastPhone) {
        lastPhone = "";
        codeEl.value = "";
        setStep(false);
      } else if (!otpSent) {
        btn.disabled = !phoneValid();
      }
    }

    phoneEl.addEventListener("input", resetFromPhoneChange);
    phoneEl.addEventListener("blur", resetFromPhoneChange);

    phoneEl.addEventListener("keydown", function (e) {
      if (typeof cfg.isActive === "function" && !cfg.isActive()) return;
      if (e.key === "Enter" && !otpSent && phoneValid()) {
        e.preventDefault();
        btn.click();
      }
    });

    codeEl.addEventListener("keydown", function (e) {
      if (typeof cfg.isActive === "function" && !cfg.isActive()) return;
      if (e.key === "Enter" && otpSent) {
        e.preventDefault();
        btn.click();
      }
    });

    codeEl.addEventListener("input", function () {
      if (!otpSent || !cfg.devDirectBtnId) return;
      var v = String(codeEl.value || "").trim();
      if (v.length >= 4 && typeof cfg.onDevCodeReady === "function") {
        cfg.onDevCodeReady(codeEl, phoneEl, v);
      }
    });

    btn.addEventListener("click", async function () {
      if (typeof cfg.isActive === "function" && !cfg.isActive()) return;
      if (locked) return;
      locked = true;
      try {
        runNormalize();
        if (!otpSent) {
          if (!phoneValid()) {
            if (typeof cfg.onPhoneInvalid === "function") cfg.onPhoneInvalid(phoneEl);
            return;
          }
          var sendLabel = textOf(labels.send, "إرسال الرمز");
          btn.disabled = true;
          btn.textContent = textOf(labels.sending, "جارٍ الإرسال…");
          try {
            await cfg.onSend(phoneEl, codeEl);
            lastPhone = runNormalize();
            setStep(true);
          } catch (e) {
            btn.disabled = !phoneValid();
            btn.textContent = sendLabel;
            throw e;
          }
        } else {
          if (typeof cfg.onVerifyNeedsCode === "function" && !cfg.onVerifyNeedsCode(codeEl)) {
            return;
          }
          var verifyLabel = textOf(labels.verify, "تسجيل الدخول");
          btn.disabled = true;
          btn.textContent = textOf(labels.verifying, "جارٍ التحقق…");
          try {
            await cfg.onVerify(phoneEl, codeEl);
          } catch (e) {
            btn.disabled = false;
            btn.textContent = verifyLabel;
            focusCode();
            throw e;
          }
        }
      } finally {
        locked = false;
      }
    });

    setStep(false);

    function openDevCodeStep() {
      runNormalize();
      if (!phoneValid()) {
        if (typeof cfg.onPhoneInvalid === "function") cfg.onPhoneInvalid(phoneEl);
        return;
      }
      codeEl.value = "";
      codeEl.setAttribute("autocomplete", "off");
      codeEl.setAttribute("autocorrect", "off");
      codeEl.setAttribute("spellcheck", "false");
      setStep(true);
      if (typeof cfg.onDevCodeStep === "function") {
        cfg.onDevCodeStep(codeEl, phoneEl);
      }
      focusCode();
    }

    function runDevDirectLogin() {
      openDevCodeStep();
    }

    if (cfg.devDirectBtnId) {
      var devBtn = el(cfg.devDirectBtnId);
      if (devBtn) {
        devBtn.addEventListener("click", function () {
          runDevDirectLogin();
        });
      }
    }

    return {
      setStep: setStep,
      reset: function () {
        lastPhone = "";
        codeEl.value = "";
        setStep(false);
      },
      refreshLabels: function () {
        if (otpSent) btn.textContent = textOf(labels.verify, "تسجيل الدخول");
        else {
          btn.textContent = textOf(labels.send, "إرسال الرمز");
          btn.disabled = !phoneValid();
        }
        updateIntro(otpSent);
      },
      isOtpSent: function () {
        return otpSent;
      },
      focusCode: focusCode,
      runDevDirectLogin: runDevDirectLogin,
    };
  }

  global.ErvenowAuthOtpFlow = { mount: mount };
})(window);
