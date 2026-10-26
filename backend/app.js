const express = require("express");
const path = require("node:path");
const { createRepository } = require("./data/repository");
function createApp({ repository = createRepository(), frontend = {} } = {}) {
    const app = express();
    const frontendDir = frontend.directory || path.join(__dirname, '..', '.tmp', 'frontend-dist');
    if (!require('node:fs').existsSync(path.join(frontendDir, 'index.html'))) throw new Error('Frontend build is missing. Run npm run build:frontend.');
    const browserSession = require('./utils/apiAccess').createBrowserSession();
    app.use(require('./utils/observability').observeApi);
    app.use('/api', require('./utils/apiAccess').protectApi);
    app.post('/api/session', browserSession.renew);
    app.use('/api', browserSession.protect);
    app.use(browserSession.issue);
    app.use(express.json({ limit: "2mb" }));
    app.use((req, res, next) => {
        const json = res.json;
        res.json = function (body) {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && res.statusCode < 400 && repository.getSyncStatus) {
                const status = repository.getSyncStatus();
                res.set({ 'X-Save-State': status.state, 'X-Saved-Locally': String(status.savedLocally),
                    'X-Saved-Remotely': String(status.savedRemotely), 'X-Backup-Saved': String(body?.backupSaved === true) });
            }
            return json.call(this, body);
        };
        next();
    });
    app.use((req, res, next) => req.path.startsWith('/api/')
        ? require('./validators/requests').validateHttpRequest(req, res, next) : next());
    // Only the neutral resource directory is public, never the project root.
    app.use('/shared', express.static(path.join(__dirname, '..', 'shared'), { index: false }),
        (_req, _res, next) => next(new (require('./utils/domainError').DomainError)({ error: 'Resource not found.', code: 'NOT_FOUND' }, 404)));
    app.use(frontend.middleware || express.static(frontendDir));
    const market = require("./domain/marketService").createService(repository);
    app.use(require("./routes/data").createRouter(require("./domain/dataService").createService(repository), repository));
    app.use(require("./routes/sync").createRouter(require("./services/syncService").createService(repository), repository));
    app.use(require("./routes/market").createRouter(market, repository));
    app.use(require('./routes/assets').createRouter({
        assets: require('./domain/assetService').createService(repository),
        purchases: require('./domain/purchaseService').createService(repository),
        merges: require('./domain/assetMergeService').createService(repository),
        sync: require('./domain/assetSyncService').createService(repository, market),
    }));
    app.use(require("./routes/transactions").createRouter(require("./domain/transactionsService").createService(repository), repository));
    app.use(require('./routes/sales').createRouter(require('./domain/saleService').createService(repository)));
    app.use(require("./routes/payments").createRouter(require("./domain/paymentService").createService(repository), repository));
    app.use(require("./routes/calendar").createRouter(require("./domain/calendarService").createService(repository), repository));
    app.use(require("./routes/wallet").createRouter(require("./domain/walletService").createService(repository), repository));
    app.use(require('./routes/rebalance').createRouter(require('./domain/rebalanceService').createService(repository)));
    app.use('/api', (_req, _res, next) => next(new (require('./utils/domainError').DomainError)({ error: 'API endpoint not found.', code: 'NOT_FOUND' }, 404)));
    app.get("*splat", async (req, res, next) => {
      try {
        if (/\.(?:js|mjs|css|map|json|png|svg|woff2?)$/i.test(req.path)) return next(new (require('./utils/domainError').DomainError)({ error: 'Resource not found.', code: 'NOT_FOUND' }, 404));
        browserSession.issueDocument(req, res);
        if (frontend.transformHtml) res.type('html').send(await frontend.transformHtml(req.originalUrl, require('node:fs').readFileSync(path.join(frontendDir, 'index.html'), 'utf8')));
        else res.sendFile('index.html', { root: frontendDir });
      } catch (error) { next(error); }
    });
    app.use(require('./utils/apiError').errorHandler);
    return app;
}
module.exports = { createApp };
