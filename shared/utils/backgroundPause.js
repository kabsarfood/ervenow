/**
 * إيقاف مؤقت لعامل خلفية بعد مهلتين متتاليتين.
 * كل عامل يأخذ تأخيراً مختلفاً حتى لا يستيقظوا معاً.
 */
const PAUSE_MS = 2 * 60 * 1000;

const STAGGER_MS = {
  gasRadius: 0,
  retryNotifications: 15 * 1000,
  purgeClosedOrders: 30 * 1000,
  siteMaintenance: 7 * 1000,
  liveMapPublic: 22 * 1000,
};

function createBackgroundPause(options) {
  const opts = options || {};
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const pauseMs = Number.isFinite(opts.pauseMs) ? opts.pauseMs : PAUSE_MS;
  const staggerMs = Math.max(0, Number(opts.staggerMs) || 0);
  let consecutive = 0;
  let pausedUntil = 0;

  return {
    shouldSkip() {
      return now() < pausedUntil;
    },
    noteSuccess() {
      consecutive = 0;
    },
    noteTimeout() {
      consecutive += 1;
      if (consecutive >= 2) {
        pausedUntil = now() + pauseMs + staggerMs;
        consecutive = 0;
      }
    },
  };
}

module.exports = {
  PAUSE_MS,
  STAGGER_MS,
  createBackgroundPause,
};
