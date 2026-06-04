#!/usr/bin/env node
/**
 * ERVENOW — فحص أنماط التمرير الأفقي الشائعة في HTML/CSS
 * التشغيل: node scripts/audit-mobile-overflow.mjs
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const PRIORITY = [
  "index.html",
  "browse.html",
  "dashboard.html",
  "store-dashboard.html",
  "driver.html",
  "track.html",
  "delivery-services.html",
  "admin/admin-dashboard.html",
  "admin-dashboard.html",
];

const PATTERNS = [
  { id: "100vw", re: /100vw/g, hint: "قد يوسّع الصفحة بعرض شريط التمرير" },
  { id: "neg-margin", re: /margin(?:-inline)?:\s*0\s+-?\d+px|margin:\s*0\s+-/g, hint: "هامش سالب يدفع المحتوى أفقياً" },
  { id: "overflow-visible", re: /overflow(?:-x)?:\s*visible/g, hint: "قد يسرّب محتوى عريض" },
  { id: "fixed-width", re: /(?:^|[;{\s])width:\s*(\d{3,})px/g, hint: "عرض ثابت كبير" },
  { id: "minmax-wide", re: /minmax\(\s*(\d{3,})px/g, hint: "شبكة قد لا تنكمش على جوال ضيق" },
];

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory() && name !== "node_modules") walk(p, acc);
    else if (/\.(html|css)$/i.test(name)) acc.push(p);
  }
  return acc;
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
  const hits = [];
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      hits.push({ pattern: pat.id, hint: pat.hint, line, sample: m[0].slice(0, 48) });
    }
  }
  return hits.length ? { file: rel, hits } : null;
}

const files = walk(PUBLIC);
const results = files.map(scanFile).filter(Boolean);
const prioritySet = new Set(PRIORITY.map((p) => `public/${p}`));

console.log("ERVENOW Mobile Overflow Audit\n");
console.log("=== Priority pages ===\n");
for (const p of PRIORITY) {
  const key = `public/${p}`;
  const row = results.find((r) => r.file === key);
  if (!row) {
    console.log(`✓ ${p} — no risky patterns detected`);
    continue;
  }
  console.log(`⚠ ${p}`);
  for (const h of row.hits.slice(0, 8)) {
    console.log(`   L${h.line} [${h.pattern}] ${h.sample} — ${h.hint}`);
  }
  if (row.hits.length > 8) console.log(`   … +${row.hits.length - 8} more`);
}

const other = results.filter((r) => !prioritySet.has(r.file));
console.log(`\n=== Other files with patterns: ${other.length} ===\n`);
for (const row of other.slice(0, 15)) {
  console.log(`⚠ ${row.file} (${row.hits.length} hits)`);
}

const guards = [
  path.join(PUBLIC, "assets/responsive-audit-base.css"),
  path.join(PUBLIC, "assets/styles.css"),
];
console.log("\n=== Global guards ===\n");
for (const g of guards) {
  const t = fs.readFileSync(g, "utf8");
  const hasHtml = /html\s*\{[^}]*overflow-x:\s*(clip|hidden)/s.test(t);
  const hasBody = /body\s*\{[^}]*overflow-x:\s*(clip|hidden)/s.test(t);
  console.log(`${path.relative(ROOT, g)}: html=${hasHtml ? "yes" : "no"} body=${hasBody ? "yes" : "no"}`);
}

process.exit(results.some((r) => prioritySet.has(r.file)) ? 0 : 0);
