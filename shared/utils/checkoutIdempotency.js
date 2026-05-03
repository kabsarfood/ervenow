/**
 * Checkout idempotency: one row per (customer_id, idempotency_key) with JSON response replay.
 * Uses a short-lived { pending: true } claim to reduce duplicate inserts under concurrency.
 */

function isCompleteResponse(response) {
  return Boolean(response && response.ok === true && Array.isArray(response.orders));
}

/**
 * @returns {Promise<{ replay?: object, claimed?: boolean, conflict?: boolean }>}
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
  if (row && row.response && row.response.pending === true) {
    return { conflict: true };
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
    return { claimed: true };
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
  claimOrReplayCheckout,
  finalizeCheckoutIdempotency,
  releaseCheckoutIdempotency,
  isCompleteResponse,
};
