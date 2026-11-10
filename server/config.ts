import "dotenv/config";
import { z } from "zod";
import { isIP } from "node:net";

const env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[a-fA-F0-9]{64}$/,
      "ENCRYPTION_KEY must be 32 random bytes in hex",
    ),
  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_DATABASE: z.string().default("vmportal"),
  MYSQL_USER: z.string().default("vmportal"),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_TLS: z.enum(["true", "false"]).default("false"),
  MYSQL_SSL_CA: z.string().default(""),
  MYSQL_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(10000),
  GUACD_HOST: z.string().default("127.0.0.1"),
  GUACD_PORT: z.coerce.number().default(4822),
  GUACD_TLS: z.enum(["true", "false"]).default("false"),
  RECORDING_DIR: z.string().default("/recordings"),
  SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  MAX_REMOTE_SESSIONS: z.coerce.number().int().min(1).max(1000).default(30),
  ALLOWED_TARGET_CIDRS: z
    .string()
    .default("10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
});
export type Config = z.infer<typeof env>;
export function readConfig(input: NodeJS.ProcessEnv = process.env): Config {
  const config = env.parse(input);
  if (config.MYSQL_SSL_CA && config.MYSQL_TLS !== "true")
    throw new Error("MYSQL_SSL_CA requires MYSQL_TLS=true");
  if (
    config.MYSQL_TLS === "true" &&
    (isIP(config.MYSQL_HOST) ||
      !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
        config.MYSQL_HOST,
      ))
  ) {
    throw new Error(
      "MYSQL_TLS requires a DNS hostname matching the database certificate (use internal DNS or an /etc/hosts mapping)",
    );
  }
  const url = new URL(config.APP_ORIGIN);
  if (config.NODE_ENV === "production" && url.protocol !== "https:")
    throw new Error("Production APP_ORIGIN must use HTTPS");
  if (url.origin !== config.APP_ORIGIN)
    throw new Error(
      "APP_ORIGIN must contain only the origin, without a trailing slash",
    );
  return config;
}
