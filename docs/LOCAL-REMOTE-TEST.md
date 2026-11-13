# Thử RDP/SSH local với cấu hình cố định

Chế độ `npm run remote:test` dùng gateway thật, SQLite trong RAM, không cần
MySQL, đăng nhập website hoặc MFA. Phiên và bản ghi là tạm thời; SSH host key
đã xác nhận được lưu riêng để dùng lại sau khi khởi động lại.

## Chuẩn bị

Cần Node.js 22.13+ hoặc bản mới tương thích, npm, guacd.
SSH cần `ssh-keyscan` trong PATH trên máy chạy Node: Windows OpenSSH Client
hoặc gói openssh-client trên Linux. Image Docker ứng dụng đã cài công cụ này.

```powershell
npm ci
New-Item -ItemType Directory -Force .local
Copy-Item remote-test.linux.example.json .local/remote-test.json
docker compose -f compose.remote-test.yaml up -d
```

Chỉ copy file mẫu khi chưa có cấu hình thật để tránh ghi đè thông tin của bạn.
Sửa .local/remote-test.json:

```json
{
  "protocol": "ssh",
  "os": "linux",
  "host": "192.168.1.101",
  "port": 22,
  "username": "ubuntu",
  "password": "mat-khau-Linux",
  "guacdHost": "127.0.0.1",
  "guacdPort": 4822
}
```

Không cần điền hostKey. Máy Linux phải bật SSH và cho phép tài khoản đăng nhập
bằng mật khẩu. Chế độ thử chưa hỗ trợ private key. Container guacd và máy chạy
Node đều phải có đường tới cổng SSH máy đích; scanner chạy tại Node, SSH chạy tại guacd.

## Xác nhận lần đầu và dùng lại

```powershell
npm run remote:test
```

Mở http://localhost:3000. Lần đầu ứng dụng hiển thị IP/cổng, loại khóa và
fingerprint SHA256. Kiểm tra đúng máy rồi gõ **yes**, bấm **Xác nhận và kết nối**.
Hủy sẽ không lưu khóa và không mở phiên.

Khóa đã xác nhận lưu tại **.local/ssh-known-hosts.json**, theo IP và cổng.
File chỉ chứa public host key, không chứa mật khẩu. Không dùng known_hosts của
Windows và không tự tin khóa vừa quét nếu bạn chưa xác nhận. Restart script
vẫn dùng khóa đã lưu, không hỏi lại nếu khóa máy không đổi.

Nếu hostKey đã được nhập thủ công trong remote-test.json, ứng dụng coi đó là
khóa đã tin cậy và không hỏi yes. Muốn dùng luồng lần đầu cho máy chưa lưu,
bỏ trường hostKey hoặc đặt chuỗi rỗng. Khóa nhập thủ công được ưu tiên hơn cache.

Khóa máy thay đổi sẽ báo **KHÓA SSH ĐÃ THAY ĐỔI** và chặn kết nối. Không tự ghi đè.
Sau khi xác minh thay đổi hợp lệ, quản trị viên mới xóa mục tương ứng trong cache
(hoặc cập nhật khóa nhập thủ công), rồi restart script để xác nhận lại.

Cấu hình và cache local đã được Git/Docker ignore. Đừng commit mật khẩu vào file mẫu.
Không chạy đồng thời npm run dev vì dùng chung cổng 3000.
Nếu shell/.env có NODE_ENV=production, đổi sang development cho chế độ thử.

## Windows và desktop Linux

Windows RDP: dùng remote-test.example.json, protocol=rdp, os=windows, port=3389.
Linux SSH: terminal tương tác, không cần desktop hoặc xrdp.
Linux desktop: cần desktop và xrdp, dùng protocol=rdp, os=linux, port=3389.
ignoreCert=true chỉ bỏ kiểm tra chứng thư RDP khi thử máy dùng chứng thư tự ký;
không ảnh hưởng xác minh SSH. Cấu hình Windows cũ không có protocol/os vẫn hợp lệ.

## Dừng và kiểm tra lỗi

Ctrl+C dừng Node và xóa bản ghi tạm (crash có thể để lại thư mục tạm).
Khóa SSH đã tin cậy vẫn được giữ.
Đóng phiên trước khi kết nối lại; chế độ thử chỉ cho một phiên đồng thời.

```powershell
docker compose -f compose.remote-test.yaml logs --tail 50 guacd
docker compose -f compose.remote-test.yaml down
```

Trong ứng dụng dùng MySQL, khóa được lưu tại assets.host_key, dùng chung cho
những người được cấp quyền trên cùng máy đã khai báo. Xác nhận được ghi audit.
Không cần thay schema. Backend phải có ssh-keyscan và có đường tới máy đích.
