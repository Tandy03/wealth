const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:net");
const { spawn } = require("node:child_process");
const path = require("node:path");

test("server reports an occupied port and exits without claiming to have started", { timeout: 15000 }, async (t) => {
    const listener = createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve) => listener.close(resolve)));
    const port = listener.address().port;
    const child = spawn(process.execPath, [path.resolve(__dirname, "../server.js")], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
    });
    assert.equal(code, 1);
    assert.match(stderr, new RegExp(`Port ${port} is already in use`));
    assert.doesNotMatch(stdout, /Investment Tracker is running/);
});
