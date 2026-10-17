(function () {
  const languages = ["en", "de", "uk", "es", "pl", "it"];
  const rows = [
    ["Hover or tap to view today’s USD equivalent.","Bewegen Sie den Zeiger darüber oder tippen Sie, um den heutigen USD-Gegenwert zu sehen.","Наведіть курсор або торкніться, щоб побачити еквівалент у USD на сьогодні.","Pasa el cursor o toca para ver el equivalente en USD de hoy.","Najedź kursorem lub dotknij, aby zobaczyć dzisiejszą równowartość w USD.","Passa il cursore o tocca per vedere l’equivalente in USD di oggi."],
    ["NBU rate for {date}: 1 USD = {rate} UAH.","NBU-Kurs vom {date}: 1 USD = {rate} UAH.","Курс НБУ на {date}: 1 USD = {rate} UAH.","Tipo del NBU del {date}: 1 USD = {rate} UAH.","Kurs NBU na {date}: 1 USD = {rate} UAH.","Cambio NBU del {date}: 1 USD = {rate} UAH."],
    ["Loading today’s USD rate…","Der heutige USD-Kurs wird geladen…","Завантаження курсу USD на сьогодні…","Cargando el tipo de cambio USD de hoy…","Ładowanie dzisiejszego kursu USD…","Caricamento del cambio USD di oggi…"],
    ["Today’s USD rate is unavailable.","Der heutige USD-Kurs ist nicht verfügbar.","Курс USD на сьогодні недоступний.","El tipo de cambio USD de hoy no está disponible.","Dzisiejszy kurs USD jest niedostępny.","Il cambio USD di oggi non è disponibile."],
    ["Saving rebalance plan…","Rebalancierungsplan wird gespeichert…","Збереження плану ребалансу…","Guardando el plan de rebalanceo…","Zapisywanie planu rebalansu…","Salvataggio del piano di ribilanciamento…"],
    ["Rebalance plan saved locally. Drive sync has its own status.","Plan lokal gespeichert. Die Drive-Synchronisierung hat einen eigenen Status.","План збережено локально. Стан синхронізації Drive показано окремо.","Plan guardado localmente. La sincronización de Drive tiene su propio estado.","Plan zapisany lokalnie. Synchronizacja Drive ma osobny status.","Piano salvato localmente. La sincronizzazione Drive ha uno stato separato."],
    ["Rebalance plan saved to Drive.","Plan in Drive gespeichert.","План ребалансу збережено на Drive.","Plan guardado en Drive.","Plan rebalansu zapisany na Drive.","Piano salvato su Drive."],
    ["Could not save the rebalance plan. Try again.","Der Plan konnte nicht gespeichert werden. Erneut versuchen.","Не вдалося зберегти план ребалансу. Спробуйте ще раз.","No se pudo guardar el plan. Inténtalo de nuevo.","Nie udało się zapisać planu. Spróbuj ponownie.","Impossibile salvare il piano. Riprova."],
    ["The rebalance plan changed. Reload before editing it again.","Der Plan wurde geändert. Vor dem Bearbeiten neu laden.","План ребалансу змінився. Завантажте збережений план перед редагуванням.","El plan ha cambiado. Recárgalo antes de editarlo.","Plan został zmieniony. Wczytaj go przed edycją.","Il piano è cambiato. Ricaricalo prima di modificarlo."],
    ["Retry saving plan","Speichern erneut versuchen","Повторити збереження","Reintentar guardar","Ponów zapis","Riprova a salvare"],
    ["Reload saved plan","Gespeicherten Plan laden","Завантажити збережений план","Recargar el plan guardado","Wczytaj zapisany plan","Ricarica il piano salvato"],
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
  rows.push(...`
Income and realized profit by month|Erträge und realisierter Gewinn pro Monat|Дохід і реалізований прибуток за місяцями|Ingresos y beneficio realizado por mes|Dochód i zrealizowany zysk miesięcznie|Reddito e profitto realizzato mensili
Realized and unrealized profit by week|Realisierter und unrealisierter Gewinn pro Woche|Реалізований і нереалізований прибуток за тижнями|Beneficio realizado y no realizado por semana|Zrealizowany i niezrealizowany zysk tygodniowo|Profitto realizzato e non realizzato settimanale
Weekly profit. Gaps indicate missing historical data.|Wöchentlicher Gewinn. Lücken zeigen fehlende historische Daten.|Прибуток за тижнями. Пропуски означають відсутні історичні дані.|Beneficio semanal. Los huecos indican datos históricos ausentes.|Zysk tygodniowy. Luki oznaczają brak danych historycznych.|Profitto settimanale. Le lacune indicano dati storici mancanti.
Purchases minus the cost of units sold, by month (UAH)|Käufe minus Anschaffungskosten verkaufter Einheiten pro Monat (UAH)|Купівлі мінус собівартість проданого за місяцями (грн)|Compras menos coste de unidades vendidas por mes (UAH)|Zakupy minus koszt sprzedanych jednostek miesięcznie (UAH)|Acquisti meno costo delle unità vendute per mese (UAH)
Money earned|Einnahmen|Зароблено|Ingresos|Zarobki|Guadagni
Asset price|Anlagepreis|Ціна активу|Precio del activo|Cena aktywa|Prezzo attività
Price today|Heutiger Preis|Ціна сьогодні|Precio actual|Cena dzisiaj|Prezzo odierno
Exchange rate|Wechselkurs|Курс валют|Tipo de cambio|Kurs walutowy|Tasso di cambio
Official exchange rate|Offizieller Wechselkurs|Офіційний курс валют|Tipo de cambio oficial|Oficjalny kurs walutowy|Tasso di cambio ufficiale
Annual CPI|Jährlicher VPI|Річний ІСЦ|IPC anual|Roczny CPI|IPC annuale
Spending by category|Ausgaben nach Kategorie|Витрати за категоріями|Gastos por categoría|Wydatki według kategorii|Spese per categoria
Other expenses|Sonstige Ausgaben|Інші витрати|Otros gastos|Inne wydatki|Altre spese
Cumulative expenses|Kumulierte Ausgaben|Накопичені витрати|Gastos acumulados|Skumulowane wydatki|Spese cumulative
Cumulative total|Kumulierte Summe|Накопичена сума|Total acumulado|Suma skumulowana|Totale cumulativo
Expenses excluding Tithe and Save+invest|Ausgaben ohne Zehnt und Sparen+investieren|Витрати без десятини й заощаджень+інвестицій|Gastos sin diezmo ni ahorro+inversión|Wydatki bez dziesięciny i oszczędności+inwestycji|Spese escluse decima e risparmio+investimenti
Cumulative expenses excluding Tithe and Save+invest by day.|Kumulierte Ausgaben ohne Zehnt und Sparen+investieren pro Tag.|Накопичені витрати без десятини й заощаджень+інвестицій за днями.|Gastos acumulados sin diezmo ni ahorro+inversión por día.|Skumulowane wydatki bez dziesięciny i oszczędności+inwestycji według dni.|Spese cumulative escluse decima e risparmio+investimenti per giorno.
Monthly budget usage|Monatliche Budgetnutzung|Використання місячного бюджету|Uso del presupuesto mensual|Wykorzystanie budżetu miesięcznego|Utilizzo del budget mensile
Total to invest|Gesamtinvestition|Сума для інвестування|Total a invertir|Suma do zainwestowania|Totale da investire
Compare with S&P 500|Mit S&P 500 vergleichen|Порівняти з S&P 500|Comparar con S&P 500|Porównaj z S&P 500|Confronta con S&P 500
Unavailable|Nicht verfügbar|Недоступно|No disponible|Niedostępne|Non disponibile
Insufficient positive return|Unzureichende positive Rendite|Недостатня додатна дохідність|Rentabilidad positiva insuficiente|Niewystarczająca dodatnia stopa zwrotu|Rendimento positivo insufficiente
Average monthly profit: insufficient history|Durchschnittlicher Monatsgewinn: unzureichende Historie|Середній місячний прибуток: недостатньо історії|Beneficio mensual medio: historial insuficiente|Średni miesięczny zysk: za mało danych historycznych|Profitto mensile medio: storico insufficiente
No active assets.|Keine aktiven Anlagen.|Активних активів немає.|No hay activos vigentes.|Brak aktywnych aktywów.|Nessuna attività attiva.
No active portfolio assets|Keine aktiven Portfolioanlagen|Немає активних активів у портфелі|No hay activos vigentes en la cartera|Brak aktywnych aktywów w portfelu|Nessuna attività attiva in portafoglio
No upcoming payments.|Keine bevorstehenden Zahlungen.|Майбутніх виплат немає.|No hay pagos próximos.|Brak nadchodzących płatności.|Nessun pagamento in arrivo.
No upcoming loan payments.|Keine bevorstehenden Kreditraten.|Майбутніх платежів за позиками немає.|No hay pagos de préstamos próximos.|Brak nadchodzących spłat pożyczek.|Nessuna rata in arrivo.
No current holdings.|Keine aktuellen Positionen.|Поточних позицій немає.|No hay posiciones actuales.|Brak bieżących pozycji.|Nessuna posizione corrente.
No available holdings found.|Keine verfügbaren Positionen gefunden.|Доступних позицій не знайдено.|No se encontraron posiciones disponibles.|Nie znaleziono dostępnych pozycji.|Nessuna posizione disponibile trovata.
No matching transactions.|Keine passenden Transaktionen.|Відповідних транзакцій немає.|No hay transacciones coincidentes.|Brak pasujących transakcji.|Nessuna transazione corrispondente.
No expenses for this month.|Keine Ausgaben für diesen Monat.|Цього місяця витрат немає.|No hay gastos este mes.|Brak wydatków w tym miesiącu.|Nessuna spesa questo mese.
No recorded expenses this month.|Keine erfassten Ausgaben diesen Monat.|Цього місяця немає записаних витрат.|No hay gastos registrados este mes.|Brak zapisanych wydatków w tym miesiącu.|Nessuna spesa registrata questo mese.
No profit data for selected period.|Keine Gewinndaten für diesen Zeitraum.|Немає даних про прибуток за вибраний період.|No hay datos de beneficio para este período.|Brak danych o zysku za wybrany okres.|Nessun dato sui profitti per il periodo scelto.
No prices are available for this period.|Keine Preise für diesen Zeitraum verfügbar.|Немає цін за цей період.|No hay precios para este período.|Brak cen za ten okres.|Nessun prezzo disponibile per questo periodo.
No current market price is available.|Kein aktueller Marktpreis verfügbar.|Поточна ринкова ціна недоступна.|No hay precio de mercado actual.|Bieżąca cena rynkowa jest niedostępna.|Prezzo di mercato corrente non disponibile.
No policy-rate data returned|Keine Leitzinsdaten erhalten|Немає даних про облікову ставку|No se recibieron datos de la tasa oficial|Brak danych o stopie referencyjnej|Nessun dato sul tasso ufficiale ricevuto
No purchase|Kein Kauf|Немає купівлі|Sin compra|Brak zakupu|Nessun acquisto
No instrument|Kein Instrument|Без інструмента|Sin instrumento|Bez instrumentu|Nessuno strumento
Buy holding|Position kaufen|Купити позицію|Comprar posición|Kup pozycję|Acquista posizione
Edit holding|Position bearbeiten|Редагувати позицію|Editar posición|Edytuj pozycję|Modifica posizione
Edit asset|Anlage bearbeiten|Редагувати актив|Editar activo|Edytuj aktywo|Modifica attività
Edit expense|Ausgabe bearbeiten|Редагувати витрату|Editar gasto|Edytuj wydatek|Modifica spesa
Edit loan|Kredit bearbeiten|Редагувати позику|Editar préstamo|Edytuj pożyczkę|Modifica prestito
Delete loan|Kredit löschen|Видалити позику|Eliminar préstamo|Usuń pożyczkę|Elimina prestito
Delete note|Notiz löschen|Видалити нотатку|Eliminar nota|Usuń notatkę|Elimina nota
Remove|Entfernen|Прибрати|Quitar|Usuń|Rimuovi
Save changes|Änderungen speichern|Зберегти зміни|Guardar cambios|Zapisz zmiany|Salva modifiche
Saving...|Speichern…|Збереження…|Guardando…|Zapisywanie…|Salvataggio…
Saving changes...|Änderungen speichern…|Збереження змін…|Guardando cambios…|Zapisywanie zmian…|Salvataggio modifiche…
Selling...|Verkaufen…|Продаж…|Vendiendo…|Sprzedaż…|Vendita…
Syncing...|Synchronisierung…|Синхронізація…|Sincronizando…|Synchronizacja…|Sincronizzazione…
Mark as received|Als erhalten markieren|Позначити як отримане|Marcar como recibido|Oznacz jako otrzymane|Segna come ricevuto
✓ Payment received|✓ Zahlung erhalten|✓ Виплату отримано|✓ Pago recibido|✓ Płatność otrzymana|✓ Pagamento ricevuto
Sale successfully recorded.|Verkauf erfolgreich erfasst.|Продаж успішно записано.|Venta registrada.|Sprzedaż zapisana.|Vendita registrata.
Pending upload|Upload ausstehend|Очікує вивантаження|Carga pendiente|Oczekuje na przesłanie|Caricamento in attesa
Connected|Verbunden|Підключено|Conectado|Połączono|Connesso
Offline|Offline|Без з’єднання|Sin conexión|Bez połączenia|Non connesso
Google Drive: Offline|Google Drive: Offline|Google Drive: без з’єднання|Google Drive: sin conexión|Google Drive: bez połączenia|Google Drive: non connesso
Status|Status|Статус|Estado|Stan|Stato
Please confirm|Bitte bestätigen|Підтвердьте|Confirma|Potwierdź|Conferma
Confirm deletion|Löschen bestätigen|Підтвердження видалення|Confirmar eliminación|Potwierdź usunięcie|Conferma eliminazione
Delete this expense?|Diese Ausgabe löschen?|Видалити цю витрату?|¿Eliminar este gasto?|Usunąć ten wydatek?|Eliminare questa spesa?
Delete this holding and all related records?|Diese Position und alle zugehörigen Einträge löschen?|Видалити цю позицію та всі пов’язані записи?|¿Eliminar esta posición y sus registros?|Usunąć tę pozycję i powiązane wpisy?|Eliminare questa posizione e tutti i dati collegati?
Delete this loan and its repayment history?|Diesen Kredit und seinen Rückzahlungsverlauf löschen?|Видалити цю позику та історію погашення?|¿Eliminar este préstamo y su historial de pagos?|Usunąć tę pożyczkę i historię spłat?|Eliminare questo prestito e lo storico dei rimborsi?
Biometric authentication is not available on this device|Biometrische Authentifizierung auf diesem Gerät nicht verfügbar|Біометрична автентифікація недоступна на цьому пристрої|La autenticación biométrica no está disponible en este dispositivo|Uwierzytelnianie biometryczne jest niedostępne na tym urządzeniu|Autenticazione biometrica non disponibile su questo dispositivo
Biometric settings are unavailable|Biometrische Einstellungen nicht verfügbar|Біометричні налаштування недоступні|Ajustes biométricos no disponibles|Ustawienia biometryczne są niedostępne|Impostazioni biometriche non disponibili
Log out is not available yet.|Abmelden ist noch nicht verfügbar.|Вихід ще недоступний.|Cerrar sesión aún no está disponible.|Wylogowanie jest jeszcze niedostępne.|La disconnessione non è ancora disponibile.
Crypto exchange|Kryptobörse|Криптобіржа|Bolsa de criptomonedas|Giełda kryptowalut|Exchange di criptovalute
New instrument...|Neues Instrument…|Новий інструмент…|Nuevo instrumento…|Nowy instrument…|Nuovo strumento…
Bank, broker, exchange...|Bank, Broker, Börse…|Банк, брокер, біржа…|Banco, bróker, bolsa…|Bank, broker, giełda…|Banca, broker, borsa…
Add a note for this month|Notiz für diesen Monat hinzufügen|Додайте нотатку на цей місяць|Añadir nota para este mes|Dodaj notatkę na ten miesiąc|Aggiungi nota per questo mese
Add an asset to calculate a rebalance.|Anlage hinzufügen, um die Neugewichtung zu berechnen.|Додайте актив для розрахунку ребалансу.|Añade un activo para calcular el reequilibrio.|Dodaj aktywo, aby obliczyć rebalans.|Aggiungi un'attività per calcolare il ribilanciamento.
Choose a valid custom date range.|Gültigen Datumsbereich wählen.|Виберіть коректний діапазон дат.|Elige un intervalo de fechas válido.|Wybierz poprawny zakres dat.|Scegli un intervallo di date valido.
e.g. Buy Inzhur REIT for 20 000 ₴|z. B. Inzhur REIT für 20 000 ₴ kaufen|напр. Купити Inzhur REIT на 20 000 ₴|p. ej. Comprar Inzhur REIT por 20 000 ₴|np. Kup Inzhur REIT za 20 000 ₴|es. Acquista Inzhur REIT per 20 000 ₴
e.g. OVDP 236624|z. B. OVDP 236624|напр. ОВДП 236624|p. ej. OVDP 236624|np. OVDP 236624|es. OVDP 236624
e.g. VWCE ETF|z. B. VWCE ETF|напр. VWCE ETF|p. ej. VWCE ETF|np. VWCE ETF|es. VWCE ETF
e.g. VWCE or AAPL|z. B. VWCE oder AAPL|напр. VWCE або AAPL|p. ej. VWCE o AAPL|np. VWCE lub AAPL|es. VWCE o AAPL
e.g. USDT or BTC|z. B. USDT oder BTC|напр. USDT або BTC|p. ej. USDT o BTC|np. USDT lub BTC|es. USDT o BTC
Type USD, EUR, AAPL…|USD, EUR, AAPL eingeben…|Введіть USD, EUR, AAPL…|Escribe USD, EUR, AAPL…|Wpisz USD, EUR, AAPL…|Digita USD, EUR, AAPL…
Stock / ETF|Aktie / ETF|Акція / ETF|Acción / ETF|Akcja / ETF|Azione / ETF
Security|Wertpapier|Цінний папір|Valor|Papier wartościowy|Titolo
cached|zwischengespeichert|з кешу|en caché|z pamięci podręcznej|dalla cache
latest|aktuell|останній|último|najnowszy|ultimo
State Statistics Service of Ukraine|Staatlicher Statistikdienst der Ukraine|Державна служба статистики України|Servicio Estatal de Estadística de Ucrania|Państwowa Służba Statystyki Ukrainy|Servizio Statistico Statale dell'Ucraina
Canadian dollar|Kanadischer Dollar|Канадський долар|Dólar canadiense|Dolar kanadyjski|Dollaro canadese
Czech koruna|Tschechische Krone|Чеська крона|Corona checa|Korona czeska|Corona ceca
Japanese yen|Japanischer Yen|Японська єна|Yen japonés|Jen japoński|Yen giapponese
Polish zloty|Polnischer Zloty|Польський злотий|Zloty polaco|Złoty polski|Zloty polacco
Pound sterling|Pfund Sterling|Фунт стерлінгів|Libra esterlina|Funt szterling|Sterlina britannica
Swedish krona|Schwedische Krone|Шведська крона|Corona sueca|Korona szwedzka|Corona svedese
Swiss franc|Schweizer Franken|Швейцарський франк|Franco suizo|Frank szwajcarski|Franco svizzero
YTD|Seit Jahresbeginn|Від початку року|Desde inicio de año|Od początku roku|Da inizio anno
OVDP|Ukrainische Staatsanleihen|ОВДП|Bonos del Estado ucraniano|Ukraińskie obligacje skarbowe|Titoli di Stato ucraini
APR, %|Jahreszins, %|Річна ставка, %|Tasa anual, %|Roczna stopa, %|Tasso annuo, %
NovaPay bond|NovaPay-Anleihe|Облігація NovaPay|Bono NovaPay|Obligacja NovaPay|Obbligazione NovaPay
NovaPay fixed payout|Feste NovaPay-Auszahlung|Фіксована виплата NovaPay|Pago fijo NovaPay|Stała wypłata NovaPay|Pagamento fisso NovaPay
Asset transactions|Anlagetransaktionen|Транзакції активу|Transacciones del activo|Transakcje aktywa|Transazioni attività
Application section|Anwendungsbereich|Розділ застосунку|Sección de la aplicación|Sekcja aplikacji|Sezione applicazione
Asset form|Anlageformular|Форма активу|Formulario de activo|Formularz aktywa|Modulo attività
Buy form|Kaufformular|Форма купівлі|Formulario de compra|Formularz zakupu|Modulo acquisto
Sale form|Verkaufsformular|Форма продажу|Formulario de venta|Formularz sprzedaży|Modulo vendita
Note form|Notizformular|Форма нотатки|Formulario de nota|Formularz notatki|Modulo nota
Event modal|Ereignisdialog|Вікно події|Diálogo de evento|Okno wydarzenia|Finestra evento
Notice modal|Mitteilungsdialog|Вікно повідомлення|Diálogo de aviso|Okno powiadomienia|Finestra avviso
Modal backdrop|Dialoghintergrund|Тло вікна|Fondo del diálogo|Tło okna|Sfondo finestra
Holding selection|Positionsauswahl|Вибір позиції|Selección de posición|Wybór pozycji|Selezione posizione
Chart period|Diagrammzeitraum|Період відображення|Período del gráfico|Okres wykresu|Periodo del grafico
Compare your allocation and plan your next investment.|Vergleichen Sie Ihre Aufteilung und planen Sie die nächste Investition.|Порівняйте розподіл активів і сплануйте наступну інвестицію.|Compara tu distribución y planifica la próxima inversión.|Porównaj alokację i zaplanuj kolejną inwestycję.|Confronta la tua allocazione e pianifica il prossimo investimento.
This plan uses purchases only. Existing holdings are not sold.|Dieser Plan berücksichtigt nur Käufe. Bestehende Positionen werden nicht verkauft.|План передбачає лише докупівлі. Наявні активи не продаються.|Este plan solo contempla compras. Las posiciones actuales no se venden.|Plan obejmuje wyłącznie zakupy. Obecne aktywa nie są sprzedawane.|Il piano prevede solo acquisti. Le posizioni esistenti non vengono vendute.
Assets in plan|Anlagen im Plan|Активи в плані|Activos del plan|Aktywa w planie|Attività nel piano
Allocation comparison|Vergleich der Aufteilung|Порівняння розподілу|Comparación de distribución|Porównanie alokacji|Confronto delle allocazioni
Charts are unavailable. You can still edit and calculate.|Diagramme sind nicht verfügbar. Bearbeiten und Berechnen ist weiterhin möglich.|Графіки недоступні. Редагування й розрахунок працюють.|Los gráficos no están disponibles. Puedes seguir editando y calculando.|Wykresy są niedostępne. Edycja i obliczenia nadal działają.|I grafici non sono disponibili. Puoi comunque modificare e calcolare.
Current allocation|Aktuelle Aufteilung|Поточний розподіл|Distribución actual|Obecna alokacja|Allocazione attuale
Target allocation|Zielaufteilung|Цільовий розподіл|Distribución objetivo|Docelowa alokacja|Allocazione obiettivo
Adjust each share independently. Changes stay in this plan.|Passen Sie jeden Anteil einzeln an. Änderungen gelten nur für diesen Plan.|Змінюйте кожну частку окремо. Зміни стосуються лише цього плану.|Ajusta cada porcentaje por separado. Los cambios solo afectan a este plan.|Zmieniaj każdy udział osobno. Zmiany dotyczą tylko tego planu.|Modifica ogni quota separatamente. Le modifiche riguardano solo questo piano.
Current %|Aktuell %|Поточна частка, %|Actual %|Obecnie %|Attuale %
Target %|Ziel %|Цільова частка, %|Objetivo %|Cel %|Obiettivo %
Total allocation|Gesamtaufteilung|Загальний розподіл|Distribución total|Łączna alokacja|Allocazione totale
Normalize to 100%|Auf 100 % normieren|Нормалізувати до 100%|Normalizar al 100 %|Normalizuj do 100%|Normalizza al 100%
Rebalance results|Ergebnis der Neugewichtung|Результати ребалансу|Resultados del reequilibrio|Wyniki rebalansu|Risultati del ribilanciamento
Set your targets, then calculate the investment plan.|Legen Sie die Zielanteile fest und berechnen Sie den Investitionsplan.|Задайте цільові частки й розрахуйте інвестиційний план.|Define los objetivos y calcula el plan de inversión.|Ustaw docelowe udziały i oblicz plan inwestycji.|Imposta le quote obiettivo e calcola il piano di investimento.
No current holdings to display.|Keine aktuellen Positionen vorhanden.|Немає поточних активів для відображення.|No hay posiciones actuales que mostrar.|Brak bieżących aktywów do wyświetlenia.|Nessuna posizione attuale da visualizzare.
Set target shares to build your allocation.|Legen Sie Zielanteile für Ihre Aufteilung fest.|Задайте цільові частки для побудови розподілу.|Define los porcentajes objetivo para crear la distribución.|Ustaw docelowe udziały, aby zbudować alokację.|Imposta le quote obiettivo per definire l'allocazione.
Adjust target share for {value}|Zielanteil für {value} anpassen|Змінити цільову частку для {value}|Ajustar el porcentaje objetivo de {value}|Zmień docelowy udział {value}|Modifica la quota obiettivo di {value}
Target share for {value}|Zielanteil für {value}|Цільова частка для {value}|Porcentaje objetivo de {value}|Docelowy udział {value}|Quota obiettivo di {value}
Remove {value}|{value} entfernen|Прибрати {value}|Quitar {value}|Usuń {value}|Rimuovi {value}
Remove from this plan only|Nur aus diesem Plan entfernen|Прибрати лише з цього плану|Quitar solo de este plan|Usuń tylko z tego planu|Rimuovi solo da questo piano
Enter target shares from 0 to 100 in steps of 0.1.|Geben Sie Zielanteile von 0 bis 100 in Schritten von 0,1 ein.|Введіть частки від 0 до 100 із кроком 0,1.|Introduce porcentajes de 0 a 100 en pasos de 0,1.|Wpisz udziały od 0 do 100 z krokiem 0,1.|Inserisci quote da 0 a 100 con incrementi di 0,1.
Enter at least one positive target before normalizing.|Geben Sie vor dem Normieren mindestens einen positiven Zielanteil ein.|Перед нормалізацією задайте хоча б одну додатну частку.|Introduce al menos un objetivo positivo antes de normalizar.|Przed normalizacją ustaw co najmniej jeden dodatni udział.|Imposta almeno una quota positiva prima di normalizzare.
Allocation is ready to calculate.|Die Aufteilung ist bereit zur Berechnung.|Розподіл готовий до розрахунку.|La distribución está lista para calcular.|Alokacja jest gotowa do obliczenia.|L'allocazione è pronta per il calcolo.
{value} over the target allocation.|{value} über der Zielaufteilung.|Перевищення цільового розподілу: {value}.|La distribución supera el objetivo en {value}.|Docelowa alokacja przekroczona o {value}.|L'allocazione supera l'obiettivo di {value}.
{value} remains unallocated.|{value} sind noch nicht zugeteilt.|Нерозподілена частка: {value}.|Queda un {value} sin asignar.|Pozostało {value} do przydzielenia.|Rimane da allocare il {value}.
Unallocated|Nicht zugeteilt|Нерозподілено|Sin asignar|Nieprzydzielone|Non allocato
Action|Aktion|Дія|Acción|Działanie|Azione
Hold|Halten|Утримувати|Mantener|Trzymaj|Mantieni
Holdings with a 0% target remain because this plan does not sell.|Positionen mit einem Ziel von 0 % bleiben bestehen, da dieser Plan keine Verkäufe vorsieht.|Активи з цільовою часткою 0% залишаються, оскільки цей план не передбачає продажів.|Las posiciones con un objetivo del 0 % se mantienen porque este plan no contempla ventas.|Aktywa z celem 0% pozostają w portfelu, ponieważ ten plan nie przewiduje sprzedaży.|Le posizioni con obiettivo 0% rimangono perché il piano non prevede vendite.
The end date must be on or after the start date.|Das Enddatum darf nicht vor dem Startdatum liegen.|Кінцева дата не може бути раніше початкової.|La fecha final no puede ser anterior a la inicial.|Data końcowa nie może być wcześniejsza od początkowej.|La data finale non può precedere quella iniziale.
{value}: no recorded prices in the selected period|{value}: keine aufgezeichneten Kurse im ausgewählten Zeitraum|{value}: немає записів ціни за вибраний період|{value}: no hay precios registrados en el período seleccionado|{value}: brak zapisanych cen w wybranym okresie|{value}: nessun prezzo registrato nel periodo selezionato
Historical market price chart|Historischer Marktpreis|Історія ринкової ціни|Historial de precios de mercado|Historia cen rynkowych|Storico prezzi di mercato
Portfolio sort|Portfoliosortierung|Сортування портфеля|Orden de cartera|Sortowanie portfela|Ordinamento portafoglio
Profit calculator|Gewinnrechner|Калькулятор прибутку|Calculadora de beneficio|Kalkulator zysku|Calcolatore profitto
Loan repayment|Kreditrückzahlung|Погашення позики|Reembolso de préstamo|Spłata pożyczki|Rimborso prestito
ASSET|ANLAGE|АКТИВ|ACTIVO|AKTYWO|ATTIVITÀ
AVAILABLE|VERFÜGBAR|ДОСТУПНО|DISPONIBLE|DOSTĘPNE|DISPONIBILE
CALENDAR|KALENDER|КАЛЕНДАР|CALENDARIO|KALENDARZ|CALENDARIO
CALENDAR EVENT|KALENDEREREIGNIS|ПОДІЯ КАЛЕНДАРЯ|EVENTO DEL CALENDARIO|WYDARZENIE KALENDARZA|EVENTO CALENDARIO
MARKET|MARKT|РИНОК|MERCADO|RYNEK|MERCATO
PORTFOLIO|PORTFOLIO|ПОРТФЕЛЬ|CARTERA|PORTFEL|PORTAFOGLIO
REBALANCE|NEUGEWICHTUNG|РЕБАЛАНС|REEQUILIBRIO|REBALANS|RIBILANCIAMENTO
TRANSACTION|TRANSAKTION|ТРАНЗАКЦІЯ|TRANSACCIÓN|TRANSAKCJA|TRANSAZIONE
WALLET|HAUSHALT|ГАМАНЕЦЬ|CARTERA|PORTFEL|PORTAFOGLIO
  `.trim().split('\n').map((line) => line.trim().split('|')));
  rows.push(...`
Asset sync|Anlagensynchronisierung|Синхронізація активів|Sincronización de activos|Synchronizacja aktywów|Sincronizzazione attività
Conflict detected|Konflikt erkannt|Виявлено конфлікт|Conflicto detectado|Wykryto konflikt|Conflitto rilevato
Google Drive backup created.|Google Drive-Sicherung erstellt.|Резервну копію в Google Drive створено.|Copia de seguridad creada en Google Drive.|Utworzono kopię zapasową w Google Drive.|Backup creato su Google Drive.
Google Drive operation failed.|Google Drive-Vorgang fehlgeschlagen.|Операція Google Drive не вдалася.|Falló la operación de Google Drive.|Operacja Google Drive nie powiodła się.|Operazione Google Drive non riuscita.
Google Drive synchronization failed.|Google Drive-Synchronisierung fehlgeschlagen.|Синхронізація Google Drive не вдалася.|Falló la sincronización de Google Drive.|Synchronizacja Google Drive nie powiodła się.|Sincronizzazione Google Drive non riuscita.
Google account changed during synchronization. Reconnect and retry.|Google-Konto während der Synchronisierung geändert. Erneut verbinden und versuchen.|Обліковий запис Google змінився під час синхронізації. Перепідключіться й повторіть.|La cuenta de Google cambió durante la sincronización. Reconecta y reintenta.|Konto Google zmieniło się podczas synchronizacji. Połącz ponownie i spróbuj jeszcze raz.|Account Google cambiato durante la sincronizzazione. Riconnettiti e riprova.
Select the Google account whose portfolio you want to open.|Google-Konto auswählen, dessen Portfolio geöffnet werden soll.|Виберіть обліковий запис Google, портфель якого хочете відкрити.|Selecciona la cuenta de Google cuya cartera quieres abrir.|Wybierz konto Google, którego portfel chcesz otworzyć.|Seleziona l'account Google del portafoglio da aprire.
Disconnect the current Google account? You will choose an account when opening your portfolio again.|Aktuelles Google-Konto trennen? Beim nächsten Öffnen des Portfolios wählen Sie ein Konto.|Від’єднати поточний обліковий запис Google? Під час наступного відкриття портфеля ви виберете обліковий запис.|¿Desconectar la cuenta actual de Google? Elegirás una cuenta al volver a abrir tu cartera.|Odłączyć bieżące konto Google? Wybierzesz konto przy ponownym otwarciu portfela.|Disconnettere l'account Google corrente? Sceglierai un account alla prossima apertura del portafoglio.
Disconnect the current Google authorization? You will need to run npm run google-auth again.|Aktuelle Google-Autorisierung trennen? npm run google-auth muss erneut ausgeführt werden.|Від’єднати поточну авторизацію Google? Потрібно буде знову виконати npm run google-auth.|¿Desconectar la autorización de Google? Tendrás que ejecutar npm run google-auth de nuevo.|Odłączyć autoryzację Google? Trzeba będzie ponownie uruchomić npm run google-auth.|Disconnettere l'autorizzazione Google? Dovrai eseguire di nuovo npm run google-auth.
Run npm run google-auth in the project console, then restart the server.|npm run google-auth in der Projektkonsole ausführen und den Server neu starten.|Виконайте npm run google-auth у консолі проєкту, потім перезапустіть сервер.|Ejecuta npm run google-auth en la consola del proyecto y reinicia el servidor.|Uruchom npm run google-auth w konsoli projektu i zrestartuj serwer.|Esegui npm run google-auth nella console del progetto, poi riavvia il server.
Download from Drive and replace the local data file? A backup of the local data will be created first.|Von Drive herunterladen und lokale Daten ersetzen? Zuerst wird eine lokale Sicherung erstellt.|Завантажити з Drive й замінити локальний файл даних? Спочатку буде створено резервну копію локальних даних.|¿Descargar de Drive y reemplazar los datos locales? Primero se creará una copia de seguridad local.|Pobrać z Drive i zastąpić dane lokalne? Najpierw powstanie lokalna kopia zapasowa.|Scaricare da Drive e sostituire i dati locali? Prima verrà creato un backup locale.
Upload local data and replace fino-data.json on Google Drive? A backup of the Drive data will be created first.|Lokale Daten hochladen und fino-data.json auf Google Drive ersetzen? Zuerst wird eine Drive-Sicherung erstellt.|Вивантажити локальні дані й замінити fino-data.json у Google Drive? Спочатку буде створено резервну копію даних Drive.|¿Subir datos locales y reemplazar fino-data.json en Google Drive? Primero se creará una copia de los datos de Drive.|Przesłać dane lokalne i zastąpić fino-data.json w Google Drive? Najpierw powstanie kopia danych Drive.|Caricare i dati locali e sostituire fino-data.json su Google Drive? Prima verrà creato un backup dei dati Drive.
Could not connect to the local API. Start the server with npm run dev.|Keine Verbindung zur lokalen API. Server mit npm run dev starten.|Не вдалося підключитися до локального API. Запустіть сервер командою npm run dev.|No se pudo conectar con la API local. Inicia el servidor con npm run dev.|Nie udało się połączyć z lokalnym API. Uruchom serwer przez npm run dev.|Impossibile connettersi all'API locale. Avvia il server con npm run dev.
Could not load your local portfolio. Reconnect Google Drive or restore a backup.|Lokales Portfolio konnte nicht geladen werden. Google Drive erneut verbinden oder Sicherung wiederherstellen.|Не вдалося завантажити локальний портфель. Перепідключіть Google Drive або відновіть резервну копію.|No se pudo cargar la cartera local. Reconecta Google Drive o restaura una copia.|Nie udało się wczytać lokalnego portfela. Połącz ponownie Google Drive lub przywróć kopię.|Impossibile caricare il portafoglio locale. Riconnetti Google Drive o ripristina un backup.
Local portfolio data is corrupted. Restore a backup before making changes.|Lokale Portfoliodaten beschädigt. Vor Änderungen eine Sicherung wiederherstellen.|Локальні дані портфеля пошкоджено. Відновіть резервну копію перед змінами.|Los datos locales están dañados. Restaura una copia antes de modificarlos.|Lokalne dane portfela są uszkodzone. Przywróć kopię przed wprowadzeniem zmian.|Dati locali del portafoglio danneggiati. Ripristina un backup prima di modificarli.
Could not save your changes.|Änderungen konnten nicht gespeichert werden.|Не вдалося зберегти зміни.|No se pudieron guardar los cambios.|Nie udało się zapisać zmian.|Impossibile salvare le modifiche.
Could not synchronize assets.|Anlagen konnten nicht synchronisiert werden.|Не вдалося синхронізувати активи.|No se pudieron sincronizar los activos.|Nie udało się zsynchronizować aktywów.|Impossibile sincronizzare le attività.
Official macroeconomic data is temporarily unavailable.|Offizielle Makrodaten vorübergehend nicht verfügbar.|Офіційні макроекономічні дані тимчасово недоступні.|Los datos macroeconómicos oficiales no están disponibles temporalmente.|Oficjalne dane makroekonomiczne są chwilowo niedostępne.|Dati macroeconomici ufficiali temporaneamente non disponibili.
The backend is running an older version. Restart the server and try again.|Server verwendet eine ältere Version. Neu starten und erneut versuchen.|Сервер працює на старішій версії. Перезапустіть його й повторіть.|El servidor usa una versión anterior. Reinícialo y reintenta.|Serwer używa starszej wersji. Zrestartuj go i spróbuj ponownie.|Il server usa una versione precedente. Riavvialo e riprova.
The market-data proxy is not configured in this APK.|Marktdaten-Proxy in dieser APK nicht konfiguriert.|Проксі ринкових даних не налаштовано в цьому APK.|El proxy de datos de mercado no está configurado en este APK.|Proxy danych rynkowych nie jest skonfigurowane w tym APK.|Proxy dati di mercato non configurato in questo APK.
This asset cannot be withdrawn before maturity.|Diese Anlage kann nicht vor Fälligkeit ausgezahlt werden.|Цей актив не можна зняти до погашення.|Este activo no se puede retirar antes del vencimiento.|Tego aktywa nie można wypłacić przed terminem wykupu.|Questa attività non può essere ritirata prima della scadenza.
Only matching holdings can be merged.|Nur übereinstimmende Positionen können zusammengeführt werden.|Об’єднати можна лише відповідні позиції.|Solo se pueden fusionar posiciones coincidentes.|Można łączyć tylko zgodne pozycje.|Si possono unire solo posizioni corrispondenti.
Only matching holdings can be sold together.|Nur übereinstimmende Positionen können gemeinsam verkauft werden.|Разом можна продати лише відповідні позиції.|Solo se pueden vender juntas posiciones coincidentes.|Można sprzedawać razem tylko zgodne pozycje.|Si possono vendere insieme solo posizioni corrispondenti.
Target shares must total 100% and stay between 0 and 100.|Zielanteile müssen zusammen 100% ergeben und zwischen 0 und 100 liegen.|Цільові частки мають становити разом 100% і бути в межах від 0 до 100.|Las proporciones objetivo deben sumar 100% y estar entre 0 y 100.|Docelowe udziały muszą sumować się do 100% i mieścić się między 0 a 100.|Le quote obiettivo devono totalizzare il 100% e restare tra 0 e 100.
Quantity must be a whole number.|Menge muss eine ganze Zahl sein.|Кількість має бути цілим числом.|La cantidad debe ser un número entero.|Ilość musi być liczbą całkowitą.|La quantità deve essere un numero intero.
Quantity must be a whole number greater than zero.|Menge muss eine ganze Zahl größer als null sein.|Кількість має бути цілим числом більшим за нуль.|La cantidad debe ser un entero mayor que cero.|Ilość musi być liczbą całkowitą większą od zera.|La quantità deve essere un intero maggiore di zero.
Quantity must be greater than zero and use the supported precision for this asset.|Menge muss größer als null sein und die unterstützte Genauigkeit verwenden.|Кількість має бути більшою за нуль і мати підтримувану для цього активу точність.|La cantidad debe ser mayor que cero y usar la precisión admitida para este activo.|Ilość musi być większa od zera i używać obsługiwanej precyzji dla tego aktywa.|La quantità deve essere maggiore di zero e usare la precisione supportata per questa attività.
Currency must match the asset.|Währung muss zur Anlage passen.|Валюта має відповідати активу.|La moneda debe coincidir con el activo.|Waluta musi odpowiadać aktywu.|La valuta deve corrispondere all'attività.
Asset not found.|Anlage nicht gefunden.|Актив не знайдено.|Activo no encontrado.|Nie znaleziono aktywa.|Attività non trovata.
Holding not found.|Position nicht gefunden.|Позицію не знайдено.|Posición no encontrada.|Nie znaleziono pozycji.|Posizione non trovata.
Loan not found.|Kredit nicht gefunden.|Позику не знайдено.|Préstamo no encontrado.|Nie znaleziono pożyczki.|Prestito non trovato.
Payment not found.|Zahlung nicht gefunden.|Виплату не знайдено.|Pago no encontrado.|Nie znaleziono płatności.|Pagamento non trovato.
Asset was not selected.|Keine Anlage ausgewählt.|Актив не вибрано.|No se seleccionó un activo.|Nie wybrano aktywa.|Nessuna attività selezionata.
Please select an asset.|Bitte Anlage auswählen.|Виберіть актив.|Selecciona un activo.|Wybierz aktywo.|Seleziona un'attività.
Please select a holding.|Bitte Position auswählen.|Виберіть позицію.|Selecciona una posición.|Wybierz pozycję.|Seleziona una posizione.
Please enter valid asset data.|Bitte gültige Anlagedaten eingeben.|Введіть коректні дані активу.|Introduce datos válidos del activo.|Wprowadź poprawne dane aktywa.|Inserisci dati validi dell'attività.
Cannot edit missing asset.|Fehlende Anlage kann nicht bearbeitet werden.|Неможливо редагувати відсутній актив.|No se puede editar un activo inexistente.|Nie można edytować nieistniejącego aktywa.|Impossibile modificare un'attività inesistente.
Add at least one coupon.|Mindestens einen Kupon hinzufügen.|Додайте принаймні один купон.|Añade al menos un cupón.|Dodaj co najmniej jeden kupon.|Aggiungi almeno una cedola.
Enter a new category name.|Neuen Kategorienamen eingeben.|Введіть назву нової категорії.|Introduce un nombre de categoría.|Wprowadź nazwę nowej kategorii.|Inserisci il nome della nuova categoria.
Enter a purchase date.|Kaufdatum eingeben.|Введіть дату купівлі.|Introduce la fecha de compra.|Wprowadź datę zakupu.|Inserisci la data di acquisto.
Enter a valid APR.|Gültigen Jahreszins eingeben.|Введіть коректну річну ставку.|Introduce una tasa anual válida.|Wprowadź poprawną roczną stopę.|Inserisci un tasso annuo valido.
Enter a valid purchase price.|Gültigen Kaufpreis eingeben.|Введіть коректну ціну купівлі.|Introduce un precio de compra válido.|Wprowadź poprawną cenę zakupu.|Inserisci un prezzo di acquisto valido.
Enter a valid quantity.|Gültige Menge eingeben.|Введіть коректну кількість.|Introduce una cantidad válida.|Wprowadź poprawną ilość.|Inserisci una quantità valida.
Enter a valid repayment amount.|Gültigen Rückzahlungsbetrag eingeben.|Введіть коректну суму погашення.|Introduce un importe de reembolso válido.|Wprowadź poprawną kwotę spłaty.|Inserisci un importo di rimborso valido.
Enter a valid sale price.|Gültigen Verkaufspreis eingeben.|Введіть коректну ціну продажу.|Introduce un precio de venta válido.|Wprowadź poprawną cenę sprzedaży.|Inserisci un prezzo di vendita valido.
Enter dividend per unit.|Dividende je Einheit eingeben.|Введіть дивіденд за одиницю.|Introduce el dividendo por unidad.|Wprowadź dywidendę na jednostkę.|Inserisci il dividendo per unità.
Enter first dividend date.|Erstes Dividendendatum eingeben.|Введіть дату першого дивіденду.|Introduce la fecha del primer dividendo.|Wprowadź datę pierwszej dywidendy.|Inserisci la data del primo dividendo.
Enter maturity date.|Fälligkeitsdatum eingeben.|Введіть дату погашення.|Introduce la fecha de vencimiento.|Wprowadź datę wykupu.|Inserisci la data di scadenza.
Select sale date.|Verkaufsdatum auswählen.|Виберіть дату продажу.|Selecciona la fecha de venta.|Wybierz datę sprzedaży.|Seleziona la data di vendita.
Request failed.|Anfrage fehlgeschlagen.|Запит не вдався.|Falló la solicitud.|Żądanie nie powiodło się.|Richiesta non riuscita.
Invalid asset type.|Ungültiger Anlagetyp.|Некоректний тип активу.|Tipo de activo inválido.|Niepoprawny typ aktywa.|Tipo di attività non valido.
Invalid portfolio|Ungültiges Portfolio|Некоректний портфель|Cartera inválida|Niepoprawny portfel|Portafoglio non valido
Invalid wallet|Ungültiger Haushalt|Некоректний гаманець|Cartera inválida|Niepoprawny portfel|Portafoglio non valido
Invalid wallet month.|Ungültiger Haushaltsmonat.|Некоректний місяць гаманця.|Mes de cartera inválido.|Niepoprawny miesiąc portfela.|Mese del portafoglio non valido.
Invalid wallet months.|Ungültige Haushaltsmonate.|Некоректні місяці гаманця.|Meses de cartera inválidos.|Niepoprawne miesiące portfela.|Mesi del portafoglio non validi.
Invalid sync metadata.|Ungültige Synchronisierungsmetadaten.|Некоректні метадані синхронізації.|Metadatos de sincronización inválidos.|Niepoprawne metadane synchronizacji.|Metadati di sincronizzazione non validi.
Unsupported schemaVersion.|Nicht unterstützte Schemaversion.|Непідтримувана версія схеми даних.|Versión de esquema no admitida.|Nieobsługiwana wersja schematu.|Versione dello schema non supportata.
Portfolio must contain an assets collection.|Portfolio muss eine Anlagensammlung enthalten.|Портфель має містити колекцію активів.|La cartera debe contener una colección de activos.|Portfel musi zawierać kolekcję aktywów.|Il portafoglio deve contenere una raccolta di attività.
Binance API request failed|Binance-API-Anfrage fehlgeschlagen|Запит до API Binance не вдався|Falló la solicitud a la API de Binance|Żądanie API Binance nie powiodło się|Richiesta API Binance non riuscita
Binance did not return a current bid/ask quote|Binance hat keinen aktuellen Geld-/Briefkurs geliefert|Binance не повернула поточні ціни купівлі/продажу|Binance no devolvió una cotización actual de compra/venta|Binance nie zwróciło bieżącej ceny kupna/sprzedaży|Binance non ha restituito una quotazione attuale di acquisto/vendita
Inzhur API returned an invalid response.|Inzhur-API hat eine ungültige Antwort geliefert.|API Inzhur повернув некоректну відповідь.|La API de Inzhur devolvió una respuesta inválida.|API Inzhur zwróciło niepoprawną odpowiedź.|L'API Inzhur ha restituito una risposta non valida.
Unsupported Frankfurter market ticker.|Nicht unterstützter Frankfurter-Marktticker.|Непідтримуваний ринковий тикер Frankfurter.|Ticker de mercado Frankfurter no admitido.|Nieobsługiwany ticker rynkowy Frankfurter.|Ticker di mercato Frankfurter non supportato.
Asset modal or form was not found.|Anlagedialog oder Formular nicht gefunden.|Вікно або форму активу не знайдено.|No se encontró el diálogo o formulario de activo.|Nie znaleziono okna lub formularza aktywa.|Finestra o modulo attività non trovato.
Buy more modal or form was not found.|Dialog oder Formular für Nachkauf nicht gefunden.|Вікно або форму докупівлі не знайдено.|No se encontró el diálogo o formulario de compra adicional.|Nie znaleziono okna lub formularza dokupienia.|Finestra o modulo di acquisto aggiuntivo non trovato.
  `.trim().split('\n').map((line) => line.trim().split('|')));
  rows.push(...`
Received|Erhalten|Отримано|Recibido|Otrzymano|Ricevuto
Drive backup folder creation failed|Drive-Sicherungsordner konnte nicht erstellt werden|Не вдалося створити папку резервних копій Drive|Falló la creación de la carpeta de copias Drive|Tworzenie folderu kopii Drive nie powiodło się|Creazione cartella backup Drive non riuscita
Drive backup folder lookup failed|Drive-Sicherungsordner konnte nicht gefunden werden|Не вдалося знайти папку резервних копій Drive|Falló la búsqueda de la carpeta de copias Drive|Wyszukiwanie folderu kopii Drive nie powiodło się|Ricerca cartella backup Drive non riuscita
Drive download failed|Drive-Download fehlgeschlagen|Завантаження з Drive не вдалося|Falló la descarga de Drive|Pobieranie z Drive nie powiodło się|Download da Drive non riuscito
Drive file creation failed|Drive-Dateierstellung fehlgeschlagen|Не вдалося створити файл Drive|Falló la creación del archivo Drive|Tworzenie pliku Drive nie powiodło się|Creazione file Drive non riuscita
Drive metadata lookup failed|Drive-Metadatenabfrage fehlgeschlagen|Не вдалося отримати метадані Drive|Falló la consulta de metadatos Drive|Odczyt metadanych Drive nie powiódł się|Lettura metadati Drive non riuscita
Drive remote backup failed|Drive-Sicherung fehlgeschlagen|Резервне копіювання Drive не вдалося|Falló la copia remota de Drive|Zdalna kopia Drive nie powiodła się|Backup remoto Drive non riuscito
Drive upload failed|Drive-Upload fehlgeschlagen|Вивантаження в Drive не вдалося|Falló la carga a Drive|Przesyłanie do Drive nie powiodło się|Caricamento su Drive non riuscito
Unassigned|Nicht zugewiesen|Не призначено|Sin asignar|Nieprzypisane|Non assegnato
Bank|Bank|Банк|Banco|Bank|Banca
Broker|Broker|Брокер|Bróker|Broker|Broker
Cash|Bargeld|Готівка|Efectivo|Gotówka|Contanti
cash|Bargeld|Готівка|Efectivo|Gotówka|Contanti
Authorization required|Autorisierung erforderlich|Потрібна авторизація|Se requiere autorización|Wymagana autoryzacja|Autorizzazione richiesta
Offline — changes saved locally|Offline — Änderungen lokal gespeichert|Без з’єднання — зміни збережено локально|Sin conexión — cambios guardados localmente|Bez połączenia — zmiany zapisano lokalnie|Non connesso — modifiche salvate localmente
e.g. 0.09|z. B. 0,09|напр. 0,09|p. ej. 0,09|np. 0,09|es. 0,09
Mono|Monochrom|Монохромна|Monocromático|Monochromatyczny|Monocromatico
Not enough units available.|Nicht genügend Einheiten verfügbar.|Недостатньо доступних одиниць.|No hay suficientes unidades disponibles.|Za mało dostępnych jednostek.|Unità disponibili insufficienti.
Asset name is required.|Anlagename ist erforderlich.|Назва активу обов’язкова.|El nombre del activo es obligatorio.|Nazwa aktywa jest wymagana.|Il nome dell'attività è obbligatorio.
Asset and note text are required.|Anlage und Notiztext sind erforderlich.|Актив і текст нотатки обов’язкові.|El activo y el texto de la nota son obligatorios.|Aktywo i tekst notatki są wymagane.|Attività e testo della nota sono obbligatori.
Valid purchase date is required.|Gültiges Kaufdatum ist erforderlich.|Потрібна коректна дата купівлі.|Se requiere una fecha de compra válida.|Wymagana jest poprawna data zakupu.|È richiesta una data di acquisto valida.
Valid maturityDate is required.|Gültiges Fälligkeitsdatum ist erforderlich.|Потрібна коректна дата погашення.|Se requiere una fecha de vencimiento válida.|Wymagana jest poprawna data wykupu.|È richiesta una data di scadenza valida.
spent|ausgegeben|витрачено|gastado|wydano|speso
of|von|із|de|z|di
1D|1T|1Д|1D|1D|1G
5D|5T|5Д|5D|5D|5G
1M|1M|1М|1M|1M|1M
6M|6M|6М|6M|6M|6M
1Y|1J|1Р|1A|1R|1A
5Y|5J|5Р|5A|5L|5A
MAX|MAX.|МАКС.|MÁX.|MAKS.|MAX
1day|1 Tag|1 день|1 día|1 dzień|1 giorno
1week|1 Woche|1 тиждень|1 semana|1 tydzień|1 settimana
1month|1 Monat|1 місяць|1 mes|1 miesiąc|1 mese
5min|5 Min.|5 хв|5 min|5 min|5 min
30min|30 Min.|30 хв|30 min|30 min|30 min
stock|Aktie|Акція|Acción|Akcja|Azione
currency|Währung|Валюта|Moneda|Waluta|Valuta
index|Index|Індекс|Índice|Indeks|Indice
Loan|Kredit|Позика|Préstamo|Pożyczka|Prestito
Drive file creation returned no ID.|Drive-Dateierstellung lieferte keine ID.|Створення файлу Drive не повернуло ідентифікатор.|La creación de archivo Drive no devolvió un ID.|Tworzenie pliku Drive nie zwróciło identyfikatora.|La creazione del file Drive non ha restituito un ID.
  `.trim().split('\n').map((line) => line.trim().split('|')));
  rows.push(...`
Invalid wallet data.|Ungültige Haushaltsdaten.|Некоректні дані гаманця.|Datos de cartera inválidos.|Niepoprawne dane portfela.|Dati del portafoglio non validi.
Valid note date is required.|Gültiges Notizdatum ist erforderlich.|Потрібна коректна дата нотатки.|Se requiere una fecha válida para la nota.|Wymagana jest poprawna data notatki.|È richiesta una data valida per la nota.
Dividend per unit must be greater than zero.|Dividende je Einheit muss größer als null sein.|Дивіденд за одиницю має бути більшим за нуль.|El dividendo por unidad debe ser mayor que cero.|Dywidenda na jednostkę musi być większa od zera.|Il dividendo per unità deve essere maggiore di zero.
Valid first dividend date is required.|Gültiges erstes Dividendendatum ist erforderlich.|Потрібна коректна дата першого дивіденду.|Se requiere una fecha válida del primer dividendo.|Wymagana jest poprawna data pierwszej dywidendy.|È richiesta una data valida del primo dividendo.
Valid maturity date is required.|Gültiges Fälligkeitsdatum ist erforderlich.|Потрібна коректна дата погашення.|Se requiere una fecha de vencimiento válida.|Wymagana jest poprawna data wykupu.|È richiesta una data di scadenza valida.
At least one coupon is required.|Mindestens ein Kupon ist erforderlich.|Потрібен принаймні один купон.|Se requiere al menos un cupón.|Wymagany jest co najmniej jeden kupon.|È richiesta almeno una cedola.
No valid coupons were provided.|Keine gültigen Kupons angegeben.|Коректних купонів не вказано.|No se proporcionaron cupones válidos.|Nie podano poprawnych kuponów.|Nessuna cedola valida fornita.
At least one valid coupon is required.|Mindestens ein gültiger Kupon ist erforderlich.|Потрібен принаймні один коректний купон.|Se requiere al menos un cupón válido.|Wymagany jest co najmniej jeden poprawny kupon.|È richiesta almeno una cedola valida.
NovaPay maturity date and payout are required.|NovaPay-Fälligkeitsdatum und Auszahlung sind erforderlich.|Дата погашення та виплата NovaPay обов’язкові.|La fecha de vencimiento y el pago NovaPay son obligatorios.|Data wykupu i wypłata NovaPay są wymagane.|Data di scadenza e pagamento NovaPay obbligatori.
Deposit maturity date and annual rate are required.|Fälligkeitsdatum und Jahreszins der Einlage sind erforderlich.|Дата завершення депозиту й річна ставка обов’язкові.|La fecha de vencimiento y la tasa anual del depósito son obligatorias.|Data zapadalności lokaty i roczna stopa są wymagane.|Data di scadenza e tasso annuo del deposito obbligatori.
Crypto Earn APR must be greater than zero.|Crypto Earn-Jahreszins muss größer als null sein.|Річна ставка Crypto Earn має бути більшою за нуль.|La tasa anual de Crypto Earn debe ser mayor que cero.|Roczna stopa Crypto Earn musi być większa od zera.|Il tasso annuo Crypto Earn deve essere maggiore di zero.
At least two holdings are required to merge.|Zum Zusammenführen sind mindestens zwei Positionen erforderlich.|Для об’єднання потрібні принаймні дві позиції.|Se requieren al menos dos posiciones para fusionar.|Do połączenia wymagane są co najmniej dwie pozycje.|Servono almeno due posizioni da unire.
Only the same asset on the same instrument can be merged.|Nur dieselbe Anlage beim selben Instrument kann zusammengeführt werden.|Об’єднати можна лише однаковий актив на одному інструменті.|Solo se puede fusionar el mismo activo en el mismo instrumento.|Można łączyć tylko to samo aktywo na tym samym instrumencie.|Si può unire solo la stessa attività sullo stesso strumento.
One or more holdings were not found.|Eine oder mehrere Positionen nicht gefunden.|Одну або кілька позицій не знайдено.|No se encontraron una o más posiciones.|Nie znaleziono co najmniej jednej pozycji.|Una o più posizioni non trovate.
Quantity must be greater than zero.|Menge muss größer als null sein.|Кількість має бути більшою за нуль.|La cantidad debe ser mayor que cero.|Ilość musi być większa od zera.|La quantità deve essere maggiore di zero.
Sell price cannot be negative.|Verkaufspreis darf nicht negativ sein.|Ціна продажу не може бути від’ємною.|El precio de venta no puede ser negativo.|Cena sprzedaży nie może być ujemna.|Il prezzo di vendita non può essere negativo.
Valid sell date is required.|Gültiges Verkaufsdatum ist erforderlich.|Потрібна коректна дата продажу.|Se requiere una fecha de venta válida.|Wymagana jest poprawna data sprzedaży.|È richiesta una data di vendita valida.
Cannot sell {quantity} units; available: {available}.|{quantity} Einheiten können nicht verkauft werden; verfügbar: {available}.|Неможливо продати {quantity} од.; доступно: {available}.|No se pueden vender {quantity} unidades; disponibles: {available}.|Nie można sprzedać {quantity} jedn.; dostępne: {available}.|Impossibile vendere {quantity} unità; disponibili: {available}.
Asset quantity cannot be less than already sold quantity ({value}).|Anlagemenge darf nicht kleiner als die bereits verkaufte Menge sein ({value}).|Кількість активу не може бути меншою за вже продану ({value}).|La cantidad del activo no puede ser menor que la ya vendida ({value}).|Ilość aktywa nie może być mniejsza niż już sprzedana ({value}).|La quantità dell'attività non può essere inferiore a quella già venduta ({value}).
  `.trim().split('\n').map((line) => line.trim().split('|')));
  const actions = `
buy more asset|die Anlage nachzukaufen|докупити актив|comprar más del activo|dokupić aktywo|acquistare altre unità
create asset|die Anlage zu erstellen|створити актив|crear el activo|utworzyć aktywo|creare l'attività
create calendar note|die Kalendernotiz zu erstellen|створити нотатку календаря|crear la nota del calendario|utworzyć notatkę kalendarza|creare la nota del calendario
create sale|den Verkauf zu erstellen|створити продаж|crear la venta|utworzyć sprzedaż|creare la vendita
delete asset|die Anlage zu löschen|видалити актив|eliminar el activo|usunąć aktywo|eliminare l'attività
delete holding|die Position zu löschen|видалити позицію|eliminar la posición|usunąć pozycję|eliminare la posizione
load Frankfurter exchange-rate history|den Frankfurter-Wechselkursverlauf zu laden|завантажити історію курсів Frankfurter|cargar el historial de tipos de cambio de Frankfurter|wczytać historię kursów Frankfurter|caricare lo storico dei cambi Frankfurter
load Google Drive status|den Google Drive-Status zu laden|завантажити статус Google Drive|cargar el estado de Google Drive|wczytać stan Google Drive|caricare lo stato Google Drive
load NBU currencies|die NBU-Währungen zu laden|завантажити валюти НБУ|cargar las monedas del NBU|wczytać waluty NBU|caricare le valute NBU
load NBU currency history|den NBU-Wechselkursverlauf zu laden|завантажити історію курсів НБУ|cargar el historial de monedas del NBU|wczytać historię kursów NBU|caricare lo storico delle valute NBU
load NBU exchange rates|die NBU-Wechselkurse zu laden|завантажити курси НБУ|cargar los tipos de cambio del NBU|wczytać kursy NBU|caricare i cambi NBU
load calendar notes|die Kalendernotizen zu laden|завантажити нотатки календаря|cargar las notas del calendario|wczytać notatki kalendarza|caricare le note del calendario
load data|die Daten zu laden|завантажити дані|cargar los datos|wczytać dane|caricare i dati
load index history from FRED|den Indexverlauf von FRED zu laden|завантажити історію індексу з FRED|cargar el historial del índice de FRED|wczytać historię indeksu z FRED|caricare lo storico dell'indice da FRED
load macroeconomic data|die Makrodaten zu laden|завантажити макроекономічні дані|cargar los datos macroeconómicos|wczytać dane makroekonomiczne|caricare i dati macroeconomici
load market prices|die Marktpreise zu laden|завантажити ринкові ціни|cargar los precios de mercado|wczytać ceny rynkowe|caricare i prezzi di mercato
load payments|die Zahlungen zu laden|завантажити виплати|cargar los pagos|wczytać płatności|caricare i pagamenti
load sales|die Verkäufe zu laden|завантажити продажі|cargar las ventas|wczytać sprzedaże|caricare le vendite
load the Inzhur catalog|den Inzhur-Katalog zu laden|завантажити каталог Inzhur|cargar el catálogo de Inzhur|wczytać katalog Inzhur|caricare il catalogo Inzhur
load the NBU key policy rate|den NBU-Leitzins zu laden|завантажити облікову ставку НБУ|cargar la tasa oficial del NBU|wczytać stopę referencyjną NBU|caricare il tasso ufficiale NBU
load transactions|die Transaktionen zu laden|завантажити транзакції|cargar las transacciones|wczytać transakcje|caricare le transazioni
mark payment as received|die Zahlung als erhalten zu markieren|позначити виплату як отриману|marcar el pago como recibido|oznaczyć płatność jako otrzymaną|segnare il pagamento come ricevuto
merge duplicate holdings|doppelte Positionen zusammenzuführen|об’єднати дублікати позицій|fusionar posiciones duplicadas|połączyć zduplikowane pozycje|unire le posizioni duplicate
record sale|den Verkauf zu erfassen|записати продаж|registrar la venta|zapisać sprzedaż|registrare la vendita
save asset|die Anlage zu speichern|зберегти актив|guardar el activo|zapisać aktywo|salvare l'attività
save expense|die Ausgabe zu speichern|зберегти витрату|guardar el gasto|zapisać wydatek|salvare la spesa
save note|die Notiz zu speichern|зберегти нотатку|guardar la nota|zapisać notatkę|salvare la nota
save wallet|den Haushalt zu speichern|зберегти гаманець|guardar la cartera|zapisać portfel|salvare il portafoglio
synchronize Inzhur assets|die Inzhur-Anlagen zu synchronisieren|синхронізувати активи Inzhur|sincronizar los activos de Inzhur|zsynchronizować aktywa Inzhur|sincronizzare le attività Inzhur
update asset|die Anlage zu aktualisieren|оновити актив|actualizar el activo|zaktualizować aktywo|aggiornare l'attività
load GDP data|die BIP-Daten zu laden|завантажити дані ВВП|cargar los datos del PIB|wczytać dane PKB|caricare i dati PIL
load NBU data|die NBU-Daten zu laden|завантажити дані НБУ|cargar los datos del NBU|wczytać dane NBU|caricare i dati NBU
  `.trim().split('\n').map((line) => line.trim().split('|'));
  actions.forEach((action) => ['Failed to ', 'Could not '].forEach((prefix) => rows.push([
    `${prefix}${action[0]}.`, `Es ist nicht gelungen, ${action[1]}.`, `Не вдалося ${action[2]}.`,
    `No se pudo ${action[3]}.`, `Nie udało się ${action[4]}.`, `Impossibile ${action[5]}.`
  ])));
  const templates = `
Loading {value}…|{value} wird geladen…|Завантаження {value}…|Cargando {value}…|Ładowanie {value}…|Caricamento {value}…
Buy {value}|Kaufen: {value}|Купити на {value}|Comprar por {value}|Kup za {value}|Acquista per {value}
Expenses for {value}|Ausgaben für {value}|Витрати за {value}|Gastos de {value}|Wydatki za {value}|Spese per {value}
Notes for {value}|Notizen für {value}|Нотатки за {value}|Notas de {value}|Notatki za {value}|Note di {value}
{value} by month|{value} pro Monat|{value} за місяцями|{value} por mes|{value} miesięcznie|{value} per mese
{value} remaining|{value} verbleibend|Залишилося {value}|Quedan {value}|Pozostało {value}|Restano {value}
+ {value} more|+ {value} weitere|+ ще {value}|+ {value} más|+ jeszcze {value}|+ altri {value}
{value} units|{value} Einheiten|{value} од.|{value} unidades|{value} jedn.|{value} unità
{value}: price history will appear after the next edit or synchronization|{value}: Kursverlauf erscheint nach der nächsten Bearbeitung oder Synchronisierung|{value}: історія ціни з’явиться після наступного редагування або синхронізації|{value}: el historial aparecerá tras la próxima edición o sincronización|{value}: historia ceny pojawi się po następnej edycji lub synchronizacji|{value}: lo storico apparirà dopo la prossima modifica o sincronizzazione
{value} recorded price points|{value} gespeicherte Kurspunkte|{value} записаних точок ціни|{value} puntos de precio registrados|{value} zapisanych punktów ceny|{value} punti prezzo registrati
{value} recorded price point|{value} gespeicherter Kurspunkt|{value} записана точка ціни|{value} punto de precio registrado|{value} zapisany punkt ceny|{value} punto prezzo registrato
Some sources are temporarily unavailable: {value}.|Einige Quellen sind vorübergehend nicht verfügbar: {value}.|Деякі джерела тимчасово недоступні: {value}.|Algunas fuentes no están disponibles temporalmente: {value}.|Niektóre źródła są chwilowo niedostępne: {value}.|Alcune fonti sono temporaneamente non disponibili: {value}.
Delete {value} and all related payments, transactions and sales?|{value} und alle zugehörigen Zahlungen, Transaktionen und Verkäufe löschen?|Видалити {value} та всі пов’язані виплати, транзакції й продажі?|¿Eliminar {value} y todos los pagos, transacciones y ventas relacionados?|Usunąć {value} i wszystkie powiązane płatności, transakcje i sprzedaże?|Eliminare {value} e tutti i pagamenti, transazioni e vendite collegati?
{value} is required.|{value} ist erforderlich.|Обов’язкове поле: {value}.|Se requiere: {value}.|Wymagane pole: {value}.|Campo obbligatorio: {value}.
Invalid {value}.|Ungültiges Feld: {value}.|Некоректне поле: {value}.|Campo inválido: {value}.|Niepoprawne pole: {value}.|Campo non valido: {value}.
{value} must be an object.|{value} muss ein Objekt sein.|Поле {value} має бути об’єктом.|{value} debe ser un objeto.|{value} musi być obiektem.|{value} deve essere un oggetto.
{value} must be a finite nonnegative number.|{value} muss eine endliche nichtnegative Zahl sein.|Поле {value} має бути скінченним невід’ємним числом.|{value} debe ser un número finito no negativo.|{value} musi być skończoną liczbą nieujemną.|{value} deve essere un numero finito non negativo.
{value} must be a valid YYYY-MM-DD date.|{value} muss ein gültiges Datum im Format YYYY-MM-DD sein.|Поле {value} має містити коректну дату у форматі РРРР-ММ-ДД.|{value} debe ser una fecha válida AAAA-MM-DD.|{value} musi być poprawną datą RRRR-MM-DD.|{value} deve essere una data valida AAAA-MM-GG.
{value} must occur once and be a string.|{value} darf nur einmal vorkommen und muss Text sein.|Поле {value} має бути текстом і траплятися лише один раз.|{value} debe aparecer una sola vez y ser texto.|{value} musi wystąpić raz i być tekstem.|{value} deve comparire una sola volta ed essere testo.
  `.trim().split('\n').map((line) => line.trim().split('|'));
  const dictionaries = Object.fromEntries(languages.map((language, index) => [language, new Map(rows.map((row) => [row[0], row[index]]))]));
  let locale = localStorage.getItem("fino-language") || "en";
  if (!languages.includes(locale)) locale = "en";
  const fieldLabels = { quantity: 'Quantity', purchasePrice: 'Purchase price', sellPrice: 'Sell price per unit', currentPrice: 'Current price', amount: 'Amount', annualRate: 'Annual interest, %', maturityAmount: 'Fixed payout', redemptionValue: 'Redemption value per bond', dividendPerUnit: 'Dividend per unit', termMonths: 'Term (months)', purchaseDate: 'Purchase date', sellDate: 'Sell date', date: 'Date', maturityDate: 'Maturity date', firstDividendDate: 'First dividend date', name: 'Name', type: 'Type', assetId: 'Asset', text: 'Note', ticker: 'Ticker', isin: 'ISIN', instrumentName: 'Instrument', instrumentType: 'Instrument type', currency: 'Currency', coupons: 'Coupons', earlyWithdrawal: 'Allow early withdrawal', isNewInstrument: 'New instrument...', assetIds: 'Assets', wallet: 'Wallet', expenses: 'Expenses', loans: 'Loans', notes: 'Notes', plannedAmount: 'Planned amount', monthlyPayment: 'Monthly payment', paymentDay: 'Payment day', dueDate: 'Due date / first payment', lastPaymentDate: 'Last payment', startDate: 'From', endDate: 'To', 'planned amount': 'Planned amount', 'expense category': 'Expense category', 'expense amount': 'Amount', 'expense date': 'Date', 'expense note': 'Note', 'coupon date': 'Coupon date', 'coupon amountPerUnit': 'Amount per unit' };
  const templatePatterns = templates.map((row) => ({ row, pattern: new RegExp('^' + row[0].split('{value}').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)') + '$') }));
  const t = (text) => {
    const source = String(text);
    const trimmed = source.trim();
    const prefix = trimmed.startsWith("+ ") ? "+ " : "";
    const lookup = prefix ? trimmed.slice(2) : trimmed;
    const exact = dictionaries[locale].get(lookup);
    if (exact) return source.replace(trimmed, `${prefix}${exact}`);
    const driveFailure = trimmed.match(/^(Drive .+ failed)( \(\d+\))$/);
    if (driveFailure && dictionaries[locale].has(driveFailure[1])) return source.replace(trimmed, dictionaries[locale].get(driveFailure[1]) + driveFailure[2]);
    const sale = trimmed.match(/^You cannot sell ([\d.,]+) units\. Only ([\d.,]+) units are available\.$/);
    if (sale) return format('Cannot sell {quantity} units; available: {available}.', { quantity: sale[1], available: sale[2] });
    const quantity = trimmed.match(/^Asset quantity cannot be less than already sold quantity \(([\d.,]+)\)\.$/);
    if (quantity) return format('Asset quantity cannot be less than already sold quantity ({value}).', { value: quantity[1] });
    if (locale === 'en') return source;
    for (const { row, pattern } of templatePatterns) {
      const match = trimmed.match(pattern);
      if (match && (row[0] !== '{value} units' || /\d$/.test(match[1]))) return source.replace(trimmed, row[languages.indexOf(locale)].replace('{value}', () => /by month|is required|must be|must occur|^Invalid/.test(row[0]) ? t(fieldLabels[match[1]] || match[1]) : match[1]));
    }
    // Translate complete UI labels around values; never replace words inside names.
    const parts = trimmed.split(/( — | · |: )/);
    if (parts.length > 1) return source.replace(trimmed, parts.map((part, index) => {
      if (index % 2) return part;
      const label = parts[index + 1] === ': ' ? dictionaries[locale].get(part + ':') : null;
      return label ? label.replace(/:$/, '') : t(part);
    }).join(''));
    const colon = trimmed.match(/^(Failed to .+):$/);
    if (colon) return source.replace(trimmed, t(colon[1] + '.').replace(/\.$/, ':'));
    return source;
  };
  const translateObject = (value, seen = new WeakSet()) => {
    if (typeof value === "string") return t(value);
    if (!value || typeof value !== "object" || seen.has(value)) return value;
    seen.add(value);
    Object.keys(value).forEach((key) => {
      if (value.finoSkipLabels && ['label', 'labels', 'title'].includes(key)) return;
      if (typeof value[key] === "function" && ['label', 'title', 'footer', 'afterLabel', 'beforeLabel'].includes(key)) {
        const callback = value[key];
        value[key] = function (...args) {
          const result = callback.apply(this, args);
          return Array.isArray(result) ? result.map((item) => typeof item === 'string' ? t(item) : item) : typeof result === 'string' ? t(result) : result;
        };
      } else if (typeof value[key] === "string") value[key] = t(value[key]);
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
      if (node.parentElement?.closest('script, style, textarea, [translate="no"], [data-no-translate]')) return;
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const translated = t(raw);
      if (translated !== raw) node.nodeValue = translated;
    });
    [root, ...root.querySelectorAll("[placeholder],[title],[aria-label],[aria-valuetext],[data-label]")].forEach((element) => ["placeholder", "title", "aria-label", "aria-valuetext", "data-label"].forEach((attribute) => {
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
  const format = (key, values) => t(key).replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  window.FinoI18n = { get locale() { return locale; }, t, format, apply, setLanguage };
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
      if (record.type === "attributes") {
        const raw = record.target.getAttribute(record.attributeName);
        const translated = t(raw);
        if (translated !== raw) record.target.setAttribute(record.attributeName, translated);
      }
      if (record.type === "characterData" && !record.target.parentElement?.closest('script, style, textarea, [translate="no"], [data-no-translate]')) {
        const translated = t(record.target.nodeValue);
        if (translated !== record.target.nodeValue) record.target.nodeValue = translated;
      }
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) translateNode(node);
        else if (node.nodeType === 3) {
          if (node.parentElement?.closest('script, style, textarea, [translate="no"], [data-no-translate]')) return;
          const translated = t(node.nodeValue);
          if (translated !== node.nodeValue) node.nodeValue = translated;
        }
      });
    })).observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'aria-valuetext', 'data-label'], subtree: true });
  });
})();
