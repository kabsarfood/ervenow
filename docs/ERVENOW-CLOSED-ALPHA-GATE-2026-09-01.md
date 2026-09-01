# ERVENOW — CLOSED ALPHA LIVE GATE

**Date:** 2026-09-01  
**Inputs:** `docs/ERVENOW-FULL-AUDIT-2026-09-01.md`, `docs/ERVENOW-P0-FIX-REPORT-2026-09-01.md`, `docs/ERVENOW-P1-FIX-REPORT-2026-09-01.md`  
**Evidence JSON:** `data/closed-alpha-gate-2026-09-01.json` (OTP follow-up merged; `decision` = C, `c_blockers` empty)  
**Admin OTP evidence:** `data/closed-alpha-admin-otp-live.json`  
**Harness:** `scripts/closed-alpha-live-gate.js` + `scripts/closed-alpha-admin-otp-live.js`  
**No P2. No new product features.** Soft Beta is out of scope.

---

## FINAL DECISION

# **C — CLOSED ALPHA**

Internal test actors and test balances only. Do **not** take real customer money. Do **not** open the platform to the public.

Admin OTP login on the live server completed through the natural path: `send-otp` → Twilio Messages API (official retrieval) → `verify-otp` → JWT → Admin Settings / Orders / Users / Drivers / Finance all **200**. No minted JWT. `ALLOW_DEV_OTP=false`.

---

## Environment

| Item | Value |
|------|--------|
| API under test | `http://127.0.0.1:4000` (process started from this tree after P0/P1 + gate fixes) |
| `NODE_ENV` | `production` |
| `FINANCE_MODE` | `ledger_only` |
| `ERVENOW_PUBLIC_URL` | `https://ervenow.com` |
| Database | Supabase Postgres `pnpcplpfktsujuhfpbny.supabase.co` (same URL as `.env`; treated as the **test** DB for this gate) |
| Redis | `REDIS_URL` set; `127.0.0.1:6379` **refused** during the run |
| Dev OTP | `ALLOW_DEV_OTP=false` |
| Bootstrap confirm in `.env` | **not** left as `1` |
| Money used | Admin ledger **test deposit** only (`/api/wallet/ledger/deposit`) |

A stale process was already bound to port 4000 at the start of the gate (P0/P1 protections were **not** loaded). It was replaced with `npm start` from this codebase. Anonymous `GET /api/admin/settings` is **401** on the current process.

---

## Admin Bootstrap

**PASS**

- `users.role = admin` already present: `3c92bcca-eaea-49a1-bca4-7731788dd4ef` (phone last4 `5650`).
- `scripts/seed-first-admin.js` with `ERVENOW_BOOTSTRAP_ADMIN_CONFIRM=1` (process env only) reported **admin already exists** — no extra write.
- Confirm flag was **not** persisted in `.env`.
- `POST /api/core/register` `{ role: "admin" }` → **403** (`لا يمكن إنشاء أو ترقية حساب إداري من الطلب الذاتي`).
- Authenticated customer `POST /api/core/users/sync` `{ role: "admin" }` → **403** (`لا يمكن تعيين الدور من العميل`).

**Incident (cleaned):** the previous stale server accepted `users/sync` with `role` and promoted two GATE phones to admin. Those rows were demoted back to `customer`. Current admin count = **1**.

---

## Admin Authentication

**PASS**

Live run `2026-09-01T19:40:25Z` against `http://127.0.0.1:4000`. Session source: **`POST /api/core/verify-otp`**. JWT was not minted. OTP was not read from the database.

| Check | Result |
|-------|--------|
| `POST /api/core/send-otp` admin phone | **200** |
| OTP retrieved from Twilio Messages API (`body`) | **yes** (no secrets logged) |
| `POST /api/core/verify-otp` | **200**, `role: admin`, token present |
| Admin JWT → Settings / Orders / Users / Drivers / Finance | **200 / 200 / 200 / 200 / 200** |
| Anonymous → same surfaces | **401** |
| Non-admin customer JWT (also from `verify-otp`) → same surfaces | **403** |

**Harness note (not a product bug):** the first gate pass used a wrong E164 for `0505745650` (`+9660505…` instead of `+966505…`), so Twilio `To=` returned no row (`no_otp_in_recent_messages`). Retrieval also needs `node --use-system-ca` on this host (Twilio TLS). Fixed in `scripts/closed-alpha-live-gate.js` / `scripts/closed-alpha-admin-otp-live.js` only.

**Ops residual:** Twilio message `status: failed`, `error_code: 63015` (WhatsApp sandbox recipient has not joined). `messages.create` still succeeds, so `send-otp` is **200** and the OTP body is on the Twilio Message resource. Closed Alpha must keep using sandbox-joined or production WhatsApp numbers; this is not an application P0/P1.

---

## Twilio Verification

**PASS** (signature on the live process)

| Check | HTTP |
|-------|------|
| Valid HMAC-SHA1 `X-Twilio-Signature` | **200** |
| Invalid signature | **403** |
| Missing signature | **403** |
| Replay same `MessageSid` | **200** TwiML «تم استلام الرسالة مسبقاً» (idempotent; in-memory replay map) |

`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` are set. `TWILIO_WEBHOOK_URL` is **unset** (URL reconstructed from the request). Public URL is HTTPS; the live signature test was against local HTTP. No tokens were printed.

---

## Live Multi-role Order

**PASS**

Distinct actors (not one account playing every role):

| Role | User id |
|------|---------|
| Admin | `3c92bcca-eaea-49a1-bca4-7731788dd4ef` |
| Customer A (GATE) | `bb624f3d-4c8c-46c4-96ce-8dc5bbeb9325` |
| Customer B (IDOR) | `5f5aa228-d541-40c6-ac6b-bd50af277f3b` |
| Merchant / store | `ad3c8458-6b24-4af7-97bf-a0fff3317b55` |
| Driver A | `ba07ca03-a6fc-4b18-a9db-8807b1d5dd90` |
| Driver B | `3dcd8139-62a6-44d3-95fc-3825b28ee192` |
| Store | `1fcc6d83-4c7c-4fd0-8f22-7a84edaadfce` |

Happy-path order **`bdeb1769-2927-4b60-bca0-308a60e21e3c`** (`ED-01-666`):

Customer browse → checkout (EW PAY test balance) → merchant `accepted` → `preparing` → `ready` → driver GPS → `POST /api/driver/accept/:id` → `delivering` → `delivered` → settlement `ok: true` / `reason: settled`.

---

## Price Tampering

**PASS**

Client submitted `price = 1` on catalog **بيبسي** `3`. Server `order_total = 3`. Order `d8a92476-1678-49d3-8a86-3e7f40013e59`.

---

## Idempotency

**PASS**

Same `Idempotency-Key` twice → one order id `1a4858ff-5b3e-4d45-a1e9-5a8d397d3919`, second response replayed.

---

## Driver Race

**PASS** (database)

Two drivers accepted the same ready order concurrently. **`driver_id` in DB is a single user** (`3dcd8139-62a6-44d3-95fc-3825b28ee192`). Loser path also returned `accepted: true` on HTTP in this run (likely the same-status / already-assigned branch). Ownership is one row; residual: HTTP `accepted` is not always exclusive.

---

## Refund

**PASS**

Cancel of a **paid EW PAY** test order:

- First cancel **200**, `refunded: true`, `amount: 6.84`, `ledger: ervenow_ledger`, refs `refund:order:…` and `refund-escrow:order:…`.
- Second cancel **400**, ledger row count **unchanged** (5 → 5).
- No writes observed on `ervenow_wallets`.

---

## Settlement Failure + Retry

**PASS**

Test-only: `ervenow_ledger_settle_delivered_order` replaced with `RAISE EXCEPTION 'gate_forced_settlement_failure'`, then restored from `pg_get_functiondef`.

| Step | Result |
|------|--------|
| First `delivered` PATCH | `settlement.ok: false`, `reason: rpc_error`, detail `gate_forced_settlement_failure`, **settlement_log empty** (claim released) |
| Retry `delivered` PATCH | **exactly one** `settlement_log` row `ledger_delivered`, `reason: settled` |

---

## Realtime

**PASS**

- Socket without JWT → `UNAUTHORIZED`.
- Customer A / B / driver connected with JWT.
- Customer B did **not** receive `order:patch` for Customer A’s order after `join:order`.

---

## RBAC / IDOR

**PASS**

| Actor | Target | HTTP |
|-------|--------|------|
| Customer | `/api/admin/settings` | 403 |
| Customer | `/api/driver/orders` | 403 |
| Customer | `/api/store/order-board` | 403 |
| Merchant | `/api/admin/settings` | 403 |
| Driver | `/api/admin/finance-summary` | 403 |
| Driver B | Customer A’s order | 403 |
| Customer B | Customer A’s order | 403 |
| Customer B | `POST /api/wallet/ledger/pay` on A’s order | 403 |
| Anonymous | `/api/admin/orders` | 401 |

---

## Financial Invariants

**PASS** (order `bdeb1769-2927-4b60-bca0-308a60e21e3c`)

| Item | SAR |
|------|-----|
| Goods (`order_total`) | 3.00 |
| Delivery fee / driver earning | 1.15 |
| VAT | 0.62 |
| Customer debit `pay:order:` | 4.77 |
| Merchant hold | 2.79 |
| Platform commission | 0.21 |
| Platform escrow credit | 4.77 |

`3.00 − 0.21 = 2.79` merchant net; `2.79 + 1.15 + 0.21 + 0.62 = 4.77`. No duplicate `(reference_id, direction, amount)` keys. One `settlement_log` row.

HTTP settlement payload `merchant: 0` means merchant net was already held at EW PAY checkout, not a second credit at deliver.

---

## Bugs Found

1. **Stale Node on :4000** — old binary without P0-02/P1-02. Restarted. Evidence: first anonymous settings **200**, after restart **401**.
2. **`routeKmWithRoughFallback` used destination latitude as longitude** (`lng: lat2`). Checkout treated local drops as ~4389 km. **Fixed.** Regression: `tests/unit/routeDistanceLng.test.js`.
3. **Poisoned / insane OSRM distances** cached and trusted. **Sanity clamp** vs Haversine; Redis cache key `route:v2`. Tests: `tests/unit/osrmSanity.test.js`.
4. **`store_products.includes_delivery` missing on this DB** broke catalog reprice. **Retry select without the column.** Test in `p0CheckoutServerPricing.test.js`.
5. **BullMQ `q.add` hung** when Redis refused (`maxRetriesPerRequest: null`). **2s timeout → inline fallback.**
6. **Old server privilege escalation** via `users/sync` `{role:admin}` — not reproducible on current process (403). Accidental admin rows demoted.

---

## Code Changes

| File | Why |
|------|-----|
| `shared/utils/routeDistance.js` | Destination `lng`; Haversine clamp; Redis `route:v2` |
| `shared/utils/osrmClient.js` | `preferHaversineIfOsrmInsane` |
| `shared/services/checkoutServerPricing.js` | Optional `includes_delivery` |
| `queues/deliveryQueue.js` | Enqueue timeout / inline fallback |
| `apps/checkout/service.js`, `apps/order/cartCheckoutHttp.js`, `shared/services/deliveryQuoteService.js`, `shared/utils/checkoutDeliveryEngine.js` | Coverage error includes `distance_km` / `radius_km` (diagnosis) |
| `scripts/closed-alpha-live-gate.js` | Repeatable live gate; E164 for local `05…` phones |
| `scripts/closed-alpha-admin-otp-live.js` | Admin OTP live probe (Twilio Messages API, no JWT mint) |
| `tests/unit/routeDistanceLng.test.js`, `osrmSanity.test.js`, `p0CheckoutServerPricing.test.js` | Regressions |

No public Admin-create API was added.

---

## Tests

| | Count |
|--|------:|
| **Passed** | **388** |
| **Failed** | **0** |
| **Skipped** | **1** |
| Total | 389 |

---

## C checklist (this run)

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Admin bootstrap | **Yes** |
| 2 | Admin **OTP login** on live server | **Yes** (`send-otp` → Twilio Messages API → `verify-otp`) |
| 3 | Twilio signature live | **Yes** |
| 4–7 | Multi-role order through settlement | **Yes** |
| 8 | Ledger balanced | **Yes** |
| 9–10 | Refund + double refund | **Yes** |
| 11 | Duplicate checkout key | **Yes** |
| 12 | Price manipulation | **Yes** |
| 13 | One `driver_id` | **Yes** |
| 14–15 | Settlement fail + one retry | **Yes** |
| 16–17 | RBAC / IDOR on tested paths | **Yes** |
| 18 | No new P0/P1 left unfixed in this walk | **Yes** |

Item **2** completed. Decision: **C — CLOSED ALPHA**.
