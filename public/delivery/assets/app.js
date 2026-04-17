const API_BASE = "https://kabsar-delivery-production.up.railway.app";

function qs(sel) {
  return document.querySelector(sel);
}

function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("ok", "bad");
  if (kind) el.classList.add(kind);
}

function saveToken(token) {
  if (!token) return;
  localStorage.setItem("driverToken", token);
}

function getToken() {
  return localStorage.getItem("driverToken") || "";
}

function clearToken() {
  localStorage.removeItem("driverToken");
}

/* ======================
📱 Normalize Phone
====================== */
function normalizePhone(phone) {
  const raw = String(phone || "").trim();
  let digits = raw.replace(/[^\d]/g, "");

  if (digits.startsWith("05")) return digits;
  if (digits.startsWith("5")) return "05" + digits.slice(1);
  if (digits.startsWith("9665")) return "0" + digits.slice(3);

  return raw;
}

/* ======================
🔐 Auth Headers
====================== */
function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* ======================
🌐 API Helper
====================== */
async function api(path, { method = "GET", body, headers: extraHeaders } = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${API_BASE}/api/driver${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = data?.message || "تعذر تنفيذ العملية.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;

  } catch (err) {
    console.error("API ERROR:", err.message);
    throw err;
  }
}

/* ======================
🔒 Auth Check
====================== */
function requireAuthOrRedirect() {
  if (!getToken()) {
    window.location.href = "/delivery/login.html";
  }
}

/* ======================
🚪 Logout
====================== */
function logout() {
  clearToken();
  window.location.href = "/delivery/login.html";
}

/* ======================
🔊 Beep Sound
====================== */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);

    g.gain.setValueAtTime(0.0001, ctx.currentTime);

    o.connect(g);
    g.connect(ctx.destination);

    o.start();

    const t0 = ctx.currentTime;

    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);

    o.stop(t0 + 0.31);

    setTimeout(() => ctx.close?.(), 400);

  } catch (e) {
    console.warn("Audio failed:", e);
  }
}

/* ======================
🌍 Export
====================== */
window.KABSAR = {
  qs,
  setMsg,
  saveToken,
  getToken,
  clearToken,
  normalizePhone,
  api,
  requireAuthOrRedirect,
  logout,
  beep
};