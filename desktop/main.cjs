const { app, BrowserWindow, Menu, ipcMain, session, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { serverOrigin, sameOrigin } = require("./policy.cjs");

let remoteWindow, setupWindow, origin = "", initialError = "";
const setupFile = path.join(__dirname, "setup.html");
const setupURL = pathToFileURL(setupFile).href;
const configFile = () => path.join(app.getPath("userData"), "server.json");
app.setName("VM Access");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = setupWindow || remoteWindow;
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox("VM Access", error.message);
    app.quit();
  });
}
function guard(win, allowed) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-attach-webview", (event) => event.preventDefault());
  for (const name of ["will-navigate", "will-redirect"])
    wc.on(name, (event, url) => { if (!allowed(url)) event.preventDefault(); });
}
function showSetup(error = "") {
  initialError = error;
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }
  setupWindow = new BrowserWindow({
    width: 620, height: 480, minWidth: 480, minHeight: 420,
    title: "VM Access · Máy chủ", backgroundColor: "#f5f7f9",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  guard(setupWindow, (url) => url === setupURL);
  setupWindow.on("closed", () => { setupWindow = undefined; });
  void setupWindow.loadFile(setupFile);
}
function openRemote(value) {
  origin = serverOrigin(value);
  if (remoteWindow && !remoteWindow.isDestroyed()) remoteWindow.destroy();
  const remoteSession = session.fromPartition("persist:vm-access");
  remoteSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(wc === remoteWindow?.webContents && permission === "fullscreen" && sameOrigin(details.requestingUrl, origin));
  });
  remoteSession.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
    wc === remoteWindow?.webContents && permission === "fullscreen" && sameOrigin(requestingOrigin, origin));
  remoteWindow = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 640,
    title: "VM Access", backgroundColor: "#102b34",
    webPreferences: { partition: "persist:vm-access", nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
  });
  guard(remoteWindow, (url) => sameOrigin(url, origin));
  remoteWindow.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3) showSetup("Không tải được máy chủ: " + description + ". Kiểm tra địa chỉ, VPN và chứng thư HTTPS.");
  });
  remoteWindow.on("closed", () => { remoteWindow = undefined; });
  void remoteWindow.loadURL(origin).catch(() => {});
}
function setupOnly(event) {
  if (!setupWindow || event.sender !== setupWindow.webContents || event.senderFrame !== setupWindow.webContents.mainFrame ||
      event.sender.getURL() !== setupURL) throw new Error("Invalid settings sender");
}
async function start() {
  ipcMain.handle("desktop:settings", (event) => {
    setupOnly(event);
    return { origin, error: initialError };
  });
  ipcMain.handle("desktop:connect", async (event, input) => {
    setupOnly(event);
    try {
      const next = serverOrigin(input);
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      await fs.writeFile(configFile(), JSON.stringify({ origin: next }, null, 2), { mode: 0o600 });
      openRemote(next);
      setupWindow?.close();
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  const template = [];
  if (process.platform === "darwin") template.push({ role: "appMenu" });
  template.push(
    { label: "Máy chủ", submenu: [
      { label: "Địa chỉ máy chủ…", click: () => showSetup() },
      { type: "separator" }, { role: "quit", label: "Thoát" },
    ] },
    { label: "Chỉnh sửa", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Hiển thị", submenu: [{ role: "reload", label: "Tải lại" }, { role: "togglefullscreen", label: "Toàn màn hình" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  try {
    const value = process.env.VM_ACCESS_SERVER_URL || JSON.parse(await fs.readFile(configFile(), "utf8")).origin;
    openRemote(value);
  } catch (error) {
    showSetup(error.code === "ENOENT" ? "" : error.message);
  }
}
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (origin) openRemote(origin); else showSetup();
  }
});
