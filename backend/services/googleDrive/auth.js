const fs = require("node:fs/promises");
const path = require("node:path");
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const credentialsPath = path.resolve(projectRoot, process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || "backend/config/google-credentials.json");
const tokenPath = path.resolve(projectRoot, process.env.GOOGLE_DRIVE_TOKEN_PATH || "backend/config/google-token.json");
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTHORIZATION_OPTIONS = { access_type: "offline", scope: [DRIVE_SCOPE] };

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, "utf8")); }

async function saveToken(tokens) {
  const current = await readJson(tokenPath).catch(() => ({}));
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2), { encoding: "utf8", mode: 0o600 });
}

async function createAuthorizedClient() {
  const credentials = await readJson(credentialsPath);
  const definition = credentials.installed || credentials.web;
  if (!definition?.client_id || !definition?.client_secret) throw new Error("Invalid Google OAuth credentials.");
  const token = await readJson(tokenPath).catch(() => null);
  if (!token?.refresh_token) {
    const error = new Error("Google Drive authorization is required. Run npm run google-auth.");
    error.code = "GOOGLE_AUTH_REQUIRED";
    throw error;
  }
  const auth = new google.auth.OAuth2(definition.client_id, definition.client_secret, definition.redirect_uris?.[0]);
  auth.setCredentials(token);
  auth.on("tokens", (tokens) => saveToken(tokens).catch((error) => console.error("Could not persist refreshed Google token:", error.message)));
  return auth;
}

async function authorizeInteractively() {
  await fs.access(credentialsPath);
  // local-auth generates the consent URL with access_type='offline'. This is
  // what makes Google return a refresh token for unattended synchronization.
  const client = await authenticate({ scopes: AUTHORIZATION_OPTIONS.scope, keyfilePath: credentialsPath });
  if (!client.credentials?.refresh_token) throw new Error("Google did not return a refresh token. Revoke the existing fino permission and authorize again.");
  await saveToken(client.credentials);
  return client;
}

async function disconnect() {
  await fs.rm(tokenPath, { force: true });
}

module.exports = { DRIVE_SCOPE, AUTHORIZATION_OPTIONS, authorizeInteractively, createAuthorizedClient, disconnect, credentialsPath, tokenPath };
