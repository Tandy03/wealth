const { inflateRawSync } = require("node:zlib");

const USER_AGENT = "Wealth-Dashboard/1.0";
const NBU_BASE = "https://bank.gov.ua/NBUStatService/v1/statdirectory";
const SSSU_DATA = "https://stat.gov.ua/sdmx/workspaces/default:integration/registry/sdmx/3.0/data/dataflow/SSSU/DF_ANNUAL_NATIONAL_ACCOUNTS/latest/*?startPeriod=2010";
const MINFIN_PACKAGE = "https://data.gov.ua/api/3/action/package_show?id=4119d762-a5c1-4c4c-9c30-e2abdd383fb4";
const CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null;

async function request(url, accept = "application/json") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { headers: { Accept: accept, "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}

function dateToken(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDate(value) {
  const text = String(value || "");
  const match = text.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return text.slice(0, 10);
}

async function getNbuData() {
  const now = new Date();
  const start = new Date(now.getFullYear() - 8, 0, 1);
  const [rates, inflation, budget] = await Promise.all([
    request(`${NBU_BASE}/exchange?json`).then((r) => r.json()),
    request(`${NBU_BASE}/inflation?period=m&start=${dateToken(start)}&end=${dateToken(now)}&json`).then((r) => r.json()),
    request(`${NBU_BASE}/budget?period=m&start=${dateToken(start)}&end=${dateToken(now)}&json`).then((r) => r.json()),
  ]);
  const wanted = new Set(["USD", "EUR", "GBP"]);
  const exchangeRates = rates.filter((row) => wanted.has(String(row.cc).toUpperCase())).map((row) => ({ code: row.cc, name: row.txten || row.txt, rate: Number(row.rate), date: normalizeDate(row.exchangedate) }));
  const national = inflation.filter((row) => row.mcrd081 === "Total" && (row.ku == null || row.ku === ""));
  const inflationValue = (row) => {
    const value = Number(row.value);
    // The NBU source has a known July 2019 index-conversion defect: several
    // percentage series are exactly 100 points too low (for example -92.6
    // instead of 7.4). Restore the percentage value before charting it.
    return String(row.dt).startsWith("201907") && value <= -90 ? value + 100 : value;
  };
  const pick = (id, measure) => national.filter((row) => row.id_api === id && row.tzep === measure).map((row) => ({ date: normalizeDate(row.dt), value: inflationValue(row) })).filter((row) => row.date && Number.isFinite(row.value));
  const inflationSeries = {
    annual: pick("prices_price_cpi_", "PCCM_"),
    monthly: pick("prices_price_cpi_", "PCPM_"),
    core: pick("prices_price_ci_", "PCCM_"),
    ppi: national.filter((row) => row.id_api === "prices_price_ppi_" && row.tzep === "PCCM_" && row.mcrk110 === "BCDE").map((row) => ({ date: normalizeDate(row.dt), value: inflationValue(row) })).filter((row) => row.date && Number.isFinite(row.value)),
  };
  const state = budget.filter((row) => row.mcr200p === "SBU");
  const budgetMatchers = {
    balance: (row) => row.id_api === "gf_budgtfd_total" || /financing.*deficit|дефіцит.*профіцит/i.test(`${row.txten || ""} ${row.txt || ""}`),
    borrowing: (row) => /^borrowings?$|^запозичення$/i.test(String(row.txten || row.txt || "").trim()),
    repayment: (row) => /^repayments?$|^погашення$/i.test(String(row.txten || row.txt || "").trim()),
  };
  const budgetSeries = Object.fromEntries(Object.entries(budgetMatchers).map(([key, matcher]) => [key, state.filter((row) => matcher(row) && Number.isFinite(Number(row.value))).map((row) => ({ date: normalizeDate(row.dt), value: Number(row.value) / 1000 }))]));
  return { exchangeRates, inflation: inflationSeries, budget: budgetSeries };
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function getGdp() {
  const text = await request(SSSU_DATA, "text/csv").then((r) => r.text());
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const headers = rows.shift() || [];
  const objects = rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index]])));
  const select = (priceType) => objects.filter((row) => row.INDICATOR === "GDP_CUR_PRC" && row.PRICE_TYPE === priceType && row.REGION === "UA00000000000000000" && row.BREAKDOWN_CATEGORY === "_T" && row.BREAKDOWN === "_T" && row.SECTOR_ECONOMY === "S_1" && row.FREQ === "A").map((row) => ({ date: row.TIME_PERIOD, value: Number(row.OBS_VALUE) })).filter((row) => Number.isFinite(row.value));
  return { nominal: select("CURR_PRICES"), realIndex: select("IDX_VOL_PY") };
}

function zipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Invalid ZIP archive");
  const total = buffer.readUInt16LE(eocd + 10); let offset = buffer.readUInt32LE(eocd + 16); const output = [];
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20), nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32), local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localName = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28), start = local + 30 + localName + localExtra;
    const compressed = buffer.subarray(start, start + size);
    output.push({ name, data: method === 8 ? inflateRawSync(compressed) : compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

function numberFrom(value) {
  let text = String(value || "").replace(/["\s]/g, "");
  if (text.includes(".") && text.includes(",")) text = text.replace(/,/g, "");
  else text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function debtFromCsv(text, fallbackDate) {
  const rows = parseCsv(text.replace(/^\uFEFF/, "")).map((row) => {
    if (row.length !== 1 || !row[0].includes('\",\"')) return row;
    return row[0].replace(/^\"|\"$/g, "").split('\",\"');
  });
  const find = (pattern) => {
    for (const row of rows) {
      const label = String(row[0] || "").replace(/"/g, "").trim();
      if (pattern.test(label)) {
        // DKT2 columns are USD, EUR, UAH (billions), share. UAH is therefore index 3.
        const uah = numberFrom(row[3]);
        if (uah != null) return uah;
      }
    }
    return null;
  };
  return {
    date: fallbackDate,
    total: find(/^Державний борг$|^Public debt$/i),
    domestic: find(/^Внутрішній борг$|^Domestic debt$/i),
    external: find(/^Зовнішній борг$|^External debt$/i),
    debtToGdp: null,
  };
}

function normalizeDebtRows(text) {
  return parseCsv(text.replace(/^\uFEFF/, "")).map((row) => {
    if (row.length !== 1 || !row[0].includes('\",\"')) return row.map((cell) => String(cell).replace(/^\"|\"$/g, ""));
    return row[0].replace(/^\"|\"$/g, "").split('\",\"');
  });
}

function debtHistoryFromCsv(text) {
  const rows = normalizeDebtRows(text);
  const dateRow = rows.find((row) => row.slice(1).filter((cell) => /^\d{2}\.\d{2}\.\d{4}$/.test(String(cell).trim())).length >= 2);
  if (!dateRow) return [];
  const findRow = (pattern) => rows.find((row) => pattern.test(String(row[0] || "").replace(/"/g, "").trim()));
  const total = findRow(/^Державний борг$|^Public debt$/i);
  const domestic = findRow(/^Внутрішній борг$|^Domestic debt$/i);
  const external = findRow(/^Зовнішній борг$|^External debt$/i);
  return dateRow.slice(1).map((rawDate, index) => {
    const date = normalizeDate(rawDate);
    return { date, total: numberFrom(total?.[index + 1]), domestic: numberFrom(domestic?.[index + 1]), external: numberFrom(external?.[index + 1]), debtToGdp: null };
  }).filter((point) => point.date && point.total != null);
}

async function getDebt() {
  const pkg = await request(MINFIN_PACKAGE).then((r) => r.json());
  const resource = (pkg.result?.resources || [])
    .filter((item) => String(item.format).toUpperCase() === "ZIP" || /\.zip($|\?)/i.test(item.url || ""))
    .sort((a, b) => String(a.created || "").localeCompare(String(b.created || ""))).at(-1);
  if (!resource) return [];
  const buffer = Buffer.from(await request(resource.url, "application/zip").then((r) => r.arrayBuffer()));
  const entries = zipEntries(buffer);
  const histories = entries.filter((entry) => /(?:MKT2_UAH|YKT2_UAH)\.csv$/i.test(entry.name)).flatMap((entry) => {
    const utf8 = entry.data.toString("utf8");
    return debtHistoryFromCsv(utf8.includes("�") ? new TextDecoder("windows-1251").decode(entry.data) : utf8);
  });
  return [...new Map(histories.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function settle(name, promise) {
  try { return { name, data: await promise }; } catch (error) { return { name, error: error.message || `Could not load ${name}` }; }
}

async function getMacroeconomics() {
  if (cache && Date.now() - cache.updatedAt < CACHE_MS) return { ...cache.payload, cached: true };
  const results = await Promise.all([settle("nbu", getNbuData()), settle("gdp", getGdp()), settle("debt", getDebt())]);
  const payload = { updatedAt: new Date().toISOString(), sources: { nbu: "NBU", gdp: "State Statistics Service of Ukraine", debt: "Ministry of Finance of Ukraine / data.gov.ua" }, errors: {} };
  results.forEach((result) => { if (result.error) payload.errors[result.name] = result.error; else if (result.name === "nbu") Object.assign(payload, result.data); else payload[result.name] = result.data; });
  const nominalByYear = new Map((payload.gdp?.nominal || []).map((point) => [String(point.date).slice(0, 4), point.value]));
  (payload.debt || []).forEach((point) => {
    const gdp = nominalByYear.get(String(point.date).slice(0, 4));
    if (gdp > 0 && point.total != null) point.debtToGdp = (point.total * 1000 / gdp) * 100;
  });
  cache = { updatedAt: Date.now(), payload };
  return payload;
}

module.exports = { getMacroeconomics, parseCsv, debtFromCsv, debtHistoryFromCsv, zipEntries };
