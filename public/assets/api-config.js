/**
 * رابط خادم API على Railway (بدون / أخيرة). للواجهة على Vercel ضع الرابط هنا مثلًا:
 *   window.__ERVENOW_API_BASE__ = "https://your-service.up.railway.app";
 *
 * إذا تركتها "" يُفترض أن الطلبات من نفس النطاق (Express يقدّم الواجهة والـ API معًا).
 */
(function (w) {
  if (w.__ERVENOW_API_BASE__ == null || String(w.__ERVENOW_API_BASE__).trim() === "") {
    w.__ERVENOW_API_BASE__ = "";
  }
})(typeof window !== "undefined" ? window : globalThis);
