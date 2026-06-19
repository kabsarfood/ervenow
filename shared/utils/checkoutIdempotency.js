/**
 * Checkout idempotency: one row per (customer_id, idempotency_key) with JSON response replay.
 * Uses a short-lived { pending: true } claim to reduce duplicate inserts under concurrency.
 */

/** Pending claims older than this are treated as abandoned (client timeout / crash). */
const STALE_PENDING_MS = 120 * 1000;

function isCompleteResponse(response) {
  return Boolean(response && response.ok === true && Array.isArray(response.orders));
}

function isPendingResponse(response) {
  return Boolean(response && response.pending === true);
}

function isStalePendingRow(row, nowMs) {
  if (!row || !isPendingResponse(row.response)) return false;
  const created = row.created_at ? new Date(row.created_at).getTime() : 0;
  if (!Number.isFinite(created) || created <= 0) return true;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return now - created > STALE_PENDING_MS;
}

/**
 * @returns {Promise<{ replay?: object, claimed?: boolean, conflict?: boolean, staleReclaimed?: boolean }>}
 */
async function claimOrReplayCheckout(sb, customerId, idempotencyKey) {
  const { data: row, error: selErr } = await sb
    .from("checkout_idempotency")
    .select("*")
    .eq("customer_id", customerId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (selErr) throw selErr;

  if (row && isCompleteResponse(row.response)) {
    return { replay: row.response };
  }
  if (row && isPendingResponse(row.response)) {
    if (!isStalePendingRow(row)) {
      return { conflict: true };
    }
    await releaseCheckoutIdempotency(sb, customerId, idempotencyKey);
  }

  const ins = await sb
    .from("checkout_idempotency")
    .insert({
      customer_id: customerId,
      idempotency_key: idempotencyKey,
      response: { pending: true },
    })
    .select()
    .maybeSingle();

  if (!ins.error) {
    return { claimed: true, staleReclaimed: Boolean(row && isPendingResponse(row.response)) };
  }

  if (String(ins.error.code || "") === "23505") {
    const { data: row2 } = await sb
      .from("checkout_idempotency")
      .select("*")
      .eq("customer_id", customerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (row2 && isCompleteResponse(row2.response)) {
      return { replay: row2.response };
    }
    if (row2 && isPendingResponse(row2.response) && !isStalePendingRow(row2)) {
      return { conflict: true };
    }
    if (row2 && isPendingResponse(row2.response) && isStalePendingRow(row2)) {
      await releaseCheckoutIdempotency(sb, customerId, idempotencyKey);
      const retry = await sb
        .from("checkout_idempotency")
        .insert({
          customer_id: customerId,
          idempotency_key: idempotencyKey,
          response: { pending: true },
        })
        .select()
        .maybeSingle();
      if (!retry.error) return { claimed: true, staleReclaimed: true };
    }
    return { conflict: true };
  }

  throw ins.error;
}

async function finalizeCheckoutIdempotency(sb, customerId, idempotencyKey, responseBody) {
  const { error } = await sb
    .from("checkout_idempotency")
    .update({ response: responseBody })
    .eq("customer_id", customerId)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw error;
}

async function releaseCheckoutIdempotency(sb, customerId, idempotencyKey) {
  await sb.from("checkout_idempotency").delete().eq("customer_id", customerId).eq("idempotency_key", idempotencyKey);
}

module.exports = {
  STALE_PENDING_MS,
  claimOrReplayCheckout,
  finalizeCheckoutIdempotency,
  releaseCheckoutIdempotency,
  isCompleteResponse,
  isPendingResponse,
  isStalePendingRow,
};
