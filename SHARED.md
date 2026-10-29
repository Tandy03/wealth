# Спільний код Node.js, web та Android

Напрямок залежностей: **`frontend → shared`**, **`backend → shared`**. `shared/` не імпортує жоден із застосунків і не звертається до DOM, `window`, `document`, `localStorage` чи UI. Збереження, мережеві інтеграції, HTTP, Capacitor і відображення залишаються в адаптерах.

| Модуль у `shared/` | Відповідальність |
| --- | --- |
| `constants.js` | Спільні типи активів, валют, виплат, числові константи й початкові довідники |
| `state-contract.js` | Стани позицій, завершені виплати й транзакції |
| `state-model.js` | Модель JSON-документа, document validation, сумісність історичних даних, контракт плану ребалансу |
| `portfolio-transfer.js` | Версійований незалежний JSON-експорт, SHA-256, перевірка файлу й порожнього призначення; збереження та вибір файлу належать адаптерам |
| `validation.js` | Request validation і нормалізація нових операцій; factory для ін'єкції типу помилки |
| `portfolio/calculations.js` | Кількість і собівартість залишку на дату, середня ціна, право на виплату, погашення |
| `portfolio/normalization.js` | Сумісність історії покупок і перерахунок похідних полів |
| `portfolio/operations.js` | Зміна портфеля, графіки виплат, сумісність об'єднання, проведення транзакцій |
| `portfolio/validation.js` | Доменні перевірки й builders нових transaction/payment/note; ID передає адаптер |
| `portfolio-rules.js` | Фасад трьох фінансових модулів, без другої реалізації формул |
| `errors.js` | Класи, коди, категорії, безпечний публічний формат і діагностика помилок |
| `operations.js` | ID команд, канонічний зміст, квитанції та replay/conflict; правила спільні для backend і native |
| `sync-model.js` | Чисті правила життєвого циклу, канонічний підпис документа і checksum |
| `market-model.js` | Перевірка й нормалізація зовнішніх даних, без запитів до провайдерів |
| `request.js` | Окремий transport helper: тайм-аути й обмеження паралельних запитів, без інтеграцій або UI |

Форматування, редактор ребалансу, charts і контролери залишаються у frontend. Document validation не викликає правила створення нової операції; schema version і фінансові результати під час перенесення не змінюються. Доменні функції не виконують запис: їхні виклики обгортає repository/native mutation adapter.

## Завантаження

Node.js використовує CommonJS напряму, наприклад `require('../../shared/state-model')`. UMD-модулі браузера завантажуються звичайними локальними `<script src="/shared/…">` у порядку `frontend/index.html`; імена `FinoStateModel`, `FinoPortfolioRules` та інших globals збережені. Node runtime, bundler, CDN і додаткові runtime-запити не потрібні. Express відкриває лише каталог `shared/` за префіксом `/shared/`; відсутній ресурс повертає 404, а не HTML застосунку.

Старі `frontend/js/…` шляхи тимчасово залишені як compatibility exports: CommonJS повертає той самий об'єкт із `shared/`; browser shim перевіряє вже завантажений canonical global. Для сторінок або VM, що раніше самостійно завантажували старий browser-файл, потрібно спочатку завантажити `/shared/…`. Реалізації у shim немає; основна HTML-сторінка їх не завантажує. Production backend і CommonJS frontend-споживачі вже перейшли на прямі імпорти, старі шляхи перевіряються тестами на сумісність.

Контрактна матриця `sharedModules.test.js` перевіряє **кожний наявний shim**: CommonJS identity, browser identity після canonical load, явну помилку `Load /shared/…` без залежності та відсутність shim у головному HTML. Старі локальні URL входять до Android asset manifest; підготовка/preflight перевіряють їхні байти так само, як решту frontend. Legacy-споживачі зараз переважно тести (`require` старих paths) і сторонні/історичні VM-сторінки. План вилучення: переводити їх на canonical imports під час змін, перевірити всі `require`/HTML references, після завершення міграції окремо прибирати shims. У цьому етапі жоден shim не видалено.

`sync-model.checksum` використовує Node WebCrypto або стандартний browser WebCrypto. Transport helper приймає `fetchImpl` та необов'язковий `baseUrl` (типово `https://localhost` для native); зовнішні провайдери використовують абсолютні URL. Він не читає browser location.

## Ресурси Android

Єдине джерело реалізацій — `shared/`. `npm.cmd run mobile:prepare` створює **лише** `.tmp/mobile-web/`: frontend у корені, shared-файли в `shared/`. Це генеровані побайтові копії для пакування, а не окремий вихідний код. Каталог ігнорується Git; він містить також чинну generated proxy configuration, тому його не публікують як звіт чи вихідні файли.

`capacitor.config.json` вказує цей каталог як `webDir`. `mobile:sync` готує його перед Capacitor; `capacitor:copy:before` оновлює його перед наступним копіюванням. Після чистого checkout спочатку використовуйте `mobile:prepare` або `mobile:sync`, оскільки Capacitor перевіряє існування `webDir` ще до copy hook.

Перевірка без складання APK і без зміни Android assets:

```powershell
npm.cmd test
npm.cmd run mobile:prepare
npm.cmd run mobile:check
```

Preflight перевіряє всі HTML-посилання в підготовленому Android web bundle, SHA-256 кожного ресурсу, відсутність застарілих файлів і copy hook. Після дозволеного в майбутньому складання `backend/scripts/verifyMobileAssets.ps1` окремо порівнює frontend **та shared** з `assets/public/` усередині APK. Підготовка й preflight самі не запускають Capacitor sync, Gradle чи встановлення на телефон.

`backend/tests/sharedModules.test.js` перевіряє залежності, Node без DOM, браузер без Node, сумісність старих exports, незмінні фінансові результати, WebCrypto, HTTP-видачу та пакування в ізольований каталог. Наявні фінансові/state-model/API/UI тести продовжують перевіряти ті самі результати.
