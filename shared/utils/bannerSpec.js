/**
 * ERVENOW — المقاس الرسمي الموحّد لجميع البنرات
 */
const BANNER_WIDTH = 1920;
const BANNER_HEIGHT = 730;
const BANNER_ASPECT_RATIO = `${BANNER_WIDTH} / ${BANNER_HEIGHT}`;
const BANNER_OBJECT_FIT = "cover";

const BANNER_SPEC = {
  width: BANNER_WIDTH,
  height: BANNER_HEIGHT,
  aspect_ratio: BANNER_ASPECT_RATIO,
  aspect_ratio_numeric: BANNER_WIDTH / BANNER_HEIGHT,
  object_fit: BANNER_OBJECT_FIT,
  label: `${BANNER_WIDTH}×${BANNER_HEIGHT}`,
  label_ar: `${BANNER_WIDTH}×${BANNER_HEIGHT} بكسل`,
  admin_hint_ar:
    "ارفع صورة واحدة بالمقاس 1920×730 بكسل — تُعرض تلقائياً بـ object-fit: cover دون تشويه أو تمدد.",
  css_vars: {
    "--erv-banner-width": String(BANNER_WIDTH),
    "--erv-banner-height": String(BANNER_HEIGHT),
    "--erv-banner-aspect": BANNER_ASPECT_RATIO,
  },
};

module.exports = {
  BANNER_WIDTH,
  BANNER_HEIGHT,
  BANNER_ASPECT_RATIO,
  BANNER_OBJECT_FIT,
  BANNER_SPEC,
};
