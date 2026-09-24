const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_FILE = path.join(__dirname, "../../data/merchant-cashiers.json");

function filePath(custom) {
  return custom || DEFAULT_FILE;
}

function readAll(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(file), "utf8"));
    if (parsed && parsed.stores && typeof parsed.stores === "object") return parsed.stores;
  } catch (_) {}
  return {};
}

function writeAll(stores, file) {
  const target = filePath(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ stores: stores }, null, 2));
}

function digits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function listCashiers(storeId, file) {
  const id = String(storeId || "").trim();
  const rows = readAll(file)[id];
  return Array.isArray(rows) ? rows : [];
}

function addCashier(storeId, input, ownerPhone, file) {
  const id = String(storeId || "").trim();
  const name = String((input && input.name) || "").trim().slice(0, 80);
  const phone = digits(input && input.phone);
  const branch = String((input && input.branch_id) || "").trim().slice(0, 80);
  if (!id || !name || phone.length < 9) {
    const err = new Error("الاسم ورقم الجوال مطلوبان");
    err.status = 400;
    throw err;
  }
  if (digits(ownerPhone) && phone.endsWith(digits(ownerPhone).slice(-9))) {
    const err = new Error("لا يُستخدم رقم صاحب المتجر كحساب كاشير");
    err.status = 400;
    throw err;
  }
  const stores = readAll(file);
  const rows = Array.isArray(stores[id]) ? stores[id] : [];
  if (rows.some(function (row) { return digits(row.phone) === phone; })) {
    const err = new Error("هذا الرقم مسجل مسبقًا");
    err.status = 409;
    throw err;
  }
  const row = {
    id: crypto.randomUUID(),
    name: name,
    phone: phone,
    branch_id: branch || null,
    active: true,
    role: "cashier",
  };
  rows.push(row);
  stores[id] = rows;
  writeAll(stores, file);
  return row;
}

function setCashierActive(storeId, cashierId, active, file) {
  const id = String(storeId || "").trim();
  const stores = readAll(file);
  const rows = Array.isArray(stores[id]) ? stores[id] : [];
  const row = rows.find(function (item) { return item.id === cashierId; });
  if (!row) {
    const err = new Error("الموظف غير موجود");
    err.status = 404;
    throw err;
  }
  row.active = !!active;
  row.role = "cashier";
  writeAll(stores, file);
  return row;
}

module.exports = {
  listCashiers,
  addCashier,
  setCashierActive,
};
