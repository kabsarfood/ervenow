import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HEADER = (active, tag) => `    <header class="dash-site-header">
      <div class="dash-site-header__inner">
        <div class="dash-site-header__brand">
          <a class="dash-site-header__logo" href="/">
            ERVENOW
            <span class="dash-site-header__logo-dot" aria-hidden="true"></span>
          </a>
          <p class="dash-site-header__tag" id="guestShellPageTag">${tag}</p>
        </div>
        <nav class="dash-site-header__nav" aria-label="التنقل الرئيسي">
          <div class="dash-site-header__links">
            <a class="dash-site-header__link${active === "guest" ? " is-active" : ""}" href="/dashboard" data-nav="guest"${active === "guest" ? ' aria-current="page"' : ""}>لوحة الزائر</a>
            <a class="dash-site-header__link${active === "restaurants" ? " is-active" : ""}" href="/restaurants" data-nav="restaurants"${active === "restaurants" ? ' aria-current="page"' : ""}>مطاعم</a>
            <a class="dash-site-header__link${active === "stores" ? " is-active" : ""}" href="/stores" data-nav="stores"${active === "stores" ? ' aria-current="page"' : ""}>متاجر</a>
            <a class="dash-site-header__link${active === "delivery" ? " is-active" : ""}" href="/delivery-services.html" data-nav="delivery"${active === "delivery" ? ' aria-current="page"' : ""}>توصيل</a>
            <a class="dash-site-header__link${active === "services" ? " is-active" : ""}" href="/services" data-nav="services"${active === "services" ? ' aria-current="page"' : ""}>خدمات</a>
            <a class="dash-site-header__link${active === "home" ? " is-active" : ""}" href="/" data-nav="home"${active === "home" ? ' aria-current="page"' : ""}>الرئيسية</a>
          </div>
        </nav>
        <div class="dash-site-header__tools">
          <a class="dash-header-wallet" id="dashHeaderWallet" href="/wallet.html" hidden aria-label="المحفظة">
            <span class="dash-header-wallet__label">محفظة</span>
            <span class="dash-header-wallet__val" id="dashHeaderWalletAmount">—</span>
            <span class="dash-header-wallet__cur">ر.س</span>
          </a>
          <a class="dash-header-cart" href="/cart" aria-label="السلة — الدفع">
            <span aria-hidden="true">🛒</span>
            <span class="dash-header-cart__label">السلة</span>
            <span class="dash-header-cart__badge" id="cartCount" data-empty="true">0</span>
          </a>
        </div>
        <a class="dash-site-header__btn dash-site-header__btn--primary" href="/login?role=customer" id="switchAccount">تسجيل الدخول</a>
      </div>
    </header>`;

const FOOTER = `      <footer class="dash-site-footer">
        <div class="dash-site-footer__logo">ERVENOW</div>
        <nav class="dash-site-footer__links" aria-label="روابط سفلية">
          <a class="dash-site-footer__link" href="/restaurants">مطاعم</a>
          <a class="dash-site-footer__link" href="/stores">متاجر</a>
          <a class="dash-site-footer__link" href="/delivery-services.html">توصيل</a>
          <a class="dash-site-footer__link" href="/services">خدمات</a>
          <a class="dash-site-footer__link" href="/dashboard#dashDeliveryTitle">طلب من الخريطة</a>
          <a class="dash-site-footer__link" href="/start-now.html">ابدأ الآن</a>
          <a class="dash-site-footer__link" href="/">الرئيسية</a>
        </nav>
        <p class="dash-site-footer__copy">© 2026 ERVENOW — جميع الحقوق محفوظة</p>
      </footer>`;

const SHELL_INIT = (active, tag) => `
    <script src="/assets/cart.js"></script>
    <script src="/assets/guest-shell.js"></script>
    <script>
      ErvenowGuestShell.init({ activeNav: "${active}", pageTag: ${JSON.stringify(tag)} });
    </script>`;

function ensureHeadLinks(html) {
  if (!html.includes("guest-shell.css")) {
    html = html.replace(
      /<link rel="stylesheet" href="\/assets\/styles\.css" \/>/,
      '<link rel="stylesheet" href="/assets/styles.css" />\n    <link rel="stylesheet" href="/assets/guest-shell.css" />'
    );
  }
  html = html.replace(
    /family=Cairo:wght@[^"&]+/g,
    "family=Cairo:wght@400;600;700;800;900"
  );
  if (!html.includes("fonts.googleapis.com") && html.includes("<head>")) {
    html = html.replace(
      "<head>",
      `<head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet" />`
    );
  }
  return html;
}

function injectScripts(html, active, tag) {
  if (html.includes("ErvenowGuestShell.init")) return html;
  const init = SHELL_INIT(active, tag);
  if (html.includes('src="/assets/api-config.js"')) {
    html = html.replace(
      /(\s*<script src="\/assets\/api-config\.js"><\/script>)/,
      init + "$1"
    );
  } else if (html.includes('src="/assets/guestBrowse.js"')) {
    html = html.replace(
      /(\s*<script src="\/assets\/guestBrowse\.js"><\/script>)/,
      init + "$1"
    );
  } else {
    html = html.replace(/<\/body>/, init + "\n  </body>");
  }
  return html;
}

function patchCatalog(file, active, tag, heroHtml) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);

  // Remove old sticky stores-header block
  html = html.replace(/      \.stores-header[\s\S]*?      \.stores-header__actions \.btn \{[\s\S]*?\}\n\n/, "");

  html = html.replace(
    /<body class="stores-page">[\s\S]*?<header class="stores-header">[\s\S]*?<\/header>\n\n/,
    `<body class="guest-shell-page stores-page">\n${HEADER(active, tag)}\n\n    <div class="dash-main">\n      <div class="guest-section-hero">\n        <div class="guest-section-hero__inner">\n${heroHtml}\n        </div>\n      </div>\n\n      <div class="layout">\n`
  );

  if (!html.includes("dash-site-footer")) {
    html = html.replace(
      /(\n    <script src="\/assets\/api-config\.js")/,
      `\n    </div>\n${FOOTER}\n    </div>\n$1`
    );
  } else if (html.includes('<div class="layout">') && html.match(/<footer class="dash-site-footer">[\s\S]*?<\/footer>\s*\n\s*<\/div>\s*\n\s*<\/div>/)) {
    html = html.replace(
      /(\n)([ \t]*)<footer class="dash-site-footer">([\s\S]*?)<\/footer>\n[ \t]*<\/div>\n[ \t]*<\/div>/,
      (_, nl, _i, body) => {
        const inner = body.replace(/\n[ \t]{6}/g, "\n      ");
        return `${nl}      </div>${nl}${nl}    <footer class="dash-site-footer">${inner}</footer>${nl}    </div>`;
      }
    );
  }

  html = injectScripts(html, active, tag);
  fs.writeFileSync(file, html);
  console.log("patched catalog:", path.basename(file));
}

function patchSimplePage(file, active, tag, bodyClass, removeTopNav) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);

  if (removeTopNav) {
    html = html.replace(/      \.top-nav[\s\S]*?\}\n\n/g, "");
  }

  const bodyRe = bodyClass
    ? new RegExp(`<body(?: class="[^"]*")?>`)
    : /<body>/;
  html = html.replace(
    bodyRe,
    `<body class="guest-shell-page${bodyClass ? " " + bodyClass : ""}">\n${HEADER(active, tag)}\n\n    <div class="dash-main">\n      <div class="layout">`
  );

  if (html.includes('<div class="layout browse-wrap">')) {
    html = html.replace('<div class="layout browse-wrap">', '<div class="layout browse-wrap" style="max-width:min(1120px,100%);margin:0 auto">');
  }

  if (html.includes('<div class="top-nav">')) {
    html = html.replace(/      <div class="top-nav">[\s\S]*?<\/div>\n\n/, "");
  }

  if (html.includes("browse-head")) {
    html = html.replace(
      /<div class="card browse-head">[\s\S]*?<\/div>\n\n/,
      '<h1 class="guest-page-title">نتائج التصفح</h1>\n\n'
    );
  }

  if (!html.includes("dash-site-footer")) {
    html = html.replace(/(\n    <script)/, `\n${FOOTER}\n      </div>\n    </div>\n$1`);
  }

  html = injectScripts(html, active, tag);
  fs.writeFileSync(file, html);
  console.log("patched simple:", path.basename(file));
}

function patchStartNow(file) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);
  html = html.replace(/      \.sn-header[\s\S]*?      \.sn-header__btn:hover \{ opacity: \.88; \}\n/, "");
  html = html.replace(
    /<body>[\s\S]*?<header class="sn-header">[\s\S]*?<\/header>\n\n/,
    `<body class="guest-shell-page sn-page">\n${HEADER("home", "ابدأ الآن")}\n\n    <div class="dash-main">\n`
  );
  if (!html.includes("dash-site-footer")) {
    html = html.replace(
      /(\n    <script src="\/assets\/guestBrowse\.js")/,
      `\n${FOOTER}\n    </div>\n$1`
    );
  }
  html = injectScripts(html, "home", "ابدأ الآن");
  fs.writeFileSync(file, html);
  console.log("patched start-now");
}

function patchGasDelivery(file) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);
  if (html.includes("dash-site-header")) {
    console.log("skip gas-delivery (already patched):", path.basename(file));
    return;
  }
  html = html.replace(
    /<body>[\s\S]*?<div class="(?:layout gd-wrap|gd-wrap)">/,
    `<body class="guest-shell-page">\n${HEADER("delivery", "توصيل الغاز")}\n\n    <div class="dash-main">\n      <div class="layout">\n        <div class="gd-wrap" style="max-width:640px;margin:0 auto;padding:0 0 24px">\n          <h1 class="guest-page-title">توصيل الغاز</h1>`
  );
  html = html.replace(
    /<div class="card" style="display: flex;[\s\S]*?<\/div>\s*\n\s*\n\s*<div class="card" style="margin-top: 12px">/,
    '<div class="card" style="margin-top: 12px">'
  );
  if (!html.includes("dash-site-footer")) {
    html = html.replace(
      /(\n    <script src="https:\/\/unpkg.com\/leaflet)/,
      `\n        </div>\n${FOOTER}\n      </div>\n    </div>\n$1`
    );
  }
  html = injectScripts(html, "delivery", "توصيل الغاز");
  fs.writeFileSync(file, html);
  console.log("patched gas-delivery");
}

function patchStore(file) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);
  if (html.includes("dash-site-header")) return;
  html = html.replace(
    /<body>/,
    `<body class="guest-shell-page">\n${HEADER("stores", "صفحة المتجر")}\n\n    <div class="dash-main">\n      <div class="layout">`
  );
  if (!html.includes("dash-site-footer")) {
    html = html.replace(/(\n    <script src="\/assets\/api-config)/, `\n${FOOTER}\n      </div>\n    </div>\n$1`);
  }
  html = injectScripts(html, "stores", "صفحة المتجر");
  fs.writeFileSync(file, html);
  console.log("patched store");
}

function patchCareers(file) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);
  if (html.includes("dash-site-header")) {
    console.log("skip careers (already patched):", path.basename(file));
    return;
  }
  html = html.replace(
    /<body>[\s\S]*?<div class="layout">/,
    `<body class="guest-shell-page">\n${HEADER("home", "الوظائف")}\n\n    <div class="dash-main">\n      <div class="layout">`
  );
  html = html.replace(/<p><a href="\/">← الرئيسية<\/a><\/p>\s*\n\s*/g, "");
  html = html.replace(/<h1>بوابة التوظيف<\/h1>/, '<h1 class="guest-page-title">بوابة التوظيف</h1>');
  if (!html.includes("dash-site-footer")) {
    html = html.replace(
      /(\n    <script src="\/assets\/cart\.js")/,
      `\n      </div>\n${FOOTER}\n    </div>\n$1`
    );
  }
  html = injectScripts(html, "home", "الوظائف");
  fs.writeFileSync(file, html);
  console.log("patched careers");
}

function patchDashboard(file) {
  let html = fs.readFileSync(file, "utf8");
  html = ensureHeadLinks(html);
  if (!html.includes('href="/assets/guest-shell.css"')) {
    html = html.replace(
      '<link rel="stylesheet" href="/assets/styles.css" />',
      '<link rel="stylesheet" href="/assets/styles.css" />\n    <link rel="stylesheet" href="/assets/guest-shell.css" />'
    );
  }
  // Remove duplicated shell CSS block (dash-main through dash-main .layout)
  html = html.replace(
    /      \.dash-main \{[\s\S]*?      \.dash-main \.layout \{[\s\S]*?\}\n/,
    ""
  );
  html = html.replace(
    /      body \{[\s\S]*?      \}\n      \.dash-site-header \{/,
    "      .dash-site-header {"
  );
  // Remove entire header/footer CSS through layout - keep from dash-site-header if body block removed wrong

  // Simpler: remove lines 12-353 style block for shell only
  html = html.replace(
    /    <style>\n      \.dash-main \{[\s\S]*?      \.dash-main \.layout \{[\s\S]*?\}\n/,
    "    <style>\n"
  );
  html = html.replace(
    /      body \{\n[\s\S]*?flex-direction: column;\n      \}\n/,
    ""
  );

  html = html.replace('<body>', '<body class="guest-shell-page">');
  html = html.replace(
    '<a class="dash-site-header__link is-active" href="/dashboard" aria-current="page">لوحة الزائر</a>',
    '<a class="dash-site-header__link is-active" href="/dashboard" data-nav="guest" aria-current="page">لوحة الزائر</a>'
  );
  html = html.replace(
    '<a class="dash-site-header__link" href="/restaurants">مطاعم</a>',
    '<a class="dash-site-header__link" href="/restaurants" data-nav="restaurants">مطاعم</a>'
  );
  html = html.replace(
    '<a class="dash-site-header__link" href="/stores">متاجر</a>',
    '<a class="dash-site-header__link" href="/stores" data-nav="stores">متاجر</a>'
  );
  html = html.replace(
    '<a class="dash-site-header__link" href="/delivery-services.html">توصيل</a>',
    '<a class="dash-site-header__link" href="/delivery-services.html" data-nav="delivery">توصيل</a>'
  );
  html = html.replace(
    '<a class="dash-site-header__link" href="/services">خدمات</a>',
    '<a class="dash-site-header__link" href="/services" data-nav="services">خدمات</a>'
  );
  html = html.replace(
    '<a class="dash-site-header__link" href="/">الرئيسية</a>',
    '<a class="dash-site-header__link" href="/" data-nav="home">الرئيسية</a>'
  );
  html = html.replace(
    '<p class="dash-site-header__tag">لوحة زائر المنصة</p>',
    '<p class="dash-site-header__tag" id="guestShellPageTag">لوحة زائر المنصة</p>'
  );

  if (!html.includes("guest-shell.js")) {
    html = html.replace(
      '<script src="/assets/cart.js"></script>',
      '<script src="/assets/cart.js"></script>\n    <script src="/assets/guest-shell.js"></script>\n    <script>ErvenowGuestShell.init({ activeNav: "guest", pageTag: "لوحة زائر المنصة" });</script>'
    );
  }

  fs.writeFileSync(file, html);
  console.log("patched dashboard");
}

const dirs = ["ervenow-frontend", "public"];

for (const dir of dirs) {
  const base = path.join(ROOT, dir);

  patchCatalog(
    path.join(base, "restaurants.html"),
    "restaurants",
    "اكتشف المطاعم",
    `          <p class="guest-section-hero__eyebrow">أهلاً بك في ERVENOW</p>
          <h1 class="guest-section-hero__title">اكتشف ألذ الأكلات</h1>
          <p class="guest-section-hero__sub">مطاعم معتمدة — تصنيفات المطابخ، بحث بالاسم، وتوصيل لبابك</p>
          <p class="guest-section-hero__hint">يظهر المطعم هنا بعد <strong>موافقة الإدارة</strong> وتفعيله على المنصة.</p>`
  );

  patchCatalog(
    path.join(base, "stores.html"),
    "stores",
    "اكتشف المتاجر",
    `          <p class="guest-section-hero__eyebrow">أهلاً بك في ERVENOW</p>
          <h1 class="guest-section-hero__title">اكتشف المتاجر</h1>
          <p class="guest-section-hero__sub">متاجر معتمدة — بحث، فلاتر، وتجربة قريبة من تطبيقات التوصيل الكبرى</p>`
  );

  patchCatalog(
    path.join(base, "services.html"),
    "services",
    "خدمات منزلية",
    `          <p class="guest-section-hero__eyebrow">أهلاً بك في ERVENOW</p>
          <h1 class="guest-section-hero__title">خدمات منزلية</h1>
          <p class="guest-section-hero__sub" id="servicesHeaderSub">سباك، كهرباء، تكييف، تنظيف، وأكثر — احجز بخطوات بسيطة</p>`
  );

  patchStartNow(path.join(base, "start-now.html"));
  patchSimplePage(path.join(base, "cart.html"), "guest", "السلة", "", true);
  patchSimplePage(path.join(base, "browse.html"), "guest", "التصفح", "", false);
  patchSimplePage(path.join(base, "order.html"), "delivery", "طلب توصيل", "", true);
  patchSimplePage(path.join(base, "track.html"), "guest", "تتبع الطلب", "", true);
  patchGasDelivery(path.join(base, "gas-delivery.html"));
  patchStore(path.join(base, "store.html"));
  patchCareers(path.join(base, "careers.html"));
  patchDashboard(path.join(base, "dashboard.html"));
}

console.log("Done.");
