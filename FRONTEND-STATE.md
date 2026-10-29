# Зміни frontend-стану

Власник опублікованого фінансового документа — `frontend/js/state-store.js`. Значення з `getData()`, `getState().data`, `select()`, результатів команд і subscription events є **позиченими значеннями лише для читання**. UI не змінює їхні поля, вкладені об'єкти або масиви й не передає їх mutating-normalizer. Нові зміни проходять через команди нижче. У production на звичайному читанні немає глибокого копіювання, Proxy або `Object.freeze`.

## Явні selectors і snapshots

Форми читають актуальні дані через `selectAssets()`, `selectTransactions()`, `selectPayments()`, `selectSales()`, `selectWallet()`, `selectRebalance()`, `selectCalendarNotes()`, `selectPriceHistory()`, `selectInstruments()`; `selectData()` повертає цілий документ для доменного розрахунку. Це O(1) читання без копіювання, нормалізації, збереження, сповіщень або запитів. Значення залишаються лише для читання; фінансові зміни проходять через наявні команди, без зміни їхніх persistence-результатів.

Кожен фінансовий selector приймає необов'язковий явний snapshot: `store.selectAssets(snapshot)`. Переданий snapshot завжди має пріоритет над поточним store; після `replaceData` він продовжує описувати попередній документ. Renderers, графіки, Asset details і Rebalance використовують саме цю форму. `getState()` зберігається як джерело render snapshot, але читання його `.data` поза власником store заборонено lint.

`selectUI(key, snapshot?)` читає UI-поле; ключ `data` заборонений. Форми змінюють editing IDs, календарну дату й незбережені rebalance drafts через `setUI`, а фінансові записи — через API/store-команди. Асинхронний data-loader зберігає перевірку `capture/isCurrent` і читає поточний FX-кеш перед об'єднанням паралельних відповідей.

DOM-free factories MarketData, PortfolioFinance, Cashflow і WalletAnalytics отримують явні `selectData` та `selectUI`. `models.js` передає live readers для подій користувача, а `createRenderServices(snapshot)` прив'язує обидва readers до переданого snapshot. Лише централізований `FinoStateStore.createReader({state})` залишає сумісність зі старими standalone споживачами; прикладний код цей адаптер не використовує. Глобальний alias `state` у `state.js` вилучений із коду та реєстру browser bindings; нових browser globals немає.

`stateSelectors.test.js` перевіряє live/snapshot читання, ідентичність значень, guard, ізоляцію DI-сервісів і FX після заміни документа; наявний UI smoke завантажує реальний HTML для web/native.

## Перелік знайдених записів і їхній власник

| Місце | Попередня поведінка / класифікація | Тепер |
| --- | --- | --- |
| `wallet-analytics.normalizeWalletCategoryNames` | Зміна expense.category, month.plans і customCategories вже після публікації та сповіщення | Draft helper `FinoWalletActions.normalizeCategories`; store викликає його до публікації приватної нормалізованої копії |
| `wallet-analytics.walletMonth` | «Читання» створювало months/plans/notes | Чистий alias `walletMonthView`; mutable `FinoWalletActions.month` використовується лише з приватним command draft |
| `wallet-analytics.cleanupUnusedWalletCategories` | Зміна вкладених місяців через analytics service | Draft helper `FinoWalletActions.cleanupCategories`, викликається всередині wallet-команди |
| `controllers/wallet-actions`, wallet/loan forms і controllers | Копія wallet зберігалася в service queue, після API викликався довільний updateData; stale save повертав false, який UI міг проігнорувати | `store.saveWallet` володіє чергою, перевіркою актуальності, збереженням, атомарною публікацією й результатом |
| `data-loader` | Безумовний replaceData після await, потім mutating-normalizer | `store.loadData` перевіряє запит, snapshot і акаунт перед публікацією |
| `rebalance/dashboard` | API save і окреме локальне updateData; безумовне застосування reload | `store.saveRebalance` та `store.loadData` |
| Asset/sale/payment/note forms | API/native domain operation, потім завантаження snapshot | Збережено; snapshot публікує тільки `store.loadData`, додаткової локальної фінансової мутації немає |
| `mobile-api` і shared domain operations | Зміни приватного документа адаптера перед журналом/native storage | Це persistence/domain layer, окремий від frontend-store. UI отримує копію, а store публікує власну нормалізовану копію |

Локальні масиви аналітики, результати групування, відсортовані копії й UI-поля поза `data` не є записами у фінансовий документ. Редактор ребалансу тримає незбережений draft окремо від `data.rebalance`.

## Команди

| Команда | Вхід | Змінює | Результат | Збереження |
| --- | --- | --- | --- | --- |
| `replaceData(document)` | Повний document snapshot | Увесь фінансовий документ після document validation/нормалізації | Опублікований документ | Ні; локальна команда, зокрема для імпорту вже прочитаних даних |
| `updateData(change)` | Синхронний callback із приватним draft документа | Увесь документ атомарно | Опублікований документ | Ні; локальна команда. Не означає збереження в API/Drive |
| `loadData(loader)` | Функція читання API/native snapshot | Увесь документ, лише якщо відповідь актуальна | `{ applied: true, data }` або `{ applied: false }` для застарілого читання | Ні, лише читання |
| `saveWallet(change, persist)` | Синхронний callback із приватним wallet draft та async API/native writer | Лише wallet, зберігає нові незалежні зміни ребалансу | `{ applied: true, value, persistence }`; при помилці Promise rejected | Так, один виклик writer на команду, перед публікацією |
| `saveRebalance({plan, expected}, persist)` | План і прочитаний baseline та async writer | Лише rebalance, зберігає нові незалежні зміни wallet | `{ applied: true, value, persistence }`; при помилці Promise rejected | Так, один виклик writer, після перевірки baseline й до публікації |
| `invalidateContext()` | Без параметрів, використовується перед reconnect | Скасовує актуальність запитів/черги, не змінює документ | `undefined` | Ні; записи заблоковані до актуального load/replace |
| `setUI(patch)` | Поля UI, без `data` | Лише UI-поля | State reference | Ні |

Після кожної успішної фінансової публікації надходить рівно один `data:changed` event із `command`, `keys`, `state` і, для save-команд, `persistence`. Невдала перевірка, API failure або відкинута застаріла відповідь не публікує фінансової зміни. UI-події й рендеринг не спричиняють збереження автоматично; чинні цільові render-виклики збережені, щоб не додавати повний повторний render на кожну wallet-операцію.

`persistence` розділяє `savedLocally`, `savedRemotely`, `backupSaved`; успішний Promise API означає локальний commit, а підтвердження Drive береться лише з наявних metadata. Якщо metadata відсутні, `savedRemotely` і `backupSaved` залишаються false. Якщо API явно повідомив `savedLocally:false`, store відхиляє збереження. Помилка API зберігає її чинні code/category/requestId. Локальний `STALE_STATE` має category `conflict`, status 409, `applied:false` та `persistence`: API міг уже підтвердити запис, але відповідь не застосовано до нового UI snapshot. Автоматичного повторення фінансових записів немає.

## Асинхронність і введені значення

Store перевіряє revision документа, покоління context, останній запит читання та account scope. Scope черги wallet фіксується при постановці команди, а не після завершення попереднього save. Зміна іншої частини документа не втрачається: wallet і rebalance мають окремі версії. Full reload або зміна акаунта скасовує застосування pending save. Початкове native-читання може встановити scope; якщо під час читання відбувається прив'язка/зміна акаунта, adapter додає несеріалізоване поле походження відповіді. Воно не потрапляє в JSON портфеля, Drive чи журнал.

Валютна історія, поточні курси й benchmark використовують store context token; відповідь для неактивного акаунта не оновлює навіть UI-кеш. Фоновий sync не запускає нове завантаження для вже застарілого snapshot.

При помилці бюджетне поле зберігає введений текст у `walletPlanDrafts`, окремо від фінансового документа, із прив'язкою до акаунта/місяця/категорії. Повторний render не стирає draft, а повторний change повторює явну команду. Pending input заблокований; після помилки він доступний і позначений `aria-invalid`. Підсумки бюджету рахуються зі збережених сум. Expense/loan modal і текст note очищаються лише після успіху; невдалий save зберігає ввід.

## Перевірки

`frontendStateStore.test.js`, `walletActions.test.js`, `dataLoader.test.js` перевіряють повідомлення, нормалізацію до публікації, чергу, результат збереження, помилки й конкуренцію snapshot/account. Усі UI smoke-тести використовують той самий mutation guard, який доступний у development.

### Статична заборона мутацій

`npm run check:state-mutations` запускає AST-правило ESLint `financial/no-financial-state-mutation` для всіх `frontend/js` UI-модулів. Воно входить у `check:frontend`, який уже викликає CI. Загальний lint залишається поступовим; нова фінансова перевірка охоплює також legacy-форми та renderers. Винятки — власники приватних persistence/document drafts `state-store.js` і `mobile-api.js`; generated config і vendor не є UI-кодом.

Правило відстежує `state.data`, `getState().data`, `getData()`, `select`, результати команд і subscription events, локальні aliases, destructuring, for-of та callbacks масивів. Воно відхиляє присвоєння, delete, інкременти, mutating array methods, відомі mutating-normalizers, Object.assign/defineProperty і Reflect.set над позиченими значеннями. Сортування локальної копії масиву дозволене; зміна активу всередині shallow copy — ні. Приватні drafts store-команд залишаються mutable. Перевірки `financialStateLint.test.js` тестують як заборонені/дозволені приклади, так і реальне застосування CI-конфігурації до UI-файлів.

Це статичний захист поширених шляхів доступу, а не доказ безпеки довільного динамічного JavaScript: приховані через сторонні функції aliases та runtime-generated код потребують dev/test guard. У production не додано Proxy, freeze чи копій на читанні. Іменовані selectors також охоплені mutation guard. Опція `banLegacyReads` у CI відхиляє читання `state.data`/`snapshot.data`, aliases від `getState()` та destructuring документа з root state. Винятки — власники `state-store.js` і приватних native persistence drafts у `mobile-api.js`; це не UI-читання.

### Перемальовування після FX

`marketRevision` перемальовує лише видимий екран Investment або Wallet. Dashboard, Portfolio й Transactions при відкритті читають актуальний snapshot; Analytics/Rebalance зберігають власні чинні render-виклики, Asset details будує модель при відкритті за поточним `marketRevision`. Повне фінансове завантаження зберігає `renderApplication`; FX-подія не публікує фінансових змін і не запускає мережевих запитів.

Перед оптимізацією заміряно реальний HTML/локальні модулі в jsdom: 100 синтетичних позицій, Market відкритий, 2 прогріви й 9 FX-подій. Медіана синхронної обробки — 242,96 мс до / 3,58 мс після; 7 груп рендерів на кожну подію до / 0 прихованих рендерів після. Це локальний замір без малювання пікселів, не Android WebView benchmark. UI smoke перевіряє кожний видимий фінансовий екран, актуальність прихованих значень при переході та незмінність документа для web/native.

## Mutation guard у dev/test

`createStore({guard:'test'})` або `guard:'development'` вмикає lazy read-only Proxy лише для опублікованого `state.data`. Запис, заміна data, push/splice, delete, defineProperty або зміна prototype спричиняє зрозумілу помилку. Getters, `select`, subscription events і результати store-команд повертають захищені значення. Development callback `onViolation` отримує лише `{code:'DIRECT_STATE_MUTATION',type,path}`; динамічні ключі замінено `[entry]`, фінансові значення не логуються.

Для локального browser/WebView development задайте `data-state-guard="development"` на кореневому `<html>`; у чинному production HTML атрибут відсутній, guard вимкнений. У тестах guard вмикається явно; helper `backend/tests/helpers/readonlyStore.js` лише експортує реалізацію зі store, другої реалізації немає. `stateMutationGuard.test.js` перевіряє прямі й вкладені мутації, subscription, приватні drafts, незмінність API input, setUI та відсутність будь-яких Proxy constructors у production-конфігурації.

Нормалізація виконується перед публікацією й не заморожує API object. Приватні копії `updateData`/`saveWallet`/native domain операцій залишаються mutable. `updateData` приймає тільки синхронний callback; не зберігайте draft назовні. Навіть випадково збережене зовнішнє посилання на draft не є посиланням на опублікований документ: publish створює нормалізовану копію. UI-поля й drafts не проксуються; автоматичного save на subscriptions немає. Локальний outbox фінансових команд описано в [IDEMPOTENCY.md](IDEMPOTENCY.md), він не змінює store/save семантику.
