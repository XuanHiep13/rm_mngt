import { z } from "zod";

// Keep old Windows configs valid while selecting SSH defaults for Linux.
export const remoteTestTargetSchema = z.object({
  host: z.ipv4(),
  protocol: z.enum(["rdp", "ssh"]).default("rdp"),
  os: z.enum(["windows", "linux"]).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1),
  password: z.string().min(1),
  domain: z.string().default(""),
  hostKey: z.string().trim().max(4096).default(""),
  ignoreCert: z.boolean().default(false),
  guacdHost: z.string().min(1).default("127.0.0.1"),
  guacdPort: z.number().int().min(1).max(65535).default(4822),
}).superRefine((target, ctx) => {
  if (target.protocol !== "ssh") return;
  if (target.os === "windows")
    ctx.addIssue({ code: "custom", path: ["os"], message: "SSH test requires os=linux." });
  if (target.hostKey && !/^\S+\s+(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+[A-Za-z0-9+/=]+(?:\s.*)?$/.test(target.hostKey))
    ctx.addIssue({
      code: "custom", path: ["hostKey"],
      message: "Provide a valid known_hosts line, or leave hostKey empty to confirm on first connect.",
    });
}).transform((target) => ({
  ...target,
  os: target.os ?? (target.protocol === "ssh" ? "linux" : "windows"),
  port: target.port ?? (target.protocol === "ssh" ? 22 : 3389),
}));
