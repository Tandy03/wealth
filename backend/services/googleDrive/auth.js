const fs = require("node:fs/promises");
const path = require("node:path");
const { google } = require("googleapis");
const { authenticate } = require("@google-cloud/local-auth");
const { atomicWrite } = require('../../data/atomicFile');
const { AuthRequiredError } = require('../../../frontend/js/errors');
const { logEvent } = require('../../utils/observability');

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const credentialsPath = path.resolve(projectRoot, process.env.GOOGLE_DRIVE_CREDENTIALS_PATH || "backend/config/google-credentials.json");
const tokenPath = path.resolve(projectRoot, process.env.GOOGLE_DRIVE_TOKEN_PATH || "backend/config/google-token.json");
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTHORIZATION_OPTIONS = { access_type: "offline", scope: [DRIVE_SCOPE] };

async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, "utf8")); }

let tokenWrites = Promise.resolve();
function saveToken(tokens) {
  const operation = tokenWrites.then(async () => {
  const current = await readJson(tokenPath).catch(() => ({}));
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await atomicWrite(tokenPath, JSON.stringify({ ...current, ...tokens }, null, 2), { privateFile: true });
  });
  tokenWrites = operation.catch(() => {}); return operation;
}

async function createAuthorizedClient() {
  let credentials;
  try { credentials = process.env.GOOGLE_OAUTH_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_OAUTH_CREDENTIALS_JSON) : await readJson(credentialsPath); }
  catch (cause) { throw new AuthRequiredError({ code: 'GOOGLE_AUTH_REQUIRED', message: 'Google OAuth credentials are missing or invalid.', cause }); }
  const definition = credentials.installed || credentials.web;
  if (!definition?.client_id || !definition?.client_secret) throw new AuthRequiredError({ code: 'GOOGLE_AUTH_REQUIRED' });
  const token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN ? { refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN } : await readJson(tokenPath).catch(() => null);
  if (!token?.refresh_token) {
    throw new AuthRequiredError({ code: 'GOOGLE_AUTH_REQUIRED' });
  }
  const auth = new google.auth.OAuth2(definition.client_id, definition.client_secret, definition.redirect_uris?.[0]);
  auth.setCredentials(token);
  if (!process.env.GOOGLE_DRIVE_REFRESH_TOKEN) auth.on("tokens", tokens => saveToken(tokens).catch(() => logEvent('auth.token_storage_failed', { code: 'STORAGE_FAILURE' })));
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
