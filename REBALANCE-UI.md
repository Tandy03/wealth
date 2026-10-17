# Portfolio Rebalance UI — 17.10.2026

The page uses the existing portfolio data and `calculateRebalancePlan()` from `frontend/js/analytics/portfolio-finance.js`. Its grouping, current-price fallback, currency conversion, purchase-only recommendations and 0.005 action threshold are unchanged. No demonstration values are included in the application.

## Components and files

| File | Responsibility |
| --- | --- |
| `frontend/index.html` | Summary, comparison canvases, shared legend, editor, validation and results sections |
| `frontend/css/rebalance.css` | Scoped dashboard layout, four-theme asset palettes, sliders, focus states and mobile table cards |
| `frontend/js/rebalance/model.js` | Input validation and explicit normalization; no financial formulas |
| `frontend/js/rebalance/dashboard.js` | Draft targets, preserved inputs, chart updates, current valuations and calculation results |
| `frontend/js/renderers/calculators.js`, `frontend/js/controllers/calculators.js`, `frontend/js/forms/calculators.js` | Compatibility entry points, form wiring and planned assets |
| `frontend/js/controllers/application.js`, `frontend/js/forms/settings.js` | Valuation and theme refresh without losing targets |
| `frontend/js/i18n.js` | English, German, Ukrainian, Spanish, Polish and Italian labels, errors and accessibility text |
| `backend/tests/rebalanceModel.test.js`, `backend/tests/uiSmoke.test.js` | Rounding, interaction, calculation regression, themes, translations and empty/large states |

## Editing and validation

Native range controls and numeric fields use 0–100 with step 0.1. Their values synchronize on input; editing one allocation never changes the others. Invalid, blank or excessive-precision values disable Calculate. Targets remain intact on ordinary rerenders and theme changes. A changed allocation, asset list or valuation invalidates the old result. Financial holdings are never modified by this editor, including when a row is removed from the plan.

Normalize is an explicit action. Positive weights are scaled to 1,000 integer tenths, rounded down, then the remaining tenths are awarded by largest fractional remainder, with stable row order breaking ties. The resulting sum is 100%, original zeros remain zero, and an all-zero set shows a localized message.

## Charts, themes and localization

The analytics Asset allocation chart now shares the rebalance palette, 74% cutout, theme-colored outlines/tooltips, centered portfolio value and compact legend. Grouping and interactive legend toggles remain available. Native CSS scrollbars use a rounded thumb, subtle theme-colored rail and hover color, including the scrolling rebalance legend; no React/Radix dependency is added, and browser/touch scrolling remains native.

## Persistence

Targets, planned assets and excluded rows are saved in the optional `rebalance` portfolio field through `PUT /api/rebalance` on desktop and the existing journaled mutation path on Android. Drive carries the field with the rest of the portfolio. Shares may remain incomplete between edits. Only valid numeric shares are saved; transient blank/invalid text is not part of the document. Calculated recommendations remain temporary and are invalidated when their inputs change.

Writes coalesce for 200 ms, flush on change/page hide, and use keepalive for small desktop requests. A scoped session draft restores valid choices if the tab reloads before a request completes. It includes the expected/in-flight baseline so recovery cannot silently overwrite a different saved plan. The backend and native adapter reject stale baselines with 409. Failed saves preserve the editable draft and display Retry; conflicts provide an explicit Reload saved plan action. Local-save feedback does not claim an unconfirmed Drive upload. Cross-device availability requires Drive synchronization and clients containing this update; the current APK includes these changes.

Chart instances are reused. Only changed datasets/theme settings are updated; the current chart does not change when targets are edited. Native allocation data is cached between target-input events rather than recalculating financial balances for every keystroke. Both charts, the shared legend, rows and result table use the same asset colors. Backgrounds, text, borders, tooltip colors and semantic states use the existing theme tokens. Asset palettes have tonal adjustments for light and analog themes. Animations respect reduced-motion preferences.

Percentage and UAH amounts use `Intl.NumberFormat` with the active locale. Asset names and tickers are escaped and excluded from automatic translation, including chart tooltips. The application currently reloads the page when switching languages; this existing behavior is unchanged. Theme changes do not reload the page.

The CSS places charts side by side on desktop and stacks them below 700px. Editor rows adapt to a two-line layout on mobile with 44px remove targets; result tables become two-column cards with a full-width asset name and target row. All result containers explicitly reset the generic 720px table minimum and the inherited results grid. The total uses its own full-width card with the amount below its caption. Below 380px summary cards stack; mobile bottom spacing lets the final amount scroll above the fixed settings button and safe-area inset. Native controls retain keyboard behavior, visible focus, accessible names and validation descriptions.

## Current-day USD display

Both Total to invest amounts show their USD equivalent on hover, keyboard focus or tap. Tap/Enter/Space pins the display; a second activation, Escape, blur or an outside tap restores UAH. The hint identifies the official NBU rate and its date. The calculation and saved portfolio remain in UAH and are never changed by this display.

`frontend/js/rebalance/currency-hover.js` requests the USD quote through the existing desktop/native currency-history adapter for the exact current calendar day in Europe/Kyiv. The request starts on interaction, is shared between both amounts and is cached for that day in memory. Failed requests back off for 30 seconds. Only a positive finite numeric rate with the matching day, USD currency and NBU provider is accepted. Missing, stale or invalid rates leave UAH visible with an unavailable message. A late response cannot restore an invalidated calculation. The CSS and six-language messages are shared by the website and Android sources.

The 18 October USD update passes the full suite (223 tests) and mobile preflight (70 asset references, 163 JavaScript sources). Tests cover the web/native adapters, conversion, touch and keyboard controls, request coalescing, failure backoff, Kyiv midnight, invalid/stale responses, zero totals and unchanged financial state. The rebuilt 18 October APK contains this update; all 73 frontend files match their source hashes and its signing certificate matches the previous artifact and the previously retrieved phone APK. This build has not been installed. A fresh ADB verification request was declined, so this interaction has not been verified on the connected phone.

## Preserved limitations

The algorithm recommends purchases only. A held asset with a 0% target remains held; the UI explains that this target cannot be achieved through a sale in this calculator. Current allocation includes actual holdings even when a holding is removed from the plan. Target projection amounts are omitted when excluded/zero-target holdings prevent a faithful projection. Calculation outputs remain those of the existing algorithm.

## Verification

The full suite passes 223 tests. Coverage includes exact financial regression results, two-way controls, normalization, under/over-allocation, retained drafts, stale-result clearing, adding/removing planned and current rows, HTML escaping, zero targets, long names, 40 assets, empty portfolios and operation when Chart.js is unavailable. Persistence checks cover web reload, native journal restart, mock Drive upload/download, shared JSON validation, session recovery during an unfinished write, failed-save retry and conflict handling. DOM tests exercise the actual local Chart.js library, all six languages and all four theme palettes, including tooltip/marker color correspondence and analytics legend toggling. Mobile preflight passes.

The canvas drawing context is stubbed in DOM tests. The flat app-mode switch was checked through ADB on Samsung SM-G980F / Android 13 / WebView 111 using live CSS and a cropped screenshot. The 17 October APK was installed with `adb install -r`; its hash matches the recorded artifact and cold launch succeeds. Live WebView checks confirmed the rebalance controller and persistence API. Artifact metadata and the installation status of the newer 18 October build are recorded in MOBILE-READINESS.md.

On 18 October, the phone exposed a real layout regression: the generic mobile table minimum stretched the results to 720px inside a 360px viewport, placing the total off screen. The corrected CSS passes 51 geometry checks in the actual phone WebView with isolated synthetic fixtures: six languages at widths 320, 360, 390, 412, 600, 768, 1024 and 1280px, plus the other three themes at 360px. Long asset names and large amounts are included. No tested element overflows horizontally; the total is visible at the page end and avoids the settings button. The live user's page also measured 332px content/scroll width with the total bottom at 645px, above the settings button at 695px. The initially declined Gradle request was subsequently approved for rebuilding; the 18 October APK now packages this correction and the USD update. The phone was given a temporary CSS preview, but this new APK has not been installed. Full keyboard, financial and live Drive scenarios remain outside this layout check.
