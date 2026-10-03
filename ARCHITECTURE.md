# Application boundaries

## Backend

`backend/server.js` starts the HTTP listener. `backend/app.js` composes one repository and the services and routers that use it. Tests inject a repository with temporary storage.

`backend/routes/` translates HTTP requests, service results and domain errors. Portfolio operations (`createAsset`, `buyMoreAsset`, `sellAsset`) live in `domain/portfolioService.js`; payment operations (`markPaymentReceived`) live in `domain/paymentService.js`; market integrations live in `domain/marketService.js`. `domain/state.js` owns normalization, portfolio recalculation and planned payment updates, using the rules in `domain/portfolio.js`.

`backend/data/repository.js` is the JSON persistence boundary. It imports the shared structural state model directly, without portfolio calculations. `domain/readState.js` applies the domain normalization and recalculation after reads. Domain services read and save through this abstraction. Service mutations use the shared repository queue to prevent concurrent read/modify/write operations from losing updates. Cloud downloads use that queue through the sync route. Do not wrap already queued service operations in another queued operation.

Every write validates the state, including imports through `writeLocalData`. Local writes serialize a normalized snapshot to a temporary file and rename it. `saveData` advances sync metadata and queues a Drive upload; `writeLocalData` preserves imported metadata. Empty documents come from the same state factory.

`validators/requests.js` instantiates the shared `frontend/js/validation.js` with backend domain errors. The mobile adapter consumes the same raw-input rules before local mutations. Query parameter shapes and dates are checked at the HTTP boundary. Numeric strings from forms remain supported; booleans, objects, nonfinite values and impossible dates are rejected. `validators/operations.js` validates payment/transaction references and operation-specific fields. `config/constants.js` re-exports `frontend/js/constants.js`, the shared business vocabulary, instrument defaults and calculation constants. Legacy document validation remains separate from new-operation validation so sparse historical snapshots can still migrate.

Writes update caller sync metadata only after a successful atomic commit. Temporary files are cleaned after failed writes. Storage failures use HTTP 503, Drive conflicts use 409, and malformed JSON uses 400. `utils/observability.js` emits structured mutation/error events and response correlation headers while preserving existing error JSON shapes. See `STABILITY-CHECKLIST.md` for the release gate and device checks.

## Shared state

`frontend/js/state-model.js` defines the document shape, empty state, structural validation and normalization for the backend, web UI and mobile adapter. It has no DOM or storage dependencies. `frontend/js/state.js` owns application state; `stateStore.replaceData` applies the shared document model.

## Frontend

- `state-store.js`: validated document actions, selectors and subscriptions; `state.js` supplies initial UI state and the compatibility alias.
- `api.js`: thin facade selecting `api/desktop.js` or `api/mobile.js` at call time; `api/fetchers.js` owns HTTP response/error handling.
- `data-loader.js`: data loading, historical exchange-rate cache and benchmark loading.
- `app.js`: bootstrap and loading orchestration. `controllers/` owns section interactions, render orchestration and persistence actions.
- `forms/`: collect input, invoke services/API and handle feedback.
- `renderers/`: display explicit state snapshots without API requests or financial mutations. `views/` contains reusable HTML templates.
- `charts/`: chart configuration and lifecycle.
- `models.js`: compose DOM-free analytics against the application's state.

Analytics modules can be required directly in Node tests. `portfolio-performance.js` calculates historical performance; `market-data.js` handles exchange conversion and market series; `analytics/portfolio-finance.js` calculates holdings, valuation and rebalance plans; `cashflow.js` calculates profit, XIRR, profit summaries and payment event grouping; `wallet-analytics.js` calculates wallet and loan data. Financial rules belong in these modules, with DOM code consuming their results.

Run `npm test` (`npm.cmd test` in Windows PowerShell if script execution is restricted). Tests cover API compatibility, concurrency, invalid repository writes, mobile sync and financial calculations. Frontend changes require `npm run mobile:sync` and an Android rebuild before they appear in an installed APK.
