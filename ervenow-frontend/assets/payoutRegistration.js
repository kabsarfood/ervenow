/**
 * واجهات التسجيل — قائمة بنوك السعودية + تجميع حقول الدفع (اختيارية)
 */
(function (w) {
  var SA_BANKS = [
    { id: "alrajhi", name: "مصرف الراجحي" },
    { id: "snb", name: "البنك الأهلي السعودي (SNB)" },
    { id: "riyad", name: "بنك الرياض" },
    { id: "sabb", name: "البنك السعودي البريطاني (ساب)" },
    { id: "alinma", name: "مصرف الإنماء" },
    { id: "albilad", name: "بنك البلاد" },
    { id: "fransi", name: "البنك السعودي الفرنسي" },
    { id: "jazira", name: "بنك الجزيرة" },
    { id: "dubai", name: "بنك الإمارات دبي الوطني السعودي" },
    { id: "gulf", name: "البنك الخليجي التجاري" },
    { id: "alawwal", name: "البنك السعودي الأول" },
    { id: "investment", name: "البنك السعودي للاستثمار" },
    { id: "icbc", name: "البنك الصناعي والتجاري الصيني (السعودية)" },
    { id: "mufg", name: "بنك طوكيو ميتسوبيشي يوفيجي (السعودية)" },
    { id: "jpmorgan", name: "J.P. Morgan السعودية" },
    { id: "deutsche", name: "دويتشه بنك السعودية" },
    { id: "bnp", name: "بي إن بي باريبا السعودية" },
    { id: "credit_agricole", name: "كريدي أجريكول السعودية" },
    { id: "muscat", name: "بنك مسقط السعودية" },
    { id: "national_bank_bahrain", name: "البنك الوطني البحريني (السعودية)" },
    { id: "national_bank_kuwait", name: "بنك الكويت الوطني (السعودية)" },
    { id: "bank_muscat", name: "بنك عُمان العربي (السعودية)" },
    { id: "ziraat", name: "بنك زراعات التركي (السعودية)" },
    { id: "qnb", name: "بنك قطر الوطني (السعودية)" },
    { id: "arab_bank", name: "البنك العربي الوطني" },
    { id: "other", name: "بنك آخر (أدخل الاسم يدوياً)" },
  ];

  function strip(s) {
    return String(s || "")
      .replace(/\s+/g, "")
      .trim();
  }

  function norm05(v) {
    var d = String(v || "").replace(/\D/g, "");
    if (d.startsWith("9665")) d = "0" + d.slice(3);
    else if (d.startsWith("5") && d.length === 9) d = "0" + d;
    return d.slice(0, 10);
  }

  function isSaIban(v) {
    return /^SA\d{22}$/i.test(strip(v));
  }

  function fillBankSelect(selectEl, includePlaceholder) {
    if (!selectEl) return;
    var keep = selectEl.getAttribute("data-placeholder") || "— اختر البنك —";
    selectEl.innerHTML = "";
    if (includePlaceholder !== false) {
      var o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = keep;
      selectEl.appendChild(o0);
    }
    SA_BANKS.forEach(function (b) {
      var o = document.createElement("option");
      o.value = b.name;
      o.textContent = b.name;
      o.setAttribute("data-bank-id", b.id);
      selectEl.appendChild(o);
    });
  }

  function wireCountryBankUi(opts) {
    var countryEl = opts.countryEl;
    var bankSelect = opts.bankSelect;
    var bankOtherWrap = opts.bankOtherWrap;
    var bankOtherInput = opts.bankOtherInput;
    var ibanWrap = opts.ibanWrap;
    var bankOtherLabel = opts.bankOtherLabel;
    if (!countryEl || !bankSelect) return;
    function sync() {
      var c = String(countryEl.value || "SA").toUpperCase();
      if (c === "SA") {
        bankSelect.style.display = "";
        if (ibanWrap) ibanWrap.style.display = "";
        if (bankOtherWrap) {
          var opt = bankSelect.selectedOptions && bankSelect.selectedOptions[0];
          var showOther =
            (bankSelect.value && bankSelect.value.indexOf("بنك آخر") !== -1) ||
            (opt && opt.getAttribute("data-bank-id") === "other");
          bankOtherWrap.style.display = showOther ? "" : "none";
          if (!showOther && bankOtherInput) bankOtherInput.value = "";
          if (bankOtherLabel) bankOtherLabel.textContent = "اسم البنك (تفصيلي)";
        }
      } else {
        bankSelect.style.display = "none";
        if (bankOtherWrap) {
          bankOtherWrap.style.display = "";
        }
        if (ibanWrap) ibanWrap.style.display = "";
        if (bankOtherLabel) bankOtherLabel.textContent = "اسم البنك";
      }
    }
    countryEl.addEventListener("change", sync);
    bankSelect.addEventListener("change", sync);
    sync();
  }

  /**
   * يُرجع كائن payout للإرسال مع الطلب، أو null إذا كل الحقول فارغة.
   * يُرمى استثناء برسالة عربية عند بيانات ناقصة/غير صالحة.
   */
  function buildPayoutPayload(fields) {
    var countryEl = fields.countryEl;
    var bankSelect = fields.bankSelect;
    var bankOtherInput = fields.bankOtherInput;
    var ibanInput = fields.ibanInput;
    var stcInput = fields.stcInput;
    var cryptoCheckbox = fields.cryptoCheckbox;

    var bank_country_code = countryEl ? String(countryEl.value || "SA").trim().toUpperCase().slice(0, 2) : "SA";
    if (!bank_country_code) bank_country_code = "SA";

    var bank_name = "";
    if (bank_country_code === "SA") {
      if (bankSelect && bankSelect.value) {
        bank_name = String(bankSelect.value).trim();
        if (bank_name.indexOf("بنك آخر") !== -1 || (bankSelect.selectedOptions[0] && bankSelect.selectedOptions[0].getAttribute("data-bank-id") === "other")) {
          bank_name = String(bankOtherInput && bankOtherInput.value ? bankOtherInput.value : "").trim();
        }
      }
    } else {
      bank_name = String(bankOtherInput && bankOtherInput.value ? bankOtherInput.value : "").trim();
    }

    var iban = ibanInput ? strip(ibanInput.value).toUpperCase() : "";
    var stc = stcInput ? norm05(stcInput.value) : "";
    var crypto = !!(cryptoCheckbox && cryptoCheckbox.checked);

    var any = !!(bank_name || iban || stc || crypto);
    if (!any) return null;

    if (iban) {
      if (bank_country_code === "SA") {
        if (!isSaIban(iban)) throw new Error("آيبان سعودي غير صالح — يبدأ بـ SA ثم 22 رقماً");
        if (!bank_name) throw new Error("اختر اسم البنك عند إدخال الآيبان");
      } else {
        if (iban.length < 10 || iban.length > 34 || !/^[A-Z0-9]+$/i.test(iban)) {
          throw new Error("صيغة الآيبان غير صالحة");
        }
        if (!bank_name) throw new Error("أدخل اسم البنك عند إدخال الآيبان");
      }
    }
    if (stc && !/^05\d{8}$/.test(stc)) throw new Error("رقم STC Pay يجب أن يبدأ بـ 05 ومكوّناً من 10 أرقام");

    var out = {
      bank_country_code: bank_country_code,
      payout_crypto_interest: crypto,
    };
    if (bank_name) out.bank_name = bank_name;
    if (iban) out.iban = iban;
    if (stc) out.stc_pay_phone = stc;
    return out;
  }

  w.ERVENOW_PAYOUT_UI = {
    saBanks: SA_BANKS,
    fillBankSelect: fillBankSelect,
    wireCountryBankUi: wireCountryBankUi,
    buildPayoutPayload: buildPayoutPayload,
    isSaIban: isSaIban,
    norm05: norm05,
  };
})(typeof window !== "undefined" ? window : globalThis);
