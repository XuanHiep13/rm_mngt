import { createServer } from "node:http";
import express from "express";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { readConfig } from "./config.js";
import { mysqlDatabase } from "./db.js";
import { createApp } from "./app.js";
const config = readConfig();
const db = mysqlDatabase(config);
await db.query("SELECT id FROM gateway_guard WHERE id=1");
await mkdir(config.RECORDING_DIR, { recursive: true, mode: 0o700 });
const { app, gateway, errorHandler } = createApp(db, config);
await gateway.recover();
const server = createServer(app);
gateway.attach(server);
if (config.NODE_ENV === "development") {
  const { createServer: viteServer } = await import("vite");
  const vite = await viteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve("dist"), { index: false, maxAge: "1h" }));
  app.get("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.resolve("dist/index.html"));
  });
}
app.use(errorHandler);
server.listen(config.PORT, "0.0.0.0", () =>
  console.log(`VM Access: ${config.APP_ORIGIN}`),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await gateway.shutdown();
  server.close();
  await db.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
