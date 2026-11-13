import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./database.js";
import { SshTrust, requireSshHostKey } from "../server/ssh-trust.js";

const first = "10.1.2.3 ecdsa-sha2-nistp256 AAAAE2ZpcnN0";
const second = "10.1.2.3 ecdsa-sha2-nistp256 AAAAE3NlY29uZA==";
async function fixture() {
  const db = await testDatabase();
  await db.execute(
    "INSERT INTO assets (id,name,host,port,protocol,os,group_name,description,username,secret,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ["test", "SSH", "10.1.2.3", 22, "ssh", "linux", "Test", "", "tester", "unused", Date.now()],
  );
  const asset = async () => (await db.query<any>("SELECT * FROM assets WHERE id='test'"))[0];
  return { db, asset };
}
test("first SSH needs consent; confirmation pins key; new service reuses it", async () => {
  const f = await fixture();
  const persisted: string[] = [];
  try {
    const service = new SshTrust(f.db, async () => first, async (_a, key) => { persisted.push(key); });
    const result = await service.inspect("session-a", await f.asset());
    assert.equal(result.trusted, false);
    assert.match(result.fingerprint, /^SHA256:/);
    assert.throws(() => requireSshHostKey({ ...awaitableAsset, host_key: null }));
    if (result.trusted) return;
    await assert.rejects(service.confirm("session-b", await f.asset(), result.challenge));
    await service.confirm("session-a", await f.asset(), result.challenge);
    assert.deepEqual(persisted, [first]);
    assert.equal((await new SshTrust(f.db, async () => first).inspect("session-a", await f.asset())).trusted, true);
    requireSshHostKey(await f.asset());
    await assert.rejects(service.confirm("session-a", await f.asset(), result.challenge));
  } finally { await f.db.close(); }
});
const awaitableAsset = { id: "test", host: "10.1.2.3", port: 22, protocol: "ssh" };
test("changed SSH keys are blocked without replacing the saved key", async () => {
  const f = await fixture();
  try {
    await f.db.execute("UPDATE assets SET host_key=? WHERE id='test'", [first]);
    await assert.rejects(new SshTrust(f.db, async () => second).inspect("s", await f.asset()), /KHÓA SSH ĐÃ THAY ĐỔI/);
    assert.equal((await f.asset()).host_key, first);
  } finally { await f.db.close(); }
});
test("SSH confirmation cannot be used after the asset endpoint changes", async () => {
  const f = await fixture();
  try {
    const service = new SshTrust(f.db, async () => first);
    const result = await service.inspect("s", await f.asset());
    if (result.trusted) throw new Error("Expected challenge");
    await f.db.execute("UPDATE assets SET port=2222 WHERE id='test'");
    await assert.rejects(service.confirm("s", await f.asset(), result.challenge));
    assert.equal((await f.asset()).host_key, null);
  } finally { await f.db.close(); }
});
test("concurrent confirmations cannot replace a key accepted by another user", async () => {
  const f = await fixture();
  try {
    const a = new SshTrust(f.db, async () => first), b = new SshTrust(f.db, async () => second);
    const x = await a.inspect("a", await f.asset()), y = await b.inspect("b", await f.asset());
    if (x.trusted || y.trusted) throw new Error("Expected challenges");
    await a.confirm("a", await f.asset(), x.challenge);
    await assert.rejects(b.confirm("b", await f.asset(), y.challenge));
    assert.equal((await f.asset()).host_key, first);
  } finally { await f.db.close(); }
});
