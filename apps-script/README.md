# Fino Market Proxy

1. Create a standalone project at https://script.google.com.
2. Copy `Code.gs` and enable the manifest in Project Settings, then copy `appsscript.json`.
3. Add Script Properties: `FINO_PROXY_TOKEN`, `TWELVE_DATA_API_KEY`, `FRED_API_KEY`, `BINANCE_API_KEY`.
4. Run any function once from the editor and approve the external-request permission.
5. Deploy as Web app: execute as **Me**, access **Anyone**.
6. Use the production `/exec` URL. Redeploy a new version after every code change.

Example request:

```json
{
  "token": "your-long-random-token",
  "action": "twelve",
  "symbol": "AAPL",
  "interval": "1day",
  "outputsize": 365
}
```

Supported actions: `health`, `twelve`, `fred`, `binance`, `binanceCatalog`, `inzhurCatalog`, `macroeconomics`, `policyRate`.

## Security of the local changes

The source now limits authorized requests and upstream calls to 120 per minute using ScriptLock/ScriptProperties, rejects oversized/prototype-bearing JSON and impossible calendar dates, filters invalid market bars and logs only safe error codes/statuses. Raw provider messages, URLs and stacks are not returned or logged. UrlFetchApp has platform-controlled deadlines; the native client independently times out. Provider API keys remain in Script Properties. A token embedded in an APK is extractable and only limits access to this market proxy; it is not user authentication.

Deployment status checked on 20 October 2026 (Europe/Kiev): authenticated `health` succeeds, but the live proxy has no API release metadata (`legacy`). It is not verified as the repository release `2026-10-20.1`. The changes described here remain local; no deployment was changed.

The GDP request now selects only the two required Ukrainian series through SDMX component filters. Macro errors and empty policy series are not cached as healthy results. The corrected native client uses a 45-second policy deadline and can read the official NBU endpoint when an older deployment does not support policyRate; its GDP request uses the direct filtered official API.

## API compatibility

`api-contract.json` records `apiVersion`, `minClientVersion`, `release` and `capabilities`. Tests require the metadata in `Code.gs` to match this file. Bump the release for every deployed source change. Every response adds an `api` object while preserving existing `{ok,data}` / `{ok:false,error}` envelopes; health also retains its legacy `data.version` field. New clients send `apiVersion: 1`. Unsupported versions are rejected with `PROXY_API_INCOMPATIBLE` in the error envelope (Apps Script ContentService still controls the actual HTTP response).

Old APKs omit `apiVersion` and remain accepted. New APKs accept older responses without metadata as `legacy`, never as a verified release. Explicitly incompatible or malformed metadata is rejected before exposing market data. There is no extra health request on each page load: compatibility is checked on the market responses already being fetched. Native status exposes the last observed safe `proxy` compatibility/release metadata. Existing official NBU fallbacks remain available.

## Release procedure

1. Review the diff, update `release` in the JSON contract and `Code.gs`, then run `npm.cmd run lint`, `npm.cmd run check:frontend` and `npm.cmd test`. Keep tokens and provider keys only in Script Properties / the ignored local environment.
2. With explicit publication approval, copy the reviewed source and manifest into Apps Script. Under **Deploy → Manage deployments**, edit the existing production deployment, select **New version** and deploy. Keep its `/exec` URL so configured clients do not need a URL change. Record the source commit, API release, deployment version and time; never paste tokens or generated mobile configuration into a release record.
3. Run `npm.cmd run proxy:smoke -- --providers`. This authenticates, requires the exact repository release/capabilities, and checks populated policy-rate and S&P 500 series with bounded requests. Exit 0 is the release gate. `.tmp/proxy-release-verification.json` records safe metadata and `providersVerified`; it is not committed. No raw provider data, URL or credentials are printed. `npm.cmd run proxy:smoke -- --inspect` only observes the current deployment and may report a working legacy release; it is not a release gate.
4. Update/rebuild the client only if its API contract or local/native code changed, and only on an explicit request. Run mobile preparation/preflight and APK verification as a separate step. A backwards-compatible proxy-only release does not require rebuilding every installed APK.
5. If smoke fails, keep the previous client and switch the existing deployment back to its prior version; repeat smoke for that release. Never report synchronization or a deployment as confirmed solely because source files were edited.

CI runs source contracts and tests without production credentials. It neither deploys Apps Script nor creates APKs.
