const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopSetup", {
  settings: () => ipcRenderer.invoke("desktop:settings"),
  connect: (origin) => ipcRenderer.invoke("desktop:connect", origin),
});
