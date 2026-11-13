import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { Database } from "./db.js";
import { token } from "./crypto.js";
import { requireValue, HttpError } from "./errors.js";

const run = promisify(execFile);
export type SshAsset = { id: string; host: string; port: number; protocol: string; host_key?: string | null };
export function hostKeyInfo(line: string) {
  const match = /^(\S+)\s+(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+([A-Za-z0-9+/=]+)(?:\s.*)?$/.exec(line.trim());
  requireValue(match, 400, "SSH host key không hợp lệ.");
  return {
    type: match[2],
    key: match[3],
    fingerprint: "SHA256:" + createHash("sha256").update(Buffer.from(match[3], "base64")).digest("base64").replace(/=+$/, ""),
  };
}

// Do not use a shell or accept a client-supplied hostname. Gateway enforces IPv4/CIDR first.
export async function scanHostKey(host: string, port: number, expectedType?: string) {
  const types = expectedType
    ? expectedType.startsWith("ecdsa-") ? "ecdsa" : expectedType === "ssh-ed25519" ? "ed25519" : "rsa"
    : "ecdsa,ed25519,rsa";
  let output: string;
  try {
    const result = await run("ssh-keyscan", ["-T", "5", "-t", types, "-p", String(port), host], {
      timeout: 18000, maxBuffer: 64 * 1024, windowsHide: true, encoding: "utf8",
    });
    output = result.stdout;
  } catch (error: any) {
    if (error.code === "ENOENT")
      throw new HttpError(503, "Backend cần ssh-keyscan (OpenSSH client) để kiểm tra khóa SSH.");
    // Some servers omit an algorithm; ssh-keyscan may still return valid keys.
    output = typeof error.stdout === "string" ? error.stdout : "";
  }
  const lines = output.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const candidates = lines.map((line) => ({ line, ...hostKeyInfo(line) }));
  // guacd/libssh2 in the supplied image selects ECDSA when available.
  const selected = expectedType
    ? candidates.find((key) => key.type === expectedType)
    : candidates.find((key) => key.type.startsWith("ecdsa-")) ??
      candidates.find((key) => key.type === "ssh-ed25519") ?? candidates[0];
  requireValue(selected, 502, "Không lấy được khóa SSH máy đích. Kiểm tra SSH server, cổng và đường mạng từ backend.");
  const address = port === 22 ? host : `[${host}]:${port}`;
  return `${address} ${selected.type} ${selected.key}`;
}

type Pending = { session: string; assetId: string; host: string; port: number; key: string; expires: number };
export class SshTrust {
  private pending = new Map<string, Pending>();
  constructor(
    private db: Database,
    private scan = scanHostKey,
    private persist?: (asset: SshAsset, key: string) => Promise<void>,
  ) {}
  async inspect(session: string, asset: SshAsset) {
    requireValue(asset.protocol === "ssh", 400, "Máy không dùng SSH.");
    const saved = asset.host_key ? hostKeyInfo(asset.host_key) : null;
    const key = await this.scan(asset.host, Number(asset.port), saved?.type);
    const current = hostKeyInfo(key);
    if (saved) {
      requireValue(saved.type === current.type && saved.key === current.key, 409,
        `KHÓA SSH ĐÃ THAY ĐỔI cho ${asset.host}:${asset.port}. Đã lưu: ${saved.fingerprint}. Hiện tại: ${current.fingerprint}. Hãy liên hệ quản trị máy để xác minh.`);
      return { trusted: true as const, host: asset.host, port: Number(asset.port), type: current.type, fingerprint: current.fingerprint };
    }
    for (const [id, item] of this.pending)
      if (item.expires <= Date.now()) this.pending.delete(id);
    requireValue(this.pending.size < 1000, 429, "Có quá nhiều yêu cầu xác nhận khóa SSH.");
    const challenge = token();
    this.pending.set(challenge, { session, assetId: asset.id, host: asset.host, port: Number(asset.port), key, expires: Date.now() + 300000 });
    return { trusted: false as const, challenge, host: asset.host, port: Number(asset.port), type: current.type, fingerprint: current.fingerprint };
  }
  async confirm(session: string, asset: SshAsset, challenge: string) {
    const pending = this.pending.get(challenge);
    requireValue(pending && pending.session === session && pending.assetId === asset.id &&
      pending.host === asset.host && pending.port === Number(asset.port) && asset.protocol === "ssh" &&
      pending.expires > Date.now(), 409, "Xác nhận SSH đã hết hạn hoặc cấu hình máy đã thay đổi. Hãy kết nối lại.");
    this.pending.delete(challenge);
    // Never overwrite an existing pin, even if two users confirm different keys concurrently.
    await this.db.transaction(async (tx) => {
      await tx.execute(
        "UPDATE assets SET host_key=? WHERE id=? AND host=? AND port=? AND protocol='ssh' AND (host_key IS NULL OR host_key='')",
        [pending.key, asset.id, asset.host, asset.port],
      );
      const [saved] = await tx.query<{ host_key: string }>("SELECT host_key FROM assets WHERE id=?", [asset.id]);
      requireValue(saved?.host_key === pending.key, 409, "Khóa SSH đã được cập nhật bởi phiên khác. Hãy kết nối lại.");
      if (this.persist) await this.persist(asset, pending.key);
    });
    return hostKeyInfo(pending.key);
  }
}

export function requireSshHostKey(asset: SshAsset) {
  if (asset.protocol === "ssh")
    requireValue(asset.host_key?.trim(), 409, "Cần xác nhận fingerprint SSH trước khi mở kết nối.");
}
