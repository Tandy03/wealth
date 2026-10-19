# Зміни frontend-стану

Власник опублікованого фінансового документа — `frontend/js/state-store.js`. Значення з `getData()`, `getState().data`, `select()`, результатів команд і subscription events є **позиченими значеннями лише для читання**. UI не змінює їхні поля, вкладені об'єкти або масиви й не передає їх mutating-normalizer. Нові зміни проходять через команди нижче. У production на звичайному читанні немає глибокого копіювання, Proxy або `Object.freeze`.

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

## Mutation guard у dev/test

`createStore({guard:'test'})` або `guard:'development'` вмикає lazy read-only Proxy лише для опублікованого `state.data`. Запис, заміна data, push/splice, delete, defineProperty або зміна prototype спричиняє зрозумілу помилку. Getters, `select`, subscription events і результати store-команд повертають захищені значення. Development callback `onViolation` отримує лише `{code:'DIRECT_STATE_MUTATION',type,path}`; динамічні ключі замінено `[entry]`, фінансові значення не логуються.

Для локального browser/WebView development задайте `data-state-guard="development"` на кореневому `<html>`; у чинному production HTML атрибут відсутній, guard вимкнений. У тестах guard вмикається явно; helper `backend/tests/helpers/readonlyStore.js` лише експортує реалізацію зі store, другої реалізації немає. `stateMutationGuard.test.js` перевіряє прямі й вкладені мутації, subscription, приватні drafts, незмінність API input, setUI та відсутність будь-яких Proxy constructors у production-конфігурації.

Нормалізація виконується перед публікацією й не заморожує API object. Приватні копії `updateData`/`saveWallet`/native domain операцій залишаються mutable. `updateData` приймає тільки синхронний callback; не зберігайте draft назовні. Навіть випадково збережене зовнішнє посилання на draft не є посиланням на опублікований документ: publish створює нормалізовану копію. UI-поля й drafts не проксуються; автоматичного save на subscriptions немає. Локальний outbox фінансових команд описано в [IDEMPOTENCY.md](IDEMPOTENCY.md), він не змінює store/save семантику.
