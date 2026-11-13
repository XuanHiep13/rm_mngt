# Mô hình bảo mật và giới hạn

## Các vùng tin cậy

Trình duyệt của người dùng được xem là không đáng tin cậy. Mọi kiểm tra quyền nằm ở backend. Việc ẩn nút hoặc ẩn menu không phải cơ chế phân quyền.

Người vận hành máy ảo không có quyền quản trị host của cổng, MySQL, guacd, volume bản ghi hoặc khóa mã hóa. Quản trị viên cổng có quyền cấu hình máy đích; role này phải dành cho nhân sự tin cậy. Người có toàn quyền host có khả năng đọc bộ nhớ, biến môi trường, database và bản ghi nên nằm trong vùng đặc quyền cao nhất.

## Thông tin xác thực

- Cookie phiên chứa token ngẫu nhiên 256 bit; MySQL chỉ lưu SHA-256 của token. Production dùng cookie `__Host-vmportal`, Secure, HttpOnly, SameSite=Strict, Path=/.
- Login bằng mật khẩu chỉ tạo challenge ngắn hạn, chưa tạo phiên đã đăng nhập. TOTP/recovery thành công mới phát cookie.
- TOTP được mã hóa trong database; chỉ chấp nhận mã của chu kỳ 30 giây hiện tại, không chấp nhận chu kỳ liền trước/liền sau, và kiểm tra bước thời gian để chống replay. Điện thoại và server cần đồng bộ thời gian. Mã khôi phục ngẫu nhiên được băm và xóa khi dùng.
- Mật khẩu website dùng scrypt N=131072, r=8, p=1 với salt ngẫu nhiên. Không dùng AES để lưu mật khẩu website.
- Mật khẩu máy đích cần giải mã để kết nối nên dùng AES-256-GCM. AAD gắn bí mật với ID máy, ngăn hoán đổi ciphertext giữa hai máy. Khóa 256 bit chỉ lấy từ môi trường máy chủ.
- API không có chức năng xem/xuất mật khẩu máy đích. Form tạo/cập nhật/import bắt buộc đi HTTPS; mật khẩu mới do quản trị viên nhập vẫn tồn tại trong trình duyệt quản trị tại thời điểm nhập.
- `guacd` không có lớp phân quyền ứng dụng. Không publish cổng 4822. Kết nối tới guacd ở máy khác cần bật TLS đã xác minh và giới hạn firewall; Compose đặt guacd trong cùng mạng container tin cậy.

Với DB tách máy, dùng `compose.backend.yaml`/`compose.web.yaml` và [hướng dẫn triển khai ba máy](SEPARATE-DATABASE.md). Backend bắt buộc TLS tới MySQL, kiểm tra CA và danh tính hostname; lỗi đọc CA hoặc chứng thư không có cơ chế tự hạ xuống kết nối plaintext. MySQL runtime user giới hạn host backend và chỉ SELECT/INSERT cho audit; tài khoản migration tách riêng. IP allowlist cần được áp dụng tại firewall của DB/hạ tầng và kiểm chứng tại mạng thật; biến môi trường ở ứng dụng không thay thế firewall. Web không giữ bí mật DB.

## Truy cập remote

Vé một lần được băm trong database, gắn với user, phiên web, máy và hạn 30 giây. Việc tiêu thụ vé là một UPDATE có điều kiện để chỉ một WebSocket sử dụng được. Cookie và Origin phải hợp lệ; chỉ trình duyệt không có quyền quyết định host, cổng, username hoặc password của phiên.

Chỉ IPv4 thuộc các CIDR được cấu hình mới có thể là đích. Không nhận hostname/DNS hoặc URL; chặn loopback và link-local metadata. Chính sách bổ sung ở firewall vẫn cần thiết vì backend/guacd phải có đường tới mạng máy đích.

Gateway chỉ cho phép một tập lệnh điều khiển cần thiết. Từ chối lệnh handshake từ trình duyệt, clipboard và stream tải tệp. RDP tắt drive, printing, audio, SFTP; SSH tắt SFTP. Người có quyền hệ điều hành vẫn có thể tự chạy công cụ mạng/truyền tệp trên máy đích, nên cài đặt này không ngăn mọi cách đưa dữ liệu ra ngoài.

SSH bắt buộc host key đã nhập thủ công hoặc được người có quyền remote xác nhận qua fingerprint ở lần đầu. Khóa mới không được lưu trước thao tác yes; khóa thay đổi bị chặn, không tự ghi đè. RDP mặc định kiểm tra chứng thư và dùng NLA; tùy chọn `ignoreCert` do quản trị viên chọn phải được cân nhắc theo PKI nội bộ.

## Bản ghi và kiểm toán

Backend mở tệp bản ghi trước khi kết nối máy đích. Không mở được hoặc lỗi ghi sẽ kết thúc phiên. Bản ghi lưu luồng đầu ra Guacamole để phát lại màn hình; không lưu dữ liệu handshake chứa mật khẩu và không ghi keystroke đầu vào.

Bản ghi có thể chứa mật khẩu, token và dữ liệu nhạy cảm mà người dùng chủ động hiển thị trên màn hình. Xem bản ghi là một quyền nhạy cảm và được ghi audit. Việc phát lại tải tệp vào trình duyệt của kiểm toán viên; phiên dài có thể cần nhiều bộ nhớ và thời gian tải.

Log truy cập không phải bộ kiểm toán đầy đủ mọi tiến trình hoặc thay đổi tệp trên máy đích. Root/Admin có thể chạy tác vụ nền, che giấu đầu ra, đổi thông tin xác thực hoặc cài công cụ khác. Các yêu cầu điều tra sâu cần Windows Event Forwarding, auditd/EDR và log ngoài máy, tùy hạ tầng.

Các bảng audit không có API sửa/xóa, nhưng quản trị MySQL/host vẫn có thể thay đổi dữ liệu. Dùng database role giới hạn và xuất log sang hệ thống độc lập nếu cần tính bất biến. Bản này chưa có audit cryptographic signing, SIEM shipping hoặc WORM.

## Điều kiện trước khi sử dụng hạ tầng thật

Chạy thử Windows/Linux đại diện và xác nhận RDP/SSH, chứng thư/host key, layout bàn phím, bản ghi, hành vi khi thu hồi quyền, giới hạn đồng thời và phục hồi backup. Không suy diễn bộ test gateway giả lập thành kết quả kiểm thử trên vSphere thật.

Xác định số người đồng thời, băng thông, độ phân giải, thời gian giữ bản ghi và dung lượng theo số đo thực tế. Mặc định 30 phiên không phải cam kết tải.

Triển khai một gateway; nhiều replica cần thiết kế ownership, registry phiên, điều phối shutdown/recovery và rate limit dùng chung trước khi mở rộng.
