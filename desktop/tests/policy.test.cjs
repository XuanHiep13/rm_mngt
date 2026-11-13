const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serverOrigin, sameOrigin } = require("../policy.cjs");
test("desktop accepts HTTPS and loopback HTTP with normalized origins", () => {
  assert.equal(serverOrigin(" https://remote.example.internal/ "), "https://remote.example.internal");
  assert.equal(serverOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(serverOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});
test("desktop rejects unsafe URLs and values that break the backend origin", () => {
  for (const value of ["http://10.1.2.3", "javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "https://example.com/api", "https://example.com?token=secret", "https://example.com/#x", "", null])
    assert.throws(() => serverOrigin(value));
});
test("desktop blocks navigation to other origins and schemes", () => {
  const origin = "https://remote.example.internal";
  assert.equal(sameOrigin(origin + "/api/auth/me", origin), true);
  for (const value of ["https://evil.example", "https://remote.example.internal.evil.example", "http://remote.example.internal", "file:///tmp/x", "javascript:alert(1)"])
    assert.equal(sameOrigin(value, origin), false);
});
