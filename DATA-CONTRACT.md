# Data, persistence and synchronization contract

`state-contract.js`, `state-model.js`, `sync-model.js` and `errors.js` are shared by HTTP, browser and native code. The JSON schema stays at version 1: sparse legacy documents and unknown safe fields are preserved. Future schema versions, duplicate IDs, unsupported types, invalid calendar dates, nonfinite or negative monetary inputs, invalid wallet schedules and prototype properties are rejected before application. Numeric strings from forms remain supported.

## Financial invariants

- `asset.quantity` is historical acquired quantity. `remainingQuantity` is the balance on the requested date. Sales never reduce historical acquired quantity.
- Remaining cost is the cost of eligible purchases minus the recorded cost basis of eligible sales. Remaining average price is remaining cost divided by remaining quantity; an empty or redeemed position has zero remaining cost.
- New sales use moving average cost and store immutable `costBasis`, proceeds and profit. Historical unmarked sales retain their legacy treatment. Cached calculated fields do not replace the purchase/sale ledger.
- A position is closed after its explicit closure or received maturity, or when its remaining quantity is zero. Legacy received maturities without a date close the position as of today; an unknown historical receipt date is not invented retroactively.
- A payment is completed when its status is `received`/legacy `paid`, or its legacy received flag is true. Planned payments are forecasts. A transaction is completed when its status is `completed`/`posted`, or its legacy status is absent. Pending, planned and cancelled buys are excluded from eligible purchases.
- Generic transaction writes maintain the same purchase/sale/payment records and remaining balance as dedicated domain operations. SELL transactions store a correlated sale; received payment transactions have a payment ID.
- Dividend entitlement uses explicit `recordDate`, otherwise `dividendRecordRule` (`previous_month_end` by default, or `payment_date`). Coupons and redemption use holdings on the payment date.
- Received payments and earlier sale results remain historical records. Future schedules can be rebuilt; planned duplicates are coalesced. Merge identity includes instrument identity and payout terms.

Financial calculations live in `portfolio/calculations.js`; compatibility repairs and cached holdings in `portfolio/normalization.js`; edits, schedules and operations in `portfolio/operations.js`. `portfolio-rules.js` is a compatibility facade. Formatting stays in UI utilities/renderers.

## What success means

| State | Meaning | savedRemotely |
| --- | --- | --- |
| `local-saved` | Local document committed; cloud sync is disabled or no remote confirmation exists | false |
| `sync-pending` | A committed local version still needs confirmation | false |
| `sync-confirmed` | The current version has been acknowledged by Drive | true |
| `conflict` | Versions diverged; keep both until an explicit choice | false |
| `auth-required` | Drive needs authorization; local changes stay available | false |

`savedLocally`, `savedRemotely` and `backupSaved` are separate outcomes. A backup does not acknowledge the primary portfolio upload. `backupSaved` in status means a backup has been confirmed during this session, not that the current version is automatically backed up. Backup kind/time are recorded separately. Upload HTTP success alone is insufficient: the adapter reads the saved JSON back. A matching remote checksum can acknowledge an already identical document without rewriting it. An older acknowledgement cannot confirm newer local changes.

Sync endpoints include these outcomes in JSON. Financial HTTP mutations expose `X-Save-State`, `X-Saved-Locally`, `X-Saved-Remotely`, `X-Backup-Saved`; the JS fetcher exposes them as a nonserialized `result.persistence` property. Native mutation results expose the same property. `success: true` confirms the requested operation, not every storage destination.

## Recovery and conflicts

Backend uses `data.json.journal.ndjson`: checksummed full-snapshot `prepare`, `commit` and remote `confirmed` events. Files and journal appends are flushed to disk. A failed final commit rolls back the JSON and caller revision. Restart recovers the last committed snapshot if JSON is missing, corrupted or uncommitted; only a torn final journal append is trimmed. Corruption in the middle fails closed. Compaction preserves all changes after the latest acknowledged commit and the latest 50 recovery snapshots. This is a single-writer local repository, not a distributed event database.

Unsent local data is queued on startup, not replaced with Drive data. Unknown baselines and remote deletion become conflicts. Download preserves the prior local version, then locks only the final application step and rejects concurrent local changes. Uploads serialize separately from financial mutations, recheck remote metadata after backup, and use `If-Match` when an ETag is available. If a provider supplies no ETag, the pre/post checks detect divergence but cannot guarantee a server-side compare-and-swap; backups and the journal remain recovery mechanisms.

Native commits data and sync metadata together in a checksummed account-scoped journal, with the latest 50 snapshots. The main Preferences key and old metadata key are compatibility mirrors; a failed mirror write does not discard a committed journal. `FinoStoragePlugin` uses synchronous `SharedPreferences.commit()` on a worker thread. `ConfirmedPreferences` restores the previous memory value after a failed commit and blocks further reads/writes until restart, so an unconfirmed in-memory journal cannot be mistaken for disk data. Older builds without this plugin fall back to Preferences and do not provide the same disk-confirmation guarantee. Full Gradle Java compilation, four disk-failure unit tests and Android lint passed without packaging an APK; physical device verification remains.

Native normalization is a local change: it is journaled, advances the local revision and remains pending when it differs from the downloaded snapshot. Only an exact read-back confirmation clears pending status. Native reads verify ownership and stable Drive version/checksum before and after media download; duplicate portfolio files and deletion require an explicit choice. Unfinished buys cannot participate in shared legacy-history repairs or single-purchase edits. Cancelling Google authorization rejects the native promise instead of leaving the operation queue waiting.

## Backups and security boundary

New backups are owned by the authorized Drive account in a private owner-only folder, tagged `finoBackup=true` and `kind=manual|automatic`. Code creates/copies backups and never overwrites them. Retention removes only owned, tagged files of the selected kind: automatic 10/30 days; manual 30/90 days. Backend count limits can be configured. Legacy/untagged/shared files are never pruned automatically. Local native recovery copies remain inside app storage and do not survive uninstall.

The server binds to `127.0.0.1`. API access validates the actual Host/socket peer instead of proxy-derived hostname/protocol, rejects forwarded headers and foreign/same-site browser origins, and requires an HttpOnly SameSite=Strict session for browser requests. Cookie names include the local port so concurrent local servers do not replace each other's cookie. A stale/missing session is rejected with `BROWSER_SESSION_REQUIRED` before financial handlers run. The desktop transport renews through `POST /api/session` with `X-Fino-Session: renew`, then retries that rejected request once; simultaneous failures share renewal. The renewal endpoint still enforces local/same-origin/proxy guards and requires an application request. HTML/deep-link responses issue the cookie with no-store caching. Local CLI clients remain trusted. This is not account authentication or a public hosting configuration: a local reverse proxy that removes every forwarding/origin header is indistinguishable from a trusted local client. Public exposure requires a separate authentication boundary.

Market requests have bounded concurrency, per-origin budgets and header/body deadlines. Active request slots survive rate-window resets and release when their bodies finish. Defaults are 10 seconds; macro data uses 25 seconds and NBU policy rates 45 seconds, retaining bounds without overriding slower official-source budgets. GDP uses a filtered SDMX query instead of downloading all national accounts; backend/native share GDP and policy normalization. Partial macro failures expire after 30 seconds, empty policy responses are rejected rather than cached, and reopening the UI can retry failed sources. JSON and provider-specific financial data are validated before use. Drive retries are bounded to 3; conflicts, authorization, validation and local storage failures are not retried. Apps Script has request/upstream budgets and sanitized errors, but UrlFetchApp has platform-managed deadlines rather than AbortController.

Typed errors have stable `code`, `category`, HTTP status and safe public payloads. Logs allow only diagnostic fields and centrally redact secrets/records. OAuth refresh tokens can come from environment or private local files; token writes are atomic and restrict new Windows token-file permissions. `.env`, credentials, tokens, journals, API notes and keystores are ignored by Git. The existing Windows files still have inherited permissions: applying `backend/scripts/protectSecrets.ps1` was not authorized during this review.

The market proxy token is embedded in a client APK and is extractable; it is a quota gate, not a private user credential. Provider keys stay in Apps Script Properties. The owner explicitly requested publication of the verified, already tracked debug APK together with source to mobile-app after the embedded-token disclosure. Other APK artifacts, signing keys, OAuth credentials/tokens, private financial data and generated source configuration remain ignored. Older commits can also contain APKs and embedded configuration. The approved build passed asset/native-class/signature verification, as recorded in MOBILE-READINESS.md. Apps Script deployment remains a separate operation.
