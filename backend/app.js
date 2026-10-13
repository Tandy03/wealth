const express = require("express");
const path = require("node:path");
const { createRepository } = require("./data/repository");
function createApp({ repository = createRepository() } = {}) {
    const app = express();
    const frontendDir = path.join(__dirname, "..", "frontend");
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
    app.use(express.static(frontendDir));
    const market = require("./domain/marketService").createService(repository);
    app.use(require("./routes/data").createRouter(require("./domain/dataService").createService(repository), repository));
    app.use(require("./routes/sync").createRouter(require("./services/syncService").createService(repository), repository));
    app.use(require("./routes/market").createRouter(market, repository));
    const portfolio = require("./domain/portfolioService").createService(repository, market);
    app.use(require("./routes/assets").createRouter(portfolio, repository));
    app.use(require("./routes/transactions").createRouter(require("./domain/transactionsService").createService(repository), repository));
    app.use(require("./routes/sales").createRouter(portfolio, repository));
    app.use(require("./routes/payments").createRouter(require("./domain/paymentService").createService(repository), repository));
    app.use(require("./routes/calendar").createRouter(require("./domain/calendarService").createService(repository), repository));
    app.use(require("./routes/wallet").createRouter(require("./domain/walletService").createService(repository), repository));
    app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
    app.get("*splat", (req, res) => {
        browserSession.issueDocument(req, res);
        res.sendFile(path.join(frontendDir, "index.html"));
    });
    app.use((error, req, res, next) => {
        require('./utils/observability').logEvent('request.exception', { code: error.code || error.type || 'INTERNAL_ERROR' });
        if (res.headersSent)
            return next(error);
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
        if (error.status && error.payload) return res.status(error.status).json(error.payload);
        res.status(500).json({ error: "Internal server error." });
    });
    return app;
}
module.exports = { createApp };
