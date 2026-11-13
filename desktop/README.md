# VM Access Desktop

Ứng dụng Electron riêng cho Windows và macOS, mở website VM Access hiện có.
Không sửa hoặc build lại client web. Backend/MySQL/guacd vẫn chạy trên máy chủ.
Máy cài desktop phải truy cập được máy chủ qua mạng/VPN. Đây không phải bộ
cài backend offline và không cần Docker trên máy người dùng.

## Chạy thử

```powershell
cd desktop
npm ci
npm start
```

Lần đầu nhập origin website, ví dụ https://remote.example.internal.
Để thử backend local đang chạy, nhập http://localhost:3000.
Không thêm đường dẫn /api, /login hoặc tham số vào URL.
Đăng nhập và dùng SSH/RDP như giao diện web. Không cần sửa APP_ORIGIN:
desktop mở đúng origin website, API/WebSocket/cookie vẫn cùng origin.

Ứng dụng lưu địa chỉ vào server.json trong thư mục userData của Electron:
Windows: %APPDATA%/VM Access; macOS: ~/Library/Application Support/VM Access.
Menu Máy chủ → Địa chỉ máy chủ để đổi địa chỉ.
Có thể đặt VM_ACCESS_SERVER_URL trước khi chạy để mở một server cụ thể
mà không thay cấu hình đã lưu. Đăng nhập được giữ trong profile riêng của
desktop, không dùng chung cookie Chrome/Edge.

## Build Windows

Thực hiện trên Windows:

```powershell
cd desktop
npm ci
npm test
npm run dist:win
```

Bộ cài x64 .exe nằm trong desktop/release/.
Có thể dùng npm run pack:win để tạo thư mục win-unpacked, mở VM Access.exe.
Không cần Node/npm trên máy người dùng sau khi cài.

## Build macOS

Thực hiện trên Mac:

```bash
cd desktop
npm ci
npm test
npm run dist:mac
```

Tạo .dmg và .zip cho cả x64 (Intel) và arm64 (Apple Silicon) trong release/.
Dùng bản đúng kiến trúc máy. Không thể xác minh bản Mac trên Windows.
Workflow .github/workflows/desktop-build.yml có thể chạy thủ công để build trên
Windows/macOS runners, rồi tải artifacts; workflow không phát hành ra ngoài.

## Chứng thư và phân phối

Website HTTPS phải có chứng thư hợp lệ, CA nội bộ phải được máy người dùng tin cậy.
Ứng dụng không bỏ kiểm tra TLS. Các bản build không có chứng thư ký ứng dụng
là bản unsigned; có thể bị SmartScreen/Gatekeeper cảnh báo/chặn.
Khi phân phối chính thức, cấu hình chứng thư Windows và ký/notarize macOS
bằng tài khoản/chứng thư của đơn vị theo tài liệu electron-builder.
Cấu hình hiện tại win.signAndEditExecutable=false dành cho build nội bộ chưa ký;
bật lại trước khi cấu hình ký Windows.

Renderer mở website không có Node integration hoặc preload; context isolation và
sandbox được bật. Cửa sổ cấu hình local có IPC riêng để lưu origin, website không
được truy cập API đó. Điều hướng ngoài origin và cửa sổ popup bị chặn.

Tài liệu: https://www.electronjs.org/docs/latest/tutorial/security/
https://www.electron.build/multi-platform-build.html
https://www.electron.build/code-signing.html

## Kiểm thử desktop

`npm test` chạy kiểm thử policy URL không cần mở GUI.
Sau khi cài dependency web tại thư mục gốc bằng npm ci, có thể chạy
`npm run test:smoke` trong desktop để kiểm tra ứng dụng Electron với server/profile tạm.
`npm run test:packaged` kiểm tra release/win-unpacked/VM Access.exe sau khi build Windows.
Các test này không kết nối hoặc thay đổi server thật.

Trong môi trường build hiện tại:
- Kiểm thử policy và smoke test Electron từ source đã đạt.
- Bộ cài Windows đã tạo thành công.
- Windows Application Control chặn bản executable đã đóng gói chưa ký.
  Vì vậy chưa xác minh được runtime của bản đóng gói trên máy này.
  Cần ký bằng chứng thư được chính sách máy chấp nhận; không tắt Application Control.
- Chưa build/chạy macOS trên máy Windows này.

Electron: [Security](https://www.electronjs.org/docs/latest/tutorial/security/).
Build/ký macOS: [electron-builder](https://www.electron.build/docs/features/multi-platform-build/).
