/** Local RDP/SSH smoke test. No MySQL or interactive website authentication. */
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { remoteTestTargetSchema } from "./remote-test-config.js";
import { createServer as createViteServer } from "vite";
import { testDatabase } from "../tests/database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { cookieName } from "../server/auth.js";
import { token, digest, seal } from "../server/crypto.js";
import { targetPolicy } from "../server/network.js";
import { z } from "zod";
import { Gateway } from "../server/gateway.js";
import { SshTrust } from "../server/ssh-trust.js";

// config.ts loads .env; this command must never run with production settings.
if (process.env.NODE_ENV === "production")
  throw new Error("remote:test is local only. Unset NODE_ENV=production in your shell/.env.");

const file = path.resolve(".local/remote-test.json");
const raw = await readFile(file, "utf8").catch(() => {
  throw new Error("Create .local/remote-test.json from remote-test.example.json and fill in the remote target.");
});
const target = remoteTestTargetSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, "")));
if (target.password === "CHANGE_ME")
  throw new Error("Fill in the actual remote password in .local/remote-test.json.");

const knownHostsPath = path.resolve(".local/ssh-known-hosts.json");
let knownHosts: Record<string, string> = {};
try {
  knownHosts = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(knownHostsPath, "utf8")));
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
const endpoint = `${target.host}:${target.port}`;
const savedHostKey = target.hostKey || knownHosts[endpoint] || null;

const origin = "http://localhost:3000";
const config = readConfig({
  NODE_ENV: "development",
  APP_ORIGIN: origin,
  ENCRYPTION_KEY: token(),
  GUACD_HOST: target.guacdHost,
  GUACD_PORT: String(target.guacdPort),
  ALLOWED_TARGET_CIDRS: `${target.host}/32`,
  MAX_REMOTE_SESSIONS: "1",
  TRUST_PROXY_HOPS: "0",
});
targetPolicy(config.ALLOWED_TARGET_CIDRS)(target.host);
const recordingDir = await mkdtemp(path.join(os.tmpdir(), "vmportal-remote-test-"));
config.RECORDING_DIR = recordingDir;
const db = await testDatabase();
const userId = randomUUID(), assetId = randomUUID();
const rawSession = token(), sessionId = digest(rawSession), csrf = token();
await db.execute(
  "INSERT INTO users (id,username,display_name,password_hash,role,mfa_enabled,must_change_password,created_at) VALUES (?,?,?,?,?,1,0,?)",
  [userId, "local-remote-test", "Local remote test", "disabled", "admin", Date.now()],
);
await db.execute(
  "INSERT INTO web_sessions (id,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)",
  [sessionId, userId, csrf, Date.now() + 8 * 3600000, Date.now()],
);
await db.execute(
  "INSERT INTO assets (id,name,host,port,protocol,os,group_name,description,username,domain_name,secret,host_key,ignore_cert,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  [assetId, `${target.protocol.toUpperCase()} local test`, target.host, target.port, target.protocol, target.os, "Local test", "",
    target.username, target.domain, seal(target.password, config.ENCRYPTION_KEY, `asset:${assetId}`),
    savedHostKey, target.ignoreCert ? 1 : 0, Date.now()],
);
target.password = "";

const sshTrust = new SshTrust(db, undefined, async (asset, key) => {
  const updated = { ...knownHosts, [`${asset.host}:${asset.port}`]: key };
  const temporary = knownHostsPath + "." + token() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, knownHostsPath);
    knownHosts = updated;
  } finally {
    await rm(temporary, { force: true });
  }
});
const { app, gateway, errorHandler } = createApp(db, config, new Gateway(db, config, sshTrust));
const hostApp = express();
hostApp.use((req, res, next) => {
  if (req.headers.host !== "localhost:3000") {
    res.status(403).send("Open http://localhost:3000");
    return;
  }
  next();
});
hostApp.use(app);
const server = createServer(hostApp);
gateway.attach(server);
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { server } },
  appType: "mpa",
});
app.post("/local-remote-test/bootstrap", (req, res) => {
  if (req.headers.origin !== origin || req.headers["x-local-remote-test"] !== "1") {
    res.sendStatus(403);
    return;
  }
  res.set("Cache-Control", "no-store");
  res.cookie(cookieName(config), rawSession, {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: 8 * 3600000,
  });
  res.json({
    csrfToken: csrf,
    asset: {
      id: assetId, name: `${target.protocol.toUpperCase()} local test`, host: target.host, port: target.port,
      protocol: target.protocol, os: target.os, groupName: "Local test", description: "", enabled: true,
    },
  });
});
app.get("/", async (_req, res) => {
  const html = await vite.transformIndexHtml("/", `<!doctype html>
<html lang="vi"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Local remote test</title></head><body><div id="root"></div>
<script type="module" src="/remote-test.tsx"></script></body></html>`);
  res.set("Cache-Control", "no-store").type("html").send(html);
});
app.use(vite.middlewares);
app.use(errorHandler);
server.on("error", (error) => {
  console.error(error.message);
  void stop(1);
});
server.listen(3000, "127.0.0.1", () => {
  console.log(`LOCAL REMOTE TEST: ${origin}
Target: ${target.protocol.toUpperCase()} ${target.host}:${target.port}
guacd: ${target.guacdHost}:${target.guacdPort}
No MySQL or MFA. Session data and recordings are temporary.
Accepted SSH host keys persist in .local/ssh-known-hosts.json.
Close the remote view before reconnecting. Ctrl+C stops the test.`);
});
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await gateway.shutdown();
  await vite.close();
  server.close();
  await db.close();
  await rm(recordingDir, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
