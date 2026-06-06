# CHECKOUT ENGINE — Phase 5 Cutover Report

**Date:** 2026-06-06  
**Scope:** Traffic cutover `/cart` → `/checkout` only — **no legacy file deletion**.

---

## Summary

Phase 5 redirects all customer traffic from the legacy cart route to unified checkout. The homepage Mini Cart (`lpCart` + `cart.js`) is replaced by a **Draft Badge** driven by `ErvenowOrderDraft`. Guest shell pages load `order-draft-badge.js` instead of `cart-ui.js`.

| Step | Status |
|------|--------|
| 1 — Route cutover (`/cart` → `/checkout`) | ✅ |
| 2 — Homepage Draft Badge | ✅ |
| 3 — `browse`, `dashboard`, `guest-shell`, `index` without `cart.js` | ✅ |
| 4 — Jest (47 suites / 195 tests) + Playwright (7 tests) | ✅ |
| 5 — This report | ✅ |

---

## STEP 1 — Traffic: `/cart` → `/checkout`

### Server

- `GET /cart` → **302 redirect** to `/checkout` (`server/server.js`).
- `GET /checkout` → serves `checkout.html` (unchanged from Phase 2).

### New assets

| File | Role |
|------|------|
| `public/assets/order-draft-badge.js` | Syncs `#cartCount` + optional total from `ErvenowOrderDraft` |
| `public/assets/order-draft-badge.css` | Responsive badge styles (44px touch, hides total on mobile) |

### Redirects & links updated

- All `href="/cart"` in `public/**/*.html` → `href="/checkout"`.
- `guest-shell.js` header cart → `/checkout`, label **الطلب**.
- `cart.js` — `goCheckout` / login `next` / `handleLpCartCheckoutClick` → `/checkout`.
- `service-cart.js` — post-add redirect → `/checkout`.
- `delivery-services.html` — inline CTA string → `/checkout`.
- `platform-access.js` — driver block list includes `/checkout`.
- `store-preview-mode.js` / `store-shell.js` — preview guards include `/checkout`.

---

## STEP 2 — Homepage: Mini Cart → Draft Badge

### Removed from `index.html`

- `#lpCartWrap` panel (~140 lines of Mini Cart UI).
- `cart-luxe.css`, `cart-shell.css` links.
- `<script src="/assets/cart.js">`.
- `initLpHeaderCart()` and `updateCartCount` listeners.

### Added to `index.html`

```html
<a class="lp-draft-checkout-badge" href="/checkout" id="indexDraftBadge">
  <span id="cartCount">0</span>
  <span id="indexDraftTotal" hidden></span>
</a>
```

- Scripts: `order-draft-store.js` + `order-draft-badge.js`.
- Styles: `order-draft-badge.css`.

Badge shows **item count** and **subtotal** (total hidden when empty; subtotal hidden on ≤640px).

---

## STEP 3 — Pages fixed without `cart.js`

| Page / module | Change |
|---------------|--------|
| `guest-shell.js` | `loadCartUi()` → `loadDraftBadge()`; `refreshCartBadge()` uses `ErvenowOrderDraftBadge.sync()` |
| `browse.html` | `clearCart` / `goCheckout` use draft + `/checkout`; removed `ErvenowCart.render()` |
| `dashboard.html` | `cart.js` + `service-cart.js` → draft badge scripts |
| `index.html` | See Step 2 |
| `store.html` | Added `order-draft-badge.js`; `kabsar-store-polish.js` reads draft items |
| Badge-only shells | `track`, `stores`, `restaurants`, `my-orders`, `start-now`, `careers`, `blocked-complaints` — `cart.js` → draft badge |

---

## Pages using `/checkout` (customer-facing)

All of the following now link or redirect to `/checkout`:

- `index.html` (Draft Badge)
- `browse.html`, `dashboard.html`, `store.html`
- `services.html`, `gas-delivery.html`, `delivery-services.html`, `delivery-map.html`, `order.html`
- `track.html`, `my-orders.html`, `restaurants.html`, `stores.html`
- `start-now.html`, `careers.html`
- `guest-shell.js` (injected header on guest-shell pages)
- Vertical commit flows (`order-draft-vertical.js`) — default redirect `/checkout`
- Legacy `cart.js` / `service-cart.js` internal redirects

---

## Still depends on Legacy (intentional — no deletion)

| Asset | Still used by | Notes |
|-------|---------------|-------|
| `cart.html` | Direct file access only | **Not served** at `/cart` (server redirects) |
| `cart.js` | `cart.html` only | No longer loaded on homepage or guest shells |
| `cart-ui.js` | `cart.html` only | Guest shell no longer dynamic-loads it |
| `service-cart.js` | `cart.html` only | Removed from `dashboard.html` |
| `cart-luxe.css`, `cart-shell.css`, `cart-page.css`, `cart-checkout-v3.css` | `cart.html` (+ dead CSS comment in `index.html`) | Not linked from cutover pages |
| `delivery-map-page.js` | Listens for `cart` storage + `updateCartCount` | Minor; map flow uses draft via Phase 3 |

### Mirror out of sync

- `ervenow-frontend/` was **not** synced in this phase (`npm run frontend:sync` not run). Mirror may still reference `/cart` and `cart.js`.

---

## Effectively unused on live traffic paths

These files remain in the repo but are **not loaded** by any cutover customer page:

| File | Last consumer |
|------|----------------|
| `cart-ui.js` | `cart.html` only |
| `service-cart.js` | `cart.html` only |
| `cart-luxe.css`, `cart-shell.css` | `cart.html` only |
| `cart-page.css`, `cart-checkout-v3.css` | `cart.html` only |

`cart.js` is only loaded by `cart.html`. All other former consumers now use `order-draft-store.js` + `order-draft-badge.js`.

---

## Tests

### Jest

```
47 suites, 195 tests — all passed
```

New: `tests/unit/checkoutEnginePhase5Cutover.test.js` — server redirect, index draft badge, guest-shell, legacy redirect assertions.

### Playwright

```
7 tests — all passed
```

Updated `tests/e2e/smoke.spec.js` — service vertical tests use `ervenow:order-draft` + `ErvenowOrderDraftVertical.commit`.

---

## Phase 6 readiness (not in scope)

- Delete or archive `cart.html` after confirming zero direct traffic.
- Remove orphaned Mini Cart CSS block from `index.html`.
- Run `npm run frontend:sync` for `ervenow-frontend/`.
- Update `delivery-map-page.js` badge listener to draft events.
- Remove `cart` localStorage writes from any remaining code paths.

---

## Files touched (Phase 5)

**New:** `order-draft-badge.js`, `order-draft-badge.css`, `checkoutEnginePhase5Cutover.test.js`, this report.

**Modified:** `server/server.js`, `guest-shell.js`, `index.html`, `browse.html`, `dashboard.html`, `store.html`, all guest-shell HTML pages, `cart.js`, `service-cart.js`, `cart-ui.js`, `kabsar-store-polish.js`, `platform-access.js`, `store-preview-mode.js`, `store-shell.js`, `delivery-services.html`, `smoke.spec.js`.

**Not deleted (per mandate):** `cart.html`, `cart.js`, `cart-ui.js`, `service-cart.js`.
