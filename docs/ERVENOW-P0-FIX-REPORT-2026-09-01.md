# ERVENOW — P0 FIX REPORT

**Date:** 2026-09-01  
**Scope:** P0 only (security + money). No P1, no UI polish, no Transport/coupons/hours/analytics.  
**Audit source:** `docs/ERVENOW-FULL-AUDIT-2026-09-01.md`

---

## FINAL DECISION

# **B — INTERNAL TESTING ONLY**

P0 *code* for the five audit blockers is in the repository. That is not enough to leave internal testing.

**Why not C (Closed Alpha):**

1. The two SQL migrations are **files only**. They have **not** been applied to a live Supabase database in this phase. Until `ervenow_ledger_refund_cancelled_order` exists and finance RLS deny-all is live, production/alpha money and PostgREST remain as the audit described.
2. The first `users.role = admin` account can no longer be created via OTP/register/sync. Closed Alpha would require an operator-seeded admin. That operational step is not done here.
3. P1 items from the audit are still open and are unsafe even for invited external users: unauthenticated debt IDOR, WhatsApp webhook without Twilio signature, settlement claim-on-error, guest `home-order`, OTP without IP rate limit.
4. Residual money paths outside checkout still exist (`POST /api/wallet/ledger/pay` client `amount`; `POST /api/delivery/orders` fee fields). They were out of P0-04 scope.

Do **not** take real customer money. Do **not** invite external merchants/drivers. Do **not** start Soft Beta. Soft Beta is forbidden until a separate P1 phase.

---

## MONEY FLOW (actual, after P0)

Source of truth: **`ervenow_ledger_*`** (`FINANCE_MODE=ledger_only`). Wallet UI balance is derived from ledger transactions. **`ervenow_wallets` is legacy** — cancel/refund no longer writes it.

```
Checkout (server catalog / OSRM quote)
  → orders row (order_total, delivery_fee, vat from server)
  → ERVENOW PAY: ervenow_ledger_checkout_ew_pay
       debit  customer wallet   reference pay:order:{id}
       credit platform escrow   reference escrow:order:{id}
       pending merchant hold    reference order:{id}:hold:merchant
  → Delivered settlement (existing): complete hold + platform commission
  → Cancel before settlement: ervenow_ledger_refund_cancelled_order
       credit customer          reference refund:order:{id}   (idempotent)
       debit  platform escrow   reference refund-escrow:order:{id}
       void   pending merchant hold (status=failed)
  → If settlement_log has ledger_delivered for that order → refuse (already_settled)
```

Commission, driver earning, and merchant net are computed server-side at checkout/settlement. Refund amount is **the original ledger debit**, not a client number.

---

## FIXED

### P0-01 — User role privilege escalation

- `POST /api/core/users/sync` **rejects any body that contains `role`** (including `admin`, `merchant`, `driver`, `provider`, `transport`, `store`). Sync is **select-only**.
- `verify-otp` / `register-account` / `upsertDriverByPhone` never write `admin` from the client. Existing users keep the DB role. New signups use an allow-list: `customer | driver | store | restaurant | merchant | service`. Aliases: `provider`/`transport` → `service`; unknown → `customer`.
- Admin OTP login requires **existing** `users.role = admin` **and** phone allowlist (`canAdminOtpLogin`).
- `ALLOWED_USER_ROLES` no longer includes `admin`.

### P0-02 — Admin settings without auth

- `apps/admin/settings.js`: `router.use(requireAuth, requireRole("admin"))` on `GET /` and `POST /update`.
- Role is taken from **DB** via `requireAuth` (JWT `role: admin` with DB `customer` → 403).
- Scan of `apps/admin/routes.js`: every `/api/admin/*` route uses `requireAuth` except the intentional public job form `POST /job-applications/public`.
- `public/admin-settings.html` sends `Authorization: Bearer` (required dependency so the admin page still works).

### P0-03 — EW PAY refund ledger mismatch

- Cancel refund calls `ervenow_ledger_refund_cancelled_order` only. **No** `ervenow_wallet_customer_refund_atomic` / `ervenow_wallets`.
- Idempotent via `refund:order:{id}` + unique `(wallet_id, reference_id)` on completed rows + `pg_advisory_xact_lock`.
- Double refund → `already_refunded`. After `settlement_log.ledger_delivered` → `already_settled`. Amount comes from the original `pay:order:{id}` debit.

### P0-04 — Cart price tampering

- Checkout no longer sums `item.price`. Store/restaurant lines reload `store_products` (unit = catalog `price` or valid `offer_price`).
- Map delivery fee from OSRM/haversine + server tariff; client `delivery_fee` ignored.
- Home/gas/car-polish totals from server catalogs. EW PAY grand total **ignores** client `financial_intent`.
- Business rule: **current catalog price at checkout time** (not the stale cart price). Inactive / missing product → reject with “حدّث السلة”.

### P0-05 — Financial RLS

- New lockdown SQL: drop permissive policies; `USING (false)` for `anon` and `authenticated` on wallet/ledger/settlement/commission/refund tables; `REVOKE` from `anon`/`authenticated`; `GRANT` to `service_role` only.
- Ledger RPCs (`ervenow_ledger%`) execute for `service_role` only.
- `GET /api/core/public-config` still exposes **anon** key only. No `SUPABASE_SERVICE_ROLE_KEY` in `public/` JS/HTML.

---

## FILES CHANGED

**P0 implementation (this phase):**

| Path | Why |
|------|-----|
| `shared/utils/roleAssignment.js` | Central role rules |
| `apps/core/routes.js` | sync / OTP / register / upsert |
| `apps/admin/settings.js` | Auth + admin RBAC |
| `public/admin-settings.html` | Bearer token for settings API |
| `shared/services/checkoutServerPricing.js` | Server reprice |
| `apps/checkout/service.js` | Use server prices |
| `shared/services/ervenowPayCheckout.js` | Ignore client `financial_intent` |
| `shared/services/serviceOrderCreate.js` | Home/gas totals from catalog |
| `shared/services/ledgerCancelRefund.js` | Ledger-only cancel refund |
| `apps/delivery/service.js` | Cancel uses ledger refund |
| `shared/migration_p0_ledger_cancel_refund.sql` | Refund RPC |
| `shared/migration_p0_finance_rls_lockdown.sql` | RLS deny-all |
| `tests/unit/p0*.test.js` (7 files) | Exploit tests |
| `tests/unit/p0AdminRoutesAuthScan.test.js` | Admin route scan |
| `tests/unit/checkoutServiceEwPay.test.js` | Price=1 still 100 |
| `tests/unit/ervenowPayCheckout.test.js` | Intent ignored |

**Not part of P0** (already dirty in the working tree; not modified for this phase): home CSS/`public/index.html`, `ervenow-frontend/*` polish, `data/*.json`.

**Vercel drift:** `ervenow-frontend/admin-settings.html` was **not** synced. After deploy, run `npm run frontend:sync` or the admin settings page on Vercel will call the API without Bearer and get 401.

---

## MIGRATIONS

Apply **in this order** on the target Supabase project (SQL Editor), after existing EW PAY / ledger migrations:

1. `shared/migration_p0_ledger_cancel_refund.sql`  
   Creates `public.ervenow_ledger_refund_cancelled_order(uuid, uuid)`.  
   `GRANT EXECUTE` → `service_role` only.

2. `shared/migration_p0_finance_rls_lockdown.sql`  
   Enables RLS, drops old `USING (true)` policies on finance tables that exist, creates deny policies, revokes table/RPC from `anon`/`authenticated`.

**Not applied automatically.** Node still uses the service role (RLS bypass on the API path). The lockdown protects PostgREST if the anon key is used from a browser.

**Operator bootstrap (required before any admin login):** insert or update one row in `users` with `role = 'admin'` and a phone that is on `ERVENOW_ADMIN_*` allowlists. Self-service can no longer create that row.

---

## TESTS

Command: `npx jest --ci`  
Date: 2026-09-01

| | Count |
|--|------:|
| **Passed** | **345** |
| **Failed** | **4** |
| **Skipped** | **1** |
| Total | 350 |

Test suites: 82 passed, 2 failed, 1 skipped (85 total).

### P0 tests added/updated (all passed)

| Area | File | Coverage |
|------|------|----------|
| Role rules | `p0RoleAssignment.test.js` | admin blocked; provider/transport → service; client `role` denied |
| Sync HTTP | `p0UsersSync.test.js` | `{role:admin}` → 403; merchant/driver/provider/transport/store → 403; no-role sync select-only |
| Admin settings | `p0AdminSettingsAuth.test.js` | anonymous 401; customer 403; merchant 403; JWT-admin/DB-customer 403; admin 200 |
| Admin scan | `p0AdminRoutesAuthScan.test.js` | settings middleware; only public job form unauthenticated |
| Checkout | `p0CheckoutServerPricing.test.js` | unit 1→100; qty; offer_price from DB; delivery_fee ignored; plumber catalog 60 |
| Checkout insert | `checkoutServiceEwPay.test.js` | manipulated price/subtotal/discount/delivery_fee still `order_total: 100` |
| EW PAY | `ervenowPayCheckout.test.js` | client `financial_intent` ignored |
| Money | `p0LedgerCancelRefund.test.js` | unpaid; once; twice; concurrent; cancel amount from RPC; settlement then refund |
| RLS | `p0FinanceRlsLockdown.test.js` | no `USING (true)` in lockdown SQL; deny authenticated; RPCs service_role; no service key in `public/` |

### Pre-existing failures (not P0, not fixed)

1. `adminRoleTaxonomy.test.js` — `gas_cylinder_swap` expected bucket `transport`, got `service` (taxonomy / Transport; out of P0).
2. `cartCheckoutHttpIdempotency.test.js` (3 tests) — 4xx JSON now includes `reason`/`balance`/`required`; assertion too strict. Behavior of idempotency release is unchanged.

---

## REMAINING RISKS

| Risk | Severity | Notes |
|------|----------|--------|
| P0 SQL not applied on live DB | **P0 ops** | Refund RPC missing → cancel returns `migration_missing` (no credit). Old `USING (true)` RLS still live until lockdown SQL runs. |
| No self-service admin | Ops | First admin must be seeded in SQL/dashboard. |
| `POST /api/wallet/ledger/pay` trusts client `amount` | P1 money | Authenticated customer can still pass an amount. Out of checkout P0-04. |
| `POST /api/delivery/orders` client fees | P1 | Not the cart checkout path. |
| `POST /api/services/home-order` `optionalAuth` | P1 | Guest/unowned bookings (audit #13). Catalog overwrite helps price, not auth. |
| `GET /api/pay/debt-info` IDOR | P1 | Unauthenticated. |
| WhatsApp webhook unsigned | P1 | Forged driver accept. |
| `tryClaimSettlement` true on RPC error | P1 | Duplicate settlement risk. |
| `job-applications/public` | Accepted | Unauthenticated by design (spam/abuse, not admin RBAC). |
| JWT with no DB user | Low | `requireAuth` falls back to token role if the user row is missing. Needs JWT secret. |
| `ervenow-frontend/admin-settings.html` | Deploy | Still without Bearer until frontend sync. |
| Concurrent refund | Mitigated in SQL | Unique index + advisory lock; **unit test mocks** both calls as `already_refunded` — live DB is the real race proof. |
| User-scoped finance read via API | By design | API uses service role and must keep filtering by `req.appUser.id`. RLS deny-all means PostgREST cannot read anyone’s ledger; the Node API still can. |

---

## REGRESSION RISKS

- **Existing customers sending `role` on `/users/sync`** (old apps) get **403**. Sync without `role` still works.
- **Attempting OTP with `role: admin`** fails unless the phone is already an admin on the allowlist. Real admins can still login with `role: customer` in the body; session role is frozen from DB.
- **New admin signup** is impossible from the API. Operators who relied on OTP-to-admin must seed the row.
- **Admin settings page** without a token → 401 (previously it worked unauthenticated). `public/admin-settings.html` was updated; Vercel copy was not.
- **Checkout** rejects missing/inactive products instead of charging a client price. Carts with stale product IDs fail until refresh.
- **Price changes after add-to-cart:** checkout uses **current** catalog price (not the price shown in the cart).
- **Cancel after EW PAY:** if migration is not applied, the customer is **not** credited (fail-closed, not silent credit to the old wallet).
- **PostgREST clients** that read `ervenow_ledger_*` with the user JWT will get zero rows after lockdown SQL (correct). Any unofficial dashboard using anon/authenticated against those tables will break.

---

## SECURITY VERIFICATION

Exploit attempts from the audit, as implemented in tests:

| Attempt | Result |
|---------|--------|
| `POST /api/core/users/sync` `{ "role": "admin" }` | **403** — no write |
| Same for `merchant`, `driver`, `provider`, `transport`, `store` | **403** |
| `GET /api/admin/settings` no token | **401** |
| Customer / merchant JWT | **403** |
| JWT `role=admin` but DB `customer` | **403** |
| Admin JWT + DB admin | **200** |
| Checkout `price: 1` / `subtotal: 1` / `discount: 99` on product 100 | Insert **`order_total: 100`** |
| Client `delivery_fee: 1` on map delivery | Server tariff (**23** for mocked 10 km) |
| Client `financial_intent.grand_total` | Ignored; server order totals used |
| Second refund | `already_refunded`, `refunded: false` |
| Refund after `already_settled` | refused |
| `SUPABASE_SERVICE_ROLE_KEY` in `public/` | **not found** |

---

## MONEY INVARIANTS

| Invariant | Status |
|-----------|--------|
| **No double refund** | Enforced in RPC (`refund:order:{id}` + unique completed reference + advisory lock). JS treats `already_refunded` as non-credit. |
| **No double credit** | Same reference cannot complete twice on the same wallet. Cancel does **not** credit `ervenow_wallets`. |
| **No client-side price trust** | Checkout goods/delivery/service totals from DB/catalog/OSRM. EW PAY amount from server orders, not `financial_intent`. |
| **No unauthorized admin promotion** | No public endpoint writes `users.role = admin`. Admin assignment is DB/operator only. |
| **Single source of truth** | New EW PAY debit **and** cancel refund are `ervenow_ledger_*`. Legacy `ervenow_wallets` is not used for new cancel credits. |
| **No negative refund amount from client** | RPC amount = original debit; client amount is not a parameter. |
| **Settlement then refund** | Blocked when `settlement_log` has `ledger_delivered` for the order. |

---

## NEXT (not this phase)

P1 only, separate engagement: OTP rate limit, WhatsApp signature, debt-info auth, settlement guard fail-closed, guest home-order auth, `ledger/pay` server amount, apply the two SQL files, seed admin, `frontend:sync` for admin-settings.

Until those ops + P1 items are done, the decision stays **B**.
