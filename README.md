# VM Access

Cổng truy cập máy ảo Windows/Linux trong trình duyệt, dành cho hạ tầng nội bộ qua VPN. Website và backend dùng chung origin; backend kết nối `guacd` để thực hiện RDP/SSH. Người dùng không được nhận mật khẩu máy đích qua API hoặc WebSocket.

**Cơ sở dữ liệu production: MySQL 8.4 LTS**, InnoDB, UTF-8. MySQL phù hợp với dữ liệu có quan hệ: tài khoản → quyền truy cập → máy ảo → phiên và nhật ký. Không cần thay sang PostgreSQL. Tệp ghi màn hình được lưu trên volume riêng, không đưa vào MySQL.

**Mô hình ba máy theo địa chỉ anh cung cấp:** web `11.11.11.13` → backend `11.11.11.11` → MySQL `11.11.11.12`. Dùng [hướng dẫn DB riêng](docs/SEPARATE-DATABASE.md), `compose.backend.yaml` và `compose.web.yaml`. Chỉ backend được phép tới DB; máy web không giữ thông tin đăng nhập MySQL. Các bước dùng `compose.yaml` bên dưới là phương án gộp máy ban đầu, không dùng cho mô hình ba máy.

## Chức năng có trong source

- Giao diện tiếng Việt, responsive: tổng quan, máy ảo, người dùng, phân quyền, phiên truy cập, kiểm toán và cấu hình.
- Tài khoản local cho website, ba vai trò `admin`, `operator`, `auditor`. Không cần Active Directory.
- MFA TOTP bắt buộc; mã khôi phục dùng một lần; chống dùng lại mã TOTP; khóa đăng nhập theo tài khoản sau nhiều lần sai.
- Mật khẩu website băm bằng scrypt. Mật khẩu máy đích và khóa TOTP mã hóa AES-256-GCM với AAD gắn với từng đối tượng.
- Bắt buộc đổi mật khẩu được cấp; quản trị viên có thể đặt lại mật khẩu/MFA sau khi nhập lại mật khẩu quản trị và ghi lý do.
- Thêm/sửa/khóa máy; nhập JSON tối đa 500 máy/lần; tìm kiếm, lọc Windows/Linux và phân trang.
- Phân quyền theo người/máy, có thời hạn; thu hồi quyền và kết thúc phiên đang chạy.
- Remote desktop RDP và terminal SSH ngay trên web; vé kết nối một lần, có hiệu lực 30 giây và ràng buộc với phiên đăng nhập.
- Kiểm tra quyền tại lúc tạo vé, mở WebSocket và định kỳ trong phiên.
- Ghi đầu ra màn hình/terminal tại backend; chỉ quản trị viên/kiểm toán viên được phát lại. Không ghi phím gõ vào tệp bản ghi.
- Theo dõi phiên, ngắt phiên, log xác thực/cấp quyền/thay đổi cấu hình và xuất CSV.
- Chống CSRF, kiểm tra Origin WebSocket, cookie HttpOnly/SameSite, CSP, giới hạn yêu cầu, giới hạn dải IP đích.
- Docker Compose: MySQL, ứng dụng, guacd, Nginx HTTPS; MySQL và guacd không công khai cổng.

## Những phần cần phân biệt

Đây là cổng truy cập được xây riêng, **không phải bản cài JumpServer**. Source này không cần license JumpServer. Phạm vi hiện tại không gồm tự động xoay mật khẩu trên máy đích, đồng bộ vCenter, quản lý khởi động/tắt máy, xem console khi máy chưa có mạng hoặc triển khai nhiều gateway.

Quyền Administrator/root trên máy đích cho phép người dùng can thiệp hệ điều hành, thay đổi thông tin xác thực và cài thêm công cụ. Cổng giữ kín mật khẩu đang quản lý khi kết nối, nhưng không thể bảo đảm người đã có toàn quyền trên máy không tạo đường truy cập khác. Xem [mô hình bảo mật](docs/SECURITY.md).

## Kiến trúc

```text
Trình duyệt trong VPN
        │ HTTPS :443 + cookie phiên + CSRF
        ▼
      Nginx
        │ HTTP/WebSocket trên mạng container
        ▼
  Node.js / Express ─────────────► MySQL 8.4
        │                         người dùng / máy / quyền / phiên / audit
        ├───────────────────────► Volume /recordings
        │                         đầu ra phiên .guac
        ▼
      guacd ─── RDP :3389 ──────► Windows hoặc Linux có xrdp
        └───── SSH :22 ─────────► Linux
```

Backend thực hiện handshake guacd; mật khẩu chỉ được truyền từ backend tới guacd, không đi qua trình duyệt. Giao thức trình duyệt chỉ chuyển màn hình và sự kiện điều khiển. Backend không cho trình duyệt gửi lệnh `select`/`connect` tùy ý, clipboard, truyền tệp hoặc thay đổi thông tin xác thực.

## Chạy production trên máy chủ nội bộ

Yêu cầu: máy chủ Linux có Docker Engine và Docker Compose v2; IP mà mạng VPN truy cập được; tên miền nội bộ; chứng thư TLS tin cậy; đường mạng từ container guacd tới VLAN máy ảo. Đồng bộ thời gian bằng NTP để TOTP hoạt động đúng.

### 1. Cấu hình

```bash
cp .env.example .env
```

Tạo ba giá trị ngẫu nhiên bằng `npm run keys:generate` nếu máy đã có Node/npm. Có thể dùng `openssl rand -hex 32` để tạo từng giá trị riêng nếu máy chủ chỉ có Docker. Lưu chúng vào `.env`; không dùng chung một giá trị cho nhiều khóa.

Chỉnh tối thiểu:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://remote.example.internal
BIND_IP=10.10.10.50
ENCRYPTION_KEY=<64 ký tự hex ngẫu nhiên>
MYSQL_PASSWORD=<mật khẩu tài khoản database>
MYSQL_ROOT_PASSWORD=<mật khẩu root database khác biệt>
ALLOWED_TARGET_CIDRS=10.20.0.0/16,10.30.0.0/16
MAX_REMOTE_SESSIONS=30
```

`APP_ORIGIN` phải trùng chính xác địa chỉ người dùng mở, không có dấu `/` cuối. `BIND_IP` là địa chỉ thực trên máy chủ triển khai; mặc định `127.0.0.1` để tránh mở ra ngoài trước khi cấu hình. Giới hạn 30 phiên chỉ là mặc định ban đầu, chưa phải kết quả đo tải hay cấu hình phù hợp mọi hạ tầng.

```bash
mkdir -p deploy/tls
chmod 600 .env
```

Đặt chứng thư và khóa TLS vào `deploy/tls/fullchain.pem`, `deploy/tls/privkey.pem`. Giới hạn quyền đọc khóa phù hợp với Nginx. Hai tệp này và `.env` đã được loại khỏi Git/Docker build context.

### 2. Build và khởi động

```bash
docker compose up -d --build
docker compose logs migrate
docker compose ps
```

Service `migrate` tạo schema trước khi ứng dụng chạy. Migration có thể chạy lại với schema của bản này; không xóa dữ liệu. Container ứng dụng chạy bằng user không đặc quyền, root filesystem chỉ đọc, bản ghi nằm trên volume ghi được.

### 3. Tạo quản trị viên đầu tiên

```bash
docker compose exec app npm run admin:create
```

Nhập tên đăng nhập, họ tên và mật khẩu tối thiểu 14 ký tự; mật khẩu không hiển thị trên terminal. Không có tài khoản/mật khẩu mặc định. Lần đầu đăng nhập, quản trị viên phải thiết lập MFA, lưu mã khôi phục và đổi mật khẩu.

Nếu mất toàn bộ tài khoản quản trị, người có quyền quản lý host/container có thể chạy lại lệnh trên để tạo tài khoản khẩn cấp khác. Thao tác được lưu vào audit. Quyền host/container vì vậy phải được kiểm soát riêng.

### 4. Thêm máy và người dùng

1. Đăng nhập cổng bằng địa chỉ `APP_ORIGIN`.
2. Thêm máy Windows với RDP đã bật và tài khoản local có quyền đăng nhập RDP. Để xác minh chứng thư khi kết nối bằng IPv4, chứng thư cần có IP SAN khớp IP máy; CA nội bộ phải được cài vào trust store của image guacd. Tùy chọn chấp nhận chứng thư tự ký bỏ kiểm tra chứng thư máy đích.
3. Thêm Linux với SSH. Có thể nhập dòng `known_hosts` đã xác minh, hoặc để trống để xác nhận fingerprint bằng `yes` lần đầu kết nối. Khóa được lưu lại, khóa thay đổi sẽ bị chặn. Backend cần `ssh-keyscan` trong PATH (Docker image đã có).
4. Tạo người dùng vai trò **Vận hành**, chuyển mật khẩu tạm qua kênh nội bộ phù hợp. Họ bắt buộc thiết lập MFA và đổi mật khẩu.
5. Cấp máy và thời hạn ở mục **Phân quyền**. Người dùng chỉ thấy máy được cấp. Quản trị viên được truy cập tất cả máy; kiểm toán viên xem dữ liệu kiểm toán nhưng không mở phiên remote.
6. Kiểm tra Windows/Linux đại diện trước khi nhập toàn bộ hơn 300 máy.

Ngắt kết nối gateway không đồng nghĩa đăng xuất phiên Windows, chấm dứt mọi tiến trình nền trên Linux hoặc hoàn tác thao tác đã thực hiện.

## Nhập danh sách máy hàng loạt

Trong mục **Máy ảo → Nhập hàng loạt**, chọn tệp JSON UTF-8. Tối đa 500 máy và 2 MB mỗi lần. Mỗi phần tử tạo một máy mới; không cập nhật máy cũ theo tên. Backend kiểm tra toàn bộ và rollback nếu có lỗi.

```json
[
  {
    "name": "WEB-PROD-01",
    "host": "10.20.1.10",
    "port": 3389,
    "protocol": "rdp",
    "os": "windows",
    "groupName": "Production",
    "description": "Ứng dụng nội bộ",
    "username": "vm-operator",
    "password": "<mật khẩu thực tế>",
    "domain": "",
    "ignoreCert": false,
    "enabled": true
  }
]
```

Đối với SSH dùng `protocol: "ssh"`, `os: "linux"`, `port: 22` và tùy chọn `hostKey` chứa dòng `known_hosts`; bỏ trống để xác nhận fingerprint lần đầu. Mật khẩu plaintext trong tệp nhập cần được bảo vệ và xử lý theo quy trình của đơn vị; không đưa tệp thật vào Git. API danh sách và chỉnh sửa không trả mật khẩu cũ về trình duyệt.

## Phát triển và xem giao diện

Node.js 22 LTS trở lên; khuyến nghị dùng Node 22 cho cùng môi trường Docker.

```bash
npm ci
npm run build
npm test
```

Để phát triển với MySQL, tạo database trước, chỉnh `.env` về `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, `MYSQL_HOST=127.0.0.1`, các giá trị kết nối thật và `RECORDING_DIR` vào thư mục ghi được. Chạy:

```bash
npm run db:migrate
npm run admin:create
npm run dev
```

MySQL trong Compose không publish cổng. Nếu phát triển với DB này, cần cấu hình một override chỉ bind MySQL vào localhost hoặc chạy ứng dụng trong container.

Có thể xem giao diện độc lập với hạ tầng thật:

```bash
NODE_ENV=development npm run preview:local
```

Chế độ này chỉ bind `127.0.0.1:3000`, dùng SQLite trong RAM, tự sinh tài khoản/mật khẩu/khóa MFA tạm và in trên terminal. Có sáu máy mẫu dùng IP tài liệu `192.0.2.0/24`; chính sách mạng chặn remote tới các máy mẫu. Dữ liệu biến mất khi dừng. **Đây là tiện ích xem thử, không phải database dự phòng hay chế độ production.**

Kiểm tra giao diện tự động:

```bash
npx playwright test
```

Trên macOS dùng Chrome có sẵn. Trên Linux cài browser bằng công cụ Playwright theo chính sách môi trường. Ảnh kiểm tra được lưu tại `.local/preview-*.png`; không chứa hạ tầng thực.

## Kiểm thử MySQL thật

Bộ API/gateway mặc định dùng adapter SQLite trong RAM để kiểm tra nhanh. Nó không chứng minh MySQL, Docker hay RDP/SSH tới VM thật đã hoạt động.

Cấu hình các biến MySQL tới một database **riêng có tên kết thúc `_test`**, sau đó:

```bash
MYSQL_INTEGRATION=1 npm test
```

Test MySQL kiểm tra tạo schema, bind tham số, unique constraint và rollback. Không chạy vào database production. Xem [kết quả xác minh](docs/VERIFICATION.md) cho phạm vi đã thực sự chạy trong môi trường bàn giao.

## Vận hành

- Chỉ mở HTTPS từ mạng nội bộ/VPN tới proxy. Chặn RDP/SSH trực tiếp từ dải VPN của người dùng tới máy đích; chỉ gateway và kênh quản trị được chỉ định được phép vào.
- Kiểm soát truy cập quản trị giữa các máy ảo; nếu không, người có root/Admin có thể đi vòng qua cổng bằng máy đã được cấp.
- Chạy **một** instance ứng dụng/gateway. Không tăng replica; registry phiên và cơ chế phục hồi hiện tại thuộc một gateway.
- Backend chủ động ngắt khi thu hồi quyền, sửa máy, khóa/sửa người dùng, đổi mật khẩu hoặc logout. Kiểm tra định kỳ 15 giây xử lý hết hạn/quyền thay đổi ngoài API. Phiên không có chuột/phím trong 30 phút bị ngắt.
- Restart gateway đánh dấu các phiên cũ là gián đoạn; bản ghi của phiên đang chạy lúc crash có thể chưa hoàn tất/chưa hiển thị.
- Sao lưu MySQL, volume `recordings`, `ENCRYPTION_KEY` và cấu hình. Mất khóa mã hóa thì không giải mã được thông tin máy đích/MFA. Lưu khóa riêng với backup database; không tự ý thay khóa trên database đang có dữ liệu.
- Bản ghi chứa nội dung màn hình/terminal và có thể chứa dữ liệu nhạy cảm. Chỉ cấp quyền xem cho người có nhiệm vụ. Thời gian lưu và dung lượng cần được xác định khi đo tải; bản này không tự xóa bản ghi hoặc audit.
- Audit trên database không bất biến trước người có toàn quyền MySQL/host. Nếu cần chống sửa/xóa độc lập, chuyển log sang SIEM/kho lưu trữ có quyền riêng hoặc WORM.
- Mật khẩu máy đích được cập nhật thủ công: đổi trên máy, sau đó cập nhật cấu hình cổng. Mọi lần sửa máy đều kết thúc các phiên đang dùng máy đó.
- `/healthz` kiểm tra tiến trình; `/readyz` kiểm tra kết nối MySQL. Nginx không công khai hai endpoint này. Khả năng kết nối guacd/VM được xác định khi mở phiên; trạng thái “được phép kết nối” không phải health check máy đích.

## Cấu trúc source

```text
client/                  React, giao diện, remote và trình phát bản ghi
server/auth.ts           Đăng nhập, TOTP, recovery, cookie và đổi mật khẩu
server/routes.ts         Máy, người dùng, quyền, phiên, audit và bản ghi
server/gateway.ts        Vé một lần, WebSocket, handshake guacd và ghi phiên
server/protocol.ts       Bộ mã hóa/giải mã giao thức Guacamole
server/crypto.ts         Băm mật khẩu và mã hóa bí mật
server/db.ts             Adapter MySQL production
server/schema.ts         Schema và indexes
scripts/                 Migration, bootstrap admin, sinh khóa và preview
deploy/                  Nginx nội bộ / HTTPS
tests/                   API, gateway, MySQL và browser
```

Tài liệu kỹ thuật tham khảo: [MySQL 8.4](https://dev.mysql.com/doc/refman/8.4/en/), [giao thức Guacamole](https://guacamole.apache.org/doc/gug/guacamole-protocol.html), [cấu hình RDP/SSH](https://guacamole.apache.org/doc/gug/configuring-guacamole.html).
