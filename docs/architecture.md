# ERVENOW — Architecture

## 1. نظرة عامة

ERVENOW عبارة عن **بوابة API أحادية (Node.js + Express)** تستضيف وحدات مجال تحت `apps/`، مع واجهة ثابتة `public/` ونسخة نشر `ervenow-frontend/`. تخزين البيانات عبر **Supabase (PostgreSQL)** مع عميل **service role** على الخادم للمسارات المحمية.

```
Client (Browser / POS / Mobile)
        │
        ▼
┌───────────────────┐
│  server/server.js │  HTTP + Socket.IO + static (optional)
└─────────┬─────────┘
          │
    ┌─────┴─────┬─────────────┬──────────────┐
    ▼           ▼             ▼              ▼
 apps/*    shared/*      workers/*      queues/*
```

## 2. طبقات منطقية

| الطبقة | المسار | المسؤولية |
|--------|--------|-------------|
| **Transport** | `server/server.js` | CORS، JSON، مسارات، Socket.IO، صحة أولية |
| **API modules** | `apps/<domain>/routes.js` | مصادقة، تحقق أدوار، I/O |
| **Services** | `apps/*/service.js`, `shared/services/` | قواعد أعمال قابلة لإعادة الاستخدام |
| **Domain (متنامي)** | `shared/domain/orders/` | تسمية موحّدة لحالات الطلب دون كسر API |
| **Data** | Supabase | جداول، RPC، سياسات RLS (للاستخدام المستقبلي للعميل المباشر) |

## 3. تدفقات رئيسية

- **طلبات التوصيل والمتاجر:** `orders` — إنشاء عبر `checkout` / `order/create` / `delivery/orders`؛ معالجة لاحقة عبر BullMQ (Redis) أو inline.
- **المندوب:** JWT + جدول `drivers` + `users`.
- **المالية التشغيلية:** `ervenow_wallets` + `ervenow_wallet_transactions` + سحب `ervenow_withdraw_requests`.
- **محاسبة منفصلة (قديمة):** `wallets` / `wallet_transactions` — انظر `docs/wallet-system.md`.

## 4. قرارات تثبيت (Stabilization)

- **OTP:** خدمة موحّدة `shared/services/otpChallengeService.js` — وضع `memory` (افتراضي) أو `supabase` عبر `ERVENOW_OTP_BACKEND`.
- **Legacy:** `delivery_orders` غير مستخدم من Node — انظر `docs/legacy-inventory.md`.
- **تنبيه:** `apps/finance/wallet-server.js` غير آمن للنشر العام.

## 5. مستندات مرتبطة

- `docs/database-flow.md`
- `docs/order-lifecycle.md`
- `docs/wallet-system.md`
- `docs/deployment.md`
- `docs/STABILIZATION-PLAN.md`
