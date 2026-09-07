const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach((line) => {
    const value = line.trim();
    if (!value || value.startsWith("#")) return;
    const separator = value.indexOf("=");
    if (separator < 1) return;
    const key = value.slice(0, separator).trim();
    let content = value.slice(separator + 1).trim();
    if (/^(['"]).*\1$/.test(content)) content = content.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = content;
  });
}
