import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../server/config.js";
import { mysqlDatabase } from "../server/db.js";
import { schema, indexes } from "../server/schema.js";

test(
  "MySQL integration: schema, parameter binding, unique keys and rollback",
  { skip: process.env.MYSQL_INTEGRATION !== "1" },
  async () => {
    // MUST point at a dedicated disposable test database, never the production schema.
    const config = readConfig();
    assert.match(
      config.MYSQL_DATABASE,
      /_test$/,
      "Integration database name must end in _test",
    );
    const db = mysqlDatabase(config);
    const id = randomUUID(),
      name = `test-${id}`;
    try {
      if (config.MYSQL_TLS === "true") {
        const [tls] = await db.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        assert.ok(
          tls?.Value,
          "Remote integration must use an encrypted session",
        );
      }
      for (const sql of schema)
        await db.execute(`${sql} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      for (const sql of indexes) {
        try {
          await db.execute(sql);
        } catch (e: any) {
          if (e.code !== "ER_DUP_KEYNAME") throw e;
        }
      }
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.execute(
            "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
            [id, name, "O'Reilly", "unused", "operator", Date.now()],
          );
          throw new Error("rollback");
        }),
      );
      assert.equal(
        (await db.query("SELECT id FROM users WHERE id=?", [id])).length,
        0,
      );
      await db.execute(
        "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
        [id, name, "O'Reilly", "unused", "operator", Date.now()],
      );
      assert.equal(
        (await db.query("SELECT display_name FROM users WHERE id=?", [id]))[0]
          .display_name,
        "O'Reilly",
      );
      await assert.rejects(
        db.execute(
          "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
          [randomUUID(), name, "duplicate", "unused", "operator", Date.now()],
        ),
      );
    } finally {
      await db.execute("DELETE FROM users WHERE id=?", [id]);
      await db.close();
    }
  },
);
