/**
 * ضغط صورة في المتصفح قبل الرفع — JPEG حتى ~500KB–1MB مع جودة معقولة.
 * الاستخدام: const blob = await window.compressImage(file, 0.72, 1280);
 */
(function (w) {
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        resolve(r.result);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /**
   * @param {File} file
   * @param {number} quality 0..1
   * @param {number} maxWidth
   * @returns {Promise<Blob>}
   */
  async function compressImage(file, quality, maxWidth) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      throw new Error("اختر ملف صورة");
    }
    var q = quality == null ? 0.72 : quality;
    var mw = maxWidth == null ? 1280 : maxWidth;

    var dataUrl = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    var img = await new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error("تعذر قراءة الصورة"));
      };
      image.src = dataUrl;
    });

    var w0 = img.width;
    var h0 = img.height;
    var tw = w0;
    var th = h0;
    if (tw > mw) {
      th = Math.round((th * mw) / tw);
      tw = mw;
    }

    var canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("المتصفح لا يدعم معالجة الصور");
    ctx.drawImage(img, 0, 0, tw, th);

    var blob = await new Promise(function (resolve) {
      canvas.toBlob(
        function (b) {
          resolve(b);
        },
        "image/jpeg",
        q
      );
    });

    if (!blob) throw new Error("فشل ضغط الصورة");

    // إن ما زالت كبيرة جداً، خفّض الجودة مرة ثانية
    if (blob.size > 1024 * 1024 && q > 0.45) {
      return compressImage(file, q - 0.12, Math.floor(mw * 0.85));
    }

    return blob;
  }

  w.compressImage = compressImage;
  w.compressImageToDataUrl = async function (file, quality, maxWidth) {
    var blob = await compressImage(file, quality, maxWidth);
    return blobToDataUrl(blob);
  };
})(window);
