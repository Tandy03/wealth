const fs = require("node:fs");
const path = require("node:path");
require("../config/loadEnv");

const proxyUrl = String(process.env.FINO_PROXY_URL || "").trim();
const proxyToken = String(process.env.FINO_PROXY_TOKEN || "").trim();
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(proxyUrl)) {
  throw new Error("FINO_PROXY_URL must be a deployed Google Apps Script /exec URL.");
}
if (proxyToken.length < 32) {
  throw new Error("FINO_PROXY_TOKEN must be at least 32 characters and match Apps Script Properties.");
}

const target = path.join(__dirname, "..", "..", "frontend", "js", "mobile-config.generated.js");
const payload = `export default Object.freeze(${JSON.stringify({ proxyUrl, proxyToken })});\n`;
fs.writeFileSync(target, payload, { encoding: "utf8", mode: 0o600 });
console.log("Generated local Android proxy configuration.");
