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

function findStoreProductLineIndex(cart, storeId, productId) {
  return cart.findIndex(function (i) {
    var d = i && i.data;
    return (
      d &&
      String(d.store_id) === String(storeId) &&
      d.product_id != null &&
      String(d.product_id) === String(productId)
    );
  });
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

  var pid = item && item.data && item.data.product_id;
  if (newSid && pid != null && pid !== "") {
    var idx = findStoreProductLineIndex(cart, newSid, pid);
    if (idx >= 0) {
      var cur = cart[idx];
      var addQty = Math.max(1, Math.min(99, Number(item.data && item.data.qty) || 1));
      var unit =
        Number(item.data && item.data.unit_price) ||
        Number(cur.data && cur.data.unit_price) ||
        (Number(cur.price) || 0) / Math.max(1, Number(cur.data && cur.data.qty) || 1);
      if (!Number.isFinite(unit) || unit < 0) unit = 0;
      var newQty = Math.min(99, (Number(cur.data && cur.data.qty) || 1) + addQty);
      cart[idx] = Object.assign({}, cur, {
        price: unit * newQty,
        data: Object.assign({}, cur.data || {}, { qty: newQty, unit_price: unit }),
      });
      saveCart(cart);
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
  var initQty = Math.max(1, Math.min(99, Number(item.data && item.data.qty) || 1));
  var unitFromItem =
    Number(item.data && item.data.unit_price) ||
    (Number(item.price) && initQty > 0 ? Number(item.price) / initQty : 0);
  cart.push({
    id: Date.now(),
    type: item.type,
    title: item.title,
    price: Number(item.price) || 0,
    data: Object.assign({}, item.data || {}, {
      qty: initQty,
      unit_price: Number.isFinite(unitFromItem) && unitFromItem > 0 ? unitFromItem : undefined,
    }),
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
  const cart = getCart();
  const n = cart.reduce(function (sum, i) {
    return sum + (Number(i.data && i.data.qty) || 1);
  }, 0);
  el.textContent = String(n);
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
  el.textContent = msg;
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
  el.textContent = msg;
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
