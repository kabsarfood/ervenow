const API_BASE = "https://kabsar-delivery-production.up.railway.app";

document.getElementById("btnVerify").onclick = async () => {
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value.trim();

  console.log("\u{1F680} LOGIN REQUEST:", { phone, password });

  const res = await fetch(`${API_BASE}/api/driver/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: phone,
      password: password
    })
  });

  const data = await res.json();
  console.log("\u{1F525} LOGIN RESPONSE:", data);

  if (data.success) {
    localStorage.setItem("driverToken", data.token);
    document.getElementById("msgLogin").innerText = "تم الدخول بنجاح";
    window.location.href = "/delivery/orders.html";
  } else {
    document.getElementById("msgLogin").innerText = data.message || "فشل الدخول";
  }
};

window.onload = () => {
  console.log("AUTH JS LOADED");
};
