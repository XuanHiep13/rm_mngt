import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import type { User } from "./types.js";
import type { Gateway } from "./gateway.js";
import {
  authenticated,
  passwordChanged,
  adminOnly,
  auditOnly,
  passwordRule,
  publicUser,
} from "./auth.js";
import { seal, hashPassword, verifyPassword } from "./crypto.js";
import { audit } from "./audit.js";
import { requireValue } from "./errors.js";
import { targetPolicy } from "./network.js";

const uuid = z.uuid();
const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  q: z.string().max(100).default(""),
});
const assetInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    host: z.ipv4(),
    port: z.coerce.number().int().min(1).max(65535),
    protocol: z.enum(["rdp", "ssh"]),
    os: z.enum(["windows", "linux"]),
    groupName: z.string().trim().min(1).max(80),
    description: z.string().max(1000).default(""),
    username: z.string().trim().min(1).max(120),
    domain: z.string().trim().max(120).default(""),
    password: z.string().min(1).max(2048).optional(),
    hostKey: z.string().trim().max(4096).default(""),
    ignoreCert: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (
      v.protocol === "ssh" &&
      !/^\S+\s+(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]+(?:\s.*)?$/.test(
        v.hostKey,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["hostKey"],
        message:
          "SSH cần dòng known_hosts đã xác minh để kiểm tra danh tính máy đích.",
      });
    if (v.protocol === "ssh" && v.os !== "linux")
      ctx.addIssue({
        code: "custom",
        path: ["os"],
        message: "Cấu hình hiện tại dùng SSH cho Linux.",
      });
  });
const assetColumns =
  "a.id,a.name,a.host,a.port,a.protocol,a.os,a.group_name,a.description,a.enabled,a.created_at";
const assetView = (a: any, admin: boolean) => ({
  id: a.id,
  name: a.name,
  host: a.host,
  port: a.port,
  protocol: a.protocol,
  os: a.os,
  groupName: a.group_name,
  description: a.description,
  enabled: !!a.enabled,
  createdAt: Number(a.created_at),
  ...(admin
    ? {
        username: a.username,
        domain: a.domain_name,
        hostKey: a.host_key ?? "",
        ignoreCert: !!a.ignore_cert,
      }
    : {}),
});

export function apiRoutes(db: Database, config: Config, gateway: Gateway) {
  const router = Router();
  const checkTarget = targetPolicy(config.ALLOWED_TARGET_CIDRS);
  router.use(authenticated, passwordChanged);
  router.get("/dashboard", async (req, res) => {
    const elevated = req.auth!.user.role !== "operator";
    const userId = req.auth!.user.id;
    const [assets] = elevated
      ? await db.query(
          "SELECT COUNT(*) AS total,SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled FROM assets",
        )
      : await db.query(
          "SELECT COUNT(*) AS total,SUM(CASE WHEN a.enabled=1 THEN 1 ELSE 0 END) AS enabled FROM assets a JOIN grants g ON g.asset_id=a.id WHERE g.user_id=? AND (g.expires_at IS NULL OR g.expires_at>?)",
          [userId, Date.now()],
        );
    const filter = elevated ? "" : " WHERE user_id=?";
    const [sessions] = await db.query(
      `SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('active','connecting') THEN 1 ELSE 0 END) AS active FROM remote_sessions${filter}`,
      elevated ? [] : [userId],
    );
    const [users] = elevated
      ? await db.query("SELECT COUNT(*) AS total FROM users WHERE active=1")
      : [{ total: 1 }];
    res.json({
      totalAssets: Number(assets.total),
      enabledAssets: Number(assets.enabled ?? 0),
      activeSessions: Number(sessions.active ?? 0),
      totalSessions: Number(sessions.total),
      activeUsers: Number(users.total),
      maxSessions: config.MAX_REMOTE_SESSIONS,
    });
  });
  router.get("/assets", async (req, res) => {
    const p = pagination
      .extend({
        os: z.enum(["all", "windows", "linux"]).default("all"),
        group: z.string().max(80).default(""),
      })
      .parse(req.query);
    const admin = req.auth!.user.role === "admin";
    const conditions = [
      "(a.name LIKE ? OR a.host LIKE ? OR a.group_name LIKE ?)",
    ];
    const args: any[] = [`%${p.q}%`, `%${p.q}%`, `%${p.q}%`];
    if (req.auth!.user.role === "operator") {
      conditions.push(
        "a.enabled=1 AND EXISTS (SELECT 1 FROM grants g WHERE g.asset_id=a.id AND g.user_id=? AND (g.expires_at IS NULL OR g.expires_at>?))",
      );
      args.push(req.auth!.user.id, Date.now());
    }
    if (p.os !== "all") {
      conditions.push("a.os=?");
      args.push(p.os);
    }
    if (p.group) {
      conditions.push("a.group_name=?");
      args.push(p.group);
    }
    const where = conditions.join(" AND ");
    const [count] = await db.query(
      `SELECT COUNT(*) AS total FROM assets a WHERE ${where}`,
      args,
    );
    const rows = await db.query(
      `SELECT ${assetColumns}${admin ? ",a.username,a.domain_name,a.host_key,a.ignore_cert" : ""} FROM assets a WHERE ${where} ORDER BY a.name LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`,
      args,
    );
    res.json({
      items: rows.map((a) => assetView(a, admin)),
      total: Number(count.total),
      page: p.page,
      limit: p.limit,
    });
  });
  const saveAsset = async (
    tx: Database,
    input: z.infer<typeof assetInput>,
    id: string,
    existing?: any,
  ) => {
    checkTarget(input.host);
    requireValue(
      existing || input.password,
      400,
      "Vui lòng nhập mật khẩu máy đích.",
    );
    const secret = input.password
      ? seal(input.password, config.ENCRYPTION_KEY, `asset:${id}`)
      : existing.secret;
    const values = [
      input.name,
      input.host,
      input.port,
      input.protocol,
      input.os,
      input.groupName,
      input.description,
      input.enabled ? 1 : 0,
      input.username,
      input.domain,
      secret,
      input.hostKey || null,
      input.ignoreCert ? 1 : 0,
    ];
    if (existing)
      await tx.execute(
        "UPDATE assets SET name=?,host=?,port=?,protocol=?,os=?,group_name=?,description=?,enabled=?,username=?,domain_name=?,secret=?,host_key=?,ignore_cert=? WHERE id=?",
        [...values, id],
      );
    else
      await tx.execute(
        "INSERT INTO assets (name,host,port,protocol,os,group_name,description,enabled,username,domain_name,secret,host_key,ignore_cert,id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [...values, id, Date.now()],
      );
  };
  router.post("/assets", adminOnly, async (req, res) => {
    const input = assetInput.parse(req.body),
      id = randomUUID();
    await db.transaction(async (tx) => {
      await saveAsset(tx, input, id);
      await audit(tx, req, "asset.created", id, { name: input.name });
    });
    res.status(201).json({ id });
  });
  router.post("/assets/import", adminOnly, async (req, res) => {
    const inputs = z.array(assetInput).min(1).max(500).parse(req.body);
    const ids: string[] = [];
    await db.transaction(async (tx) => {
      for (const input of inputs) {
        const id = randomUUID();
        await saveAsset(tx, input, id);
        ids.push(id);
      }
      await audit(tx, req, "asset.imported", null, { count: ids.length });
    });
    res.status(201).json({ imported: ids.length });
  });
  router.put("/assets/:id", adminOnly, async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = assetInput.parse(req.body);
    const [existing] = await db.query("SELECT * FROM assets WHERE id=?", [id]);
    requireValue(existing, 404, "Máy không tồn tại.");
    await db.transaction(async (tx) => {
      await saveAsset(tx, input, id, existing);
      await audit(tx, req, "asset.updated", id, {
        name: input.name,
        credentialChanged: !!input.password,
        enabled: input.enabled,
      });
    });
    await gateway.closeAsset(id);
    res.json({ ok: true });
  });
  router.get("/users", adminOnly, async (_req, res) => {
    res.json({
      items: (
        await db.query<User>("SELECT * FROM users ORDER BY created_at DESC")
      ).map(publicUser),
    });
  });
  router.post("/users", adminOnly, async (req, res) => {
    const input = z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
        displayName: z.string().trim().min(1).max(120),
        password: passwordRule,
        role: z.enum(["admin", "operator", "auditor"]),
      })
      .parse(req.body);
    const id = randomUUID(),
      hash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.execute(
        "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
        [id, input.username, input.displayName, hash, input.role, Date.now()],
      );
      await audit(tx, req, "user.created", id, {
        username: input.username,
        role: input.role,
      });
    });
    res.status(201).json({ id });
  });
  router.patch("/users/:id", adminOnly, async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = z
        .object({
          active: z.boolean(),
          role: z.enum(["admin", "operator", "auditor"]),
          displayName: z.string().trim().min(1).max(120),
        })
        .parse(req.body);
    requireValue(
      id !== req.auth!.user.id || (input.active && input.role === "admin"),
      400,
      "Không thể tự khóa hoặc hạ quyền quản trị của mình.",
    );
    await db.transaction(async (tx) => {
      requireValue(
        (await tx.execute(
          "UPDATE users SET active=?,role=?,display_name=? WHERE id=?",
          [input.active ? 1 : 0, input.role, input.displayName, id],
        )) === 1,
        404,
        "Tài khoản không tồn tại.",
      );
      await tx.execute("DELETE FROM web_sessions WHERE user_id=?", [id]);
      await tx.execute("DELETE FROM login_challenges WHERE user_id=?", [id]);
      await audit(tx, req, "user.updated", id, input);
    });
    await gateway.closeUser(id);
    res.json({ ok: true });
  });
  router.post("/users/:id/reset-auth", adminOnly, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = z
      .object({
        adminPassword: z.string().max(128),
        newPassword: passwordRule.optional(),
        resetMfa: z.boolean().default(false),
        reason: z.string().trim().min(5).max(500),
      })
      .parse(req.body);
    requireValue(
      id !== req.auth!.user.id,
      400,
      "Dùng chức năng đổi mật khẩu cá nhân hoặc mã khôi phục cho tài khoản của bạn.",
    );
    requireValue(
      input.newPassword || input.resetMfa,
      400,
      "Chọn thông tin cần đặt lại.",
    );
    requireValue(
      await verifyPassword(input.adminPassword, req.auth!.user.password_hash),
      403,
      "Mật khẩu quản trị viên không đúng.",
    );
    const [target] = await db.query("SELECT id FROM users WHERE id=?", [id]);
    requireValue(target, 404, "Tài khoản không tồn tại.");
    const hash = input.newPassword
      ? await hashPassword(input.newPassword)
      : null;
    await db.transaction(async (tx) => {
      if (hash)
        await tx.execute(
          "UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?",
          [hash, id],
        );
      if (input.resetMfa) {
        await tx.execute(
          "UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_enabled=0,mfa_last_step=0 WHERE id=?",
          [id],
        );
        await tx.execute("DELETE FROM recovery_codes WHERE user_id=?", [id]);
      }
      await tx.execute("DELETE FROM web_sessions WHERE user_id=?", [id]);
      await tx.execute("DELETE FROM login_challenges WHERE user_id=?", [id]);
      await audit(tx, req, "user.auth_reset", id, {
        passwordReset: !!hash,
        mfaReset: input.resetMfa,
        reason: input.reason,
      });
    });
    await gateway.closeUser(id);
    res.json({ ok: true });
  });
  router.get("/grants", adminOnly, async (_req, res) => {
    res.json({
      items: await db.query(
        "SELECT g.id,g.user_id AS userId,g.asset_id AS assetId,g.expires_at AS expiresAt,u.username,u.display_name AS displayName,a.name AS assetName FROM grants g JOIN users u ON u.id=g.user_id JOIN assets a ON a.id=g.asset_id ORDER BY g.created_at DESC",
      ),
    });
  });
  router.post("/grants", adminOnly, async (req, res) => {
    const input = z
      .object({
        userId: uuid,
        assetIds: z.array(uuid).min(1).max(500),
        expiresAt: z
          .number()
          .int()
          .min(Date.now() + 60000)
          .nullable(),
      })
      .parse(req.body);
    const [user] = await db.query(
      "SELECT id FROM users WHERE id=? AND active=1 AND role=?",
      [input.userId, "operator"],
    );
    requireValue(
      user,
      400,
      "Chỉ cấp quyền máy cho tài khoản vận hành đang hoạt động.",
    );
    await db.transaction(async (tx) => {
      for (const assetId of new Set(input.assetIds)) {
        const [asset] = await tx.query("SELECT id FROM assets WHERE id=?", [
          assetId,
        ]);
        requireValue(asset, 404, "Máy không tồn tại.");
        await tx.execute("DELETE FROM grants WHERE user_id=? AND asset_id=?", [
          input.userId,
          assetId,
        ]);
        await tx.execute(
          "INSERT INTO grants (id,user_id,asset_id,expires_at,created_at) VALUES (?,?,?,?,?)",
          [randomUUID(), input.userId, assetId, input.expiresAt, Date.now()],
        );
      }
      await audit(tx, req, "grant.created", input.userId, {
        assetIds: input.assetIds,
        expiresAt: input.expiresAt,
      });
    });
    res.status(201).json({ ok: true });
  });
  router.delete("/grants/:id", adminOnly, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const [grant] = await db.query("SELECT * FROM grants WHERE id=?", [id]);
    requireValue(grant, 404, "Quyền không tồn tại.");
    await db.transaction(async (tx) => {
      await tx.execute("DELETE FROM grants WHERE id=?", [id]);
      await audit(tx, req, "grant.revoked", id, {
        userId: grant.user_id,
        assetId: grant.asset_id,
      });
    });
    await gateway.closeUser(grant.user_id);
    res.json({ ok: true });
  });
  router.post("/sessions", async (req, res) => {
    const { assetId } = z.object({ assetId: uuid }).parse(req.body);
    res
      .status(201)
      .json(await gateway.createTicket(req.auth!, assetId, req.ip ?? ""));
  });
  router.get("/sessions", async (req, res) => {
    const p = pagination
      .extend({ status: z.enum(["all", "live", "recorded"]).default("all") })
      .parse(req.query);
    const where = ["(a.name LIKE ? OR u.username LIKE ?)"];
    const args: any[] = [`%${p.q}%`, `%${p.q}%`];
    if (req.auth!.user.role === "operator") {
      where.push("r.user_id=?");
      args.push(req.auth!.user.id);
    }
    if (p.status === "live")
      where.push("r.status IN ('active','connecting','pending')");
    if (p.status === "recorded") where.push("r.recording_available=1");
    const from = `FROM remote_sessions r JOIN assets a ON a.id=r.asset_id JOIN users u ON u.id=r.user_id WHERE ${where.join(" AND ")}`;
    const [count] = await db.query(`SELECT COUNT(*) AS total ${from}`, args);
    const rows = await db.query(
      `SELECT r.id,r.status,r.source_ip AS sourceIp,r.requested_at AS requestedAt,r.started_at AS startedAt,r.ended_at AS endedAt,r.end_reason AS endReason,r.recording_available AS recordingAvailable,u.username,u.display_name AS displayName,a.name AS assetName,a.protocol ${from} ORDER BY r.requested_at DESC LIMIT ${p.limit} OFFSET ${(p.page - 1) * p.limit}`,
      args,
    );
    res.json({
      items: rows,
      total: Number(count.total),
      page: p.page,
      limit: p.limit,
    });
  });
  router.post("/sessions/:id/terminate", async (req, res) => {
    const id = uuid.parse(req.params.id),
      [session] = await db.query(
        "SELECT user_id FROM remote_sessions WHERE id=?",
        [id],
      );
    requireValue(session, 404, "Phiên không tồn tại.");
    requireValue(
      req.auth!.user.role === "admin" || session.user_id === req.auth!.user.id,
      403,
      "Không có quyền ngắt phiên.",
    );
    await gateway.terminate(id);
    await audit(db, req, "remote.terminated", id);
    res.json({ ok: true });
  });
  router.get("/sessions/:id/recording", auditOnly, async (req, res) => {
    const id = uuid.parse(req.params.id),
      [session] = await db.query(
        "SELECT recording_available FROM remote_sessions WHERE id=?",
        [id],
      );
    requireValue(session?.recording_available, 404, "Bản ghi chưa sẵn sàng.");
    const file = path.join(config.RECORDING_DIR, `${id}.guac`),
      info = await stat(file).catch(() => null);
    requireValue(info && info.isFile(), 404, "Không tìm thấy tệp bản ghi.");
    await audit(db, req, "recording.viewed", id);
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `inline; filename="${id}.guac"`,
    });
    const stream = createReadStream(file);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    req.on("close", () => stream.destroy());
    stream.pipe(res);
  });
  router.get("/audit", auditOnly, async (req, res) => {
    const p = pagination
      .extend({
        action: z.string().max(64).default(""),
        format: z.enum(["json", "csv"]).default("json"),
      })
      .parse(req.query);
    const where =
      "(actor_name LIKE ? OR action LIKE ? OR resource_id LIKE ?) AND action LIKE ?";
    const args = [`%${p.q}%`, `%${p.q}%`, `%${p.q}%`, `%${p.action}%`];
    const [count] = await db.query(
      `SELECT COUNT(*) AS total FROM audit_events WHERE ${where}`,
      args,
    );
    const rows = await db.query(
      `SELECT id,actor_name AS actorName,action,resource_id AS resourceId,source_ip AS sourceIp,details,created_at AS createdAt FROM audit_events WHERE ${where} ORDER BY created_at DESC LIMIT ${p.format === "csv" ? 10000 : p.limit} OFFSET ${p.format === "csv" ? 0 : (p.page - 1) * p.limit}`,
      args,
    );
    if (p.format === "csv") {
      const cell = (value: any) => {
        let s = String(value ?? "");
        if (/^[=+@\-\t\r\n]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      await audit(db, req, "audit.exported", null, { rows: rows.length });
      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit.csv"',
      });
      res.send(
        "\uFEFF" +
          [
            [
              "Thời gian UTC",
              "Tài khoản",
              "Sự kiện",
              "Đối tượng",
              "IP",
              "Chi tiết",
            ],
            ...rows.map((r) => [
              new Date(Number(r.createdAt)).toISOString(),
              r.actorName,
              r.action,
              r.resourceId,
              r.sourceIp,
              r.details,
            ]),
          ]
            .map((row) => row.map(cell).join(","))
            .join("\r\n"),
      );
      return;
    }
    res.json({
      items: rows,
      total: Number(count.total),
      page: p.page,
      limit: p.limit,
    });
  });
  router.get("/system", adminOnly, async (_req, res) => {
    await db.query("SELECT 1 AS ok");
    const disk = await stat(config.RECORDING_DIR).catch(() => null);
    res.json({
      database: "MySQL 8.4 (production)",
      recordingStorageReady: !!disk?.isDirectory(),
      maxSessions: config.MAX_REMOTE_SESSIONS,
      sessionHours: config.SESSION_HOURS,
      allowedNetworks: config.ALLOWED_TARGET_CIDRS,
      mfaRequired: true,
      clipboardEnabled: false,
      deployment: "single-gateway",
      passwordRotation: "manual",
      vcenterSync: false,
    });
  });
  return router;
}
