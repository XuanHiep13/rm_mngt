function serverOrigin(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Vui lòng nhập địa chỉ máy chủ.");
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Địa chỉ phải bắt đầu bằng https:// hoặc http://localhost."); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== ""))
    throw new Error("Chỉ nhập origin của website, ví dụ https://remote.example.internal, không kèm đường dẫn hay tài khoản.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("Máy chủ cần HTTPS. HTTP chỉ được dùng với localhost để thử trên máy này.");
  return url.origin;
}
function sameOrigin(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}
module.exports = { serverOrigin, sameOrigin };
