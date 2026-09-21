# ERVENOW Wallet Readiness — تقرير جاهزية المحفظة

**التاريخ:** 2026-09-21  
**النطاق:** تحليل فقط — لم يُغيَّر أي مسار مالي أو جدول في هذه المرحلة.  
**الوضع الحالي للكود:** `FINANCE_MODE` الافتراضي `ledger_only` عبر `shared/utils/financeMode.js`. واجهة `/api/wallet` معلَّقة على `ervenow_ledger_*`.

---

## الخلاصة التنفيذية

المنصة **ليست مجرد عمود balance**. هناك دفتر (`ervenow_ledger_wallets` + `ervenow_ledger_transactions`) مع RPC للإيداع والدفع والاسترداد وتسوية الطلب المسلم. طلبات السحب منفصلة (`ervenow_withdraw_requests`) بـ OTP. العمولة لها جداول/قواعد مستقلة. شحن العميل موجود كطلب STC/كود واتساب **وليس ربط STC Pay مباشر للسداد**.

**لا يُنصح بربط STC Pay كقناة checkout عامة قبل:** تسوية فورية موثوقة عند الدفع، فصل واضح لمحفظة العميل عن أرباح الشركاء، ومسار استرداد مكتمل على نفس الدفتر.

---

## 1. هل كل محفظة Ledger حقيقي أم مجرد balance؟

| المحفظة | المصدر | النوع |
| --- | --- | --- |
| Customer | `/api/wallet` → `getWalletPayloadWithLedgerFallback` | **Ledger** (`role=customer` في الدفتر) |
| Merchant / Store / Restaurant | نفس `/api/wallet` + `/api/store/merchant-dashboard` يعرض رصيد الدفتر | **Ledger** (`role=store`) |
| Driver | `/api/wallet` و`/api/driver/wallet` | **Ledger** (`role=driver`) — صفحة `/driver-wallet` ما زالت واجهة موازية |
| Service / Transport | `/api/wallet` + `/api/services/me/dashboard` | **Ledger** (`role=service`) |

تعيين الدور الدفتري: `mapAppRoleToLedgerWalletRole` في `shared/utils/ervenowLedgerWallet.js`  
(`merchant/restaurant` → `store`، الباقي مطابق).

الرصيد الظاهر يُحدَّث من حركات الدفتر (ليست محفظة وهمية في الواجهة فقط). إن نقصت جداول الدفتر يظهر خطأ ترحيل لا رقم عشوائي صامت في وضع `ledger_only`.

---

## 2. جداول الحركات الحالية

| الجدول | الوظيفة |
| --- | --- |
| `ervenow_ledger_wallets` | محفظة لكل `user_id + role` + محفظة منصة `is_platform` |
| `ervenow_ledger_transactions` | قيد credit/debit (type مثل earning / payment / withdraw / refund) |
| `ervenow_withdraw_requests` | طلب سحب معلّق إلى اعتماد الأدمن |
| `wallet_topup` (عبر ترحيل topup) | طلبات شحن / أكواد |
| `commission_rules` | نسب عمولة المنصة |
| `provider_commission_debts` | ديون عمولة مزوّد (ما زالت تُقرأ في لوحة الخدمة) |

قراءة الواجهة: `GET /api/wallet/transactions` من `ervenow_ledger_transactions` مع `wallet_mode: "ledger"`.

---

## 3. كيف تُسجَّل الأرباح؟

عند تسليم طلب/حجز تُستدعى تسوية دفتر:

- طلبات توصيل/متجر: RPC `ervenow_ledger_settle_delivered_order`
- حجوزات خدمة: RPC `ervenow_ledger_settle_service_booking`

الغلاف في `shared/utils/ervenowLedgerWallet.js` ← `shadowLedgerSettleDeliveredOrder`.  
التسوية تقسّم عادةً: عمولة المنصة ← محفظة المنصة، والمتبقي ← محفظة التاجر/المندوب/المزوّد حسب نوع الطلب.

حقل `driver_earning` / `platform_commission` ما زال يظهر على صفوف الطلبات للعرض الإداري؛ **المصدر المحاسبي المعتمد في الكود الحالي هو الدفتر** لا تلك الأعمدة وحدها.

---

## 4. كيف تتم withdrawal requests؟

1. أدوار السحب فقط: `driver` · `store` · `restaurant` · `merchant` · `service` — **ليس العميل ولا الأدمن**.
2. حد أدنى 20 ر.س + IBAN سعودي في مسار OTP.
3. `POST /api/wallet/withdraw/send-otp` ثم `confirm-otp` يُدرج في `ervenow_withdraw_requests`.
4. اعتماد/رفض من `/api/admin/*withdraw*`.
5. بوابات Preview (تاجر/مندوب/خدمة/نقل) تستدعي نفس API السحب.

لا يُخصم الرصيد من الدفتر إلا بعد مسار الاعتماد (طلب معلّق أولاً).

---

## 5. هل Refunds موجودة؟

نعم على مستوى الدفتر:

- `POST /api/wallet/ledger/refund` — **أدمن فقط** → RPC `ervenow_ledger_refund`
- ترحيل `migration_p0_ledger_cancel_refund.sql` يغطي إلغاء/استرداد قيد

واجهة العميل **لا** تقدّم زر استرداد ذاتي عام؛ الإلغاء عبر مسارات الطلب (`/api/order/:id/cancel` وdelivery) منفصل عن قيد الاسترداد حتى تُربط صراحة.

---

## 6. هل العمولات منفصلة؟

نعم.

- قواعد: `commission_rules` + `GET/POST /api/finance/commission-rules`
- معاينة: `POST /api/finance/preview-commission`
- عند التسوية تُحسب عمولة المنصة داخل RPC الدفتر
- مزوّدو الخدمة ما زال لديهم `provider_commission_debts` كطبقة ديون ظاهرة في KPI

ليست العمولة مجرد خصم UI؛ لها كيان مستقل، مع ازدواج محتمل بين «دين مزوّد» و«قيد دفتر» يجب حسمه قبل STC Pay.

---

## 7. هل العميل يستطيع Top-up حالياً؟

**نعم كطلب، لا كخصم STC مباشر في checkout.**

- `POST /api/wallet/topup-request` — ينشئ طلب شحن (رسالة STC/واتساب في `walletTopupService.js`: «ERVENOW PAY — طلبات شحن STC Pay + أكواد واتساب»)
- `POST /api/wallet/redeem-code` — تفعيل كود
- الإيداع الفعلي عبر `ervenow_ledger_deposit` عندما يُعتمد/يُسترد الكود
- `POST /api/wallet/ledger/pay` — العميل يدفع **من رصيد محفظته** لطلب موجود (`requireRole("customer")`)

هذا يعني: المحفظة يمكن أن تُشحن يدوياً/بكود ثم تُدفع منها. **لا يوجد اتصال STC Pay API للخصم اللحظي من حساب العميل عند الضغط على ادفع.**

---

## 8. ماذا يلزم لاحقاً لسلسلة  
STC Pay → ERVENOW Pay → Customer Wallet → Payment → Settlement

| الخطوة | الجاهزية اليوم | الفجوة |
| --- | --- | --- |
| هوية محفظة عميل في الدفتر | موجودة | تأكيد أن كل عميل له صف wallet عند أول دخول |
| شحن (Top-up) | طلب + كود | ربط STC Pay رسمي (callback، مطابقة مبلغ، منع الازدواج) |
| ERVENOW Pay عند checkout | إعدادات وسائل الدفع + `ervenowPayCheckout` | توحيد مسار الدفع مع STC vs محفظة vs نقد |
| الدفع من المحفظة | `ledger/pay` على طلب | ربطه كخيار checkout افتراضي مع قفل الرصيد |
| التسوية للتاجر/المندوب/المزوّد | RPC settle عند التسليم | ضمان أن كل نوع طلب (غاز/نقل/متجر) يمر بنفس الـ RPC |
| السحب للشركاء | withdraw_requests + أدمن | أتمتة التحويل البنكي بعد الاعتماد (خارج النطاق) |
| الاسترداد | RPC أدمن | سياسة إلغاء العميل → قيد refund تلقائي |

**قرار هذه المرحلة:** لا ربط STC Pay. الدفتر موجود بما يكفي للتصميم، لكن قناة الدفع الخارجية ووحدة التسوية لكل نوع طلب تحتاج قائمة تكافؤ قبل أي مفتاح إنتاج.

---

*نهاية تقرير الجاهزية المالية — بلا تعديل على المنظومة المالية.*
