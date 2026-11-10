import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { Request } from "express";
export async function audit(
  db: Database,
  req: Pick<Request, "auth" | "ip">,
  action: string,
  resource: string | null = null,
  details: Record<string, unknown> = {},
) {
  await db.execute(
    "INSERT INTO audit_events (id,actor_id,actor_name,action,resource_id,source_ip,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      req.auth?.user.id ?? null,
      req.auth?.user.username ?? "anonymous",
      action,
      resource,
      req.ip ?? "",
      JSON.stringify(details),
      Date.now(),
    ],
  );
}
