const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "../public/delivery-services.html");
const out = src;
const fe = path.join(__dirname, "../ervenow-frontend/delivery-services.html");

let html = fs.readFileSync(src, "utf8");
const scriptStart = html.indexOf("<script>\n      (function () {");
const scriptEnd = html.lastIndexOf("})();\n    </script>");
if (scriptStart < 0 || scriptEnd < 0) {
  console.error("script bounds not found");
  process.exit(1);
}
let script = html.slice(scriptStart + 8, scriptEnd).trim();

script = script.replace(
  /updatePreviewMap\("gdLocPreview"[\s\S]*?\}\s+if \(dr\) \{[\s\S]*?\}\s+\}/,
  (m) => m.split("if (dr) {")[0].trim() + "\n        }"
);

script = script.replace(
  /\}\s+var km = haversineKm\(state\.pickup[\s\S]*?الخادم\."\;\s+\}/,
  "}"
);

script = script.replace(
  /var SERVICE_DISPLAY_ORDER = \[[\s\S]*?\];/,
  'var SERVICE_DISPLAY_ORDER = ["car_transport", "local_delivery", "gas_delivery"];'
);

script = script.replace(
  /pu\.textContent = state\.pickup \? "[^"]+" : "[^"]+";/,
  'pu.textContent = state.pickup ? "✔️ تم التحديد" : "❌ لم يتم التحديد";'
);
script = script.replace(
  /dr\.textContent = state\.dropoff \? "[^"]+" : "[^"]+";/g,
  'dr.textContent = state.dropoff ? "✔️ تم التحديد" : "❌ لم يتم التحديد";'
);
script = script.replace(
  /gl\.textContent = state\.gasLocation[\s\S]*?: "[^"]+";/,
  'gl.textContent = state.gasLocation ? "✔️ تم التحديد" : "❌ لم يتم التحديد";'
);

script = script.replace(
  /pu\.className = "ds-loc-status" \+ \(state\.pickup \? " is-set" : ""\);/,
  'pu.className = "ds-loc-status" + (state.pickup ? " is-set" : "");'
);

// Chips layout
script = script.replace(
  /b\.innerHTML =[\s\S]*?\+ "<\/span>";\s+b\.onclick/,
  `b.innerHTML =
              '<span class="ds-svc__check" aria-hidden="true">✓</span>' +
              '<span class="ds-svc__ic-wrap"><span class="ds-svc__ic" aria-hidden="true">' +
              (SERVICE_ICONS[s.id] || "📦") +
              '</span></span><span class="ds-svc__body"><span class="ds-svc__lbl">' +
              s.label +
              '</span><span class="ds-svc__desc">' +
              (SERVICE_DESC[s.id] || "") +
              "</span></span>";
            b.onclick`
);

// renderComingSoon + renderForms
if (!script.includes("renderComingSoon")) {
  script = script.replace(
    "        function renderForms() {",
    `        function renderComingSoon() {
          clearPreviewMaps();
          document.getElementById("dsSubmitBar").hidden = true;
          document.getElementById("dsFormMount").innerHTML =
            "<div class='ds-card ds-card--muted'><p class='ds-coming-soon'>هذه الخدمة قريباً. جرّب <a href='?service=car_transport'>نقل المركبات</a> أو <a href='?service=gas_delivery'>توصيل الغاز</a>.</p></div>";
        }

        function renderForms() {`
  );
  script = script.replace(
    `        function renderForms() {
          if (state.service === "gas_delivery") {
            renderGasForm();
            return;
          }
          renderCarForm();
        }`,
    `        function renderForms() {
          if (state.service === "gas_delivery") {
            renderGasForm();
            return;
          }
          if (state.service === "car_transport" || state.service === "pickup_truck") {
            renderCarForm();
            return;
          }
          renderComingSoon();
        }`
  );
}

// Sticky bar visibility
script = script.replace(
  "        function renderGasForm() {\n          clearPreviewMaps();",
  `        function renderGasForm() {
          clearPreviewMaps();
          document.getElementById("dsSubmitBar").hidden = true;`
);

script = script.replace(
  "          wireNotesCounter();\n          document.getElementById(\"dsCarForm\").onsubmit = submitCar;",
  `          wireNotesCounter();
          document.getElementById("dsSubmitBar").hidden = false;
          document.getElementById("dsSubmit").setAttribute("form", "dsCarForm");
          document.getElementById("dsCarForm").onsubmit = submitCar;`
);

// Car form: mobile single-column + location button labels
script = script.replace(
  '"<button type=\'button\' class=\'ds-map-btn\' id=\'dsBtnPickup\'>تحديد على الخريطة</button>"',
  '"<button type=\'button\' class=\'ds-map-btn\' id=\'dsBtnPickup\'>📍 تحديد موقع الاستلام</button>"'
);
script = script.replace(
  '"<button type=\'button\' class=\'ds-map-btn\' id=\'dsBtnDrop\'>تحديد على الخريطة</button>"',
  '"<button type=\'button\' class=\'ds-map-btn\' id=\'dsBtnDrop\'>📍 تحديد موقع التسليم</button>"'
);

script = script.replace(
  '<motion.div class=\'ds-submit-wrap\'><button type=\'submit\' class=\'btn btn-solid\' id=\'dsSubmit\'>إرسال الطلب ✈️</button></div>',
  ""
);
script = script.replace(
  /<motion.div class='ds-submit-wrap'>[\s\S]*?<\/div>\s*"<\/form>";/,
  '"</form>";'
);

const head = fs.readFileSync(path.join(__dirname, "delivery-page-head.html"), "utf8");
const full = head + "\n    <script>\n      " + script + "\n    </script>\n  </body>\n</html>\n";

fs.writeFileSync(out, full);
fs.writeFileSync(fe, full);
console.log("OK", full.length);
