# Stability release gate

Run `npm.cmd test` on Windows. Tests use memory/temporary storage and stub external providers.

| Supported scenario | Automated coverage | Manual release check |
| --- | --- | --- |
| Empty installation | repository first-run/concurrent reads | Web and Android open an empty portfolio |
| Legacy JSON | stateModel migration/idempotence/unknown fields | Import a backup copy, verify totals, keep original |
| Create / buy / sell | API and memory-domain tests, fractional quantity, overselling | Submit each form and reload |
| Payment receipt | duplicate receipt and maturity closure | Receive once, reload, check history |
| Wallet | valid save, invalid expense/month/loan data | Expenses, plans, notes and loans survive reload |
| Offline external APIs | provider and mobile tests | Disconnect network, verify local operations and honest sync status |
| Drive conflicts | conditional upload/mobile conflict/HTTP 409 | Two devices change data; choose a version only after reviewing backups |
| Failed local write | disk rename failure, revision rollback, temporary cleanup | Verify failure feedback and retry |
| Invalid input | impossible dates, invalid numbers/currencies, malformed JSON | Empty date and invalid quantity never change data |
| Mobile layout | module/mobile adapter tests | At 360px and on device: navigation, scrolling, forms, keyboard, charts, app lock |

For every new feature attach five pieces of evidence to its change:

- API success test.
- Validation test.
- Negative case proving state is unchanged.
- Legacy migration/round-trip check (including unknown fields and future version rejection).
- UI smoke check with viewport/device and result recorded.

Automated module tests do not prove visual layout or native Android behavior. Record manual checks before a release; do not mark them passed from Node tests alone.

`npm run test:ui` executes the real HTML and local scripts in a DOM harness: populated/empty startup, offline providers, navigation, buy submission, wallet saves, filter events and read-only rendering of explicit snapshots. It is also included in `npm test`. For manual visual checks, `npm run smoke:serve` serves isolated in-memory fixtures on http://127.0.0.1:4317 without real financial storage or Drive credentials.

Wallet analytics smoke tests also cover all four charts, category/period filters and interactive legends with the locally bundled Chart.js 4.5.1. The real-library test uses a drawing context stub in jsdom; it validates chart initialization and interactions, not painted pixels or responsive browser layout.

Compatibility exports remain available through `window.ui` and the original public function names. Wallet actions persist a draft before committing store data; failed saves and responses from an obsolete account snapshot cannot replace current data. Historical market responses also check snapshot identity. Remove compatibility aliases only after callers migrate and smoke checks pass.

Future APK preparation: finish the manual web checks, run `npm.cmd run mobile:sync`, build Android, verify the new APK using `backend/scripts/verifyMobileAssets.ps1`, then install it and perform the device checks. Comparing the frontend to an older APK before rebuilding only detects stale assets.

Financial-integrity regressions cover partial sale followed by purchase, immutable previous sale results, remaining cost in browser analytics and historical charts, legacy fallback/idempotence, reduced coupon/redemption quantities, explicit dividend record dates, duplicate-free merging and partially received dividends. Native regressions cover the same purchase/merge rules and concurrent trading during market synchronization. API regressions exercise invalid calendar dates/numbers, incompatible merges, HTML payment types, same-origin access, JSON 404, 403/415 and external deadlines. DOM checks cover literal display of legacy HTML and failed wallet-plan/expense saves. These automated results do not replace visual browser or device checks.

## Errors and diagnostics

JSON errors retain `error` and typed errors add stable `code` and `category`. `X-Error-Category` classifies validation, auth_required, access_denied, not_found, conflict, remote_unavailable, storage_failure or internal_error. `X-Request-Id` correlates a request with JSON event logs. Mutations log only their route, method, status and timing; financial values and authentication data must not be logged. Storage failures and sync queue failures have separate events. A local commit and cloud synchronization are distinct outcomes.

## Ownership

Routes handle HTTP; `frontend/js/validation.js` provides shared raw-input rules through `backend/validators/requests.js` and the mobile adapter. `frontend/js/constants.js` owns the shared vocabulary and instrument defaults. Domain services own calculations and operations; repository owns structural normalization/migrations and atomic disk writes. `domain/readState.js` applies portfolio rules after repository reads; `domain/calculations.js` shares sale and maturity calculations. Shared state factory/versioning stays in `frontend/js/state-model.js` for web and mobile compatibility. Frontend state, forms, renderers, charts and analytics stay in their existing modules.

## Sync lifecycle release checks

The 2026-10-17 local performance correction passes all 198 tests and mobile preflight. It separates native local and Drive queues, coalesces automatic uploads and renders backend local data before Drive initialization. Regression tests stall Drive while reading/editing, reject concurrent download replacement, preserve pending state after older confirmations, check account changes, coalesce 20 edits into one upload, and recover compact/legacy journals after rollover or mirror failure. Reconnect cancels deferred uploads and status polling does not reopen authorization. In an isolated synthetic run with 15 ms per mocked request, post-save local reads changed from 334 ms to under 1 ms; the journal after 50 edits changed from 200,643 to 22,140 bytes. These are controlled measurements, not device timings. APK packaging, publication and physical-device verification have not been performed for these changes.

The subsequent web-session and macroeconomics regression fixes pass 183 tests. Coverage includes a real backend restart followed by one wallet commit, coalesced/bounded client renewal, origin/proxy denial, malformed cookies, deep links, separate local-port cookies, and wallet saves without an error modal. Macro regressions cover compact GDP queries, 15-second delayed policy responses within the 45-second budget, bounded hung requests, empty/failed native proxy fallback caches, cache expiry, concurrency-slot release across minute boundaries, and populated GDP/policy charts after reopening a failed section.

Live checks on 2026-10-13 confirmed the regression: the unfiltered GDP CSV was 18,540,447 bytes, exceeding the new 5 MB limit, and a policy response took 15 seconds, exceeding the wrapper's 10-second deadline. The filtered official response was 52,401 bytes and exactly reproduced the 15 nominal/14 real-index points from the full file. The real local HTTP API and native JS adapter returned all GDP series and 1,382 policy observations without source errors. Native adapter verification uses direct official APIs in a VM, not a physical Android WebView. Apps Script source changes are not deployed.

Automated checks cover unconfirmed uploads, stale acknowledgements, startup with unsent changes, conflict preservation, corrupted JSON, torn journal tail, failed final journal commit rollback, native journal failure/cache recovery, separate manual backup outcomes, private-folder enforcement, tagged backup retention and fenced explicit download. Security checks cover forwarded Host/protocol/peer validation, same-origin browser sessions, provider rate limits/retry classes, state/remote validation and safe logs. Proxy tests validate impossible dates, budgets and redaction of upstream failures.

The 2026-10-13 review passed 168 Node/DOM/native-adapter tests, full Gradle Java compilation, four meaningful native disk-failure unit tests (plus the template test), and Android lint with zero errors and 35 nonblocking warnings. The full native UI smoke uses the real Chart.js library with a stub drawing context, boots offline after cancelled authorization, saves a wallet plan and recovers a corrupted compatibility mirror from the journal. See [MOBILE-READINESS.md](MOBILE-READINESS.md).

Pending manual checks: rebuilt APK on a physical device, real Google authorization/Drive metadata/ETag behavior and OS restart/disk-failure scenarios. The live proxy health request was declined; Apps Script changes remain undeployed. Public access requires separate authentication. Windows ACL hardening was previously rejected and remains unapplied. After separate approval, mobile:apk succeeded, all 69 frontend asset hashes and required native classes were verified, and the certificate matched the preserved working key. The user's concurrent APK used a different profile key and was not installed; debug signing now explicitly reuses the preserved key. The owner explicitly requested source and verified APK publication to mobile-app after the proxy-token disclosure; private provider/OAuth/signing credentials remain excluded. Apps Script deployment was not performed.
