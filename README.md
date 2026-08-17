# Sơn 9.3 (Xiangqi Web App) ♟️

Chào mừng bạn đến với mã nguồn dự án **Sơn 9.3** - Ứng dụng chơi và phân tích Cờ Tướng trực tuyến/ngoại tuyến tích hợp trí tuệ nhân tạo (Pikafish WebAssembly).

Dự án này được thiết kế theo chuẩn PWA (Progressive Web App), hỗ trợ Đa luồng (Multi-threading), Khai cuộc đám mây (Cloud Book), Khai cuộc nội bộ (.obk, .xqb), Nhận diện hình ảnh bằng AI và các chế độ giải bài tập, luyện nhớ ván đấu.

---

## ⚙️ Yêu cầu hệ thống (Prerequisites)

Do dự án có sử dụng tệp bỏ qua `.gitignore` để không đưa thư mục `node_modules` (chứa các thư viện của Node.js) lên GitHub nhằm giảm dung lượng, nên sau khi tải mã nguồn về, **bạn bắt buộc phải cài đặt Node.js** để phục hồi các thư viện này và khởi chạy máy chủ (Server).

### Tại sao cần máy chủ Node.js cục bộ?
1. Ứng dụng sử dụng **SharedArrayBuffer** để chạy AI Pikafish Đa luồng. Trình duyệt bắt buộc cấu hình Header bảo mật chéo (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`) thông qua Server mới cho phép tính năng này hoạt động.
2. Xử lý Proxy (Tải ảnh từ giao diện, nén ảnh và gửi lên API nhận diện hình ảnh).

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

Bạn có thể clone dự án bằng Git hoặc tải file `.zip` từ GitHub và giải nén.
```bash
Bước 1: Tải dự án về máy
git clone https://github.com/SuperEasyGame/TuongKyViet.git
Bước 2: Cài đặt Node.js
Nếu máy tính của bạn chưa có Node.js, hãy làm theo các bước sau:
Truy cập trang chủ: https://nodejs.org/
Tải và cài đặt phiên bản LTS (Long Term Support) (Khuyên dùng).
Sau khi cài đặt xong, mở Command Prompt (cmd) hoặc Terminal và gõ lệnh sau để kiểm tra xem đã cài thành công chưa:
code
Bash
node -v
npm -v
(Nếu màn hình in ra phiên bản dạng v18.x.x hoặc v20.x.x là thành công).
Bước 3: Cài đặt các thư viện phụ thuộc (Dependencies)
Mở Terminal/Command Prompt, di chuyển đường dẫn (cd) vào thư mục mã nguồn dự án mà bạn vừa tải về, sau đó chạy lệnh sau:
code
Bash
npm install
Lệnh này sẽ tự động đọc file package.json và tải về thư mục node_modules cùng các thư viện cần thiết (như express, multer, cors, form-data, v.v.).
Bước 4: Khởi chạy Máy chủ (Run the Server)
Vẫn tại thư mục dự án, chạy lệnh:
code
Bash
npm start
Hoặc bạn cũng có thể chạy bằng lệnh node server.js.
Nếu Terminal hiển thị dòng chữ:
code
Text
✅ Máy chủ đã chạy thành công!
🎮 Truy cập: http://localhost:3000
Tức là dự án đã hoạt động!
Bước 5: Trải nghiệm ứng dụng
Mở trình duyệt web (Chrome, Edge, Cốc Cốc, Safari...) và truy cập vào địa chỉ:
👉 http://localhost:3000
📂 Cấu trúc thư mục chính
index.html: Giao diện chính của ứng dụng.
server.js: Mã nguồn máy chủ Node.js (Xử lý cấu hình Header và API).
js/: Thư mục chứa toàn bộ logic xử lý của ứng dụng (Game, UI, Engine, Database, Editor...).
engines/: Thư mục chứa các bản build của Engine AI Pikafish (WASM).
data/: Dữ liệu bài tập cờ tàn, sát pháp, khai cuộc dạng .json.
sql/: Thư viện sql.js dùng để đọc các file Local Book (.obk, .xqb, .pfbook) ngay trên trình duyệt.
style/: Chứa CSS và hình ảnh quân cờ / bàn cờ.
📝 Giấy phép (License)
Dự án được cung cấp dưới dạng mã nguồn mở. Vui lòng tham khảo các thư viện mã nguồn mở (Pikafish, Vschess, Sql.js...) bên trong dự án để biết thêm chi tiết về bản quyền của bên thứ ba.
Pikafish: https://github.com/official-pikafish/Pikafish
Vschess: https://github.com/FastLight126/vschess
Sql.js: https://cdnjs.com/libraries/sql.js
