# متجر اتقان (Itqan Store) — وثيقة التسليم الكاملة (HANDOFF)

> هذا الملف يشرح المشروع بالكامل ليكمل أي مطوّر (أو محادثة جديدة) من حيث انتهينا.
> آخر تحديث: 2026-07-05. الحالة: مكتمل وشغّال (v7) — Firebase مربوط، بانتظار أن يلصق
> المالك إعداد Firebase الحقيقي ويدخل قطعه.

---

## 1) ما هو المشروع؟
متجر سعودي لبيع قطع الكمبيوتر والتجميعات الجاهزة، اسمه **اتقان (ITQAN)**.
جوهره **بنّاء تجميعات (PC Builder)** مع **محرك توافق ذكي** يفحص كل اختيار لحظيًا،
**مساعد ذكاء اصطناعي** يقترح تجميعات، و**تصدير الطلب عبر واتساب**. عربي/إنجليزي.

**التقنية (شرط صارم):** HTML + CSS + JavaScript خام فقط. **بدون** frameworks،
**بدون** npm/build tools. يفتح `index.html` مباشرة في المتصفح. Firebase عبر CDN (compat SDK).

**المسار:** `C:\Users\TechTroniX\Desktop\ittcan store` (الاسم بالضبط، فيه مسافة).

---

## 2) الهوية البصرية (v3+)
- **الألوان:** أبيض دافئ (عاجي) + برتقالي محروق (`#c2410c` فاتح / `#ffa245` داكن) + بني إسبريسو.
  الثيم **الفاتح افتراضي**، والداكن «إسبريسو» بني (مو كحلي). تبديل الثيم في الهيدر، يُحفظ بـ localStorage (`itqan-theme`).
- **الخطوط:** Space Grotesk (لاتيني) + IBM Plex Sans Arabic (عربي) + IBM Plex Mono (تسميات تقنية) — عبر Google Fonts.
- **الاتجاه العام:** تحريري، بطاقات أنيقة، حركات transform/opacity فقط 150–300ms، تحترم `prefers-reduced-motion`.
- الاتجاه اللي طلبه المستخدم لاحقًا: «احترافي جاد تقني» — طُبِّق على **لوحة الأدمن** (داشبورد رمادي/بني + برتقالي أكسنت). المتجر نفسه بقي بهوية v3 (أبيض/برتقالي/بني). **مهمة معلّقة محتملة:** تحويل المتجر لنفس الطابع الجاد لو طلب.

---

## 3) هيكل الملفات (كلها في مجلد المشروع)

| الملف | الأسطر | المسؤولية |
|-------|-------|-----------|
| `index.html` | 302 | هيكل المتجر: Hero، مميزات، البنّاء، خطوات، السلة، فوتر، ودجت المحادثة |
| `admin.html` | 484 | لوحة التحكم: شاشة دخول + داشبورد (شريط جانبي + جدول + نوافذ) |
| `style.css` | 1012 | نظام التصميم كامل (متغيرات CSS للثيمين). يستخدمه المتجر واللوحة |
| `i18n.js` | 329 | قواميس الترجمة عربي/إنجليزي (كل نصوص الواجهة + رسائل التوافق) |
| `firebase-config.js` | 21 | إعداد Firebase (placeholder — المالك يلصق config الحقيقي) |
| `firebase.js` | 47 | تهيئة Firebase المشتركة → `window.ItqanFB` (ready/init/db/auth/storage) |
| `settings.js` | 28 | إعدادات محلية افتراضية: whatsapp + ai + admin (fallback إن Firebase معطّل) |
| `inventory.js` | 531 | المخزون الخام المحلي (40 قطعة تجريبية) → `globalThis.ITQAN_INVENTORY` |
| `data.js` | 111 | **طبقة البيانات**: `getParts()` و `getSettings()` (Firebase أو محلي) + `normalizeInventory` + CATEGORY_META/ORDER |
| `compat.js` | 215 | **محرك التوافق** — نقي، بدون DOM، يرجع أكواد أسباب مهيكلة |
| `app.js` | 644 | واجهة المتجر: ثيم/لغة، البنّاء، السلة، تصدير واتساب، scroll-reveal |
| `chat.js` | 441 | مساعد AI — تجريد 3 مزوّدين (Gemini/OpenAI/Anthropic) |
| `admin.js` | 885 | لوحة التحكم: بوابة دخول، CRUD، Firebase read/write، Storage، seed |
| `tests/compat.test.js` | — | 20 اختبار Node لمحرك التوافق (`node tests/compat.test.js`) |
| `images/*.svg` | 8 | رسومات مؤقتة لكل فئة (بني/برتقالي). تُستبدل بصور حقيقية |
| `README.md` / `FIREBASE-SETUP.md` | — | التوثيق + دليل ربط Firebase خطوة بخطوة |
| `_preview/*.png` | — | لقطات شاشة تاريخية (يمكن حذفها) |

**ترتيب تحميل السكربتات (مهم):**
- index.html: firebase-app+database (CDN) → firebase-config → firebase → i18n → settings → inventory → data → compat → app → chat
- admin.html: firebase-app+database+auth+storage (CDN) → firebase-config → firebase → settings → inventory → data → admin

---

## 4) محرك التوافق (compat.js) — القلب
دالة `evaluatePart(part, category, selection)` ترجع `{compatible, reasons:[{code, params}]}`.
**مهم:** المحرك **language-agnostic** — يرجع أكواد فقط، والواجهة تترجمها عبر i18n. لا تُرجِع نصوصًا للمحرك.

**5 قواعد:**
1. سوكِت CPU = سوكِت اللوحة (AM4/AM5/LGA1700...).
2. نوع RAM = نوع اللوحة (DDR4/DDR5).
3. قدرة PSU ≥ (tdp المعالج + powerDraw الكرت + 100 واط أساس) × 1.2 هامش أمان.
4. الصندوق يدعم مقاس اللوحة (formFactorSupport يحتوي formFactor).
5. tdpSupport المبرد ≥ tdpWatts المعالج.

دوال أخرى: `powerBudget`, `evaluateCategory`, `suggestAlternatives` (أقرب سعرًا)، `buildSummary` (status: empty/ok/warning/conflict + msgCode/msgParams + totalPrice + conflicts).
مثال محسوب في الاختبارات: i7-14700K(253W)+RTX4080S(320W) → raw 673، required 808 → PSU 750W يُرفض، 850W يُقبل.

---

## 5) طبقة البيانات + Firebase
- `getParts()`: إن `ItqanFB.ready()` → يقرأ `inventory` من Realtime Database (+`normalizeInventory` لأن Firebase يسقط الأرايز الفارغة/يحوّلها object)، وإلا `structuredClone(PARTS_DB)` المحلي.
- `getSettings()`: مثلها من `settings` أو `ITQAN_SETTINGS` المحلي.
- **firebase.js** يوفّر `window.ItqanFB`: `ready()` (true فقط لو config حقيقي + SDK محمّل)، `db()/auth()/storage()`.
- **firebase-config.js**: يحوي placeholder (`XXXX`/`your-project`) = معطّل. المالك يلصق config من Firebase Console.

بنية قاعدة البيانات:
```
/inventory : { cpu:[...], motherboard:[...], ... }   (نفس شكل PARTS_DB)
/settings  : { whatsappPhone, ai:{provider,model,apiKey}, admin:{mode,user,passHash} }
```
Storage: `images/<partId>.<ext>` (روابط تنزيل تُخزَّن في part.image).

**قواعد الأمان (في FIREBASE-SETUP.md):** RTDB: `inventory`/`settings` قراءة عامة + كتابة `auth != null`. Storage مثلها.

---

## 6) لوحة التحكم (admin.js/admin.html)
داشبورد احترافي: **شريط جانبي** (فئات + عدّادات + «كل القطع») + **جدول بيانات** بأعمدة لكل مواصفة + بحث شامل + فرز (اسم/سعر) + إحصائيات (عدد/قيمة/صور/أوصاف ناقصة).
- **إضافة/تعديل**: نافذة نموذج، أول حقل **«نوع القطعة»** select — تبديله يعيد بناء حقول المواصفات تلقائيًا (`renderDynFields`). في التعديل النوع مقفل. السوكت select يبيّن كل الأنواع (`SOCKETS`).
- **نسخ قطعة** (duplicate) + حذف.
- **وضعان:** `fbMode = ItqanFB.ready()`:
  - **Firebase**: كتابة لـ`ref('inventory').set(db)`، الصور لـ Storage، إعدادات لـ`ref('settings')`. زر **seed** يرفع المحلي للسحابة أول مرة.
  - **محلي**: File System Access API (زر «اربط مجلد المشروع») يكتب `inventory.js`/`settings.js` والصور لمجلد images/. أو زر تنزيل.
- **إعدادات المتجر** (نافذة): رقم واتساب + مزوّد AI + موديل + مفتاح + تحذير أمني.

### بوابة الدخول (app-level، ليست Firebase Auth الرسمي)
- الافتراضي **123 / 123**. `settings.admin = { mode, user, passHash(sha256) }`.
- **الأوضاع:** `mode: 'user'` (مستخدم+كلمة مرور) أو `'code'` (كود/PIN فقط — يخفي حقل المستخدم من الدخول والنموذج).
- التغيير من زر **«🔑 بيانات الدخول»** (نافذة credsDialog فيها مفتاح segmented للوضع).
- عند نجاح الدخول في fbMode: `signInAnonymously()` عشان الكتابة تمر تحت قاعدة `auth != null` → **لازم تفعيل Anonymous في Firebase Authentication** (مو Email/Password).
- التحقق يقارن sha256(المدخل) مع passHash. crypto.subtle يعمل على file:// (secure context).

**⚠️ الحماية خفيفة** (نموذج): passHash قراءته عامة، sha256 بلا salt، anonymous يسمح نظريًا لأي أحد بالكتابة. الحل القوي = Firebase Auth Email/Password (كان مبنيًا وأُستبدِل بطلب المستخدم؛ يمكن إرجاعه).

---

## 7) مساعد الذكاء الاصطناعي (chat.js)
ودجت محادثة عائم، ثنائي اللغة. **يُضبط من لوحة الأدمن** (settings.ai)، يعمل لكل الزوار.
- **3 مزوّدين** (تجريد `PROVIDERS`): 
  - `gemini` — `gemini-2.0-flash`/`2.5-flash` (contents+systemInstruction، roles user/model)
  - `openai` — `gpt-4o-mini`/`gpt-4o`/`gpt-4.1-mini` (Bearer، رسالة system، role model→assistant)
  - `anthropic` — `claude-haiku-4-5`/`claude-sonnet-5`/`claude-opus-4-8` (endpoint v1/messages، ترويسات x-api-key + anthropic-version:2023-06-01 + **anthropic-dangerous-direct-browser-access:true**، **بدون temperature** لأنها ترفض 400 على opus/sonnet5)
- المخزون يُحقن في system prompt كل مرة، والمساعد يرشّح من المخزون فقط.
- التجميعة المقترحة تصل كـ ```json {"build":{cpu:"id",...}}``` → تُفحص بمحرك التوافق → زر «تطبيق» عبر `window.ItqanApp.applyBuild()`.
- `getAIConfig()`: مفتاح admin (من ItqanApp.getSettings) أولاً؛ وإلا fallback لكل زائر يُدخل مفتاحه (localStorage `itqan-ai-key`).
- ⚠️ المفتاح في settings عام (موقع بلا خادم). الحل الآمن = Cloud Function وسيط.

---

## 8) الأوامر والاختبار
- الاختبارات: `node tests/compat.test.js` → يجب 20 passed.
- فحص الصياغة: `node --check <file>.js`.
- لقطات الشاشة (headless Edge):
  `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 --window-size=1440,2900 --screenshot="...png" "file:///C:/Users/TechTroniX/Desktop/ittcan%20store/index.html"`
- فحص كونسول: أضف `--enable-logging=stderr --dump-dom` وابحث عن console.*error (استثنِ gpu/voice/ProtocolLaunch).
- لمحاكاة وضع Firebase محليًا: احقن stub لـ `globalThis.ItqanFB` قبل admin.js.

---

## 9) ما تبقّى على المالك / المرحلة القادمة
1. **إدخال الـ100+ قطعة**: عبر admin.html (بعد ربط Firebase أو محليًا).
2. **ربط Firebase**: الصق config في `firebase-config.js`، فعّل **Anonymous** + Realtime DB + Storage، انشر قواعد الأمان (FIREBASE-SETUP.md)، ادخل بـ123/123، اضغط seed.
3. **رقم الواتساب + مزوّد/مفتاح AI**: من «إعدادات المتجر» في اللوحة.
4. **الاستضافة**: Firebase Hosting أو GitHub Pages (file:// قد يمنع بعض ميزات Firebase).
5. **صور المنتجات الحقيقية**: ترفع من نموذج الإضافة (Storage) أو تستبدل SVG.
6. **تحسينات أمنية مقترحة**: Cloud Function يخفي مفتاح AI + حماية كتابة حقيقية (بدل anonymous)؛ أو إرجاع Firebase Auth Email/Password.

---

## 10) قرارات مهمة اتُّخذت (سياق)
- المستخدم يفضّل: بناء كامل من الوكيل + هو يلصق الأسرار/الإعداد.
- رفض «شكل AI» مبكرًا → إعادة تصميم لهوية دافئة مميزة.
- اختار أبيض+برتقالي+بني، ثم «احترافي جاد» للوحة.
- اختار Firebase مع config جاهز عنده + حماية بتسجيل دخول.
- طلب دخول بسيط 123/123 قابل للتغيير + خيار كود/PIN (لذلك app-gate + anonymous بدل Email/Password).
- كل الحوار بالعربي (لهجة سعودية). النصوص في المتجر ثنائية اللغة.
