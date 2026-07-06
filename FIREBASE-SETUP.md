# ربط متجر اتقان بـ Firebase — دليل خطوة بخطوة

الموقع يعمل بدون Firebase (يقرأ من `inventory.js` و `settings.js`). لتفعيل السحابة
اتبع الخطوات التالية مرة واحدة.

---

## 1) أنشئ مشروع Firebase
1. افتح <https://console.firebase.google.com> → **Add project** → اختر اسمًا (مثلاً `itqan-store`).
2. تجاوز Google Analytics (اختياري) → **Create project**.

## 2) فعّل الخدمات الثلاث

### أ) Realtime Database (المخزون + الإعدادات)
- من القائمة الجانبية: **Build → Realtime Database → Create Database**.
- اختر المنطقة (مثلاً `europe-west1`) → ابدأ بوضع **locked mode** (سنضع القواعد لاحقًا).

### ب) Authentication (للسماح بالكتابة للمشرف)
- **Build → Authentication → Get started**.
- من تبويب **Sign-in method** فعّل **Anonymous** (تسجيل مجهول).
  > لوحة الأدمن تستخدم بوابة دخول بسيطة (مستخدم/كلمة مرور) داخل الموقع، والافتراضي
  > **123 / 123** — تقدر تغيّره من زر «🔑 بيانات الدخول» داخل اللوحة. تفعيل Anonymous
  > يمنح صلاحية الكتابة في قاعدة البيانات بعد الدخول.

### ج) Storage (صور المنتجات)
- **Build → Storage → Get started** → اقبل الوضع الافتراضي (سنضع القواعد لاحقًا).

## 3) انسخ إعداد الويب إلى `firebase-config.js`
1. **⚙️ Project settings → General**، انزل إلى **Your apps** → اضغط **</>** (Web).
2. سمِّ التطبيق (مثلاً `itqan-web`) → **Register app**.
3. انسخ كائن `firebaseConfig` والصقه في ملف `firebase-config.js` بدل القيم الافتراضية.
   تأكد أن `databaseURL` موجود (إن لم يظهر، انسخه من صفحة Realtime Database — يشبه
   `https://itqan-store-default-rtdb.firebaseio.com`).

## 4) ضع قواعد الأمان (قراءة عامة، كتابة للمشرف فقط)

### Realtime Database → Rules
> ⚠️ قاعدة البيانات `imam-warsh` **مشتركة مع مشروع آخر لك**. لذلك بيانات المتجر
> معزولة تحت مسار `itqan/` حتى لا تتضارب. لا تنشر قواعد تقفل بقية المسارات وإلا
> تتعطّل مشاريعك الأخرى — أضف قاعدة `itqan` فقط إلى قواعدك الحالية:
```json
{
  "rules": {
    "itqan": {
      "inventory": { ".read": true, ".write": "auth != null" },
      "settings":  { ".read": true, ".write": "auth != null" }
    }
  }
}
```

### Storage → Rules
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{file} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```
اضغط **Publish** في كلا المكانين.

## 5) ارفع بياناتك الحالية
1. افتح `admin.html` في المتصفح → ستظهر شاشة **تسجيل دخول المشرف**.
2. سجّل الدخول بالافتراضي **123 / 123** (غيّرهما لاحقًا من زر «🔑 بيانات الدخول»).
3. من الشريط الجانبي اضغط **«⬆︎ رفع البيانات المحلية إلى Firebase»** — تُرفع الـ40 قطعة
   التجريبية والإعدادات دفعة واحدة (تقدر تحذفها وتضيف قطعك الحقيقية بعدها).
4. من الآن كل إضافة/تعديل/حذف يُحفظ في Firebase مباشرة، والصور تُرفع إلى Storage.

## 6) شغّل المتجر
افتح `index.html` — سيقرأ المخزون والإعدادات من Firebase تلقائيًا. أي زائر يرى نفس البيانات المحدّثة.

---

## ملاحظات مهمة
- **مستوى الحماية**: بوابة الدخول (123/123) بسيطة ومناسبة للنموذج، وليست بقوة الحسابات
  الحقيقية — لأن التحقق يتم في المتصفح وقواعد الكتابة تعتمد تسجيلًا مجهولًا. للحماية
  القوية (حساب لكل مشرف) استخدم Firebase Auth بالبريد/كلمة المرور — أقدر أرجّعها لك.
- **الاستضافة**: لكي يعمل عند الجميع، ارفع الملفات على استضافة (Firebase Hosting، GitHub Pages...).
  محليًا عبر `file://` قد يمنع تسجيل الدخول أحيانًا — استخدم استضافة أو `localhost`.
  (Firebase Hosting: ثبّت `npm i -g firebase-tools` ثم `firebase init hosting` و `firebase deploy`.)
- **مفتاح الـAI**: **لا يُحفظ في Firebase إطلاقًا** — يبقى سريًّا على الخادم الوسيط
  (Cloudflare Worker). طريقة الإعداد في [`WORKER-SETUP.md`](WORKER-SETUP.md).
- **العودة للوضع المحلي**: أعِد `firebase-config.js` لقيمه الافتراضية (XXXX) ليعمل الموقع
  من الملفات المحلية بدون Firebase.
