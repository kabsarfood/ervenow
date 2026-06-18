(function (global) {
  var CACHE = {};
  var ENABLED = true;
  var SOUNDS = {
    notify: ["/assets/sounds/EW_NOTIFY.mp3", "/assets/sounds/EW_NOTIFY.wav"],
    broadcast: ["/assets/sounds/EW_BROADCAST.mp3", "/assets/sounds/EW_BROADCAST.wav"],
    alert: ["/assets/sounds/EW_ALERT.mp3", "/assets/sounds/EW_ALERT.wav"],
  };

  function playUrl(url) {
    if (!ENABLED || !url) return;
    try {
      if (!CACHE[url]) CACHE[url] = new Audio(url);
      var a = CACHE[url];
      a.volume = 0.85;
      a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (_) {}
  }

  function play(kind) {
    var urls = SOUNDS[kind] || SOUNDS.notify;
    if (!Array.isArray(urls)) urls = [urls];
    playUrl(urls[0]);
  }

  function pickSound(item) {
    if (!item) return "notify";
    var type = String(item.type || "").toLowerCase();
    var payload = item.payload && typeof item.payload === "object" ? item.payload : {};
    var category = String(payload.category || "").toLowerCase();
    if (type === "broadcast") {
      if (category === "alert" || category === "تنبيه") return "alert";
      return "broadcast";
    }
    if (type === "account" && /تعليق|رفض|حظر/.test(String(item.title || ""))) return "alert";
    return "notify";
  }

  function playForItem(item) {
    play(pickSound(item));
  }

  global.ErvenowNotificationSounds = {
    play: play,
    pickSound: pickSound,
    playForItem: playForItem,
    setEnabled: function (on) {
      ENABLED = !!on;
    },
  };
})(window);
