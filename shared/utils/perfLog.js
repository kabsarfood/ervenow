/**
 * سجلات أداء موحّدة (مراقبة خارجية عبر جامع السجلات).
 */
function perfLog(label, fields) {
  const payload = Object.assign(
    {
      t: new Date().toISOString(),
      label: String(label || ""),
    },
    fields && typeof fields === "object" ? fields : {}
  );
  console.log("PERF", JSON.stringify(payload));
}

module.exports = { perfLog };
