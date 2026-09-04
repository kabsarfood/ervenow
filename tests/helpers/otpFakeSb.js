function createOtpFakeSb(store) {
  const rows = store.rows;

  function applyFilters(list, filters) {
    return list.filter((row) =>
      filters.every((f) => {
        if (f.op === "eq") return String(row[f.k]) === String(f.v);
        if (f.op === "gte") return String(row[f.k] || "") >= String(f.v);
        return true;
      })
    );
  }

  function selectBuilder() {
    const filters = [];
    const q = {
      eq(k, v) {
        filters.push({ op: "eq", k, v });
        return q;
      },
      gte(k, v) {
        filters.push({ op: "gte", k, v });
        return q;
      },
      order() {
        return q;
      },
      limit(n) {
        q._limit = n;
        return q;
      },
      then(resolve) {
        let found = applyFilters(rows, filters);
        found.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        if (q._limit) found = found.slice(0, q._limit);
        resolve({ data: found, error: null });
      },
    };
    return q;
  }

  function deleteBuilder() {
    const filters = [];
    const q = {
      eq(k, v) {
        filters.push({ op: "eq", k, v });
        return q;
      },
      then(resolve) {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (filters.every((f) => String(rows[i][f.k]) === String(f.v))) rows.splice(i, 1);
        }
        resolve({ error: null });
      },
    };
    return q;
  }

  return {
    from(table) {
      if (table !== "ervenow_otp_challenges") {
        throw new Error("unexpected table " + table);
      }
      return {
        select: () => selectBuilder(),
        insert: async (row) => {
          rows.push(
            Object.assign({ id: "otp-" + (rows.length + 1), created_at: new Date().toISOString() }, row)
          );
          return { error: null };
        },
        update: (patch) => ({
          eq: async (k, v) => {
            rows.forEach((r) => {
              if (String(r[k]) === String(v)) Object.assign(r, patch);
            });
            return { error: null };
          },
        }),
        delete: () => deleteBuilder(),
      };
    },
  };
}

module.exports = { createOtpFakeSb };
