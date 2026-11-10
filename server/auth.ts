import { Router, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import type { User } from "./types.js";
import {
  token,
  digest,
  hashPassword,
  verifyPassword,
  seal,
  unseal,
} from "./crypto.js";
import { requireValue } from "./errors.js";
import { audit } from "./audit.js";

export const passwordRule = z
  .string()
  .min(14, "Mật khẩu cần ít nhất 14 ký tự.")
  .max(128);
export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  active: !!u.active,
  mfaEnabled: !!u.mfa_enabled,
  mustChangePassword: !!u.must_change_password,
  createdAt: Number(u.created_at),
});
export function totp(secret: string, username: string) {
  return new OTPAuth.TOTP({
    issuer: "VM Access",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
export const cookieName = (config: Config) =>
  config.NODE_ENV === "production" ? "__Host-vmportal" : "vmportal";

export function authMiddleware(db: Database, config: Config): RequestHandler {
  return async (req, _res, next) => {
    const raw = req.cookies?.[cookieName(config)];
    if (typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw)) {
      const [row] = await db.query<
        User & { session_id: string; csrf_token: string; expires_at: number }
      >(
        "SELECT u.*,s.id AS session_id,s.csrf_token,s.expires_at FROM web_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.active=1",
        [digest(raw), Date.now()],
      );
      if (row)
        req.auth = {
          user: row,
          sessionId: row.session_id,
          csrf: row.csrf_token,
          expiresAt: Number(row.expires_at),
        };
    }
    next();
  };
}
export const authenticated: RequestHandler = (req, _res, next) => {
  requireValue(req.auth, 401, "Vui lòng đăng nhập.");
  next();
};
export const passwordChanged: RequestHandler = (req, _res, next) => {
  requireValue(
    !req.auth?.user.must_change_password,
    403,
    "Vui lòng đổi mật khẩu trước khi tiếp tục.",
  );
  next();
};
export const adminOnly: RequestHandler = (req, _res, next) => {
  requireValue(
    req.auth?.user.role === "admin",
    403,
    "Chức năng dành cho quản trị viên.",
  );
  next();
};
export const auditOnly: RequestHandler = (req, _res, next) => {
  requireValue(
    ["admin", "auditor"].includes(req.auth?.user.role ?? ""),
    403,
    "Bạn không có quyền kiểm toán.",
  );
  next();
};

export function authRoutes(
  db: Database,
  config: Config,
  closeSessions: (userId: string, webSessionId?: string) => Promise<void>,
) {
  const router = Router();
  const dummyHash = hashPassword(token());
  const getChallenge = async (raw: string) => {
    const [challenge] = await db.query<{ user_id: string; attempts: number }>(
      "SELECT user_id,attempts FROM login_challenges WHERE token_hash=? AND expires_at>? AND attempts<5",
      [digest(raw), Date.now()],
    );
    requireValue(
      challenge,
      401,
      "Phiên xác thực hết hạn. Vui lòng đăng nhập lại.",
    );
    const [user] = await db.query<User>(
      "SELECT * FROM users WHERE id=? AND active=1",
      [challenge.user_id],
    );
    requireValue(user, 401, "Tài khoản không khả dụng.");
    return user;
  };
  router.post("/login", async (req, res) => {
    const { username, password } = z
      .object({
        username: z.string().trim().toLowerCase().min(1).max(64),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const throttleId = digest(username);
    const [throttle] = await db.query<{ blocked_until: number }>(
      "SELECT blocked_until FROM auth_throttle WHERE id=?",
      [throttleId],
    );
    requireValue(
      !throttle || Number(throttle.blocked_until) < Date.now(),
      429,
      "Tài khoản tạm khóa đăng nhập. Thử lại sau 15 phút.",
    );
    const [user] = await db.query<User>(
      "SELECT * FROM users WHERE username=?",
      [username],
    );
    const valid = await verifyPassword(
      password,
      user?.password_hash ?? (await dummyHash),
    );
    if (!valid || !user?.active) {
      try {
        await db.execute(
          "INSERT INTO auth_throttle (id,failures,blocked_until,updated_at) VALUES (?,0,0,?)",
          [throttleId, Date.now()],
        );
      } catch (error: any) {
        if (
          !["ER_DUP_ENTRY", "SQLITE_CONSTRAINT_PRIMARYKEY"].includes(error.code)
        )
          throw error;
      }
      await db.execute(
        "UPDATE auth_throttle SET failures=CASE WHEN updated_at<? THEN 1 ELSE failures+1 END,updated_at=? WHERE id=?",
        [Date.now() - 900000, Date.now(), throttleId],
      );
      await db.execute(
        "UPDATE auth_throttle SET blocked_until=? WHERE id=? AND failures>=5",
        [Date.now() + 900000, throttleId],
      );
      await audit(db, req, "auth.login_failed", null, { username });
      requireValue(false, 401, "Tên đăng nhập hoặc mật khẩu không đúng.");
    }
    await db.execute("DELETE FROM auth_throttle WHERE id=?", [throttleId]);
    const challenge = token();
    await db.execute("DELETE FROM login_challenges WHERE expires_at<?", [
      Date.now(),
    ]);
    await db.execute(
      "INSERT INTO login_challenges (token_hash,user_id,expires_at) VALUES (?,?,?)",
      [digest(challenge), user.id, Date.now() + 300000],
    );
    res.json({ challenge, needsEnrollment: !user.mfa_enabled });
  });
  router.post("/mfa/setup", async (req, res) => {
    const { challenge } = z
      .object({ challenge: z.string().length(64) })
      .parse(req.body);
    let user = await getChallenge(challenge);
    requireValue(!user.mfa_enabled, 409, "MFA đã được kích hoạt.");
    if (!user.mfa_pending) {
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      await db.execute(
        "UPDATE users SET mfa_pending=? WHERE id=? AND mfa_pending IS NULL AND mfa_enabled=0",
        [seal(secret, config.ENCRYPTION_KEY, `mfa:${user.id}`), user.id],
      );
      [user] = await db.query<User>("SELECT * FROM users WHERE id=?", [
        user.id,
      ]);
    }
    const secret = unseal(
      user.mfa_pending!,
      config.ENCRYPTION_KEY,
      `mfa:${user.id}`,
    );
    res.json({
      secret,
      qrCode: await QRCode.toDataURL(totp(secret, user.username).toString()),
    });
  });
  router.post("/mfa/verify", async (req, res) => {
    const { challenge, code } = z
      .object({
        challenge: z.string().length(64),
        code: z.string().trim().max(64),
      })
      .parse(req.body);
    const user = await getChallenge(challenge);
    const attempt = await db.execute(
      "UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=? AND attempts<5 AND expires_at>?",
      [digest(challenge), Date.now()],
    );
    requireValue(attempt === 1, 401, "Phiên xác thực hết hạn.");
    const recovery = code.replace(/-/g, "").toLowerCase();
    const recoveryHash = digest(`${user.id}:${recovery}`);
    const [recoveryRow] = user.mfa_enabled
      ? await db.query(
          "SELECT code_hash FROM recovery_codes WHERE user_id=? AND code_hash=?",
          [user.id, recoveryHash],
        )
      : [];
    const encryptedSecret = user.mfa_enabled
      ? user.mfa_secret
      : user.mfa_pending;
    const secret = encryptedSecret
      ? unseal(encryptedSecret, config.ENCRYPTION_KEY, `mfa:${user.id}`)
      : "";
    const delta =
      secret && /^\d{6}$/.test(code)
        ? totp(secret, user.username).validate({ token: code, window: 1 })
        : null;
    const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
    if (
      !recoveryRow &&
      (delta === null || step <= Number(user.mfa_last_step))
    ) {
      await audit(db, req, "auth.mfa_failed", user.id);
      requireValue(false, 401, "Mã xác thực không đúng hoặc đã sử dụng.");
    }
    const rawSession = token(),
      sessionId = digest(rawSession),
      csrf = token();
    const recoveryCodes: string[] = [];
    await db.transaction(async (tx) => {
      requireValue(
        (await tx.execute(
          "DELETE FROM login_challenges WHERE token_hash=? AND expires_at>?",
          [digest(challenge), Date.now()],
        )) === 1,
        401,
        "Phiên xác thực đã sử dụng.",
      );
      if (recoveryRow)
        requireValue(
          (await tx.execute("DELETE FROM recovery_codes WHERE code_hash=?", [
            recoveryHash,
          ])) === 1,
          401,
          "Mã khôi phục đã sử dụng.",
        );
      else
        requireValue(
          (await tx.execute(
            "UPDATE users SET mfa_last_step=?,mfa_enabled=1,mfa_secret=?,mfa_pending=NULL WHERE id=? AND mfa_last_step<?",
            [step, encryptedSecret, user.id, step],
          )) === 1,
          401,
          "Mã xác thực đã sử dụng.",
        );
      if (!user.mfa_enabled) {
        for (let i = 0; i < 8; i++) {
          const raw = token().slice(0, 20);
          recoveryCodes.push(raw.match(/.{1,5}/g)!.join("-"));
          await tx.execute(
            "INSERT INTO recovery_codes (code_hash,user_id) VALUES (?,?)",
            [digest(`${user.id}:${raw}`), user.id],
          );
        }
      }
      await tx.execute(
        "INSERT INTO web_sessions (id,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)",
        [
          sessionId,
          user.id,
          csrf,
          Date.now() + config.SESSION_HOURS * 3600000,
          Date.now(),
        ],
      );
      await audit(
        tx,
        { ...req, ip: req.ip, auth: { user, sessionId, csrf, expiresAt: 0 } },
        recoveryRow ? "auth.recovery_login" : "auth.login",
        user.id,
      );
    });
    res.cookie(cookieName(config), rawSession, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: config.SESSION_HOURS * 3600000,
    });
    res.json({
      user: publicUser({ ...user, mfa_enabled: 1 }),
      csrfToken: csrf,
      recoveryCodes,
    });
  });
  router.get("/me", authenticated, (req, res) =>
    res.json({ user: publicUser(req.auth!.user), csrfToken: req.auth!.csrf }),
  );
  router.post("/logout", authenticated, async (req, res) => {
    await db.execute("DELETE FROM web_sessions WHERE id=?", [
      req.auth!.sessionId,
    ]);
    await closeSessions(req.auth!.user.id, req.auth!.sessionId);
    await audit(db, req, "auth.logout");
    res.clearCookie(cookieName(config), {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });
    res.json({ ok: true });
  });
  router.post("/password", authenticated, async (req, res) => {
    const input = z
      .object({
        currentPassword: z.string().max(128),
        newPassword: passwordRule,
      })
      .parse(req.body);
    requireValue(
      await verifyPassword(input.currentPassword, req.auth!.user.password_hash),
      400,
      "Mật khẩu hiện tại không đúng.",
    );
    requireValue(
      input.currentPassword !== input.newPassword,
      400,
      "Mật khẩu mới phải khác mật khẩu hiện tại.",
    );
    const hash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.execute(
        "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?",
        [hash, req.auth!.user.id],
      );
      await tx.execute("DELETE FROM web_sessions WHERE user_id=? AND id<>?", [
        req.auth!.user.id,
        req.auth!.sessionId,
      ]);
      await tx.execute("DELETE FROM login_challenges WHERE user_id=?", [
        req.auth!.user.id,
      ]);
      await audit(tx, req, "auth.password_changed");
    });
    await closeSessions(req.auth!.user.id);
    res.json({ ok: true });
  });
  return router;
}
