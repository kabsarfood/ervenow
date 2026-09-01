# ERVENOW — FULL PLATFORM AUDIT

**Date:** 2026-09-01  
**Scope:** Entire repository `c:\Users\USER\Desktop\ervenow` — actual current code, not prior reports.  
**Mode:** AUDIT ONLY. No code changes, no migrations, no refactors, no production config changes.  
**Method:** Read-only inspection of `apps/`, `shared/`, `server/`, `public/`, `workers/`, `queues/`, `tests/`, SQL under `shared/`, deploy configs. Jest unit tests were executed as evidence (see §29). No live production traffic was mutated.

**Code vs docs rule:** Where `docs/SOURCE-OF-TRUTH.md` or older audits disagree with code, **code wins**. Drift is recorded.

---

## FINAL DECISION

# **B — INTERNAL TESTING ONLY**

ERVENOW is a real, working **modular monolith** with a connected customer → checkout → `orders` → merchant/driver → settlement path in code. It is **not** Soft Beta, Public Beta, or Production Ready.

**Why not C (Closed Alpha) or D (Soft Beta):**

1. Any authenticated user can set `users.role = admin` via `POST /api/core/users/sync` (`apps/core/routes.js:1156–1188`).
2. `GET/POST /api/admin/settings` has **no authentication** (`apps/admin/settings.js:14–43`, mounted at `server/server.js:285`).
3. ERVENOW PAY checkout debits `ervenow_ledger_*`, while customer cancel refunds `ervenow_wallets` (`apps/delivery/service.js:198–212`). That can create or orphan money.
4. Checkout **trusts client line prices** (`apps/checkout/service.js:244`).
5. Finance RLS is `USING (true)` for `authenticated` (`shared/migration_bootstrap_ledger_finance.sql:691–705`). Backend bypasses RLS via service role anyway.

Until P0 items in §39 are closed, the platform must stay **internal-only**. Do not take real customer money, do not invite external merchants/drivers, do not advertise Soft Beta.

---

# EXECUTIVE SUMMARY — TOP 20 REAL RISKS

Each item is from current code, not a generic checklist.

| # | Risk | Evidence | Impact |
|---|------|----------|--------|
| 1 | **Privilege escalation to admin** | `POST /api/core/users/sync` accepts `req.body.role` including `"admin"` and upserts `users` (`apps/core/routes.js:1156–1188`). Next `requireAuth` reads DB role (`shared/middleware/auth.js:122–123`). | Full admin API + finance. |
| 2 | **Unauthenticated platform settings write** | `apps/admin/settings.js` GET/POST with no `requireAuth`. Mount: `server/server.js:285`. Duplicate of authenticated `/api/admin/platform-settings`. | Anyone can change `platform_settings`. |
| 3 | **EW PAY refund hits the wrong wallet** | Checkout: `ervenow_ledger_checkout_ew_pay`. Cancel: `ervenow_wallet_customer_refund_atomic` (`apps/delivery/service.js:208`). | Double credit / unreversed ledger debit. |
| 4 | **Client-trusted product prices** | `const total = groupItems.reduce((sum, i) => sum + (Number(i && i.price) \|\| 0), 0)` (`apps/checkout/service.js:244`). No re-read of `store_products.price`. | Arbitrary underpay. |
| 5 | **Permissive finance RLS + GRANT to `authenticated`** | `USING (true) WITH CHECK (true)` on ledger tables; `GRANT EXECUTE` on settle/refund RPCs (`shared/migration_bootstrap_ledger_finance.sql:691–727`). | If PostgREST + anon/auth JWT is reachable: full ledger. |
| 6 | **OTP login can overwrite existing user role** | `upsertDriverByPhone` patches `role` when `loginOnly=false` (`apps/core/routes.js:307–319`). `ALLOWED_USER_ROLES` includes `admin` (`apps/core/routes.js:105`). | Role change without admin approval. |
| 7 | **`register-account` creates admin as `status: active`** | New admin insert uses `initialStatus = role === "admin" ? "active" : "pending"` (`apps/core/routes.js:331`). Phone allowlist is **not** applied here (only on send/verify OTP). | Unapproved admin account. |
| 8 | **Checkout does not check stock, `is_active`, or store hours** | Store query: `status = approved` only (`apps/checkout/service.js:284–291`). Hours are UI fiction (`public/assets/kabsar-store-polish.js`). | Orders against closed/inactive/out-of-stock stores. |
| 9 | **No driver assignment timeout / reassign / reject** | Accept uses optimistic `.is("driver_id", null)` (`apps/driver/routes.js:742–743`). No reject route. WhatsApp reject replies “قيد التطوير” (`apps/whatsapp/routes.js:116–123`). | Stuck orders; lost deliveries. |
| 10 | **WhatsApp webhook has no Twilio signature check** | `POST /api/whatsapp/webhook` (`apps/whatsapp/routes.js:62–67`) accepts any POST; choice `1` calls `acceptOrder`. | Forged accept of driver jobs. |
| 11 | **Unauthenticated debt IDOR** | `GET /api/pay/debt-info?uid=` loads user + debt snapshot (`apps/pay/routes.js:44–60`). `POST /api/pay/create-session` same. | Enumerate debts; open payment sessions for others. |
| 12 | **Settlement claim failure still proceeds** | `tryClaimSettlement` returns `true` on RPC error (`shared/services/settlementGuard.js:50–52`). Settlement then always calls RPC (`deliveredFinancialSettlement.js:133–134`). | Duplicate settlement if `reference_id` unique fails or is missing. |
| 13 | **Service orders can be created without auth** | `POST /api/services/home-order` uses `optionalAuth` (`apps/services/routes.js:303`) and `createServiceOrder(..., req.appUser \|\| { id: null, phone })`. | Unowned / orphaned bookings. |
| 14 | **No OTP rate limit on send** | `POST /api/core/send-otp` (`apps/core/routes.js:546`) has cooldown inside OTP service, **not** IP rate-limit middleware. Checkout limiter does not cover OTP. | OTP / Twilio cost abuse. |
| 15 | **`.gitignore` has unresolved merge conflict** | Lines 1–6 of `.gitignore` contain `<<<<<<< HEAD`. | Risk of committing `.env`, logs, or ignoring the wrong set. |
| 16 | **Split deploy drift (`public/` vs `ervenow-frontend/`)** | `ervenow-frontend/` is a sync copy (`scripts/sync-ervenow-frontend.js`). Git status at audit time showed both trees dirty and diverging. | Production UI ≠ API server static tree. |
| 17 | **Guest tracking is not E2E** | `public/track.html` refuses without JWT (`~2919`). WhatsApp tracking links cannot work for guests. | Broken customer tracking after order. |
| 18 | **Triple/quadruple wallet stacks** | `ervenow_ledger_*` (intended SoT, `FINANCE_MODE=ledger_only`), `ervenow_wallets`, `wallets`/`wallet_transactions`, `driver_wallets`/`store_wallets`. Docs `SOURCE-OF-TRUTH.md` still names `ervenow_*` as SoT. | Money in the wrong table; operators cannot reconcile. |
| 19 | **No CI, no Sentry, no request IDs** | No `.github/workflows`. Logger is Pino without request correlation (`shared/utils/logger.js`). Metrics optional and unauthenticated if enabled (`server/server.js:260–268`). | Cannot operate production incidents. |
| 20 | **Hardcoded default admin phone + unknown admins get `full`** | `ERVENOW_ADMIN_FULL_PHONES \|\| "0505745650"` (`apps/admin/routes.js:154`). Unknown admin phones default to `full` (`apps/admin/routes.js:158–163`). | Permission model is env phones, not DB RBAC; default is overly broad. |

---

# 1. PROJECT INVENTORY

## 1.1 What ERVENOW actually is

| Layer | Reality |
|-------|---------|
| Runtime | **One Node.js Express process** (`server/server.js`, default port **4000**) |
| Pattern | **Modular monolith** — `apps/*` slices + `shared/*` kernel |
| Database | **Supabase PostgreSQL** via `@supabase/supabase-js` **service role** |
| Frontend | Static HTML/CSS/JS in `public/` (source of truth) |
| CDN copy | `ervenow-frontend/` generated by `npm run frontend:sync` for Vercel |
| Queues | BullMQ + Redis **optional**; inline `setImmediate` if no `REDIS_URL` |
| Realtime | Socket.IO on the same HTTP server (`/socket.io/`) |
| Auth | Custom JWT after WhatsApp OTP — **not** Supabase Auth |

Root package: `ervenow-platform@2.0.0` (`package.json`). Entry: `"start": "node --use-system-ca server/server.js"`. Root `server.js` is a shim: `require("./server/server.js")`.

## 1.2 Top-level folders

| Path | Purpose | Notes |
|------|---------|-------|
| `apps/` | 18 API modules | admin, categories, checkout, core, delivery, driver, finance, food, invoice, market, notifications, order, pay, services, store, test, wallet, whatsapp |
| `shared/` | Config, middleware, services, SQL (~143 `.sql` files) | **No** `supabase/migrations/` CLI folder |
| `server/` | Main Express + Socket.IO | Nested `server/package.json` is **legacy unused** |
| `public/` | Static UI SoT (~72 HTML pages) | |
| `ervenow-frontend/` | Vercel mirror of `public/` | Duplicate by design; drift risk |
| `workers/` | `deliveryWorker.js`, `deliveryProcessor.js` | Separate process if Redis |
| `queues/` | `deliveryQueue.js` | |
| `scripts/` | Migrations, sync, audits | |
| `tests/` | Jest + Playwright + Artillery | |
| `data/` | Runtime JSON flags + generated audit JSON | Not source |
| `docs/` | Historical reports + screenshots | **Not used as SoT for this audit** |
| `examples/` | `kabsar-pos-ervenow-push.js` | |
| `.redis-local/` | Local Redis bootstrap | gitignored |

**Junk at repo root:** 0-byte files `node`, `npm`, `erwenow-platform@2.0.0` (accidental). `preview-hero-banner.html` orphaned outside `public/`.

## 1.3 Applications by role (there are no separate backend apps)

There is **no** `apps/merchant`, `apps/restaurant`, `apps/transport`, or `apps/customer`. Mapping:

| Product name | Backend | Frontend |
|--------------|---------|----------|
| Customer / guest | `apps/core`, `order`, `checkout`, `store` (public), `services` | `index.html`, `cart.html`, `checkout.html`, `store.html`, `restaurants.html`, … |
| Store / Merchant / Restaurant | **`apps/store` only** | `store-dashboard.html`, `merchant-dashboard.html`, `merchant-preview.html`, `order-board.html` |
| Driver | `apps/driver` + `apps/delivery` | `driver-preview.html`, `driver-app.html`, `driver.html` (legacy) |
| Service provider | `apps/services` | `service-preview.html`, `services-provider.html` |
| Transport | **Reuses `apps/services`** | `transport-preview.html` (shell) |
| Admin | `apps/admin` | `admin/admin-dashboard.html` + legacy `admin-dashboard.html` |
| Wallet / Pay | `apps/wallet`, `apps/pay`, `apps/finance` | `wallet.html`, `pay.html` |

## 1.4 Environment variables (names only)

From `.env.example` plus additional names referenced in code. **Values not printed.**

**Core:** `ERVENOW_JWT_SECRET`, `BANK_DATA_SECRET`, `PORT`, `NODE_ENV`, `FINANCE_MODE`, `INTERNAL_API_KEY`, `ERVENOW_PUBLIC_URL`  
**OTP:** `ERVENOW_OTP_BACKEND`, `ERVENOW_OTP_PEPPER`, `ALLOW_DEV_OTP`, `ERVENOW_DEV_OTP_CODE`, `ERVENOW_OTP_RESEND_COOLDOWN_MS`, `ERVENOW_OTP_LOCK_MS`  
**Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_DB_PASSWORD`, `DATABASE_URL`  
**Redis:** `REDIS_URL`, `BULLMQ_QUEUE_NAME`, `BULLMQ_DLQ_NAME`, `BULLMQ_WORKER_CONCURRENCY`  
**Payments:** `PAYMENT_GATEWAY`, `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY`, `PAY_WEBHOOK_SECRET`, `ERVENOW_REQUIRE_ORDER_PAYMENT`  
**Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`  
**Maps:** `OSRM_ROUTER_URL`, `ORS_API_KEY`  
**Admin phones:** `ERVENOW_ADMIN_FULL_PHONES`, `ERVENOW_ADMIN_LIMITED1_PHONES`, `ERVENOW_ADMIN_LIMITED2_PHONES`  
**Legacy spellings still read:** `ERWENOW_JWT_SECRET`, `ERWENOW_PUBLIC_URL`, `ERWENOW_PLATFORM_COMMISSION_RATE`

No frontend `.env`. API base is injected as `window.__ERVENOW_API_BASE__` during `frontend:sync`.

## 1.5 Deployment files

| File | Platform |
|------|----------|
| `railway.toml` | Railway — Nixpacks, `npm start`, health `/api/health` |
| `ervenow-frontend/vercel.json` | Vercel static |
| **Not found:** Dockerfile, docker-compose, nginx, PM2, `.github/workflows` | |

## 1.6 Duplicate / unused / legacy (do not delete now)

| Item | Status |
|------|--------|
| `public/` vs `ervenow-frontend/` | Designed duplicate; currently can diverge |
| `server/package.json` | Unused nested package |
| `apps/finance/wallet-server.js` | Legacy Express on :9000, **no JWT** |
| `apps/food/` | Legacy menu/orders vs unified store checkout |
| `apps/test/` | Dev commission trigger |
| `public/admin-dashboard.html` (5285 lines) | Superseded by `public/admin/admin-dashboard.html` |
| `public/delivery/*` | Legacy delivery sub-app |
| `public/driver.html` | Legacy driver UI |
| `public/erwenow.html` | Empty typo file |
| `delivery_orders` table | Legacy; Node writes `orders` |
| Root `node`, `npm` 0-byte files | Junk |

---

# 2. CURRENT ARCHITECTURE

```
Browser (public/*.html + assets/api.js)
        │  Authorization: Bearer JWT
        ▼
Express gateway  server/server.js  :4000
        │  middleware: CORS, json 12mb, morgan, blockSensitiveAccess
        ▼
API routers  /api/{core,order,checkout,store,delivery,driver,services,
                   wallet,finance,admin,pay,notifications,invoice,whatsapp,...}
        │
        ▼
Business logic  (mixed)
  • shared/services/*     (better path)
  • apps/*/service.js
  • INLINE in routes.js   (admin 3810 lines, store 2535, services 1473, core 1171)
        │
        ▼
Supabase JS client  shared/config/supabase.js
  createServiceClient() = SERVICE ROLE  → RLS bypassed
        │
        ▼
PostgreSQL (orders, stores, users, ervenow_ledger_*, …)
        │
        ├── queues/deliveryQueue.js  → Redis/BullMQ  → workers/deliveryWorker.js
        │                              (or setImmediate if no REDIS)
        ├── Socket.IO  shared/lib/trackingSocket.js
        └── External: Twilio WhatsApp, OSRM, ORS, Moyasar (optional)
```

## 2.1 Entry points

| Process | File | When |
|---------|------|------|
| Main API + UI + Socket.IO + in-process timers | `server/server.js` | `npm start` |
| Root shim | `server.js` | same |
| Delivery worker | `workers/deliveryWorker.js` | `npm run worker:delivery` (needs Redis) |
| Legacy wallet HTTP | `apps/finance/wallet-server.js` | blocked in production unless `ERVENOW_WALLET_STANDALONE_SERVER=1` |

## 2.2 Middleware

| Concern | File | Notes |
|---------|------|-------|
| JWT | `shared/middleware/auth.js` | `requireAuth`, `optionalAuth` |
| Roles | `shared/middleware/roles.js` | `requireRole`, service provider helpers |
| Store | `shared/middleware/storeRole.js` | `store` \| `merchant` \| `restaurant` \| `admin` |
| Place orders | `shared/middleware/platformAccess.js` | `denyUnlessCanPlaceOrders` |
| Rate limit | `shared/middleware/apiRateLimits.js` | **checkout + delivery create only** |
| CORS | `server/server.js` `corsDynamic()` | no Origin → allowed |
| CSRF | **None** | |
| Site OTP HTML gate | `shared/middleware/publicSiteOtpGate.js` | pages, not API |
| Internal key | `apps/delivery/internalAuth.js` | **defined, not wired to routes** |

## 2.3 Architecture evaluation

| Question | Answer |
|----------|--------|
| Modular? | **Partially** — folders exist; god-files dominate |
| Microservices? | **No** |
| Modular monolith? | **Yes** — accurate label |
| Coupling | **High** — routes ↔ Supabase ↔ notify ↔ queue |
| Circular deps | Soft: `unifiedOrderStatus` lazy-requires `apps/driver/notify.js`; queue lazy-requires processor |
| Business logic in routes? | **Yes, heavily** — especially `apps/admin/routes.js` |
| Duplicated logic? | Checkout vs delivery create; three wallet stacks; food vs store; dual admin UIs |
| Huge files? | Yes — see §32 |

**No repository layer.** Data access is `req.supabase.from(...)` or `createServiceClient()`.

---

# 3. USER ROLES & IDENTITY

## 3.1 Identity model (actual)

- **No passwords. No refresh tokens. No email verification.**
- Login = WhatsApp OTP → JWT `{ sub, phone, role }` TTL **7 days** (`apps/core/routes.js` `signPlatformToken`).
- Logout = client `localStorage`/cookie clear. No server revocation list.
- `requireAuth` **reloads user from DB**; **DB role wins** over JWT (driver exception if DB still `customer`).

## 3.2 Flows

| Flow | Endpoint | Status |
|------|----------|--------|
| Send OTP | `POST /api/core/send-otp` | Working (Twilio); **no IP rate limiter** |
| Verify OTP / signup | `POST /api/core/verify-otp` | Working; can set role from body |
| Register without OTP | `POST /api/core/register-account` | Working; pending (except admin → active) |
| Driver OTP | `POST /api/driver/send-otp`, `/verify-otp` | Requires `drivers` row approved |
| Admin OTP | Core OTP + env phone allowlist | Allowlist **not** on `register-account` |
| Password reset | — | **NOT IMPLEMENTED** |
| Session refresh | — | **NOT IMPLEMENTED** |

OTP storage: `shared/services/otpChallengeService.js` (memory or Supabase hashed).  
`isDevOtpBypassCode` **always returns false** (`shared/utils/devOtpBypass.js:19–21`) — core login bypass is dead. Wallet withdraw **still returns `dev_otp` in JSON** if `ALLOW_DEV_OTP=true` (`apps/wallet/routes.js:505`).

## 3.3 Role leakage table

| Role | Should be allowed | Actually allowed | Security risk | Recommendation |
|------|-------------------|------------------|---------------|----------------|
| **Customer** | Browse, cart, own orders/wallet | Yes if `status=active` | Can self-promote via `/users/sync` or verify-otp | Freeze role after first approval |
| **Store / Merchant / Restaurant** | Store panel, products, accept/prepare/ready | Same `requireStoreRole`; **can also checkout** (`canPlaceOrders` returns true for everyone except driver — `platformAccessPolicy.js:37–42`) | Medium conflict-of-interest + escalation | Deny checkout for store roles if policy requires |
| **Restaurant** | Same as store | Alias only (`storeRole.js:7`) | Naming confusion, not extra privilege | Unify naming to `store` |
| **Driver** | Dispatch, accept own jobs, wallet | Open queue visible; assigned orders scoped; accept lock on `driver_id IS NULL` | Queue PII before assign; no `requireRole("driver")` on some routes (phone match on `drivers` table) | Add role + ownership consistently |
| **Service provider** | Scoped bookings | `filterBookingsForProvider` + reserve checks | Low on mutations; unassigned jobs in geo scope by design | Keep; add reject for all verticals |
| **Transport provider** | Same as service + transport types | `portalRole: transport` is **frontend routing** (`resolvePortalRole.js`) | Same as service | Do not treat as separate security domain |
| **Admin** | Full console | JWT role `admin` **or** DB role admin; permissions by **phone env lists**; unknown phones → **full** | **Critical** via `/users/sync` and `register-account` | Never accept client `role=admin`; default unknown to deny |

## 3.4 Admin RBAC

Not a permissions table in DB. Phone → `{ full | limited1 | limited2 }` (`apps/admin/routes.js:116–189`).

**Gap:** `GET /registration-approvals` uses `requireRole("admin")` without `requireAdminPermission` (`apps/admin/routes.js:2406`).

---

# 4. CUSTOMER JOURNEY

Criterion: UI → API → DB connected. Page existence is **not** success.

| Step | Status | Evidence / break |
|------|--------|------------------|
| Guest Home | **PARTIAL** | `index.html` real; marketing JSON `data/marketing/experiences/home.json` |
| Browse stores/restaurants | **WORKING** | `GET /api/store`, `GET /api/store/public/:id` |
| Product page | **WORKING** | `store.html` + products API |
| Cart | **WORKING (client draft)** | `shared/orderDraft` + `public/assets/cart.js` — **no server cart TTL** |
| Address / GPS | **WORKING if provided** | Checkout requires coords for store path (`apps/checkout/service.js:310–314`) |
| Delivery quote | **WORKING** | Server recomputes fee (`checkoutDeliveryEngine.js`, `deliveryPolicyEngine.js`) |
| Checkout | **WORKING with caveats** | `POST /api/order/create` → `handleUnifiedCartCheckoutHttp` → `runCheckoutInsert` |
| Payment | **PARTIAL** | COD stored; EW PAY ledger RPC if method `ew_pay`; card methods listed in UI (`checkoutPaymentMethods.js`) — **capture is not store-checkout completion**; Moyasar is **debt pay-link** (`apps/pay`) |
| Order creation | **WORKING** | Inserts `orders` |
| Merchant acceptance | **WORKING for store/restaurant** | Merchant workflow + `PATCH /api/order/:id/status` |
| Driver assignment | **PARTIAL** | Broadcast top 3 WhatsApp; **no timeout**; merchant orders wait until `ready` |
| Tracking | **PARTIAL** | Socket + `/track` **requires login** — guest WhatsApp link **breaks** |
| Completion | **WORKING** | `delivered` → settlement RPC |
| Wallet / settlement | **PARTIAL** | Ledger path exists; refund mismatch (§12) |
| Rating | **WORKING** | `POST /api/order/:id/rate`, delivery rate |
| Refund | **BROKEN for EW PAY** | Wrong wallet RPC |

**Where the flow actually breaks under production conditions:**

1. Price integrity at checkout (client `item.price`).
2. Closed/inactive store still orderable.
3. Guest tracking.
4. EW PAY cancel refund.
5. Driver never accepts → order sits forever.

---

# 5. COMMERCE

| Concern | Status | Evidence |
|---------|--------|----------|
| Restaurants browse | **WORKING** | `stores` + cuisine filters (`shared/restaurantCategories.js`) |
| Stores CRUD | **WORKING** | `apps/store/routes.js` |
| Products / categories / offer_price | **WORKING** | Merchant API; UI `min(price, offer_price)` |
| Inventory `stock` | **PLACEHOLDER** | Stored; **not decremented at checkout** |
| Product options/addons (store) | **NOT IMPLEMENTED** | Only car-polish addons (`carPolishingPricing.js`) |
| Coupons | **NOT IMPLEMENTED** | No checkout promo codes (hero banners ≠ coupons) |
| Taxes VAT 15% | **WORKING** | `shared/utils/orderTotals.js` |
| Delivery fee | **WORKING** | Default **2.3 SAR/km** (`deliveryPolicyEngine.js`) |
| Min order / free delivery | **WORKING** | Policy engine |
| Hours / open-close | **PLACEHOLDER** | Client hardcoded 09:00–23:30; map `is_open` = `is_active` |
| Store inactive at checkout | **GAP** | Approved only, not `is_active` |

**Legacy:** `apps/food/routes.js` returns **hardcoded demo menu** if `food_menu_items` missing (`routes.js:18–33`).

---

# 6. CART & CHECKOUT

## 6.1 Ownership & validation

- Auth required on `POST /api/order/create`.
- `customer_id = appUser.id`.
- Single-store rule enforced (`apps/checkout/service.js:249–251`).
- Delivery fee: **server quote wins** when snapshot path used.
- VAT: server `normalizeOrderFinancialsForInsert`.
- **Goods subtotal: client `item.price`.**

`financial_intent.grand_total` is **not** used for charging when server can compute (`ervenowPayCheckout.js:50–64`) — but computed total still includes client goods prices.

## 6.2 Payment methods

| Method | Reality |
|--------|---------|
| COD / cash | Stored on order; delivery continues |
| `ew_pay` | Ledger debit + merchant hold |
| mada / visa / apple_pay / stc_pay / tabby / tamara | **UI flags** via `platform_settings` / checkout methods — **not** a card capture on `/api/order/create` |
| `ERVENOW_REQUIRE_ORDER_PAYMENT=1` | Orders stay `draft` until paid (`orderPaymentGate.js`) |

**Doc drift:** `docs/SOURCE-OF-TRUTH.md` says cart SoT is `POST /api/checkout`. Code: checkout is **`@deprecated`** and calls the same HTTP handler with **`applyPaymentGate: false`** (`apps/checkout/routes.js:9–15`). **Primary path is `POST /api/order/create` with `applyPaymentGate: true`.** Using the deprecated route **bypasses the payment gate**.

## 6.3 Anti-abuse

| Control | Status |
|---------|--------|
| Idempotency-Key + `checkout_idempotency` | **WORKING** |
| Per-order `idempotency_key` | **WORKING** |
| Similar-order dedup 15 min | **WORKING** (`orderDedup.js`) |
| Client double-click lock | **WORKING** (`checkout-engine.js`) |
| Rate limit | checkout 5/min; order create 24/min |
| Expired cart | **NOT IMPLEMENTED** (localStorage draft) |
| Replay of paid cart | Relies on idempotency keys |

**Frontend manipulation:** attacker sets `items[].price` to `0.01`. Server will persist that `order_total`. **Do not trust the browser.**

---

# 7. ORDER ENGINE

## 7.1 Real statuses (from code)

**SoT column:** `orders.delivery_status` (`shared/domain/orders/constants.js:7–20`):

`draft` → `new` / `pending` → `accepted` → `preparing` → `ready` → `picked` / `picked_up` → `delivering` → `delivered`  
Terminal: `cancelled`, `cancelled_by_customer`

**Legacy finance column:** `orders.status`: `new`, `accepted`, `onroad`, `delivered`, `cancelled`.

**Car polish:** extra `data.cp_status`. **Home service:** `sp_status`.

## 7.2 State machine (actual)

Guards in `patchUnifiedOrderStatus` (`shared/services/unifiedOrderStatus.js`):

1. Terminal lock after delivered/cancelled.
2. RBAC: customer cancel; driver pickup/deliver; merchant `accepted|preparing|ready`; admin all.
3. FSM: `isValidDeliveryTransition` (`shared/utils/helpers.js:47–69`).

**Allowed skips (by design in code):**

- `accepted` → `delivering`
- `ready` → `delivering`
- `accepted` → `delivered` (driver UI shortcut)

`shared/utils/deliveryStateMachine.js` documents a map; **runtime uses `isValidDeliveryTransition`**, which is **looser** than a strict sequential machine.

```
                    ┌──────────────┐
 guest/pay wait     │    draft     │
                    └──────┬───────┘
                           │ draft→pending
                    ┌──────▼───────┐
                    │ new/pending  │  ← driver queue (non-store)
                    └──────┬───────┘
                           │ accept
                    ┌──────▼───────┐
            ┌───────│  accepted    │──────┐
            │       └──────┬───────┘      │ skip to delivering/delivered
            │              │ merchant      │
            │       ┌──────▼───────┐      │
            │       │  preparing   │      │
            │       └──────┬───────┘      │
            │              │              │
            │       ┌──────▼───────┐      │
            │       │    ready     │──┐   │  ← driver notify for stores
            │       └──────┬───────┘  │   │
            │              │          │   │
            │       picked_up / picked│   │
            │              │          │   │
            │       ┌──────▼──────────▼───▼─┐
            │       │     delivering        │
            │       └──────┬────────────────┘
            │              │
            │       ┌──────▼───────┐
            └──────►│  delivered   │ → settlement
                    └──────────────┘
 cancel from draft|new|pending|accepted (customer/admin)
```

## 7.3 Race / lost orders

| Issue | Status |
|-------|--------|
| Duplicate checkout | Mitigated by idempotency |
| Two drivers accept | Optimistic UPDATE `driver_id IS NULL` — **good enough at moderate load**, not `SELECT FOR UPDATE` |
| Customer cancel vs status patch | Read-then-update (`cancelOrderByCustomer`) — **race** |
| Order without driver | **Possible forever** — no timeout |
| Order without settlement | Delivered always attempts RPC; claim errors do not block |

---

# 8. DRIVER SYSTEM

| Feature | Status | Evidence |
|---------|--------|----------|
| Registration | **COMPLETE** | `POST /api/driver/register` → `drivers.status=pending` |
| KYC documents | **NOT IMPLEMENTED** | Fields: name, iqama, car, plate — no upload API |
| Admin approve | **COMPLETE** | Sets `active=true` |
| Self online/offline | **NOT IMPLEMENTED** | `drivers.active` is admin-side |
| GPS | **COMPLETE** | `POST /api/driver/update-location` + socket `driver:location` |
| Offers | **COMPLETE** | `GET /api/driver/orders` open + ready queue |
| Accept | **COMPLETE** | Optimistic lock |
| Reject | **NOT IMPLEMENTED** | |
| Pickup / deliver | **COMPLETE** | start-delivery, complete-order |
| Tracking broadcast | **COMPLETE** | Socket rooms |
| Earnings / wallet / rating | **COMPLETE** | ledger-based earnings |
| History | **PARTIAL** | last 12 delivered |
| Nearest dispatch | **COMPLETE** | haversine 30 → OSRM 10 → **top 3 WhatsApp** (`apps/driver/notify.js:65–173`) |
| Timeout / reassign | **NOT IMPLEMENTED** | |
| Push (FCM) | **NOT IMPLEMENTED** | `notifyDriver()` is console-only (`notify.js:25–33`) |
| WhatsApp retry | **PARTIAL** | 30s worker, max 3 (`retryNotifications.js`) |

---

# 9. MERCHANT / RESTAURANT

**There is one backend: `apps/store/routes.js`.**  
`merchant`, `restaurant`, `store` are **role aliases** (`storeRole.js`). Discriminator is `stores.type` / `order_type`.

| Step | Status |
|------|--------|
| Register facility | **COMPLETE** — `POST /api/store/register`, `status=pending` |
| Admin approve | **COMPLETE** |
| Products / prices | **COMPLETE** |
| Order board | **COMPLETE** — `GET /api/store/order-board` |
| Accept → prepare → ready | **COMPLETE** — `merchant-order-workflow.js` + unified PATCH |
| Handoff to driver | **COMPLETE** — notify on `ready` (`unifiedOrderStatus.js:267–273`) |
| Wallet / withdrawals | **COMPLETE** (migration-dependent) |
| Reports | **PARTIAL** — merchant-dashboard counts, not full P&L |

**Duplication to unify later:** `apps/food` + `food_orders`; `store-dashboard` vs `merchant-dashboard` vs `merchant-preview` (different UIs, same account).

---

# 10. SERVICE PROVIDER

| Step | Home services | Gas | Car polish | Car transport |
|------|---------------|-----|------------|---------------|
| Catalog | COMPLETE | COMPLETE | COMPLETE | COMPLETE (pricing util) |
| Create request | COMPLETE | COMPLETE | COMPLETE | COMPLETE |
| Notify providers | COMPLETE | COMPLETE | COMPLETE | COMPLETE (`carTransportNotify.js`) |
| Reserve / accept | COMPLETE | COMPLETE + radius | COMPLETE | COMPLETE |
| Reject | PARTIAL | PARTIAL | COMPLETE (`/reject`) | PARTIAL |
| Scheduling | PARTIAL (`scheduled_at`, module flag enabled) | PARTIAL | PARTIAL | PARTIAL |
| Execution phases | COMPLETE (`sp_status`) | COMPLETE | COMPLETE (`cp_status`) | PARTIAL (generic status) |
| Complete | COMPLETE | COMPLETE | via cp_status | **NOT via `completeServiceOrder`** — excluded types handled elsewhere |
| Payment | COMPLETE | COMPLETE | COMPLETE | COMPLETE (shared) |
| Commission / ledger | COMPLETE | COMPLETE | COMPLETE | COMPLETE (shared) |
| Rating | COMPLETE | COMPLETE | COMPLETE | COMPLETE |

`POST /api/services/home-order` is **`optionalAuth`** — **PLACEHOLDER-grade identity** for guest create.

**Verdict:** Home/gas/polish are the real service product. Transport types are **PARTIAL** on the same table.

---

# 11. TRANSPORT

| Layer | Reality |
|-------|---------|
| Purpose | Themed portal for `pickup_truck`, `car_transport`, `vehicle_transfer`, `furniture_move` |
| Dedicated `apps/transport` | **Does not exist** |
| Frontend | `transport-preview.html` — comment: uses existing `/api/services` only |
| Config | `public/assets/portal-framework/configs/transport.json` menu |
| DB | Shared `orders` + `users.service_type` — **no transport tables** |
| Booking / pricing / settlement | Reuse services layer (`carTransportPricing.js`) |
| Admin | List providers `segment=transport` |
| `data/portal-launch.json` | `"transport": true` and path `/transport-preview` |

**Launch-ready as independent vertical? No. Skeleton / portal skin. Do not launch Transport as a product.**

---

# 12. ERVENOW PAY

## 12.1 Intended source of truth

`.env.example`: `FINANCE_MODE=ledger_only` → **`ervenow_ledger_wallets` + `ervenow_ledger_transactions`**.

`docs/SOURCE-OF-TRUTH.md` still says operational wallet is `ervenow_*`. **Code default disagrees with that doc.**

## 12.2 Is it double-entry? SUM(DEBITS)=SUM(CREDITS)?

**No global journal.** Per-wallet credit/debit rows. EW PAY checkout:

1. Customer **debit** (`ervenow_ledger_pay`)
2. Platform **credit** escrow `escrow:order:{id}`
3. Merchant **pending credit** hold `order:{id}:hold:merchant`

There is **no constraint** that platform-wide SUM(debit)=SUM(credit). Balance on wallet is trigger-recalculated and **clamped to 0** if negative (`migration_unified_finance_ledger.sql`).

Node also **recomputes** `SUM(credit)-SUM(debit)` (`ledgerWallet.js`) — two notions of balance.

## 12.3 Money bugs

| Bug | Evidence |
|-----|----------|
| Cancel refund → operational wallet not ledger | `refundCustomerWalletIfPaid` → `ervenow_wallet_customer_refund_atomic` |
| `financial_intent` fallback if computed=0 | `ervenowPayCheckout.js:54–56` can charge **client intent** |
| Settlement claim error → proceed | `settlementGuard.js:50–52` |
| Legacy `driver_ledger` COD | Skipped in `ledger_only`; still exists |
| Wallet P2P transfer | **501 Not Implemented** (`apps/wallet/routes.js:369–376`) |
| Standalone wallet-server | No JWT; production-gated |

**Source of Truth (honest):** For new EW PAY checkouts, **ledger RPCs**. For cancel refunds, **legacy `ervenow_wallets`**. Operators cannot treat either as complete SoT until refund is on the same ledger.

---

# 13. COMMISSIONS

Single rate helper: `shared/utils/platformCommission.js` — default **7%** (`ERVENOW_PLATFORM_COMMISSION_RATE`).

### Numeric example from code + unit test (`tests/unit/cartFinancialIntent.test.js:41–55`)

| Item | SAR |
|------|-----|
| Goods | 100.00 |
| Delivery 5 km × 2.3 | 11.50 |
| Platform on goods 7% | 7.00 |
| Platform on delivery 7% | 0.805 → 0.81 |
| **merchant_net** | **93.00** |
| **driver_net (intent)** | **10.695 → ~10.70** |
| VAT 15% × (100+11.50) | 16.725 → **16.73** |
| **grand_total** | **128.23** |

**Code inconsistency:** store snapshot checkout may store **`driver_earning = full delivery_fee`** (`checkoutDeliveryEngine.js`) while intent math deducts 7% from driver. **Merchant net and driver net can disagree between UI intent and persisted columns.**

VAT is on goods+delivery, **not** on commission as a separate taxable slice in this path.

DB `commission_rules` can override in `apps/finance/accountingEngine.js` (legacy finance path).

---

# 14. REFUNDS & CANCELLATIONS

| Actor | Path | Guard |
|-------|------|-------|
| Customer / admin | `POST /api/order/:id/cancel` → `cancelOrderByCustomer` | statuses `draft\|new\|pending\|accepted` |
| Admin unified PATCH | `cancelled*` | admin bypass |
| Admin ledger refund | `POST /api/wallet/ledger/refund` | admin JWT |
| Admin legacy finance refund | `POST /api/finance/orders/:id/refund` | blocked in `ledger_only` via `assertLedgerOnlyFinance` |

**Partial refund:** **No** (RPC rejects amount mismatch).  
**Double refund (operational wallet):** note `refund_customer_cancel:{order_id}` — **idempotent on that table**.  
**Does not reverse EW PAY ledger debit.**  
**Refund after settlement:** legacy RPC can reverse if `settled_at` set; **no automatic EW PAY reverse from customer cancel after deliver**.

---

# 15. ADMIN CONSOLE

Primary UI: `public/admin/admin-dashboard.html` + `public/admin/modules/*.js`.  
Server maps `/admin-dashboard` → modular file (`server/server.js:513–514`). **Legacy `public/admin-dashboard.html` still statically reachable.**

| Module | UI | API | Database | Working? | Problems |
|--------|----|-----|----------|----------|----------|
| Dashboard | Yes | `/api/admin/stats`, treasury | counts | **Likely yes** | |
| Users / Customers | Yes | `/customers`, block/activate | `users` | **Yes** | |
| Stores | Yes | store-requests, approve | `stores` | **Yes** | |
| Restaurants | Same as stores | same | `stores.type` | **Alias** | No separate module |
| Drivers | Yes | approve/block | `drivers` | **Yes** | |
| Services | Hidden until flag | `/providers` | `users` | **Feature-flagged** | Legacy monolith button “قريباً” |
| Transport | Hidden until flag | providers `segment=transport` | users | **List only** | |
| Orders | Yes | `/orders` limit 80 | `orders` | **Yes** | Unpaginated beyond 80 |
| Finance | Yes | finance-summary, collect, debts | mixed wallets | **Partial** | Multiple wallet stacks |
| ERVENOW PAY | Panel hidden | ledger admin RPCs | ledger | **Behind flags** | |
| Wallets | Inside finance | withdrawals, wallet summary | ledger + legacy | **Partial** | |
| Commissions | Standalone page + finance | commission-rules (any authed GET) | `commission_rules` | **Partial** | GET `/api/finance/commission-rules` is **any JWT** |
| Settlements | Finance sub-actions | `POST /finance/reconcile-delivered` | settlement_log | **Partial** | No dedicated panel |
| Refunds | **No panel** | wallet ledger refund | mixed | **API only** | |
| Notifications | Yes | broadcast, driver-notifications | `notifications` | **Yes** | Broadcast loads **all users** |
| Offers | Yes | `/platform-offers` | settings | **Banners/offers config** — not checkout coupons |
| Reports | finance + `admin-finance.html` | daily-report | | **Partial** | |
| Permissions | admin-accounts | env phones | **No DB ACL** | Coarse |
| Settings | Yes | `/platform-settings` **and** unauth `/api/admin/settings` | `platform_settings` | **Dangerous duplicate** |
| Features | Yes | `/features` | flags | **Yes** |
| Audit logs | Marketing + notification audit | | **Partial** | No global audit UI (`ervenow_audit_events` exists, deny policies) |
| Support | Complaints panel | `/complaints` | `complaints` | **Yes** |

This audit did **not** click every button in a live browser against production. “Working” means UI module + matching authenticated route exist and are wired. Unauthenticated settings is confirmed by reading the router (no middleware).

---

# 16. DATABASE AUDIT

**No `supabase/` CLI project.** Schema = `shared/schema.sql` + `shared/migration_*.sql` (~143 files), applied by ad-hoc `scripts/run-migration-*.js`.

## 16.1 Notable tables

`users`, `orders` (canonical), `delivery_orders` (legacy), `stores`, `store_products`, `drivers`, `driver_notifications`, `notifications`, `complaints`, `categories`, `hero_banners`, `platform_settings`, `platform_feature_flags`, `checkout_idempotency`, `settlement_log`,  
**Wallets (duplicated):** `ervenow_ledger_wallets/transactions`, `ervenow_wallets/transactions`, `wallets/wallet_transactions`, `driver_wallets/driver_ledger`, `store_wallets`, `withdraw_requests` **and** `ervenow_withdraw_requests`.

Money types: **`numeric(12,2)` / `numeric(14,2)`** — appropriate. Coordinates use `double precision` — OK.

## 16.2 Issues

| Issue | Evidence |
|-------|----------|
| Tables without executed RLS | `stores` RLS file **explicitly not executed** (`migration_stores_rls_security.sql:4`) |
| Permissive RLS | finance + ledger `USING (true)` |
| Missing unique on driver_notifications (order_id, driver_id) | duplicate notify rows possible |
| Nullable money on `delivery_orders` | `schema.sql` |
| No CHECK (amount > 0) on some withdraw tables | |
| Naming: `erwenow_*` vs `ervenow_*` RPCs | leftover spellings in finance migrations |
| Orphans | possible: orders with `customer_id` null from guest service create |

---

# 17. SECURITY AUDIT (OWASP)

| Item | Finding |
|------|---------|
| SQL injection | **Low** in Node — parameterized Supabase client |
| XSS | Widespread `innerHTML`; some `esc()` in admin modules — **not centralized** |
| CSRF | Bearer JWT → **low** for API; cookie site-gate is HTML-only |
| IDOR | Debt-info, pay create-session, `/users/sync` role |
| Privilege escalation | **Critical** — see Top 20 #1,#6,#7 |
| Broken auth | 7-day JWT, no revocation |
| Secrets in repo | **No committed `.env`**. No hardcoded `sk_live` / JWT strings found. **Do not print values.** |
| Secret **types** present as env refs | JWT secret, Supabase service role, Twilio, Moyasar, OTP pepper, bank AES, internal API key — files: `.env.example`, `shared/config/supabase.js`, `shared/utils/whatsapp.js`, `shared/middleware/auth.js` |
| Admin routes | Unauth settings; public job application POST |
| Rate limiting | Checkout/order only; **OTP send unprotected at HTTP layer** |
| Brute force OTP | Cooldown + lock in OTP service; no IP cap |
| File uploads | Base64 → Storage; JSON 12mb; public bucket read policy |
| WebSockets | JWT required; room checks — **good**; location spoof by assigned driver possible |
| CORS | Allowlist + **no Origin allowed** |
| Logging secrets | Tokens not logged; Twilio error codes only |
| `GET /api/core/public-config` | Exposes **anon key** by design (`apps/core/routes.js:362–368`) |
| `GET /api/test/commission/:id` | Unauthenticated in non-production (`apps/test/routes.js:18–26`) |
| `INTERNAL_API_KEY` | Middleware unused |
| Hardcoded admin fallback phone | `0505745650` in `apps/admin/routes.js:154` (ops identity, not a cryptographic secret) |

---

# 18. RLS

**Architectural fact:** API uses **service role** → **RLS is not the API control plane.** If PostgREST is exposed with anon/authenticated keys, RLS is the only DB firewall — and it is **weak** on finance.

| Table | RLS | Policy | Safe? | Risk |
|-------|-----|--------|-------|------|
| `orders` | Yes | `finance_service_all_orders` USING true | **No** | All orders |
| `wallets` / `wallet_transactions` | Yes | USING true | **No** | All balances |
| `ervenow_ledger_wallets` | Yes | USING true + GRANT authenticated | **No** | Ledger |
| `ervenow_ledger_transactions` | Yes | USING true | **No** | Money movement |
| `settlement_log` | Yes | USING true | **No** | Replay claims |
| `commission_rules` | Yes | USING true | **No** | |
| `ervenow_otp_challenges` | Yes | USING false | **Yes** | |
| `ervenow_audit_events` | Yes | USING false | **Yes** | |
| `users` | Yes | `auth.uid() = id` | **Ineffective** — platform does not use Supabase Auth |
| `stores` | Review-only migration not executed | — | **Unknown / likely open** | Store IBAN/phone |
| `platform_settings` | **No RLS found** | — | **No** | Combined with unauth settings API |
| `drivers`, `notifications`, `complaints` | No RLS in reviewed migrations | — | **No** | |

Customer isolation of others' orders/addresses/wallets: **enforced in some API handlers**, **not in RLS**.

---

# 19. PERFORMANCE

| Scale | What breaks first |
|-------|-------------------|
| **100 users** | Likely OK if Redis optional and Twilio limits unused |
| **1,000** | Admin broadcast `select` all users (`broadcastNotify.js`); polling 5–8s on home/orders/driver; Nominatim from **browser** |
| **10,000** | Unpaginated lists; Socket.IO all on one Node process; OSRM public router rate limits; in-memory OTP if not supabase backend |
| **100,000** | **Will not hold** — single monolith, no horizontal story, `driverLocationLastBroadcast` Map leak, 12mb JSON, no CDN strategy beyond Vercel static, BullMQ single queue |

Other: admin finance queries up to **5000** rows; store list cached in Redis when available.

---

# 20. REDIS / QUEUES

| Item | Reality |
|------|---------|
| Queue | `ervenow-delivery` (`queues/deliveryQueue.js`) |
| Jobs | `new-order`, `checkout-dispatch` |
| Worker | `workers/deliveryWorker.js` — **requires REDIS_URL** |
| Retries | 5, exponential backoff 2s |
| DLQ | `ervenow-delivery:dlq` on exhausted retries |
| Idempotency | Checkout keys in Postgres, not Redis |
| If Redis down | Cache: 30s cooldown then skip (`redisCache.js`). Enqueue: **inline `setImmediate`** — **lost on process crash**. Health `/api/health/full` fails Redis check. Dispatch still “works” in-process, **not durable**. |

---

# 21. REALTIME & TRACKING

`shared/lib/trackingSocket.js`:

- Handshake JWT required.
- `join:order`: admin / assigned driver / assigned provider / customer.
- Merchants use `store:<id>` rooms, not order rooms.
- `driver:location`: assigned driver + status in accepted/delivering/picked — **no speed/jump check** (spoofing).
- Socket path does **not** persist location (REST `update-location` does).
- `driverLocationLastBroadcast` Map — **unbounded** (leak).
- Track page: websocket-only, re-join on connect; **requires token**.

---

# 22. MAPS

| Provider | Use | Fallback |
|----------|-----|----------|
| OSRM | Server `osrmClient.js` (circuit breaker, concurrency 5) | Haversine |
| ORS | `apps/delivery/service.js` | Haversine |
| Nominatim | **Client** `delivery-map-page.js` | Comment warns about limits |
| Google Maps | URL links only — **no server Maps key** |

Delivery fee uses OSRM km when available. Caching: Redis for store payloads, not all routes.

---

# 23. NOTIFICATIONS

| Channel | Status |
|---------|--------|
| In-app | **WORKING** — DB + socket (`notificationService.js`, `notificationEvents.js` 40+ event types) |
| WhatsApp | **WORKING** — Twilio |
| SMS | **NOT IMPLEMENTED** |
| Email | **NOT IMPLEMENTED** |
| Web push / FCM | **NOT IMPLEMENTED** |

Duplicate risk: no idempotency key on `createNotification`; WhatsApp + in-app can both fire. Broadcast dedupes recipients per batch only.

---

# 24. FRONTEND AUDIT

~72 HTML pages in `public/` mirrored in `ervenow-frontend/`.

**Dead / fake:**

- `login.html` footer `href="#"` for privacy/terms (real pages exist).
- Delivery tiles “قريباً”; legacy admin services disabled.
- Preview hubs are mock anchors.

**Duplicates:** admin modular vs monolith; driver-preview vs driver-app vs driver.html; store-dashboard vs merchant-dashboard vs merchant-preview; `orders.html` vs `my-orders.html`.

**localhost:** CORS allowlist in `server/server.js` (dev). Frontend API base must be set on Vercel or calls hit wrong origin.

**RTL:** major pages `dir="rtl"` — static review OK; not a device lab pass.

**Login:** OTP UI exists; role query `?role=store` is **intent**, dangerous because backend trusts role.

**Mobile:** dedicated CSS (`mobile-harmony.css`, etc.) exists; this audit did not run `/mobile-preview.html` in a browser.

---

# 25. API AUDIT

See **Appendix A** for METHOD | ENDPOINT | AUTH | ROLE | MODULE | STATUS.

**Dangerous (repeat):** unauth admin settings; `/users/sync`; unauth debt-info; unauth WhatsApp webhook; unauth commission test (non-prod); deprecated checkout skips payment gate.

---

# 26. ERROR HANDLING

| Layer | Status |
|-------|--------|
| Express global | `server/server.js:664–672` — prod `{ error: "INTERNAL_ERROR" }` |
| Route `fail()` | Arabic messages; prod 500 generic (`helpers.js:5–8`) |
| DB | Many routes return `error.message` to client (information leak in non-prod; some 400s leak schema) |
| Queue | Worker logs; DLQ |
| Payments | Gateway verify on webhook |
| Socket | `UNAUTHORIZED` on handshake |

User sees generic production 500s. Admin has **no** centralized error inbox (no Sentry).

---

# 27. LOGGING & OBSERVABILITY

| Capability | Status |
|------------|--------|
| Structured logs | Pino — **yes** |
| Request IDs | **Missing** |
| Audit logs | Table + deny RLS; marketing audit only in UI |
| Metrics | Prometheus `/api/internal/metrics` if `METRICS_ENABLED=1` — **unauthenticated** |
| Health | `/api/health`, `/api/health/full` (DB + Redis) |
| Sentry APM | **Missing** |
| Alerts | Optional webhook (`shared/utils/alerts.js`) |

**Missing for real production:** tracing, error tracking, log aggregation, on-call, request correlation.

---

# 28. ANALYTICS

**No GA4, Mixpanel, or PostHog** in the frontend.

Cannot measure Visitors, Signup funnel, Add-to-cart, Checkout, Purchase, Cancellation, Retention, GMV, AOV, Conversion, CAC, merchant performance **as a product analytics system**.

Admin has internal broadcast analytics and finance summaries — **operations counts, not marketing analytics**.

---

# 29. TESTING

**Executed 2026-09-01 (Jest, no code changes):**

| | Count |
|--|-------|
| Test suites | 75 passed, **2 failed**, 1 skipped (77 of 78) |
| Tests | **309 passed**, **4 failed**, 1 skipped, 314 total |
| Duration | ~9.4s |

**Failed:**

1. `tests/unit/cartCheckoutHttpIdempotency.test.js` — expected `{ ok:false, message }` vs extra `balance`/`reason`/`required` (assertion drift vs current `fail()` shape).
2. `tests/unit/adminRoleTaxonomy.test.js` — `gas_cylinder_swap` expected `"transport"`, received `"service"` (**taxonomy vs code drift**).

**E2E Playwright:** **not run** (starts full server; needs env/Twilio/DB). Files exist: `tests/e2e/smoke.spec.js`, `core-validation.spec.js`, `reconnect-lifecycle.spec.js`.

**Integration:** 2 files; live tests gated.

**Load:** `tests/load/artillery.yml` — not run.

**Coverage:** Strong on **unit** of checkout/ledger/notifications. **Missing:** E2E money path, RBAC escalation tests, RLS tests, refund-ledger pairing tests.

| Kind | Result |
|------|--------|
| Unit | Mostly **Passed**; 4 **Failed** |
| Integration live | **Skipped** here |
| E2E | **Not run** / **Missing** as CI |
| CI enforcement | **Missing** |

---

# 30. DEPLOYMENT

```
Vercel (ervenow-frontend static)
        │  CORS_ORIGINS + ERVENOW_PUBLIC_URL must match
        ▼
Railway  npm start  server/server.js
        │  SERVE_STATIC=0 recommended
        ▼
Supabase Postgres + Storage
Redis    optional (BullMQ)
Twilio   WhatsApp
```

| Topic | Finding |
|-------|---------|
| Domains | Code mentions `ervenow.com` in CORS/maintenance |
| SSL | Platform (Railway/Vercel/Supabase) |
| CI/CD | **None in repo** |
| Dual frontend | If `public/` edited and `frontend:sync` skipped, **Vercel serves stale UI** while Railway API is new (or vice versa) |
| Worker | `worker:delivery` **not** in `railway.toml` startCommand — **only main process unless separately deployed** |
| Docker / nginx / PM2 | **Not in repo** |

---

# 31. LEGACY CODE

Candidates for **future** deletion (not deleted):

- `public/admin-dashboard.html`
- `public/delivery/*`
- `public/driver.html`, redirect already to preview
- `public/preview/*`
- `public/admin-finance.html`, `admin-debts.html`, `admin-commissions.html`, … (duplicated in modular admin)
- `apps/food/`, `apps/finance/wallet-server.js`, `apps/test/`
- `ervenow-frontend/` (keep as deploy artifact, don’t hand-edit)
- Root junk 0-byte files
- `public/erwenow.html`
- Legacy token keys in `public/assets/api.js`

TODO/FIXME/HACK: almost none in source. Real debt is **parallel systems**, not comments.

---

# 32. CODE QUALITY — TOP 20 FILES

| # | File | Size / lines | Why risky |
|---|------|--------------|-----------|
| 1 | `public/admin-dashboard.html` | 202 KB / 5285 | Dead monolith still served statically |
| 2 | `apps/admin/routes.js` | 152 KB / 3810 | God-file; RBAC + finance + approvals mixed |
| 3 | `public/index.html` | 125 KB / 3411 | Home + polling + marketing |
| 4 | `public/track.html` | 119 KB / 2930 | Tracking + auth gap |
| 5 | `public/delivery-services.html` | 108 KB / 2653 | Placeholders |
| 6 | `apps/store/routes.js` | 106 KB / 2535 | Entire merchant backend |
| 7 | `public/assets/cart.js` | 91 KB / 2484 | Client cart/pricing |
| 8 | `public/login.html` | 86 KB / 2043 | Role in query string |
| 9 | `public/store-dashboard.html` | 65 KB / 1552 | Duplicate portal |
| 10 | `apps/services/routes.js` | 63 KB / 1473 | All verticals in one router |
| 11 | `public/admin/admin-dashboard.html` | 60 KB / 1066 | Canonical admin — still large |
| 12 | `public/wallet.html` | 59 KB / 1624 | Finance UX over multiple backends |
| 13 | `public/assets/merchant-preview.js` | 58 KB | Preview vs real dashboard split |
| 14 | `public/store.html` | 57 KB / 1562 | Client price/stock |
| 15 | `public/dashboard.html` | 53 KB / 1459 | Guest hub |
| 16 | `apps/core/routes.js` | 46 KB / 1171 | Auth + escalation endpoints |
| 17 | `public/assets/checkout-engine.js` | 35 KB / 892 | Client totals |
| 18 | `apps/driver/routes.js` | ~862 lines | Dispatch without timeout |
| 19 | `apps/delivery/service.js` | ~814 lines | Create + refund wrong wallet |
| 20 | `shared/utils/ledgerWallet.js` | ~731 lines | Parallel balance computation |

Plus `server/server.js` (~632) as the gateway.

---

# 33. BUSINESS READINESS

| Axis | Verdict |
|------|---------|
| Customer experience | Browse/cart exist; tracking/login/refund holes |
| Merchant experience | Real board; preview vs dashboard confusion |
| Driver experience | Accept/complete real; no reject/offline/timeout |
| Provider experience | Home/gas/polish usable; transport shell |
| Operations | Admin exists; no incident tooling |
| Finance | Unsafe to run real money |
| Support | Complaints only — no dispute workflow |
| Fraud | Almost none (price trust, OTP, role sync) |
| Refunds / disputes | Incomplete |
| Settlement | RPC exists; claim semantics weak |
| Reporting | Internal counts, not GMV analytics |
| Scalability | Single process |

---

# 34. SOFT BETA READINESS (per module)

| Module | Classification |
|--------|----------------|
| Guest browse (stores/restaurants) | **READY WITH CONDITIONS** (internal) |
| Cart + COD checkout | **READY WITH CONDITIONS** — must server-reprice first |
| EW PAY checkout | **NOT READY** — refund ledger mismatch |
| Card / Moyasar store pay | **NOT READY** — debt-link, not checkout capture |
| Merchant accept/prepare/ready | **READY WITH CONDITIONS** |
| Driver accept/deliver | **READY WITH CONDITIONS** — no timeout |
| Guest tracking | **NOT READY** |
| Service home/gas/polish | **READY WITH CONDITIONS** — guest create optionalAuth |
| Transport portal | **DO NOT LAUNCH** |
| Admin console | **NOT READY** until settings auth + role sync fixed |
| Coupons / hours / stock | **DO NOT LAUNCH** as advertised features |
| Notifications WhatsApp | **READY WITH CONDITIONS** (Twilio limits, unsigned webhook) |
| Wallet withdraw | **READY WITH CONDITIONS** (OTP, admin approve) |
| Analytics / observability | **NOT READY** |

---

# 35. LAUNCH SCOPE (from current code)

**Do not launch all of ERVENOW.**

**Smallest scope that the code could support after P0+P1 security/money fixes:**

1. **Approved stores + restaurants only** (one `stores` table).  
2. **COD only** (do not enable EW PAY until refund is on ledger).  
3. **Internal drivers** with manual WhatsApp/ops backup (no timeout in software).  
4. **One city, tiny GMV**, ops watching every order.  
5. **Exclude:** Transport as a product, coupons, guest service create, card checkout, public Soft Beta marketing.

This is **not** a recommendation to launch now. It is the **narrowest** slice the architecture actually implements.

---

# 36. FAILURE SCENARIOS

| Scenario | What code does | Idempotent? |
|----------|----------------|-------------|
| Customer double-pay / double-click | Client lock + Idempotency-Key + DB unique | **Mostly yes** for checkout |
| Merchant accept twice | FSM allows same status (`j === i`); preparing is sequential | **Mostly yes** |
| Two drivers accept | Second UPDATE matches 0 rows | **Mostly yes** |
| Driver kills app mid-trip | Last GPS frozen; no timeout reassign | **Stuck** |
| Redis down | Inline jobs; lost on crash | **No durability** |
| Supabase down | API 503; health fails | **Hard down** |
| Socket disconnect | Client reconnect + admin 10s poll fallback | **Degraded tracking** |
| Merchant offline | Order waits at pending/accepted; driver waits for `ready` | **Stuck** |
| Admin patches during delivery | Admin bypasses RBAC; FSM still applies | **Possible skip to delivered** |
| Refund during settlement | Cancel only early statuses; delivered cancel not in customer path | **Unsafe if forced via admin** |
| User changes role | `/users/sync` **succeeds** | **Yes, unfortunately** |
| Repeated API | Rate limit only on create/checkout | **OTP/settings no** |
| Webhook twice | Pay webhook should settle by gateway id; WhatsApp unsigned | **Pay: intended; WA: no** |

---

# 37. CRITICAL MONEY TESTS (logical)

Path: Order → Payment → Commission → Driver → Merchant → Platform → Settlement → Refund

| Invariant | Holds? |
|-----------|--------|
| No money from nothing | **Fails** if EW PAY debit not reversed and operational wallet credited |
| No double credit merchant | Hold release + skip COD deposit for `ew_pay` (`storeMerchantLedgerCredit.js:79–81`) — **intended** |
| No double driver credit | RPC `reference_id` unique — **if migration applied** |
| Client cannot set goods price | **Fails** |
| Cancel only refunds what was debited | **Fails** for EW PAY |
| Settlement once | **Weak** — claim error proceeds |
| `SUM(debits)=SUM(credits)` globally | **Not enforced** |

**Do not run real balances until P0 finance items are fixed.**

---

# 38. FINAL SCORECARD (/100)

Scores reflect **production E2E correctness**, not file count.

| Area | Score | Note |
|------|------:|------|
| Architecture | 54 | Modular monolith, god-files |
| Backend | 61 | Real order/driver/store logic |
| Frontend | 47 | Duplicates, placeholders, auth gaps |
| Database | 44 | Duplicated finance, weak RLS |
| Security | 22 | P0 escalation + unauth settings |
| Authentication | 48 | OTP+JWT works; 7d; role holes |
| RBAC | 27 | Client-supplied role |
| Customer | 52 | Path exists; tracking/refund |
| Merchant | 63 | Strongest operational slice |
| Driver | 55 | Core loop yes; ops gaps |
| Services | 50 | Verticals uneven |
| Transport | 22 | Shell |
| Orders | 60 | Real FSM with skips |
| Delivery | 57 | Quote engine real |
| ERVENOW PAY | 35 | Ledger in, refund out |
| Finance | 36 | Multi-ledger |
| Admin | 50 | Useful; dangerous duplicate API |
| Notifications | 49 | WA + in-app |
| Realtime | 56 | Auth OK; spoof/leak |
| Performance | 38 | Won’t scale |
| Testing | 52 | 309 unit pass; 4 fail; no CI E2E |
| Observability | 28 | Pino/health only |
| Analytics | 8 | None |
| DevOps | 31 | Railway+Vercel, no CI, worker optional |
| Commercial Readiness | 32 | |
| Soft Beta Readiness | 28 | |
| **Full Production Readiness** | **18** | |

---

# 39. PRIORITY MATRIX

## P0 — BLOCKER (prevent any external/money launch)

| ID | Problem | Evidence | File | Line | Risk | Impact | Recommended Fix | Complexity | Dependencies |
|----|---------|----------|------|------|------|--------|-----------------|------------|--------------|
| P0-01 | Client sets `users.role` including admin | upsert body.role | `apps/core/routes.js` | 1156–1188 | Privilege escalation | Full takeover | Ignore client role; admin-only role changes | S | Auth tests |
| P0-02 | Unauthenticated settings read/write | no middleware | `apps/admin/settings.js` | 14–43 | Config takeover | Payments/flags | `requireAuth`+`requireRole("admin")` or delete router | S | Mount in `server.js:285` |
| P0-03 | EW PAY refund wrong ledger | RPC name | `apps/delivery/service.js` | 198–212 | Money creation | Customer + platform imbalance | Reverse `ervenow_ledger_*` with idempotent refund | L | SQL RPC, tests |
| P0-04 | Checkout trusts `item.price` | reduce price | `apps/checkout/service.js` | 244 | Fraud | Underpay | Reload `store_products` server-side | M | Products schema |
| P0-05 | OTP verify / register can activate admin | ALLOWED_USER_ROLES + status active | `apps/core/routes.js` | 105, 331, 901+ | Escalation | Admin without allowlist | Strip admin from self-serve; force pending | S | OTP allowlist |

## P1 — CRITICAL (before any closed test with outsiders)

| ID | Problem | Evidence | File | Line | Risk | Impact | Recommended Fix | Complexity | Dependencies |
|----|---------|----------|------|------|------|--------|-----------------|------------|--------------|
| P1-01 | Finance RLS USING true + GRANT | SQL | `shared/migration_bootstrap_ledger_finance.sql` | 691–727 | Direct PostgREST theft | All wallets | Revoke authenticated; USING false | M | Confirm no browser Supabase |
| P1-02 | Debt-info IDOR | query uid | `apps/pay/routes.js` | 44–60 | PII/debt leak | Sign token | M | Pay UI |
| P1-03 | WhatsApp webhook unsigned | POST body | `apps/whatsapp/routes.js` | 62–67 | Fake accept | Validate Twilio signature | S | Twilio |
| P1-04 | `.gitignore` merge conflict | markers | `.gitignore` | 1–6 | Secret commit | Resolve ignore set | S | Git |
| P1-05 | Deprecated checkout skips payment gate | `applyPaymentGate: false` | `apps/checkout/routes.js` | 13–15 | Unpaid live orders | Same gate as `/order/create` | S | Clients still calling it |
| P1-06 | Guest service order `optionalAuth` | home-order | `apps/services/routes.js` | 303 | Orphan orders | requireAuth | S | UI |
| P1-07 | Rate-limit OTP send | none | `apps/core/routes.js` | 546 | Twilio drain | express-rate-limit per IP+phone | S | |
| P1-08 | Unknown admin → full permissions | default level | `apps/admin/routes.js` | 158–163 | Over-privilege | Default deny | S | Env phones |
| P1-09 | Store hours/stock/is_active not enforced | checkout select | `apps/checkout/service.js` | 284–291 | Bad orders | Server gates | M | Product of hours schema |
| P1-10 | No CI | no workflows | `.github/` | — | Regressions ship | GitHub Actions jest+e2e smoke | M | Secrets |

## P2 — HIGH (during internal/soft ops)

| ID | Problem | File | Complexity |
|----|---------|------|------------|
| P2-01 | No driver timeout/reassign/reject | `apps/driver/` | L |
| P2-02 | Track requires login | `public/track.html` | M |
| P2-03 | Settlement claim fail-open | `settlementGuard.js:50–52` | M |
| P2-04 | Triple wallets | SQL + services | XL |
| P2-05 | Worker not in Railway start | `railway.toml` | S |
| P2-06 | Broadcast all users | `broadcastNotify.js` | M |
| P2-07 | Socket location spoof | `trackingSocket.js` | M |
| P2-08 | `INTERNAL_API_KEY` unused | `internalAuth.js` | S |
| P2-09 | Split frontend sync drift | `public/` vs `ervenow-frontend/` | M |
| P2-10 | Jest failures (taxonomy + idempotency shape) | tests listed §29 | S |

## P3 — MEDIUM

Coupons, store hours schema, product addons, request IDs, Sentry, pagination, delete legacy admin HTML, unify food module, analytics, CSRF for cookie gates, Nominatim server-side.

## P4 — LOW

Typography/mobile polish, preview page cleanup, rename `merchant`/`restaurant` aliases, root junk files, Google Maps keys if needed.

---

# 40. TOP 20 RISKS

See **Executive Summary** at the top of this document (same 20 items with evidence).

---

# 41. WHAT ACTUALLY WORKS / LOOKS COMPLETE / DOES NOT EXIST

## WHAT ACTUALLY WORKS TODAY

Connected **in code** (unit-tested pieces + explicit handlers). Not a production certification.

- WhatsApp OTP issue + JWT session (`/api/core/send-otp`, `/verify-otp`) for normal (non-escalated) roles.
- Browse approved stores/restaurants and products (`/api/store`, products).
- Client cart draft → `POST /api/order/create` → `orders` row with server delivery quote + VAT fields.
- Checkout idempotency claim/replay (`checkout_idempotency`).
- Merchant order board + accept/preparing/ready on store/restaurant orders.
- Driver list open/ready jobs, accept with `driver_id IS NULL`, start delivery, complete, GPS REST.
- Nearest-driver WhatsApp notify (top 3) + retry worker for failed WA.
- Socket.IO order rooms with JWT + ownership check.
- In-app notifications create/list/read.
- Admin modular console: stats, customers, stores, drivers, orders, complaints, withdrawals approve (authenticated router).
- Health endpoints.
- Ledger deposit/pay/refund **RPCs exist** and Jest covers many ledger helpers.
- Platform commission helper 7% + delivery policy engine (km, radius, free-delivery rules).
- Home / gas / car-polish service create + provider reserve (authenticated provider paths).

## WHAT LOOKS COMPLETE BUT IS NOT

- **Transport portal “live”** in `data/portal-launch.json` — preview skin, no backend app.
- **ERVENOW PAY** wallet screens — checkout debit ≠ cancel refund ledger.
- **Card / mada / Apple Pay / Tabby** in checkout UI — not captured at order create.
- **Store hours / open badge** — hardcoded or `is_active`.
- **Stock** — field + UI cap, no server reserve.
- **Coupons / platform offers panel** — marketing banners, not checkout discounts.
- **Driver online toggle** — admin `active` only.
- **Guest order tracking** — page exists, requires login.
- **`docs/SOURCE-OF-TRUTH.md` cart SoT** — `/api/checkout` is deprecated and skips payment gate.
- **Wallet SoT in docs (`ervenow_*`)** — runtime default is `ledger_only`.
- **Admin settings** — two APIs; one is public.
- **Food module** — demo menu fallback.
- **Wallet transfer** — 501.
- **WhatsApp reject (choice 2)** — “قيد التطوير”.
- **Modular vs legacy admin** — both present.
- **`completeServiceOrder` “all services”** — excludes polish/transport completion paths.
- **RLS “enabled”** — bypassed by service role; policies often `true`.

## WHAT DOES NOT EXIST YET

- Password auth, refresh tokens, email.
- True double-entry accounting invariant.
- Driver offer timeout / auto-reassign / reject API.
- FCM / SMS / email notifications.
- Product option groups for stores.
- Coupon engine.
- Dispute / ticket system beyond complaints.
- GA4/Mixpanel/PostHog.
- Sentry / request IDs / CI.
- Docker/nginx/PM2 in repo.
- Dedicated Transport bounded context.
- Server-side cart with TTL.
- Guest signed tracking links.
- Partial refunds.
- KYC document pipeline.

---

# 42. FINAL DECISION (repeat)

**B — INTERNAL TESTING ONLY**

The codebase is past “empty startup”: unified `orders`, a merchant workflow, driver accept, Socket.IO, and a ledger **attempt**. It is **before** a financially and security-safe alpha.

Closed Alpha (C) would require P0 closed and a written ops runbook. Soft Beta (D) additionally needs server-side pricing, EW PAY refund integrity, driver timeout, guest tracking, CI, and observability. Production (F) is not in scope of the current architecture without a finance consolidation and RLS/PostgREST lockdown.

---

# APPENDIX A — API INVENTORY (representative)

STATUS: **W** working-as-wired · **D** dangerous · **L** legacy/deprecated · **U** unused/dev · **P** placeholder

| METHOD | ENDPOINT | AUTH | ROLE | MODULE | STATUS |
|--------|----------|------|------|--------|--------|
| GET | `/api/health` | none | — | server | W |
| GET | `/api/health/full` | none | — | server | W |
| GET | `/api/internal/metrics` | none if enabled | — | server | D |
| GET | `/api/core/public-config` | none | — | core | W (exposes anon key) |
| POST | `/api/core/send-otp` | none | — | core | W / D (no IP RL) |
| POST | `/api/core/verify-otp` | none | — | core | W / D (role) |
| POST | `/api/core/register-account` | none | self role | core | D |
| GET | `/api/core/me` | JWT | any | core | W |
| POST | `/api/core/users/sync` | JWT | any→any | core | D |
| POST | `/api/order/create` | JWT | canPlaceOrders | order | W |
| POST | `/api/checkout` | JWT | canPlaceOrders | checkout | L (skips pay gate) |
| GET | `/api/order/:id` | JWT | owner/admin/driver-open | order | W |
| PATCH | `/api/order/:id/status` | JWT | RBAC in service | order | W |
| POST | `/api/order/:id/cancel` | JWT | customer, admin | order | W |
| GET | `/api/store` | optional | — | store | W |
| POST | `/api/store/register` | none | — | store | W (spam) |
| POST | `/api/store/products` | JWT | store role | store | W |
| GET | `/api/store/order-board` | JWT | store role | store | W |
| GET | `/api/store/public/:id/delivery-quote` | none | — | delivery engine | W |
| POST | `/api/delivery/orders` | JWT | canPlaceOrders | delivery | W |
| POST | `/api/delivery/orders/:id/accept` | JWT | driver | delivery | W |
| POST | `/api/driver/register` | none | — | driver | W |
| POST | `/api/driver/accept/:id` | JWT | driver-ish | driver | W |
| GET | `/api/driver/orders` | JWT | driver | driver | W |
| GET | `/api/services/catalog` | none | — | services | W |
| POST | `/api/services/home-order` | optional | — | services | D |
| POST | `/api/services/bookings/:id/reserve` | JWT | provider | services | W |
| GET | `/api/wallet/me` | JWT | wallet roles | wallet | W |
| POST | `/api/wallet/ledger/refund` | JWT | admin | wallet | W |
| POST | `/api/wallet/transfer` | JWT | wallet roles | wallet | P (501) |
| GET | `/api/pay/debt-info` | none | — | pay | D |
| POST | `/api/pay/create-session` | none | — | pay | D |
| POST | `/api/pay/webhook` | gateway secret (intended) | — | pay | W |
| POST | `/api/whatsapp/webhook` | none | — | whatsapp | D |
| GET | `/api/admin/settings/` | **none** | — | admin/settings | D |
| POST | `/api/admin/settings/update` | **none** | — | admin/settings | D |
| GET | `/api/admin/stats` | JWT | admin | admin | W |
| GET | `/api/admin/orders` | JWT | admin+perm | admin | W |
| POST | `/api/admin/broadcast` | JWT | admin+perm | admin | W |
| GET | `/api/finance/commission-rules` | JWT | **any** | finance | D/L |
| POST | `/api/finance/orders/:id/refund` | JWT | admin | finance | L (ledger_only blocks) |
| GET | `/api/food/menu` | JWT | — | food | L |
| GET | `/api/test/commission/:id` | none (non-prod) | — | test | U/D |
| GET | `/api/notifications` | JWT | self | notifications | W |
| GET | `/api/invoice/:id` | JWT | owner/admin | invoice | W |
| GET | `/api/categories` | none | — | categories | W |
| GET | `/api/market/products` | JWT | — | market | L/thin |

Admin authenticated surface is large (`apps/admin/routes.js` 50+ routes). Pattern: `requireAuth` + `requireRole("admin")` + often `requireAdminPermission(...)`. The **exception that matters** is the separate `/api/admin/settings` router.

---

# APPENDIX B — DOC vs CODE DRIFT

| Document claim | Code |
|----------------|------|
| Cart SoT = `POST /api/checkout` (`docs/SOURCE-OF-TRUTH.md`) | Deprecated; `/api/order/create` is primary; checkout skips payment gate |
| Wallet SoT = `ervenow_*` | Default `FINANCE_MODE=ledger_only` → `ervenow_ledger_*` |
| Transport operational portal live (`data/portal-launch.json`) | Preview HTML over `/api/services` |
| `delivery_orders` as operational table | Node writes `orders` |
| Stores RLS security migration | File says **do not execute** until review |

---

# APPENDIX C — TEST RUN (2026-09-01)

```
Test Suites: 2 failed, 1 skipped, 75 passed, 77 of 78 total
Tests:       4 failed, 1 skipped, 309 passed, 314 total
Time:        9.39 s
Command:     npx jest --ci --passWithNoTests
```

Failures: `cartCheckoutHttpIdempotency.test.js` (2 cases, response shape), `adminRoleTaxonomy.test.js` (2 expects: `gas_cylinder_swap` classified `service` not `transport`).

---

*End of audit. No production systems were modified. Next step is a separate, explicit fix order covering P0 then P1.*
