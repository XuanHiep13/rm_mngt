import mysql from "mysql2/promise";
import type { Config } from "./config.js";
import { readFileSync } from "node:fs";

export interface Database {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<number>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function mysqlPoolOptions(config: Config): mysql.PoolOptions {
  return {
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    database: config.MYSQL_DATABASE,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    connectionLimit: 12,
    timezone: "Z",
    dateStrings: true,
    charset: "utf8mb4",
    multipleStatements: false,
    connectTimeout: config.MYSQL_CONNECT_TIMEOUT_MS,
    ...(config.MYSQL_TLS === "true"
      ? {
          ssl: {
            ...(config.MYSQL_SSL_CA
              ? { ca: readFileSync(config.MYSQL_SSL_CA) }
              : {}),
            rejectUnauthorized: true,
            verifyIdentity: true,
            minVersion: "TLSv1.2",
          },
        }
      : {}),
  };
}

export function mysqlDatabase(config: Config): Database {
  const pool = mysql.createPool(mysqlPoolOptions(config));
  function wrap(connection: mysql.Pool | mysql.PoolConnection): Database {
    return {
      async query<T>(sql: string, params: any[] = []) {
        const [rows] = await connection.execute(sql, params);
        return rows as T[];
      },
      async execute(sql, params = []) {
        const [r] = await connection.execute(sql, params);
        return (r as mysql.ResultSetHeader).affectedRows;
      },
      async transaction(fn) {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const result = await fn(wrap(conn));
          await conn.commit();
          return result;
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          conn.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }
  return wrap(pool);
}

// Milliseconds since epoch keep time comparisons identical across MySQL and test adapters.
export const now = () => Date.now();
