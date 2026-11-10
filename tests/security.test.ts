import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { digest, hashPassword, seal, token, unseal } from "../server/crypto.js";
import { totp } from "../server/auth.js";
import { ProtocolParser, instruction } from "../server/protocol.js";
import { targetPolicy } from "../server/network.js";

const origin = "http://localhost:3000",
  key = "a".repeat(64),
  password = "a long private passphrase 2026";
let passwordHash: string;
before(async () => {
  passwordHash = await hashPassword(password);
});
async function fixture(options: Record<string, any> = {}) {
  const db = await testDatabase(),
    folder = await mkdtemp(path.join(os.tmpdir(), "vmportal-test-"));
  const config = readConfig({
    NODE_ENV: "test",
    ENCRYPTION_KEY: key,
    APP_ORIGIN: origin,
    RECORDING_DIR: folder,
    ...options,
  });
  const { app, gateway, errorHandler } = createApp(db, config);
  app.use(errorHandler);
  const admin = await addUser("admin"),
    operator = await addUser("operator"),
    auditor = await addUser("auditor");
  async function addUser(role: string) {
    const id = randomUUID(),
      raw = token(),
      csrf = token(),
      secret = "JBSWY3DPEHPK3PXP";
    await db.execute(
      "INSERT INTO users (id,username,display_name,password_hash,role,mfa_secret,mfa_enabled,must_change_password,created_at) VALUES (?,?,?,?,?,?,1,0,?)",
      [
        id,
        role,
        role,
        passwordHash,
        role,
        seal(secret, key, `mfa:${id}`),
        Date.now(),
      ],
    );
    await db.execute(
      "INSERT INTO web_sessions (id,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)",
      [digest(raw), id, csrf, Date.now() + 3600000, Date.now()],
    );
    return { id, raw, csrf, secret, cookie: `vmportal=${raw}` };
  }
  const assetId = randomUUID();
  await db.execute(
    "INSERT INTO assets (id,name,host,port,protocol,os,group_name,description,username,secret,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      assetId,
      "WIN-TEST",
      "10.1.2.3",
      3389,
      "rdp",
      "windows",
      "Tests",
      "Test VM",
      "Administrator",
      seal("TARGET-SECRET-NEVER-TO-BROWSER", key, `asset:${assetId}`),
      Date.now(),
    ],
  );
  const call = (who = admin) => ({
    get: (url: string) =>
      request(app).get(`/api${url}`).set("Cookie", who.cookie),
    post: (url: string, body: any = {}) =>
      request(app)
        .post(`/api${url}`)
        .set("Cookie", who.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", who.csrf)
        .send(body),
  });
  const grant = async (expiresAt: number | null = null) => {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO grants (id,user_id,asset_id,expires_at,created_at) VALUES (?,?,?,?,?)",
      [id, operator.id, assetId, expiresAt, Date.now()],
    );
    return id;
  };
  return {
    db,
    folder,
    config,
    app,
    gateway,
    admin,
    operator,
    auditor,
    assetId,
    call,
    grant,
    async close() {
      await gateway.shutdown();
      await db.close();
      await rm(folder, { recursive: true, force: true });
    },
  };
}

test("admin recovery requires reauthentication, clears sessions and hides secrets from audit", async () => {
  const f = await fixture();
  try {
    const body = {
      adminPassword: "wrong password",
      newPassword: "a long temporary password",
      resetMfa: true,
      reason: "Identity verified by administrator",
    };
    await f
      .call(f.operator)
      .post(`/users/${f.auditor.id}/reset-auth`, body)
      .expect(403);
    await f.call().post(`/users/${f.operator.id}/reset-auth`, body).expect(403);
    await f
      .call()
      .post(`/users/${f.operator.id}/reset-auth`, {
        ...body,
        adminPassword: password,
      })
      .expect(200);
    await f.call(f.operator).get("/assets").expect(401);
    const [user] = await f.db.query(
      "SELECT mfa_enabled,mfa_secret,must_change_password FROM users WHERE id=?",
      [f.operator.id],
    );
    assert.equal(user.mfa_enabled, 0);
    assert.equal(user.mfa_secret, null);
    assert.equal(user.must_change_password, 1);
    const [event] = await f.db.query(
      "SELECT details FROM audit_events WHERE action=?",
      ["user.auth_reset"],
    );
    assert.ok(!event.details.includes(password));
    assert.ok(!event.details.includes(body.newPassword));
  } finally {
    await f.close();
  }
});

test("account lockout persists across login attempts", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++)
      await request(f.app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ username: "operator", password: "incorrect" })
        .expect(401);
    await request(f.app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: "operator", password })
      .expect(429);
    const [row] = await f.db.query(
      "SELECT blocked_until FROM auth_throttle WHERE id=?",
      [digest("operator")],
    );
    assert.ok(Number(row.blocked_until) > Date.now());
  } finally {
    await f.close();
  }
});

test("production issues a Secure __Host session cookie only after MFA", async () => {
  const secureOrigin = "https://remote.example.internal";
  const f = await fixture({ NODE_ENV: "production", APP_ORIGIN: secureOrigin });
  try {
    const login = await request(f.app)
      .post("/api/auth/login")
      .set("Origin", secureOrigin)
      .send({ username: "admin", password })
      .expect(200);
    const verified = await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", secureOrigin)
      .send({
        challenge: login.body.challenge,
        code: totp(f.admin.secret, "admin").generate(),
      })
      .expect(200);
    const cookie = verified.headers["set-cookie"][0];
    assert.ok(cookie.startsWith("__Host-vmportal="));
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.ok(!cookie.includes("Domain="));
  } finally {
    await f.close();
  }
});

test("AES-GCM authenticates both ciphertext and per-asset context", () => {
  const cipher = seal("secret", key, "asset:1");
  assert.equal(unseal(cipher, key, "asset:1"), "secret");
  assert.throws(() => unseal(cipher, key, "asset:2"));
  assert.throws(() => unseal(cipher, "b".repeat(64), "asset:1"));
});
test("protocol decoder handles fragmented UTF-8 content, delimiters and astral characters", () => {
  const values: string[][] = [];
  const parser = new ProtocolParser((v) => values.push(v));
  const text = instruction("name", "Máy 🖥;,.") + instruction("sync", "123");
  for (const char of text) parser.push(char);
  assert.deepEqual(values, [
    ["name", "Máy 🖥;,."],
    ["sync", "123"],
  ]);
  assert.throws(() => new ProtocolParser(() => {}).push("99999999.x"));
});
test("network policy rejects DNS, metadata, loopback and unapproved networks", () => {
  const check = targetPolicy("10.0.0.0/8,192.168.0.0/16");
  check("10.1.2.3");
  for (const host of [
    "localhost",
    "127.0.0.1",
    "169.254.169.254",
    "8.8.8.8",
    "10.0.0.1.attacker.example",
  ])
    assert.throws(() => check(host));
});
test("anonymous requests and CSRF/origin violations are rejected", async () => {
  const f = await fixture();
  try {
    await request(f.app).get("/api/assets").expect(401);
    await request(f.app)
      .post("/api/sessions")
      .set("Cookie", f.admin.cookie)
      .set("Origin", origin)
      .send({ assetId: f.assetId })
      .expect(403);
    await request(f.app)
      .post("/api/sessions")
      .set("Cookie", f.admin.cookie)
      .set("Origin", "https://evil.example")
      .set("X-CSRF-Token", f.admin.csrf)
      .send({ assetId: f.assetId })
      .expect(403);
    await f.db.execute("UPDATE web_sessions SET expires_at=0 WHERE user_id=?", [
      f.admin.id,
    ]);
    await f.call().get("/assets").expect(401);
  } finally {
    await f.close();
  }
});
test("MFA login requires second factor; rejects replay; uses secure cookie in production", async () => {
  const f = await fixture();
  try {
    const primary = await request(f.app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: "admin", password })
      .expect(200);
    assert.equal(primary.headers["set-cookie"], undefined);
    await request(f.app)
      .post("/api/auth/mfa/setup")
      .set("Origin", origin)
      .send({ challenge: primary.body.challenge })
      .expect(409);
    const result = await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: primary.body.challenge,
        code: totp(f.admin.secret, "admin").generate(),
      })
      .expect(200);
    assert.ok(result.headers["set-cookie"][0].includes("HttpOnly"));
    assert.ok(result.headers["set-cookie"][0].includes("SameSite=Strict"));
    assert.equal(result.body.user.password_hash, undefined);
    assert.equal(result.body.user.mfa_secret, undefined);
    await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: primary.body.challenge,
        code: totp(f.admin.secret, "admin").generate(),
      })
      .expect(401);
    const second = await request(f.app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ username: "admin", password })
      .expect(200);
    await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: second.body.challenge,
        code: totp(f.admin.secret, "admin").generate(),
      })
      .expect(401);
  } finally {
    await f.close();
  }
});
for (const enrollment of [false, true]) {
  test(`MFA ${enrollment ? "enrollment" : "login"} rejects adjacent-step and incorrect OTPs without creating a session`, async (t) => {
    const timestamp = Date.UTC(2026, 10, 10, 12, 0, 15);
    t.mock.method(Date, "now", () => timestamp);
    const f = await fixture();
    try {
      await f.db.execute("DELETE FROM web_sessions");
      if (enrollment)
        await f.db.execute(
          "UPDATE users SET mfa_enabled=0,mfa_secret=NULL,mfa_pending=? WHERE id=?",
          [seal(f.admin.secret, key, `mfa:${f.admin.id}`), f.admin.id],
        );
      const primary = await request(f.app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ username: "admin", password })
        .expect(200);
      assert.equal(primary.headers["set-cookie"], undefined);
      let secret = f.admin.secret;
      if (enrollment) {
        const setup = await request(f.app)
          .post("/api/auth/mfa/setup")
          .set("Origin", origin)
          .send({ challenge: primary.body.challenge })
          .expect(200);
        secret = setup.body.secret;
      }
      const otp = totp(secret, "admin");
      const current = otp.generate({ timestamp });
      const adjacent = [-30000, 30000].map((offset) =>
        otp.generate({ timestamp: timestamp + offset }),
      );
      let incorrect = "000000";
      while ([current, ...adjacent].includes(incorrect))
        incorrect = String(Number(incorrect) + 1).padStart(6, "0");
      for (const code of [...new Set(adjacent), incorrect]) {
        assert.notEqual(code, current);
        const rejected = await request(f.app)
          .post("/api/auth/mfa/verify")
          .set("Origin", origin)
          .send({ challenge: primary.body.challenge, code })
          .expect(401);
        assert.equal(rejected.headers["set-cookie"], undefined);
        assert.equal(rejected.body.user, undefined);
        assert.equal(
          (await f.db.query("SELECT id FROM web_sessions")).length,
          0,
        );
      }
      const accepted = await request(f.app)
        .post("/api/auth/mfa/verify")
        .set("Origin", origin)
        .send({ challenge: primary.body.challenge, code: current })
        .expect(200);
      const cookie = accepted.headers["set-cookie"][0].split(";")[0];
      assert.equal(accepted.body.recoveryCodes.length, enrollment ? 8 : 0);
      const me = await request(f.app)
        .get("/api/auth/me")
        .set("Cookie", cookie)
        .expect(200);
      assert.equal(me.body.user.id, f.admin.id);
      assert.equal((await f.db.query("SELECT id FROM web_sessions")).length, 1);
    } finally {
      await f.close();
    }
  });
}

test("first login enrolls MFA and returns single-use recovery codes", async () => {
  const f = await fixture();
  try {
    await f.db.execute(
      "UPDATE users SET mfa_enabled=0,mfa_secret=NULL WHERE id=?",
      [f.operator.id],
    );
    const login = () =>
      request(f.app)
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ username: "operator", password });
    const primary = await login().expect(200);
    assert.equal(primary.body.needsEnrollment, true);
    const setup = await request(f.app)
      .post("/api/auth/mfa/setup")
      .set("Origin", origin)
      .send({ challenge: primary.body.challenge })
      .expect(200);
    assert.match(setup.body.qrCode, /^data:image\/png/);
    const verify = await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: primary.body.challenge,
        code: totp(setup.body.secret, "operator").generate(),
      })
      .expect(200);
    assert.equal(verify.body.recoveryCodes.length, 8);
    const again = await login().expect(200);
    await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: again.body.challenge,
        code: verify.body.recoveryCodes[0],
      })
      .expect(200);
    const third = await login().expect(200);
    await request(f.app)
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({
        challenge: third.body.challenge,
        code: verify.body.recoveryCodes[0],
      })
      .expect(401);
  } finally {
    await f.close();
  }
});
test("operators see only granted assets; expired grants and auditors cannot open tunnels", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call(f.operator).get("/assets")).body.total, 0);
    await f
      .call(f.operator)
      .post("/sessions", { assetId: f.assetId })
      .expect(403);
    await f.grant(Date.now() - 1000);
    await f
      .call(f.operator)
      .post("/sessions", { assetId: f.assetId })
      .expect(403);
    await f.db.execute("UPDATE grants SET expires_at=NULL WHERE user_id=?", [
      f.operator.id,
    ]);
    const allowed = await f.call(f.operator).get("/assets").expect(200);
    assert.equal(allowed.body.total, 1);
    assert.equal(allowed.body.items[0].secret, undefined);
    assert.equal(allowed.body.items[0].username, undefined);
    await f
      .call(f.operator)
      .post("/sessions", { assetId: f.assetId })
      .expect(201);
    await f
      .call(f.auditor)
      .post("/sessions", { assetId: f.assetId })
      .expect(403);
    await f.call(f.operator).get("/audit").expect(403);
    await f.call(f.auditor).get("/audit").expect(200);
    await f.call(f.operator).post("/users", {}).expect(403);
  } finally {
    await f.close();
  }
});
test("asset APIs never return target secrets and bulk import rolls back invalid batches", async () => {
  const f = await fixture();
  try {
    const response = await f.call().get("/assets").expect(200);
    assert.ok(!JSON.stringify(response.body).includes("TARGET-SECRET"));
    assert.equal(response.body.items[0].secret, undefined);
    const item = {
      name: "IMPORT",
      host: "10.2.3.4",
      port: 3389,
      protocol: "rdp",
      os: "windows",
      groupName: "Test",
      username: "admin",
      password: "IMPORT-SECRET",
    };
    await f
      .call()
      .post("/assets/import", [item, { ...item, host: "8.8.8.8" }])
      .expect(400);
    assert.equal((await f.call().get("/assets")).body.total, 1);
    await f.call().post("/assets/import", [item]).expect(201);
    const [record] = await f.db.query(
      "SELECT id,secret FROM assets WHERE name=?",
      ["IMPORT"],
    );
    assert.ok(!record.secret.includes("IMPORT-SECRET"));
    assert.equal(
      unseal(record.secret, key, `asset:${record.id}`),
      "IMPORT-SECRET",
    );
    await f
      .call()
      .post("/assets", { ...item, protocol: "ssh", os: "linux", hostKey: "" })
      .expect(400);
  } finally {
    await f.close();
  }
});
test("simultaneous ticket reservations respect the global limit and grant revocation invalidates tickets", async () => {
  const f = await fixture({ MAX_REMOTE_SESSIONS: "1" });
  try {
    const grantId = await f.grant();
    const results = await Promise.all([
      f.call(f.operator).post("/sessions", { assetId: f.assetId }),
      f.call(f.operator).post("/sessions", { assetId: f.assetId }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 429]);
    await request(f.app)
      .delete(`/api/grants/${grantId}`)
      .set("Cookie", f.admin.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.admin.csrf)
      .expect(200);
    const [row] = await f.db.query(
      "SELECT status,ticket_hash FROM remote_sessions",
    );
    assert.equal(row.status, "terminated");
    assert.equal(row.ticket_hash, null);
  } finally {
    await f.close();
  }
});
test("forced password changes block access, invalidate other logins and protect self-admin", async () => {
  const f = await fixture();
  try {
    await f.db.execute("UPDATE users SET must_change_password=1 WHERE id=?", [
      f.admin.id,
    ]);
    await f.call().get("/assets").expect(403);
    await f
      .call()
      .post("/auth/password", {
        currentPassword: password,
        newPassword: "a different long private passphrase",
      })
      .expect(200);
    await f.call().get("/assets").expect(200);
    await request(f.app)
      .patch(`/api/users/${f.admin.id}`)
      .set("Cookie", f.admin.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.admin.csrf)
      .send({ role: "operator", active: true, displayName: "Admin" })
      .expect(400);
  } finally {
    await f.close();
  }
});
test("full WebSocket bridge injects credentials only into guacd, rejects ticket reuse, records and terminates", async () => {
  let receivedPassword = "";
  const inputs: string[][] = [];
  const fake = net.createServer((socket) => {
    socket.setEncoding("utf8");
    const parser = new ProtocolParser((values) => {
      inputs.push(values);
      if (values[0] === "select")
        socket.write(
          instruction(
            "args",
            "VERSION_1_5_0",
            "hostname",
            "port",
            "username",
            "password",
            "disable-copy",
          ),
        );
      if (values[0] === "connect") {
        assert.equal(values[1], "VERSION_1_1_0");
        receivedPassword = values[5];
        socket.write(
          instruction("ready", "$mock") +
            instruction("size", "0", "800", "600") +
            instruction("sync", String(Date.now())),
        );
      }
    });
    socket.on("data", (v) => parser.push(String(v)));
    socket.on("error", () => {});
  });
  fake.listen(0, "127.0.0.1");
  await once(fake, "listening");
  const f = await fixture({
    GUACD_PORT: String((fake.address() as net.AddressInfo).port),
  });
  const server = createServer(f.app);
  f.gateway.attach(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}/api/tunnel`;
  let ws: WebSocket | undefined;
  try {
    const ticket = await f
      .call()
      .post("/sessions", { assetId: f.assetId })
      .expect(201);
    ws = new WebSocket(`${base}?ticket=${ticket.body.ticket}`, "guacamole", {
      origin,
      headers: { Cookie: f.admin.cookie },
    });
    const messages: string[] = [];
    const synced = new Promise<void>((resolve, reject) => {
      ws!.on("message", (data) => {
        messages.push(data.toString());
        if (data.toString().includes("sync")) resolve();
      });
      ws!.on("error", reject);
    });
    await synced;
    assert.equal(receivedPassword, "TARGET-SECRET-NEVER-TO-BROWSER");
    assert.ok(!messages.join("").includes("TARGET-SECRET"));
    ws.send(instruction("", "ping", "123"));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(messages.includes(instruction("", "ping", "123")));
    ws.send(instruction("key", "65", "1"));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(inputs.some((v) => v[0] === "key"));
    const reuse = new WebSocket(
      `${base}?ticket=${ticket.body.ticket}`,
      "guacamole",
      { origin, headers: { Cookie: f.admin.cookie } },
    );
    await new Promise<void>((resolve) => {
      reuse.on("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 403);
        res.resume();
        reuse.terminate();
        resolve();
      });
      reuse.on("error", () => {});
    });
    const ended = once(ws, "close");
    await f
      .call()
      .post(`/sessions/${ticket.body.sessionId}/terminate`)
      .expect(200);
    await ended;
    const [session] = await f.db.query(
      "SELECT * FROM remote_sessions WHERE id=?",
      [ticket.body.sessionId],
    );
    assert.equal(session.status, "terminated");
    assert.equal(session.recording_available, 1);
    const recorded = await readFile(
      path.join(f.folder, `${ticket.body.sessionId}.guac`),
      "utf8",
    );
    assert.ok(recorded.includes("sync"));
    assert.ok(!recorded.includes("TARGET-SECRET"));
    await f
      .call()
      .get(`/sessions/${ticket.body.sessionId}/recording`)
      .expect(200);
    await f
      .call(f.operator)
      .get(`/sessions/${ticket.body.sessionId}/recording`)
      .expect(403);
  } finally {
    ws?.terminate();
    await f.close();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => fake.close(() => r()));
  }
});
