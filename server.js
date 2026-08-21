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

// Route health check cho Render
app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

// Cho phép truy cập file tĩnh (HTML, CSS, JS)
app.use(express.static(__dirname));

// Route trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Cho phép đọc JSON body
app.use(express.json({ limit: '2mb' }));

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

// ----------------------------------------------------
// KEY POOL & GEMINI API CALL LOGIC
// ----------------------------------------------------
function pickRandomKey(keys, failedKeys = new Set()) {
    const available = keys.filter(k => k && typeof k === 'string' && k.trim().length > 0 && !failedKeys.has(k.trim()));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)].trim();
}

function buildChessAnnotationPrompt(movesData, gameInfo) {
    const info = gameInfo || {};
    const totalMoves = movesData.length;

    let movesBlock = 'DANH SÁCH TẤT CẢ CÁC NƯỚC ĐI VÀ CÁC BIẾN TRONG KỲ PHỔ (kèm đánh giá engine Pikafish Cấp 10):\n\n';
    movesData.forEach((m) => {
        const moveId = m.i || m.index;
        const flag = m.moveFlag === 'weak' ? '🔴 PHẾ CỜ / SAI LẦM NẶNG' :
                     m.moveFlag === 'inaccuracy' ? '🟠 SƠ HỞ / NƯỚC YẾU' :
                     m.moveFlag === 'strong' ? '🟢 NƯỚC CHUẨN / NƯỚC HAY' : '⚪ Bình thường';
        const bestInfo = m.bestMove ? ` | Nước chuẩn gợi ý: ${m.bestMove}` : '';
        const dropInfo = (m.drop !== null && m.drop !== undefined) ? ` | Tụt điểm: ${Number(m.drop).toFixed(2)}` : '';
        const evalStr = (m.evalScore !== undefined && m.evalScore !== null) ? `${m.evalScore >= 0 ? '+' : ''}${Number(m.evalScore).toFixed(2)}` : 'N/A';
        const branchStr = m.branch ? `[${m.branch}]` : '[Nhánh chính]';

        movesBlock += `ID ${moveId} ${branchStr}: ${m.notation || m.move} | Bên: ${m.side} | Hiệp ${m.round || 1} | Eval: ${evalStr}${bestInfo}${dropInfo} | Đánh giá: ${flag}\n`;
    });

    return `Bạn là một Huấn luyện viên Cờ Tướng (Xiangqi) chuyên nghiệp đẳng cấp Quốc Tế Đại Sư (Grandmaster).
Nhiệm vụ của bạn là phân tích sâu toàn bộ ván cờ / cây kỳ phổ dưới đây (bao gồm cả NHÁNH CHÍNH và TẤT CẢ CÁC NHÁNH BIẾN PHỤ TRONG CBL) dựa trên dữ liệu đánh giá chính xác của AI Engine Pikafish Cấp 10 (Max depth) và viết GHI CHÚ TIẾNG VIỆT súc tích, sâu sắc, chuẩn chuyên môn cờ tướng cho TỪNG NƯỚC ĐI.

THÔNG TIN KỲ PHỔ / VÁN ĐẤU:
- Bên Đỏ: ${info.red || info.redname || 'Đỏ'}
- Bên Đen: ${info.black || info.blackname || 'Đen'}
- Khai cuộc / Tiêu đề: ${info.open || info.title || 'Kỳ phổ Cờ Tướng'}
- Kết quả: ${info.result || '*'}

${movesBlock}

NGUYÊN TẮC PHÂN TÍCH & VIẾT GHI CHÚ:
1. Giải thích ý đồ chiến thuật, thế công thủ, ưu thế hoặc điểm yếu của nước cờ vừa đi.
2. Với các NHÁNH BIẾN PHỤ: Nêu rõ ý nghĩa của biến (tranh tiên, tấn công cánh hay củng cố trung lộ) và so sánh ngắn gọn tính hiệu quả so với biến chính.
3. Với nước có cờ 🔴 PHẾ CỜ / SAI LẦM hoặc 🟠 SƠ HỞ: Chỉ rõ sai sót ở đâu, đối phương khai thác thế nào, và tại sao nước chuẩn (gợi ý) lại tối ưu hơn.
4. Với nước có cờ 🟢 NƯỚC HAY / NƯỚC CHUẨN: Khen ngợi và giải thích tầm nhìn chiến lược (kiểm soát cột lộ, tạo đòn phối hợp, tranh tiên...).
5. Phong cách viết: Ngôn ngữ tiếng Việt chuyên nghiệp cờ tướng, tự nhiên, gãy gọn (mỗi nước 1-3 câu), không lan man sáo rỗng.
6. Tuân thủ 100% dữ liệu engine cung cấp, không bịa đặt thế cờ trái ngược điểm đánh giá.

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT 1 JSON ARRAY các object: [{"i": <ID nước tương ứng từ 1..${totalMoves}>, "c": "<nội dung ghi chú tiếng Việt>"}]
Phải đủ đúng ${totalMoves} phần tử cho tất cả các ID từ 1 đến ${totalMoves}.
TUYỆT ĐỐI KHÔNG thêm chữ giải thích, markdown bên ngoài array.`;
}

// ----------------------------------------------------
// API PROXY: GEMINI ANNOTATE VỚI MULTI-KEY ROTATION & RETRY
// ----------------------------------------------------
app.post('/api/gemini-annotate', async (req, res) => {
    console.log('\n🤖 Nhận yêu cầu sinh ghi chú AI từ người dùng...');
    const { keys, model, movesData, gameInfo } = req.body;

    if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ error: 'Chưa cấu hình API Key Gemini! Hãy vào Cài đặt để thêm key.' });
    }

    const validKeys = keys.filter(k => k && typeof k === 'string' && k.trim().length > 0);
    if (validKeys.length === 0) {
        return res.status(400).json({ error: 'Danh sách API Key không hợp lệ hoặc đang trống.' });
    }

    if (!movesData || !Array.isArray(movesData) || movesData.length === 0) {
        return res.status(400).json({ error: 'Không có dữ liệu nước đi để phân tích.' });
    }

    const selectedModel = model || 'gemini-2.5-flash';
    console.log(`- Model được chọn: ${selectedModel}`);
    console.log(`- Tổng số nước đi: ${movesData.length}`);
    console.log(`- Số lượng API Key khả dụng: ${validKeys.length}`);

    const prompt = buildChessAnnotationPrompt(movesData, gameInfo);
    const RETRY_DELAYS = [0, 2000, 5000, 10000];
    const failedKeys = new Set();

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        if (RETRY_DELAYS[attempt] > 0) {
            console.log(`⏳ Chờ ${(RETRY_DELAYS[attempt] / 1000)}s rồi thử lại lần ${attempt + 1}...`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }

        const apiKey = pickRandomKey(validKeys, failedKeys);
        if (!apiKey) {
            console.error('❌ Tất cả các API Key trong danh sách đều đã bị lỗi/quá tải!');
            return res.status(429).json({
                error: `Tất cả ${validKeys.length} API Key đều bị lỗi hoặc vượt hạn mức (Rate limit/Quá tải). Hãy thử lại sau hoặc thêm key mới!`,
                failedCount: failedKeys.size
            });
        }

        const keyDisplay = `...${apiKey.slice(-6)}`;
        console.log(`🔄 Đang gọi Gemini API với key [${keyDisplay}] (Thử lần ${attempt + 1}/${RETRY_DELAYS.length})...`);

        try {
            // Sử dụng REST API chuẩn của Gemini để tương thích 100% với mọi model
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            
            const payload = {
                contents: [
                    {
                        parts: [
                            { text: prompt }
                        ]
                    }
                ],
                generationConfig: {
                    temperature: 0.4,
                    topP: 0.95,
                    maxOutputTokens: 8192,
                    responseMimeType: "application/json"
                }
            };

            const geminiRes = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                timeout: 120000 // 2 phút timeout cho batch lớn
            });

            if (!geminiRes.ok) {
                const errText = await geminiRes.text();
                let errObj = {};
                try { errObj = JSON.parse(errText); } catch(e) {}
                const errMsg = errObj?.error?.message || errText || `HTTP ${geminiRes.status}`;
                throw new Error(`HTTP ${geminiRes.status}: ${errMsg}`);
            }

            const data = await geminiRes.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!rawText) {
                throw new Error('Gemini trả về phản hồi rỗng (không có candidate text)');
            }

            // Clean và parse JSON array
            let cleanedText = rawText.trim();
            if (cleanedText.startsWith('```')) {
                cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
            }

            let annotations = null;
            try {
                annotations = JSON.parse(cleanedText);
            } catch (jsonErr) {
                const arrayMatch = cleanedText.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    annotations = JSON.parse(arrayMatch[0]);
                } else {
                    throw new Error(`Không thể parse JSON từ Gemini: ${cleanedText.substring(0, 200)}`);
                }
            }

            if (!Array.isArray(annotations)) {
                if (annotations && typeof annotations === 'object' && Array.isArray(annotations.annotations)) {
                    annotations = annotations.annotations;
                } else if (annotations && typeof annotations === 'object' && Array.isArray(annotations.moves)) {
                    annotations = annotations.moves;
                } else {
                    throw new Error('Dữ liệu Gemini trả về không phải là JSON array!');
                }
            }

            console.log(`✅ Thành công! Đã sinh ghi chú cho ${annotations.length} nước đi bằng model [${selectedModel}] (Key: ${keyDisplay})`);
            return res.json({
                success: true,
                annotations: annotations,
                usedKey: keyDisplay,
                model: selectedModel
            });

        } catch (err) {
            const msg = err.message || '';
            const ml = msg.toLowerCase();
            console.error(`⚠️ Lỗi khi gọi với key [${keyDisplay}]:`, msg);

            const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || ml.includes('rate limit') || ml.includes('quota');
            const isOverload = msg.includes('503') || ml.includes('unavailable') || ml.includes('overload') || ml.includes('high demand');
            const isTimeout = msg.includes('504') || ml.includes('deadline') || ml.includes('timeout') || ml.includes('timed out');
            const isInvalidKey = msg.includes('API_KEY_INVALID') || msg.includes('key not valid') || msg.includes('400');
            const isTransient = isRateLimit || isOverload || isTimeout || isInvalidKey || ml.includes('connection');

            if (isRateLimit || isOverload || isInvalidKey) {
                failedKeys.add(apiKey); // Đánh dấu key này đã hỏng/hết quota để lần retry sau chọn key khác
                console.log(`🚫 Đã đưa key [${keyDisplay}] vào danh sách tạm ngừng (còn ${validKeys.length - failedKeys.size} key)`);
            }

            if (isTransient && attempt < RETRY_DELAYS.length - 1 && (validKeys.length - failedKeys.size > 0 || isTimeout)) {
                continue; // Thử lại với key khác hoặc retry delay
            }

            // Nếu đã thử hết các lần hoặc lỗi không thể retry
            if (attempt === RETRY_DELAYS.length - 1 || (validKeys.length - failedKeys.size === 0)) {
                return res.status(500).json({
                    error: `Lỗi Gemini (${selectedModel}): ${msg.substring(0, 300)}`
                });
            }
        }
    }

    return res.status(500).json({ error: 'Đã hết số lần thử lại nhưng không thành công.' });
});

// Bật Server
app.listen(port, '0.0.0.0', () => {
    console.log(`\n✅ Máy chủ đã chạy thành công trên cổng ${port}!`);
    console.log(`🎮 Truy cập: http://0.0.0.0:${port}\n`);
});