# راهنمای انتشار — راست‌چین هوشمند نور

> **برای GitHub سازمان نور:** نشانی `/orgs/Noor-CRCIS/dashboard` صفحهٔ مدیریت خصوصی سازمان است، نه مخزن پروژه. مخزن پیشنهادی [`Noor-CRCIS/rtl-copilot`](https://github.com/Noor-CRCIS/rtl-copilot) باید توسط فرد مجاز ساخته شود؛ تا آن زمان پیوندهای مخزن ممکن است 404 باشند. پوشهٔ `latest/` هنوز مخزن Git نیست و این تغییرات push نشده‌اند.

## آماده‌سازی مخزن سازمان

1. مخزن `rtl-copilot` را با visibility مورد نظر (Public برای دسترسی عمومی) در سازمان `Noor-CRCIS` بدون README/License خودکار بسازید.
2. **همین پوشهٔ `latest/`** را ریشهٔ مخزن قرار دهید. فایل‌های `node_modules/`، `download/`، `okVersion/`، `rtl-copilot/`، `*.vsix` و اطلاعات محرمانه را وارد Git نکنید؛ `.gitignore` موارد ساختنی را کنار می‌گذارد. پیش از انتشار تاریخچه و مجوزها را بازبینی کنید.
3. شناسهٔ `publisher: Noor-CRCIS` در `package.json` باید با Publisher انتخاب‌شده در VS Code Marketplace یکسان باشد. برای انتشار، حساب Publisher با همین شناسه و مجوز انتشار لازم است؛ شناسهٔ Publisher با نام سازمان GitHub یکی نیست مگر اینکه خودتان آن را چنین انتخاب کنید.

## CI و انتشار GitHub

گردش‌کار واقعی در [`.github/workflows/extension.yml`](.github/workflows/extension.yml) تعریف شده است: روی `main` و pull request آزمون و بسته‌بندی اجرا می‌شود، و با push کردن tag منطبق با نسخهٔ `package.json` (مثلاً `v2.9.15`) پس از آزمون‌ها، VSIX و `SHA256SUMS` در GitHub Release منتشر می‌شوند. انتشار Marketplace خودکار نیست. دسترسی GitHub Actions برای ساخت Release باید در سازمان مجاز باشد؛ برای محیط `github-release` بازبین لازم تعیین کنید و ایجاد tagهای `v*` را محدود کنید.

این افزونه فایل‌های داخلی VS Code را تغییر می‌دهد؛ محدودیت‌ها و هشدارهای یکپارچگی README را بررسی کنید. برای بسته‌بندی محلی با Node.js 22 از `npm ci`، `npm test` و `npm run package` استفاده کنید. `apply_patch.py` ابزار مستقل است و در Git می‌ماند اما در VSIX گنجانده نمی‌شود. انتشار Marketplace فرآیندی جداگانه است؛ راهنمای رسمی: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). توکن‌ها را در مخزن قرار ندهید.

جزئیات قدیمی انتشار را با گردش‌کار واقعی بالا تطبیق دهید؛ GitHub و Marketplace دو انتشار جداگانه‌اند.

مرجع رسمی: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

---

## ۱) فهرست فایل‌های لازم

| فایل | وضعیت |
|---|:---:|
| `package.json` (متادیتا: publisher، repository، badges، keywords) | ✅ موجود |
| `README.md` (به‌عنوان توضیحات Marketplace) | ✅ موجود |
| `CHANGELOG.md` | ✅ موجود |
| `LICENSE` | ✅ موجود (MIT) |
| `icon.png` | ✅ موجود |
| `.vscodeignore` | ✅ موجود |
| `.github/workflows/extension.yml` (CI و GitHub Release) | ✅ موجود |

> `vsce package` فایل `README.md` ریشه را به‌عنوان توضیحات افزونه می‌خواند.

---

## ۲) پیش‌نیازها

Node.js 22 و npm کافی است؛ `@vscode/vsce` از lockfile پروژه نصب می‌شود.

- دسترسی مجاز به سازمان GitHub `Noor-CRCIS` و مخزن `rtl-copilot`
- برای انتشار **اختیاری** در Marketplace، حساب Publisher با شناسهٔ `Noor-CRCIS` و مجوز انتشار باید پیشاپیش آماده باشد؛ صرف داشتن دسترسی سازمان GitHub کافی نیست. اگر نسخه‌ای با Publisher دیگری قبلاً منتشر شده، تغییر شناسه افزونه را به‌صورت یک شناسهٔ Marketplace جداگانه ایجاد می‌کند؛ برای حفظ همان فهرست انتشار، ابتدا انتقال رسمی Publisher را پیگیری کنید.

---

## ۳) ساخت VSIX

```bash
npm ci
npm test              # engine + native direction + comment/input + documentation rendering
npm run package       # خروجی: rtl-copilot-2.9.18.vsix
```

مستقیم:

```bash
./node_modules/.bin/vsce package --no-dependencies --allow-missing-repository
```

بررسی محتوای VSIX (باید `node_modules` و تست‌ها داخل بسته نباشند):

```bash
unzip -l rtl-copilot-2.9.18.vsix
```

---

## ۴) انتشار در VS Code Marketplace

```bash
# پس از تأیید مالکیت Publisher و دریافت توکن طبق راهنمای رسمی:
npx vsce publish --no-dependencies --allow-missing-repository
```

پس از انتشار اولیه، در Marketplace **تأیید دستی** (review) ممکن است لازم باشد؛ به‌ویژه برای افزونه‌هایی که فایل‌های VS Code را تغییر می‌دهند.

---

## ۵) انتشار در Open VSX (اختیاری)

برای Open VSX از [راهنمای رسمی](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions) استفاده کنید و توکن را در تاریخچهٔ shell یا مخزن قرار ندهید.

> `publisher` در Open VSX باید یک نام ثبت‌شده باشد و ممکن است با Marketplace متفاوت باشد؛ قبل از انتشار آن را با مالک مربوط تأیید کنید.

---

## ۶) انتشار فایل VSIX در GitHub Releases

بعد از ادغام تغییرات در `main` و تأیید نسخهٔ `package.json`، tag `v2.9.18` را روی commit موردنظر بسازید و push کنید. گردش‌کار پس از تست، VSIX را می‌سازد و SHA-256 آن را به‌همراه فایل VSIX در Release قرار می‌دهد.

یا دستی از https://github.com/Noor-CRCIS/rtl-copilot/releases :

1. `Draft a new release` → tag `v2.9.18` (تنها اگر انتشار خودکار tag را استفاده نمی‌کنید)
2. آپلود `rtl-copilot-2.9.18.vsix`
3. ثبت SHA-256 در body ریلیز

---

## ۷) خودکارسازی انتشار با GitHub Actions

گردش‌کار `.github/workflows/extension.yml` اجرا و بسته‌بندی را انجام می‌دهد؛ فقط tag منطبق با نسخه، Release گیتهاب تولید می‌کند. کلید انتشار Marketplace در آن استفاده نمی‌شود.

---

## ۸) چک‌لیست نهایی پیش از کلیک «Publish»

- [ ] `npm test` سبز است (آزمون موتور و کنترل دستی ادیتور)
- [ ] `display name` و `description` خوانا و فارسی هستند
- [ ] `README.md` شامل نصب، امکانات، مجوز و تبلیغ محصولات نور است
- [ ] `icon.png` (128×128 یا بیشتر) موجود است
- [ ] `LICENSE` (MIT) وجود دارد
- [ ] `repository` و `bugs.url` به GitHub اشاره می‌کنند
- [ ] `publisher` در Marketplace معتبر است
- [ ] `.vscodeignore` فایل‌های اضافی را رد کرده است (node_modules، تست، فایلهای قدیمی)
- [ ] نسخهٔ `.vsix` ساخته‌شده با source هم‌خوان است

---

<div dir="rtl">

## ⚠️ نکتهٔ مهم در مورد مرور Marketplace

چون این افزونه فایل‌های داخلی Workbench را با یک پچ امن تغییر می‌دهد و checksum را به‌صورت انتخابی بازسازی می‌کند، ممکن است در فرایند تأیید Marketplace سؤال شوند. در توضیحات:

- به بخش «پشتیبانی یکپارچگی» در README ارجاع دهید
- تأیید کنید که integrity غیرفعال نمی‌شود و سایر checksumها دست‌نخورده می‌مانند
- backup/Restore کامل موجود است

</div>
