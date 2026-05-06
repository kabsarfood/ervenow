(function (w) {
  var TOKEN_KEY = "ervenow_access_token";
  var LEGACY_TOKEN_KEY = "erwenow_access_token";
  var FALLBACK_TOKEN_KEY = "token";
  var OFFLINE_QUEUE_KEY = "ervenow_offline_api_queue_v1";
  var MAX_OFFLINE_ITEMS = 40;
  /** بعد أول فشل: 3 إعادات محاولة = 4 محاولات إجمالاً */
  var MAX_FAILURE_RETRIES = 3;
  var IDEM_MAX = 256;

  function readApiBase() {
    if (w.__ERVENOW_API_BASE__ != null) {
      return String(w.__ERVENOW_API_BASE__).trim().replace(/\/$/, "");
    }
    try {
      if (typeof document !== "undefined") {
        var m = document.querySelector('meta[name="ervenow-api-base"]');
        if (m && m.getAttribute("content")) {
          return m.getAttribute("content").trim().replace(/\/$/, "");
        }
      }
    } catch (e) {}
    return "";
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function randomIdempotencyKey() {
    try {
      if (w.crypto && typeof w.crypto.randomUUID === "function") return w.crypto.randomUUID();
    } catch (e) {}
    return "idem-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2, 14);
  }

  function backoffMs(attemptIndex) {
    var base = 350 * Math.pow(2, attemptIndex);
    var jitter = Math.floor(Math.random() * 220);
    return Math.min(base + jitter, 8000);
  }

  function isMutationMethod(method) {
    var m = String(method || "GET").toUpperCase();
    return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
  }

  function shouldRetryHttpStatus(status) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }

  function isLikelyNetworkError(e) {
    var name = e && e.name;
    if (name === "AbortError") return true;
    var em = String((e && e.message) || e || "");
    return /Failed to fetch|NetworkError|networkerror|Load failed|fetch/i.test(em);
  }

  function loadOfflineQueue() {
    try {
      var raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveOfflineQueue(q) {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    } catch (e) {}
  }

  function emit(name, detail) {
    try {
      w.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
  }

  function humanizeHttpError(status, j) {
    var raw = j && (j.error || j.message) ? String(j.error || j.message).trim() : "";
    if (status === 401) return "انتهت الجلسة — سجّل الدخول من جديد.";
    if (status === 403) return "لا صلاحية لتنفيذ هذا الإجراء.";
    if (status === 404) return "المورد غير موجود أو لم يعد متاحاً.";
    if (status === 429) return "طلبات كثيرة — انتظر قليلاً ثم أعد المحاولة.";
    if (status >= 500 && status <= 599) return "الخادم مشغول حالياً — أعد المحاولة بعد لحظات.";
    if (raw && /[\u0600-\u06FF]/.test(raw)) return raw;
    if (raw) return raw;
    return "تعذّر إكمال الطلب (" + status + "). أعد المحاولة.";
  }

  function humanizeThrownError(e) {
    if (e && e.message) return String(e.message);
    return "حدث خطأ غير متوقع — أعد المحاولة.";
  }

  /**
   * @param {string} url
   * @param {RequestInit} [options]
   */
  function apiFetch(url, options) {
    options = options || {};
    var ms = Number(w.__ERVENOW_FETCH_TIMEOUT_MS) || 5000;
    var ctrl = new AbortController();
    var tid = setTimeout(function () {
      ctrl.abort();
    }, ms);
    var merged = Object.assign({}, options, { signal: ctrl.signal });
    return fetch(url, merged).finally(function () {
      clearTimeout(tid);
    });
  }

  function enqueueOffline(entry) {
    var q = loadOfflineQueue();
    if (entry.idempotencyKey) {
      q = q.filter(function (x) {
        return x.idempotencyKey !== entry.idempotencyKey;
      });
    }
    q.push(entry);
    if (q.length > MAX_OFFLINE_ITEMS) q = q.slice(-MAX_OFFLINE_ITEMS);
    saveOfflineQueue(q);
    emit("ervenow-offline-queued", { path: entry.path, queueLength: q.length });
  }

  var flushTimer = null;
  var flushing = false;

  async function flushOfflineQueueInternal() {
    if (flushing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    var q = loadOfflineQueue();
    if (!q.length) return;
    flushing = true;
    try {
      for (var i = 0; i < q.length; i++) {
        var item = q[i];
        try {
          await w.PlatformAPI.api(item.path, {
            method: item.method,
            body: item.body,
            idempotencyKey: item.idempotencyKey || undefined,
            skipOfflineQueue: true,
          });
        } catch (err) {
          saveOfflineQueue(q.slice(i));
          emit("ervenow-offline-flush-partial", {
            path: item.path,
            message: humanizeThrownError(err),
            remaining: q.length - i,
          });
          return;
        }
      }
      saveOfflineQueue([]);
      emit("ervenow-offline-flush-done", {});
    } finally {
      flushing = false;
    }
  }

  function scheduleFlushOffline() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () {
      flushOfflineQueueInternal().catch(function () {});
    }, 500);
  }

  if (typeof w.addEventListener === "function") {
    w.addEventListener("online", function () {
      scheduleFlushOffline();
    });
  }

  w.PlatformAPI = {
    getToken: function () {
      try {
        var tok = localStorage.getItem(TOKEN_KEY);
        if (tok) return tok;
        var legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
        if (legacy) {
          localStorage.setItem(TOKEN_KEY, legacy);
          localStorage.setItem(FALLBACK_TOKEN_KEY, legacy);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
          return legacy;
        }
        var fallback = localStorage.getItem(FALLBACK_TOKEN_KEY);
        if (fallback) {
          localStorage.setItem(TOKEN_KEY, fallback);
          return fallback;
        }
        return "";
      } catch (e) {
        return "";
      }
    },
    setToken: function (t) {
      try {
        if (t) {
          localStorage.setItem(TOKEN_KEY, t);
          localStorage.setItem(FALLBACK_TOKEN_KEY, t);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
          localStorage.removeItem(FALLBACK_TOKEN_KEY);
        }
      } catch (e) {}
    },
    apiUrl: function (path) {
      var base = readApiBase();
      var p = path.indexOf("/") === 0 ? path : "/" + path;
      return base ? base + p : p;
    },
    apiFetch: apiFetch,
    /** طول قائمة الانتظار عند انقطاع الشبكة (طلبات تعديل فقط) */
    getOfflineQueueLength: function () {
      return loadOfflineQueue().length;
    },
    /** محاولة يدوية لإرسال ما في قائمة الانتظار */
    flushOfflineQueue: function () {
      return flushOfflineQueueInternal();
    },
    /**
     * طلب API مع إعادة المحاولة، مفتاح Idempotency-Key، وقائمة انتظار عند العمل دون اتصال.
     * أحداث للواجهة: ervenow-api-retry، ervenow-offline-queued، ervenow-offline-flush-done، ervenow-offline-flush-partial
     * @param {string} path
     * @param {object} [opts]
     * @param {string} [opts.method]
     * @param {object|FormData} [opts.body]
     * @param {string} [opts.idempotencyKey] → رأس Idempotency-Key (يمنع التكرار مع الخادم حيث يُدعم)
     * @param {boolean} [opts.skipOfflineQueue]
     */
    api: async function (path, opts) {
      opts = opts || {};
      var headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      var tok = w.PlatformAPI.getToken();
      if (tok) headers.Authorization = "Bearer " + tok;

      var bodyObj = opts.body;
      var body = bodyObj;
      if (body && typeof body === "object" && !(body instanceof FormData)) {
        body = JSON.stringify(body);
      }

      var method = String(opts.method || (opts.body != null ? "POST" : "GET")).toUpperCase();

      var idem = opts.idempotencyKey
        ? String(opts.idempotencyKey).trim().slice(0, IDEM_MAX)
        : "";
      if (!idem && bodyObj && typeof bodyObj === "object" && !(bodyObj instanceof FormData)) {
        var bk = bodyObj.idempotency_key;
        if (bk != null && String(bk).trim()) idem = String(bk).trim().slice(0, IDEM_MAX);
      }
      if (idem) headers["Idempotency-Key"] = idem;

      var url = w.PlatformAPI.apiUrl(path);
      var totalAttempts = 1 + MAX_FAILURE_RETRIES;
      var skipOffline = !!opts.skipOfflineQueue;
      var lastErr = null;
      var lastStatus = 0;
      var lastJson = {};

      for (var attempt = 0; attempt < totalAttempts; attempt++) {
        if (attempt > 0) {
          emit("ervenow-api-retry", {
            path: path,
            attempt: attempt + 1,
            maxAttempts: totalAttempts,
            method: method,
          });
          await sleep(backoffMs(attempt - 1));
        }

        var r;
        try {
          r = await apiFetch(url, { method: method, headers: headers, body: body });
        } catch (e) {
          lastErr = e;
          var offline =
            typeof navigator !== "undefined" &&
            navigator.onLine === false &&
            !skipOffline &&
            isMutationMethod(method) &&
            !(bodyObj instanceof FormData);

          if (offline) {
            var keyForQueue = idem || randomIdempotencyKey();
            if (!headers["Idempotency-Key"] && isMutationMethod(method)) headers["Idempotency-Key"] = keyForQueue;
            enqueueOffline({
              path: path,
              method: method,
              body: bodyObj && typeof bodyObj === "object" && !(bodyObj instanceof FormData) ? bodyObj : null,
              idempotencyKey: keyForQueue,
              enqueuedAt: Date.now(),
            });
            throw new Error(
              "لا يوجد اتصال بالإنترنت. حُفظ الطلب محلياً وسيُرسل تلقائياً عند عودة الشبكة."
            );
          }

          var canRetryNet =
            attempt < totalAttempts - 1 &&
            ((e && e.name === "AbortError") || isLikelyNetworkError(e));
          if (canRetryNet) continue;

          if (e && e.name === "AbortError") {
            throw new Error("انتهت مهلة الاتصال بالخادم — أعد المحاولة أو تحقّق أن الخادم يعمل.");
          }
          if (isLikelyNetworkError(e)) {
            throw new Error(
              "تعذّر الاتصال بالخادم. إن كانت الواجهة على نطاق مختلف عن الـ API: أضف نطاق الواجهة إلى CORS_ORIGINS على الخادم، أو عيّن ERVENOW_PUBLIC_URL ليطابق رابط الموقع الظاهر للزائر."
            );
          }
          throw new Error(humanizeThrownError(e));
        }

        var j = await r.json().catch(function () {
          return {};
        });
        lastStatus = r.status;
        lastJson = j;

        if (r.ok) return j;

        var msg = humanizeHttpError(r.status, j);
        if (attempt < totalAttempts - 1 && shouldRetryHttpStatus(r.status)) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      if (lastErr) throw lastErr;
      throw new Error(humanizeHttpError(lastStatus, lastJson));
    },
  };

  if (typeof w !== "undefined" && w.document && w.document.readyState) {
    setTimeout(function () {
      scheduleFlushOffline();
    }, 1200);
  }
})(window);
