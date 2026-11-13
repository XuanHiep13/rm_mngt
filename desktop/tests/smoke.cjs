const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require(path.resolve(__dirname, "../../node_modules/playwright"));

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vm-access-desktop-smoke-"));
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<html><body><h1>Desktop smoke backend</h1></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const env = { ...process.env };
  delete env.VM_ACCESS_SERVER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({
    executablePath: require("electron"),
    args: ["-r", path.resolve(__dirname, "../../node_modules/playwright-core/lib/server/electron/loader.js"), path.resolve(__dirname, ".."), "--user-data-dir=" + profile],
    env, timeout: 30000,
  });
  let desktop;
  try {
    desktop = await launch();
    const settings = await desktop.firstWindow();
    await settings.getByLabel("Địa chỉ máy chủ").fill(origin);
    const opened = desktop.waitForEvent("window");
    await settings.getByRole("button", { name: "Kết nối", exact: true }).click();
    const remote = await opened;
    await remote.getByRole("heading", { name: "Desktop smoke backend" }).waitFor();
    assert.deepEqual(await remote.evaluate(() => ({
      require: typeof window.require, setup: typeof window.desktopSetup,
    })), { require: "undefined", setup: "undefined" });
    const prefs = await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().startsWith("http:")).webContents.getLastWebPreferences());
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    await desktop.close();
    desktop = await launch();
    const reopened = await desktop.firstWindow();
    await reopened.getByRole("heading", { name: "Desktop smoke backend" }).waitFor();
    assert.equal(new URL(reopened.url()).origin, origin);
    console.log("PASS: settings -> server; isolated renderer; saved server reused after restart.");
  } finally {
    if (desktop) await desktop.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("vm-access-desktop-smoke-"))
      throw new Error("Refusing unexpected cleanup path");
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
