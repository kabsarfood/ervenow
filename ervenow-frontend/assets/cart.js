function getCart() {
  try {
    return JSON.parse(localStorage.getItem("cart") || "[]");
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
  updateCartCount();
}

/** معرفات المتاجر الموجودة في السلة (سلة واحدة — لا خلط بين متاجر) */
function getCartStoreIds() {
  const ids = new Set();
  getCart().forEach(function (i) {
    var sid = i && i.data && i.data.store_id;
    if (sid) ids.add(String(sid));
  });
  return ids;
}

function addToCart(item) {
  const cart = getCart();
  var newSid = item && item.data && item.data.store_id ? String(item.data.store_id).trim() : "";
  if (newSid) {
    var existingIds = getCartStoreIds();
    if (existingIds.size > 0 && !existingIds.has(newSid)) {
      alert("لا يمكن خلط منتجات من متجرين مختلفين. أفرغ السلة أو أتمّم الطلب أولاً.");
      return;
    }
  }

  const exists = cart.find(
    (i) =>
      i.type === item.type &&
      i.title === item.title &&
      JSON.stringify(i.data || {}) === JSON.stringify(item.data || {})
  );
  if (exists) {
    alert("تمت إضافة هذا العنصر مسبقًا");
    return;
  }
  cart.push({
    id: Date.now(),
    type: item.type,
    title: item.title,
    price: Number(item.price) || 0,
    data: item.data || {},
  });
  saveCart(cart);
}

function removeFromCart(id) {
  const cart = getCart().filter((i) => String(i.id) !== String(id));
  saveCart(cart);
}

function updateCartCount() {
  const el = document.getElementById("cartCount");
  if (!el) return;
  el.innerText = String(getCart().length);
}

function safeClick(fn) {
  let locked = false;
  return async function (...args) {
    if (locked) return;
    locked = true;
    try {
      await fn.apply(this, args);
    } finally {
      locked = false;
    }
  };
}

function showSuccess(msg) {
  const el = document.createElement("div");
  el.innerText = msg;
  el.style.position = "fixed";
  el.style.bottom = "20px";
  el.style.right = "20px";
  el.style.background = "green";
  el.style.color = "#fff";
  el.style.padding = "10px";
  el.style.borderRadius = "8px";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function showError(msg) {
  const el = document.createElement("div");
  el.innerText = msg;
  el.style.position = "fixed";
  el.style.bottom = "20px";
  el.style.right = "20px";
  el.style.background = "red";
  el.style.color = "#fff";
  el.style.padding = "10px";
  el.style.borderRadius = "6px";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

document.addEventListener("DOMContentLoaded", updateCartCount);
window.addEventListener("storage", updateCartCount);
