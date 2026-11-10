# API

Base path `/api`, JSON UTF-8. GET dữ liệu cần cookie đăng nhập sau MFA. Các mutation phải có `Origin` trùng `APP_ORIGIN`; khi đã đăng nhập phải có `X-CSRF-Token` lấy từ `/auth/me`. Không có CORS mở cho website ngoài origin.

## Xác thực

| Method | Endpoint           | Nội dung                                                               |
| ------ | ------------------ | ---------------------------------------------------------------------- |
| POST   | `/auth/login`      | `{username,password}` → challenge, needsEnrollment                     |
| POST   | `/auth/mfa/setup`  | `{challenge}` → QR và secret; chỉ khi chưa kích hoạt MFA               |
| POST   | `/auth/mfa/verify` | `{challenge,code}` → cookie, user, csrfToken; lần đầu có recoveryCodes |
| GET    | `/auth/me`         | User hiện tại và csrfToken                                             |
| POST   | `/auth/password`   | `{currentPassword,newPassword}`                                        |
| POST   | `/auth/logout`     | Hủy phiên web và phiên remote gắn với nó                               |

## Tài nguyên

| Method   | Endpoint                                        | Quyền                                                                 |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| GET      | `/dashboard`                                    | Đăng nhập; operator chỉ dữ liệu của mình                              |
| GET      | `/assets?page=1&limit=12&q=&os=all&group=`      | Operator chỉ máy được cấp; admin/auditor thấy tất cả                  |
| POST     | `/assets`                                       | Admin                                                                 |
| PUT      | `/assets/:id`                                   | Admin; kết thúc các phiên của máy                                     |
| POST     | `/assets/import`                                | Admin; mảng JSON, tối đa 500 máy                                      |
| GET/POST | `/users`                                        | Admin                                                                 |
| PATCH    | `/users/:id`                                    | Admin; `{displayName,role,active}`                                    |
| POST     | `/users/:id/reset-auth`                         | Admin; `{adminPassword,newPassword?,resetMfa,reason}`; không tự reset |
| GET/POST | `/grants`                                       | Admin; POST `{userId,assetIds,expiresAt}`                             |
| DELETE   | `/grants/:id`                                   | Admin; thu hồi và ngắt phiên người dùng                               |
| POST     | `/sessions`                                     | Admin/operator; `{assetId}` → sessionId, ticket, expiresIn            |
| GET      | `/sessions?page=1&limit=15&q=&status=all`       | Operator chỉ phiên của mình                                           |
| POST     | `/sessions/:id/terminate`                       | Admin hoặc chủ phiên                                                  |
| GET      | `/sessions/:id/recording`                       | Admin/auditor; `.guac`                                                |
| GET      | `/audit?page=1&limit=20&q=&action=&format=json` | Admin/auditor                                                         |
| GET      | `/audit?format=csv`                             | Admin/auditor; tối đa 10.000 dòng theo bộ lọc                         |
| GET      | `/system`                                       | Admin                                                                 |

`expiresAt` là milliseconds UTC hoặc `null` nếu không giới hạn. `os`: windows/linux; `protocol`: rdp/ssh. `status` bộ lọc phiên: all/live/recorded.

`assets`: `{name,host,port,protocol,os,groupName,description,username,password,domain,hostKey,ignoreCert,enabled}`. Tạo mới cần password; khi cập nhật, bỏ trường password để giữ nguyên. SSH cần hostKey. API không trả ciphertext hoặc password.

## Tunnel

WebSocket `/api/tunnel?ticket=...`, subprotocol `guacamole`, kèm cookie phiên và Origin hợp lệ. Ticket chỉ có hiệu lực một lần trong 30 giây. Không truyền mật khẩu, hostname hoặc thông tin xác thực máy đích trong URL tunnel. Nginx log chỉ `$uri`, không ghi query chứa ticket.

Chỉ service gateway sử dụng Guacamole handshake với guacd. Trình duyệt sử dụng `guacamole-common-js` để nhận hình ảnh và gửi chuột/phím. Tệp ghi phiên là luồng Guacamole, không phải MP4; phát bằng `Guacamole.SessionRecording`.

## Lỗi

JSON `{error, fields?}`. HTTP 400 cho dữ liệu sai; 401 chưa đăng nhập/MFA sai; 403 thiếu quyền, Origin hoặc CSRF không hợp lệ; 404 tài nguyên không có; 409 trùng; 429 vượt giới hạn. Lỗi nội bộ không trả stack trace hoặc thông tin kết nối.
