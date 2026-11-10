/** Isolated UI review: in-memory DB, fake VM addresses, real authentication. Never run as production. */
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as viteServer } from "vite";
import * as OTPAuth from "otpauth";
import { testDatabase } from "../tests/database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword, seal } from "../server/crypto.js";

if (process.env.NODE_ENV === "production")
  throw new Error("Preview cannot run in production.");
const origin = "http://localhost:3000";
const recordingDir = await mkdtemp(path.join(os.tmpdir(), "vmportal-preview-"));
const config = readConfig({
  NODE_ENV: "development",
  APP_ORIGIN: origin,
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  RECORDING_DIR: recordingDir,
  GUACD_PORT: process.env.PREVIEW_GUACD_PORT ?? "4822",
});
const db = await testDatabase();
const adminId = randomUUID(),
  password = randomBytes(16).toString("hex");
const mfa = new OTPAuth.Secret({ size: 20 }).base32;
await db.execute(
  "INSERT INTO users (id,username,display_name,password_hash,role,mfa_secret,mfa_enabled,must_change_password,created_at) VALUES (?,?,?,?,?,?,1,0,?)",
  [
    adminId,
    "preview-admin",
    "Quản trị viên",
    await hashPassword(password),
    "admin",
    seal(mfa, config.ENCRYPTION_KEY, `mfa:${adminId}`),
    Date.now(),
  ],
);
const previewAssets = [
  ["WEB-PROD-01", "windows", "Ứng dụng web nội bộ", "Production"],
  ["DB-MYSQL-01", "linux", "Cơ sở dữ liệu tập trung", "Database"],
  ["APP-SERVICE-01", "windows", "Dịch vụ nghiệp vụ", "Production"],
  ["WEB-STAGING-01", "linux", "Môi trường kiểm thử", "Staging"],
  ["MONITOR-01", "linux", "Giám sát hạ tầng", "Management"],
  ["FILE-SERVER-01", "windows", "Dịch vụ lưu trữ nội bộ", "Production"],
];
for (const [index, a] of previewAssets.entries()) {
  const id = randomUUID();
  await db.execute(
    "INSERT INTO assets (id,name,host,port,protocol,os,group_name,description,username,secret,host_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      a[0],
      `192.0.2.${index + 10}`,
      a[1] === "linux" ? 22 : 3389,
      a[1] === "linux" ? "ssh" : "rdp",
      a[1],
      a[3],
      `${a[2]} · DỮ LIỆU XEM THỬ`,
      "preview",
      seal("unused", config.ENCRYPTION_KEY, `asset:${id}`),
      null,
      Date.now(),
    ],
  );
}
await mkdir(config.RECORDING_DIR, { recursive: true });
const { app, gateway, errorHandler } = createApp(db, config);
const server = createServer(app);
gateway.attach(server);
const vite = await viteServer({
  server: { middlewareMode: true, hmr: { server } },
  appType: "spa",
});
app.use(vite.middlewares);
app.use(errorHandler);
server.listen(3000, "127.0.0.1", () => {
  console.log(
    `LOCAL PREVIEW ONLY: ${origin}\nUsername: preview-admin\nPassword: ${password}\nMFA secret (temporary preview): ${mfa}\nAll VM addresses are documentation placeholders; remote access is blocked. Data disappears when stopped.`,
  );
});
async function stop() {
  await gateway.shutdown();
  await vite.close();
  server.close();
  await db.close();
  await rm(recordingDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
