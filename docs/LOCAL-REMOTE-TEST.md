# Thử RDP local với cấu hình cố định

Chạy một kết nối thật qua gateway hiện có, chưa cần MySQL, tài khoản website,
MFA, thêm máy hoặc cấp quyền qua giao diện. Script dùng SQLite trong RAM để
giữ trạng thái mà gateway cần; dừng là mất dữ liệu. Không thay đổi luồng production.

Yêu cầu: Node.js 22.13+ (có node:sqlite) hoặc Node mới hơn tương thích,
npm, guacd và máy đích có RDP. Nếu dùng Docker Desktop, container guacd
phải có đường mạng tới IP máy đích.

## 1. Cài dependency và điền thông tin máy

Chạy PowerShell tại thư mục gốc:

```powershell
npm ci
New-Item -ItemType Directory -Force .local
Copy-Item remote-test.example.json .local/remote-test.json
```

Sửa **.local/remote-test.json**:

```json
{
  "host": "192.168.1.100",
  "port": 3389,
  "username": "Administrator",
  "password": "mat-khau-Windows-thuc-te",
  "domain": "",
  "ignoreCert": true,
  "guacdHost": "127.0.0.1",
  "guacdPort": 4822
}
```

Đổi host/username/password theo máy thật. Password là mật khẩu Windows, không
phải PIN. Domain để trống cho tài khoản local hoặc điền domain phù hợp.
ignoreCert=true bỏ kiểm tra chứng thư RDP, chỉ dùng cho máy thử có chứng thư tự ký;
đặt false nếu máy đã có chứng thư được guacd tin cậy.
File thật nằm trong .local/ đã được Git/Docker ignore. Không điền mật khẩu
vào file example hoặc mã frontend. IP đích phải là IPv4, không phải loopback.

## 2. Chạy guacd

```powershell
docker compose -f compose.remote-test.yaml up -d
```

Chỉ chạy guacd, không chạy MySQL/Nginx/app production. Cổng 4822 chỉ bind
localhost. Nếu đã có guacd, điền guacdHost/guacdPort và bỏ qua lệnh trên.

## 3. Chạy và mở remote

```powershell
npm run remote:test
```

Mở **http://localhost:3000**. Trang tự mở remote với cấu hình đã điền,
không hỏi đăng nhập. Đóng phiên rồi bấm Kết nối lại để thử lần nữa.
Thay cấu hình phải khởi động lại script. Không chạy đồng thời npm run dev
vì dùng cùng cổng. Lệnh không dùng cấu hình kết nối MySQL trong .env,
nhưng từ chối chạy nếu NODE_ENV=production trong shell hoặc .env.
Chỉ bind 127.0.0.1; host truy cập phải là localhost:3000.

Luồng: trình duyệt → Node local → guacd → RDP máy đích.
Mật khẩu cố định chỉ được đọc ở server. Ticket, WebSocket và handshake
vẫn đi qua gateway thật. Bản ghi được ghi vào thư mục tạm và xóa khi
dừng bình thường bằng Ctrl+C; nếu tiến trình crash có thể còn thư mục tạm.
Chế độ này tự cấp phiên admin local, không dùng để thử MFA/phân quyền.

## Nếu kết nối thất bại

- Máy Windows phải hỗ trợ và bật RDP; tài khoản có quyền đăng nhập RDP.
- Firewall/định tuyến phải cho phép container guacd tới IP/cổng máy đích.
- Xem log Node và `docker compose -f compose.remote-test.yaml logs --tail 100 guacd`.
- Kiểm tra `Test-NetConnection 192.168.1.100 -Port 3389` từ host;
  kết quả này chưa chứng minh container guacd truy cập được máy, nhất là qua VPN.
- Chỉ có một phiên remote đồng thời trong chế độ thử. Đóng phiên cũ trước khi mở lại.

Dừng Node bằng Ctrl+C. Dừng guacd:

```powershell
docker compose -f compose.remote-test.yaml down
```
