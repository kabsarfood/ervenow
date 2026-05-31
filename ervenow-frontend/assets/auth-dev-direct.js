/**
 * الدخول المباشر / وضع التطوير — معطّل في المنصة.
 * يُبقى الملف للتوافق مع صفحات قديمة دون عرض أي زر.
 */
(function (global) {
  function initDevDirectButton() {
    /* no-op — تم إزالة الدخول المباشر */
  }

  global.ErvenowAuthDevDirect = {
    initDevDirectButton: initDevDirectButton,
    disabled: true,
  };
})(window);
