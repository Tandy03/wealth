# Ідемпотентність фінансових команд

Нові web/native клієнти передають необов'язковий `operationId` у JSON команди. ID генерується через secure UUID/WebCrypto, а не з фінансових полів чи часу. Він не містить токенів або OAuth-даних. Старі клієнти й документи без цього поля підтримуються; запит без ID зберігає попередню семантику.

## Які команди захищені

| Команда | HTTP / аргументи native | Що створює |
| --- | --- | --- |
| `createAsset` | `POST /api/assets`, `createAsset(body)` | Актив, початковий BUY, графік виплат |
| `buyMoreAsset` | `POST /api/assets/:id/buy`, `buyMoreAsset(id, body)` | Додатковий BUY |
| `createSale` | `POST /api/sales`, `createSale(body)` | Single/grouped SELL та записи результату |
| `createTransaction` | `POST /api/transactions`, `createTransaction(body)` | BUY/SELL/income transaction і пов'язані записи |
| `createPayment` | `POST /api/payments`, `createPayment(body)` | Запланований платіж |
| `createCalendarNote` | `POST /api/calendar-notes`, `createCalendarNote(body)` | Нотатка, у тому числі з фінансовою сумою |
| `mergeAssets` | `POST /api/assets/merge` з `{assetIds, operationId}`, `mergeAssets(ids, {operationId})` | Консолідація позицій/історії; повтор повертає початковий результат, навіть якщо вторинні ID вже вилучені |
| `markPaymentReceived` | `PATCH /api/payments/:id/received` з `{operationId}`, `markPaymentReceived(id, {operationId})` | Перехід виплати й один income transaction |

Для нової команди потрібен новий ID. Повтор із цим ID має передати той самий зміст і target ID. Однакові за сумою й датою **нові** покупки мають різні ID й виконуються окремо. SDK не визначає дублі за однаковими фінансовими полями.

PUT asset/wallet/rebalance, DELETE та sync не отримали нового ID-контракту: вони не створюють новий торговий факт тим самим способом. Wallet передає повний snapshot, rebalance зберігає baseline-конфлікти, а sync зберігає чинну семантику версій. Creation `operationId` активу не змінюється при редагуванні.

## Зберігання й перевірка

У document schema version 1 додано **необов'язковий** масив `operations`:

```json
{
  "operationId": "unique-command-id",
  "kind": "buyMoreAsset",
  "target": "asset-id",
  "command": {"quantity": 2, "purchasePrice": 100, "purchaseDate": "2026-01-01"},
  "createdAt": "2026-01-01T12:00:00.000Z",
  "result": {"asset": {"id": "asset-id"}, "transaction": {"id": "tx-id"}}
}
```

Це скорочений приклад форми; `result` містить оригінальний JSON результату, а не лише ID з прикладу. Він потрібен, щоб повернути попередню відповідь після наступних докупівель, редагування, merge чи видалення активу. Нова транзакція/продаж/платіж також отримує `operationId`; для переходу платежу використовується окремий `receivedOperationId`. Один command ID може пов'язувати кілька записів одного факту (наприклад SELL і transaction), але квитанція для нього одна.

`shared/operations.js` містить однакові правила для Node та браузера/native. Сигнатура порівнює kind, target та канонічний зміст: порядок object keys не важливий, числові рядки прирівнюються до чисел, валюти нормалізуються, note text обрізається, price/date aliases покупки переходять у канонічні поля, множини assetIds й купони впорядковуються. Невідомі/згенеровані поля, які команда не приймає, не стають частиною її фінансового змісту. Request validation продовжує відхиляти некоректні дати/числа. Document validation окремо перевіряє ID, унікальність квитанцій, їхню структуру й записані результати без повторної валідації історичних команд за правилами нового створення.

Всередині **тієї самої** repository/native mutation queue:

1. Немає квитанції — команда змінює приватний snapshot, квитанція додається до нього й усе зберігається одним commit.
2. Є повна квитанція з тим самим змістом — повертається її JSON result; немає нового save, revision, фінансового факту або upload, спричиненого повтором. Після компактування повертається `409 OPERATION_RESULT_EXPIRED`, теж без запису.
3. ID використано для іншого змісту, target або kind — `409`, `OPERATION_ID_CONFLICT`, category `conflict`, без зміни документа. HTTP повертає чинний error contract і request ID.
4. У документі лишився tagged fact, але його квитанцію втрачено при сторонньому редагуванні/імпорті — `409 OPERATION_RECEIPT_MISSING`, замість дублювання факту.

Backend використовує `domain/mutation.js`: command-scoped snapshot передається в `commandStorage`, а внутрішній save відкладається до формування result/receipt. Фізичний repository save виконується один раз і не додає другого read. AsyncLocalStorage ізолює приватний command snapshot від паралельних HTTP-читань. Для старого запиту без ID залишається звичайний save шлях. Native додає receipt до приватного draft перед журналом; невдалий commit відновлює попередні data/sync metadata, включно з відсутністю незбереженої квитанції.

Квитанції входять до journal, backup і Drive JSON. ID не видаляють разом з активом і не очищають за TTL: інакше старий retry міг би створити факт повторно. Повний результат зберігається у replay-вікні нижче. Старий документ без `operations` або `operationId` проходить document validation. Після передачі повного документа інший клієнт розпізнає ID. Розбіжні offline snapshots як і раніше потребують чинного whole-document conflict resolution; автоматичного об'єднання фінансових фактів не додано.

## Replay: 30 днів і tombstone

`REPLAY_DAYS = 30` у `shared/operations.js`: строк рахується від timestamp створення квитанції на стороні виконавця (backend або native domain adapter), у UTC календарних днях, зі збереженням часу доби. На межі 30 днів квитанція може бути компактована. Новий локальний commit виконує детермінований `compact(snapshot)` після формування business result/receipt та до атомарного snapshot+journal запису. Окремих таймерів, фонових commits або upload для compaction немає. Read/replay не запускає maintenance-запис; ще не компактований повний result може бути доступний довше, до наступного commit.

Після compaction лишаються лише `operationId`, `fingerprint` (SHA-256 канонічних `[kind, target, command]`), `createdAt`, `expired:true` та, за потреби, трилітерний `defaultCurrency`. Останнє поле зберігає попередню еквівалентність пропущеної й явно заданої валюти після видалення result. Повні command/result не дублюються під іншими полями. Повторна compaction нічого не змінює. Квитанції молодші 30 днів, включно з командами, що могли лишитися outcome-unknown в outbox, не компактуються.

Той самий ID і зміст → `409 OPERATION_RESULT_EXPIRED`, категорія `conflict`; інший зміст → `409 OPERATION_ID_CONFLICT`. Жодна гілка не виконує фінансову операцію повторно. Клієнт позначає expired команду `confirmed` з відповідним кодом, завантажує поточний документ і показує пояснення; новий ID автоматично не генерується. Tombstone залишається в schema version 1; зайві поля, пошкоджений відбиток чи неправильна структура відхиляються document validation.

Tombstone накопичуються без TTL. Без нового протоколу їх не можна безпечно видаляти. Вимірювання на 1 000 репрезентативних purchase receipts: **667 781 → 188 891 байт, −71,7%**. Тест закріплює скорочення **щонайменше на 60%**; активи, операції, виплати, wallet і rebalance під час compaction незмінні. Старі recovery snapshots у journal/backups можуть ще містити повні квитанції за чинною політикою збереження історії; compaction поточного документа не знищує резервні копії.

## Життєвий цикл клієнтського ID

Desktop і mobile SDK створюють ID перед викликом writer; session renewal повторює вже сформоване тіло запиту. Виклик із явним ID використовує саме його. У застосунку facade обгорнутий довговічним `frontend/js/api/outbox.js`; низькорівневі SDK без цієї обгортки зберігають стару WeakMap-семантику й потребують явного ID для програмного повтору з новим object instance.

Форми використовують `financialCommand`: зберігають ID до успішного завершення/reset, а помилка не очищає ввід. У приватному кеші й outbox зберігаються окремі копії; caller-owned об'єкти не можуть змінити збережений запит. Зміна змісту після однозначної відмови є новим наміром із новим ID. Якщо та сама форма має pending/outcome-unknown команду, нова команда з її slot блокується `OUTBOX_PENDING_COMMAND` навіть після reset або перезапуску. Користувач спершу відновлює оригінальний запит через recovery panel. Відновлення не заповнює форму й не перераховує payload із поточного портфеля. Asset acquisition також зберігає вибір create/buy. Нові незалежні команди з ідентичними фінансовими полями й новими ID дозволені.

## Локальний outbox

Outbox зберігає `operationId`, method, target, точний body, scope, createdAt, lastAttemptAt, state, lastErrorCode та необов'язковий ключ форми. Це локальне відновлення команд, не другий фінансовий журнал і не частина Drive JSON. У ньому є фінансові поля введеної команди; credentials/OAuth/proxy tokens не записуються. Відомі credential fields відхиляються до збереження. Не публікуйте вміст localStorage або native app storage як діагностичний звіт.

Desktop використовує localStorage з ключем `fino-command-outbox-v1:<encoded scope>`, scope `desktop:<location.origin>`: localhost і 127.0.0.1, різні протоколи та порти ізольовані. Де доступний Web Locks API, короткі read/modify/write секції додатково координуються між вкладками. Native використовує чинний FinoStorage/Preferences із scope `android:<normalized email>:<local storage key>`. Розв'язання native scope читає локальний акаунт, не отримує мережевий токен для відновлення.

| Стан | Поведінка |
| --- | --- |
| `queued` | Запис гарантовано збережено перед відправленням |
| `in-flight` | Спроба почалася; після перезапуску перетворюється на outcome-unknown |
| `outcome-unknown` | Мережа/перезапуск або невдалий запис підтвердження; можна повторити тільки початковий ID/body |
| `confirmed` | Позитивний result спочатку збережено, потім запис прибирається; crash між цими кроками залишає завершений запис без повторного send |
| `rejected` | Validation/access/auth/storage/not-found відмова; автоматичного повтору немає |
| `conflict` | Конфлікт ID/стану; автоматичного повтору немає |

Автоматичних фінансових retry після запуску немає: panel **Command recovery** показує pending записи й кнопку **Retry original command** для queued/outcome-unknown. Повтор не створює нового ID, body не перераховується, scope перевіряється перед відправленням та перед native mutation. Rejected/conflict можна прибрати вручну й після аналізу причини почати новий намір. Для expired replay лишається пояснення коду та можливість прибрати завершений запис після reload. Якщо відповідь приходить після зміни акаунта, підтвердження зберігається у вихідному scope й не видається за успіх нового акаунта.

При перемиканні акаунта записи іншого scope не відправляються й не видаляються; повернення до нього знову відкриває recovery. Logout/reconnect не очищує outbox. Очищення browser site data, Android app data або видалення застосунку **втрачає локальні незавершені команди**. Серверні/Drive receipts залишаються, якщо вже були збережені, але це не відновлює точний локальний payload автоматично.

Пошкоджений документ не відправляється й не переписується. Поряд з ним зберігаються лише безпечні діагностичні метадані `:diagnostic` (code, detectedAt), без фінансового body чи токенів; UI показує `OUTBOX_CORRUPT_RECORD`. Помилка локального збереження outbox → `OUTBOX_STORAGE_FAILURE`, без першого send; якщо backend/native commit уже відбувся, попередній durable запис лишається для відновлення з тим самим ID. У логи payload не потрапляє.

`received` має також природний захист за payment ID: отримана виплата не створює ще один дохід навіть без operationId або з новим ID переходу. Уже записаний income operationId не переписується. Generic income transaction і received endpoint використовують ту саму прив'язку paymentId. Native legacy no-op не створює новий local commit.

## Перевірки

`commandOutbox.test.js` перевіряє outbox до HTTP send, commit у справжньому repository/journal, втрату відповіді, restart backend і client на тому самому origin, purchase/grouped sale replay без нового commit. Native сценарій перезапускає реальний adapter зі збереженим account-scoped journal/storage й перевіряє відсутність другого факту та upload. UI smoke додатково перезапускає реальний HTML web/native з outbox, зберігає ID/body та відхиляє редаговану заміну невідомої команди. Тестуються пошкоджені записи, in-flight recovery, scope switch, rejected retry та незалежні нові ID. `receiptCompaction.test.js` перевіряє SHA-256 проти Node crypto, межу 30 днів, розмір 1 000 receipts, атомарне збереження та передачу tombstone між платформами.

`idempotency.test.js` перевіряє перше виконання, чотири конкурентні повтори, нормалізований replay, конфліктний payload/kind/target, невдале збереження, справжній перезапуск JSON repository/native adapter, Drive upload/download, збереження історії після видалення активу, старі документи, immutable creation ID та received без повторного income. UI smoke для web і native симулює втрату відповіді **після commit** і повторює форму: у документі залишається один додатковий BUY. Чинні фінансові результати й API shapes збережені; нові metadata необов'язкові для старих клієнтів.
