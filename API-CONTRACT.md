# API та рівні валідації

Контракт застосовується до localhost HTTP API й `api` facade на Android. Успішні HTTP-відповіді — JSON, крім поновлення браузерної сесії (`204`). Нові правила операцій не застосовуються до читання історичних документів.

Команди створення фінансових фактів, merge та received підтримують необов'язковий `operationId` у body; SDK додає його для нових команд. Повна квитанція повертає попередній JSON без нового commit; точний replay гарантовано у вікні 30 UTC календарних днів. Після компактування того самого змісту — `409 OPERATION_RESULT_EXPIRED` / `conflict`; іншого змісту з тим самим ID — `409 OPERATION_ID_CONFLICT` / `conflict`. Tombstone з ID/SHA-256 зберігається без TTL у schema version 1, без payload/result. Expired replay не виконує операцію повторно; клієнт завантажує поточний документ і показує пояснення без нового ID. Детальний перелік методів, строки, outbox, правила повтору й received — у [IDEMPOTENCY.md](IDEMPOTENCY.md). Чинні HTTP statuses успіху та shapes збережено; записи можуть містити додаткові operation metadata.

Outbox не додає endpoint-ів. Локальні помилки `OUTBOX_STORAGE_FAILURE` мають category `storage_failure`; `OUTBOX_CORRUPT_RECORD`/`OUTBOX_INVALID_COMMAND` — `validation`; `OUTBOX_PENDING_COMMAND`, `OUTBOX_SCOPE_CHANGED`, `OUTBOX_COMMAND_REJECTED`, `OUTBOX_RECORD_MISSING` — `conflict`. Наявні серверні error shapes `{error,code,category}` й request ID залишаються чинними. Recovery показує стан невідомої команди окремо від фінансового успіху.

Публікацію відповіді у frontend контролюють store-команди, описані у [FRONTEND-STATE.md](FRONTEND-STATE.md). Локальний `STALE_STATE` (`conflict`, 409) означає, що save acknowledgement застарів для поточного snapshot/account; це не нова HTTP-відповідь сервера. Помилка містить `applied:false` та явні save metadata, тож UI не очищає draft і не повторює запис автоматично.

## Явні файли портфеля

| Метод / шлях | Facade web/native | Вхід | Успіх |
| --- | --- | --- | --- |
| `GET /api/portfolio/export` | `exportPortfolio()` | Без параметрів | `200` JSON envelope `format/version/createdAt/document/checksum`, `Cache-Control: no-store` |
| `POST /api/portfolio/import/preview` | `previewPortfolioImport(backup)` | `{backup: envelope}` | `200 {checksum, createdAt, counts, expected}`; без фінансового запису |
| `POST /api/portfolio/import` | `restorePortfolio({backup, expected})` | Envelope та hash призначення з preview | `200 {success:true, checksum, persistence:{savedLocally, savedRemotely, backupSaved}}` |

Спільна валідація — `shared/portfolio-transfer.js`: UTF-8 JSON до 1 MiB, format/version, SHA-256 canonical envelope, document validation й legacy-нормалізація. Domain-перевірки restore: порожній фінансовий документ, scope та checksum поточного призначення; backend бере queue лише через `domain/mutation.runMutation`, native — через свою `queued`. Нормальний GET не перетворюється на експорт і не записує файл. UI попереджає й запитує згоду перед початком експорту; browser download та Android Storage Access Framework потребують явної дії користувача.

Помилки: `400 VALIDATION_FAILURE / validation` (формат, розмір, hash, некоректна історія), `409 RESTORE_NOT_EMPTY / conflict`, `409 RESTORE_PREVIEW_STALE / conflict`, `503 STORAGE_FAILURE / storage_failure`; транспорт зберігає чинні host/origin/session та body-limit помилки. HTTP має заголовок request ID, native зберігає той самий публічний error contract. Restore не включено в outbox як replayable фінансовий факт: повтор після вже виконаного запису відхиляється як непорожнє призначення, не створює дублів. Повідомлення про локальний успіх не підтверджує upload у Drive. Формат і сценарії: [PORTFOLIO-FILES.md](PORTFOLIO-FILES.md).

## Відповідальність перевірок

| Рівень | Модулі / перевірки | Відповідальність |
| --- | --- | --- |
| HTTP transport | `backend/validators/requests.js`: `validateHttpRequest` | JSON-сумісність тіла, object body, query-рядки без повторів/вкладених значень, дозволені query-поля, напрямок sync. Host, origin, сесія й розмір тіла перевіряються окремими HTTP middleware. |
| Request validation | `shared/validation.js`: `validateRequest`, `validateAssetInput`, `validateWallet`, `validateSyncAction`, `validateIdentifier`, `validateReadOptions`, `validateApiQuery` | Форма конкретної операції, обов'язкові поля, типи, скінченність чисел, календарні дати, діапазони й вкладені поля. Backend використовує той самий factory, Android — браузерний екземпляр. SDK перевіряє типи query та ID до перетворення в URL. |
| Request normalization | `normalizePurchase`, `assetInput`, `normalizeWallet`, `queryParameters` | Канонічні поля покупки, дозволені поля активу, нормалізація валют/тексту/витрат і числових query-параметрів. Це не міграція документа. |
| Domain validation | `shared/portfolio/validation.js`, доменні сервіси, `validateAssetCurrency`, `validateQuantity` з типом наявного активу, `state-model.applyRebalance` | Існування й належність активу/платежу, валюта активу, допустима кількість, залишок на дату, заборона продажу/редагування історії, сумісність об'єднання, дубль платежу, baseline ребалансу. Спільні builders нових transaction/payment/note використовуються backend і native. |
| Document validation | `shared/state-model.js`: `validateState`, `validateEntity`, `validateJson`, `normalizeState`, `validateRebalance` | Допустимість snapshot для зберігання, Drive-імпорту й відновлення; типи наявних полів, відомі enum, дати, JSON, дублікати ID, версія, міграція sparse legacy-документів. Не викликає валідацію створення активу чи нової операції. |

`validateQuantity` — спільний примітив: при створенні тип задає запит; при докупівлі/продажу тип береться з портфеля. Перевірка структури плану ребалансу повторно використовується для поля документа, а порівняння `expected` з поточним планом залишається доменною перевіркою.

Грошові поля приймають скінченне число або непорожній числовий рядок; `false`, `null`, масиви, об'єкти, порожні рядки й нескінченність не перетворюються на нуль. Виняток: `quantity:null` для income transaction та nullable необов'язкові `amountPerUnit`/transaction `purchasePrice`. Дати нових запитів — строгі календарні `YYYY-MM-DD`. Старі документи з відсутніми полями, числовими рядками, невідомими додатковими полями й legacy `paid` не повинні проходити request validation.

## Позначення полів

- `AssetInput` обов'язково: `name`, `type`, `quantity > 0`, `purchasePrice >= 0`, `purchaseDate`. Частки дозволені для `stock`, `etf`, `crypto_earn`; для решти типів кількість ціла. Необов'язково: `currency` (UAH за замовчуванням), `currentPrice`, `ticker`, `isin`, `instrumentName`, `instrumentType`, `isNewInstrument`, `dividendRecordRule` та поля відповідного типу. OVDP: `maturityDate > purchaseDate`, непорожні `coupons[{date,amountPerUnit>0}]`, optional `redemptionValue`; REIT: `dividendPerUnit>0`, `firstDividendDate >= purchaseDate`; deposit: `maturityDate`, `annualRate` у 0–1000; NovaPay: `maturityDate`, `termMonths` ціле 1–12, `maturityAmount>0`; Crypto Earn: `annualRate>0`. `earlyWithdrawal`/`isNewInstrument` — boolean. Типи активів визначає `shared/constants.js`.
- `BuyInput`: `quantity`, `purchasePrice`, `purchaseDate`; optional `currency` має збігатися з активом, `instrumentId`. Legacy aliases `price`/`date` підтримуються; канонічні поля мають пріоритет в обох реалізаціях.
- `SaleInput`: `assetId` або непорожній `assetIds`, `quantity>0`, `sellPrice>=0`, `sellDate`; optional `currency` має збігатися з активом. Якщо задано `assetIds`, використовується grouped-операція.
- `TransactionInput`: `assetId`, `type=BUY|SELL|DIVIDEND|COUPON|MATURITY`, `date`, `amount>=0`; `quantity>0` обов'язкова для BUY/SELL, optional `purchasePrice`, `currency`, `instrumentId`, `paymentId`. Income без кількості зберігає `quantity:null`. `paymentId` має належати активу й типу та не бути вже проведеним. Нова транзакція проводиться як `completed`.
- `PaymentInput`: `assetId`, `type=DIVIDEND|COUPON|MATURITY`, `date`, `amount>=0`; optional `currency`, `amountPerUnit>=0`, `status=planned`, `recordDate` лише для дивідендів і не пізніше `date`. Надсилання `received` не проводить виплату; для цього є окрема операція.
- `NoteInput`: `assetId`, `date`, непорожній `text`; optional `amount>=0`. Назва активу, ID і час створення визначаються сервером/адаптером; текст обрізається по краях, валюта UAH.
- `WalletInput`: `expenses[]`, `months{}`; optional `loans[]`. Expense: `date`, непорожня `category`, `amount>0`; optional `id`, `createdAt`, `note`. Month key: `YYYY-MM`; optional `plans{category:nonnegativeNumber}`, `customCategories[string]`, `notes[{text:string,...}]`. Loans допускають скінченні невід'ємні суми, календарні `dueDate`/`lastPaymentDate`, `manualSchedule`/`repayments` як масиви `{date,amount}`. Expense metadata для редагування зберігається; нові ID генеруються.
- `Plan`: `{targets:{groupId:number},plannedAssets:[{id,label}],excluded:[id]}`. Частки 0–100 з кроком 0,1, але чернетка не зобов'язана давати суму 100. `plannedAssets.id` починається з `planned-`, ID унікальні. `expected` — попередній Plan або `null`.

У нових записах системні ID, assetName, createdAt й обчислені фінансові результати не беруться з довільних полів вводу. Додаткові поля історичного документа зберігаються. `PUT /api/assets/:id` очікує повний `AssetInput`, а не частковий PATCH; це чинний HTTP-контракт, який тепер однаковий для native. Валюта при редагуванні за відсутності поля береться з активу.

## Mutation-операції

Спільні помилки: `VALIDATION_FAILURE/validation` — 400; `DOMAIN_FAILURE/not_found` — 404 для відсутнього запису; `STORAGE_FAILURE/storage_failure` — 503. Для HTTP також діють access/session/parser помилки з таблиці в `DATA-CONTRACT.md`. Невдала перевірка або commit не змінюють збережений snapshot. Sync-операції окремо повідомляють про локальний і віддалений результат.

| Метод і шлях | Native / facade | Вхідні поля | Успішна відповідь | Додаткові відмови |
| --- | --- | --- | --- | --- |
| POST `/api/assets` | `createAsset` | AssetInput | 201 Asset | — |
| PUT `/api/assets/:id` | `updateAsset(id,body)` | AssetInput; path ID | 200 Asset | Неприпустиме переписування історії — validation |
| POST `/api/assets/merge` | `mergeAssets(ids)` | `assetIds`: щонайменше 2 різні string ID | 200 Asset | Несумісні/закриті позиції — validation; відсутні ID — 404 |
| POST `/api/assets/:id/buy` | `buyMoreAsset(id,body)` | BuyInput; path ID | 201 `{asset,transaction}` | Валюта/точність кількості — validation |
| DELETE `/api/assets/:id` | `deleteAsset(id)` | path ID; body не потрібен | 200 `{success:true,asset}` | — |
| POST `/api/sales` | `createSale` | SaleInput | 201 `{sale,transaction,remainingQuantity}`; grouped: `{sales,transactions,remainingQuantity}` | Продаж понад залишок, несумісні активи, обмеження withdrawal — validation |
| POST `/api/transactions` | `createTransaction` | TransactionInput | 201 Transaction | Чужий/повторний paymentId, неможливий SELL — validation |
| POST `/api/payments` | `createPayment` | PaymentInput | 201 Payment зі статусом planned | Невідомий тип або спроба створити отриманий платіж — validation |
| PATCH `/api/payments/:id/received` | `markPaymentReceived(id)` | path ID; body не потрібен | 200 Payment | Повторний received/paid ідемпотентний: без другої транзакції |
| POST `/api/calendar-notes` | `createCalendarNote` | NoteInput | 201 CalendarNote | Відсутній актив — 404 |
| PUT `/api/wallet` | `saveWallet` | WalletInput | 200 Wallet | Невалідна вкладена структура — validation |
| PUT `/api/rebalance` | `saveRebalance` | `plan`, обов'язковий `expected` | 200 Plan | Застарілий expected — `SYNC_CONFLICT/conflict`, 409 |
| POST `/api/sync/google-drive`, `/api/google-drive/sync` | `syncGoogleDrive(action)` | optional `action=sync|upload|download|backup|reconnect`, default sync; HTTP alias `direction` має збігатися з action | 200 `{success,action,savedLocally,savedRemotely,backupSaved,status}` | Auth — 401; conflict — 409; remote — 502/429/504; download без файла — 404 |
| POST `/api/assets/sync-inzhur` | `syncInzhurAssets`; internal native `syncApiAssets` | body не потрібен, optional object | 200 `{synced:[],skipped:[],binanceSynced:[],binanceSkipped:[],...}` | HTTP catalog failure — remote; native може повернути partial skips. Це не підтвердження Drive upload. |
| POST `/api/session` | HTTP browser transport | body не потрібен; `X-Fino-Session: renew` і дозволений Origin/Fetch-Site | 204, HttpOnly session cookie | Невірний контекст — `DOMAIN_FAILURE/access_denied`, 403 |

Android додатково має несеріалізовані сумісні aliases полів Asset на відповіді докупівлі для старих native-викликів; її JSON і facade використовують `{asset,transaction}`. Native `persistence` і desktop save headers — метадані результату, не поля фінансового документа. ID SDK мають бути непорожніми рядками; некоректні типи відхиляються до кодування URL.

## Read-операції

Усі відповіді — 200. Query — поодинокі рядки, `startDate/endDate` — календарні дати з правильною послідовністю. SDK допускає скінченні числові query-значення й кодує їх у рядки; масиви, об'єкти, boolean і дублікати параметрів відхиляються. Для market/data із задекларованим набором query невідомі поля відхиляються до провайдера.

| GET шлях | Параметри | Відповідь / native |
| --- | --- | --- |
| `/api/data` | optional `sync=true|false`, default false; SDK options `{sync:boolean}` | Portfolio document; `getData`; facade Android також default false, explicit true очікує sync. Старий internal `mobileApi.getData()` зберігає default true. |
| `/api/assets` | — | Asset[]; на native — `getData().assets` |
| `/api/sales` | — | Sale[]; `getSales` |
| `/api/transactions` | — | Transaction[]; `getTransactions` |
| `/api/payments` | — | Payment[]; `getPayments` |
| `/api/calendar-notes` | — | CalendarNote[]; `getCalendarNotes` |
| `/api/sync/status`, `/api/google-drive/status` | — | SyncStatus; `getGoogleDriveStatus` |
| `/api/sync/preview` | — | `{local,remote,differences,plansDiffer,targetsDiffer,token}`; `getSyncConflictPreview`; explicit read-only comparison, no full financial records |
| `/api/exchange-rates` | — | `{rates,exchangeDate,source,...}`; `getExchangeRates` |
| `/api/market-data/currencies` | — | Currency catalog; `getMarketCurrencies` |
| `/api/market-data/time-series` | `symbol`; optional `interval`, `outputsize` у 1–5000, `startDate`, `endDate` | `{provider,meta,values,...}`; `getMarketTimeSeries` |
| `/api/market-data/currency-history` | `code` — foreign currency; optional `startDate`,`endDate`, default рік до поточного UTC-дня; високосний день обмежується останнім днем лютого попереднього року | `{provider:'NBU',meta,values,...}`; `getCurrencyHistory` |
| `/api/market-data/frankfurter-history` | `startDate`,`endDate`; optional `ticker=USEU|EUUS`, default USEU | History; `getFrankfurterHistory` |
| `/api/market-data/index-history` | `startDate`,`endDate`; optional `symbol`, default `.INX` | History; `getIndexHistory` |
| `/api/macroeconomics` | — | Macro series + errors map для partial failures; `getMacroeconomics` |
| `/api/macroeconomics/policy-rate` | — | `{policyRate:[]}`; `getNbuPolicyRate` |
| `/api/inzhur-assets` | — | `{assets,cached,updatedAt,...}`; desktop `getInzhurAssets`; native не надає цей каталог для ручного редагування |

Provider-specific unsupported symbols, intervals, empty series, rate limits і configuration failures зберігають свої коди/HTTP statuses; це не валідація документа. Формат error-відповіді: `{error,code,category}`, `X-Request-Id`; для sync можливе безпечне поле `status`. Деталі — `DATA-CONTRACT.md`, розділ Public API errors.

## Перевірка

`syncGoogleDrive(action, options)` accepts optional `{previewToken}` only for `upload` / `download`; HTTP sends `{action,previewToken}` to the existing sync endpoint. The token is a SHA-256 comparison fingerprint bound to both complete documents and the native account/backend Drive file scope. A changed local/cloud document returns `409 SYNC_PREVIEW_STALE` (`conflict`) before replacement and requires a fresh comparison. Malformed tokens/options return `400 VALIDATION_FAILURE` without writes. Old clients may omit the token and keep the existing endpoint semantics. Existing backup, conditional Drive writes and read-back confirmation still apply after a valid choice. The UI always obtains a preview before whole-document replacement; canceling makes no financial write. An unreadable, ambiguous or unauthorized remote document fails closed instead of offering fabricated counts.

Preview summaries contain revision, recorded update time/device and counts of assets, transactions, sales, payments/received payments, expenses, loans and notes. Per-collection differences count local-only, remote-only and changed IDs; budget/target differences are flagged separately. These are document comparisons, not an invented cross-currency portfolio valuation. Dates/devices absent in legacy data appear as unknown; a legacy `android-phone` label cannot identify a historical physical device uniquely.

`backend/tests/apiContracts.test.js` запускає реальний Express API й той самий native adapter на однакових синтетичних портфелях. Перевіряє кожну financial mutation, успіх/неправильний ввід/відмову commit, відсутні записи, baseline conflict, grouped sale, aliases покупки, sync/session, query та ID, збереження стану й читання legacy-документів. Спільний native harness лежить у `backend/tests/helpers/nativeHarness.js`; окремі фінансові, API, sync, document та UI regression tests залишаються чинними. APK і Git-публікація не є частиною цього завдання.
