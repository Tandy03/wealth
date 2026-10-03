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

Compatibility exports remain available through `window.ui` and the original public function names. Wallet actions persist a draft before committing store data; failed saves and responses from an obsolete account snapshot cannot replace current data. Historical market responses also check snapshot identity. Remove compatibility aliases only after callers migrate and smoke checks pass.

Future APK preparation: finish the manual web checks, run `npm.cmd run mobile:sync`, verify packaged assets using `backend/scripts/verifyMobileAssets.ps1`, then build/install Android and perform the device checks. This maintenance change does not run synchronization or an APK build.

## Errors and diagnostics

Existing JSON errors retain `{ error: "message" }`. `X-Error-Category` classifies validation, not_found, conflict, external_api_failure, storage_failure or internal_error. `X-Request-Id` correlates a request with JSON event logs. Mutations log only their route, method, status and timing; financial values and authentication data must not be logged. Storage failures and sync queue failures have separate events. A local commit and cloud synchronization are distinct outcomes.

## Ownership

Routes handle HTTP; `frontend/js/validation.js` provides shared raw-input rules through `backend/validators/requests.js` and the mobile adapter. `frontend/js/constants.js` owns the shared vocabulary and instrument defaults. Domain services own calculations and operations; repository owns structural normalization/migrations and atomic disk writes. `domain/readState.js` applies portfolio rules after repository reads; `domain/calculations.js` shares sale and maturity calculations. Shared state factory/versioning stays in `frontend/js/state-model.js` for web and mobile compatibility. Frontend state, forms, renderers, charts and analytics stay in their existing modules.
