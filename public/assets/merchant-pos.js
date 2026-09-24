/**
 * كاشير ERVENOW داخل مساحة عمل بوابة التاجر.
 * المنتجات والأسعار من كتالوج المتجر. السلة تبقى في الذاكرة عند وصول طلب منصة.
 */
(function (global) {
  "use strict";

  var ticket = {
    fulfillment: "local",
    payment: "cash",
    lines: [],
  };
  var holds = [];
  var query = "";
  var category = "";
  var receipt = null;
  var cartOpen = false;
  var slotCols = 4;
  var mountedRoot = null;
  var mountedCtx = null;
  var offline = typeof navigator !== "undefined" && navigator.onLine === false;
  var pendingSync = 0;

  var TYPES = [
    { id: "local", label: "محلي" },
    { id: "pickup", label: "استلام" },
    { id: "delivery", label: "توصيل" },
  ];
  var PAYS = [
    { id: "cash", label: "نقدي" },
    { id: "network", label: "شبكة" },
    { id: "electronic", label: "دفع إلكتروني" },
  ];

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "pos-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function posDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error("IndexedDB غير متاح"));
      var req = indexedDB.open("ervenow-pos", 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog");
        if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "local_id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(store, value, key) {
    return posDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readwrite");
        var os = tx.objectStore(store);
        var req = key == null ? os.put(value) : os.put(value, key);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbGet(store, key) {
    return posDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readonly");
        var req = tx.objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function queueAll() {
    return posDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction("queue", "readonly").objectStore("queue").getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function rememberCatalog(ctx) {
    if (!ctx || !ctx.storeId || !ctx.products) return;
    idbPut("catalog", {
      storeId: ctx.storeId,
      products: ctx.products,
      categories: ctx.categories || [],
      savedAt: new Date().toISOString(),
    }, String(ctx.storeId)).catch(function () {});
    try {
      global.localStorage.setItem("ervenow_pos_device", JSON.stringify({
        storeId: String(ctx.storeId),
        activatedAt: new Date().toISOString(),
      }));
    } catch (_) {}
  }

  function refreshPending() {
    queueAll().then(function (rows) {
      pendingSync = rows.filter(function (row) { return row.status !== "synced"; }).length;
      if (mountedRoot && mountedCtx) paint(mountedRoot, mountedCtx);
    }).catch(function () {});
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return "0.00";
    return x.toFixed(2);
  }

  function priceHtml(p) {
    var price = Number(p && p.price);
    var offer = Number(p && p.offer_price);
    var sale = unitPrice(p);
    if (Number.isFinite(offer) && offer > 0 && offer < price) {
      return '<s>' + money(price) + "</s> " + money(sale) + " ر.س";
    }
    return money(sale) + " ر.س";
  }

  function unitPrice(p) {
    var price = Number(p && p.price);
    var offer = Number(p && p.offer_price);
    if (!Number.isFinite(price) || price < 0) return 0;
    if (Number.isFinite(offer) && offer > 0 && offer < price) return offer;
    return price;
  }

  function activeProducts(list) {
    return (list || []).filter(function (p) {
      return p && p.id && p.active !== false;
    });
  }

  function holdStorageKey(storeId) {
    return "ervenow_pos_holds_" + String(storeId || "");
  }

  function loadHolds(storeId) {
    try {
      var raw = global.localStorage.getItem(holdStorageKey(storeId));
      var parsed = raw ? JSON.parse(raw) : [];
      holds = Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch (_) {
      holds = [];
    }
  }

  function saveHolds(storeId) {
    try {
      global.localStorage.setItem(holdStorageKey(storeId), JSON.stringify(holds.slice(0, 8)));
    } catch (_) {}
  }

  function catalogCategories(ctx) {
    var seen = {};
    var out = [];
    (ctx.categories || []).forEach(function (c) {
      var id = String(c.value || c.slug || c.id || c || "").trim();
      var label = c.label || c.name_ar || c.name || id;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, label: label });
    });
    activeProducts(ctx.products).forEach(function (p) {
      var id = String(p.category || p.category_slug || "").trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, label: p.category_label || id });
    });
    return out;
  }

  function visibleProducts(ctx) {
    var q = query.trim().toLowerCase();
    return activeProducts(ctx.products).filter(function (p) {
      var cat = String(p.category || p.category_slug || "");
      if (category && cat !== category) return false;
      if (!q) return true;
      return String(p.name || "").toLowerCase().indexOf(q) !== -1;
    });
  }

  function lineQty(id) {
    var found = ticket.lines.find(function (line) {
      return line.product_id === id;
    });
    return found ? found.qty : 0;
  }

  function totals() {
    var subtotal = ticket.lines.reduce(function (sum, line) {
      return sum + line.unit_price * line.qty;
    }, 0);
    subtotal = Math.round(subtotal * 100) / 100;
    var vat = Math.round(subtotal * 0.15 * 100) / 100;
    return { subtotal: subtotal, vat: vat, total: Math.round((subtotal + vat) * 100) / 100 };
  }

  function addProduct(ctx, id) {
    var product = activeProducts(ctx.products).find(function (p) {
      return String(p.id) === String(id);
    });
    if (!product) return;
    var existing = ticket.lines.find(function (line) {
      return line.product_id === String(product.id);
    });
    if (existing) {
      if (existing.qty < 99) existing.qty += 1;
      return;
    }
    ticket.lines.push({
      product_id: String(product.id),
      name: product.name || "منتج",
      unit_price: unitPrice(product),
      qty: 1,
      image_url: product.image_url || "",
    });
  }

  function setQty(id, qty) {
    ticket.lines = ticket.lines
      .map(function (line) {
        if (line.product_id !== id) return line;
        var next = line.qty + qty;
        if (next < 1) return null;
        line.qty = Math.min(99, next);
        return line;
      })
      .filter(Boolean);
  }

  function typesHtml() {
    return TYPES.map(function (t) {
      return (
        '<button type="button" class="mp-pos-type' +
        (ticket.fulfillment === t.id ? " is-active" : "") +
        '" data-pos-type="' +
        t.id +
        '">' +
        esc(t.label) +
        "</button>"
      );
    }).join("");
  }

  function catsHtml(ctx) {
    var cats = catalogCategories(ctx);
    var all =
      '<button type="button" class="mp-pos-cat' +
      (category ? "" : " is-active") +
      '" data-pos-cat="">الكل</button>';
    return (
      all +
      cats
        .map(function (c) {
          return (
            '<button type="button" class="mp-pos-cat' +
            (category === c.id ? " is-active" : "") +
            '" data-pos-cat="' +
            esc(c.id) +
            '">' +
            esc(c.label) +
            "</button>"
          );
        })
        .join("")
    );
  }

  function slotColumns() {
    var w = global.innerWidth || 1280;
    var h = global.innerHeight || 800;
    if (w <= 640 || h <= 520) return 2;
    if (w >= 1280) return 4;
    return 3;
  }

  function visibleSlotTarget(cols) {
    if (cols >= 4) return 12;
    if (cols === 3) return 9;
    return 8;
  }

  function gridHtml(ctx) {
    var list = visibleProducts(ctx);
    var cols = slotColumns();
    slotCols = cols;
    var target = visibleSlotTarget(cols);
    var slots =
      list.length > target ? Math.ceil(list.length / cols) * cols : target;
    var cards = list
      .map(function (p) {
        var img = p.image_url || p.thumbnail_url || "";
        var qty = lineQty(String(p.id));
        return (
          '<button type="button" class="mp-pos-card" data-pos-add="' +
          esc(p.id) +
          '">' +
          '<span class="mp-pos-card__thumb">' +
          (img
            ? '<img src="' + esc(img) + '" alt="" />'
            : '<span class="mp-pos-card__ph" aria-hidden="true"></span>') +
          "</span>" +
          '<span class="mp-pos-card__name">' +
          esc(p.name) +
          "</span>" +
          '<span class="mp-pos-card__price">' +
          priceHtml(p) +
          "</span>" +
          (qty ? '<span class="mp-pos-card__qty">' + qty + "</span>" : "") +
          "</button>"
        );
      })
      .join("");
    if (ctx && ctx.canManage !== false) {
      var empty = slots - list.length;
      var i;
      for (i = 0; i < empty; i += 1) {
        cards +=
          '<button type="button" class="mp-pos-card mp-pos-card--slot" data-pos-slot="1">' +
          '<span class="mp-pos-card__ph" aria-hidden="true">＋</span>' +
          '<span class="mp-pos-card__name">إضافة منتج</span>' +
          '<span class="mp-pos-card__price" aria-hidden="true">&nbsp;</span></button>';
      }
    }
    return cards;
  }

  function ticketHtml() {
    var sum = totals();
    var lines = ticket.lines.length
      ? ticket.lines
          .map(function (line) {
            return (
              '<div class="mp-pos-line">' +
              '<button type="button" class="mp-pos-line__del" data-pos-del="' +
              esc(line.product_id) +
              '" aria-label="حذف">×</button>' +
              '<div class="mp-pos-line__qty">' +
              '<button type="button" data-pos-qty="' +
              esc(line.product_id) +
              '" data-pos-dir="-1" aria-label="نقص">−</button>' +
              "<span>" +
              line.qty +
              "</span>" +
              '<button type="button" data-pos-qty="' +
              esc(line.product_id) +
              '" data-pos-dir="1" aria-label="زيادة">+</button>' +
              "</div>" +
              '<div class="mp-pos-line__meta"><strong>' +
              esc(line.name) +
              "</strong><span>" +
              money(line.unit_price * line.qty) +
              " ر.س</span></div></div>"
            );
          })
          .join("")
      : '<p class="mp-empty">الطلب الحالي فارغ</p>';
    var pays = PAYS.map(function (p) {
      return (
        '<button type="button" class="mp-pos-pay' +
        (ticket.payment === p.id ? " is-active" : "") +
        '" data-pos-pay="' +
        p.id +
        '">' +
        esc(p.label) +
        "</button>"
      );
    }).join("");
    var holdBtns = holds
      .map(function (h, i) {
        return (
          '<button type="button" class="mp-pos-hold" data-pos-resume="' +
          i +
          '">معلّق ' +
          (i + 1) +
          " · " +
          money(h.total || 0) +
          "</button>"
        );
      })
      .join("");
    return (
      '<div class="mp-pos-ticket__head"><h3>الطلب الحالي</h3>' +
      '<button type="button" class="mp-pos-clear" data-pos-clear>مسح</button>' +
      '<button type="button" class="mp-pos-cart-close" data-pos-cart-close>إغلاق</button></div>' +
      '<div class="mp-pos-lines">' +
      lines +
      "</div>" +
      '<div class="mp-pos-ticket__foot">' +
      (receipt ? receiptHtml(receipt) : "") +
      '<div class="mp-pos-sums"><div><span>المجموع الفرعي</span><strong>' +
      money(sum.subtotal) +
      ' ر.س</strong></div><div><span>الضريبة (15%)</span><strong>' +
      money(sum.vat) +
      ' ر.س</strong></div><div class="is-total"><span>المجموع الكلي</span><strong>' +
      money(sum.total) +
      " ر.س</strong></div></div>" +
      '<p class="mp-pos-pay-label">طريقة الدفع</p><div class="mp-pos-pays">' +
      pays +
      "</div>" +
      (holdBtns ? '<div class="mp-pos-holds">' + holdBtns + "</div>" : "") +
      '<div class="mp-pos-actions">' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pos-hold>تعليق الطلب</button>' +
      '<button type="button" class="mp-btn mp-btn--ghost" data-pos-cancel>إلغاء</button>' +
      '<button type="button" class="mp-btn mp-btn--primary mp-pos-complete" data-pos-complete>إتمام الطلب وطباعة الفاتورة</button>' +
      "</div></div>"
    );
  }

  function cartCount() {
    return ticket.lines.reduce(function (sum, line) {
      return sum + line.qty;
    }, 0);
  }

  function receiptHtml(order) {
    var items = (order.items || [])
      .map(function (item) {
        return "<li>" + esc(item.name) + " × " + item.qty + " — " + money(item.line_total) + " ر.س</li>";
      })
      .join("");
    var type = TYPES.find(function (t) {
      return t.id === order.fulfillment;
    });
    return (
      '<section class="mp-pos-receipt" id="mpPosReceipt"><h3>فاتورة كاشير</h3><p>' +
      esc(order.order_number || "") +
      "</p><p>" +
      esc(type ? type.label : "") +
      "</p><ul>" +
      items +
      "</ul><p>المجموع " +
      money(order.total) +
      " ر.س</p></section>"
    );
  }

  function paint(root, ctx) {
    var prev = {
      cats: 0,
      grid: 0,
      lines: 0,
    };
    var catList = root.querySelector(".mp-pos-cat-list");
    var gridEl = root.querySelector(".mp-pos-grid");
    var linesEl = root.querySelector(".mp-pos-lines");
    if (catList) prev.cats = catList.scrollTop;
    if (gridEl) prev.grid = gridEl.scrollTop;
    if (linesEl) prev.lines = linesEl.scrollTop;
    var sum = totals();
    var count = cartCount();
    var hint =
      query && !visibleProducts(ctx).length
        ? '<p class="mp-pos-hint">لا توجد نتائج بهذا البحث</p>'
        : "";
    root.innerHTML =
      '<div class="mp-pos' +
      (cartOpen ? " is-cart-open" : "") +
      '" data-pos-cols="' +
      slotColumns() +
      '">' +
      '<div class="mp-pos-toolbar">' +
      '<div class="mp-pos-brand"><h2>الكاشير POS</h2>' +
      '<p class="mp-pos-shift"><span class="mp-pos-shift__dot" aria-hidden="true"></span><span>الوردية مفتوحة</span><span class="mp-pos-shift__name">الكاشير</span></p>' +
      (offline
        ? '<p class="mp-pos-net is-offline">بدون اتصال — البيع المحلي يعمل، وطلبات ERVENOW ستصل عند عودة الاتصال' +
          (pendingSync ? " · بانتظار المزامنة " + pendingSync : "") +
          "</p>"
        : pendingSync
          ? '<p class="mp-pos-net">متصل — تجري مزامنة ' + pendingSync + "</p>"
          : "") +
      "</div>" +
      '<div class="mp-pos-types" role="tablist">' +
      typesHtml() +
      "</div>" +
      '<label class="mp-pos-search-label" for="mpPosSearch">بحث المنتجات</label>' +
      '<input id="mpPosSearch" class="mp-pos-search" type="search" placeholder="بحث عن منتج" value="' +
      esc(query) +
      '" /></div>' +
      '<div class="mp-pos-layout">' +
      '<aside class="mp-pos-cats" aria-label="الفئات"><h3>الفئات</h3><div class="mp-pos-cat-list">' +
      catsHtml(ctx) +
      "</div></aside>" +
      '<section class="mp-pos-catalog">' +
      hint +
      '<div class="mp-pos-grid" id="mpPosGrid">' +
      gridHtml(ctx) +
      "</div></section>" +
      '<aside class="mp-pos-ticket" aria-label="الطلب الحالي">' +
      ticketHtml() +
      "</aside></div>" +
      '<button type="button" class="mp-pos-backdrop" data-pos-cart-close aria-label="إغلاق الطلب"></button>' +
      '<button type="button" class="mp-pos-cartbar" data-pos-cart-open>' +
      "<span>السلة (" +
      count +
      ")</span><strong>" +
      money(sum.total) +
      ' ر.س</strong><span>عرض الطلب</span></button></div>';
    var search = root.querySelector("#mpPosSearch");
    if (search) {
      search.oninput = function () {
        query = search.value || "";
        var grid = root.querySelector("#mpPosGrid");
        var note = root.querySelector(".mp-pos-hint");
        if (grid) grid.innerHTML = gridHtml(ctx);
        if (!note && query && !visibleProducts(ctx).length) {
          note = document.createElement("p");
          note.className = "mp-pos-hint";
          note.textContent = "لا توجد نتائج بهذا البحث";
          grid.parentNode.insertBefore(note, grid);
        } else if (note && (!query || visibleProducts(ctx).length)) {
          note.remove();
        }
      };
    }
    var nextCats = root.querySelector(".mp-pos-cat-list");
    var nextGrid = root.querySelector(".mp-pos-grid");
    var nextLines = root.querySelector(".mp-pos-lines");
    if (nextCats) nextCats.scrollTop = prev.cats;
    if (nextGrid) nextGrid.scrollTop = prev.grid;
    if (nextLines) nextLines.scrollTop = prev.lines;
    var activeCat = root.querySelector(".mp-pos-cat.is-active");
    if (activeCat && activeCat.scrollIntoView) {
      try {
        activeCat.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (_) {}
    }
  }

  function api(path, opts) {
    if (!global.PlatformAPI || !PlatformAPI.api) throw new Error("PlatformAPI غير متاح");
    return PlatformAPI.api(path, opts);
  }

  function saleBody(ctx, localId, createdAt) {
    return {
      store_id: ctx.storeId,
      fulfillment: ticket.fulfillment,
      payment: ticket.payment,
      client_order_id: localId,
      cashier_id: null,
      branch_id: null,
      local_created_at: createdAt,
      items: ticket.lines.map(function (line) {
        return { product_id: line.product_id, qty: line.qty };
      }),
    };
  }

  async function postSale(body) {
    return api("/api/store/pos-orders", { method: "POST", body: body });
  }

  async function flushQueue() {
    if (offline || !mountedCtx) return;
    var rows = await queueAll().catch(function () { return []; });
    var i;
    for (i = 0; i < rows.length; i += 1) {
      if (rows[i].status === "synced") continue;
      try {
        await postSale(rows[i].body);
        rows[i].status = "synced";
        rows[i].error = "";
        await idbPut("queue", rows[i]);
      } catch (e) {
        rows[i].status = "sync_error";
        rows[i].error = e.message || String(e);
        await idbPut("queue", rows[i]);
        if (global.ErvenowMerchantPreview && ErvenowMerchantPreview.showMsg) {
          ErvenowMerchantPreview.showMsg("تعذرت مزامنة طلب محلي: " + rows[i].error, false);
        }
      }
    }
    refreshPending();
  }

  async function complete(ctx) {
    if (!ticket.lines.length) throw new Error("أضف منتجًا قبل إتمام الطلب");
    var sum = totals();
    var localId = uuid();
    var createdAt = new Date().toISOString();
    var body = saleBody(ctx, localId, createdAt);
    if (offline) {
      await idbPut("queue", {
        local_id: localId,
        store_id: ctx.storeId,
        cashier_id: null,
        branch_id: null,
        created_at: createdAt,
        status: "pending_sync",
        body: body,
      });
      receipt = {
        order_number: "محلي",
        fulfillment: ticket.fulfillment,
        items: ticket.lines.slice(),
        total: sum.total,
      };
      ticket.lines = [];
      refreshPending();
      global.setTimeout(function () {
        try { global.print(); } catch (_) {}
      }, 60);
      return;
    }
    var res;
    try {
      res = await postSale(body);
    } catch (e) {
      await idbPut("queue", {
        local_id: localId,
        store_id: ctx.storeId,
        cashier_id: null,
        branch_id: null,
        created_at: createdAt,
        status: "sync_error",
        error: e.message || String(e),
        body: body,
      });
      refreshPending();
      throw e;
    }
    var order = (res && res.order) || {};
    var data = order.data && typeof order.data === "object" ? order.data : {};
    receipt = {
      order_number: order.order_number || "",
      fulfillment: data.fulfillment || ticket.fulfillment,
      items: data.items || ticket.lines,
      total: order.total_with_vat != null ? order.total_with_vat : sum.total,
    };
    ticket.lines = [];
    paint(mountedRoot, ctx);
    global.setTimeout(function () {
      try {
        global.print();
      } catch (_) {}
    }, 60);
  }

  function onClick(ev) {
    if (!mountedRoot || !mountedCtx) return;
    var t = ev.target.closest("[data-pos-type]");
    if (t) {
      ticket.fulfillment = t.getAttribute("data-pos-type") || "local";
      paint(mountedRoot, mountedCtx);
      return;
    }
    var cat = ev.target.closest("[data-pos-cat]");
    if (cat) {
      category = cat.getAttribute("data-pos-cat") || "";
      paint(mountedRoot, mountedCtx);
      return;
    }
    var slot = ev.target.closest("[data-pos-slot]");
    if (slot) {
      if (global.ErvenowMerchantPreview && ErvenowMerchantPreview.navigate) {
        ErvenowMerchantPreview.navigate("products");
      }
      return;
    }
    if (ev.target.closest("[data-pos-cart-open]")) {
      cartOpen = true;
      paint(mountedRoot, mountedCtx);
      return;
    }
    if (ev.target.closest("[data-pos-cart-close]")) {
      cartOpen = false;
      paint(mountedRoot, mountedCtx);
      return;
    }
    var add = ev.target.closest("[data-pos-add]");
    if (add) {
      addProduct(mountedCtx, add.getAttribute("data-pos-add"));
      paint(mountedRoot, mountedCtx);
      return;
    }
    var qtyBtn = ev.target.closest("[data-pos-qty]");
    if (qtyBtn) {
      setQty(qtyBtn.getAttribute("data-pos-qty"), Number(qtyBtn.getAttribute("data-pos-dir")) || 0);
      paint(mountedRoot, mountedCtx);
      return;
    }
    var del = ev.target.closest("[data-pos-del]");
    if (del) {
      ticket.lines = ticket.lines.filter(function (line) {
        return line.product_id !== del.getAttribute("data-pos-del");
      });
      paint(mountedRoot, mountedCtx);
      return;
    }
    var pay = ev.target.closest("[data-pos-pay]");
    if (pay) {
      ticket.payment = pay.getAttribute("data-pos-pay") || "cash";
      paint(mountedRoot, mountedCtx);
      return;
    }
    if (ev.target.closest("[data-pos-clear]") || ev.target.closest("[data-pos-cancel]")) {
      ticket.lines = [];
      receipt = null;
      paint(mountedRoot, mountedCtx);
      return;
    }
    if (ev.target.closest("[data-pos-hold]")) {
      if (!ticket.lines.length) return;
      var sum = totals();
      holds.unshift({
        fulfillment: ticket.fulfillment,
        payment: ticket.payment,
        lines: ticket.lines.map(function (line) {
          return Object.assign({}, line);
        }),
        total: sum.total,
      });
      holds = holds.slice(0, 8);
      saveHolds(mountedCtx.storeId);
      ticket.lines = [];
      paint(mountedRoot, mountedCtx);
      return;
    }
    var resume = ev.target.closest("[data-pos-resume]");
    if (resume) {
      var held = holds[Number(resume.getAttribute("data-pos-resume"))];
      if (!held) return;
      holds.splice(Number(resume.getAttribute("data-pos-resume")), 1);
      saveHolds(mountedCtx.storeId);
      ticket.fulfillment = held.fulfillment || "local";
      ticket.payment = held.payment || "cash";
      ticket.lines = held.lines || [];
      paint(mountedRoot, mountedCtx);
      return;
    }
    var done = ev.target.closest("[data-pos-complete]");
    if (done) {
      done.disabled = true;
      complete(mountedCtx)
        .catch(function (e) {
          done.disabled = false;
          if (global.ErvenowMerchantPreview && ErvenowMerchantPreview.showMsg) {
            ErvenowMerchantPreview.showMsg(e.message || String(e), false);
          }
        });
    }
  }

  function mount(root, ctx) {
    if (!root) return;
    mountedRoot = root;
    mountedCtx = ctx || {};
    if (mountedCtx.storeId && mountedCtx.storeId !== mount.storeId) {
      mount.storeId = mountedCtx.storeId;
      loadHolds(mountedCtx.storeId);
    }
    if (!root.dataset.posBound) {
      root.dataset.posBound = "1";
      root.addEventListener("click", onClick);
      global.addEventListener("resize", onPosResize);
      global.addEventListener("online", function () {
        offline = false;
        flushQueue();
      });
      global.addEventListener("offline", function () {
        offline = true;
        if (mountedRoot && mountedCtx) paint(mountedRoot, mountedCtx);
      });
    }
    rememberCatalog(mountedCtx);
    if (mountedCtx.storeId && (!mountedCtx.products || !mountedCtx.products.length)) {
      idbGet("catalog", String(mountedCtx.storeId)).then(function (cached) {
        if (!cached || !mountedCtx || (mountedCtx.products && mountedCtx.products.length)) return;
        mountedCtx.products = cached.products || [];
        mountedCtx.categories = cached.categories || mountedCtx.categories || [];
        paint(mountedRoot, mountedCtx);
      }).catch(function () {});
    }
    refreshPending();
    paint(root, mountedCtx);
    onPosResize.stamp = layoutStamp();
  }

  function layoutStamp() {
    return slotColumns() + "x" + Math.round((global.innerHeight || 800) / 80);
  }

  function onPosResize() {
    var stamp = layoutStamp();
    if (stamp === onPosResize.stamp || !mountedRoot || !mountedCtx) return;
    onPosResize.stamp = stamp;
    paint(mountedRoot, mountedCtx);
  }

  global.ErvenowMerchantPos = {
    mount: mount,
    ticket: function () {
      return ticket;
    },
  };
})(typeof window !== "undefined" ? window : global);
