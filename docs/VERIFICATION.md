# Kết quả xác minh

Ngày: 03/11/2026, múi giờ Việt Nam.

## Đã chạy

- `npm run build`: TypeScript và bản build Vite thành công.
- `npm test`: 17 bài kiểm thử thành công, 1 bài MySQL integration được skip vì máy hiện tại không có MySQL/Docker. Bao gồm ba bài bổ sung kiểm tra cấu hình TLS/CA, xác minh tên DB, lỗi cấu hình và tính tương thích với bản DB gộp máy.
- `npx playwright test`: 1 kịch bản xuyên suốt thành công trên Chrome, bao gồm đăng nhập thật qua mật khẩu + TOTP, thêm máy, tạo tài khoản, cấp quyền, kết nối qua gateway giả lập, đóng phiên, tải/phát lại bản ghi, xuất CSV và kiểm tra layout mobile. Không có lỗi JavaScript trên trang trong bài thử.
- `npm audit --omit=dev`: không có cảnh báo cho dependency production sau khi cập nhật bản vá tại thời điểm kiểm tra. Kết quả audit không thay thế đánh giá bảo mật toàn hệ thống.
- Xem trực tiếp ảnh desktop/mobile; không phát hiện tràn ngang ở viewport mobile 390px.

## Các tình huống backend được kiểm tra

- Mã hóa AES-GCM ràng buộc theo đối tượng; từ chối sai khóa/AAD.
- Parser giao thức nhận dữ liệu phân mảnh, tiếng Việt, ký tự Unicode và dấu phân cách trong nội dung.
- Từ chối DNS, loopback, metadata và IPv4 ngoài CIDR cho phép.
- Bắt buộc đăng nhập, Origin và CSRF; từ chối cookie hết hạn.
- Đăng nhập cần MFA, không phát cookie sau bước mật khẩu; chống dùng lại challenge/TOTP.
- Thiết lập MFA, cấp mã khôi phục và từ chối mã khôi phục đã dùng.
- Cookie production có Secure/HttpOnly/SameSite và tên `__Host-`.
- Khóa tài khoản sau nhiều lần nhập sai mật khẩu.
- Operator chỉ thấy máy được cấp; quyền hết hạn và auditor không mở được remote.
- API không trả bí mật máy; nhập hàng loạt lỗi được rollback; yêu cầu host key cho SSH.
- Yêu cầu đồng thời không vượt giới hạn phiên; thu hồi quyền vô hiệu hóa vé chờ.
- Bắt buộc đổi mật khẩu được cấp; ngăn tự hạ quyền/tự khóa admin.
- Khôi phục thông tin đăng nhập cần mật khẩu quản trị, hủy phiên và không ghi mật khẩu vào audit.
- Tunnel thật qua WebSocket/TCP với **guacd giả lập**: mật khẩu chỉ được đưa vào handshake phía server, không có trong dữ liệu gửi trình duyệt hoặc bản ghi; từ chối tái sử dụng vé; xử lý ping/input; ngắt và xem lại bản ghi theo quyền.

## Chưa xác minh trong môi trường hiện tại

- Kết nối MySQL 8.4 thực tế. Đã có test opt-in `MYSQL_INTEGRATION=1`, yêu cầu database riêng tên kết thúc `_test`.
- Build/chạy Docker Compose và Nginx thực tế; host hiện tại không có Docker.
- RDP tới Windows và SSH tới Linux của đơn vị; chưa được cung cấp máy thử hoặc thông tin xác thực.
- PKI/chứng thư RDP, host key, định tuyến VLAN, firewall, DNS/VPN, sao lưu và phục hồi trên hạ tầng thật.
- Khả năng chịu tải theo số phiên đồng thời. Mặc định 30 phiên là giới hạn cấu hình ban đầu, không phải cam kết hiệu năng.
- Kiểm toán/pentest độc lập hoặc các yêu cầu tuân thủ chuyên ngành.

Đã bổ sung cấu hình ba máy: web `11.11.11.13`, backend `11.11.11.11`, DB `11.11.11.12`. Các IP này do người dùng cung cấp; không có kết nối, cài đặt, sửa firewall hoặc di chuyển dữ liệu trên những máy đó trong phiên làm việc này. TLS được kiểm tra ở mức cấu hình trong test; handshake MySQL/TLS với chứng thư thật và hiệu lực firewall cần xác minh khi triển khai.

## Ảnh xem giao diện

Ảnh ở `.local/preview-login.png`, `.local/preview-desktop.png`, `.local/preview-mobile.png` và `.local/preview-remote.png`. Tất cả dùng dữ liệu thử. Ảnh remote là hình vẽ do guacd giả lập gửi trong bài kiểm thử; không phải ảnh truy cập vSphere/VM thực.
