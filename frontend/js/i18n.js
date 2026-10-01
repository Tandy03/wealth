(function () {
  const languages = ["en", "de", "uk", "es", "pl", "it"];
  const rows = [
    ["Settings","Einstellungen","Налаштування","Ajustes","Ustawienia","Impostazioni"],
    ["Language","Sprache","Мова","Idioma","Język","Lingua"],
    ["Investment","Investitionen","Інвестиції","Inversión","Inwestycje","Investimenti"],
    ["Wallet","Haushalt","Гаманець","Cartera","Portfel","Portafoglio"],
    ["Dashboard","Übersicht","Головна","Panel","Pulpit","Dashboard"],
    ["Portfolio","Portfolio","Портфель","Cartera","Portfel","Portafoglio"],
    ["Transactions","Transaktionen","Транзакції","Transacciones","Transakcje","Transazioni"],
    ["Calendar","Kalender","Календар","Calendario","Kalendarz","Calendario"],
    ["Analytics","Analysen","Аналітика","Analítica","Analityka","Analisi"],
    ["Rebalance","Neugewichtung","Ребаланс","Reequilibrio","Rebalans","Ribilanciamento"],
    ["Market","Markt","Ринок","Mercado","Rynek","Mercato"],
    ["Macroeconomics","Makroökonomie","Макроекономіка","Macroeconomía","Makroekonomia","Macroeconomia"],
    ["Current","Aktuell","Поточні","Actual","Bieżące","Corrente"],
    ["Archive","Archiv","Архів","Archivo","Archiwum","Archivio"],
    ["Recorded expenses","Erfasste Ausgaben","Записані витрати","Gastos registrados","Zapisane wydatki","Spese registrate"],
    ["Personal expenses","Persönliche Ausgaben","Особисті витрати","Gastos personales","Wydatki osobiste","Spese personali"],
    ["Record expense","Ausgabe erfassen","Записати витрату","Registrar gasto","Dodaj wydatek","Registra spesa"],
    ["Budget","Budget","Бюджет","Presupuesto","Budżet","Budget"],
    ["Expense category","Ausgabenkategorie","Категорія витрат","Categoría de gasto","Kategoria wydatku","Categoria di spesa"],
    ["Plan","Plan","План","Piano","Plan","Piano"],
    ["Percentage","Prozentsatz","Відсоток","Porcentaje","Procent","Percentuale"],
    ["Actual amount","Tatsächlicher Betrag","Фактична сума","Importe real","Kwota rzeczywista","Importo effettivo"],
    ["Balance","Saldo","Баланс","Saldo","Saldo","Saldo"],
    ["Actual percentage","Tatsächlicher Anteil","Фактичний відсоток","Porcentaje real","Rzeczywisty procent","Percentuale effettiva"],
    ["Expenses","Ausgaben","Витрати","Gastos","Wydatki","Spese"],
    ["Expense charts","Ausgabendiagramme","Графіки витрат","Gráficos de gastos","Wykresy wydatków","Grafici delle spese"],
    ["Monthly series","Monatsreihe","Місячний ряд","Serie mensual","Seria miesięczna","Serie mensile"],
    ["Total","Gesamt","Разом","Total","Razem","Totale"],
    ["Notes","Notizen","Нотатки","Notas","Notatki","Note"],
    ["Loans","Kredite","Позики","Préstamos","Pożyczki","Prestiti"],
    ["Add asset","Anlage hinzufügen","Додати актив","Añadir activo","Dodaj aktywo","Aggiungi attività"],
    ["Total invested","Gesamt investiert","Усього інвестовано","Total invertido","Łącznie zainwestowano","Totale investito"],
    ["Portfolio value today","Portfoliowert heute","Вартість портфеля сьогодні","Valor actual de la cartera","Dzisiejsza wartość portfela","Valore odierno del portafoglio"],
    ["Profit","Gewinn","Прибуток","Beneficio","Zysk","Profitto"],
    ["Return","Rendite","Дохідність","Rentabilidad","Stopa zwrotu","Rendimento"],
    ["Upcoming cash flows","Bevorstehende Zahlungsströme","Майбутні грошові потоки","Próximos flujos de caja","Nadchodzące przepływy","Flussi di cassa futuri"],
    ["Buy","Kaufen","Купити","Comprar","Kup","Acquista"],
    ["Sell asset","Anlage verkaufen","Продати актив","Vender activo","Sprzedaj aktywo","Vendi attività"],
    ["Edit","Bearbeiten","Редагувати","Editar","Edytuj","Modifica"],
    ["Delete","Löschen","Видалити","Eliminar","Usuń","Elimina"],
    ["Date","Datum","Дата","Fecha","Data","Data"],
    ["Asset","Anlage","Актив","Activo","Aktywo","Attività"],
    ["Type","Typ","Тип","Tipo","Typ","Tipo"],
    ["Quantity","Menge","Кількість","Cantidad","Ilość","Quantità"],
    ["Amount","Betrag","Сума","Importe","Kwota","Importo"],
    ["ROI","ROI","ROI","ROI","ROI","ROI"],
    ["Price growth","Kursgewinn","Зростання ціни","Crecimiento del precio","Wzrost ceny","Crescita del prezzo"],
    ["Sales profit","Verkaufsgewinn","Прибуток від продажів","Beneficio de ventas","Zysk ze sprzedaży","Profitto dalle vendite"],
    ["Dividends","Dividenden","Дивіденди","Dividendos","Dywidendy","Dividendi"],
    ["Coupons","Kupons","Купони","Cupones","Kupony","Cedole"],
    ["Maturity","Fälligkeit","Погашення","Vencimiento","Wykup","Scadenza"],
    ["Total profit","Gesamtgewinn","Загальний прибуток","Beneficio total","Łączny zysk","Profitto totale"],
    ["Profit by asset","Gewinn nach Anlage","Прибуток за активами","Beneficio por activo","Zysk według aktywów","Profitto per attività"],
    ["Profit by type","Gewinn nach Typ","Прибуток за типами","Beneficio por tipo","Zysk według typu","Profitto per tipo"],
    ["Portfolio investment dynamics","Portfolioentwicklung","Динаміка портфеля","Dinámica de la cartera","Dynamika portfela","Andamento del portafoglio"],
    ["Cumulative portfolio profit","Kumulierter Portfoliogewinn","Накопичений прибуток портфеля","Beneficio acumulado de la cartera","Skumulowany zysk portfela","Profitto cumulativo del portafoglio"],
    ["Appearance","Darstellung","Вигляд","Apariencia","Wygląd","Aspetto"],
    ["Color theme","Farbschema","Колірна тема","Tema de color","Motyw kolorystyczny","Tema colore"],
    ["Font","Schriftart","Шрифт","Fuente","Czcionka","Carattere"],
    ["Dark","Dunkel","Темна","Oscuro","Ciemny","Scuro"],
    ["Light","Hell","Світла","Claro","Jasny","Chiaro"],
    ["Monochromatic","Monochrom","Монохромна","Monocromático","Monochromatyczny","Monocromatico"],
    ["Analog","Analog","Аналогова","Análogo","Analogowy","Analogo"],
    ["Unlock by biometric","Biometrisch entsperren","Розблокування біометрією","Desbloqueo biométrico","Odblokowanie biometryczne","Sblocco biometrico"],
    ["Server & Google Drive","Server & Google Drive","Сервер і Google Drive","Servidor y Google Drive","Serwer i Google Drive","Server e Google Drive"],
    ["Sync now","Jetzt synchronisieren","Синхронізувати","Sincronizar ahora","Synchronizuj teraz","Sincronizza ora"],
    ["Download from Drive","Von Drive herunterladen","Завантажити з Drive","Descargar de Drive","Pobierz z Drive","Scarica da Drive"],
    ["Upload to Drive","Zu Drive hochladen","Вивантажити в Drive","Subir a Drive","Prześlij do Drive","Carica su Drive"],
    ["Reconnect","Neu verbinden","Перепідключити","Reconectar","Połącz ponownie","Riconnetti"],
    ["Create backup","Sicherung erstellen","Створити резервну копію","Crear copia de seguridad","Utwórz kopię zapasową","Crea backup"],
    ["Account","Konto","Обліковий запис","Cuenta","Konto","Account"],
    ["Log out","Abmelden","Вийти","Cerrar sesión","Wyloguj","Esci"],
    ["Save","Speichern","Зберегти","Guardar","Zapisz","Salva"],
    ["Cancel","Abbrechen","Скасувати","Cancelar","Anuluj","Annulla"],
    ["Close","Schließen","Закрити","Cerrar","Zamknij","Chiudi"],
    ["Apply","Anwenden","Застосувати","Aplicar","Zastosuj","Applica"],
    ["Name","Name","Назва","Nombre","Nazwa","Nome"],
    ["Currency","Währung","Валюта","Moneda","Waluta","Valuta"],
    ["Purchase date","Kaufdatum","Дата купівлі","Fecha de compra","Data zakupu","Data di acquisto"],
    ["First P D","Erstes Kaufdatum","Дата першої купівлі","Fecha de primera compra","Data pierwszego zakupu","Data del primo acquisto"],
    ["Purchase price","Kaufpreis","Ціна купівлі","Precio de compra","Cena zakupu","Prezzo di acquisto"],
    ["Current price","Aktueller Preis","Поточна ціна","Precio actual","Aktualna cena","Prezzo attuale"],
    ["Loading official macroeconomic data…","Offizielle Makrodaten werden geladen…","Завантаження офіційних макроданих…","Cargando datos macroeconómicos oficiales…","Ładowanie oficjalnych danych makroekonomicznych…","Caricamento dati macroeconomici ufficiali…"],
    ["Monetary policy","Geldpolitik","Монетарна політика","Política monetaria","Polityka pieniężna","Politica monetaria"],
    ["Inflation","Inflation","Інфляція","Inflación","Inflacja","Inflazione"],
    ["Annual inflation","Jährliche Inflation","Річна інфляція","Inflación anual","Inflacja roczna","Inflazione annua"],
    ["Monthly inflation","Monatliche Inflation","Місячна інфляція","Inflación mensual","Inflacja miesięczna","Inflazione mensile"],
    ["Gross domestic product","Bruttoinlandsprodukt","Валовий внутрішній продукт","Producto interior bruto","Produkt krajowy brutto","Prodotto interno lordo"],
    ["No assets yet.","Noch keine Anlagen.","Активів ще немає.","Aún no hay activos.","Brak aktywów.","Nessuna attività."],
    ["No payments yet.","Noch keine Zahlungen.","Платежів ще немає.","Aún no hay pagos.","Brak płatności.","Nessun pagamento."],
    ["All time","Gesamter Zeitraum","За весь час","Todo el tiempo","Cały okres","Tutto il periodo"],
    ["Today","Heute","Сьогодні","Hoy","Dzisiaj","Oggi"],
    ["From","Von","Від","Desde","Od","Da"],
    ["To","Bis","До","Hasta","Do","A"],
    ["Category","Kategorie","Категорія","Categoría","Kategoria","Categoria"],
    ["Add loan","Kredit hinzufügen","Додати позику","Añadir préstamo","Dodaj pożyczkę","Aggiungi prestito"],
    ["Add note","Notiz hinzufügen","Додати нотатку","Añadir nota","Dodaj notatkę","Aggiungi nota"],
    ["Add planned asset","Geplante Anlage hinzufügen","Додати запланований актив","Añadir activo previsto","Dodaj planowane aktywo","Aggiungi attività pianificata"],
    ["Add new","Neu hinzufügen","Додати нову","Añadir nueva","Dodaj nową","Aggiungi nuova"],
    ["Asset allocation","Anlageverteilung","Розподіл активів","Asignación de activos","Alokacja aktywów","Allocazione attività"],
    ["Assets","Anlagen","Активи","Activos","Aktywa","Attività"],
    ["Tools","Instrumente","Інструменти","Instrumentos","Narzędzia","Strumenti"],
    ["Asset price history","Kursverlauf","Історія ціни активу","Historial de precios","Historia ceny aktywa","Storico prezzi"],
    ["Select asset","Anlage auswählen","Вибрати актив","Seleccionar activo","Wybierz aktywo","Seleziona attività"],
    ["Chart","Diagramm","Графік","Gráfico","Wykres","Grafico"],
    ["Portfolio value","Portfoliowert","Вартість портфеля","Valor de cartera","Wartość portfela","Valore portafoglio"],
    ["Money earned by month","Monatliche Einnahmen","Зароблено за місяцями","Dinero ganado por mes","Zarobki miesięczne","Guadagni mensili"],
    ["Invested by month","Monatlich investiert","Інвестовано за місяцями","Invertido por mes","Inwestycje miesięczne","Investito mensilmente"],
    ["Calculate rebalance","Neugewichtung berechnen","Розрахувати ребаланс","Calcular reequilibrio","Oblicz rebalans","Calcola ribilanciamento"],
    ["Target total:","Zielsumme:","Цільова сума:","Total objetivo:","Suma docelowa:","Totale obiettivo:"],
    ["Calculate","Berechnen","Розрахувати","Calcular","Oblicz","Calcola"],
    ["Sort by","Sortieren nach","Сортувати за","Ordenar por","Sortuj według","Ordina per"],
    ["Sync API","API synchronisieren","Синхронізувати API","Sincronizar API","Synchronizuj API","Sincronizza API"],
    ["Purchase date","Kaufdatum","Дата купівлі","Fecha de compra","Data zakupu","Data di acquisto"],
    ["Instrument","Instrument","Інструмент","Instrumento","Instrument","Strumento"],
    ["Instrument type","Instrumenttyp","Тип інструмента","Tipo de instrumento","Typ instrumentu","Tipo di strumento"],
    ["Save asset","Anlage speichern","Зберегти актив","Guardar activo","Zapisz aktywo","Salva attività"],
    ["Quantity to sell","Verkaufsmenge","Кількість для продажу","Cantidad a vender","Ilość do sprzedaży","Quantità da vendere"],
    ["Sell date","Verkaufsdatum","Дата продажу","Fecha de venta","Data sprzedaży","Data di vendita"],
    ["Sell price per unit","Verkaufspreis je Einheit","Ціна продажу за одиницю","Precio de venta unitario","Cena sprzedaży za jednostkę","Prezzo di vendita unitario"],
    ["Sale proceeds","Verkaufserlös","Виручка від продажу","Ingresos de venta","Wpływy ze sprzedaży","Ricavi di vendita"],
    ["Cost basis","Kostenbasis","Собівартість","Base de coste","Koszt bazowy","Costo base"],
    ["Estimated profit","Geschätzter Gewinn","Орієнтовний прибуток","Beneficio estimado","Szacowany zysk","Profitto stimato"],
    ["Dividend","Dividende","Дивіденд","Dividendo","Dywidenda","Dividendo"],
    ["Coupon","Kupon","Купон","Cupón","Kupon","Cedola"],
    ["Planned purchase","Geplanter Kauf","Запланована купівля","Compra prevista","Planowany zakup","Acquisto pianificato"],
    ["Message","Mitteilung","Повідомлення","Mensaje","Wiadomość","Messaggio"],
    ["Add note for this month","Notiz für diesen Monat hinzufügen","Додайте нотатку на цей місяць","Añadir nota para este mes","Dodaj notatkę na ten miesiąc","Aggiungi nota per questo mese"],
    ["Notes for the current month","Notizen für den aktuellen Monat","Нотатки за поточний місяць","Notas del mes actual","Notatki na bieżący miesiąc","Note del mese corrente"],
    ["Expense archive","Ausgabenarchiv","Архів витрат","Archivo de gastos","Archiwum wydatków","Archivio spese"],
    ["Period","Zeitraum","Період","Período","Okres","Periodo"],
    ["Last 7 days","Letzte 7 Tage","Останні 7 днів","Últimos 7 días","Ostatnie 7 dni","Ultimi 7 giorni"],
    ["Last 30 days","Letzte 30 Tage","Останні 30 днів","Últimos 30 días","Ostatnie 30 dni","Ultimi 30 giorni"],
    ["Last 3 months","Letzte 3 Monate","Останні 3 місяці","Últimos 3 meses","Ostatnie 3 miesiące","Ultimi 3 mesi"],
    ["Last year","Letztes Jahr","Останній рік","Último año","Ostatni rok","Ultimo anno"],
    ["Custom period","Benutzerdefiniert","Власний період","Período personalizado","Własny okres","Periodo personalizzato"],
    ["NBU key policy rate","NBU-Leitzins","Облікова ставка НБУ","Tasa oficial del NBU","Stopa NBU","Tasso ufficiale NBU"],
    ["Percent per annum","Prozent pro Jahr","Відсотків річних","Porcentaje anual","Procent rocznie","Percentuale annua"],
    ["Percent change","Prozentuale Änderung","Зміна у відсотках","Cambio porcentual","Zmiana procentowa","Variazione percentuale"],
    ["Google Drive: Checking…","Google Drive: Prüfung…","Google Drive: перевірка…","Google Drive: comprobando…","Google Drive: sprawdzanie…","Google Drive: verifica…"],
    ["Syncing","Synchronisierung","Синхронізація","Sincronizando","Synchronizacja","Sincronizzazione"],
    ["Data synchronization and backups","Datensynchronisierung und Sicherungen","Синхронізація даних і резервні копії","Sincronización y copias de seguridad","Synchronizacja i kopie zapasowe","Sincronizzazione e backup"],
    ["Visual preferences for investments and wallet","Darstellung für Investitionen und Haushalt","Вигляд інвестицій і гаманця","Preferencias visuales de inversión y cartera","Wygląd inwestycji i portfela","Preferenze visive per investimenti e portafoglio"],
    ["This is only an approximate forecast; the actual amount may differ.","Dies ist nur eine Schätzung; der tatsächliche Betrag kann abweichen.","Це лише приблизний прогноз; фактична сума може відрізнятися.","Es solo una estimación; el importe real puede variar.","To tylko przybliżona prognoza; rzeczywista kwota może się różnić.","È solo una stima; l'importo effettivo può variare."],
    ["Tithe","Zehnt","Десятина","Diezmo","Dziesięcina","Decima"],
    ["Utilities","Nebenkosten","Комунальні послуги","Servicios","Media","Utenze"],
    ["Save+invest","Sparen+investieren","Заощадження+інвестиції","Ahorrar+invertir","Oszczędzaj+inwestuj","Risparmia+investi"],
    ["Groceries + household","Lebensmittel + Haushalt","Продукти + побут","Alimentos + hogar","Żywność + dom","Alimentari + casa"],
    ["Fuel","Kraftstoff","Пальне","Combustible","Paliwo","Carburante"],
    ["Children","Kinder","Діти","Niños","Dzieci","Bambini"],
    ["Health","Gesundheit","Здоров’я","Salud","Zdrowie","Salute"],
    ["Other","Sonstiges","Інше","Otros","Inne","Altro"],
    ["Entertainment","Unterhaltung","Розваги","Entretenimiento","Rozrywka","Intrattenimento"],
    ["Gifts","Geschenke","Подарунки","Regalos","Prezenty","Regali"],
    ["Subscriptions","Abonnements","Підписки","Suscripciones","Subskrypcje","Abbonamenti"],
    ["Transport","Transport","Транспорт","Transporte","Transport","Trasporti"],
    ["Salary","Gehalt","Зарплата","Salario","Wynagrodzenie","Stipendio"],
    ["Savings","Ersparnisse","Заощадження","Ahorros","Oszczędności","Risparmi"],
    ["Saved","Gespart","Заощаджено","Ahorrado","Zaoszczędzono","Risparmiato"],
    ["Note","Notiz","Нотатка","Nota","Notatka","Nota"],
    ["Monthly total","Monatssumme","Разом за місяць","Total mensual","Suma miesięczna","Totale mensile"],
    ["Total expenses","Gesamtausgaben","Загальні витрати","Gastos totales","Łączne wydatki","Spese totali"],
    ["Total expenses by month","Gesamtausgaben pro Monat","Загальні витрати за місяцями","Gastos totales por mes","Łączne wydatki miesięcznie","Spese totali mensili"],
    ["Total expenses during the selected period","Gesamtausgaben im gewählten Zeitraum","Загальні витрати за вибраний період","Gastos totales del período seleccionado","Łączne wydatki w wybranym okresie","Spese totali nel periodo selezionato"],
    ["Cumulative total expenses by day.","Kumulierte Gesamtausgaben pro Tag.","Накопичені загальні витрати за днями.","Gastos totales acumulados por día.","Skumulowane wydatki według dni.","Spese totali cumulative per giorno."],
    ["Series","Reihe","Ряд","Serie","Seria","Serie"],
    ["Upcoming loan payments","Bevorstehende Kreditraten","Майбутні платежі за позиками","Próximos pagos de préstamos","Nadchodzące spłaty pożyczek","Prossimi pagamenti prestiti"],
    ["Repay","Zurückzahlen","Погасити","Reembolsar","Spłać","Rimborsa"],
    ["Paid","Bezahlt","Сплачено","Pagado","Spłacono","Pagato"],
    ["No loans.","Keine Kredite.","Позик немає.","No hay préstamos.","Brak pożyczek.","Nessun prestito."],
    ["Additional investment for $1,000/month","Zusätzliche Investition für 1.000 $/Monat","Додаткові інвестиції для $1 000/місяць","Inversión adicional para 1.000 $/mes","Dodatkowa inwestycja dla 1000 USD/miesiąc","Investimento aggiuntivo per 1.000 $/mese"],
    ["Average monthly profit:","Durchschnittlicher Monatsgewinn:","Середній місячний прибуток:","Beneficio mensual medio:","Średni miesięczny zysk:","Profitto mensile medio:"],
    ["Bond schedule","Anleiheplan","Графік облігації","Calendario del bono","Harmonogram obligacji","Piano obbligazionario"],
    ["Price per unit","Preis je Einheit","Ціна за одиницю","Precio unitario","Cena jednostkowa","Prezzo unitario"],
    ["Maturity / redemption date","Fälligkeits-/Rückzahlungstermin","Дата погашення","Fecha de vencimiento","Data wykupu","Data di scadenza"],
    ["Redemption value per bond","Rückzahlungswert je Anleihe","Вартість погашення однієї облігації","Valor de reembolso por bono","Wartość wykupu obligacji","Valore di rimborso per obbligazione"],
    ["Coupon payments","Kuponzahlungen","Купонні виплати","Pagos de cupones","Płatności kuponowe","Pagamenti cedole"],
    ["Coupon date","Kupondatum","Дата купона","Fecha del cupón","Data kuponu","Data cedola"],
    ["Amount per unit","Betrag je Einheit","Сума за одиницю","Importe unitario","Kwota na jednostkę","Importo unitario"],
    ["Add coupon","Kupon hinzufügen","Додати купон","Añadir cupón","Dodaj kupon","Aggiungi cedola"],
    ["Portfolio value by month","Portfoliowert pro Monat","Вартість портфеля за місяцями","Valor de cartera por mes","Wartość portfela miesięcznie","Valore portafoglio mensile"],
    ["Group by","Gruppieren nach","Групувати за","Agrupar por","Grupuj według","Raggruppa per"],
    ["Portfolio rebalance","Portfolio-Neugewichtung","Ребаланс портфеля","Reequilibrio de cartera","Rebalans portfela","Ribilanciamento portafoglio"],
    ["Area chart","Flächendiagramm","Площинний графік","Gráfico de área","Wykres obszarowy","Grafico ad area"],
    ["Ticker or currency","Ticker oder Währung","Тикер або валюта","Ticker o moneda","Ticker lub waluta","Ticker o valuta"],
    ["Show","Anzeigen","Показати","Mostrar","Pokaż","Mostra"],
    ["Nominal GDP, UAH million","Nominales BIP, Mio. UAH","Номінальний ВВП, млн грн","PIB nominal, millones UAH","Nominalny PKB, mln UAH","PIL nominale, milioni UAH"],
    ["Real GDP change, %","Reale BIP-Änderung, %","Зміна реального ВВП, %","Cambio del PIB real, %","Zmiana realnego PKB, %","Variazione PIL reale, %"],
    ["BUY","KAUF","КУПІВЛЯ","COMPRA","KUPNO","ACQUISTO"],
    ["SELL","VERKAUF","ПРОДАЖ","VENTA","SPRZEDAŻ","VENDITA"]
    ,["No transactions yet.","Noch keine Transaktionen.","Транзакцій ще немає.","Aún no hay transacciones.","Brak transakcji.","Nessuna transazione."]
    ,["Account controls will be available later","Kontofunktionen werden später verfügbar","Керування обліковим записом буде доступне пізніше","Los controles de cuenta estarán disponibles más adelante","Ustawienia konta będą dostępne później","I controlli account saranno disponibili più avanti"]
    ,["Use your fingerprint to unlock fino","Fingerabdruck zum Entsperren verwenden","Використовуйте відбиток пальця для розблокування fino","Usa tu huella para desbloquear fino","Użyj odcisku palca, aby odblokować fino","Usa l'impronta digitale per sbloccare fino"]
    ,["Last sync:","Letzte Synchronisierung:","Остання синхронізація:","Última sincronización:","Ostatnia synchronizacja:","Ultima sincronizzazione:"]
    ,["Synced","Synchronisiert","Синхронізовано","Sincronizado","Zsynchronizowano","Sincronizzato"]
    ,["Daily expenses","Tägliche Ausgaben","Щоденні витрати","Gastos diarios","Dzienne wydatki","Spese giornaliere"]
    ,["Monthly CPI","Monatlicher VPI","Місячний ІСЦ","IPC mensual","Miesięczny CPI","IPC mensile"]
    ,["Historical price · Twelve Data","Historischer Kurs · Twelve Data","Історична ціна · Twelve Data","Precio histórico · Twelve Data","Cena historyczna · Twelve Data","Prezzo storico · Twelve Data"]
    ,["Allow early withdrawal","Vorzeitige Auszahlung erlauben","Дозволити дострокове зняття","Permitir retiro anticipado","Zezwól na wcześniejszą wypłatę","Consenti prelievo anticipato"]
    ,["Annual interest, %","Jahreszins, %","Річна ставка, %","Interés anual, %","Oprocentowanie roczne, %","Interesse annuo, %"]
    ,["Any amount by due date","Beliebiger Betrag bis Fälligkeit","Будь-яка сума до дати","Cualquier importe antes del vencimiento","Dowolna kwota do terminu","Qualsiasi importo entro la scadenza"]
    ,["Asset name","Anlagename","Назва активу","Nombre del activo","Nazwa aktywa","Nome attività"]
    ,["Available quantity","Verfügbare Menge","Доступна кількість","Cantidad disponible","Dostępna ilość","Quantità disponibile"]
    ,["Bank deposit","Bankeinlage","Банківський депозит","Depósito bancario","Lokata bankowa","Deposito bancario"]
    ,["Crypto Earn","Krypto Earn","Крипто Earn","Crypto Earn","Crypto Earn","Crypto Earn"]
    ,["Ticker / asset name","Ticker / Assetname","Тікер / назва активу","Ticker / nombre del activo","Ticker / nazwa aktywa","Ticker / nome attività"]
    ,["APR, %","APR, %","APR, %","APR, %","APR, %","APR, %"]
    ,["The asset quantity grows daily without a maturity date.","Die Assetmenge wächst täglich ohne Fälligkeitsdatum.","Кількість активу зростає щодня без дати погашення.","La cantidad del activo crece diariamente sin fecha de vencimiento.","Liczba aktywów rośnie codziennie bez daty zapadalności.","La quantità dell'attività cresce ogni giorno senza scadenza."]
    ,["Buy price","Kaufpreis","Ціна купівлі","Precio de compra","Cena zakupu","Prezzo di acquisto"]
    ,["Capitalization","Kapitalisierung","Капіталізація","Capitalización","Kapitalizacja","Capitalizzazione"]
    ,["Comment","Kommentar","Коментар","Comentario","Komentarz","Commento"]
    ,["Delete holding","Position löschen","Видалити позицію","Eliminar posición","Usuń pozycję","Elimina posizione"]
    ,["Deposit terms","Einlagenbedingungen","Умови депозиту","Condiciones del depósito","Warunki lokaty","Condizioni deposito"]
    ,["Dividend per unit","Dividende je Einheit","Дивіденд за одиницю","Dividendo unitario","Dywidenda na jednostkę","Dividendo unitario"]
    ,["Dividend settings","Dividendeneinstellungen","Налаштування дивідендів","Ajustes de dividendos","Ustawienia dywidend","Impostazioni dividendi"]
    ,["Dividends will be generated automatically on the 10th of each month.","Dividenden werden automatisch am 10. jedes Monats erstellt.","Дивіденди створюватимуться автоматично 10-го числа кожного місяця.","Los dividendos se generarán automáticamente el día 10 de cada mes.","Dywidendy będą tworzone automatycznie 10. dnia miesiąca.","I dividendi saranno generati automaticamente il 10 di ogni mese."]
    ,["Due date / first payment","Fälligkeit / erste Zahlung","Термін / перший платіж","Vencimiento / primer pago","Termin / pierwsza płatność","Scadenza / primo pagamento"]
    ,["Early withdrawal is not available.","Vorzeitige Auszahlung ist nicht verfügbar.","Дострокове зняття недоступне.","El retiro anticipado no está disponible.","Wcześniejsza wypłata jest niedostępna.","Il prelievo anticipato non è disponibile."]
    ,["Enter a ticker to view the chart.","Ticker eingeben, um das Diagramm anzuzeigen.","Введіть тикер, щоб переглянути графік.","Introduce un ticker para ver el gráfico.","Wpisz ticker, aby zobaczyć wykres.","Inserisci un ticker per vedere il grafico."]
    ,["Event","Ereignis","Подія","Evento","Wydarzenie","Evento"]
    ,["First dividend date","Erstes Dividendendatum","Дата першого дивіденду","Fecha del primer dividendo","Data pierwszej dywidendy","Data primo dividendo"]
    ,["Fixed monthly payment","Feste Monatsrate","Фіксований місячний платіж","Pago mensual fijo","Stała rata miesięczna","Pagamento mensile fisso"]
    ,["Fixed payout","Feste Auszahlung","Фіксована виплата","Pago fijo","Stała wypłata","Pagamento fisso"]
    ,["Hide sales","Verkäufe ausblenden","Приховати продажі","Ocultar ventas","Ukryj sprzedaże","Nascondi vendite"]
    ,["Income is reinvested into the asset.","Erträge werden in die Anlage reinvestiert.","Дохід реінвестується в актив.","Los ingresos se reinvierten en el activo.","Dochód jest reinwestowany w aktywo.","Il reddito viene reinvestito nell'attività."]
    ,["Institution","Institut","Установа","Institución","Instytucja","Istituzione"]
    ,["Invested","Investiert","Інвестовано","Invertido","Zainwestowano","Investito"]
    ,["Invested amount","Investierter Betrag","Інвестована сума","Importe invertido","Zainwestowana kwota","Importo investito"]
    ,["Last payment","Letzte Zahlung","Останній платіж","Último pago","Ostatnia płatność","Ultimo pagamento"]
    ,["Loading official NBU series…","Offizielle NBU-Reihe wird geladen…","Завантаження офіційних даних НБУ…","Cargando serie oficial del NBU…","Ładowanie oficjalnej serii NBU…","Caricamento serie ufficiale NBU…"]
    ,["Manual schedule","Manueller Plan","Ручний графік","Calendario manual","Harmonogram ręczny","Piano manuale"]
    ,["Maturity date","Fälligkeitsdatum","Дата погашення","Fecha de vencimiento","Data wykupu","Data di scadenza"]
    ,["Max","Max.","Макс.","Máx.","Maks.","Max"]
    ,["Monthly payment","Monatsrate","Місячний платіж","Pago mensual","Płatność miesięczna","Pagamento mensile"]
    ,["New category name","Name der neuen Kategorie","Назва нової категорії","Nombre de nueva categoría","Nazwa nowej kategorii","Nome nuova categoria"]
    ,["New instrument name","Name des neuen Instruments","Назва нового інструмента","Nombre del nuevo instrumento","Nazwa nowego instrumentu","Nome nuovo strumento"]
    ,["Next payment date","Nächstes Zahlungsdatum","Дата наступної виплати","Fecha del próximo pago","Data następnej płatności","Data prossimo pagamento"]
    ,["One-time full payment","Einmalige Vollzahlung","Одноразове повне погашення","Pago único completo","Jednorazowa pełna spłata","Pagamento unico completo"]
    ,["Payment day","Zahlungstag","День платежу","Día de pago","Dzień płatności","Giorno di pagamento"]
    ,["Payment method","Zahlungsart","Спосіб виплати","Método de pago","Metoda płatności","Metodo di pagamento"]
    ,["Payout date","Auszahlungsdatum","Дата виплати","Fecha de pago","Data wypłaty","Data pagamento"]
    ,["Planned amount","Geplanter Betrag","Запланована сума","Importe previsto","Planowana kwota","Importo pianificato"]
    ,["Prices recorded after edits and synchronization","Nach Bearbeitung und Synchronisierung gespeicherte Preise","Ціни, записані після редагування та синхронізації","Precios guardados tras ediciones y sincronización","Ceny zapisane po edycji i synchronizacji","Prezzi registrati dopo modifiche e sincronizzazione"]
    ,["Repayment method","Rückzahlungsart","Спосіб погашення","Método de reembolso","Sposób spłaty","Metodo di rimborso"]
    ,["Save loan","Kredit speichern","Зберегти позику","Guardar préstamo","Zapisz pożyczkę","Salva prestito"]
    ,["Save note","Notiz speichern","Зберегти нотатку","Guardar nota","Zapisz notatkę","Salva nota"]
    ,["Select a ticker to load its price history","Ticker wählen, um den Kursverlauf zu laden","Виберіть тикер для завантаження історії ціни","Selecciona un ticker para cargar su historial","Wybierz ticker, aby wczytać historię ceny","Seleziona un ticker per caricare lo storico"]
    ,["Show current holdings only","Nur aktuelle Positionen anzeigen","Показувати лише поточні позиції","Mostrar solo posiciones actuales","Pokaż tylko bieżące pozycje","Mostra solo posizioni correnti"]
    ,["Stock","Aktie","Акція","Acción","Akcja","Azione"]
    ,["Term (months)","Laufzeit (Monate)","Строк (місяців)","Plazo (meses)","Okres (miesiące)","Durata (mesi)"]
    ,["The selected holding and all related records will be deleted.","Die gewählte Position und alle zugehörigen Einträge werden gelöscht.","Вибрану позицію та всі пов’язані записи буде видалено.","Se eliminarán la posición seleccionada y todos sus registros.","Wybrana pozycja i powiązane wpisy zostaną usunięte.","La posizione selezionata e i dati collegati saranno eliminati."]
    ,["Ticker","Ticker","Тикер","Ticker","Ticker","Ticker"]
    ,["Year to date","Seit Jahresbeginn","Від початку року","Desde inicio de año","Od początku roku","Da inizio anno"]
    ,["Mon","Mo","Пн","Lun","Pon","Lun"],["Tue","Di","Вт","Mar","Wt","Mar"],["Wed","Mi","Ср","Mié","Śr","Mer"],["Thu","Do","Чт","Jue","Czw","Gio"],["Fri","Fr","Пт","Vie","Pt","Ven"],["Sat","Sa","Сб","Sáb","Sob","Sab"],["Sun","So","Нд","Dom","Niedz","Dom"]
  ];
  const dictionaries = Object.fromEntries(languages.map((language, index) => [language, new Map(rows.map((row) => [row[0], row[index]]))]));
  let locale = localStorage.getItem("fino-language") || "en";
  if (!languages.includes(locale)) locale = "en";
  const substitutions = {
    de: [[/\bunits\b/g,"Einheiten"],[/\bReceived\b/g,"Erhalten"],[/\bDividend\b/g,"Dividende"],[/\bNotes for\b/g,"Notizen für"],[/\brecorded price points\b/g,"gespeicherte Kurspunkte"],[/\bremaining\b/g,"verbleibend"],[/Average monthly profit:/g,"Durchschnittlicher Monatsgewinn:"],[/Last sync:/g,"Letzte Synchronisierung:"]],
    uk: [[/\bunits\b/g,"од."],[/\bReceived\b/g,"Отримано"],[/\bDividend\b/g,"Дивіденд"],[/\bNotes for\b/g,"Нотатки за"],[/\brecorded price points\b/g,"записаних точок ціни"],[/\bremaining\b/g,"залишилося"],[/Average monthly profit:/g,"Середній місячний прибуток:"],[/Last sync:/g,"Остання синхронізація:"]],
    es: [[/\bunits\b/g,"unidades"],[/\bReceived\b/g,"Recibido"],[/\bDividend\b/g,"Dividendo"],[/\bNotes for\b/g,"Notas de"],[/\brecorded price points\b/g,"puntos de precio registrados"],[/\bremaining\b/g,"restantes"],[/Average monthly profit:/g,"Beneficio mensual medio:"],[/Last sync:/g,"Última sincronización:"]],
    pl: [[/\bunits\b/g,"jedn."],[/\bReceived\b/g,"Otrzymano"],[/\bDividend\b/g,"Dywidenda"],[/\bNotes for\b/g,"Notatki za"],[/\brecorded price points\b/g,"zapisanych punktów ceny"],[/\bremaining\b/g,"pozostało"],[/Average monthly profit:/g,"Średni miesięczny zysk:"],[/Last sync:/g,"Ostatnia synchronizacja:"]],
    it: [[/\bunits\b/g,"unità"],[/\bReceived\b/g,"Ricevuto"],[/\bDividend\b/g,"Dividendo"],[/\bNotes for\b/g,"Note di"],[/\brecorded price points\b/g,"punti prezzo registrati"],[/\bremaining\b/g,"rimanenti"],[/Average monthly profit:/g,"Profitto mensile medio:"],[/Last sync:/g,"Ultima sincronizzazione:"]]
  };
  const t = (text) => {
    const source = String(text);
    const trimmed = source.trim();
    const prefix = trimmed.startsWith("+ ") ? "+ " : "";
    const lookup = prefix ? trimmed.slice(2) : trimmed;
    const exact = dictionaries[locale].get(lookup);
    if (exact) return source.replace(trimmed, `${prefix}${exact}`);
    let translated = source;
    (substitutions[locale] || []).forEach(([pattern, replacement]) => { translated = translated.replace(pattern, replacement); });
    return translated;
  };
  const translateObject = (value, seen = new WeakSet()) => {
    if (typeof value === "string") return t(value);
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    Object.keys(value).forEach((key) => {
      if (typeof value[key] === "string") value[key] = t(value[key]);
      else translateObject(value[key], seen);
    });
    return value;
  };
  const translateNode = (root) => {
    if (!root || root.nodeType !== 1) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (["SCRIPT", "STYLE", "TEXTAREA"].includes(node.parentElement?.tagName)) return;
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const translated = t(raw);
      if (translated !== raw) node.nodeValue = translated;
    });
    root.querySelectorAll("[placeholder],[title],[aria-label]").forEach((element) => ["placeholder", "title", "aria-label"].forEach((attribute) => {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }));
  };
  const apply = () => {
    document.documentElement.lang = locale;
    document.querySelectorAll('input[type="date"], input[type="month"]').forEach((input) => { input.lang = locale; });
    translateNode(document.body);
  };
  const setLanguage = (language) => {
    if (!languages.includes(language)) return;
    localStorage.setItem("fino-language", language);
    location.reload();
  };
  window.FinoI18n = { get locale() { return locale; }, t, apply, setLanguage };
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    if (locale !== "en" && window.Chart && !window.Chart.__finoTranslated) {
      const OriginalChart = window.Chart;
      window.Chart = new Proxy(OriginalChart, {
        construct(Target, args, NewTarget) { translateObject(args[1]); return Reflect.construct(Target, args, NewTarget); },
        apply(Target, thisArg, args) { translateObject(args[1]); return Reflect.apply(Target, thisArg, args); }
      });
      window.Chart.__finoTranslated = true;
    }
    new MutationObserver((records) => records.forEach((record) => {
      if (record.type === "characterData") {
        const translated = t(record.target.nodeValue);
        if (translated !== record.target.nodeValue) record.target.nodeValue = translated;
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) translateNode(node);
        else if (node.nodeType === 3) {
          const translated = t(node.nodeValue);
          if (translated !== node.nodeValue) node.nodeValue = translated;
        }
      });
    })).observe(document.body, { childList: true, characterData: true, subtree: true });
  });
})();
