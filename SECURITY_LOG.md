# Bila-hodood — Security Log

## تاريخ التوثيق
2026-09-09

## الحالة الحالية

تم إجراء مراجعة أمنية أولية لمنصة Bila-hodood، مع التركيز على Supabase RLS
وعمليات INSERT / SELECT / UPDATE / DELETE وعمليات RPC الموجودة في التطبيق.

---

# 1. حماية جدول confessions

## المشكلة الأصلية

كان التطبيق يغيّر reports_count مباشرة من المتصفح باستخدام UPDATE:

.from("confessions")
.update({ reports_count: newCount })
.eq("id", confessionId)

تم إلغاء هذا الأسلوب.

## الحل

أصبح الإبلاغ يستخدم:

supabaseClient.rpc("increment_report", {
  p_confession_id: confessionId
});

## دالة increment_report

CREATE OR REPLACE FUNCTION public.increment_report(p_confession_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update public.confessions
  set reports_count = coalesce(reports_count, 0) + 1,
      updated_at = now()
  where id = p_confession_id
    and status = 'active';
end;
$function$

المالك:
postgres

security_definer:
true

تم اختبار RPC عبر REST ونجح الطلب.

---

# 2. اختبار UPDATE

تم اختبار محاولة تعديل reports_count مباشرة باستخدام PATCH.

النتيجة:
HTTP 401

والخطأ:
42501 permission denied

وهذا أكد أن anon لا يستطيع تنفيذ UPDATE المباشر على confessions.

---

# 3. سياسات confessions

تم حذف السياسات العامة المفتوحة للإدخال:

Allow public insert confessions
Public Insert Confessions
Public insert confessions

وبقيت السياسة المقيدة:

Public can create confessions

شرط الإدخال:

status = 'active'
AND reports_count = 0

---

# 4. قراءة confessions

تم اكتشاف سياسة خطيرة:

Public read confessions

وكان شرطها:
true

تم حذفها.

بقيت سياسات القراءة التي تشترط:

status = 'active'

وبالتالي القراءة العامة أصبحت للاعترافات النشطة فقط.

---

# 5. حذف confessions

الوصول العام للحذف مغلق.

الموجود:
Prevent anon delete
Strict Admin Delete Confessions

ولا توجد صلاحية DELETE عامة للزوار.

---

# 6. UPDATE confessions

الوصول العام للتعديل مغلق.

التعديل الإداري موجود للمستخدمين authenticated وفق سياسات الإدارة الحالية.

---

# 7. حماية comments

كانت توجد عدة سياسات INSERT عامة مفتوحة بـ true.

تم حذف:

Allow public insert comments
Public Insert Comments
Public insert comments

وبقي:

Public can add comments

وشرطها:

char_length(trim(comment_text)) >= 1
AND
char_length(trim(comment_text)) <= 500

أي أن التعليق يجب أن يكون بين 1 و500 حرف.

---

# 8. حذف comments

تم اكتشاف:

Admin delete comments

وكانت:
DELETE
roles = public
qual = true

تم حذف هذه السياسة.

بقي:
Strict Admin Delete Comments

لـ authenticated.

---

# 9. قراءة comments

القراءة عامة حاليًا.

السياسات الحالية تسمح بالقراءة العامة.

هذا مقصود حاليًا لأن التعليقات جزء عام من المنصة.

---

# 10. حماية reactions

كانت هناك صلاحيات DELETE عامة:

Allow public delete reactions

تم حذفها.

وكانت توجد أيضًا:

Public can remove reactions

وكان شرطها فقط أن user_session_id غير فارغ.

تم حذفها أيضًا.

لا توجد حاليًا صلاحية DELETE مباشرة عامة على reactions.

---

# 11. RPC لإزالة reaction

تم إنشاء:

public.remove_reaction(
  p_reaction_id uuid,
  p_user_session_id text
)

الدالة:

CREATE OR REPLACE FUNCTION public.remove_reaction(
  p_reaction_id uuid,
  p_user_session_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  DELETE FROM public.reactions
  WHERE id = p_reaction_id
    AND user_session_id = p_user_session_id;
END;
$$;

تم إعطاء:

GRANT EXECUTE ON FUNCTION public.remove_reaction(uuid, text)
TO anon, authenticated;

المستخدم لا يملك DELETE مباشرًا على جدول reactions.

---

# 12. تعديل app.js للتفاعلات

كان:

supabaseClient.from("reactions").delete().eq("id", existing.id)

أصبح:

supabaseClient.rpc("remove_reaction", {
  p_reaction_id: existing.id,
  p_user_session_id: sessionId
});

تم التحقق باستخدام grep وgit diff.

---

# 13. بنية reactions

الأعمدة:

id              uuid
confession_id   uuid
reaction_type   text
user_session_id text

---

# 14. أنواع reactions

السياسة المقيدة تسمح فقط:

understand
notAlone

وتتحقق أيضًا من أن:

char_length(user_session_id) > 0

---

# 15. هوية الزائر الحالية

التطبيق يستخدم:

localStorage.getItem("user_sid")

وإذا لم توجد قيمة ينشئ:

"user_" + Math.random().toString(36).substring(2, 12)

ثم يخزنها في localStorage.

مهم:
user_session_id ليس نظام مصادقة حقيقيًا.

يمكن للمستخدم تغيير localStorage يدويًا.

لذلك لا يجب اعتباره هوية موثوقة أو حماية قوية ضد مستخدم متعمد.

---

# 16. فحص الأسرار

تم تنفيذ:

grep -RniE 'service_role|secret|SUPABASE_SERVICE|sb_secret|eyJ' --exclude-dir=.git .

لم تظهر نتائج.

لم يتم العثور على service_role أو sb_secret أو JWT واضح داخل ملفات المشروع في الفحص الذي تم.

المفتاح publishable الموجود في الواجهة ليس service_role.

يجب عدم وضع service_role أو أي secret key في الواجهة.

---

# 17. Git / GitHub

المستودع:

https://github.com/secret1web/Bila-hodood-.git

الفرع:
main

تم إعداد Git:

user.name = secret1web
user.email = malikhammami0@gmail.com

تم تسجيل الدخول إلى GitHub CLI باسم:

secret1web

البروتوكول:
HTTPS

---

# 18. Commits مهمة

تم رفع التغييرات إلى GitHub.

Commit:

c6bfea2
fix report rpc

Commit:

622a54d
restore error handling

Commit:

secure reaction removal

آخر تعديل للتفاعلات تم رفعه بنجاح إلى GitHub.

---

# 19. نقاط القوة الحالية

- RLS مفعّل ومستخدم لحماية العمليات الحساسة.
- UPDATE المباشر على confessions مغلق للزوار.
- DELETE المباشر على confessions مغلق للزوار.
- reports_count لا يتم تغييره مباشرة من العميل.
- الإبلاغ يستخدم RPC.
- قراءة confessions العامة مقيدة بـ status = active.
- التعليقات مقيدة بطول 1 إلى 500 حرف.
- reaction_type مقيد إلى قيم محددة.
- DELETE العام للتفاعلات مغلق.
- إزالة التفاعل تتم عبر RPC.
- لم يظهر service_role أو secret key في الفحص.
- التغييرات محفوظة في GitHub.

---

# 20. نقاط الضعف الحالية

## user_session_id

مبني على localStorage وMath.random.

ليس مصادقة حقيقية.

يمكن للمستخدم تغييره.

## Rate limiting

لا يوجد حتى الآن نظام خادم متكامل لمنع:

- spam comments
- spam confessions
- spam reactions
- spam reports

## البلاغات

increment_report يزيد reports_count.

لم يتم حتى الآن إنشاء نظام مستقل يضمن:
بلاغ واحد لكل مستخدم/جلسة على نفس الاعتراف.

يمكن تحسين ذلك مستقبلًا.

## RLS المكررة

كانت توجد سياسات كثيرة متكررة.

تم تنظيف السياسات الخطرة المفتوحة، لكن لا تزال بعض سياسات SELECT العامة المتكررة موجودة.

يمكن تنظيفها لاحقًا بحذر.

## reactions SELECT

القراءة العامة للتفاعلات موجودة حاليًا.

إذا كانت التفاعلات تعتبر بيانات عامة فهذا مقبول.

إذا أردنا خصوصية أكبر يجب تعديلها.

---

# 21. ملاحظات مهمة حول SECURITY DEFINER

الدالتان:

increment_report
remove_reaction

تستخدمان SECURITY DEFINER.

تم ضبط:

SET search_path TO public

ويجب الحفاظ على هذا الإعداد.

يجب عدم إعطاء المستخدمين صلاحيات مباشرة على الجداول الحساسة فقط لجعل وظائف الواجهة تعمل.

الأفضل استخدام RPC مع تحقق مناسب عندما تكون العملية تحتاج صلاحيات أعلى.

---

# 22. لا تغيّر RLS عشوائيًا

لا تتم إضافة:

UPDATE public
DELETE public
INSERT public مع with_check = true

لمجرد إصلاح زر في الواجهة.

قبل أي تغيير أمني:

1. فحص السياسة الحالية.
2. فهم وظيفة الكود.
3. تعديل أقل قدر ممكن.
4. اختبار العملية.
5. اختبار محاولة تجاوزها.
6. حفظ التغيير في Git.

---

# 23. الاختبارات التي تم تنفيذها

تم اختبار:

- UPDATE مباشر على confessions → مرفوض.
- increment_report RPC → يعمل.
- الإبلاغ من التطبيق → ظهر:
  "تم استقبال البلاغ، شكراً لك."
- فحص app.js بحثًا عن UPDATE/DELETE.
- فحص بنية reactions.
- فحص sessionId.
- فحص الأسرار.
- فحص RLS policies.
- فحص git diff.
- push إلى GitHub.

---

# 24. التقييم الحالي

المنصة أصبحت أفضل أمنيًا بشكل واضح من الحالة الأصلية.

مناسبة للإطلاق الأولي والاستخدام العام مع المراقبة.

لكن لا تعتبر حماية 100%.

أهم التحسينات المستقبلية:

1. Rate limiting
2. منع تكرار البلاغات
3. تحسين هوية الجلسة
4. مراجعة SECURITY DEFINER
5. تنظيف سياسات RLS المكررة
6. اختبار شامل لمحاولات تجاوز RLS
7. مراقبة أخطاء Supabase وسلوك الاستخدام

---

# 25. قاعدة ذهبية للمشروع

أي بيانات أو مفاتيح سرية حقيقية لا توضع في:

app.js
HTML
CSS
GitHub
localStorage

ولا يتم رفع service_role أو secret keys إلى المستودع.

---

# الحالة

آخر مرحلة ناجحة:

- Report RPC يعمل.
- Direct UPDATE مغلق.
- Direct DELETE العام مغلق.
- Reaction removal يستخدم RPC.
- التغييرات مرفوعة إلى GitHub.

