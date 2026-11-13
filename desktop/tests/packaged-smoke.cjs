const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require(path.resolve(__dirname, "../../node_modules/playwright"));

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "vm-access-desktop-smoke-"));
  const exe = path.resolve(__dirname, "../release/win-unpacked/VM Access.exe");
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<html><body><h1>Packaged desktop backend</h1></body></html>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let child, browser;
  async function launch() {
    const portServer = net.createServer();
    await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
    const port = portServer.address().port;
    await new Promise(resolve => portServer.close(resolve));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VM_ACCESS_SERVER_URL;
    child = spawn(exe, ["--remote-debugging-port=" + port, "--user-data-dir=" + profile], {
      env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stderr.on("data", data => { logs = (logs + data).slice(-5000); });
    child.stdout.on("data", () => {});
    child.on("error", error => { logs += error.message; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("Desktop exited: " + child.exitCode + " " + logs);
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/json/version");
        const result = await response.json();
        browser = await chromium.connectOverCDP(result.webSocketDebuggerUrl);
        const context = browser.contexts()[0];
        for (let i = 0; i < 50 && context.pages().length === 0; i++)
          await new Promise(resolve => setTimeout(resolve, 100));
        return context;
      } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    throw new Error("Packaged desktop did not start: " + logs);
  }
  async function close() {
    if (browser) { await browser.close().catch(() => {}); browser = undefined; }
    if (child && child.exitCode === null) {
      const finished = new Promise(resolve => child.once("exit", resolve));
      child.kill();
      await Promise.race([finished, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
  }
  try {
    let context = await launch();
    const setup = context.pages()[0];
    await setup.getByLabel("Địa chỉ máy chủ").fill(origin);
    const opened = context.waitForEvent("page");
    await setup.getByRole("button", { name: "Kết nối", exact: true }).click();
    const remote = await opened;
    await remote.getByRole("heading", { name: "Packaged desktop backend" }).waitFor();
    assert.deepEqual(await remote.evaluate(() => ({ require: typeof window.require, setup: typeof window.desktopSetup })),
      { require: "undefined", setup: "undefined" });
    await close();
    context = await launch();
    await context.pages()[0].getByRole("heading", { name: "Packaged desktop backend" }).waitFor();
    console.log("PASS: packaged EXE opens server, isolates renderer, remembers server after restart.");
  } finally {
    await close();
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("vm-access-desktop-smoke-"))
      throw new Error("Unexpected cleanup path");
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
