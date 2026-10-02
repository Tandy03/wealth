# Fino — трекер інвестицій і особистих фінансів

Fino має вебверсію з локальним Node.js backend та Android-застосунок на Capacitor. Вебверсія зберігає портфель у JSON-файлі; Android працює з власною локальною копією та Google Drive.

## Можливості

- Портфель: ОВДП, REIT, акції, ETF, заощадження, депозити, NovaPay і Crypto Earn.
- Додавання, редагування, докупівля, продаж, видалення та об’єднання однакових активів.
- Історія операцій і цін, календар купонів, дивідендів, погашень та нотаток.
- Позначення отриманих виплат і закриття активу після погашення.
- Dashboard із поточною вартістю активів у картці Portfolio, прибуток, XIRR, структура портфеля, історична дохідність і калькулятор ребалансування.
- Особистий бюджет: витрати, категорії, місячний архів, графіки й кредити.
- Ринкові графіки, валютна історія, макроекономічні показники.
- Теми, налаштування шрифту та мови; PIN і біометричне розблокування Android.
- Синхронізація з Google Drive; desktop backend також створює резервні копії.

## Вимоги

- Node.js **22 або новіший** і npm (таку мінімальну версію вимагає встановлений Capacitor CLI).
- Для Android: JDK 21, Android SDK із платформою API 36; Android Studio зручна для налаштування SDK і запуску на пристрої.
- Мінімальна версія Android: 7.0 / API 24.

## Запуск вебверсії

З кореня проєкту:

~~~powershell
npm install
Copy-Item .env.example .env
npm run dev
~~~

Копіюйте приклад лише якщо власного .env ще немає. Відкрийте **http://localhost:3000**. Для запуску без автоматичного перезапуску використовуйте npm start. Порт можна змінити змінною PORT.

Локальне ведення портфеля не потребує API-ключів. Доступність ринкових даних і синхронізації залежить від відповідних налаштувань та мережі.

## Структура backend

~~~text
backend/
  server.js                 # Завантаження .env і запуск HTTP-сервера
  app.js                    # Middleware, складання сервісів і підключення маршрутизаторів
  routes/
    assets.js               # Активи, докупівля, об’єднання, оновлення цін
    sales.js                # Продажі
    payments.js             # Виплати та позначення отримання
    calendar.js             # Нотатки календаря
    wallet.js               # Особистий бюджет
    market.js               # Ринкові й макроекономічні дані
    transactions.js         # Історія операцій
    data.js                 # Повний документ даних
    sync.js                 # Google Drive і сумісні адреси API
    mutation.js             # HTTP-адаптер спільної черги запису
  services/
    *Service.js             # Операції над портфелем; без req/res
    portfolio.js            # Кількості, виплати, історія цін і сумісність старих даних
    binance/                # Зовнішні інтеграції
    twelveData/
    nbu/
    frankfurter/
    fred/
    macroeconomics/
    googleDrive/
  data/
    repository.js           # Читання JSON, атомарний запис, ревізії, черга змін
    data.json               # Локальні фінансові дані; не входить до Git
  validators/               # Валідація дат, кількостей і базових полів активів
  utils/                    # Числа, валюти, ID та очікувані помилки операцій
  config/                   # Завантаження .env і локальні Google OAuth-файли
  scripts/                  # Google-авторизація й генерація Android-конфігурації
  tests/                    # Модульні й HTTP-регресійні тести
frontend/                   # HTML, CSS, JavaScript і зображення
android/                    # Capacitor-проєкт і власні Java-плагіни
apps-script/                # Proxy для ринкових даних Android
~~~

Потік запиту: **route → service → repository / зовнішня інтеграція**. Маршрути відповідають за HTTP-параметри, коди й JSON-відповіді. Сервіси виконують операції та фінансові розрахунки. Усі HTTP-зміни, включно із завантаженням копії з Drive, проходять через одну чергу repository.

createApp({ repository }) дозволяє запускати API з ізольованим сховищем у тестах. Прямі виклики сервісів, що змінюють дані, потрібно виконувати всередині repository.runMutation().

## API

Адреси й формати відповідей збережені після поділу backend на модулі.

| Група | Основні адреси |
| --- | --- |
| Дані | GET /api/data |
| Активи | GET/POST /api/assets, PUT/DELETE /api/assets/:id |
| Докупівля / об’єднання | POST /api/assets/:id/buy, POST /api/assets/merge |
| Оновлення цін | POST /api/assets/sync-inzhur |
| Продажі | GET/POST /api/sales |
| Операції | GET/POST /api/transactions |
| Виплати | GET/POST /api/payments, PATCH /api/payments/:id/received |
| Календар | GET/POST /api/calendar-notes |
| Бюджет | PUT /api/wallet; читання через GET /api/data |
| Ринок | GET /api/exchange-rates, /api/inzhur-assets, /api/market-data/* |
| Макроекономіка | GET /api/macroeconomics, /api/macroeconomics/policy-rate |
| Синхронізація | GET /api/sync/status, POST /api/sync/google-drive |

Сумісні адреси /api/google-drive/status і /api/google-drive/sync також доступні. Редагування активу через PUT передбачає повний набір основних полів, а не довільний частковий patch.

## Налаштування інтеграцій

Змінні описані у [.env.example](.env.example):

| Змінна | Призначення |
| --- | --- |
| TWELVE_DATA_API_KEY | Історія цін Twelve Data |
| FRED_API_KEY | Історія фондових індексів |
| BINANCE_API_KEY | Дані ринку токенізованих акцій |
| FINO_PROXY_URL | Опублікований Apps Script URL, що закінчується /exec |
| FINO_PROXY_TOKEN | Proxy-токен, щонайменше 32 символи |
| GOOGLE_DRIVE_SYNC_ENABLED | Увімкнення desktop-синхронізації: true / false |
| GOOGLE_DRIVE_CREDENTIALS_PATH | Шлях до Google OAuth credentials |
| GOOGLE_DRIVE_TOKEN_PATH | Шлях до локального refresh token |
| GOOGLE_DRIVE_STATE_PATH | Локальні метадані синхронізації |
| GOOGLE_DRIVE_FILE_ID / GOOGLE_DRIVE_FILE_NAME | Файл портфеля на Drive |
| GOOGLE_DRIVE_DEVICE_ID | Ідентифікатор desktop-пристрою |
| GOOGLE_DRIVE_BACKUP_FOLDER_NAME / GOOGLE_DRIVE_BACKUP_RETENTION | Папка й кількість резервних копій |

НБУ, Inzhur і Frankfurter використовуються без ключів. Деякі макроекономічні дані завантажуються з офіційних джерел України.

### Google Drive у вебверсії

1. Налаштуйте Google OAuth client із доступом до Drive API та збережіть credentials у backend/config/google-credentials.json.
2. Виконайте npm run google-auth і пройдіть авторизацію. Використовується scope drive.file.
3. У .env задайте GOOGLE_DRIVE_SYNC_ENABLED=true та за потреби ID файлу.
4. Перезапустіть backend.

Основний файл за замовчуванням — fino-data.json; резервні копії desktop backend зберігає в fino-backups, за замовчуванням залишає 10. За помилки початкової синхронізації backend використовує локальну копію. Статус і ручні дії доступні через інтерфейс налаштувань та API.

### Ринковий proxy для Android

Налаштуйте й опублікуйте Apps Script за [інструкцією](apps-script/README.md), задайте FINO_PROXY_URL і FINO_PROXY_TOKEN у .env. Proxy-токен повинен збігатися з FINO_PROXY_TOKEN у Script Properties. Ключі ринкових провайдерів налаштовуються у Script Properties.

## Android

~~~powershell
npm run mobile:sync
npm run mobile:open
npm run mobile:build
~~~

mobile:sync генерує frontend/js/mobile-config.generated.js і копіює вебресурси та конфігурацію через Capacitor. mobile:build повторює sync, потім збирає debug APK. Команда mobile:apk є її псевдонімом.

APK: android/app/build/outputs/apk/debug/app-debug.apk.

Android не запускає Node.js backend. frontend/js/api.js делегує операції mobile-api.js; дані зберігаються через Capacitor Preferences окремо для Google-акаунта та синхронізуються з Drive. Авторизація виконується власним GoogleDriveAuthPlugin; для іншого пакета або підпису застосунку потрібне відповідне налаштування Android OAuth client. PIN і біометрію реалізовано в MainActivity та AppLockPlugin.

Зміни лише в backend не потребують нового APK. Після змін frontend необхідно виконати mobile:sync і перебудувати застосунок.

## Перевірки

~~~powershell
npm test
~~~

Тести перевіряють нормалізацію даних провайдерів, історичну дохідність, FIFO, валютні курси, Crypto Earn, допоміжну логіку Drive та HTTP-сценарії портфеля, виплат, бюджету й паралельного запису. Окремі тести перевіряють мобільні конфлікти ревізій, незавантажені зміни, offline, резервні копії, погашення та відображення поточної вартості. Також перевіряються зміна акаунта посеред операції, пошкоджений JSON, повторне створення Drive-файлу після помилки, паралельні запити першого запуску та одночасне читання й запис мобільних даних. HTTP-тести використовують тимчасовий JSON і підмінений Drive, не змінюють особистий портфель.

Збірка Android, реальна Google-авторизація й робота зовнішніх API потребують окремої перевірки.

## Збереження даних і поточні обмеження

- Вебдані зберігаються в backend/data/data.json; записи виконуються через тимчасовий файл і перейменування. Перед ручним перенесенням даних зупиніть backend і збережіть копію JSON.
- Desktop backend призначений для особистого використання. API наразі не має авторизації, CORS відкритий, сервер слухає порт без обмеження на localhost. Доступність із мережі залежить від firewall і налаштувань оточення.
- Android і backend мають окремі реалізації бізнес-правил. Для нових фінансових операцій потрібно перевіряти обидві реалізації; погашення та заборона продажу закритих ОВДП покриті регресійними тестами.
- Мобільна синхронізація зберігає останню спільну копію та стан незавантажених змін окремо для кожного Google-акаунта. Конфлікт не замінює жодну копію автоматично: виберіть Upload або Download; перед заміною створюється резервна копія. Backup створює окремий JSON у fino-backups. Помилки фонового завантаження й очікування відображаються у статусі. Новий Drive-файл створюється разом із JSON одним запитом; зміна акаунта посеред операції зупиняє її, зберігаючи локальні дані.
- Автоматичного об’єднання конфліктних змін немає. Після оновлення зі старої версії невідома історія синхронізації обробляється обережно: якщо копії відрізняються, потрібен ручний вибір. Умовний запис використовує ETag, коли Drive повертає його; перед перезаписом віддалена копія також резервується.
- POST /api/transactions і POST /api/payments перевіряють актив, тип, дату, суму й валюту; ID, час створення та назву активу формує backend. Дробова кількість дозволена для акцій, ETF і Crypto Earn. Нові виплати мають статус planned; отримання записується окремим endpoint.
- .env, OAuth credentials і refresh tokens не слід додавати до Git. Згенерований proxy-токен входить до APK і доступний серед вебресурсів; він не є надійним механізмом автентифікації окремого користувача.
