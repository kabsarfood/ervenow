/**
 * ERVENOW — حفظ مسودة النماذج في المتصفح
 * تبقى القيم بعد تحديث الصفحة أو مغادرتها حتى نجاح الإرسال.
 */
(function (global) {
  if (global.ErvenowFormDraft) return;

  var PREFIX = "ervenow:form-draft:v1:";
  var MAX_FIELD = 8000;
  var TTL_MS = 14 * 24 * 60 * 60 * 1000;
  var SKIP_TYPE = /^(password|file|submit|button|reset|image)$/i;
  var SKIP_NAME = /(password|passwd|passcode|otp|one.?time|pin\b|cvv|cvc|card.?number|secret|token|captcha|csrf)/i;
  var SKIP_AUTOCOMPLETE = /^(new-password|current-password|one-time-code|cc-number|cc-csc|cc-exp)$/i;
  var EXCLUDE_PATH = [
    /^\/admin(\/|$|-)/i,
    /^\/checkout(\/|$)/i,
    /^\/cart(\/|$)/i,
    /^\/pay(\/|$)/i,
    /^\/login(\/|$)/i,
    /^\/admin-login(\/|$)/i,
    /^\/driver-login(\/|$)/i,
    /^\/service-provider-login(\/|$)/i,
    /^\/delivery\/login(\/|$)/i,
    /^\/store-dashboard(\/|$)/i,
    /^\/merchant-dashboard(\/|$)/i,
    /^\/driver-dashboard(\/|$)/i,
    /^\/driver-app(\/|$)/i,
    /^\/wallet(\/|$)/i,
    /^\/driver-wallet(\/|$)/i,
    /^\/order-board(\/|$)/i,
  ];

  var saveTimer = null;
  var restoring = false;
  var didFullRestore = false;
  var bound = false;

  function pagePath() {
    var p = String(global.location.pathname || "/").replace(/\/+$/, "") || "/";
    return p;
  }

  function storageKey() {
    return PREFIX + pagePath();
  }

  function excluded() {
    var root = document.documentElement;
    if (root && root.getAttribute("data-form-draft") === "off") return true;
    if (document.body && document.body.getAttribute("data-form-draft") === "off") return true;
    var p = pagePath();
    for (var i = 0; i < EXCLUDE_PATH.length; i++) {
      if (EXCLUDE_PATH[i].test(p)) return true;
    }
    return false;
  }

  function fieldId(el) {
    return String((el && (el.id || el.name)) || "").trim();
  }

  function skipField(el) {
    if (!el || el.disabled) return true;
    if (el.getAttribute("data-form-draft") === "skip") return true;
    if (el.closest && el.closest("[data-form-draft='off'], [data-form-draft='skip']")) return true;
    var type = String(el.type || el.tagName || "").toLowerCase();
    if (SKIP_TYPE.test(type)) return true;
    var idn = fieldId(el);
    if (!idn) return true;
    if (SKIP_NAME.test(idn)) return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    if (SKIP_AUTOCOMPLETE.test(ac)) return true;
    return false;
  }

  function collectFields() {
    return document.querySelectorAll("input, select, textarea");
  }

  function readField(el) {
    var tag = String(el.tagName || "").toLowerCase();
    var type = String(el.type || "").toLowerCase();
    if (tag === "select" && el.multiple) {
      var multi = Array.prototype.map
        .call(el.selectedOptions || [], function (o) {
          return String(o.value || "");
        })
        .filter(Boolean);
      return { t: "multi", v: multi };
    }
    if (type === "checkbox") return { t: "check", v: !!el.checked };
    if (type === "radio") return { t: "radio", v: el.checked ? String(el.value || "") : null };
    var val = String(el.value == null ? "" : el.value);
    if (val.length > MAX_FIELD) val = val.slice(0, MAX_FIELD);
    return { t: "text", v: val };
  }

  function isEmptyField(el) {
    var tag = String(el.tagName || "").toLowerCase();
    var type = String(el.type || "").toLowerCase();
    if (tag === "select" && el.multiple) return !(el.selectedOptions && el.selectedOptions.length);
    if (type === "checkbox") return !el.checked;
    if (type === "radio") return !el.checked;
    return String(el.value || "").trim() === "";
  }

  function applyField(el, rec, onlyIfEmpty) {
    if (!rec) return false;
    if (onlyIfEmpty && !isEmptyField(el)) return false;
    var tag = String(el.tagName || "").toLowerCase();
    var type = String(el.type || "").toLowerCase();
    if (tag === "select" && el.multiple) {
      var set = {};
      (rec.v || []).forEach(function (s) {
        set[String(s)] = true;
      });
      var any = false;
      Array.prototype.forEach.call(el.options || [], function (o) {
        var on = !!set[String(o.value || "")];
        if (on) any = true;
        o.selected = on;
      });
      return any || (rec.v && rec.v.length === 0);
    }
    if (type === "checkbox") {
      el.checked = !!rec.v;
      return true;
    }
    if (type === "radio") {
      if (rec.v == null) return false;
      if (String(el.value) === String(rec.v)) {
        el.checked = true;
        return true;
      }
      return false;
    }
    el.value = rec.v == null ? "" : String(rec.v);
    return true;
  }

  function readDetails() {
    var out = {};
    document.querySelectorAll("details[id]").forEach(function (d) {
      if (d.classList && d.classList.contains("reg-store-acc")) {
        out[d.id] = !!d.open;
      }
    });
    return out;
  }

  function applyDetails(map) {
    if (!map) return;
    var ids = Object.keys(map);
    if (!ids.length) return;
    ids.forEach(function (id) {
      var d = document.getElementById(id);
      if (d && d.tagName === "DETAILS") d.open = !!map[id];
    });
  }

  function loadRaw() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.v !== 1 || !data.fields) return null;
      if (data.savedAt && Date.now() - Number(data.savedAt) > TTL_MS) {
        localStorage.removeItem(storageKey());
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function persist(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {
      try {
        pruneOld();
        localStorage.setItem(storageKey(), JSON.stringify(data));
      } catch (e2) {}
    }
  }

  function pruneOld() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) keys.push(k);
    }
    keys.forEach(function (k) {
      try {
        var d = JSON.parse(localStorage.getItem(k) || "null");
        if (!d || !d.savedAt || Date.now() - Number(d.savedAt) > TTL_MS) {
          localStorage.removeItem(k);
        }
      } catch (e) {
        localStorage.removeItem(k);
      }
    });
  }

  function snapshot() {
    if (excluded()) return null;
    var fields = {};
    var count = 0;
    collectFields().forEach(function (el) {
      if (skipField(el)) return;
      var id = fieldId(el);
      var rec = readField(el);
      if (rec.t === "radio" && rec.v == null) return;
      if (rec.t === "text" && rec.v === "") return;
      if (rec.t === "multi" && (!rec.v || !rec.v.length)) return;
      fields[id] = rec;
      count += 1;
    });
    if (!count) return null;
    var prev = loadRaw() || {};
    return {
      v: 1,
      path: pagePath(),
      savedAt: Date.now(),
      fields: fields,
      extras: prev.extras || {},
      details: readDetails(),
    };
  }

  function save() {
    if (restoring || excluded()) return;
    var data = snapshot();
    if (!data) return;
    persist(data);
  }

  function scheduleSave() {
    if (restoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 180);
  }

  function restore(opts) {
    opts = opts || {};
    if (excluded()) return false;
    var data = loadRaw();
    if (!data || !data.fields) return false;
    restoring = true;
    var onlyIfEmpty = !!opts.onlyIfEmpty || didFullRestore;
    var changed = [];
    collectFields().forEach(function (el) {
      if (skipField(el)) return;
      var id = fieldId(el);
      var rec = data.fields[id];
      if (!rec) return;
      if (applyField(el, rec, onlyIfEmpty)) changed.push(el);
    });
    if (!didFullRestore) applyDetails(data.details);
    changed.forEach(function (el) {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}
    });
    restoring = false;
    if (changed.length) {
      didFullRestore = true;
      try {
        document.dispatchEvent(
          new CustomEvent("ervenow:form-draft-restored", { detail: { path: pagePath(), count: changed.length } })
        );
      } catch (e) {}
    }
    return changed.length > 0;
  }

  function clear() {
    try {
      localStorage.removeItem(storageKey());
    } catch (e) {}
  }

  function setExtra(key, value) {
    var data = loadRaw() || snapshot() || { v: 1, path: pagePath(), savedAt: Date.now(), fields: {}, extras: {} };
    data.extras = data.extras || {};
    if (value == null) delete data.extras[key];
    else data.extras[key] = value;
    data.savedAt = Date.now();
    persist(data);
  }

  function getExtra(key) {
    var data = loadRaw();
    if (!data || !data.extras) return null;
    return data.extras[key];
  }

  function looksSuccessful() {
    var nodes = document.querySelectorAll(".msg.ok, .msg.success, [data-form-draft-success]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var style = global.getComputedStyle ? getComputedStyle(el) : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) continue;
      if (el.hidden) continue;
      return true;
    }
    return false;
  }

  function bind() {
    if (bound || excluded()) return;
    bound = true;
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || skipField(t)) return;
      scheduleSave();
    }, true);
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t) return;
      if (t.tagName === "DETAILS" || (t.closest && t.closest("details"))) scheduleSave();
      if (skipField(t)) return;
      scheduleSave();
    }, true);
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || String(form.tagName) !== "FORM") return;
      if (form.getAttribute("data-form-draft") === "keep") return;
      if (!e.defaultPrevented) {
        setTimeout(clear, 0);
      }
    }, true);
    if (typeof MutationObserver !== "undefined" && document.body) {
      var obs = new MutationObserver(function () {
        if (looksSuccessful()) clear();
      });
      obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    }
    global.addEventListener("pagehide", save);
    global.addEventListener("beforeunload", save);
  }

  function boot() {
    if (excluded()) return;
    bind();
    restore({ onlyIfEmpty: false });
    setTimeout(function () {
      restore({ onlyIfEmpty: true });
    }, 400);
    setTimeout(function () {
      restore({ onlyIfEmpty: true });
    }, 1200);
  }

  global.ErvenowFormDraft = {
    save: save,
    restore: restore,
    clear: clear,
    setExtra: setExtra,
    getExtra: getExtra,
    pagePath: pagePath,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  global.addEventListener("pageshow", function () {
    if (excluded()) return;
    restore({ onlyIfEmpty: true });
  });
})(window);
