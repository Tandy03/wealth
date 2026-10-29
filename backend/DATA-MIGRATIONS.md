The shared browser/Node model is `shared/state-model.js` (`frontend/js/state-model.js` remains a compatibility export). It describes
Asset, Transaction, Sale, Payment, CalendarNote, Wallet and Instrument. Missing
legacy fields and unknown extension fields are preserved. Known numeric fields
accept finite legacy numeric strings, converted on read/write. Dates use strict
YYYY-MM-DD calendar validation; currencies and asset/transaction types normalize
case. Indexes are transient Maps, never part of the JSON document.

Unversioned JSON is version 0; the current version is 1. Future versions are
rejected before replacement. Read/write adapters return fresh documents and the
repository keeps atomic file replacement. Wallet collection structure is checked
by validateState. The model adds no dependencies and uses linear passes.

To preview a migration without replacing data:

    node backend/scripts/migrateData.js old.json migrated.json

The destination must not exist. Compare it and run `npm test` before adopting it.
Add future transformations to the ordered migrations array and increase the
version only with compatibility, repeatability and invalid-write tests.

Drive exposes initialize/read/write/merge/resolveConflict while retaining old
method names. Divergent snapshots require an explicit local/remote strategy;
there is no automatic union of financial records. Existing upload conflict
checks and backups remain in place. The merge functions are pure and do not
upload or replace files themselves.

Market adapters live in backend/services/market. NBU owns rates, its cache and
stale fallback; other adapters preserve existing provider implementations.
marketService.createService accepts nbu/fred/frankfurter/macro overrides.

The monthly invested chart sums BUY amounts at purchase-date FX, subtracts SELL
cost basis at purchase FX, and excludes savings and income. It represents the
monthly change of invested cost, not sale cash proceeds or all transactions.
Legacy SELL records without costBasis fall back to amount.
