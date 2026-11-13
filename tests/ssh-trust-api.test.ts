import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { Gateway } from "../server/gateway.js";
import { SshTrust } from "../server/ssh-trust.js";
import { token, digest } from "../server/crypto.js";

test("SSH trust API requires auth/CSRF/access and prevents ticket and confirmation bypasses", async () => {
  const db = await testDatabase();
  const config = readConfig({ NODE_ENV: "test", ENCRYPTION_KEY: "a".repeat(64) });
  let scans = 0;
  const service = new SshTrust(db, async () => {
    scans++; return "10.1.2.3 ecdsa-sha2-nistp256 AAAAE2ZpcnN0";
  });
  const { app, gateway, errorHandler } = createApp(db, config, new Gateway(db, config, service));
  app.use(errorHandler);
  const assetId = randomUUID(), adminId = randomUUID(), operatorId = randomUUID();
  const raw = token(), csrf = token(), operatorRaw = token();
  try {
    for (const [id, role, cookie] of [[adminId, "admin", raw], [operatorId, "operator", operatorRaw]]) {
      await db.execute("INSERT INTO users (id,username,display_name,password_hash,role,mfa_enabled,must_change_password,created_at) VALUES (?,?,?,?,?,1,0,?)",
        [id, role, role, "disabled", role, Date.now()]);
      await db.execute("INSERT INTO web_sessions (id,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)",
        [digest(cookie), id, csrf, Date.now() + 3600000, Date.now()]);
    }
    await db.execute("INSERT INTO assets (id,name,host,port,protocol,os,group_name,description,username,secret,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [assetId, "SSH", "10.1.2.3", 22, "ssh", "linux", "Test", "", "tester", "unused", Date.now()]);
    const post = (url: string, body: object, cookie = raw) => request(app).post("/api" + url)
      .set("Cookie", "vmportal=" + cookie).set("Origin", config.APP_ORIGIN).set("X-CSRF-Token", csrf).send(body);
    await request(app).post("/api/ssh/host-key").set("Origin", config.APP_ORIGIN).send({ assetId }).expect(401);
    await request(app).post("/api/ssh/host-key").set("Origin", config.APP_ORIGIN).set("Cookie", "vmportal=" + raw).send({ assetId }).expect(403);
    await post("/ssh/host-key", { assetId }, operatorRaw).expect(403);
    assert.equal(scans, 0);
    await post("/sessions", { assetId }).expect(409);
    const inspected = await post("/ssh/host-key", { assetId }).expect(200);
    assert.equal(inspected.body.trusted, false);
    await post("/ssh/host-key/confirm", { assetId, challenge: inspected.body.challenge, answer: "no" }).expect(400);
    assert.equal((await db.query<any>("SELECT host_key FROM assets WHERE id=?", [assetId]))[0].host_key, null);
    await post("/ssh/host-key/confirm", { assetId, challenge: inspected.body.challenge, answer: "yes" }).expect(200);
    assert.equal((await post("/ssh/host-key", { assetId }).expect(200)).body.trusted, true);
    await post("/sessions", { assetId }).expect(201);
    assert.equal((await db.query("SELECT id FROM audit_events WHERE action='ssh.host_key_trusted'")).length, 1);
    await post("/ssh/host-key/confirm", { assetId, challenge: inspected.body.challenge, answer: "yes" }).expect(409);
  } finally { await gateway.shutdown(); await db.close(); }
});
