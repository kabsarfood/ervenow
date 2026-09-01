# ERVENOW — P1 CLOSED ALPHA READINESS REPORT

**Date:** 2026-09-01  
**Inputs:** `docs/ERVENOW-FULL-AUDIT-2026-09-01.md`, `docs/ERVENOW-P0-FIX-REPORT-2026-09-01.md`  
**Scope:** P1 only. No P2, no UI redesign, no new product features.

---

## EXECUTIVE SUMMARY

P1 security and money controls are in the codebase. P0 SQL was applied on the **connected test database**. Jest is **0 failed**.

Closed Alpha is still blocked by **operational** gaps that the C checklist treats as essential: the first admin was **not** seeded (bootstrap confirm flag off), and there was **no live multi-actor order** on a running HTTP server (E2E is Jest-simulated with test money).

WhatsApp webhooks now **fail closed** without `TWILIO_AUTH_TOKEN` (503). That is correct for security; inbound driver-accept via WhatsApp will not work until Twilio is configured.

---

## FINAL DECISION

# **B — INTERNAL TESTING ONLY**

Do **not** invite external merchants/drivers. Do **not** take real customer money. Soft Beta is out of scope.

**What would unblock C (ops, not more P1 product work):**

1. Run `ERVENOW_BOOTSTRAP_ADMIN_CONFIRM=1` + `ERVENOW_BOOTSTRAP_ADMIN_PHONE=…` with `node scripts/seed-first-admin.js` (or SQL equivalent) so an existing user becomes admin.  
2. Set `TWILIO_AUTH_TOKEN` and `TWILIO_WEBHOOK_URL` on the test server.  
3. Walk one **test-money** order on the running API: checkout → merchant → driver accept → delivered → ledger; then cancel/refund; then forced settlement RPC failure + retry.  
4. Confirm an admin session can open that order and see a failed settlement log line.

---

## P0 ENVIRONMENT VERIFICATION

Executed on the project’s configured Postgres (`.env` `SUPABASE_DB_URL` / `SUPABASE_DB_PASSWORD`), **not** a public production cutover.

| Step | Result |
|------|--------|
| `shared/migration_p0_ledger_cancel_refund.sql` | Applied. Function `ervenow_ledger_refund_cancelled_order` present. |
| `shared/migration_p0_finance_rls_lockdown.sql` | Applied after skip-non-table fix. `withdraw_requests` is **not** a base table (skipped). Ledger tables: **4 policies**, **0 `USING (true)`**. |
| `shared/migration_p1_settlement_fail_closed.sql` | Applied. `settlement_log_release_claim` present. |
| First admin seed | **Skipped** (`ERVENOW_BOOTSTRAP_ADMIN_CONFIRM` not `1`). Script: `scripts/seed-first-admin.js`. No public API creates admin. |
| `npm run frontend:sync` | Done. `ervenow-frontend/admin-settings.html` sends Bearer. |

**P0 smoke (automated, same contracts as live exploits):**

| Check | Result |
|-------|--------|
| Anonymous admin settings | 401 (`p0AdminSettingsAuth`) |
| Customer / merchant settings | 403 |
| Admin settings | 200 |
| `users/sync` `{role:admin}` | 403 |
| Checkout `price: 1` on catalog 100 | server 100 |
| Refund twice | second `already_refunded` |
| Finance PostgREST | deny `authenticated` (`USING (false)`); service role backend-only |

If any of those Jest files regress, treat P0 as reopened.

---

## P1 FIXED

### P1-01 — Unauthenticated debt / credit

**Endpoint:** `GET /api/pay/debt-info`, `POST /api/pay/create-session` (`apps/pay/routes.js`).

- Anonymous without HMAC token → **401**.  
- Customer/driver/merchant may only access **self**. Other `uid` → **403**.  
- Admin may specify `uid`.  
- Public pay page uses `createDebtPayToken` (HMAC, 7-day TTL). Token/`uid` mismatch → **403**.  
- `wallet_id` from the client is ignored.  
- Amount must be **> 0** and **≤ owed**.  
- Pending session with same user+amount is **reused** (idempotent).  
- `insertAuditEvent` on create/reuse.  
- `POST /api/pay/mock-complete` requires webhook secret.

### P1-02 — WhatsApp / Twilio webhook

`POST /api/whatsapp/webhook` verifies `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params). Missing/invalid signature → 403. Same `MessageSid` within 10 minutes → 409 replay. No auth token → 503. Catch logs **error message only** (no OTP/token dump).

### P1-03 — Settlement fail-closed

`claimSettlement` returns `proceed: false` on RPC error, timeout, missing `settlement_log`. Duplicate unique claim → skip (already settled). Settle RPC failure → `settlement_log_release_claim` so retry can claim again. **No** driver/merchant credit if settle did not succeed.

Same claim/release wrapping in `ledgerOnlySettlement.js`.

### P1-04 — Idempotency contract

**Contract:** 4xx checkout JSON is `{ ok: false, message, reason?, balance?, required? }`. Extra fields are required for EW PAY insufficient-balance. Tests now use `objectContaining({ ok: false, message })`. Success still finalizes the key; 4xx releases it.

### P1-05 — Driver assignment

`driver_id IS NULL` + status in `new|pending` remains. Added: cancelled reject, same-driver repeat = already accepted, other driver = taken, offline/`active=false` reject, non-dispatch (home service) reject.

### P1-06 — Order state transitions

`assertActorDeliveryTransition`: store driver cannot `accepted → delivered` (pickup required); merchant cannot mark delivered; customer cannot cancel after pickup; nobody (except admin cancel rules) delivers a cancelled order.

### P1-07 — Ownership / IDOR (Alpha APIs)

- `GET /api/order/:id`: customer / driver / merchant / service scoped.  
- `POST /api/wallet/ledger/pay`: amount from **server order**, `customer_id` must match.  
- Notifications already `requireAuth` + recipient id.  
- `POST /api/services/home-order`, `gas-order`, `checkout` now `requireAuth`.

### P1-08 — Service role boundary

API still uses service role. Mutating Alpha money/order routes above now require auth + ownership **before** DB writes. No `SUPABASE_SERVICE_ROLE_KEY` in `public/`.

### P1-09 — Money invariants

`splitDeliveredOrder`: customer payment vs merchant net + driver + platform fee + VAT. Tests assert no money creation and no negative split.

### P1-10 — Previously failed tests

| Test | Cause | Contract | Fix |
|------|--------|----------|-----|
| `adminRoleTaxonomy` `gas_cylinder_swap` → transport | Test assumed Transport portal | Code: gas is **service** (`resolvePortalRole`) | Test updated to `service` |
| `cartCheckoutHttpIdempotency` 4xx exact `{ok,message}` | Handler also returns `reason/balance/required` | Extra fields are the money contract | Tests use `objectContaining` |

### P1-11 — E2E (test money, Jest)

Covered in `p1MoneyAndE2e.test.js` + settlement/refund/checkout units: catalog price, double refund, privilege escalation, settlement claim race, settle RPC fail + release. **Not** a live browser walkthrough.

### P1-12 — Operational controls (code)

Admin order list, block customer/driver, PATCH status, settlement object on delivered PATCH, Pino warnings on settle/pay errors, audit on debt sessions, no public admin create. Admin **visibility of a real live order** still needs a seeded admin + a real test order.

---

## FILES CHANGED

**New**

- `shared/utils/debtPayToken.js`
- `shared/utils/twilioWebhookAuth.js`
- `shared/utils/closedAlphaTransitions.js`
- `shared/utils/moneyInvariants.js`
- `shared/migration_p1_settlement_fail_closed.sql`
- `scripts/run-migration-p0-p1-alpha.js`
- `scripts/seed-first-admin.js`
- `tests/unit/p1*.test.js` (debt, Twilio, driver/transitions, money/e2e, ownership)

**Updated (P1)**

- `apps/pay/routes.js`, `public/pay.html`, `shared/utils/debtPaymentLink.js`
- `apps/whatsapp/routes.js`
- `shared/services/settlementGuard.js`, `deliveredFinancialSettlement.js`, `ledgerOnlySettlement.js`
- `shared/services/unifiedOrderStatus.js`
- `apps/driver/routes.js`, `apps/delivery/service.js`
- `apps/services/routes.js`, `apps/order/routes.js`, `apps/wallet/routes.js`
- `shared/migration_p0_finance_rls_lockdown.sql` (skip views / per-table exception)
- Tests: `settlementGuard`, `deliveredFinancialSettlement`, `merchantDepositFlow`, `adminRoleTaxonomy`, `cartCheckoutHttpIdempotency`, `debtPaymentLink`

`npm run frontend:sync` copied `public/` → `ervenow-frontend/`.

---

## DATABASE MIGRATIONS

| File | Purpose | Applied on test DB |
|------|---------|--------------------|
| `shared/migration_p0_ledger_cancel_refund.sql` | EW PAY cancel refund on ledger | Yes |
| `shared/migration_p0_finance_rls_lockdown.sql` | Deny anon/authenticated on finance **tables** | Yes (views skipped) |
| `shared/migration_p1_settlement_fail_closed.sql` | `settlement_log_release_claim` | Yes |

---

## SECURITY TESTS

Debt anonymous/other-user, Twilio signature/replay, role freeze, admin settings, home-order requireAuth, order GET ownership scan, service role not in public bundles.

## MONEY TESTS

Settlement: success, duplicate claim, RPC error + release, concurrent one-winner. Refund twice. Checkout price tamper. Split invariant. Wallet pay ignores client amount.

## IDEMPOTENCY TESTS

Checkout 4xx releases key; success finalizes; 409 in-progress. Ledger `reference_id` unique remains the money idempotency backstop.

## E2E ORDER TEST

**Jest only** (no live HTTP server loop). Paths covered: server catalog checkout, EW PAY refund idempotency, settlement fail-closed + retry claim, driver single-winner accept.

**Not run:** Customer login in browser → merchant accept → driver GPS accept → delivered on shared test data.

## FAILED TESTS

| | Count |
|--|------:|
| **Passed** | **383** |
| **Failed** | **0** |
| **Skipped** | **1** |
| Total | 384 |

(Previous four failures resolved via correct contracts, not silenced asserts.)

---

## REMAINING RISKS

| Risk | Severity | Notes |
|------|----------|--------|
| No seeded admin | Ops | Closed Alpha admin console unused until bootstrap. |
| No live multi-actor E2E | Ops / process | Jest ≠ production walkthrough. |
| Twilio token missing | Ops | Webhook 503 until `TWILIO_AUTH_TOKEN` + public URL. |
| `withdraw_requests` not a table | Low | RLS skip; confirm it is not a PostgREST-exposed view of others’ money. |
| `GET /api/order/orders` anonymous count | Low | Count of open orders only, no rows. |
| Admin `ledger/refund` still takes amount | Admin-only | Intentional; not customer IDOR. |
| Settlement still updates `delivered` then posts ledger | Residual | RPC requires `delivery_status=delivered`. Failure releases claim; retry via same-status PATCH. Physical “delivered” can exist with unsettled money until retry. |
| Guest tracking / OTP rate limit / unsigned Moyasar (non-mock) | P2 | Out of this phase. |

---

## P2 BACKLOG

- OTP IP rate limit; WhatsApp Twilio only (done) vs other providers.  
- Guest tracking / store hours / coupons / Transport Preview.  
- Card checkout, GA4, SEO, image pipeline.  
- `.gitignore` merge conflict.  
- CI + request IDs + authenticated metrics.  
- Driver reject-from-WhatsApp.  
- Tighten `withdraw_requests` if it is a view.  
- Settle **before** marking delivered if the RPC can drop the `not_delivered` guard (schema change).

---

## CLOSED ALPHA REQUIREMENTS

| # | Requirement | Status |
|---|-------------|--------|
| 1 | P0 migrations applied & verified | **Yes** (test DB) |
| 2 | P0 exploits closed | **Yes** (tests + SQL) |
| 3 | Debt Auth + permission | **Yes** |
| 4 | WhatsApp webhook signed | **Yes** (needs Twilio env to accept) |
| 5 | Settlement fail-closed | **Yes** |
| 6 | Double settlement impossible in tests | **Yes** |
| 7 | Double refund impossible | **Yes** |
| 8 | Client price manipulation impossible | **Yes** |
| 9 | Privilege escalation impossible | **Yes** |
| 10 | E2E order flow | **Partial** (Jest only) |
| 11 | E2E refund flow | **Partial** (Jest only) |
| 12 | No known critical money bug | **Yes** in code review of P0/P1 paths |
| 13 | No known critical auth bug | **Yes** on Alpha surfaces listed |
| 14 | Core tests stable | **Yes** (0 failed) |

Items **10–11** and admin bootstrap keep the decision at **B**.

---

## OPERATOR COMMANDS (test env only)

```bash
node scripts/run-migration-p0-p1-alpha.js
# then, once, with an already-registered phone:
# ERVENOW_BOOTSTRAP_ADMIN_CONFIRM=1 ERVENOW_BOOTSTRAP_ADMIN_PHONE=05xxxxxxxx node scripts/seed-first-admin.js
npm run frontend:sync
npx jest --ci
```
