import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../server/config.js";
import { mysqlPoolOptions } from "../server/db.js";

const base = {
  NODE_ENV: "test",
  ENCRYPTION_KEY: "a".repeat(64),
  MYSQL_HOST: "db.vmportal.internal",
};
test("remote MySQL uses TLS with CA and identity verification; no insecure fallback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vmportal-db-options-"));
  try {
    const ca = path.join(dir, "ca.pem");
    await writeFile(ca, "test-ca-content");
    const config = readConfig({ ...base, MYSQL_TLS: "true", MYSQL_SSL_CA: ca });
    const options = mysqlPoolOptions(config);
    assert.ok(options.ssl && typeof options.ssl === "object");
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.verifyIdentity, true);
    assert.equal(options.ssl.minVersion, "TLSv1.2");
    assert.equal(options.ssl.ca?.toString(), "test-ca-content");
    assert.equal(options.host, "db.vmportal.internal");
    assert.equal(options.connectTimeout, 10000);
    assert.throws(
      () =>
        mysqlPoolOptions({
          ...config,
          MYSQL_SSL_CA: path.join(dir, "missing.pem"),
        }),
      /ENOENT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("TLS rejects raw IPs and mismatched switches instead of weakening certificate verification", () => {
  assert.throws(
    () => readConfig({ ...base, MYSQL_TLS: "true", MYSQL_HOST: "11.11.11.12" }),
    /DNS hostname/,
  );
  assert.throws(
    () => readConfig({ ...base, MYSQL_TLS: "false", MYSQL_SSL_CA: "/ca.pem" }),
    /requires MYSQL_TLS/,
  );
  assert.throws(() => readConfig({ ...base, MYSQL_CONNECT_TIMEOUT_MS: "0" }));
  const systemCa = mysqlPoolOptions(readConfig({ ...base, MYSQL_TLS: "true" }));
  assert.ok(
    systemCa.ssl &&
      typeof systemCa.ssl === "object" &&
      systemCa.ssl.verifyIdentity,
  );
});
test("bundled database mode remains compatible without TLS-only configuration", () => {
  const options = mysqlPoolOptions(
    readConfig({ ...base, MYSQL_HOST: "mysql" }),
  );
  assert.equal(options.host, "mysql");
  assert.equal(options.ssl, undefined);
  assert.equal(options.multipleStatements, false);
});
