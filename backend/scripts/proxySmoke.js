// Explicit release check. Never prints URL, tokens, raw response or provider data.
require('../config/loadEnv');
const fs = require('node:fs');
const { fetchWithTimeout } = require('../../shared/request');
const { proxyCompatibility, proxyApiVersion } = require('../../shared/market-model');
const expected = require('../../apps-script/api-contract.json');
async function main() {
  const url = String(process.env.FINO_PROXY_URL || '').trim();
  const token = String(process.env.FINO_PROXY_TOKEN || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url) || token.length < 32) throw Error('Invalid local proxy configuration.');
  const response = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, apiVersion: proxyApiVersion, action: 'health' }) }, { timeoutMs: 20000 });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || payload.data?.service !== 'fino-market-proxy') throw Error('Proxy authentication or health check failed.');
  const compatibility = proxyCompatibility(payload.api, 'health');
  const matchesRepository = compatibility.state === 'compatible' && compatibility.release === expected.release && expected.capabilities.every(action => payload.api.capabilities.includes(action));
  const result = { verifiedAt: new Date().toISOString(), expectedRelease: expected.release, release: compatibility.release, apiVersion: compatibility.apiVersion, compatibility: compatibility.state, authenticated: true, matchesRepository, providersVerified: process.argv.includes('--providers') ? false : null };
  fs.mkdirSync('.tmp', { recursive: true });
  fs.writeFileSync('.tmp/proxy-release-verification.json', JSON.stringify(result, null, 2));
  if (!process.argv.includes('--inspect') && !matchesRepository) throw Object.assign(Error(), { code: 'PROXY_DEPLOYMENT_MISMATCH' });
  console.log('Authenticated proxy: ' + (result.release || 'legacy (unversioned)') + '; matches repository: ' + matchesRepository + '.');
  if (process.argv.includes('--providers')) {
    if (!matchesRepository) throw Object.assign(Error(), { code: 'PROXY_DEPLOYMENT_MISMATCH' });
    for (const [action, parameters] of [['policyRate', {}], ['fred', { symbol: '.INX', startDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) }]]) {
      const check = await fetchWithTimeout(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, apiVersion: proxyApiVersion, action, ...parameters }) }, { timeoutMs: 45000 });
      const body = await check.json(); proxyCompatibility(body.api, action);
      const values = action === 'policyRate' ? body.data?.policyRate : body.data?.values;
      if (!check.ok || !body.ok || !Array.isArray(values) || !values.length || values.some(row => !Number.isFinite(Number(row.value ?? row.close)))) throw Object.assign(Error(), { code: 'PROXY_PROVIDER_SMOKE_FAILED' });
      console.log('Provider smoke passed: ' + action + '.');
    }
    result.providersVerified = true;
    fs.writeFileSync('.tmp/proxy-release-verification.json', JSON.stringify(result, null, 2));
  }
}
main().catch(error => {
  const code = ['PROXY_DEPLOYMENT_MISMATCH', 'PROXY_PROVIDER_SMOKE_FAILED'].includes(error.code) ? error.code : 'PROXY_SMOKE_FAILED';
  console.error(code + ': check configuration, deployment and network; no credentials were logged.'); process.exitCode = 1;
});
