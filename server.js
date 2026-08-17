// file: server.js
const express = require('express');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch'); // Đảm bảo bạn đã cài node-fetch@2

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình Multer để nhận file ảnh lưu tạm vào RAM (buffer)
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // Giới hạn ảnh 10MB

// CẤP QUYỀN SHARED_ARRAY_BUFFER CHO AI PIKAFISH
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// Cho phép truy cập file tĩnh (HTML, CSS, JS)
app.use(express.static(__dirname));

// Route trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ----------------------------------------------------
// API PROXY: NHẬN ẢNH TỪ WEB VÀ BẮN LÊN XIANGQIAI.COM
// ----------------------------------------------------
app.post('/api/pikafish-recognize', upload.single('image'), async (req, res) => {
    console.log('\n📸 Nhận được yêu cầu quét ảnh từ người dùng!');

    try {
        if (!req.file) {
            return res.status(400).json({ code: 400, msg: 'Không tìm thấy file ảnh' });
        }

        console.log(`- Tên file: ${req.file.originalname}`);
        console.log(`- Dung lượng: ${(req.file.size / 1024).toFixed(2)} KB`);

        // Đóng gói ảnh vào FormData để gửi đi
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname || 'board.jpg',
            contentType: req.file.mimetype
        });

        console.log('🚀 Đang gửi ảnh lên server xiangqiai.com...');

        // Gửi ảnh lên API của xiangqiai.com
        const response = await fetch('https://xiangqiai.com/api/board_recognition', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                ...formData.getHeaders()
            },
            body: formData
        });

        // Nếu xiangqiai.com lỗi
        if (!response.ok) {
            console.error(`❌ Server xiangqiai báo lỗi: ${response.status}`);
            return res.status(response.status).json({ code: response.status, msg: 'Lỗi từ server nhận diện' });
        }

        // Nhận kết quả FEN từ xiangqiai.com và trả ngược về cho web của chúng ta
        const result = await response.json();
        console.log('✅ Nhận diện thành công! FEN:', result?.data?.fen);
        
        res.json(result);

    } catch (error) {
        console.error('❌ Lỗi xử lý proxy:', error.message);
        res.status(500).json({ code: 500, msg: 'Lỗi server nội bộ: ' + error.message });
    }
});

// Bật Server
app.listen(port, () => {
    console.log(`\n✅ Máy chủ đã chạy thành công!`);
    console.log(`🎮 Truy cập: http://localhost:${port}\n`);
});