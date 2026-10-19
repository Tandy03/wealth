# Frontend: глобали та порядок запуску

`frontend/index.html` залишається точкою входу для web і Android WebView. Усі classic scripts локальні, виконуються послідовно наприкінці body. Нового framework, збирача, runtime loader або запитів за HTML-шаблонами немає. Великі секції HTML на цьому етапі залишені в документі: їх поділ не потрібний для ізоляції bootstrap і не додає ризику для offline-запуску.

## Дозволені глобали та власники

Повний перелік закріплений у [frontend-globals.json](frontend-globals.json). Кожен запис задає `src`, дозволені властивості browser global (`globals`) та top-level declarations classic script (`bindings`). До declarations належать також деструктуровані змінні й function declarations; останні можуть одночасно бути властивостями window. Кожне ім’я має одного власника. Це контрольований compatibility-контракт, а не рекомендація створювати нові глобали.

| Власники | Інтерфейс / призначення |
| --- | --- |
| `frontend/vendor/chart.umd.js` | `Chart`, локальна бібліотека; рендерери підтримують її відсутність |
| `js/mobile-config.generated.js` ← `backend/scripts/generateMobileConfig.js` | `FINO_MOBILE_CONFIG`; конфігурація з середовища, значення не входять до переліку або звітів |
| `frontend/js/i18n.js` | `FinoI18n` |
| `shared/*.js`, `shared/portfolio/*.js` | `FinoErrors`, `FinoOperations`, `FinoSyncModel`, `FinoStateContract`, `FinoStateModel`, `FinoMarketModel`, `FinoConstants`, `FinoValidation`, `FinoOperationValidation`, `FinoPortfolioCalculations`, `FinoPortfolioNormalization`, `FinoPortfolioOperations`, `FinoPortfolioRules`, `FinoRequest` |
| `controllers/wallet-actions.js`, `state-store.js` | `FinoWalletActions`, `FinoStateStore` |
| `mobile-api.js` | `mobileApi` лише на native; bridge `Capacitor` надає платформа |
| `api/{fetchers,desktop,mobile}.js`, `api.js` | `FinoFetchers`, `FinoDesktopApi`, `FinoMobileApi`, compatibility `api`, `readApiJson`, `financialCommand`; приватизація решти старих bindings відбувається поступово |
| `api/outbox.js` | `FinoOutbox`, platform-neutral factory локального recovery; storage/scope/logger/UI не читає з globals, отримує їх явно |
| `asset-detail/model.js` | `FinoAssetDetail`, DOM-free read adapter позицій і спільної картки активу: групує за типом/назвою як Portfolio, підсумовує чинні shared розрахунки й історію, не змінює документ |
| `asset-detail/view.js` | `FinoAssetDetailView`, factory контролера `ui.asset` з явними залежностями store/model/DOM/i18n/actions/Chart; шаблони локальні, API викликається лише через передані чинні дії |
| `state.js` | Єдиний `stateStore`, compatibility `state`, таблиці курсів і wallet-категорій |
| Analytics, market-data, cashflow, rebalance/model, views/wallet | DOM-free factories `Fino…`, `PortfolioPerformance`; сервіси отримують snapshot і залежності явно |
| `models.js`, `utils.js`, `data-loader.js` | Старі lexical aliases, форматування, facade сервісів та завантаження; точні імена в JSON |
| Renderers, forms, charts, controllers, rebalance UI | Старі function exports та `FinoChartPlugins`, `FinoRebalanceDashboard`, `FinoRebalanceCurrencyHover`; точні імена та відповідальні файли в JSON |
| `ui.js` | Спільний namespace `ui` для рендерерів і форм |
| `app.js` | Додає `ui.application`; зберігає лише чинні compatibility globals `init`, `loadData` |

`controllers/application.js` також володіє погодженим `setupCommandRecovery`, який підключає outbox до локальної recovery panel. Namespace outbox і controller зафіксовані в JSON; startup не відправляє pending команди автоматично. Докладний контракт — [IDEMPOTENCY.md](IDEMPOTENCY.md).

Стандартні browser APIs (`document`, timers, fetch, storage, crypto тощо) та native `Capacitor` належать середовищу. Власний код не має перепризначати їх. Тимчасові DOM named properties, які браузер утворює з `id`, не є модульними API: доступ до елементів має бути явним через DOM.

## Порядок і залежності

Точний порядок скриптів у HTML має збігатися з JSON; автоматичної генерації або непомітного оновлення allowlist під час тестів немає.

1. Локальний Chart, конфігурація й i18n.
2. Спільні errors/operations/sync/state/market моделі; wallet commands і store.
3. Constants, raw/domain validation, фінансові правила й request helper. Lazy-залежності в shared залишаються lazy; bootstrap викликає їх після завантаження всього набору.
4. Native adapter → desktop/native transports → compatibility API.
5. DOM-free factories → єдиний store instance → utilities → factories аналітики → service facade → data loader.
6. Рендерери → UI ребалансу → форми → графіки → controllers.
7. `ui.js` збирає готові інтерфейси; `app.js` передає залежності bootstrap і реєструє `DOMContentLoaded`.

`app.js` експортує `createApplication(dependencies)` у Node без доступу до DOM. Browser composition root передає store, API, завантаження, рендер, benchmark, controller registry, diagnostics, logger та notice service один раз. Сам bootstrap читає лише передані залежності. Нового глобального namespace для цього не додано: браузер використовує `ui.application`, старі форми ще можуть викликати `init`/`loadData`.

Збережено порядок: setup → локальні дані → render → необов’язкові benchmark/background sync. Bootstrap не чекає завершення sync перед показом локальних даних. Background відповідь перевіряє store context перед повторним завантаженням або логуванням. Помилки controller setup залишаються видимими й проходять через безпечні diagnostics.

## Правило для нових змін

Нові helpers і кеші тримати в closure/factory, залежності передавати параметрами. Для браузерних DOM-free модулів збережений UMD pattern із CommonJS export для Node. Використовувати чинний namespace або інтерфейс сервісу. Якщо новий публічний global справді потрібний, вказати єдиного власника, обґрунтувати потребу й явно оновити контракт та тести. Не передавати весь window як неявний контейнер залежностей.

Старі aliases вилучати після переходу всіх споживачів. Фінансові зміни й надалі проходять через store-команди, як описано в [FRONTEND-STATE.md](FRONTEND-STATE.md); цей етап не змінює фінансові правила або модель збереження.

## Автоматична перевірка

- `frontendModules.test.js` читає реальний HTML і локальні scripts, компілює спільну classic scope, перевіряє allowlist declarations та властивостей global, єдиного власника і реєстрацію запуску. Негативні сценарії: пропущений/закоментований файл, перестановка, remote/inline/async script, зайвий global і відсутня runtime-залежність.
- `applicationBootstrap.test.js` виконує реальний bootstrap без DOM: локальний запуск, кількість викликів, stale response, відсутність render для відхиленого snapshot, setup error і request ID.
- `uiSmoke.test.js` завантажує реальний HTML та локальні scripts у тому самому порядку, перевіряє property globals кожного модуля. Окремо запускає desktop і native offline UI через справжню подію `DOMContentLoaded` з локальним Chart. Зовнішні API, native plugins і canvas drawing замінені тестовими реалізаціями; це не перевірка намальованих пікселів на телефоні.
- `mobile:check` перевіряє порядок і declarations тим самим build-time валідатором, а також наявність усіх HTML-ресурсів та SHA-256 підготовлених frontend/shared файлів. Manifest і валідатор не завантажуються браузером та не додають роботи UI.

Команди: `npm.cmd test`, потім `npm.cmd run mobile:prepare` і `npm.cmd run mobile:check`. Prepare оновлює лише `.tmp/mobile-web`; ці команди не складають APK і не копіюють файли на телефон. Майбутня дозволена Capacitor-збірка пакує ті самі локальні HTML/JS/shared ресурси.
