require("./config/loadEnv");
const { createApp } = require("./app");
const PORT = process.env.PORT || 3000;
const app = createApp();
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Investment Tracker is running at http://localhost:${PORT}`);
    });
}
module.exports = app;
