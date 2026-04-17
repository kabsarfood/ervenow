/* نفس منطق auth.js — للتوافق مع الصفحات التي تحمّل login.js */
(() => {
  const { qs, setMsg, api, saveToken, normalizePhone } = window.KABSAR;

  const elPhone = qs("#phone");
  const btnSend = qs("#btnSend");
  const btnVerify = qs("#btnVerify");
  const btnReset = qs("#btnReset");

  const msgLogin = qs("#msgLogin");

  const cardRegister = qs("#cardRegister");
  const msgRegister = qs("#msgRegister");
  const btnRegister = qs("#btnRegister");

  let otpToken = "";
  let sending = false;
  let verifying = false;

  function showRegister() {
    cardRegister.style.display = "";

    const regPhone = qs("#regPhone");
    if (regPhone && elPhone.value) {
      regPhone.value = elPhone.value;
    }

    cardRegister.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetAll() {
    otpToken = "";
    elPhone.value = "";
    const pwd = document.getElementById("password");
    if (pwd) pwd.value = "";
    cardRegister.style.display = "none";
    setMsg(msgLogin, "جاهز.", "");
    setMsg(msgRegister, "أكمل البيانات ثم اضغط إنشاء الحساب.", "");
  }

  btnReset?.addEventListener("click", resetAll);

  btnSend?.addEventListener("click", async () => {
    if (sending) return;

    try {
      sending = true;
      btnSend.disabled = true;

      setMsg(msgLogin, "جارٍ إرسال OTP...", "");

      const phone = normalizePhone(elPhone.value);
      if (!phone) throw new Error("أدخل رقم الجوال");

      elPhone.value = phone;

      const data = await api("/send-otp", {
        method: "POST",
        body: { phone },
      });

      console.log("[send-otp] response:", data);

      if (data && data.success === false) {
        throw new Error(data.message || "تعذر إرسال الرمز");
      }

      const dev = data?.devOtp != null ? ` (رمز التطوير: ${data.devOtp})` : "";
      const msg = data?.message || "تم إرسال الرمز";

      setMsg(msgLogin, msg + dev, "ok");
    } catch (e) {
      setMsg(msgLogin, e.message, "bad");
    } finally {
      sending = false;
      btnSend.disabled = false;
    }
  });

  btnVerify?.addEventListener("click", async () => {
    if (verifying) return;

    try {
      verifying = true;
      btnVerify.disabled = true;

      setMsg(msgLogin, "جارٍ التحقق...", "");

      const phone = normalizePhone(elPhone.value);
      const password = document.getElementById("password").value;

      if (!phone || !String(password).trim()) throw new Error("أدخل الرقم والكود");

      elPhone.value = phone;

      const data = await api("/verify-otp", {
        method: "POST",
        body: { phone, password },
      });

      console.log("[verify-otp] response:", data);

      if (data && data.success === false && !data.flow) {
        setMsg(msgLogin, data.message || "فشل التحقق", "bad");
        return;
      }

      if (data.flow === "needs_register") {
        otpToken = data.otpToken;
        setMsg(msgLogin, "تم التحقق. أكمل التسجيل الآن.", "ok");
        showRegister();
        return;
      }

      if (data.flow === "pending") {
        setMsg(msgLogin, data.message || "حسابك قيد المراجعة ⏳", "bad");
        return;
      }

      if (data.flow === "blocked") {
        setMsg(msgLogin, data.message || "تم رفض الحساب ❌", "bad");
        return;
      }

      if (data.flow === "logged_in" && data.driverToken) {
        saveToken(data.driverToken);
        console.log(
          "[verify-otp] localStorage driverToken:",
          localStorage.getItem("driverToken") ? "(محفوظ)" : "(فارغ)"
        );

        setMsg(msgLogin, "تم تسجيل الدخول. جاري التحويل...", "ok");

        setTimeout(() => {
          window.location.href = "/delivery/orders.html";
        }, 500);

        return;
      }

      if (data.success === true && data.driver) {
        setMsg(msgLogin, "تم تسجيل الدخول. جاري التحويل...", "ok");
        setTimeout(() => {
          window.location.href = "/delivery/orders.html";
        }, 500);
        return;
      }

      setMsg(msgLogin, "استجابة غير متوقعة من السيرفر", "bad");
    } catch (e) {
      setMsg(msgLogin, e.message, "bad");
    } finally {
      verifying = false;
      btnVerify.disabled = false;
    }
  });

  btnRegister?.addEventListener("click", async () => {
    try {
      btnRegister.disabled = true;

      setMsg(msgRegister, "جارٍ إنشاء الحساب...", "");

      if (!otpToken) throw new Error("أعد التحقق من OTP");

      const body = {
        name: qs("#name").value.trim(),
        phone: normalizePhone(qs("#regPhone").value),
        iqama: qs("#iqama").value.trim(),
        vehicle_type: qs("#vehicleType").value,
        carType: qs("#vehicleType").value,
        plateNumber: qs("#plateNumber").value.trim(),
      };

      if (!body.name || !body.phone || !body.iqama) {
        throw new Error("الاسم + الجوال + الإقامة مطلوبة");
      }

      console.log("[register] submitting driver request");
      const data = await api("/register", {
        method: "POST",
        body,
        headers: {
          Authorization: `Bearer ${otpToken}`,
        },
      });

      console.log("[register] response:", data);

      if (!data || data.success === false) {
        setMsg(
          msgRegister,
          data?.message || "تعذر إنشاء الحساب",
          "bad"
        );
        return;
      }

      setMsg(
        msgRegister,
        data.message || "تم إنشاء الحساب بنجاح، بانتظار الموافقة",
        "ok"
      );
    } catch (e) {
      setMsg(msgRegister, e.message, "bad");
    } finally {
      btnRegister.disabled = false;
    }
  });

  if (window.location.hash === "#register" && cardRegister) {
    showRegister();
  }
})();
