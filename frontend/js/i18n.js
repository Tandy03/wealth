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
    ["This is only an approximate forecast; the actual amount may differ.","Dies ist nur eine Schätzung; der tatsächliche Betrag kann abweichen.","Це лише приблизний прогноз; фактична сума може відрізнятися.","Es solo una estimación; el importe real puede variar.","To tylko przybliżona prognoza; rzeczywista kwota może się różnić.","È solo una stima; l'importo effettivo può variare."]
  ];
  const dictionaries = Object.fromEntries(languages.map((language, index) => [language, new Map(rows.map((row) => [row[0], row[index]]))]));
  let locale = localStorage.getItem("fino-language") || "en";
  if (!languages.includes(locale)) locale = "en";
  const t = (text) => dictionaries[locale].get(String(text).trim()) || String(text);
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
      const translated = t(trimmed);
      if (translated !== trimmed) node.nodeValue = raw.replace(trimmed, translated);
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
    new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === 1) translateNode(node);
    }))).observe(document.body, { childList: true, subtree: true });
  });
})();
