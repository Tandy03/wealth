# Frontend Fino: ES modules, build і перевірки

`frontend/index.html` підключає один локальний `type="module"` entry — `frontend/js/main.js`. Залежності визначають статичні імпорти, а не список класичних scripts. Production web і Capacitor використовують одну Vite-збірку. Framework, TypeScript, зміни фінансових формул, JSON-моделі та API не додавалися.

## Межі модулів

| Група | Контракт |
| --- | --- |
| Утиліти, read-only моделі, API factories, store, share models | ES modules із явними імпортами та named/default exports; придатні для Node-тестів без DOM |
| Рендерери, графіки, форми й контролери | Ізольовані `create…({ namedDependencies })` factories; повертають інтерфейс, зберігають приватний стан у closure |
| `composition.js` | Єдине місце створення store, API, моделей і UI. Передає кожній factory її конкретні залежності. Взаємні UI-виклики передаються відкладеними callbacks, тому імпортних циклів немає |
| `app.js` | DOM-free lifecycle із `createApplication(dependencies)`; локальні дані показуються до завершення необов’язкового background sync |
| `main.js` | Локальний Chart.js, конфігурація, composition і запуск після готовності DOM; позначає підтверджений запуск `data-startup="ready"`, помилку — `failed` |

Об’єкт `ports` приватний для composition root. Він не передається модулям як service locator: у кожної factory є визначений перелік іменованих параметрів. Повернений runtime дає тестам доступ до реальних інтерфейсів без `window.ui`, `window.stateStore`, `window.mobileApi`, `window.Fino…`, `window.init` або `window.loadData`.

У production немає legacy-адаптера application globals. Старі `frontend/js/{state-model,errors,constants,…}.js` shims вилучені після перенесення споживачів на canonical `shared` або ESM imports. `frontend-globals.json` тепер є коротким реєстром платформних меж; списку scripts/loading order у ньому немає. Runtime і UI-тести не читають його як граф залежностей.

## Незмінний shared-код і локальний vendor

Backend продовжує виконувати оригінальні CommonJS/UMD файли `shared/`. Для браузера `backend/scripts/sharedBrowserModules.cjs` під час dev/build статично перетворює їхню **браузерну гілку** на ESM: замінює тільки вибір платформи й оболонку експорту, додає явні імпорти залежностей. Фінансові функції не переписуються. Локальні об’єкти оболонки не публікуються на `window`.

Ця межа потрібна, бо звичайне CommonJS bundling увімкнуло б серверні гілки `validation`, `request` і crypto. Збережено браузерну валідацію JSON-відповідей, WebCrypto та обмеження native-запитів. Споживачі адаптера вичерпно перелічені в його `owners`: 15 canonical shared-модулів. Адаптер можна прибрати після появи native ESM-дистрибуції shared; backend-міграції зараз немає.

Той самий build plugin обгортає локальний `frontend/vendor/chart.umd.js` у приватний module/exports scope і повертає його як default export. Споживач — `main.js`; глобальний `Chart` не створюється. Цю межу можна прибрати при заміні vendor на ESM-дистрибуцію. Обидві межі задокументовані в `frontend-globals.json`. Критичний код із CDN не завантажується; необов’язковий web font лишається із системним fallback, як раніше.

## Команди

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run dev
npm.cmd run build:frontend
npm.cmd start
npm.cmd test
npm.cmd run test:ui
npm.cmd run check:frontend
npm.cmd run mobile:prepare
npm.cmd run mobile:check
```

`dev` запускає Express і Vite middleware на одному localhost origin, з доступом до наявного API. Origin/session/proxy guards API збережені; окремий API proxy або послаблення CORS не потрібні. Vite обслуговує модулі й зміни frontend, Node watch — backend.

`build:frontend` створює `.tmp/frontend-dist/` із HTML, хешованими локальними JS/CSS/assets і manifest. `start` спершу виконує цю збірку, потім Express віддає її. Deep links повертають HTML; відсутній JS/CSS повертає 404, а не успішний HTML fallback. Без build сервер завершує запуск зрозумілою помилкою.

Перед build `prepareTestConfig.js` створює порожню ignored ESM-конфігурацію **лише за її відсутності** — для web/offline-only роботи без provider keys. Наявна конфігурація зберігається. `mobile:config` і далі перевіряє та генерує реальну локальну конфігурацію для Android. Значення не друкуються у звітах чи тестах. `.env`, OAuth tokens і keystore не входять до frontend build inputs.

`mobile:prepare` збирає frontend і копіює **тільки результат build** до `.tmp/mobile-web`, заданого в `capacitor.config.json`. `.fino-build.json` містить SHA-256 джерел і output-файлів; preflight відхиляє застарілі джерела, змінені/відсутні ресурси та зайві файли. Fallback до незбираних scripts немає. `mobile:check` лише читає ресурси, перевіряє граф, конфігурацію та реєстрацію native plugins; APK і Gradle не запускає. Наступний `cap sync` пакує цей самий build.

Vite 8.3.5 та parser Espree 11.2.0 зафіксовані у lockfile. Native config loader використано для коректного завантаження `.mjs`/`.cjs` на Windows із кириличними шляхами. У цьому робочому середовищі перевірено Node 24.

## Автоматичні перевірки

`check:frontend` аналізує один entry і фактичний ESM-граф: відсутні файли/exports, syntax errors, цикли, remote/implicit imports і нові записи у browser globals спричиняють помилку. ESLint працює в module scope без allowlist старих application globals; фінансовий mutation guard збережено.

`npm test` спочатку будує production artifact та окремий IIFE test artifact із **того самого графа модулів і тих самих Vite adapters**. Test entry розташовано в `backend/tests/helpers/moduleEntry.mjs`, він не імпортується production entry. Це дозволяє jsdom, який сам не виконує module scripts, запускати реальний frontend-код. Порядок classic scripts або глобальний manifest більше не є тестовим loader.

`helpers/frontendModules.js` має test-only facade для чинних UI assertions. Він працює з поверненим runtime і не публікує сервіси на справжньому Window. Кожен UI harness додатково відхиляє application-global leaks. Ізольований native harness також використовує скомпільований ESM entry.

Покриття включає локальний startup, навігацію, календар, бюджет, portfolio/analytics, усі локалізації, Capacitor file/share adapters, збереження й помилки, recovery після втраченої відповіді та перезапуску, operationId без дублювання, sync conflicts і account isolation. Окремі нові сценарії в web/offline-native перевіряють:

- Купівлю 1,5 одиниці по 100 після початкових 2 одиниць по 100: інвестовано 350; продаж 1 по 180: cost basis 100, profit 80, залишок 2,5 після restart.
- Невдале збереження витрати: draft і фінансовий документ збережено; retry записує рівно одну витрату 20,50, яка переживає restart.

Shared browser/Node parity tests перевіряють розрахунки, checksum, валідацію та native request concurrency. Provider data, transport, native bridge і canvas у DOM-тестах замінені детермінованими fixtures; реальних фінансових файлів і зовнішніх provider API тести не використовують.

Поточний baseline до міграції: 540 тестів, 539 pass, 1 fail. Збій був у застарілому bootstrap expectation окремого benchmark callback, який поточний runtime уже не викликав; assertion оновлено до фактичного lifecycle. Тести не вимикалися і не позначалися skipped. Помилки controller setup або початкового data load тепер відхиляють startup promise після показу діагностики; успішний marker не маскує частково невдалий запуск.

## Перевірка у браузері й розмір

```powershell
node backend/scripts/frontendBrowserSmoke.cjs
```

Команда використовує headless Chrome (`CHROME_PATH` або стандартний Windows-шлях), ізольований in-memory backend і тестовий профіль. Перевіряє actual production module entry та dev server, навігацію календаря, відмову/повтор збереження бюджету з перевіркою persisted state, а також compiled offline-native startup і restart з mock Capacitor storage. Зовнішні fonts заблоковані. Відсутність готового UI, import/startup errors і витік globals завершують перевірку помилкою. Це не перевірка фізичного Android WebView.

Замір до/після виконано на однакових synthetic portfolio, HTML/CSS та localhost у headless Chrome, із вимкненим cache; три cold navigations, медіана до першого заповненого UI:

| Метрика | До | Після |
| --- | --- | --- |
| JS-запити production | 77 | 1 |
| Завантажений JavaScript | 1 070 808 bytes | близько 812 500 bytes (−24%) |
| Gzip JS | близько 331 KB | близько 262 KB |
| Перший заповнений UI | 218 ms | 115 ms |

Це локальний замір, не гарантія швидкодії телефона. Dev має більше незменшених ресурсів для налагодження; для розгортання й Capacitor використовується production build. Є стандартне попередження Vite про chunk понад 500 KB: він менший за попередній сумарний код і завантажується одним запитом. Lazy loading не додавали, щоб не змінити offline/startup поведінку в цій міграції.

CI запускає lint, graph contract, production/test builds, весь suite, підготовку compiled mobile resources і mobile preflight. Публікації, Gradle та APK build до CI не додані.

Фінальний локальний прогін: **544/544 тести, 0 fail, 0 skipped**; `lint`, `check:frontend`, production build і `mobile:check` пройшли. Browser smoke: production/dev з перевіркою persisted retry, offline-native зі збереженням 250 після restart; runtime exceptions і application-global leaks відсутні. Фінальний точний JS payload — 812 478 bytes. Результати й сирі заміри збережені локально в `.tmp/modules-final-tests.log` та `.tmp/modules-browser-results.json`; baseline для `--compare` — у локальному `.tmp/modules-baseline-web`, без генерованих credentials. Для звичайної перевірки поточного checkout використовуйте команду без `--compare`.

Інтеграцію налаштовано відповідно до [Vite Backend Integration](https://vite.dev/guide/backend-integration.html); middleware на спільному origin зберігає чинні API guards.
