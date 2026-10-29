require("../config/loadEnv");
const { authorizeInteractively, tokenPath } = require("../services/googleDrive/auth");

async function main() {
  console.log("Opening Google authorization in your browser...");
  await authorizeInteractively();
  console.log(`Authorization successful. Token saved to ${tokenPath}`);
  console.log("Do not share or commit google-token.json.");
}

main().catch((error) => {
  require('../utils/observability').logEvent('auth.failed', { code: error.code || 'AUTHORIZATION_REQUIRED' });
  process.exitCode = 1;
});
