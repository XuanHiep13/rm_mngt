import { readConfig } from "../server/config.js";
import { mysqlDatabase } from "../server/db.js";
import { schema, indexes } from "../server/schema.js";
const db = mysqlDatabase(readConfig());
try {
  for (const sql of schema)
    await db.execute(
      `${sql} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    );
  for (const sql of indexes) {
    try {
      await db.execute(sql);
    } catch (error: any) {
      if (error.code !== "ER_DUP_KEYNAME") throw error;
    }
  }
  const [guard] = await db.query("SELECT id FROM gateway_guard WHERE id=1");
  if (!guard)
    await db.execute("INSERT INTO gateway_guard (id,touched) VALUES (1,0)");
  console.log("MySQL schema is ready.");
} finally {
  await db.close();
}
