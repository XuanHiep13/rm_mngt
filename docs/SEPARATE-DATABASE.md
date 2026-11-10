# Triển khai ba máy: Web, Backend và MySQL

Địa chỉ do người quản trị cung cấp:

| Máy     | IP            | Dịch vụ                                                    |
| ------- | ------------- | ---------------------------------------------------------- |
| Web     | `11.11.11.13` | Nginx HTTPS, chuyển tiếp website/API/WebSocket tới backend |
| Backend | `11.11.11.11` | Node.js, gateway guacd, lưu bản ghi phiên                  |
| DB      | `11.11.11.12` | MySQL 8.4, database `vmportal`                             |

```text
Người dùng trong VPN
       │ HTTPS 443
       ▼
Web 11.11.11.13 (không giữ mật khẩu DB)
       │ HTTP/WebSocket 3000, mạng máy chủ được kiểm soát
       ▼
Backend 11.11.11.11 ─── RDP/SSH ──► Các VM được cấp quyền
       │ MySQL 3306 + TLS xác minh CA/tên máy
       ▼
DB 11.11.11.12
```

Trong source hiện tại, Node.js cung cấp cả API và các tệp React đã build; máy web là điểm HTTPS phía trước và chuyển tiếp chúng. Trình duyệt luôn làm việc với origin của máy web. Chỉ backend có tài khoản DB; web và máy người dùng không truy cập MySQL trực tiếp.

## Database đang ở đâu?

Database là nơi lưu tài khoản website, mật khẩu đã băm, máy ảo, mật khẩu máy đích đã mã hóa, quyền truy cập, phiên và nhật ký. Tên database là `vmportal` theo `MYSQL_DATABASE`.

`compose.yaml` cũ chạy MySQL trong container cùng host, volume `mysql-data` mount vào `/var/lib/mysql` của container. Volume thực thường tên `vm-access_mysql-data`, kiểm tra bằng `docker volume inspect vm-access_mysql-data`; Docker Desktop lưu volume trong VM Docker. Đây là cấu hình, không chứng minh database đã được tạo/chạy. Bản `preview:local` chỉ có SQLite trong RAM.

Với cấu hình ba máy, dữ liệu MySQL ở đĩa của máy DB `11.11.11.12`. Dùng tài khoản DBA tại máy DB để kiểm tra vị trí thật:

```sql
SELECT @@hostname, @@datadir;
SHOW DATABASES LIKE 'vmportal';
```

Tệp bản ghi `.guac` vẫn ở volume `recordings` trên backend `.11`. `.env` chỉ chứa thông số kết nối, không phải tệp database.

## 1. Quy tắc mạng

Áp dụng ở firewall/router hoặc firewall phân tán của hạ tầng, và kiểm tra bằng kết nối mới từ từng nguồn:

| Nguồn                                       | Đích                 | Cổng TCP                        | Quyền    |
| ------------------------------------------- | -------------------- | ------------------------------- | -------- |
| Dải VPN của người dùng                      | `11.11.11.13`        | 443                             | Cho phép |
| `11.11.11.13`                               | `11.11.11.11`        | 3000                            | Cho phép |
| Các máy khác                                | `11.11.11.11`        | 3000                            | Chặn     |
| `11.11.11.11`                               | `11.11.11.12`        | 3306                            | Cho phép |
| `11.11.11.13`, người dùng và các nguồn khác | `11.11.11.12`        | 3306                            | Chặn     |
| Backend `.11`                               | Các VM được chỉ định | 22 / 3389 hoặc cổng đã cấu hình | Cho phép |

Máy DB trong hướng dẫn này chạy MySQL trực tiếp trên Linux, không publish MySQL qua Docker. Nếu DB là Ubuntu/Debian đã bật UFW, có thể đặt hai rule vào đầu danh sách để không bị rule allow rộng trước đó che mất:

```bash
sudo ufw insert 1 allow proto tcp from 11.11.11.11 to 11.11.11.12 port 3306
sudo ufw insert 2 deny proto tcp from any to 11.11.11.12 port 3306
sudo ufw status numbered
```

Đây là lệnh chạy trên **máy DB**. Chúng không tự bật UFW. Nếu UFW chưa hoạt động hoặc dùng firewalld/nftables, áp dụng chính sách tương đương trong firewall đang sử dụng; giữ đường quản trị SSH của đơn vị. Không tự chạy các lệnh UFW này trên backend Docker để suy ra cổng container đã bị chặn: Docker publish port có thể đi vòng qua UFW. Với backend cần ACL mạng phù hợp hoặc policy Docker `DOCKER-USER`/nftables tương ứng phiên bản thực tế.

Docker bridge trên Linux thường SNAT kết nối ra IP của host. Tuy nhiên, nếu host nhiều NIC hoặc có NAT/router phía trước, DB có thể thấy IP nguồn khác. Xác minh đường đi thực tế; không đổi tài khoản thành `'%'` để bỏ qua lỗi. Cả hai IP anh cung cấp phải có định tuyến thực giữa các máy. Không có firewall nào được áp dụng tự động từ source này.

HTTP giữa web và backend cần nằm trong mạng máy chủ được kiểm soát theo các rule trên. Nếu mạng này chưa có tính tin cậy phù hợp, cấu hình thêm TLS/mTLS giữa web/backend trước khi sử dụng.

## 2. Máy DB `11.11.11.12`

Cài MySQL 8.4 cho bản phân phối Linux của máy DB. Tệp mẫu [mysql-external.cnf.example](../deploy/mysql-external.cnf.example) chỉ định:

```ini
[mysqld]
bind-address=11.11.11.12
port=3306
skip-name-resolve=ON
require_secure_transport=ON
ssl_ca=/etc/mysql/tls/ca.pem
ssl_cert=/etc/mysql/tls/server-cert.pem
ssl_key=/etc/mysql/tls/server-key.pem
mysqlx=OFF
```

`bind-address` là IP **máy DB lắng nghe**, không phải danh sách IP client được phép. Giới hạn client bằng firewall và `user@host` của MySQL.

Đặt cấu hình trong thư mục include MySQL của distro, ví dụ `/etc/mysql/conf.d/` hoặc `/etc/my.cnf.d/`, xác nhận nó được MySQL đọc. Cấp chứng thư server có **DNS SAN `db.vmportal.internal`**, cài ba tệp PEM đúng đường dẫn trên và quyền đọc phù hợp cho service MySQL. Sao chép riêng **CA công khai** `ca.pem` sang backend; không sao chép private key server sang backend/web. Sau khi xác nhận cấu hình, restart service MySQL phù hợp distro.

Tại máy DB, dùng tài khoản quản trị local qua Unix socket:

1. Chuẩn bị bản riêng của [mysql-external-users.sql.example](../deploy/mysql-external-users.sql.example), thay hai placeholder mật khẩu bằng hai mật khẩu mạnh khác nhau; giữ tài khoản giới hạn host `11.11.11.11`.
2. Chạy tệp đó trên máy DB. Nó tạo database và hai user: `vmportal_migrator` để tạo bảng; `vmportal_app` để backend sử dụng sau khi cấp quyền bước 4.
3. Chưa chạy tệp runtime grants vì các bảng chưa tồn tại. Chuyển sang tạo schema ở backend.

Không dùng tài khoản MySQL root cho ứng dụng. Máy web `.13` không có user DB. `CREATE USER`/`GRANT` không cần `FLUSH PRIVILEGES`.

## 3. Máy backend `11.11.11.11`: tạo schema

Đặt source dự án trên máy backend có Docker Engine và Compose v2. Không dùng `compose.yaml` mặc định cho mô hình này.

Tạo các tệp cấu hình **nếu chưa có**:

```bash
cp -n .env.backend.example .env
cp -n .env.migrate.example .env.migrate
mkdir -p deploy/db-ca
chmod 600 .env .env.migrate
```

Sao chép CA vào `deploy/db-ca/ca.pem`. Mẫu đã chứa địa chỉ thật:

```dotenv
APP_ORIGIN=https://11.11.11.13
BACKEND_BIND_IP=11.11.11.11
MYSQL_HOST=db.vmportal.internal
MYSQL_SERVER_IP=11.11.11.12
MYSQL_DATABASE=vmportal
MYSQL_USER=vmportal_app
MYSQL_PASSWORD=<mật khẩu app đã đặt tại DB>
MYSQL_TLS=true
MYSQL_SSL_CA=/etc/vmportal/db-ca/ca.pem
ENCRYPTION_KEY=<khóa 32 byte dạng 64 ký tự hex>
```

Điền `.env.migrate` với user `vmportal_migrator` và mật khẩu migrator đã đặt tại DB. Mật khẩu migrator chỉ vào container migration; không truyền vào container ứng dụng. `MYSQL_HOST` là alias DNS được Compose ánh xạ đến `MYSQL_SERVER_IP` trong các container để TLS kiểm tra tên server. Không tắt xác minh TLS khi chứng thư sai/hết hạn hoặc hostname không khớp.

Tạo khóa mới bằng `openssl rand -hex 32` chỉ với **cài đặt mới**. Nếu chuyển dữ liệu từ bản cũ, giữ nguyên `ENCRYPTION_KEY` tương ứng database cũ. Chỉnh `ALLOWED_TARGET_CIDRS` theo VLAN chứa VM thực, không theo IP các máy web/backend/DB.

Nếu dùng tên miền web thay vì IP `.13`, đổi `APP_ORIGIN` sang tên miền đó và dùng chứng thư web tương ứng. Giá trị hiện tại `https://11.11.11.13` yêu cầu chứng thư HTTPS có IP SAN `.13` và được máy người dùng tin cậy.

Tạo schema từ backend:

```bash
docker compose -f compose.backend.yaml build
docker compose -f compose.backend.yaml run --rm --no-deps migrate
```

Đọc thông báo `MySQL schema is ready.`. Nếu bị `Access denied ... @...`, kiểm tra user/password, host nguồn thực tế và TLS; không mở quyền cho mọi IP.

## 4. Máy DB: cấp quyền runtime

Sau khi migration tạo bảng, DBA chạy [mysql-runtime-grants.sql.example](../deploy/mysql-runtime-grants.sql.example) trên DB `.12`.

User `vmportal_app@11.11.11.11` có SELECT/INSERT/UPDATE/DELETE trên các bảng vận hành; riêng `audit_events` chỉ SELECT/INSERT. Không cấp quyền tạo/xóa bảng, quyền toàn server, GRANT OPTION hoặc remote root. User migrator chỉ có CREATE/INDEX/SELECT/INSERT trong database `vmportal` phục vụ schema hiện tại; không phải user dùng lúc vận hành.

## 5. Máy backend: khởi động ứng dụng

```bash
docker compose -f compose.backend.yaml up -d
docker compose -f compose.backend.yaml ps
docker compose -f compose.backend.yaml logs --tail=100 migrate app
docker compose -f compose.backend.yaml exec app npm run admin:create
```

Service migrate có thể chạy lại khi `up`; nó dùng schema hiện tại có thể chạy lại và không xóa dữ liệu. Healthcheck app xác nhận DB có thể query trước khi xem là sẵn sàng. Giữ `.env.migrate` ở máy backend với quyền chặt; không đưa nó hoặc `.env` sang máy web.

## 6. Máy web `11.11.11.13`

Máy web chỉ cần Docker/Compose và các tệp sau từ source:

- `compose.web.yaml`
- `.env.web.example`, sao chép thành `.env.web`
- `deploy/nginx.web.conf.template`
- Hai tệp HTTPS `deploy/tls/fullchain.pem` và `deploy/tls/privkey.pem`.

Không sao chép `.env`, `.env.migrate`, khóa mã hóa backend, mật khẩu MySQL hoặc private key DB sang web.

```bash
cp -n .env.web.example .env.web
chmod 600 .env.web
docker compose --env-file .env.web -f compose.web.yaml up -d
docker compose --env-file .env.web -f compose.web.yaml logs --tail=100 proxy
```

Nginx chuyển tiếp tới `.11:3000` và giữ đúng WebSocket/Origin. Log bỏ query chứa vé kết nối. Không dùng `deploy/nginx.conf` của bản gộp máy cho mô hình ba máy.

Người dùng mở `https://11.11.11.13` hoặc tên miền đã cấu hình. Không truy cập API/backend trực tiếp bằng `.11` trên trình duyệt.

## 7. Kiểm tra kết quả trên hạ tầng thật

- Từ backend `.11`: đăng nhập MySQL bằng app user qua TLS được chấp nhận. Có thể chạy client MySQL với `--ssl-mode=VERIFY_IDENTITY --ssl-ca=... -h db.vmportal.internal -u vmportal_app -p vmportal` nếu host cũng đã cấu hình DNS/hosts tương ứng.
- Trong phiên MySQL: `SHOW SESSION STATUS LIKE 'Ssl_cipher';` phải có cipher; `SELECT CURRENT_USER();` phải là `vmportal_app@11.11.11.11`.
- Từ web `.13` và máy khác: một kết nối TCP mới tới `.12:3306` phải bị firewall từ chối/hết thời gian, kể cả khi biết username/password.
- Kiểm tra backend chỉ nhận HTTP/WebSocket 3000 từ `.13` qua lớp ACL/firewall có hiệu lực với Docker.
- Đăng nhập website, tạo/cấp quyền máy, kết nối VM và xem log; xác nhận dữ liệu trong `vmportal` trên `.12`.
- Kiểm tra `SHOW GRANTS FOR 'vmportal_app'@'11.11.11.11';`, tài khoản khác có host `%`/quyền rộng và chính sách mạng hiện có theo quy trình DBA của đơn vị.

Nếu database cũ đã có dữ liệu, thay đổi địa chỉ kết nối **không tự di chuyển dữ liệu**. Sao lưu/restore MySQL và giữ khóa mã hóa trước khi chuyển; tệp ghi phiên ở backend cần được sao lưu riêng. Hướng dẫn này không chạy firewall, cấp tài khoản, di chuyển database hoặc cài dịch vụ lên ba IP một cách tự động.

## Tài liệu chính thức

- [MySQL user@host](https://dev.mysql.com/doc/refman/8.4/en/account-names.html)
- [MySQL bind_address](https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_bind_address)
- [MySQL encrypted connections](https://dev.mysql.com/doc/refman/8.4/en/using-encrypted-connections.html)
- [mysql2 SSL](https://sidorares.github.io/node-mysql2/docs/documentation/ssl)
- [Docker và firewall/UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [Ubuntu UFW](https://ubuntu.com/server/docs/how-to/security/firewalls/)
