// SQLite is ONLY a fast test/local-preview adapter. Production always uses mysql2.
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../server/db.js";
import { schema, indexes } from "../server/schema.js";
export async function testDatabase(): Promise<Database> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  let gate = Promise.resolve();
  const execute = async (sql: string, params: any[] = []) => {
    try {
      return Number(sqlite.prepare(sql).run(...params).changes);
    } catch (error: any) {
      if (error.errcode === 1555) error.code = "SQLITE_CONSTRAINT_PRIMARYKEY";
      if (error.errcode === 2067) error.code = "SQLITE_CONSTRAINT_UNIQUE";
      throw error;
    }
  };
  const db: Database = {
    async query<T>(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    execute,
    async transaction(fn) {
      const previous = gate;
      let release!: () => void;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      sqlite.exec("BEGIN");
      try {
        const value = await fn(db);
        sqlite.exec("COMMIT");
        return value;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      } finally {
        release();
      }
    },
    async close() {
      sqlite.close();
    },
  };
  for (const sql of [...schema, ...indexes]) await db.execute(sql);
  await db.execute("INSERT INTO gateway_guard (id,touched) VALUES (1,0)");
  return db;
}
