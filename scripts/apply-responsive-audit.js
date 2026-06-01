#!/usr/bin/env node
/**
 * يطبّق Responsive Audit على كل HTML في public/
 * - viewport meta موحّد
 * - viewport-fit.js مبكراً في head
 * - responsive-audit-base.css للصفحات بدون styles.css
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "public");
const VIEWPORT_OLD = /width=device-width,\s*initial-scale=1(?:,\s*viewport-fit=cover)?/g;
const VIEWPORT_NEW =
  "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover";

const VIEWPORT_SCRIPT = '<script src="/assets/viewport-fit.js"></script>';
const STYLES_LINK = '<link rel="stylesheet" href="/assets/styles.css" />';
const AUDIT_LINK = '<link rel="stylesheet" href="/assets/responsive-audit-base.css" />';

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
}

function applyFile(filePath) {
  let html = fs.readFileSync(filePath, "utf8");
  let changed = false;

  if (html.includes('name="viewport"')) {
    const next = html.replace(
      /<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="viewport" content="${VIEWPORT_NEW}" />`
    );
    if (next !== html) {
      html = next;
      changed = true;
    }
  } else if (html.includes("<head>")) {
    html = html.replace(
      "<head>",
      `<head>\n    <meta name="viewport" content="${VIEWPORT_NEW}" />`
    );
    changed = true;
  }

  if (!html.includes("viewport-fit.js")) {
    html = html.replace(
      /(<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>)/i,
      `$1\n    ${VIEWPORT_SCRIPT}`
    );
    changed = true;
  }

  const hasStyles = html.includes("/assets/styles.css");
  const hasAudit = html.includes("responsive-audit-base.css");

  if (!hasStyles && !hasAudit && html.includes("</head>")) {
    html = html.replace("</head>", `    ${AUDIT_LINK}\n  </head>`);
    changed = true;
  }

  if (changed) fs.writeFileSync(filePath, html, "utf8");

  let html2 = fs.readFileSync(filePath, "utf8");
  const before = html2;
  html2 = html2.replace(/calc\(\(\s*100vw/gi, "calc((100%");
  html2 = html2.replace(/min\(\s*100vw/gi, "min(100%");
  html2 = html2.replace(/max\(\s*100vw/gi, "max(100%");
  html2 = html2.replace(/width:\s*100vw/gi, "width: 100%");
  if (html2 !== before) {
    fs.writeFileSync(filePath, html2, "utf8");
    changed = true;
  }

  return { file: path.relative(root, filePath), changed, hasStyles, hasAudit: hasAudit || !hasStyles };
}

function applyCssFile(filePath) {
  let css = fs.readFileSync(filePath, "utf8");
  const before = css;
  css = css.replace(/calc\(\s*100vw/gi, "calc(100%");
  css = css.replace(/min\(\s*100vw/gi, "min(100%");
  css = css.replace(/max\(\s*100vw/gi, "max(100%");
  css = css.replace(/width:\s*100vw/gi, "width: 100%");
  if (css !== before) {
    fs.writeFileSync(filePath, css, "utf8");
    return true;
  }
  return false;
}

const files = [];
walk(root, files);
const results = files.map(applyFile);
const updated = results.filter((r) => r.changed);

const cssFiles = [];
function walkCss(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkCss(p);
    else if (name.endsWith(".css")) cssFiles.push(p);
  }
}
walkCss(root);
const cssUpdated = cssFiles.filter(applyCssFile);

console.log(`[responsive-audit] HTML files: ${files.length}`);
console.log(`[responsive-audit] HTML updated: ${updated.length}`);
updated.forEach((r) => console.log("  -", r.file));
console.log(`[responsive-audit] CSS updated: ${cssUpdated.length}`);
cssUpdated.forEach((f) => console.log("  -", path.relative(root, f)));
