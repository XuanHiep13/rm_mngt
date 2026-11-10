import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { mkdir, open, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import type { Auth } from "./types.js";
import { cookieName } from "./auth.js";
import { digest, token, unseal } from "./crypto.js";
import { requireValue } from "./errors.js";
import { instruction, ProtocolParser } from "./protocol.js";
import { targetPolicy } from "./network.js";

export class Gateway {
  private connections = new Map<
    string,
    {
      userId: string;
      webSessionId: string;
      stop: (reason: string) => Promise<void>;
    }
  >();
  private server?: WebSocketServer;
  private checkTarget: (host: string) => void;
  constructor(
    private db: Database,
    private config: Config,
  ) {
    this.checkTarget = targetPolicy(config.ALLOWED_TARGET_CIDRS);
  }
  async authorized(auth: Auth, assetId: string) {
    requireValue(
      !auth.user.must_change_password &&
        auth.user.mfa_enabled &&
        auth.user.active &&
        auth.user.role !== "auditor",
      403,
      "Tài khoản chưa được phép remote.",
    );
    const [asset] = await this.db.query(
      "SELECT * FROM assets WHERE id=? AND enabled=1",
      [assetId],
    );
    requireValue(asset, 404, "Máy không tồn tại hoặc đang bị khóa.");
    if (auth.user.role !== "admin") {
      const [grant] = await this.db.query(
        "SELECT id FROM grants WHERE user_id=? AND asset_id=? AND (expires_at IS NULL OR expires_at>?)",
        [auth.user.id, assetId, Date.now()],
      );
      requireValue(grant, 403, "Bạn không có quyền truy cập máy này.");
    }
    this.checkTarget(asset.host);
    return asset;
  }
  async createTicket(auth: Auth, assetId: string, ip: string) {
    await this.authorized(auth, assetId);
    const id = randomUUID(),
      ticket = token(),
      time = Date.now();
    await this.db.transaction(async (tx) => {
      // Serialize reservations across simultaneous HTTP requests (single gateway deployment).
      await tx.execute("UPDATE gateway_guard SET touched=touched+1 WHERE id=1");
      await tx.execute(
        "UPDATE remote_sessions SET status='expired',ended_at=?,end_reason='ticket_expired',ticket_hash=NULL WHERE status='pending' AND ticket_expires_at<?",
        [time, time],
      );
      const [counts] = await tx.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM remote_sessions WHERE status IN ('pending','connecting','active')",
      );
      requireValue(
        Number(counts.total) < this.config.MAX_REMOTE_SESSIONS,
        429,
        "Gateway đã đạt giới hạn phiên đồng thời.",
      );
      const [own] = await tx.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM remote_sessions WHERE user_id=? AND status IN ('pending','connecting','active')",
        [auth.user.id],
      );
      requireValue(
        Number(own.total) < 5,
        429,
        "Mỗi người được mở tối đa 5 phiên.",
      );
      await tx.execute(
        "INSERT INTO remote_sessions (id,user_id,asset_id,web_session_id,ticket_hash,ticket_expires_at,status,source_ip,requested_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          id,
          auth.user.id,
          assetId,
          auth.sessionId,
          digest(ticket),
          time + 30000,
          "pending",
          ip,
          time,
        ],
      );
      await tx.execute(
        "INSERT INTO audit_events (id,actor_id,actor_name,action,resource_id,source_ip,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          auth.user.id,
          auth.user.username,
          "remote.requested",
          id,
          ip,
          JSON.stringify({ assetId }),
          time,
        ],
      );
    });
    return { sessionId: id, ticket, expiresIn: 30 };
  }
  async closeUser(userId: string, webSessionId?: string) {
    for (const connection of this.connections.values())
      if (
        connection.userId === userId &&
        (!webSessionId || connection.webSessionId === webSessionId)
      )
        await connection.stop("access_revoked");
    const clauses = webSessionId ? " AND web_session_id=?" : "";
    await this.db.execute(
      `UPDATE remote_sessions SET status='terminated',ended_at=?,end_reason='access_revoked',ticket_hash=NULL WHERE user_id=? AND status='pending'${clauses}`,
      [Date.now(), userId, ...(webSessionId ? [webSessionId] : [])],
    );
  }
  async closeAsset(assetId: string) {
    const rows = await this.db.query<{ id: string }>(
      "SELECT id FROM remote_sessions WHERE asset_id=? AND status IN ('pending','connecting','active')",
      [assetId],
    );
    for (const row of rows) await this.terminate(row.id);
  }
  async terminate(id: string) {
    const connection = this.connections.get(id);
    if (connection) await connection.stop("admin_terminated");
    else
      await this.db.execute(
        "UPDATE remote_sessions SET status='terminated',ended_at=?,end_reason='admin_terminated',ticket_hash=NULL WHERE id=? AND status='pending'",
        [Date.now(), id],
      );
  }
  async recover() {
    // This deployment intentionally runs ONE gateway instance. It owns all open tunnels.
    await this.db.execute(
      "UPDATE remote_sessions SET status='interrupted',ended_at=?,end_reason='gateway_restarted',ticket_hash=NULL WHERE status IN ('active','connecting','pending')",
      [Date.now()],
    );
  }
  attach(httpServer: Server) {
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
      handleProtocols: (protocols) =>
        protocols.has("guacamole") ? "guacamole" : false,
    });
    this.server = wss;
    httpServer.on("upgrade", (req, socket, head) => {
      if (
        new URL(req.url ?? "/", this.config.APP_ORIGIN).pathname !==
        "/api/tunnel"
      )
        return;
      void (async () => {
        const url = new URL(req.url ?? "/", this.config.APP_ORIGIN);
        requireValue(
          url.pathname === "/api/tunnel" &&
            req.headers.origin === this.config.APP_ORIGIN,
          403,
          "Forbidden",
        );
        requireValue(
          req.headers["sec-websocket-protocol"]
            ?.split(",")
            .map((x) => x.trim())
            .includes("guacamole"),
          400,
          "Protocol required",
        );
        const rawCookie = req.headers.cookie
          ?.split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith(`${cookieName(this.config)}=`))
          ?.split("=")[1];
        const ticket = url.searchParams.get("ticket");
        requireValue(
          rawCookie &&
            /^[a-f0-9]{64}$/.test(rawCookie) &&
            ticket &&
            /^[a-f0-9]{64}$/.test(ticket),
          401,
          "Unauthorized",
        );
        const [row] = await this.db.query<any>(
          "SELECT r.id AS remote_id,r.asset_id,s.id AS session_id,s.csrf_token,s.expires_at,u.* FROM remote_sessions r JOIN web_sessions s ON s.id=r.web_session_id JOIN users u ON u.id=s.user_id WHERE r.ticket_hash=? AND r.web_session_id=? AND r.status=? AND r.ticket_expires_at>? AND s.expires_at>? AND u.active=1",
          [
            digest(ticket),
            digest(rawCookie),
            "pending",
            Date.now(),
            Date.now(),
          ],
        );
        requireValue(row, 401, "Expired ticket");
        const auth: Auth = {
          user: row,
          sessionId: row.session_id,
          csrf: row.csrf_token,
          expiresAt: Number(row.expires_at),
        };
        const asset = await this.authorized(auth, row.asset_id);
        requireValue(
          (await this.db.execute(
            "UPDATE remote_sessions SET status='connecting',ticket_hash=NULL WHERE id=? AND ticket_hash=? AND status='pending'",
            [row.remote_id, digest(ticket)],
          )) === 1,
          401,
          "Used ticket",
        );
        wss.handleUpgrade(req, socket, head, (ws) => {
          void this.connect(ws, row.remote_id, auth, asset).catch(async () => {
            ws.close(1011, "Gateway error");
            await this.db
              .execute(
                "UPDATE remote_sessions SET status='failed',ended_at=?,end_reason='gateway_error' WHERE id=? AND ended_at IS NULL",
                [Date.now(), row.remote_id],
              )
              .catch(() => {});
          });
        });
      })().catch(() => {
        if (!socket.destroyed) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
        }
      });
    });
  }
  private async connect(
    ws: WebSocket,
    id: string,
    auth: Auth,
    asset: Record<string, any>,
  ) {
    await mkdir(this.config.RECORDING_DIR, { recursive: true, mode: 0o700 });
    const filePath = path.join(this.config.RECORDING_DIR, `${id}.guac`);
    const handle = await open(filePath, "wx", 0o600);
    const recording = createWriteStream(filePath, {
      fd: handle.fd,
      autoClose: false,
    });
    let ready = false,
      stopped = false,
      lastInput = Date.now();
    let remote: net.Socket | tls.TLSSocket;
    let monitor: NodeJS.Timeout | undefined;
    let connectTimeout: NodeJS.Timeout | undefined;
    const stop = async (reason: string) => {
      if (stopped) return;
      stopped = true;
      clearInterval(monitor);
      clearTimeout(connectTimeout);
      remote?.destroy();
      if (ws.readyState === WebSocket.OPEN) ws.send(instruction("disconnect"));
      ws.close(1000, "Session ended");
      this.connections.delete(id);
      await new Promise<void>((resolve) => {
        if (recording.destroyed || recording.writableFinished) resolve();
        else {
          recording.once("close", resolve);
          recording.once("finish", resolve);
          recording.end();
        }
      });
      await handle.close().catch(() => {});
      const info = await stat(filePath).catch(() => null);
      const available = ready && !!info?.size;
      await this.db.transaction(async (tx) => {
        await tx.execute(
          "UPDATE remote_sessions SET status=?,ended_at=?,end_reason=?,recording_available=? WHERE id=?",
          [
            ready
              ? reason === "admin_terminated" || reason === "access_revoked"
                ? "terminated"
                : "ended"
              : "failed",
            Date.now(),
            reason,
            available ? 1 : 0,
            id,
          ],
        );
        await tx.execute(
          "INSERT INTO audit_events (id,actor_id,actor_name,action,resource_id,source_ip,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            auth.user.id,
            auth.user.username,
            "remote.ended",
            id,
            "",
            JSON.stringify({ reason, recordingAvailable: available }),
            Date.now(),
          ],
        );
      });
    };
    const safeStop = (reason: string) => {
      void stop(reason).catch(() => {
        console.error("Unable to finalize remote session", id);
      });
    };
    recording.on("error", () => safeStop("recording_error"));
    ws.on("close", () => safeStop("browser_disconnected"));
    ws.on("error", () => safeStop("browser_error"));
    this.connections.set(id, {
      userId: auth.user.id,
      webSessionId: auth.sessionId,
      stop,
    });
    if (ws.readyState !== WebSocket.OPEN) {
      await stop("browser_disconnected");
      return;
    }
    const parameters: Record<string, string> = {
      hostname: asset.host,
      port: String(asset.port),
      username: asset.username,
      password: unseal(
        asset.secret,
        this.config.ENCRYPTION_KEY,
        `asset:${asset.id}`,
      ),
      domain: asset.domain_name,
      security: "nla",
      "ignore-cert": asset.ignore_cert ? "true" : "false",
      "host-key": asset.host_key ?? "",
      "disable-copy": "true",
      "disable-paste": "true",
      "enable-drive": "false",
      "enable-sftp": "false",
      "disable-upload": "true",
      "disable-download": "true",
      "disable-audio": "true",
      "enable-printing": "false",
      "enable-wallpaper": "false",
      "resize-method": "display-update",
      "server-layout": "en-us-qwerty",
      "font-name": "monospace",
      "font-size": "14",
      "color-scheme": "gray-black",
      "server-alive-interval": "15",
      timeout: "15",
    };
    const send = (...args: string[]) => {
      remote.write(instruction(...args));
    };
    const decoder = new ProtocolParser((elements) => {
      if (stopped) return;
      const [op, ...args] = elements;
      if (!ready) {
        if (op === "args") {
          send("size", "1440", "900", "96");
          send("audio");
          send("video");
          send("image", "image/png", "image/jpeg");
          send("timezone", "Asia/Ho_Chi_Minh");
          const values = args.map((name) =>
            name.startsWith("VERSION_")
              ? "VERSION_1_1_0"
              : (parameters[name] ?? ""),
          );
          send("connect", ...values);
          // No target credential is ever forwarded to the browser or written to the recording.
          parameters.password = "";
        } else if (op === "ready") {
          ready = true;
          clearTimeout(connectTimeout);
          ws.send(instruction("", id));
          void this.db
            .execute(
              "UPDATE remote_sessions SET status='active',started_at=? WHERE id=? AND ended_at IS NULL",
              [Date.now(), id],
            )
            .catch(() => safeStop("database_error"));
        } else if (op === "error" || op === "disconnect" || op === "require")
          safeStop("remote_auth_or_connection_failed");
        return;
      }
      if (op === "error") {
        safeStop("remote_error");
        return;
      }
      if (op === "disconnect") {
        safeStop("remote_disconnected");
        return;
      }
      if (op === "clipboard" || op === "file" || op === "pipe") {
        safeStop("blocked_transfer");
        return;
      }
      const data = instruction(...elements);
      if (!recording.write(data)) remote.pause();
      if (ws.bufferedAmount > 8 * 1024 * 1024) {
        safeStop("slow_client");
        return;
      }
      ws.send(data);
    });
    recording.on("drain", () => {
      if (!stopped) remote.resume();
    });
    remote =
      this.config.GUACD_TLS === "true"
        ? tls.connect({
            host: this.config.GUACD_HOST,
            port: this.config.GUACD_PORT,
            rejectUnauthorized: true,
          })
        : net.createConnection({
            host: this.config.GUACD_HOST,
            port: this.config.GUACD_PORT,
          });
    remote.setEncoding("utf8");
    remote.on(
      this.config.GUACD_TLS === "true" ? "secureConnect" : "connect",
      () => send("select", asset.protocol),
    );
    remote.on("data", (chunk) => {
      try {
        decoder.push(String(chunk));
      } catch {
        safeStop("protocol_error");
      }
    });
    remote.on("error", () => safeStop("gateway_unreachable"));
    remote.on("close", () => safeStop("remote_disconnected"));
    const inputs = new ProtocolParser((elements) => {
      const [op, ...args] = elements;
      if (!ready || stopped) return;
      if (
        op === "" &&
        args.length === 2 &&
        args[0] === "ping" &&
        /^\d{1,16}$/.test(args[1])
      ) {
        ws.send(instruction(...elements));
        return;
      }
      requireValue(
        ["sync", "mouse", "key", "size", "nop", "disconnect", "ack"].includes(
          op,
        ),
        400,
        "Unsupported input",
      );
      if (op === "mouse" || op === "key") lastInput = Date.now();
      if (op === "size")
        requireValue(
          args.length === 2 &&
            args.every(
              (x) =>
                /^\d{1,4}$/.test(x) && Number(x) >= 200 && Number(x) <= 3840,
            ),
          400,
          "Invalid display size",
        );
      if (op === "disconnect") {
        safeStop("user_disconnected");
        return;
      }
      if (remote.writableLength > 1024 * 1024) {
        safeStop("input_overflow");
        return;
      }
      remote.write(instruction(...elements));
    }, 64 * 1024);
    ws.on("message", (data, binary) => {
      try {
        requireValue(!binary, 400, "Text only");
        inputs.push(data.toString());
      } catch {
        safeStop("invalid_client_input");
      }
    });
    connectTimeout = setTimeout(() => safeStop("connect_timeout"), 20000);
    let checking = false;
    monitor = setInterval(() => {
      if (checking || stopped) return;
      checking = true;
      void (async () => {
        const [session] = await this.db.query<any>(
          "SELECT u.*,s.expires_at FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.active=1",
          [auth.sessionId, Date.now()],
        );
        if (!session) {
          await stop("access_revoked");
          return;
        }
        await this.authorized({ ...auth, user: session }, asset.id);
        if (Date.now() - lastInput > 30 * 60 * 1000) await stop("idle_timeout");
        else ws.ping();
      })()
        .catch(() => safeStop("access_revoked"))
        .finally(() => {
          checking = false;
        });
    }, 15000);
  }
  async shutdown() {
    for (const entry of this.connections.values())
      await entry.stop("gateway_shutdown");
    this.server?.close();
  }
}
