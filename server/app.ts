import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { Gateway } from "./gateway.js";
import { authMiddleware, authRoutes } from "./auth.js";
import { apiRoutes } from "./routes.js";
import { HttpError, requireValue } from "./errors.js";

export function createApp(
  db: Database,
  config: Config,
  gateway = new Gateway(db, config),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: [
            "'self'",
            ...(config.NODE_ENV === "development"
              ? [config.APP_ORIGIN.replace(/^http/, "ws")]
              : []),
          ],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
        },
      },
      strictTransportSecurity:
        config.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/readyz", async (_req, res, next) => {
    try {
      await db.query("SELECT 1 AS ok");
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Quá nhiều yêu cầu. Vui lòng thử lại sau." },
    }),
  );
  app.use(express.json({ limit: "2mb" }), cookieParser());
  app.use(authMiddleware(db, config));
  app.use("/api", (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      requireValue(
        req.headers.origin === config.APP_ORIGIN,
        403,
        "Nguồn yêu cầu không hợp lệ.",
      );
      if (req.auth)
        requireValue(
          req.headers["x-csrf-token"] === req.auth.csrf,
          403,
          "Mã bảo vệ yêu cầu không hợp lệ. Vui lòng tải lại trang.",
        );
    }
    next();
  });
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 900000,
      limit: config.NODE_ENV === "test" ? 1000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: (req) =>
        !["/login", "/mfa/setup", "/mfa/verify"].includes(req.path),
      message: { error: "Quá nhiều lần xác thực. Thử lại sau 15 phút." },
    }),
    authRoutes(db, config, (u, s) => gateway.closeUser(u, s)),
  );
  app.use("/api", apiRoutes(db, config, gateway));
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API không tồn tại." }),
  );
  // Call last, after Vite/static middleware has been attached by the entrypoint.
  const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: err.issues[0]?.message ?? "Dữ liệu không hợp lệ.",
        fields: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (["ER_DUP_ENTRY", "SQLITE_CONSTRAINT_UNIQUE"].includes(err.code)) {
      res.status(409).json({ error: "Dữ liệu đã tồn tại." });
      return;
    }
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "JSON không hợp lệ." });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "Dữ liệu vượt giới hạn 2 MB." });
      return;
    }
    console.error("Request failed:", err.code ?? err.name ?? "UnknownError");
    res.status(500).json({
      error: "Không thể xử lý yêu cầu. Vui lòng liên hệ quản trị viên.",
    });
  };
  return { app, gateway, errorHandler };
}
