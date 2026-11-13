import test from "node:test";
import assert from "node:assert/strict";
import { remoteTestTargetSchema } from "../scripts/remote-test-config.js";

const base = { host: "192.0.2.10", username: "tester", password: "test-password" };
const hostKey = "192.0.2.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey";

test("local remote configs preserve Windows defaults", () => {
  const target = remoteTestTargetSchema.parse(base);
  assert.equal(target.protocol, "rdp");
  assert.equal(target.os, "windows");
  assert.equal(target.port, 3389);
});
test("local SSH selects Linux and port 22 and preserves the host key", () => {
  const target = remoteTestTargetSchema.parse({ ...base, protocol: "ssh", hostKey });
  assert.equal(target.os, "linux");
  assert.equal(target.port, 22);
  assert.equal(target.hostKey, hostKey);
  assert.equal(remoteTestTargetSchema.parse({ ...base, protocol: "ssh", hostKey, port: 2222 }).port, 2222);
});
test("local SSH permits first-use confirmation but rejects malformed pins and Windows targets", () => {
  assert.equal(remoteTestTargetSchema.parse({ ...base, protocol: "ssh" }).hostKey, "");
  for (const extra of [{ hostKey: "unverified" }, { hostKey, os: "windows" }])
    assert.equal(remoteTestTargetSchema.safeParse({ ...base, protocol: "ssh", ...extra }).success, false);
});
test("local RDP supports Linux desktops with xrdp", () => {
  const target = remoteTestTargetSchema.parse({ ...base, protocol: "rdp", os: "linux" });
  assert.equal(target.os, "linux");
  assert.equal(target.port, 3389);
});
