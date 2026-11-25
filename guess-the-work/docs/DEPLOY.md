# النشر على Vercel من الجوال (بدون ترمنال)

كل شي جاهز في المستودع: `vercel.json`، وأمر البناء، والـ migrations، واستيراد المكتبة (5,106 عمل) يصير تلقائياً وقت البناء.

## اللي تحتاجه
- حساب Vercel مربوط بحساب GitHub اللي فيه المستودع `axrzw/apready`.
- الشغل كله على الفرع **`claude/relaxed-carson-dvd3d8`**.

## الخطوات (بالترتيب)

### 1) أنشئ المشروع
1. افتح **vercel.com** من متصفح الجوال وسجّل دخول.
2. اضغط **Add New…** ثم **Project**.
3. اختر المستودع **`axrzw/apready`** واضغط **Import**. (إذا ما طلع، اضغط **Adjust GitHub App Permissions** وأعطه صلاحية المستودع.)
4. في صفحة الإعداد:
   - **Project Name:** `khammin` (أو أي اسم).
   - **Framework Preset:** Next.js (يطلع لحاله).
   - **Root Directory:** خلّه على الجذر (`apready`، root). `vercel.json` اللي في جذر المستودع يبني «خمّن العمل» من مجلد `guess-the-work/`.
   - **Build and Output Settings:** لا تغيّر شي. الأوامر مكتوبة في `vercel.json`.
5. افتح **Environment Variables** وأضف هذي (Name ثم Value ثم Add):

| Name | Value | ليش |
|---|---|---|
| `GROUP_PASSWORD` | `lD23gstg8VlUUzqR` | كلمة سر القروب (غيّرها إذا تبي) |
| `ADMIN_PASSWORD` | `rEXcm05j9MSQc9uT` | الدخول بها يعطيك صلاحية الأدمن |
| `CRON_SECRET` | `5744e5e5f22a23cab06113ac5740460420eba31891e7cae4` | يحمي المهمة الأسبوعية |

6. **لا تضغط Deploy للحين.** اضغط **Deploy** بعد الخطوة 2 تحت. (إذا ضغطته بالغلط، عادي: أول بناء يفشل أو يطلع الموقع برسالة «قاعدة البيانات مو موصولة»، وتعيد النشر بعد الخطوة 2.)

### 2) قاعدة البيانات والتخزين (ضغطتين لكل واحد)
1. من صفحة المشروع افتح تبويب **Storage**.
2. اضغط **Create Database** واختر **Neon (Serverless Postgres)**، ثم **Continue**، ثم اختر الخطة المجانية والمنطقة الأقرب (مثلاً Frankfurt)، ثم **Create**، ثم **Connect** للمشروع (كل البيئات: Production وPreview وDevelopment). هذا يضيف `DATABASE_URL` لحاله.
3. ارجع لـ **Storage** واضغط **Create Database** مرة ثانية واختر **Blob**، ثم **Create**، ثم **Connect**. هذا يضيف `BLOB_READ_WRITE_TOKEN` لحاله.

### 3) الفرع
كل شي على `main`، فما تحتاج تغيّر أي شي.

### 4) انشر
1. افتح تبويب **Deployments** ثم آخر نشر، ثم **⋯** ثم **Redeploy**. (أو اضغط **Deploy** إذا ما نشرت قبل.)
2. البناء ياخذ تقريباً 3–5 دقائق: يثبت الحزم، ثم يشغّل الـ migrations على Neon، ثم يستورد المكتبة، ثم يبني الموقع.
3. افتح الرابط (`https://khammin.vercel.app` أو اللي يعطيك Vercel)، وادخل بكلمة سر الأدمن عشان تكون أدمن، ثم أعطِ الشباب كلمة سر القروب.

## مفاتيح اختيارية (المسلسلات والأفلام والألعاب)
أضفها في **Settings** ثم **Environment Variables**، ثم أعد النشر. بعدها من **الأدمن** ← **المصادر** اضغط **اسحب الحين** للمصدر. كل دفعة تاخذ تقريباً 40 ثانية، والصفحة تكمل لحالها لين يخلص، ولو قفلت الصفحة يكمل من حيث وقف.

| Name | من وين | يفعّل |
|---|---|---|
| `TMDB_API_KEY` | themoviedb.org ← Settings ← API (أي نوع: API Key أو Read Access Token) | الأفلام، والمسلسلات الغربية، والدراما الكورية والصينية واليابانية والتايلندية |
| `TWITCH_CLIENT_ID` | dev.twitch.tv/console/apps ← Register Your Application (Redirect: `http://localhost`، Category: Application Integration) | الألعاب (IGDB) |
| `TWITCH_CLIENT_SECRET` | نفس الصفحة ← New Secret | الألعاب (IGDB) |
| `MAL_CLIENT_ID` | myanimelist.net/apiconfig | استيراد قوائم MAL (اختياري) |

المصادر اللي تنقصها مفاتيح تبين في لوحة الأدمن مع اسم المتغير المطلوب بالضبط، وما تسبب أي خطأ.

## المهمة الأسبوعية
مسجلة في `vercel.json` (كل اثنين الساعة 3 الفجر UTC). تسحب الموسم الحالي، ثم دفعة من كل مصدر مفعّل (عينة AniList فيها تركيز على المظلوم والمغمور). ما تحتاج تسوي شي.

## الأغاني والمقاطع
- **الأوبننق والإندنق:** من الأدمن ← المصادر ← **AnimeThemes** ← اسحب الحين. الصوت يتقص ويتعالج عند أول طلب (ffmpeg على Vercel) ويتخزن في Blob.
- **الأوست والمشاهد:** من الأدمن ← **أوستات ومشاهد**، بإعطاء رابط ملف مباشر وتوقيت البداية والنهاية. روابط يوتيوب تشتغل محلياً بس (yt-dlp ما يشتغل على Vercel).

## نسخ احتياطي
على جهاز فيه المستودع: `DATABASE_URL=<رابط Neon> pnpm backup` يكتب ملف في `data/backups/`، و`DATABASE_URL=... pnpm restore <الملف>` يرجعه. وNeon نفسه يحتفظ بنسخ تلقائية (Point-in-time restore) في لوحته.

## لو صار شي
- **رسالة «قاعدة البيانات مو موصولة»:** سوّ الخطوة 2، ثم Redeploy.
- **رسالة «الموقع ما له كلمة سر»:** أضف `GROUP_PASSWORD`، ثم Redeploy.
- **فشل البناء عند `db:setup`:** تأكد إن Neon موصول بالبيئة اللي تنشر لها (Production وPreview).
