# تصميم إحصاءات لوحة الإدارة — قبل التنفيذ

2026-09-28. تصميم فقط. لم يُعدَّل كود.

الملف الحي للواجهة: public/admin-dashboard.html
الحساب: apps/admin/routes.js الدالة computeAdminDashboardStats
المهلة 8 ثوانٍ و schema و polling interval تبقى كما هي.

## ما تحتاجه الشاشة فعلًا

applyStatsToDom يرسم أربعة حقول فقط:

1. ordersToday / today_orders — بطاقة «طلبات اليوم»
2. activeOrders / active_orders — بطاقة «طلبات نشطة»
3. revenueToday — بطاقة «إيرادات اليوم»
4. revenueTotal — بطاقة «إجمالي الإيرادات»

syncLiveProfitFromStats يأخذ ordersToday فقط.
بطاقتا «طلبات مُسلَّمة اليوم» و«إيراد مُسلَّم اليوم» تُحسبان في المتصفح من قائمة الطلبات المفتوحة، لا من هذا المسار.

تُحسب اليوم ولا تُرسم في اللوحة:

- total_orders
- platform_commission
- drivers_earnings
- chart
- range يغيّر chart فقط. البطاقات الأربع لا تتغير مع اليوم/الأسبوع/الشهر.

معنى الأرقام الحالي، ويبقى كما هو:

- طلبات اليوم: count حيث created_at >= بداية اليوم. بلا فلتر حالة.
- طلبات نشطة: count حيث delivery_status in (new, pending, accepted, delivering).
- إيراد اليوم وإيراد الكل: مجموع orderBillableAmount للصفوف غير الملغاة.
  الإلغاء: delivery_status أو status ضمن cancelled / cancelled_by_customer / canceled / canceled_by_customer.
  المبلغ: total_with_vat إن كان > 0، وإلا order_total + delivery_fee + vat_amount إن كان > 0، وإلا total_amount، وإلا order_total.
- إيراد الكل من كل الصفوف غير الملغاة، لا من الفترة المختارة في القائمة.

## تصنيف كل مؤشر

| المؤشر | count فقط | head:true بلا صفوف | شرط بدل سحب الكل | SUM / GROUP BY |
|---|---|---|---|---|
| طلبات اليوم | نعم | نعم، موجود | created_at >= اليوم | لا |
| طلبات نشطة | نعم | نعم، موجود | delivery_status محدد | لا |
| total_orders | نعم | نعم | بلا شرط | لا. غير معروض |
| إيراد اليوم | لا | لا | created_at >= اليوم وغير ملغى | SUM بصيغة CASE. PostgREST لا يعبّر عنها |
| إيراد الكل | لا | لا | غير ملغى فقط | نفس الصيغة على كل التاريخ |
| عمولة المنصة | لا | لا | نفس صفوف الإيراد | SUM عمودين. غير معروض |
| أرباح المندوبين | لا | لا | نفس الصفوف | SUM عمود. غير معروض |
| chart | لا | لا | created_at داخل الفترة | GROUP BY ساعة/يوم في الذاكرة. غير معروض |

select * يُستبدل. الـ count الحالي يستخدم select * مع head:true، وهذا لا يُرجع صفوفًا، ويُستبدل بـ select id مع head:true.

لا RPC في هذا التصميم. الصيغة المركبة للفاتورة ليست عمودًا واحدًا، لذلك SUM الجاهز في PostgREST يعطي رقمًا مختلفًا. RPC يصبح لازمًا فقط إذا بقي select الإيراد الكلي بطيئًا بعد تضييق الأعمدة.

لا index في هذا التصميم.

## Before

عند انتهاء ذاكرة الخادم (90 ثانية)، وبالتوازي:

1. count كل طلبات اليوم. head. بلا صفوف.
2. count النشطة. head. بلا صفوف.
3. count كل الجدول. head. بلا صفوف.
4. صفحات كل صفوف orders، 1000 صف، حتى 80 صفحة، بأعمدة الفاتورة والحالة. بلا فلتر.
5. صفحات created_at لكل الطلبات داخل الفترة، 1000 صف، حتى 80 صفحة. للرسم غير المعروض.

عدد الطلبات نحو PostgREST:

- أقل من 1000 طلب في الجدول: 5
- أسوأ حال: 3 + 80 + 80 = 163

مسح صفوف كامل: نعم، مرتان. مرة لكل الأعمدة المالية، ومرة لـ created_at.

الواجهة: setInterval كل 30 ثانية يستدعي loadStats و refreshLiveDashboard بلا فحص document.hidden.
مؤقت المالية كل 15 ثانية يبقى خارج هذا التغيير.

## After

عند انتهاء الذاكرة، وبالتوازي:

1. count طلبات اليوم: select id, head:true, created_at >= اليوم.
2. count النشطة: select id, head:true, delivery_status in الحالات الأربع.
3. إيراد اليوم: select أعمدة الفاتورة والحالة فقط، where created_at >= اليوم. الصفحات عند الحاجة. الجمع في JS بنفس orderBillableAmount و isCancelledOrder.
4. إيراد الكل + العمولة + أرباح المندوبين إن أُبقيت المفاتيح: نفس الأعمدة، بلا حد تاريخ، مع استبعاد الحالات الملغاة في الفلتر قدر ما يسمح به PostgREST، ثم نفس الجمع في JS.

أعمدة القراءة، بلا select *:
created_at, delivery_status, status, order_total, total_amount, delivery_fee, vat_amount, total_with_vat, platform_fee, platform_commission, driver_earning

يُحذف من المسار:

- count الجدول الكامل غير المعروض
- صفحات chart
- سحب الصفوف الملغاة ضمن إيراد الكل عندما ينجح فلتر الحالة
- order_type لأنه لا يدخل الحساب

مفاتيح JSON تبقى حتى لا يتغير شكل الرد:
total_orders يُحذف استعلامه. المفتاح يُرسل 0 فقط إذا أردنا شكلًا ثابتًا؛ المقترح إبقاؤه رقمًا عبر عدم اختراع قيمة: يُحذف المفتاح من الحساب الثقيل ويُعاد total_orders من عدم إرسال استعلام، والقيمة لا تُعرض. للإبقاء على الشكل يُرسل total_orders كما هو محسوب سابقًا فقط إن وُجد count. القرار في هذا التصميم: لا استعلام total_orders، والحقل يبقى في الرد بقيمة null حتى لا يُعرض رقم خاطئ. البطاقات لا تقرأه.

chart يبقى مفتاحًا شكلًا فارغًا { labels: [], values: [] } بلا استعلام.

عدد الطلبات نحو PostgREST في الحساب الواحد:

- يوم عادي أقل من 1000 طلب اليوم وأقل من 1000 غير ملغى في التاريخ: 4
- أسوأ حال: 2 + صفحات اليوم + صفحات غير الملغى حتى 80

مقارنة بـ 5 إلى 163.

هل يبقى full scan على orders؟

- لا يوجد مسح ثانٍ للرسم.
- لا يوجد سحب لكل الصفوف من أجل العدّ.
- يبقى قراءة واحدة لأعمدة الإيراد للطلبات غير الملغاة عبر كل التاريخ، لأن إيراد الكل رقم تراكمي والواجهة تعرضه. هذه القراءة أضيق من المسح الحالي، وما زالت تمر على تلك الصفوف. إزالتها بالكامل تحتاج RPC لاحقًا، وهو خارج هذا التصميم.

ذاكرة 90 ثانية تبقى. interval 30 ثانية يبقى.

## polling

في public/admin-dashboard.html فقط، حول المؤقت الحالي:

- عند document.hidden: clearInterval لمؤقت الإحصاءات.
- عند visibilitychange والصفحة ظاهرة: إعادة setInterval بنفس 30000، ثم استدعاء واحد فوري.
- مؤقت المالية 15000 لا يُمس.
- refreshLiveDashboard يشارك مؤقت الإحصاءات، فيتوقف معه ويعود معه.

## Diff المقترح — غير مطبّق

apps/admin/routes.js

- countTableRows: select("id", { count: "exact", head: true }) بدل select("*", ...).
- computeAdminDashboardStats يحذف paginatedSelectWithFallback لجدول orders الكامل ولصفوف chart.
- يبقي count اليوم و count النشطة.
- يضيف select مفلترًا لأعمدة الفاتورة: واحد لليوم، وواحد لغير الملغى لكل التاريخ، مع نفس سقف 1000 والحد 80 كحماية قائمة.
- الجمع يبقى orderBillableAmount و isCancelledOrder و round2.
- chart في الرد: { labels: [], values: [] }.
- total_orders في الرد: null بلا استعلام count للكل.

public/admin-dashboard.html

- استبدال setInterval الدائم للإحصاءات ببدء/إيقاف مربوط بـ visibilitychange.
- STATS_POLL_MS يبقى 30000.
- LEDGER_TX_POLL_MS يبقى 15000 وبلا تغيير.
