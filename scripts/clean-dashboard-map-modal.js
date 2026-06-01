/**
 * Remove embedded map modal from dashboard; link to /delivery-map
 */
const fs = require("fs");
const path = require("path");

const dashPath = path.join(__dirname, "..", "public", "dashboard.html");
let html = fs.readFileSync(dashPath, "utf8");

const linkCard =
  '              <a class="cat-card cat-card--map-link" href="/delivery-map" data-dash-map-jump>\n' +
  '                <span class="cat-card__icon" aria-hidden="true">🗺️</span>\n' +
  "                <strong>من الخريطة</strong>\n" +
  '                <span class="cat-card__badge" aria-hidden="true">⚡ فوري</span>\n' +
  "                <span>احسب المسافة وأضف للسلة في دقائق.</span>\n" +
  "              </a>\n";

const detailsStart = html.indexOf('<details class="cat-card cat-card--map"');
const detailsEnd = html.indexOf("</details>", detailsStart) + "</details>".length;
if (detailsStart < 0) throw new Error("details not found");
html = html.slice(0, detailsStart) + linkCard + html.slice(detailsEnd);

html = html.replace(
  /<div id="dashMapBackdrop" class="dash-map-backdrop" hidden aria-hidden="true"><\/div>\s*\n/,
  ""
);

html = html.replace(
  '<a class="dash-site-footer__link" href="/dashboard#dashDeliveryTitle">من الخريطة</a>',
  '<a class="dash-site-footer__link" href="/delivery-map">من الخريطة</a>'
);

html = html.replace(
  /<script src="\/assets\/delivery-map-order\.js"><\/script>\s*\n\s*<script src="https:\/\/unpkg.com\/leaflet/,
  '<script src="https://unpkg.com/leaflet'
);
html = html.replace(
  /<link rel="stylesheet" href="https:\/\/unpkg.com\/leaflet@1\.9\.4\/dist\/leaflet\.css" \/>\s*\n/,
  ""
);

const scriptStart = html.indexOf("      var km = 0;");
const scriptEnd = html.indexOf("      function roleLabelAr(role)", scriptStart);
if (scriptStart >= 0 && scriptEnd > scriptStart) {
  html = html.slice(0, scriptStart) + html.slice(scriptEnd);
}

const modalFuncs = [
  /      function setDashMapModalOpen\(open\) \{[\s\S]*?      \}\s*\n/,
  /      function openDashMapQuick\(opts\) \{[\s\S]*?      \}\s*\n/,
  /      \(function initDashTabs\(\) \{[\s\S]*?      \}\)\(\);\s*\n/,
  /      \(function initServiceCardsUi\(\) \{[\s\S]*?      \}\)\(\);\s*\n/,
  /      setDeliveryMode\("map"\);\s*\n\s*updateApplyBtnLabel\(\);\s*\n/,
  /      window\.addEventListener\("resize", function \(\) \{[\s\S]*?      \}\);\s*\n/,
  /      window\.addEventListener\("ervenow-api-retry"[\s\S]*?      \}\);\s*\n/,
  /      window\.addEventListener\("ervenow-offline-queued"[\s\S]*?      \}\);\s*\n/,
];
modalFuncs.forEach((re) => {
  html = html.replace(re, "");
});

html = html.replace(
  /      \(function initDashTabs\(\) \{[\s\S]*?activateDashTab\(""\);\s*\n      \}\)\(\);\s*\n/,
  `      (function initDashTabs() {
        var root = document.querySelector(".dash-tabs");
        if (!root) return;
        if (window.ErvenowToggle && ErvenowToggle.bindTabGroup) {
          ErvenowToggle.bindTabGroup(root);
        }
        activateDashTab("");
      })();
`
);

function stripStyleBlock(input) {
  const start = input.indexOf("      /* ── توصيل من الخريطة: بطاقة فاخرة + نافذة تركيز ── */");
  const endMarker = "      .delivery-dropdown {";
  const end = input.indexOf(endMarker, start);
  if (start < 0 || end < 0) return input;
  const linkCardCss =
    "      .cat-card--map-link {\n" +
    "        display: flex;\n" +
    "        flex-direction: column;\n" +
    "        align-items: flex-start;\n" +
    "        gap: 6px;\n" +
    "        text-decoration: none;\n" +
    "        color: inherit;\n" +
    "        position: relative;\n" +
    "        background: linear-gradient(145deg, #fffefb 0%, #f6ede2 55%, #efe3d4 100%);\n" +
    "        border-radius: 14px;\n" +
    "      }\n" +
    "      .cat-card--map-link .cat-card__badge {\n" +
    "        display: inline-flex;\n" +
    "        align-items: center;\n" +
    "        gap: 4px;\n" +
    "        padding: 3px 10px;\n" +
    "        border-radius: 999px;\n" +
    "        font-size: 0.68rem;\n" +
    "        font-weight: 900;\n" +
    "        color: #fffefb;\n" +
    "        background: linear-gradient(135deg, #b9872f 0%, #d4a84a 100%);\n" +
    "      }\n" +
    "      .cat-card--map-link:hover {\n" +
    "        border-color: rgba(185, 135, 47, 0.45);\n" +
    "        box-shadow: 0 10px 28px rgba(45, 28, 14, 0.12);\n" +
    "      }\n\n";
  return input.slice(0, start) + linkCardCss + input.slice(end);
}

html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, style) => "<style>" + stripStyleBlock(style) + "</style>");

html = html.replace(
  /      \/\* ── من الخريطة — جوال:[\s\S]*?      \}\s*\n      @media \(max-width: 380px\)/,
  "      @media (max-width: 380px)"
);

fs.writeFileSync(dashPath, html);
console.log("dashboard.html cleaned");
