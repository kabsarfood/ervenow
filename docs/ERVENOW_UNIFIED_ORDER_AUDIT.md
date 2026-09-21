# ERVENOW Unified Order Environment — تقرير هندسي

**التاريخ:** 2026-09-21  
**النطاق:** تحليل معماري فقط. لا تغيير جداول، لا تغيير Status، لا دمج APIs، لا حذف Legacy، لا نقل أموال، لا تغيير Dispatch.  
**المراجع:** `shared/domain/orders/*` · `shared/services/unifiedOrderStatus.js` · `apps/order/routes.js` · `apps/checkout/service.js` · `apps/delivery/*` · `apps/services/routes.js` · `apps/driver/routes.js` · `apps/food/routes.js` · `apps/finance/routes.js` · `docs/ERVENOW_WALLET_READINESS.md` · `docs/ORDERS-SCHEMA-CONSISTENCY-REPORT.md`

---

## الخلاصة التنفيذية

المنصة **ليست** مجموعة جداول طلبات متنافسة في مسار التشغيل الحي. المسار الحي يكتب في جدول واحد: **`orders`**.

ما يبدو «أنظمة طلب متعددة» هو في الواقع:

1. **مسارات إنشاء متعددة** تصب في `orders` (سلة / توصيل / خدمة / غاز / نقل).
2. **آلات حالة متعددة فوق نفس الصف** (`delivery_status` + `orders.status` المالي + `data.cp_status` + `data.sp_status`).
3. **واجهات قائمة متعددة** تقرأ نفس الجدول بفلاتر مختلفة.
4. **مساران ماليان عند الإتمام** (RPC توصيل vs RPC حجز خدمة).
5. **بقايا Legacy** (`food_orders`، `service_bookings_legacy`) خارج قائمة العميل.

الهدف النهائي («طلب واحد، وكل Role يرى جزأه») **ممكن بدون إعادة كتابة** إذا اعتبرنا `orders` هو Order Core الفيزيائي، وأضفنا **عقد قراءة موحّد + workflows حسب النوع** فوقه. الخطر ليس غياب الجدول المركزي؛ الخطر هو **دمج الحالات والتسوية والمناديب في مسار واحد**.

---

## 1. جميع أنواع الطلب الحالية

العمود التشغيلي المعتمد في الإدراج الحي: `orders.order_type` + `orders.service_type` + `orders.portal_type` (أو استنتاجه عبر `resolveOrderPortalType`).

ترقيم الطلب: `allocateUniqueOrderNumber` / `allocateUniqueServiceOrderNumber` — صيغة `PREFIX-يوم-عشوائي` (`ED` توصيل، `ES` متجر أو غاز، `SV` خدمة).

| النوع | `order_type` | `service_type` (إن وُجد) | يبدأ من | صفحة الإنشاء | API الحي | Controller | جدول الكتابة | رقم الطلب | Customer | المنفّذ | المبلغ | الحالة التشغيلية | الموقع | الدفع | المحفظة | التسوية |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| متجر | `store` | — | سلة المتجر | `/store.html` → checkout-engine / cart | `POST /api/order/create` (items) | `apps/order/cartCheckoutHttp.js` → `apps/checkout/service.js` `runCheckoutInsert` | `orders` | `ES-…` | `customer_id` | `store_id` + لاحقاً `driver_id` | `order_total` / `total_amount` + `delivery_fee` | `delivery_status` | pickup من المتجر / drop GPS العميل | `payment_method` + `payment_status` (`pending`/`paid`) | عميل: ledger؛ تاجر عند تسليم | `ervenow_ledger_settle_delivered_order` عند `delivered` |
| مطعم (المسار الحي) | `restaurant` | — | سلة مطعم عبر checkout | `/restaurants.html` → نفس السلة | نفس `POST /api/order/create` | نفس checkout | `orders` | `ED-…` | `customer_id` | `store_id` + `driver_id` | نفس أعمدة المتجر | `delivery_status` | نفس المتجر | نفس | نفس | نفس RPC التوصيل |
| مطعم Legacy | — (صف `food_orders`) + صف توصيل | — | `POST /api/food/orders` **مهمل** | لا واجهة عامة معتمدة | `apps/food/routes.js` | يكتب `food_orders` **ثم** `orders` إذا توصيل | `food_orders` + `orders` | رقم `orders` مستقل عن `#foodRow.id` | `customer_id` في الجدولين | مندوب على صف `orders` فقط | `food_orders.total` vs `orders.order_total` | `food_orders.status=new` منفصل | عنوان في جسم الطلب | غير موحّد | لا تسوية من `food_orders` | التسوية على صف `orders` إن وُجد |
| توصيل عام / طرود | `delivery` | أحياناً `local_delivery` | بدون سلة أو من delivery-services | `/delivery-services.html` · `/order.html` | `POST /api/order/create` (بدون items) أو `POST /api/delivery/orders` (proxy) | `apps/order/deliveryOrderCreateShared.js` | `orders` | `ED-…` | `customer_id` | `driver_id` | `delivery_fee` / `order_total` | `delivery_status` يبدأ `pending` أو `draft` | `pickup_*` + `drop_*` | `payment_status` + method | مندوب عند تسليم | RPC توصيل |
| توصيل داخلي | غالباً `service` | **`internal_delivery`** | خدمة/توصيل | `/delivery-services.html` | `createServiceOrder` عبر `/api/order/create` أو checkout group=service | `shared/services/serviceOrderCreate.js` | `orders` | `SV-…` | `customer_id` | **مندوب** (`driver_id`) لا مزوّد نقل | المبلغ في `delivery_fee` (خاص بهذا النوع) | `delivery_status` | pickup/drop | `paid`/`unpaid` | محفظة المندوب | RPC توصيل + `notifyInternalDeliveryOrder` |
| خدمات منزلية | `service` | `plumber` `electrician` `ac_technician` `agricultural_engineer` `nursery` `laundry_estates` `cleaning*` | كتالوج خدمات | `/services.html` → `/service-book.html?type=` | `POST /api/services/home-order` (مهمل→create) أو سلة `type=service` أو `POST /api/order/create` | `createServiceOrder` | `orders` | `SV-…` | `customer_id` | `provider_id` (دور DB `service`) | معاينة 60 ر.س أو ثابت/اتفاق | `delivery_status` + **`data.sp_status`** | `district` + `service_location` | غالباً `unpaid` حتى المعاينة | مزوّد خدمة | `ervenow_ledger_settle_service_booking` عند إتمام ثنائي |
| غاز | `gas_delivery` | `gas_delivery` (+ `gas_mode` أسطوانة/مركزي) | توصيل غاز | `/gas-delivery.html` · `delivery-services?service=gas_delivery` | `POST /api/services/gas-order` (مهمل) أو unified create | `apps/delivery/gasDeliveryCreate.js` | `orders` | `ES-…` | `customer_id` | `provider_id` بوابة **Service** | تسعير الغاز | `delivery_status` | موقع العميل + نصف قطر | `paid` أو `unpaid` عند التوصيل | مزوّد غاز | RPC خدمة |
| تلميع | `service` | `car_polishing` | خدمات | `/car-polishing.html` | `createServiceOrder` | نفس + `carPolishingWorkflow` | `orders` | `SV-…` | `customer_id` | `provider_id` Service | من 280 ر.س حسب المركبة | `delivery_status` + **`data.cp_status`** | موقع العميل + صور | `paid`/`unpaid` | مزوّد تلميع | RPC خدمة |
| نقل مركبات / سطحة | `service` (أحياناً يُنشأ كـ unified delivery) | `car_transport` / `vehicle_transfer` | توصيل ونقل | `/delivery-services.html?service=car_transport` | checkout geo → `runUnifiedDeliveryOnlyCreate` أو `createUnifiedDeliveryOrder` | `apps/delivery/unifiedDeliveryCreate.js` | `orders` | حسب المسار | `customer_id` | `provider_id` بوابة **Transport** | أجرة مسافة | `delivery_status` | pickup/drop خريطة + مدن للنقل الخارجي | `paid`/`unpaid`/`pending` | مزوّد نقل | RPC خدمة إن `order_type=service`؛ وإلا توصيل |
| ونيت / نقل أثاث | `service` | `pickup_truck` `furniture_move` | توصيل ونقل | `delivery-services` | نفس مسار الخدمة/التوصيل الموحّد | `createServiceOrder` أو unified delivery | `orders` | `SV-…` أو `ED-…` | `customer_id` | `provider_id` Transport | أجرة | `delivery_status` | مدن/أحياء | نفس | مزوّد نقل | RPC خدمة |
| طلب مالي خام | غير محدد غالباً | — | API مالي | لا صفحة عميل | `POST /api/finance/orders` | `apps/finance/routes.js` | `orders` | قد بلا `order_number` | `customer_id` | `merchant_id`/`driver_id`/`provider_id` من الجسم | `total_amount` | يكتب **`status` مالي** + `delivery_status=pending` | ضعيف | غير موحّد | خطر صفوف يتيمة | لا دورة تشغيل |

### ملاحظات حقل به حقل

- **ID:** `orders.id` UUID. هذا هو المعرّف التشغيلي لكل المسارات الحية.
- **Customer ID:** `orders.customer_id` — موجود على الإدراج الحي. قائمة «طلباتي» تعتمد عليه.
- **Merchant:** `store_id` هو مفتاح لوحة التاجر (`GET /api/store/order-board`). `merchant_id` يُملأ إن وُجد مستخدم مرتبط بالمتجر (`resolveMerchantUserIdForStore`) — **ليس دائماً مضموناً**. `GET /api/finance/orders` للتاجر يفلتر بـ `merchant_id` لا `store_id` (فجوة خطرة).
- **Provider:** SoT هو `provider_id`. `service_provider_id` عمود توافق يُحذف عند الإدراج (`orderProviderId.js`).
- **Driver:** `driver_id` = `users.id` للمندوب، يُسند عند القبول أو عند PATCH من مندوب بلا سائق.
- **المبلغ:** تكرار متعمّد: `total_amount` · `order_total` · `delivery_fee` · `platform_fee` · `platform_commission` · `driver_earning` · `vat_amount` · `total_with_vat`. المصدر المحاسبي المعتمد هو **الدفتر** لا هذه الأعمدة وحدها.
- **حالة الطلب:** التشغيل يقرأ `delivery_status` (`getOrderDeliveryStatus`). `orders.status` طبقة مالية قديمة (`FINANCE_ORDER_STATUS`: new/accepted/onroad/delivered/cancelled).
- **الموقع:** `pickup_lat/lng` · `drop_lat/lng` · `pickup_address` · `drop_address` · `district` · `service_location` · `driver_lat/lng` · `last_location_at`.
- **الدفع:** `payment_method` (ew_pay, mada, cash_on_delivery, …) و`payment_status`. القيم **غير موحّدة**: checkout يكتب `pending`/`paid`؛ الخدمة تكتب `paid`/`unpaid`.
- **المحفظة المرتبطة:** لا FK محفظة على صف الطلب. الربط وقت التسوية عبر `user_id + role` في `ervenow_ledger_wallets`.
- **التسوية:** عند `delivery_status=delivered` لمسار المندوب/المتجر: `runDeliveredFinancialSettlement`. لمسار الخدمة: `completeServiceOrder` → `settleCompletedServiceLedgerOnly` (RPC `ervenow_ledger_settle_service_booking`).

---

## 2. Order Tables

| النظام | Table | ID | Customer | Executor | Status | Amount | Payment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Core الحي** | `orders` | `id` UUID | `customer_id` | `store_id` / `merchant_id` / `driver_id` / `provider_id` | **`delivery_status`** (+ `status` مالي) | `order_total` `total_amount` `delivery_fee` … | `payment_status` `payment_method` |
| حجوزات خدمة (عرض API فقط) | نفس `orders` عبر `orderToBookingView` | نفس | نفس | `provider_id` | يعيد تسمية `pending`→`new` للتوافق | نفس | `payment_status` (`paid`/`unpaid`) |
| تلميع / مراحل منزلية | `orders.data` JSON | — | — | — | `cp_status` / `sp_status` | داخل data | داخل data |
| مطعم Legacy | `food_orders` | id خاص | `customer_id` | لا مندوب هنا | `status` (`new` عند الإنشاء) | `total` | غير مربوط |
| حجوزات خدمة Legacy | `service_bookings_legacy` (بعد unification 13) | قديم | قديم | قديم | قديم | قديم | **قفل كتابة** (`block_service_bookings`) |
| `service_bookings` | أُعيد تسميته/قُفل | — | — | — | — | — | JS يرفض الإدراج |
| `delivery_orders` | **لا استخدام JS حي** | — | — | — | — | — | مذكور كـ legacy في تقارير النضج |
| قائمة طعام | `food_menu_items` | كتالوج | — | — | `active` | `price` | ليس طلباً |
| حركات متجر موازية | `store_transactions` | `order_id` اختياري | — | `store_id` | — | `amount` | طبقة عرض لا دفتر |
| دفتر | `ervenow_ledger_wallets` / `ervenow_ledger_transactions` | — | `user_id` | حسب `role` | — | `balance` | التسوية الحقيقية |
| سحب | `ervenow_withdraw_requests` | — | شريك | — | pending/approved | amount | بعد الطلب |
| مسودة قبل الإرسال | ليس جدولاً — `ErvenowOrderDraft` (عميل) | — | الجلسة | — | draft محلي | totals | `payment_method` |

### هل لدينا جدول Orders مركزي؟

**نعم: `orders`.** كل المسارات الحية تُدرج فيه (`insertOrdersResilient`).

### هل Service bookings منفصلة؟

**لا في التشغيل الحي.** `GET/POST /api/services/bookings*` تقرأ/تكتب `orders` حيث `order_type IN (service, gas_delivery)` وتُعاد بشكل `booking` للتوافق. الجدول الفيزيائي `service_bookings` مُقفَل.

### هل Delivery jobs منفصلة؟

**صف الطلب في `orders`.** «الوظيفة» التشغيلية طابور BullMQ `ervenow-delivery` (`new-order` / `checkout-dispatch`) + إشعارات واتساب/إشعارات داخلية. ليست جدولاً بديلاً للطلب.

### هل Transport requests منفصلة؟

**لا جدول.** نفس `orders` مع `service_type` نقل + `portal_type=transport` (صريح أو مُستنتَج).

### أين التكرار؟

| التكرار | أين | خطورة |
| --- | --- | --- |
| إنشاء مزدوج مطعم | `food_orders` + `orders` عبر `/api/food/orders` | صف عميل في جدول لا يظهر في «طلباتي» إن لم يُكتب `orders` بمعرّف موحّد |
| اسم «حجز» vs «طلب» | API الخدمات يعيد `booking` وهو صف `orders` | تضليل توثيق/واجهات قديمة فقط |
| عمودان للمنفّذ الخدمي | `provider_id` vs `service_provider_id` | الكود الحي يوحّد على `provider_id` |
| عمودان للتاجر | `store_id` vs `merchant_id` | لوحات مختلفة تفلتر بمفاتيح مختلفة |
| مبلغان | `total_amount` vs `order_total` | `repairInconsistentOrderFinancials` موجود لهذا السبب |
| حالتان | `delivery_status` vs `status` | التشغيل يتجاهل `status` في `orderStatus.js` |
| حالات JSON موازية | `cp_status` / `sp_status` | دورة خدمة أغنى من دورة التوصيل الخطية |
| قوائم سائق | `/api/driver/orders` ≠ `/api/order/orders` | انظر §6 |
| حركات متجر | `store_transactions` vs ledger | عرض قديم بجانب الدفتر |

لا يوجد اليوم جدول `transport_requests` ولا جدول `service_jobs` حي.

---

## 3. حالات الطلب Statuses

### 3.1 القيم الموجودة فعلياً في الكود

**أ) `orders.delivery_status` — SoT التشغيلي** (`shared/domain/orders/constants.js` + `helpers.js`):

| القيمة | أين تُستخدم | من يغيّرها | API | مالي | Notification | Dispatch |
| --- | --- | --- | --- | --- | --- | --- |
| `draft` | انتظار تأكيد دفع / بوابة دفع | نظام الدفع → `pending` | نشر عبر `publishOrderAfterPayment` / PATCH | لا تسوية | عند `draft→pending`: تاجر/مزود/أدمن/مندوب حسب النوع | إن كان dispatchable: `enqueueDeliveryJob` |
| `new` | خدمات غالباً؛ قديم للتوصيل | إنشاء خدمة؛ مندوب يقبل | إنشاء / قبول | لا | إشعار مزودين إن لم يُحبس للدفع | `notifyProvidersForBooking` أو طابور إن driver-dispatch |
| `pending` | طلب منشور بانتظار قبول | إنشاء سلة/توصيل مدفوع أو نقد | إنشاء | لا | متجر + أدمن؛ خدمات: مزودون | طابور `new-order` / `checkout-dispatch` |
| `accepted` | تاجر قبل، أو مندوب/مزود حجز | تاجر أو مندوب أو مزود | `PATCH /api/order/:id/status` · `POST /api/driver/accept/:id` · `POST /api/delivery/orders/:id/accept` · `POST /api/services/bookings/:id/reserve` | لا | عميل: قبول المتجر؛ واتساب قبول | لا إسناد مندوب لمتجر حتى `ready` |
| `preparing` | تجهيز متجر فقط | تاجر/مطعم | PATCH موحّد | لا | عميل «جاري التنفيذ» | لا |
| `ready` | جاهز لاستلام المندوب | تاجر | PATCH | لا | عميل + **أقرب مناديب** `notifyNearestDrivers` + `notifyDriversOrderReady` | نعم — ظهور في قائمة المندوب (مسار driver API) |
| `picked` | alias قديم | يُطبَّع إلى `picked_up` عند الإدخال | PATCH | لا | — | — |
| `picked_up` | استلام من المتجر / بدء حمل | مندوب | PATCH أو accept على `ready` يقفز إلى `picked_up` | لا | عميل + متجر | تتبع GPS |
| `delivering` | في الطريق | مندوب أو مزود (خدمة: يعني «المزود أنهى وبانتظار تأكيد العميل») | PATCH · completeServiceOrder actor=provider | لا | عميل «المندوب في الطريق» | تتبع |
| `delivered` | نهاية ناجحة | مندوب / مزود+عميل / أدمن | PATCH · `POST /api/driver/complete-order/:id` · `POST /api/services/bookings/:id/complete` | **نعم** تسوية دفتر | عميل تسليم + تسوية مندوب/مزود + smart collection | إغلاق |
| `cancelled` | إلغاء | عميل (قبل الاستلام) / أدمن | `POST /api/order/:id/cancel` · delivery cancel · PATCH إن صُرّح | استرداد دفتر **ليس تلقائياً من الإلغاء** (أدمن `/api/wallet/ledger/refund`؛ finance refund يشترط `orders.status=cancelled` وهذا حقل مختلف) | `notifyOrderCancelled` | يُحذف من الفتح |
| `cancelled_by_customer` | إلغاء العميل صراحة | عميل | نفس مسارات الإلغاء/PATCH | نفس | نفس | نفس |
| `completed` | ليس قيمة `delivery_status` الرسمية؛ يظهر في حراسة `completeServiceOrder` وفي aliases (`completed`→`delivered`) | — | يُرفض/يُطبَّع | — | — | — |
| `onroad` | alias deprecated → `delivering` | إدخال قديم | يُطبَّع | — | — | — |
| `canceled` | إملاء أمريكي → `cancelled` | إدخال قديم | يُطبَّع | — | — | — |

انتقالات الخطّ (`isValidDeliveryTransition`): تقدم خطوة واحدة في السلسلة  
`pending/new → accepted → preparing → ready → picked_up → delivering → delivered`  
مع اختصارات: `accepted→delivering` (طلبات بلا تجهيز متجر)، `ready→delivering`، `accepted→delivered` (مندوب غير متجر)، `draft→pending`.  
**الإلغاء ليس في السلسلة الخطية**؛ يُسمح به عبر `assertActorDeliveryTransition` قبل الاستلام.

**ب) `orders.status` المالي** (`FINANCE_ORDER_STATUS`): `new` · `accepted` · `onroad` · `delivered` · `cancelled`  
طبقة `orderStatus.js` **لا تقرأ هذا العمود**. مسار `POST /api/finance/orders` ما زال يكتبه. `POST /api/finance/orders/:id/refund` يفحص `order.status !== 'cancelled'` وليس `delivery_status`.

**ج) `food_orders.status`:** عند الإنشاء `new` فقط في المسار الحالي. آلة منفصلة ميتة تقريباً.

**د) `data.cp_status` تلميع** (`carPolishingWorkflow.js`):  
`new` · `accepted` · `scheduled` · `on_the_way` · `in_progress` · `completed` · `cancelled`  
تُحدَّث عبر `apps/services` (reserve / reject / cancel-task / phase patches) مع مزامنة جزئية إلى `delivery_status`.

**هـ) `data.sp_status` خدمات منزلية** (`servicePhaseWorkflow.js`): نفس مجموعة التلميع. لا يشمل `gas_central_refill` (مسار غاز منفصل).

**و) `payment_status`:** `pending` · `paid` · `unpaid` (ثلاثة عوالم). ليست حالة تشغيل.

**ز) سجل المندوب (ليس حالة طلب):** `drivers.status=approved` · `drivers.active` · `availability`/`online`/`is_online`. القبول يرفض إن `isDriverRecordOffline`.

### 3.2 من يملك التغيير — ملخص الصلاحيات

المصدر: `canPatchOrderStatus` + `canUserPatchOrderStatus` + `closedAlphaTransitions.js`.

| الدور | المسموح على `delivery_status` |
| --- | --- |
| admin | أي انتقال صالح + إلغاء |
| customer (مالك) | إلغاء قبل `picked_up`؛ في الخدمة: تأكيد إتمام بعد المزود |
| merchant/store/restaurant (مالك المتجر) | `accepted` · `preparing` · `ready` فقط — **ممنوع `delivered`** |
| driver (المسند أو المفتوح) | `accepted` · `picked`/`picked_up` · `delivering` · `delivered`؛ لمتجر: ممنوع التسليم قبل الاستلام |
| service (المزوّد المسند) | `delivering` · `delivered` عبر `completeServiceOrder` |

### 3.3 APIs التي تغيّر الحالة (حية + مهملة تُحوَّل)

| API | الحالة |
| --- | --- |
| `PATCH /api/order/:id/status` | **SoT** → `patchUnifiedOrderStatus` |
| `PATCH /api/delivery/orders/:id/status` | يمر لنفس الدالة |
| `PATCH /api/finance/orders/:id/status` | مهمل → نفس الدالة |
| `PATCH /api/services/bookings/:id/status` | مزود/أدمن على صف خدمة |
| `POST /api/driver/accept/:id` | قبول؛ إن `ready`+متجر → مباشرة `picked_up` |
| `POST /api/delivery/orders/:id/accept` | قبول مندوب للحالات `new/pending` فقط |
| `POST /api/driver/complete-order/:id` | إتمام مندوب |
| `POST /api/services/bookings/:id/reserve` | → `accepted` + `provider_id` |
| `POST /api/services/bookings/:id/complete` | إتمام خدمة ثنائي |
| `POST /api/order/:id/cancel` و`POST /api/delivery/orders/:id/cancel` | إلغاء عميل/أدمن |
| رفض/إلغاء تلميع | `.../reject` · `.../cancel-task` على bookings |

---

## 4. دورة طلب المتجر

```
Customer
  → /store.html (أو مطعم) + سلة ErvenowOrderDraft
  → POST /api/order/create  { items: [{ type: store|restaurant, data.store_id, ... }] }
  → runCheckoutInsert
       payment_gate / ew_pay → delivery_status = draft | pending
       store_id + merchant_id (إن وُجد) + pickup من المتجر + drop GPS
  → إن draft: نشر بعد الدفع publishOrderAfterPayment → pending
  → notifyMerchant + notifyAdmins + (إن dispatch) enqueue checkout-dispatch
Merchant (/merchant-preview ← GET /api/store/order-board WHERE store_id)
  → accepted → preparing → ready     PATCH /api/order/:id/status
  → عند ready: notifyNearestDrivers
Driver (/driver-preview ← GET /api/driver/orders يشمل ready غير المسند)
  → accept: POST /api/driver/accept/:id  → picked_up (+ driver_id)
  → delivering → delivered
  → GPS: POST /api/delivery/orders/:id/location
Completion
  → runDeliveredFinancialSettlement
       RPC ervenow_ledger_settle_delivered_order
       + creditDriverOnDelivered
       + creditStoreMerchantOnDelivered (إن payment_status=paid)
Settlement
  → عمولة منصة → محفظة platform
  → متبقي تاجر / مندوب حسب قواعد العمولة
```

### فجوات وأنظمة موازية

1. **`/store-dashboard` و`/order-board.html` ما زالا حيّين** ويقرآن نفس `order-board` — ليست دورة ثانية، واجهة ثانية.
2. **`GET /api/order/orders` للمندوب لا يشمل `ready`.** من يعتمد `/orders` الكلاسيكية قد لا يرى طلبات المتجر الجاهزة.
3. **قبول التوصيل العام** (`/api/delivery/orders/:id/accept`) يرفض غير `new/pending` — لا يصلح لاستلام متجر `ready`.
4. **`POST /api/food/orders`** يخلق عالماً موازياً (`food_orders`) إن استُدعي.
5. **`orders.status` المالي** لا يُحدَّث مع دورة التاجر.
6. **إسناد المندوب ليس محرك تخصيص قسري** — أقرب مناديب يُخطَرون، والقبول سباق `driver_id IS NULL`.
7. **نقد عند التسليم vs محفظة:** إيداع التاجر مشروط عملياً بـ `payment_status=paid` في مسار الائتمان.

---

## 5. دورة طلب الخدمة

```
Customer
  → /services.html | /service-book.html | /car-polishing.html | /gas-delivery.html
  → إنشاء: createServiceOrder  (أو gasDeliveryCreate / unified delivery للنقل الجغرافي)
       order_type = service | gas_delivery
       delivery_status = new  (أو draft إن حُبس للدفع)
  → notifyProvidersForBooking (فلتر نوع + حي/مدينة + نصف قطر غاز)
Service / Transport provider
  → لوحة /service-preview أو /transport-preview
  → GET /api/services/bookings  (orders مُفلترة portal_type)
  → reserve → accepted + provider_id
  → (تلميع/منزلي) cp_status / sp_status:
        accepted → scheduled → on_the_way → in_progress → completed
  → location: POST /api/services/bookings/:id/location
  → complete:
        مزود → delivery_status=delivering (provider_completed_at)
        عميل يؤكد → delivered + تسوية خدمة
Payment/Settlement
  → settleCompletedServiceLedgerOnly
  → creditProviderOnDelivered
```

### Service Provider مقابل Transport Provider

نفس **دور قاعدة البيانات `service`**. الفصل بوابة فقط (`resolvePortalRole` + `service_type`):

| | Service Provider | Transport Provider |
| --- | --- | --- |
| أنواع | كهربائي، سباك، مكيفات، مغاسل، زراعي، غاز، تلميع | ونيت، سطحة/نقل مركبات، نقل أثاث |
| بوابة | `/service-preview` | `/transport-preview` |
| فلتر الطلب | `orderVisibleInPortal(..., "service")` | `"transport"` |
| إشعار تسوية | `service.payment.settled` | `transport.payment.settled` |
| جدول الطلب | **نفس `orders`** | **نفس `orders`** |
| **ليس** | مندوب توصيل | مندوب توصيل |

**`internal_delivery` مستثنى صراحة من reserve المزود** («للمناديب فقط»). هذا ليس Transport.

فرق تشغيلي جوهري عن المتجر: **لا مرحلة تجهيز تاجر ولا `ready` لمندوب المنصة.** المزود هو المنفّذ. بعض خدمات النقل تُنشأ عبر محرك رسوم التوصيل الجغرافي (`unifiedDeliveryCreate`) لكنها تُعرض في بوابة النقل لا في `/driver-preview` (`isDriverDispatchOrder` يستبعدها).

---

## 6. دورة المندوب

### مصدر الطلبات التي تظهر للمندوب

ثلاثة مصادر قراءة، **ليست متطابقة**:

| المصدر | الصفحة | ماذا يُجلب |
| --- | --- | --- |
| `GET /api/driver/orders` | **`/driver-preview` (canonical)** | مسندة: `accepted/picked/picked_up/delivering` + مفتوحة `new/pending` بلا سائق + **`ready` بلا سائق** + آخر 12 `delivered` — ثم `filterDriverDispatchOrders` |
| `GET /api/order/orders` (فرع driver) | **`/orders` (legacy)** و`listOrders` | مفتوحة `new/pending` + مسندة حتى `delivering` — **بدون `ready` وبدون delivered** |
| `GET /api/delivery/orders` | نفس `listOrders` | مطابق لـ `/api/order/orders` |

**`/orders` و`/driver-preview` لا يقرآن نفس البيانات.**  
Canonical المندوب يعتمد `/api/driver/orders`. صفحة `/orders` ناقصة لطلبات المتجر الجاهزة.

`my-orders.html` إن كان الدور `driver` يحوّل إلى `/orders` (إرث) لا إلى `/driver-preview`.

### availability

- اعتماد: `drivers.status=approved` و`active=true` (`ensureApprovedDriver`).
- قبول: يُرفض إن `isDriverRecordOffline` (`active/online/availability`).
- موقع: `drivers.lat/lng`؛ قبول طلب بإحداثيات استلام يتطلب GPS للمندوب.
- واجهة preview تعرض «متصل» من `navigator.onLine` — **ليست** بالضرورة نفس عمود `drivers.availability`.
- لا يوجد في `apps/driver/routes.js` مسار toggle availability واضح كـ API مستقل ضمن هذا المسح.

### assignment / acceptance / pickup / tracking / completion

```
إشعار (طابور أو ready)
  → قبول:
       توصيل مفتوح: POST /api/driver/accept/:id أو delivery accept
         (سباق UPDATE WHERE driver_id IS NULL)
       متجر ready: accept → PATCH picked_up + driver_id
  → حمل: picked_up → delivering  PATCH
  → تتبع: POST /api/delivery/orders/:id/location → driver_lat/lng + socket
  → إتمام: PATCH delivered أو POST /api/driver/complete-order/:id
  → تسوية مندوب
```

الإسناد **اختياري تنافسي** (notify nearest) لا تخصيص حصري دائم.

### هل يوجد أكثر من Dispatch Engine؟

**نعم، أكثر من مسار إشعار/طابور على نفس الجدول — وليست محركات تخصيص مستقلة كاملة:**

1. **BullMQ `ervenow-delivery`** — وظائف `new-order` و`checkout-dispatch` → `notifyNearestDrivers`.
2. **مسار مباشر** `notifyNearestDrivers` / `getNearestDrivers` عند `ready` للمتجر (`unifiedOrderStatus`).
3. **مزودو خدمة** `notifyProvidersForBooking` — ليس مناديب.
4. **توصيل داخلي** `notifyInternalDeliveryOrder`.
5. **نصف قطر غاز** `gasRadiusExpand.js` يوسّع البحث على `orders` للغاز.

إن Redis غائب، الطابور يضعف/يتخطى حسب `queues/deliveryQueue.js` بينما المسارات المباشرة ما زالت تعمل. هذا ازدواج تشغيل لا ازدواج جدول.

فلتر اختصاص المندوب: `shared/utils/driverDispatchOrders.js`  
يشمل متجر/مطعم/توصيل/`internal_delivery`  
يستبعد خدمة منزلية وغاز وتلميع ونقل مركبات/أثاث/ونيت.

---

## 7. العميل — «طلباتي»

الصفحة: **`/my-orders.html`**  
API: **`GET /api/order/orders`** → `listOrders` →  
`SELECT * FROM orders WHERE customer_id = me LIMIT 120`  
**بدون فلتر نوع.**

### هل تُجمع تحت Customer ID واحد؟

**للمسار الحي: نعم.** كل إنشاء عبر checkout / order/create / serviceOrderCreate / gas / unified delivery يكتب `customer_id` على `orders`.

لذلك عميل واحد **يستطيع نظرياً** رؤية:

- طلب متجر
- طلب توصيل
- طلب خدمة
- طلب نقل

في قائمة واحدة، لأنهم صفوف `orders` بنفس `customer_id`.

### الفجوات التي تمنع «طلباتي» كعقد موحّد اليوم

1. الواجهة تعرض `delivery_status`/`order_number` ولا تفرّق `workflow` (متجر/خدمة/نقل) — لا تستخدم `order_type` في القالب الحالي.
2. `food_orders` لا تُدمج في هذا الـ API.
3. `service_bookings_legacy` لا تُقرأ.
4. أدوار غير العميل تُحوَّل بعيداً (مندوب → `/orders`، أدمن → لوحة).
5. حد 120 بدون pagination.
6. مسار مالي `GET /api/finance/orders` قائمة موازية لنفس الجدول بفلاتر أدوار مختلفة (تاجر بـ `merchant_id`).
7. تتبع: `/track?id=` يعمل على `orders.id` / رقم الطلب — جيد للوحدة إن عُرض الرابط لكل الأنواع.

**الخلاصة:** التخزين يسمح بالجمع الآن. العقد والعرض لا يقدّمانه كمنتج موحّد.

---

## 8. Unified Order Contract (اقتراح فقط — بلا تنفيذ)

لا ننشئ جدولاً جديداً. نُعرِّف **DTO قراءة** فوق صف `orders` الموجود، لأن الجدول أغنى من القائمة المقترحة أصلاً.

الحقول الدنيا المقترحة (محسوبة، لا أعمدة جديدة إلزامية):

```
order_id            ← orders.id
order_number        ← orders.order_number
order_family        ← STORE | SERVICE | TRANSPORT | DRIVER_DISPATCH
workflow            ← STORE_ORDER | SERVICE_ORDER | TRANSPORT_ORDER | INTERNAL_DELIVERY
order_type          ← كما في DB
service_type        ← كما في DB
portal_type         ← resolveOrderPortalType(row)  (لا تعيد كتابته)
customer_id
fulfiller_type      ← merchant | driver | service_provider | transport_provider
fulfiller_id        ← store_id أو provider_id أو driver_id حسب المرحلة
merchant_id         ← إن وُجد
store_id
driver_id
provider_id
status_operational  ← delivery_status (الخام)
status_unified      ← انظر §10 (طبقة عرض)
status_sub          ← cp_status | sp_status | null
payment_status      ← كما في DB (مع تطبيع unpaid↔pending للقراءة فقط)
payment_method
currency            ← currency_code أو SAR
goods_total         ← order_total / total_amount حسب النوع
delivery_fee
platform_commission
driver_earning
total               ← total_with_vat أو حاصل محسوب للعرض
pickup              ← { lat, lng, address }
drop                ← { lat, lng, address, district }
created_at
accepted_at         ← reserved_at أو inferred
started_at          ← picked_up / sp in_progress
completed_at        ← delivered_at
cancelled_at
```

**ما يُحذف من العقد المقترح حرفياً:** إجبار `subtotal/fees/commission/total` كأعمدة جديدة — الحساب موجود ومشتت؛ العقد يعرضها كقراءة.  
**ما يُضاف لأن المشروع أنظف به:** `order_family` + `status_sub` + الفصل `status_operational` vs `status_unified`.  
`fulfiller_id` الواحد مضلل في طلب متجر (تاجر ثم مندوب) — الأفضل `merchant_ref` + `driver_id` + `provider_id` معاً.

---

## 9. Order Core واحد + Workflows حسب النوع

### Core (مشترك — موجود جزئياً في `orders`)

- الهوية: `id` · `order_number` · `customer_id` · `created_at`
- التصنيف: `order_type` · `service_type` · `portal_type`
- المال الخام: مبالغ + `payment_status` + `payment_method`
- الحالة العليا للقراءة: مشتقة من `delivery_status`
- التتبع الجغرافي الأساسي: pickup/drop + last location
- الإلغاء الطرفي والتسليم الطرفي
- الربط الدفتري وقت الإتمام (بدون توحيد RPC بعد)

### Type-specific (يجب أن يبقى خارج أي آلة واحدة)

| Workflow | خاص به | لا يُفرض على غيره |
| --- | --- | --- |
| **STORE_ORDER** | `preparing`/`ready` · ملكية `store_id` · إسناد مندوب بعد الجاهزية · OTP استلام متجر إن فُعّل | مراحل تلميع/معاينة |
| **SERVICE_ORDER** | مزود + حي/قطر · `sp_status`/`cp_status` · إتمام ثنائي مزود/عميل · معاينة 60 ر.س · `payAfterDiagnosis` | `ready` للمندوب |
| **TRANSPORT_ORDER** | تسعير مسافة/مركبة · مدن خارجية · أسطول المزود · بوابة نقل | تجهيز تاجر |
| **INTERNAL_DELIVERY** (تحت DRIVER لا TRANSPORT) | فلتر مندوب · إشعار internal | reserve مزود خدمة |

**لا تُجبَر كل الطلبات على** `preparing → ready → picked_up`.  
طلب سباكة لا يجب أن يمر بمندوب. طلب متجر لا يجب أن ينتظر `customer_confirmed_at`.

---

## 10. Unified Status Model (عرض فقط)

طبقة **قراءة** فوق الحالات الداخلية. لا تُكتب في DB في أي تنفيذ لاحق دون موافقة.

| Unified (عميل + نظام) | STORE | DRIVER_DISPATCH / توصيل | SERVICE / TRANSPORT | ملاحظات |
| --- | --- | --- | --- | --- |
| `CREATED` | `draft` | `draft` | `draft` | غير منشور للمنفّذين |
| `PENDING_ACCEPTANCE` | `new` `pending` | `new` `pending` | `new` `pending` + cp/sp `new` | |
| `ACCEPTED` | `accepted` | `accepted` | `accepted` + cp/sp accepted/scheduled | |
| `IN_PROGRESS` | `preparing` | — | cp/sp `in_progress` | |
| `READY` | `ready` | — | — | **خاص بالمتجر** — لا تخفيه من العقد؛ اجعله اختيارياً حسب workflow |
| `IN_TRANSIT` | `picked_up` `delivering` | `picked_up` `delivering` | `on_the_way` / service `delivering` | |
| `COMPLETED` | `delivered` | `delivered` | `delivered` / cp `completed` | |
| `CANCELLED` | `cancelled` `cancelled_by_customer` | نفس | + cp/sp cancelled | |

Sub-status للعميل المتقدم: اعرض النص التشغيلي (`preparing`، `scheduled`) تحت الشريحة العليا.  
لا تدمج `READY` داخل `IN_PROGRESS` في طلب المتجر — هو نقطة إرسال المندوب.

---

## 11. Unified Financial Flow

مستند الجاهزية: `docs/ERVENOW_WALLET_READINESS.md`. **لا ربط STC Pay.**

### المسار المستهدف (مستقبل)

```
Customer Wallet (ledger role=customer)
  → Payment (ledger/pay أو تأكيد وسيلة أخرى)
  → Platform holding (محفظة is_platform)
  → Commission (commission_rules → قيد منصة)
  → Merchant/Provider earning (role=store | service)
  → Driver earning (role=driver)
  → Available Balance
  → Withdrawal (ervenow_withdraw_requests — شركاء فقط)
```

### ما الموجود فعلياً

| الخطوة | الوضع |
| --- | --- |
| محفظة عميل/تاجر/مندوب/مزود في دفتر | موجودة عبر `/api/wallet` |
| دفع من رصيد العميل لطلب | `POST /api/wallet/ledger/pay` |
| ERVENOW Pay في checkout | `ervenowPayCheckout` — قد يترك `draft` حتى الدفع |
| تسوية توصيل/متجر عند `delivered` | RPC `ervenow_ledger_settle_delivered_order` |
| تسوية خدمة عند إتمام | RPC `ervenow_ledger_settle_service_booking` (ما زال اسم «booking») |
| ائتمان احتياطي مندوب/تاجر/مزود | `creditDriverOnDelivered` · `creditStoreMerchantOnDelivered` · `creditProviderOnDelivered` |
| سحب شركاء + OTP | موجود؛ ليس للعميل |
| شحن عميل | طلب STC/كود — ليس خصماً لحظياً |
| استرداد | RPC أدمن؛ **غير مربوط تلقائياً بإلغاء الطلب** |
| عمولة | `commission_rules` + أحياناً `provider_commission_debts` |

### الناقص (بدون تنفيذ)

- قيد holding واضح بين الدفع والإتمام (جزء من الطلبات تُنشأ `pending` وتنتشر قبل `paid`).
- توحيد `payment_status` (`unpaid` vs `pending`).
- إلغاء العميل → refund تلقائي على نفس الدفتر.
- ضمان أن كل `order_family` يضرب **نفس سياسة** العمولة لا RPCين بصمت مختلف.
- عدم اعتماد `store_transactions` أو أعمدة `driver_earning` كمصدر محاسبي.
- STC Pay checkout: خارج النطاق كما طُلب.

اربط الطلب بالمحافظ **بالهوية** (`customer_id` / `merchant_id`/`store` user / `driver_id` / `provider_id`) لا بعمود wallet على الطلب — هذا كافٍ للمستقبل إن بقيت التسوية في RPC.

---

## 12. Migration Strategy — أقل خطورة

**لا تعِد كتابة ERVENOW. لا تنقل الصفوف الآن.**

الواقع يساعد: Core الفيزيائي موجود (`orders`). المشكلة عقد + قوائم + آلات حالة + RPCين.

### الترتيب الموصى به

| المرحلة | الأسلوب | لماذا الأقل خطراً |
| --- | --- | --- |
| **0 — الآن (بعد موافقتكم)** | **Adapter Layer قراءة فقط** على `GET /api/order/orders` (عميل) يضيف الحقول المحسوبة في §8–10 | صفر هجرة DB؛ يكشف الفجوات في «طلباتي» |
| **A** | **Unified Order View** (SQL VIEW أو دالة JS) فوق `orders` للعميل والأدمن | لا تلمس الكتابات |
| **B** | الإبقاء على APIs الحالية للكتابة؛ وسم المهملات كما هي | الإنتاج يستمر |
| **C اختيارياً** | **Order Registry** فقط إذا احتجتم ضم `food_orders` التاريخي — جدول فهرس `order_id + source` بلا نقل مال | أضيق من دمج الجداول |
| **D لاحقاً جداً** | Event log (`order_events`) للتتبع لا للتشغيل | بعد استقرار العقد |
| **E أخيراً إن لزم** | هجرة بيانات `food_orders` / legacy bookings | بعد ثبات القراءة الموحّدة |

### ما لا يُنصح به الآن

- جدول `unified_orders` جديد ونسخ مزدوج.
- إجبار `delivery_status` على قيم Unified الكبرى.
- دمج RPC التسوية قبل جرد تكافؤ العمولة.
- جعل المندوب يستهلك قائمة الخدمات أو العكس.
- حذف `/orders` أو `food_orders` أو الطابور.

**الخيار الأفضل الواحد:** Adapter قراءة فوق الجداول الحالية، ثم Registry فقط للبقايا، ثم (بعيد) أحداث. ليست «إعادة منصة».

---

## التقرير النهائي

### What already works

- جدول `orders` مركزي حي لكل المتجر/التوصيل/الخدمة/النقل/الغاز/التلميع/التوصيل الداخلي.
- `PATCH /api/order/:id/status` كمسار حالة موحّد نسبياً مع صلاحيات أدوار.
- `createServiceOrder` أغلق الكتابة على `service_bookings`.
- `POST /api/order/create` يفرّع سلة vs توصيل vs خدمة دون جداول جديدة.
- `resolveOrderPortalType` / `orderVisibleInPortal` يفصلون التاجر/الخدمة/النقل/المندوب على نفس الصف.
- `isDriverDispatchOrder` يمنع ظهور السباكة في قائمة المندوب.
- دورة المتجر `accepted → preparing → ready` موجودة في الواجهة (`merchant-order-workflow.js`).
- قائمة العميل `GET /api/order/orders` تجلب كل الأنواع بـ `customer_id`.
- دفتر حقيقي للتسوية والسحب (`FINANCE_MODE=ledger_only`) كما في تقرير المحفظة.
- تطبيع aliases (`onroad`، `completed`، `picked`).
- Idempotency على الإنشاء.

يُحتفظ بهذا كما هو.

### Duplicated Order Logic

- إنشاء: `order/create` · `delivery/orders` · `checkout` · `services/home-order` · `gas-order` · `services/bookings` POST · `food/orders` · `finance/orders`.
- تغيير حالة: order + delivery + finance + services/bookings + driver/accept + driver/complete + delivery/accept.
- قوائم: order/orders · delivery/orders · driver/orders · store/order-board · services/bookings · finance/orders · food/orders · admin/orders.
- إشعار المنفّذ: طابور Bull + nearest drivers + providers booking + internal delivery.
- تسوية: RPC توصيل vs RPC «booking» + ائتمانات احتياطية ثلاثة.
- حالات JSON (`cp`/`sp`) موازية لـ `delivery_status`.
- `store_transactions` بجانب ledger.

التكرار الحقيقي ليس «جدولين للطلب الحي». التكرار **مداخل ومخارج** حول جدول واحد.

### Dangerous Differences

لا يجوز دمجها بشكل أعمى:

1. **طلب متجر يحتاج `ready` قبل المندوب** — طلب توصيل عام يُقبل من `pending`. دمج القوائم يكسر أحد المسارين.
2. **إتمام الخدمة ثنائي (مزود ثم عميل)** — إتمام المندوب أحادي. `delivering` يعني شيئين.
3. **`internal_delivery` مندوب لا نقل.**
4. **Service vs Transport نفس `users.role=service`.** دمج البوابات يخلط الغاز مع السطحة.
5. **`payment_status` unpaid ≠ pending.**
6. **تاجر يُعرَّف بـ `store_id` في اللوحة وبـ `merchant_id` في المالية.**
7. **Refund المالي يفحص `orders.status` لا `delivery_status`.**
8. **`/api/driver/orders` ≠ `/api/order/orders`.**
9. **نقد عند التسليم vs محفظة مدفوعة مسبقاً** يغيّر ائتمان التاجر.
10. **معاينة منزلية 60 ر.س** ليست `order_total` نهائياً.
11. **`food_orders`** إن دُمج في «طلباتي» بلا صف `orders` يظهر طلب بلا تتبع/تسوية.
12. **إلغاء ≠ استرداد.**

### Recommended Unified Architecture

```
                    ┌──────────────────────────┐
                    │   Unified Order Contract │  (قراءة / DTO)
                    │   order_family+status    │
                    └────────────┬─────────────┘
                                 │
                         TABLE orders   ← Order Core الفيزيائي (كما هو)
                                 │
        ┌────────────┬───────────┼────────────┬─────────────┐
        │            │           │            │             │
   STORE_WF     SERVICE_WF  TRANSPORT_WF  DRIVER_WF    (legacy food_*)
   merchant     provider     provider      driver
   ready/prep   sp/cp        geo/fleet     accept/GPS
        │            │           │            │
        └────────────┴───────────┴────────────┘
                         │
              Ledger wallets + 2 RPC settle
              (وثّق الفرق؛ لا تدمج قسراً)
```

- واجهات البوابات تبقى؛ تقرأ العقد أو الفلاتر الحالية.
- الكتابات تبقى على APIs الموجودة حتى تُستبدل تدريجياً بالاسم لا بالسلوك.
- Live Order v2 (`docs/ERVENOW-LIVE-ORDER-v2-ARCHITECTURE.md`) طبقة تعديل لاحقة فوق هذا الـ Core — ليست شرطاً لتوحيد القائمة.

### Recommended First Implementation

**تعديل واحد فقط بعد الموافقة:**

إضافة **حقول قراءة محسوبة** على استجابة `GET /api/order/orders` عندما يكون المستدعي **عميلاً** (وعرضها في `/my-orders.html`):

- `order_family` / `workflow`
- `portal_type` (من الدالة الحالية دون الكتابة)
- `status_unified` (خريطة §10)
- `fulfiller_type`

**بدون:** تغيير جدول، تغيير قيم `delivery_status`، دمج API إنشاء، حذف `/orders`، لمس التسوية أو الطابور.

هذا يثبت أن «طلباتي» تجمع الأنواع تحت `customer_id` كمنتج، ويكشف أي صفوف شاذة (`food_orders`، بلا `order_type`) قبل أي هجرة.

---

*نهاية تقرير Unified Order Environment — تحليل فقط.*
