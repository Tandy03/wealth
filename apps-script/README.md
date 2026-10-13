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

Supported actions: `health`, `twelve`, `fred`, `binance`, `binanceCatalog`.

## Security of the local changes

The source now limits authorized requests and upstream calls to 120 per minute using ScriptLock/ScriptProperties, rejects oversized/prototype-bearing JSON and impossible calendar dates, filters invalid market bars and logs only safe error codes/statuses. Raw provider messages, URLs and stacks are not returned or logged. UrlFetchApp has platform-controlled deadlines; the native client independently times out. Provider API keys remain in Script Properties. A token embedded in an APK is extractable and only limits access to this market proxy; it is not user authentication.

These source changes have not been deployed. Review them before publishing a new Apps Script deployment.
