# Портфельні use cases і mutation queue

`backend/domain/portfolioService.js` вилучено після переходу маршрутизаторів і тестів на окремі сервіси. Публічні HTTP method/path, status codes, поля відповідей і фінансові правила збережені. Нормалізацію й міграції імпортують із `backend/domain/state.js`; колишні агреговані exports більше не потрібні.

## Межі сервісів

Усі factories приймають `repository`; лише синхронізація додатково приймає market providers. Factory створює залежності, не читає файл і не викликає мережу.

| Сервіс | Команда / вхід | Результат і відповідальність | Помилки / залежності |
| --- | --- | --- | --- |
| `assetService` | `getAssets()` | Нормалізований масив активів; без запису й входу в mutation queue | `readState`, state validation, помилки сховища |
| `assetService` | `createAsset(AssetInput)` | Створений Asset. Актив, необов'язковий instrument, початковий BUY і майбутній графік зберігаються одним commit | Request/asset validation, `shared/portfolio-rules`, constants, IDs, repository |
| `assetService` | `updateAsset(id, AssetInput)` | Оновлений Asset; редагування умов/назв, дозволеної початкової покупки, оновлення майбутніх виплат зі збереженням історії | Валідація; 404 для відсутнього активу; заборона переписування історії після докупівель/продажів; repository |
| `assetService` | `deleteAsset(id)` | `{success:true, asset}`; видалення активу та пов'язаних записів одним commit | 404; repository |
| `purchaseService` | `buyMoreAsset(id, BuyInput)` | `{asset, transaction}`; створення додаткового BUY, історична кількість, залишок і його собівартість, майбутні виплати | Request/purchase/currency validation, 404, shared rules, repository |
| `saleService` | `getSales()` | Масив продажів; без запису й mutation queue | `readState`, помилки сховища |
| `saleService` | `sellAsset(SaleInput)` | Single: `{sale, transaction, remainingQuantity}`. Grouped: `{sales, transactions, remainingQuantity}`. Перевірка доступної кількості на дату, moving-average cost basis, запис результату й корекція майбутніх виплат | Request/currency/quantity/date validation; 404; обмеження дострокового зняття; shared rules і `calculations.saleFinancials`; repository |
| `assetMergeService` | `mergeAssets(ids[])` | Об'єднаний Asset; перевірка identity, перенесення історії й received payments, перебудова майбутнього графіка | Щонайменше два різні ID, 404, несумісність назви/типу/instrument/currency/ISIN/ticker/умов, закриті позиції; shared rules; repository |
| `assetSyncService` | `syncAssets()` | Чинний `{synced, skipped, binanceSynced, binanceSkipped, note}` | Injected `getInzhurCatalogAssets`, optional `getTokenizedEquityPrice`; для останнього є чинний production default. Зовнішні запити до входу в queue, застосування до свіжого snapshot усередині |

Початковий BUY залишається частиною **створення активу**: це одна атомарна операція, а не виклик queued purchase service всередині queued asset service. Окремий `purchaseService` проводить докупівлю. Спільні кількості, середня ціна/собівартість, дивідендне право, merge identity й графіки залишаються в `shared/portfolio/`; сервіси не містять копій цих правил.

Валідація повертає чинні `VALIDATION_FAILURE` / `validation` (400), відсутній запис — `DOMAIN_FAILURE` / `not_found` (404), помилка локального commit — `STORAGE_FAILURE` / `storage_failure` (503). Typed conflict/auth/provider errors зберігають свої коди й статуси. HTTP-адаптер sync як і раніше перетворює загальний збій провайдера в безпечну endpoint-specific помилку; пропущені Binance-позиції залишаються частиною успішної часткової sync-відповіді. JSON error contract і request ID не змінені; див. `API-CONTRACT.md`.

## Єдиний власник черги

```text
HTTP router → service command → domain/mutation.js → repository.runMutation
                                                → read/validate/change/save → result
```

`backend/domain/mutation.js` — єдине application-level місце виклику `repository.runMutation`. `mutationCommands(repository, operations)` загортає повну команду один раз. Звичайні asset/purchase/sale/merge commands читають свіжий приватний документ, виконують перевірки й зберігають його один раз усередині цього entry. Допоміжні rules працюють із цим документом і не беруть чергу.

Для фінансових команд із `operationId` helper використовує `commandStorage`: один command-scoped read, відкладений внутрішній save і один фізичний commit результату разом із квитанцією. Повтор перевіряється в цій самій queue до зміни даних. Вхід у queue не дублюється; replay не робить save. Контракт — [IDEMPOTENCY.md](IDEMPOTENCY.md).

Синхронізація спочатку завантажує catalog/quotes, а потім викликає `runMutation(repository, apply)` для короткого застосування до свіжих holdings. Calendar/payment/transaction/wallet/rebalance services і коротке застосування Drive download використовують той самий helper і ту саму repository queue. Внутрішня ініціалізація repository використовує її власний `runMutation`; іншої черги helper не створює.

Router приймає HTTP-параметри, викликає injected service і формує response; він не отримує queue wrapper і не робить фінансових розрахунків. Невикористаний `backend/routes/mutation.js` вилучений. Не обгортайте queued service у ще один queue entry і не викликайте одну queued command з іншої: залежні зміни мають працювати з одним приватним snapshot і одним commit. Відхилена команда не блокує наступні записи.

## Перевірки без реальних даних

`portfolioServices.test.js` використовує memory repository і тестовий `AsyncLocalStorage` guard: вкладений queue entry одразу спричиняє помилку, замість зависання. Перевіряються HTTP-відповіді й рівно один entry/commit на успішний запис, відсутність commit після помилки, конкурентні продажі без oversell, конкурентні докупівлі без втрат, merge/delete race, rollback при storage failure та продовження черги після відмови. Catalog і Binance quote ін'єктуються; завислі provider-запити не затримують інші записи й не перетирають нові holdings.

Існуючі API, фінансові, repository, migration/state-model і UI тести використовують нові factories без зміни очікуваних фінансових результатів. `backend/tests/helpers/portfolioServices.js` лише складає кілька сервісів для наскрізних тестових сценаріїв; production його не імпортує.
