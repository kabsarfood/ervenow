/**
 * Checkout page — allow longer server round-trip than default 5s API timeout.
 */
(function (w) {
  w.__ERVENOW_FETCH_TIMEOUT_MS = 60000;
})(typeof window !== "undefined" ? window : global);
