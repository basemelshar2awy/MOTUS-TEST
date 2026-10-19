MOTUS FLEET - نشر على Windows Server 2022 (عربي)
================================================
الدومين: motus.sabeelbus.com   موقع IIS: motus (رقم 29)   المجلد: C:\Website\Motus   التطبيق: Node.js على 127.0.0.1:3000 فقط

المطلوب قبل البدء
  1. Windows Server 2022 x64 وحساب Administrator.
  2. IIS مع وحدتي "URL Rewrite" و "Application Request Routing (ARR)".
  3. موقع IIS باسم motus مساره الفعلي C:\Website\Motus\iis وبه ربط motus.sabeelbus.com على HTTP 80 و HTTPS 443 (SNI).
     ربط HTTPS لازم يستخدم شهادة تغطي motus.sabeelbus.com (الشهادة غير مرفقة في الحزمة عمداً). المواقع الأخرى لا تُمس أبداً.
  4. اتصال إنترنت من السيرفر إلى nodejs.org و get.enterprisedb.com (لتنزيل Node.js و PostgreSQL) أو نسخ المثبّتات يدوياً
     (انظر "بدون إنترنت"). مساحة حرة حوالي 3 جيجا.
  5. حوالي 20 دقيقة. لا تحتاج معرفة بـ PostgreSQL أو Node.js أو npm، ولا تشغّل "npm install" ولا "npm run build".

التثبيت (خطوة واحدة)
  1. فك الضغط بحيث يوجد الملف:  C:\Website\Motus\app\server.js  (وكذلك C:\Website\Motus\Install-Motus.cmd).
  2. كليك يمين على  Install-Motus.cmd  ثم  Run as administrator.
  3. أجب على الأسئلة القليلة (بريد واسم أول مدير؛ واختيارياً أول شركة).
  4. انتظر ظهور "MOTUS is installed and verified". لو فشلت خطوة سيتوقف ويشرح بلغة بسيطة ماذا تفعل، ثم شغّل
     Install-Motus.cmd مرة أخرى؛ يكمل بأمان ولا يغيّر كلمات المرور أو البيانات الموجودة.
  5. افتح C:\Website\Motus\config\initial-credentials.txt وادخل على https://motus.sabeelbus.com واختر كلمة مرور جديدة
     عند الطلب، ثم احذف هذا الملف.
  سجلات كل خطوة: C:\Website\Motus\logs\

ماذا يفعل المثبّت (يمكن تشغيل كل خطوة منفردة كـ Administrator)
  1-Install-Prerequisites.ps1  ينزّل Node.js 22 LTS من nodejs.org ويتحقق من SHA-256 مقابل SHASUMS256.txt الرسمي ومن التوقيع الرقمي
                               (OpenJS Foundation) ويفكّه في runtime\node. يكتشف PostgreSQL (14 أو أحدث)؛ لو غير موجود ينزّل مثبّت
                               EnterpriseDB لأحدث 16.x ويتحقق من توقيعه ويثبّته بصمت ويضبط الخدمة تلقائية. كلمة مرور postgres
                               تُولَّد وتُحفظ في config\postgres-superuser.txt (بصلاحيات مقيّدة).
  2-Setup-Database.ps1         ينشئ قاعدة motus والمستخدمين motus_owner (الترحيلات والنسخ الاحتياطي) و motus_app (التطبيق، لا يتجاوز الأمان)
                               بكلمات مرور عشوائية قوية، ويكتب config\motus.env (يقرأه فقط Administrators و SYSTEM و LOCAL SERVICE)،
                               ويشغّل الترحيلات وينشئ أول مدير.
  3-Configure-IIS.ps1          يفحص IIS و URL Rewrite و ARR (تفعيل ARR proxy إعداد عام للسيرفر: يسألك أولاً أو استخدم -EnableArrProxy)
                               ومسار الموقع والربط وأن الشهادة تغطي motus.sabeelbus.com، ويختبر التحويل وملف التحقق. يفحص موقع motus فقط.
  4-Install-AutoStart.ps1      مهام مجدولة: Motus-App (تعمل عند الإقلاع وتعيد التشغيل بعد أي توقف وتراقب /healthz) و
                               Motus-Backup (كل ليلة 02:30 وتحتفظ بـ 14 نسخة في backups\).
  5-Verify-Deployment.ps1      فحص تلقائي: الاتصال بقاعدة البيانات، حالة الترحيلات، دخول المدير، إنشاء/قراءة/تعديل فعلي (على قاعدة مؤقتة،
                               بياناتك لا تتغير)، عزل الشركات، بقاء البيانات بعد إعادة تشغيل التطبيق، أن المنفذ 3000 على 127.0.0.1 فقط،
                               تحويل HTTP إلى HTTPS، الشهادة.

متغيرات البيئة (الملف config\motus.env - يُنشأ لك؛ القالب: config\motus.env.example)
  MOTUS_HOST=127.0.0.1  MOTUS_PORT=3000  PUBLIC_ORIGIN=https://motus.sabeelbus.com  MOTUS_TRUST_PROXY=1
  PGHOST PGPORT PGDATABASE  MOTUS_DB_APP_USER/PASSWORD  MOTUS_DB_OWNER_USER/PASSWORD
  MOTUS_CREDENTIALS_KEY (64 حرف hex؛ يشفّر بيانات اعتماد المزودين - لا تغيّره ولا تفقده أبداً)
  MOTUS_TIMEZONE=Africa/Cairo  MOTUS_LOG_LEVEL=info  MOTUS_SESSION_HOURS=12  MOTUS_SESSION_IDLE_MINUTES=120
  لا تنسخ هذا الملف إلى مجلد iis ولا ترسله بالبريد.

أوامر الترحيل (لو أردت تشغيلها يدوياً؛ المثبّت والتحديث يفعلان ذلك تلقائياً)
  set MOTUS_ROOT=C:\Website\Motus
  set MOTUS_CONFIG=C:\Website\Motus\config\motus.env
  C:\Website\Motus\runtime\node\node.exe C:\Website\Motus\app\server\tools\migrate.js --status
  C:\Website\Motus\runtime\node\node.exe C:\Website\Motus\app\server\tools\migrate.js
أول مدير يدوياً:  ...\node.exe ...\app\server\tools\create-admin.js --email you@example.com --name "Your Name" --generate

اختبار 1 - على السيرفر نفسه (التطبيق فقط)
  افتح المتصفح على السيرفر: http://127.0.0.1:3000 (صفحة الدخول) و http://127.0.0.1:3000/healthz -> {"ok":true,...}
  أو شغّل Verify-Motus.cmd (كـ Administrator).

اختبار 2 - IIS والدومين
  من السيرفر: http://motus.sabeelbus.com يجب أن يحوّل إلى https://motus.sabeelbus.com وتظهر صفحة الدخول.
  من جهاز آخر: https://motus.sabeelbus.com (الـ DNS يشير إلى 45.85.147.186 والمنفذان 80 و 443 مفتوحان في الجدار الناري).

اختبار 3 - HTTPS
  اضغط على القفل في المتصفح: الشهادة صادرة لـ motus.sabeelbus.com وغير منتهية.
  Verify-Motus.cmd يفحص نفس الشيء من السيرفر ويعطي PASS/FAIL لكل بند.

التشغيل اليومي
  Start-Motus.cmd / Stop-Motus.cmd / Restart-Motus.cmd (كـ Administrator). بعد إعادة تشغيل السيرفر يعمل MOTUS تلقائياً، وبعد أي توقف يُعاد تشغيله خلال ثوانٍ.
  Backup-Motus.cmd ينشئ نسخة احتياطية الآن. النسخ الليلية في C:\Website\Motus\backups. انسخها لجهاز آخر بانتظام.
  الاسترجاع:  powershell -ExecutionPolicy Bypass -File Restore-Database.ps1 -File C:\Website\Motus\backups\<file>.dump  (يستبدل كل البيانات؛ يطلب كتابة RESTORE)
  اختبار أن الاسترجاع يعمل:  powershell -ExecutionPolicy Bypass -File Test-BackupRestore.ps1  (ينسخ ثم يسترجع ويقارن عدد الصفوف)
  نسيت كلمة مرور المدير:  Reset-Password.cmd  (يطبع كلمة مؤقتة مرة واحدة)
  السجلات: logs\motus-*.log (التطبيق) و logs\supervisor.log و logs\node-err.log و logs\install-*.log

التحديث لنسخة جديدة (يحافظ على قاعدة البيانات وكلمات المرور والإعدادات)
  1. فك ضغط الحزمة الجديدة في مجلد مؤقت مثل C:\Temp\Motus-new (وليس فوق C:\Website\Motus).
  2. كـ Administrator في PowerShell:
        cd C:\Website\Motus
        powershell -ExecutionPolicy Bypass -File .\Update-Motus.ps1 -NewPackage C:\Temp\Motus-new
  السكربت ينسخ قاعدة البيانات احتياطياً ويبدّل التطبيق (القديم يبقى باسم app.previous) ويطبّق الترحيلات ويشغّل النسخة الجديدة
  ويتحقق منها، ولو فشل أي شيء يعيد النسخة القديمة تلقائياً.

التراجع
  powershell -ExecutionPolicy Bypass -File .\Rollback-Motus.ps1                   (ملفات التطبيق فقط)
  powershell -ExecutionPolicy Bypass -File .\Rollback-Motus.ps1 -RestoreDatabase  (ويسترجع أيضاً نسخة ما قبل التحديث؛ البيانات المدخلة بعد التحديث تضيع)

بدون إنترنت على السيرفر
  نزّل على جهاز آخر: Node.js 22 LTS "win-x64.zip" من nodejs.org (وانسخ قيمة SHA-256 له من SHASUMS256.txt في نفس الموقع)، ومثبّت
  PostgreSQL 16 لويندوز من postgresql.org (EnterpriseDB). انسخهما للسيرفر وشغّل كـ Administrator:
    powershell -ExecutionPolicy Bypass -File 1-Install-Prerequisites.ps1 -NodeZip C:\Temp\node-v22.x.y-win-x64.zip -NodeSha256 <sha256> -PostgresInstaller C:\Temp\postgresql-16.x-windows-x64.exe
  ثم شغّل Install-Motus.cmd (يكتشف ما تم تثبيته).

غير موجود في الحزمة (عمداً) وماذا تفعل
  * node.exe ومثبّت PostgreSQL: تنزّلهما الخطوة 1 وتتحقق منهما (لم يكن ممكناً تنزيلهما في بيئة بناء الحزمة).
  * شهادة TLS والمفتاح الخاص: احصل على شهادة لـ motus.sabeelbus.com (win-acme/Let's Encrypt أو جهة إصدار) واربطها في IIS.
  * كلمات المرور والمفاتيح: تُولَّد على سيرفرك في الخطوة 2 وتوجد فقط في config\.
  * الربط مع مزودين خارجيين (GPS، كروت الوقود والطرق، ERP، SMS/WhatsApp، الفاتورة الإلكترونية، نموذج ذكاء اصطناعي): التطبيق به نموذج البيانات
    وواجهات API وwebhooks؛ كل مزود يحتاج بيانات اعتماده تُدخل من الإعدادات.

حل المشاكل
  "الموقع يعطي 502/503": شغّل Verify-Motus.cmd؛ راجع Start-Motus.cmd و logs\node-err.log (هل PostgreSQL يعمل؟ كلمة المرور في config\motus.env؟).
  "المنفذ 3000 مستخدم": برنامج آخر يستخدمه؛ أوقفه، MOTUS يجب أن يعمل على 127.0.0.1:3000.
  "الدخول يعمل على السيرفر ولا يعمل من الدومين": PUBLIC_ORIGIN في config\motus.env لازم يكون بالضبط https://motus.sabeelbus.com ثم أعد تشغيل MOTUS.
  "تحذير شهادة": الشهادة لا تغطي الاسم أو منتهية - شغّل 3-Configure-IIS.ps1 واقرأ الرسالة.
