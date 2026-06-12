# ERVENOW — Footer Removal Audit

**Date:** 2026-06-12  
**Decision:** App Experience — Header → Content → Bottom Nav only (except Home)

---

## 1. Footer Types Found

| Type | Class / ID | Source | Scope |
|------|------------|--------|-------|
| **A — Home footer** | `.lp-footer` | Inline in `index.html` | **KEEP** on `/` only |
| **B — Standard site footer** | `.dash-site-footer` | Inline HTML (20 files) + JS injection | **REMOVE** |
| **C — Store rich footer** | `.store-site-footer`, `.store-footer__*` | `store-shell.js` → `#storeShellFooter` | **REMOVE** |
| **D — Driver footer** | `.dash-site-footer` | `driver-nav.js` → `#driverShellFooter` | **REMOVE** |
| **E — Guest shell footer** | `.dash-site-footer` | `guest-shell.js` → `#guestShellFooter` | **REMOVE** |
| **F — Preview footers** | `.preview-hub-footer`, `.preview-rest-foot` | `preview/*.html` | **REMOVE** |
| **G — Admin experimental** | `.adm-foot` | `admin/index.html` | **REMOVE** |

### Not site footers — do NOT remove

| Element | Page | Reason |
|---------|------|--------|
| `.map-canvas-footer` | `delivery-map.html` | Map price/stats UI control |
| `.footer-note` | Cart/Checkout CSS | Order note text, not navigation |
| `.admin-login-card__foot` | `admin-login.html` | In-card “back to home” link |
| `.lp-footer[hidden]` | `login.html` | Already hidden duplicate markup |

---

## 2. Affected Pages

### Inline `.dash-site-footer` (20 files)

`restaurants.html` · `stores.html` · `services.html` · `delivery-services.html` · `live-map.html` · `delivery-map` (via live-map) · `cart.html` · `checkout.html` · `my-orders.html` · `login.html` · `dashboard.html` · `driver-login.html` · `driver.html` (JS) · `store-dashboard.html` (JS) · `admin/admin-dashboard.html` · `browse.html` · `track.html` · `store.html` · `order.html` · `start-now.html` · `register-store.html` · `gas-delivery.html` · `careers.html`

### JS-injected footers (3 modules)

| Module | Mount point | Pages |
|--------|-------------|-------|
| `guest-shell.js` | `#guestShellFooter` | Any page calling `ErvenowGuestShell.mountShell` |
| `driver-nav.js` | `#driverShellFooter` | `driver.html`, `driver-wallet.html`, `driver-app.html` |
| `store-shell.js` | `#storeShellFooter` | `store-dashboard.html`, `merchant-dashboard.html` |

### No site footer today

`wallet.html` · `services-provider.html` · `pay.html` · `delivery-map.html` (only map-canvas-footer)

### Preview pages (internal)

`preview/restaurants-hub.html` · `preview/stores-hub.html` · `preview/services-hub.html` · `preview/delivery-hub.html` · `preview/home-hub-direct.html`

### Kept unchanged

`index.html` — `.lp-footer` only

---

## 3. Dependency Check

| Consumer | Uses footer for | Risk |
|----------|-----------------|------|
| `store-preview-mode.js` | Disables footer links in store preview | **None** — preview nav uses header |
| `store-shell.js` `wireStoreShellFooterGuard` | Blocks certain footer hrefs | **None** — becomes no-op |
| Typography PR1 CSS | Styles `.dash-site-footer__link` | **None** — cosmetic only |
| `mobile-foundation.css` | Footer safe-area padding | **None** — no footer to pad |
| Bottom Navigation | Primary mobile nav | **Independent** — not affected |
| Header nav | Primary desktop/tablet nav | **Independent** — not affected |

**Conclusion:** Footer links duplicate Header + Bottom Nav routes. No payment, order, auth, or KPI logic reads footer DOM.

---

## 4. Implementation Plan

1. `renderFooter()` → empty string in `guest-shell.js`, `driver-nav.js`, `store-shell.js`
2. Strip inline `<footer class="dash-site-footer…">` from all HTML except `index.html`
3. Strip preview footers from `preview/*.html`
4. Strip `adm-foot` from `admin/index.html`
5. No changes to Header · Bottom Nav · Typography · Layout CSS · page logic

---

## 5. Screenshot Pages (Before / After)

Representative set at **390 · 768 · 1280**:

| Slug | URL | Why |
|------|-----|-----|
| restaurants | `/restaurants` | Hub |
| stores | `/stores` | Hub |
| services | `/services` | Hub |
| delivery | `/delivery-services` | Delivery hub |
| cart | `/cart.html` | Commerce |
| checkout | `/checkout` | Commerce |
| wallet | `/wallet.html` | Commerce |
| orders | `/my-orders` | Commerce |
| login | `/login` | Auth |
| dashboard | `/dashboard` | Guest hub |
| driver | `/driver` | Operations |
| store | `/store-dashboard` | Operations |
| provider | `/services-provider` | Operations |
| admin | `/admin-dashboard` | Operations |

**Home (`/`)** — footer retained; optional spot-check only.

---

## 6. Constraints

- ✅ Header unchanged
- ✅ Bottom Navigation unchanged
- ✅ Typography unchanged
- ✅ Layout structure unchanged (footer removal only)
- ✅ Page logic unchanged
- ❌ No Commit / No Push until mobile review

---

## 7. Implementation Results

**Status:** Complete — pending review

### Changes made

| Layer | Files | Action |
|-------|-------|--------|
| JS injection | `guest-shell.js`, `driver-nav.js`, `store-shell.js` | `renderFooter()` → `""` |
| Inline HTML | 26 files via `scripts/strip-site-footers.js` | Removed `.dash-site-footer`, preview footers, `adm-foot` |
| Preserved | `index.html` | `.lp-footer` kept |

### Verification (automated)

| Metric | Before | After |
|--------|--------|-------|
| Viewports with visible site footer | **33 / 42** | **0 / 42** |
| Header | unchanged | unchanged |
| Bottom Nav | present | present |

### Screenshots

| | Path |
|--|------|
| **Before** | `docs/screenshots/footer-removal/before/` |
| **After** | `docs/screenshots/footer-removal/after/` |

14 pages × 3 viewports (390 · 768 · 1280): restaurants · stores · services · delivery · cart · checkout · wallet · orders · login · dashboard · driver · store · provider · admin

### Excluded from removal (confirmed)

- `index.html` → `.lp-footer`
- `delivery-map.html` → `.map-canvas-footer` (map UI)
- `admin-login.html` → `.admin-login-card__foot` (in-card link)
