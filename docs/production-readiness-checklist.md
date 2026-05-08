# Production readiness checklist — ERVENOW

استخدم القائمة كـ **Definition of Done** لكل إصدار إنتاجي.

## Security

- [ ] `ERVENOW_JWT_SECRET` قوي وغير مكرر مع أسرار أخرى
- [ ] `BANK_DATA_SECRET` معيّن في الإنتاج (لا الاعتماد على اشتقاق التطوير)
- [ ] `ERVENOW_OTP_BACKEND=supabase` + `ERVENOW_OTP_PEPPER` بعد تنفيذ هجرة OTP
- [ ] `ALLOW_DEV_OTP` غير مفعّل في الإنتاج
- [ ] `apps/finance/wallet-server.js` غير معروض على الإنترنت أو محذوف/محمي بـ mTLS + JWT خدمة
- [ ] مراجعة مسارات `admin` العامة (مثل طلبات التوظيف) — حد معدل + مراقبة
- [ ] مراجعة `CORS` و`ERVENOW_PUBLIC_URL`

## Data & backups

- [ ] نسخ احتياطي لـ Supabase (PITR إن أمكن)
- [ ] توثيق **ترتيب** تطبيق `shared/migration_*.sql` لكل بيئة
- [ ] اختبار استعادة من نسخة احتياطية دوري

## Runtime

- [ ] `REDIS_URL` للإنتاج + تشغيل `worker:delivery`
- [ ] `OSRM_ROUTER_URL` إن لم يُستخدم الموجّه العام
- [ ] Health: `/api/health` و`/api/health/full`

## Scaling

- [ ] أكثر من instance للخادم → **OTP يجب أن يكون supabase** (ليس memory)
- [ ] مراقبة استهلاك Supabase وtimeouts

## Rate limits

- [ ] التحقق من تفعيل limiters على المسارات الحساسة (`checkout`, `delivery/orders`, …)

## Secrets

- [ ] لا وجود لـ `.env` في الصور أو المستودع العام
- [ ] تدوير المفاتيح عند الاشتباه في تسريب

## Monitoring & recovery

- [ ] `METRICS_ENABLED=1` إن وُجد Prometheus
- [ ] تنبيهات على فشل BullMQ / OSRM / Redis
- [ ] خطة incident: تعطيل ميزة، rollback هجرة (عند الإمكان)، إعلان صيانة

## Post-deploy verification

- [ ] تسجيل دخول زائر (OTP)
- [ ] تسجيل دخول مندوب
- [ ] إنشاء طلب → قبول → تتبع → تسليم
- [ ] طلب سحب (مع OTP إن مفعّل)

---

راجع أيضاً: `docs/STABILIZATION-PLAN.md`, `docs/legacy-inventory.md`.
