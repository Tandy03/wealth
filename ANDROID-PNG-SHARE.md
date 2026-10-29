# Android PNG export та native share

Локальна реалізація від 21.10.2026. Підготовлено код і автоматичні перевірки без Gradle, APK/AAB, Capacitor sync, встановлення на телефон, Git commit/push або deployment. Старий APK автоматично нового плагіна не отримає.

## Межі змін

- `PortfolioSharePlugin.java`: дві незалежні від портфеля команди, SAF/Share Sheet, Activity callbacks та власний worker.
- `PngShareFiles.java`: чиста Java-перевірка PNG та обмежений приватний кеш.
- `PortfolioShareFileProvider.java`, `portfolio_share_paths.xml`, `AndroidManifest.xml`: окремий provider `${applicationId}.portfolio-share`, лише `cache/portfolio-share/`; вузький visibility query `ACTION_SEND` + `image/png`.
- `MainActivity.java`: тільки реєстрація додаткового плагіна.
- `frontend/js/share-card/platform.js`: автоматичне визначення плагіна та обмежений Blob → base64 → native transport.
- `frontend/js/share-card/view.js`, `i18n.js`: одноразовий native-клік, блокування повторів, точні статуси шістьма мовами.
- `checkMobileReadiness.js`, JS/static/Java/UI тести та instrumentation assertion: перевірки конфігурації, контракту й реєстрації.

Чинні SVG → Canvas → PNG 1080 × 1080, web download/Web Share, фінансові правила, історичні періоди, структура документа, JSON `PortfolioTransfer`, auth/sync, app ID, signing та залежності не змінені. Старий загальний FileProvider залишено для чинних споживачів; новий плагін його не використовує.

## Native-контракт

Доступ через `Capacitor.Plugins.PortfolioShare`; якщо доступний `isPluginAvailable`, він теж повинен підтвердити плагін. User-Agent не використовується. За відсутності плагіна немає прихованого `a.download`/Web Share fallback у WebView. Чинний ін'єктований `nativeBridge` залишається сумісним.

Обидві команди отримують тільки:

```js
{ base64: "<PNG bytes, without data URL prefix>",
  name: "fino-portfolio-YYYY-MM-DD.png", mimeType: "image/png" }
```

`savePng` повертає `{status: "saved", saved: true, cancelled: false}` після успішного закриття потоку або `{status: "cancelled", saved: false, cancelled: true}` після відмови користувача. Використовується `ACTION_CREATE_DOCUMENT`, `CATEGORY_OPENABLE`, `image/png`; загальний доступ до сховища не потрібен. Місце та перезапис контролює системний picker. При помилці потоку успіх не повертається; обраний користувачем документ може лишитися неповним, його не видаляємо автоматично, щоб не стерти попередній файл провайдера.

`sharePng` відкриває `ACTION_SEND` у системному chooser, передає `content://` через `EXTRA_STREAM` і ClipData лише з тимчасовим read grant. Після повернення chooser результат `{status: "dialog-closed", opened: true, deliveryConfirmed: false}`. Android не гарантує підтвердження доставки або навіть однозначного скасування Share Sheet: інтерфейс каже «Меню поширення закрито. Доставку не підтверджено», а не «Надіслано».

Відмови: `VALIDATION_FAILURE`, `CONFLICT`, `STORAGE_FAILURE`, `NO_SHARE_TARGET`, `SHARE_UNAVAILABLE`, `SHARE_CACHE_FULL`, `OPERATION_INTERRUPTED`. Promise reject містить лише фіксоване повідомлення й код; UI не показує довільний native exception, URI чи шлях. Відповіді невідомої форми не трактуються як успіх.

## Межі, приватність і очищення

Максимум **5 MiB PNG**, максимум **6 990 508 base64-символів**. JS перевіряє MIME, розмір, сигнатуру, IHDR/1080 × 1080 та календарну нейтральну назву до виклику bridge. FileReader не створює додатковий великий binary string або масив усіх байтів; читає окремо лише 33 байти заголовка. Native поза main thread додатково перевіряє строгий base64, усі CRC/межі chunk-ів, IHDR, IEND, послідовність IDAT та обмежений inflate без Bitmap. Підтримуються нечерезрядкові 8-bit RGB/RGBA PNG чинного Canvas-експорту; це не універсальний імпортер картинок.

Base64 збільшує обсяг приблизно на третину; Capacitor/WebView створює свої тимчасові копії. Розмір обмежено, але фактичний peak RAM на телефоні ще не виміряно. JS відпускає payload після передачі bridge. Native негайно вилучає base64 з PluginCall options до відкриття Activity, щоб Capacitor не серіалізував зображення в Bundle. Декодовані робочі буфери затираються після використання; незмінні Java/JS strings гарантовано затерти неможливо.

Share PNG зберігаються лише в `cache/portfolio-share/`, з нейтральною датою та UUID, не публічними URL. Provider не exported, не надає write grant і не відкриває JSON/токени/інші каталоги. PNG містить тільки обрані користувачем дані, але все одно є приватним зображенням. Нових Android permissions, мережевих викликів, аналітики або логування PNG/base64 немає; Capacitor `loggingBehavior: none` збережено.

Ліміт кешу — **8 файлів / 20 MiB**. Видаляються файли віком **від години** при завантаженні плагіна та перед новим share. Це відкладене очищення, а не таймер: якщо Fino не запускається, файли можуть лишитися до наступного запуску чи очищення кешу Android. Свіжі файли не витісняються, щоб одержувач устиг їх прочитати; при заповненні повертається явна помилка. Невідкриті share-файли видаляються одразу після відмови. Після відкриття chooser файл не видаляється миттєво. Доступ пізніше години не гарантується. Для save окремий тимчасовий файл не створюється.

## Життєвий цикл

Одна операція на native-плагін (`AtomicReference`) і на JS-wrapper (`WeakSet`), включно з повторним відкриттям модального вікна. PNG-підготовка, перевірка й IO виконується власним послідовним worker, не чергою фінансового storage. На main thread відкривається лише системний Intent.

Використовуються Capacitor `startActivityForResult` та `@ActivityCallback`; звичайний перехід у фон не скасовує picker. Manifest уже обробляє зміну орієнтації без recreation. Якщо Activity таки знищено, активний виклик завершується як перерваний, буфери очищаються, старий результат не повідомляє про успіх. Зберігається лише нейтральний marker; PNG/URI/шляхи не відновлюються із Bundle. При відновленому callback без активних байтів — явна помилка та повтор за новою дією користувача. Після знищення процесу немає живого JS Promise; новий WebView починає без незавершеної PNG-команди. Безшовне продовження експорту після process death не обіцяється.

Закриття модального вікна, зміна акаунта/налаштувань під час генерації скасовує або відкидає підготовку до native-виклику. Вже відкритий системний picker належить Android: закриття WebView-модалки не може відкликати явно підтверджений користувачем системний запис. Пізня відповідь не змінює новий preview чи фінансові дані.

## Автоматичні й наступні перевірки

`backend/tests/portfolioShareNative.test.js` перевіряє capability routing, PNG transport, відмови, скасування, повтори, signal abort, сумісність web/injected bridge. `uiSmoke.test.js` завантажує реальний HTML і перевіряє одноразовий native-клік, шість локалізацій, статуси та незмінність фінансового стану/мережевих запитів. `androidPngShare.test.js` перевіряє manifest/provider/callback контракт і запускає `PngShareFilesTest.java` без Android runtime: справжні синтетичні PNG, корупція/CRC/inflate/розміри/назви/base64, строк зберігання, межі й конкурентний кеш. Якщо JDK відсутній, ця Java-перевірка явно пропускається; тут JDK Android Studio доступний.

Перший прогін: `npm.cmd test` — **532 тести пройшли, без пропусків**, включно з 52 синтетичними Java-перевірками PNG/кешу; `npm.cmd run lint`, `npm.cmd run check:frontend`, `npm.cmd run mobile:prepare` — успішно. SHA-256 чинного APK залишився `29EEBDC9926920E4C54DBD90C3F0B98BDCA09D740F8F2C441A33E4EF646590FF`.

Повторний аудит за тим самим ТЗ закрив додаткові перевірки без Android-пакування:

- `PngShareFiles.write` — один тестований writer для SAF; успіх тільки після write/flush/close. Відкриття провайдера, null stream, помилки write/flush/close й переривання до відкриття, між блоками або при закритті не дають хибного успіху. Потік закривається також при помилці, робочі байти затирає чинний `finally` плагіна.
- Java harness розширено з 52 до **69 перевірок**; цільові 18 Node-тестів пройшли без пропусків.
- У `view.js` native отримує готовий Blob без створення додаткового `File`; browser-гілка лишилася з чинним File/Web Share контрактом. Реальні HTML-тести забороняють виклик конструктора File у native-сценаріях.
- У `ExampleInstrumentedTest.java` додано сценарій некоректного PNG для обох native-команд: `VALIDATION_FAILURE` та відсутність base64 у збережених call options. Це підготовлений тест, на пристрої/емуляторі не запускався.
- **Усі три production Java-класи** (`PortfolioSharePlugin`, `PortfolioShareFileProvider`, `PngShareFiles`) перевірені напряму `javac` через встановлений JDK, локальний `android-36/android.jar`, чинний Capacitor classes.jar і кешовані AndroidX залежності. Після додавання локальних annotation/Kotlin JAR перевірка завершилася без помилок та попереджень. Команда: `javac @.tmp/png-plugin-compile/javac.args`; результати лише в `.tmp/png-plugin-compile/`, без Gradle та змін Android build output. Це перевірка Java/API-сумісності, не запуск Android і не APK/AAB build.

Фінальний повторний прогін після доробок: **532/532 Node-тести**, без пропусків чи помилок; Java harness усередині прогону — **69 перевірок**. `npm.cmd run lint`, `npm.cmd run check:frontend`, `npm.cmd run mobile:prepare`, `npm.cmd run mobile:check` успішні. `git diff --check` пройшов; diff фінансових shared/domain/service модулів, `PortfolioTransferPlugin`, `capacitor.config.json` та signing у `android/app/build.gradle` порожній. APK повторно перевірено за тим самим SHA-256. Новий APK/AAB не створювався, Git commit/push, deploy та встановлення на телефон не виконувалися.

`npm.cmd run mobile:check` теж пройшов: 82 asset references, 221 JavaScript sources, 15 shared modules; перевірені реєстрація плагіна й вузький provider. `git diff --check` не знайшов помилок пробілів.

**Ще не перевірено:** реальні SAF-провайдери, Telegram/Gmail/Drive/Quick Share, Android-версії/малий RAM, повернення через app lock, системне скасування, фон/поворот/Activity recreation/process death та відкладене читання URI одержувачем. Instrumentation assertion оновлено, але instrumentation не запускалася.

Лише після окремого прямого дозволу на збірку/встановлення:

1. `npm.cmd run mobile:sync` — підготувати й скопіювати локальні ресурси.
2. `android\gradlew.bat -p android assembleDebug` — створити APK.
3. Окремо погоджене встановлення та ручні сценарії вище, вимір peak RAM/часу PNG на телефоні; перевірка валідного 1080 × 1080 PNG і що share не дає write access.
4. Instrumentation — тільки на окремому тестовому емуляторі, після дозволу на Android-збірку.

Ці кроки в цьому завданні **не запускалися**. Git/publishing потребують окремого прохання.
