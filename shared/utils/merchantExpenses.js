const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_FILE = path.join(__dirname, "../../data/merchant-expenses.json");

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

function listExpenses(storeId, file) {
  const id = String(storeId || "").trim();
  const rows = readAll(file)[id];
  return Array.isArray(rows) ? rows.slice().sort(function (a, b) {
    return String(b.spent_at || b.created_at || "").localeCompare(String(a.spent_at || a.created_at || ""));
  }) : [];
}

function addExpense(storeId, input, file) {
  const id = String(storeId || "").trim();
  const amount = Math.round(Number(input && input.amount) * 100) / 100;
  const item = String((input && (input.item || input.category)) || "").trim().slice(0, 80);
  const note = String((input && (input.note || input.notes)) || "").trim().slice(0, 400);
  const cashierName = String((input && input.cashier_name) || "").trim().slice(0, 80);
  const cashierId = String((input && input.cashier_id) || "").trim().slice(0, 80) || null;
  let day = String((input && input.spent_at) || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    day = now.toISOString().slice(0, 10);
  }
  if (!id) {
    const err = new Error("المتجر غير معروف");
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    const err = new Error("أدخل مبلغاً أكبر من صفر");
    err.status = 400;
    throw err;
  }
  if (!item) {
    const err = new Error("الصنف مطلوب");
    err.status = 400;
    throw err;
  }
  if (!cashierName) {
    const err = new Error("اسم الكاشير مطلوب");
    err.status = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const err = new Error("تاريخ المصروف غير صالح");
    err.status = 400;
    throw err;
  }
  const stores = readAll(file);
  const rows = Array.isArray(stores[id]) ? stores[id] : [];
  const row = {
    id: crypto.randomUUID(),
    amount: amount,
    item: item,
    note: note,
    cashier_name: cashierName,
    cashier_id: cashierId,
    spent_at: day,
    created_at: new Date().toISOString(),
  };
  rows.push(row);
  stores[id] = rows;
  writeAll(stores, file);
  return row;
}

function removeExpense(storeId, expenseId, file) {
  const id = String(storeId || "").trim();
  const stores = readAll(file);
  const rows = Array.isArray(stores[id]) ? stores[id] : [];
  const next = rows.filter(function (row) { return row.id !== expenseId; });
  if (next.length === rows.length) {
    const err = new Error("المصروف غير موجود");
    err.status = 404;
    throw err;
  }
  stores[id] = next;
  writeAll(stores, file);
  return { id: expenseId };
}

module.exports = { listExpenses, addExpense, removeExpense };
