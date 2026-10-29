require("./config/loadEnv");
const { createApp } = require("./app");
const PORT = process.env.PORT || 3000;
const app = createApp();
if (require.main === module) {
    app.listen(PORT, '127.0.0.1', (error) => {
        if (error) {
            if (error.code === "EADDRINUSE") {
                console.error(`Port ${PORT} is already in use. Stop the existing server before starting another instance.`);
            } else {
                console.error(`Could not start the server: ${error.message}`);
            }
            process.exitCode = 1;
            return;
        }
        console.log(`Investment Tracker is running at http://localhost:${PORT}`);
    });
}
module.exports = app;
