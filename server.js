// file: server.js
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch'); // Đảm bảo bạn đã cài node-fetch@2
const { WebSocketServer } = require('ws');

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
    const idsList = movesData.map(m => m.i || m.index).join(', ');

    let movesBlock = 'DANH SÁCH CÁC NƯỚC ĐI VÀ CÁC BIẾN (kèm đánh giá engine Pikafish Cấp 10 và FEN thế cờ):\n\n';
    movesData.forEach((m) => {
        const moveId = m.i || m.index;
        const flag = m.moveFlag === 'weak' ? '🔴 PHẾ CỜ / SAI LẦM NẶNG' :
                     m.moveFlag === 'inaccuracy' ? '🟠 SƠ HỞ / NƯỚC YẾU' :
                     m.moveFlag === 'strong' ? '🟢 NƯỚC CHUẨN / NƯỚC HAY' : '⚪ Bình thường';
        const bestInfo = m.bestMove ? ` | Nước chuẩn gợi ý: ${m.bestMove}` : '';
        const dropInfo = (m.drop !== null && m.drop !== undefined) ? ` | Tụt điểm: ${Number(m.drop).toFixed(2)}` : '';
        const evalStr = (m.evalScore !== undefined && m.evalScore !== null) ? `${m.evalScore >= 0 ? '+' : ''}${Number(m.evalScore).toFixed(2)}` : 'N/A';
        const branchStr = m.branch ? `[${m.branch}]` : '[Nhánh chính]';
        const fenBefore = m.prevFen ? ` | Thế cờ TRƯỚC: ${m.prevFen}` : '';
        const fenAfter = m.fen ? ` | Thế cờ SAU: ${m.fen}` : '';

        movesBlock += `ID ${moveId} ${branchStr}: ${m.notation || m.move} | Bên: ${m.side} | Hiệp ${m.round || 1} | Eval: ${evalStr}${bestInfo}${dropInfo} | Đánh giá: ${flag}${fenBefore}${fenAfter}\n`;
    });

    return `Bạn là một Huấn luyện viên Cờ Tướng (Xiangqi) chuyên nghiệp đẳng cấp Quốc Tế Đại Sư (Grandmaster), chuyên gia phân tích chiến thuật và cục diện ván đấu.

Nhiệm vụ: Phân tích SÂU từng nước đi cờ tướng dưới đây dựa trên dữ liệu engine Pikafish Cấp 10 VÀ thế cờ FEN, viết GHI CHÚ TIẾNG VIỆT giải thích CỤ THỂ VỀ MẶT CHIẾN THUẬT cho từng nước.

HƯỚNG DẪN ĐỌC FEN CỜ TƯỚNG (Xiangqi FEN):
- Chữ HOA = quân Đỏ: R(Xe), N(Mã), B(Tượng), A(Sĩ), K(Tướng), C(Pháo), P(Tốt/Binh)
- Chữ thường = quân Đen: r(xe), n(mã), b(tượng), a(sĩ), k(tướng), c(pháo), p(tốt/chốt)
- Số = ô trống liên tiếp. Dòng phân cách bởi "/". Dòng đầu tiên là hàng 10 (phía Đen), dòng cuối là hàng 1 (phía Đỏ).
- "w" = lượt Đỏ đi, "b" = lượt Đen đi.

THÔNG TIN VÁN ĐẤU:
- Bên Đỏ: ${info.red || info.redname || 'Đỏ'}
- Bên Đen: ${info.black || info.blackname || 'Đen'}
- Khai cuộc / Tiêu đề: ${info.open || info.title || 'Kỳ phổ Cờ Tướng'}
- Kết quả: ${info.result || '*'}

${movesBlock}

NGUYÊN TẮC PHÂN TÍCH BẮT BUỘC — PHẢI GIẢI THÍCH CỤ THỂ VỀ CHIẾN THUẬT:

1. **Phân tích vị trí quân cờ từ FEN**: Dùng FEN TRƯỚC và SAU nước đi để xác định chính xác quân nào ở đâu, quân nào bị ảnh hưởng bởi nước đi này.

2. **Với nước 🔴 PHẾ CỜ / 🟠 SƠ HỞ — PHẢI chỉ rõ LÝ DO CỤ THỂ**, ví dụ:
   - "Mã bị bí (kẹt ở góc/biên, không có ô nhảy vì bị quân khác chặn chân)"
   - "Xe mất căn (mất kiểm soát cột mở, bị đẩy lùi về vị trí phòng thủ thụ động)"
   - "Pháo mất gánh (mất quân giá đỡ để bắn, pháo trở nên vô dụng)"
   - "Tạo lỗ hổng trong cung, sĩ tượng mất liên kết, tướng dễ bị chiếu"
   - "Để đối phương đè quân (xe đè, pháo đè, mã đè — kiểm soát quân ta không di chuyển được)"
   - "Mất tiên thủ (để đối phương giành quyền đi trước, mất nhịp tấn công)"
   - "Quân bị cản đường nhau (xe bị pháo chặn, mã bị tốt cản chân)"
   - "Bỏ lỡ đòn chiếu đôi / bắt đôi / xiên quân / ghim quân"
   - "Không bảo vệ được quân trọng yếu, dẫn đến mất quân miễn phí"
   Kèm theo giải thích tại sao nước chuẩn gợi ý lại tốt hơn.

3. **Với nước 🟢 NƯỚC HAY — PHẢI khen cụ thể**, ví dụ:
   - "Chiếm cột mở, xe kiểm soát trung lộ"
   - "Mã chiếm vị trí trung tâm mạnh, kiểm soát nhiều ô quan trọng"
   - "Tạo đòn phối hợp xe-pháo / xe-mã / pháo-mã tấn công cung đối phương"
   - "Tranh tiên (giành quyền chủ động tấn công trước)"
   - "Tạo thế chiếu bí không thể đỡ"

4. **Với nước ⚪ Bình thường**: Giải thích ngắn gọn ý đồ (triển khai quân, phòng thủ, chuyển hướng tấn công).

5. **Phong cách viết**: 
   - Tiếng Việt cờ tướng chuyên nghiệp, tự nhiên
   - Mỗi nước 1-3 câu, gãy gọn, KHÔNG sáo rỗng chung chung
   - PHẢI nêu đích danh quân cờ cụ thể (ví dụ: "Xe 1 đường 2", "Mã trái", "Pháo đầu")
   - Tuân thủ 100% dữ liệu engine, KHÔNG bịa thế cờ

ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT 1 JSON ARRAY các object tương ứng đúng với các ID [${idsList}]:
[{"i": <ID số nguyên tương ứng>, "c": "<nội dung ghi chú tiếng Việt>"}]
Phải đủ đúng ${totalMoves} phần tử cho tất cả các ID trên.
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

    let primaryModel = model || 'gemini-2.5-flash';
    // Chuẩn hóa tên model nếu người dùng lưu model cũ
    if (primaryModel.includes('3.7') || primaryModel.includes('3.6') || primaryModel.includes('3.5')) {
        primaryModel = 'gemini-2.5-flash';
    }

    // Danh sách model dự phòng theo thứ tự ưu tiên nếu model chính bị 404/503
    const FALLBACK_MODELS = [primaryModel];
    if (!FALLBACK_MODELS.includes('gemini-2.5-flash')) FALLBACK_MODELS.push('gemini-2.5-flash');
    if (!FALLBACK_MODELS.includes('gemini-2.0-flash')) FALLBACK_MODELS.push('gemini-2.0-flash');
    if (!FALLBACK_MODELS.includes('gemini-1.5-flash')) FALLBACK_MODELS.push('gemini-1.5-flash');

    console.log(`- Model yêu cầu: ${primaryModel}`);
    console.log(`- Tổng số nước đi trong batch: ${movesData.length}`);
    console.log(`- Số lượng API Key khả dụng: ${validKeys.length}`);

    const prompt = buildChessAnnotationPrompt(movesData, gameInfo);
    const RETRY_DELAYS = [0, 1500, 3000, 6000];
    const failedKeys = new Set();
    let currentModelIndex = 0;

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        const selectedModel = FALLBACK_MODELS[Math.min(currentModelIndex, FALLBACK_MODELS.length - 1)];

        if (RETRY_DELAYS[attempt] > 0) {
            console.log(`⏳ Chờ ${(RETRY_DELAYS[attempt] / 1000)}s rồi thử lại lần ${attempt + 1}...`);
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }

        // Chọn key từ pool
        let apiKey = pickRandomKey(validKeys, failedKeys);
        if (!apiKey) {
            // Nếu tất cả key bị đánh dấu tạm thời, reset lại danh sách để thử lại với model khác
            failedKeys.clear();
            apiKey = pickRandomKey(validKeys, failedKeys);
        }

        const keyDisplay = apiKey ? `...${apiKey.slice(-6)}` : 'UNKNOWN';
        console.log(`🔄 Đang gọi Gemini API [Model: ${selectedModel}] với key [${keyDisplay}] (Thử lần ${attempt + 1}/${RETRY_DELAYS.length})...`);

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
                timeout: 90000 // 90s timeout cho mỗi batch
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
            console.error(`⚠️ Lỗi khi gọi [${selectedModel}] với key [${keyDisplay}]:`, msg);

            const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || ml.includes('rate limit') || ml.includes('quota');
            const isOverload = msg.includes('503') || ml.includes('unavailable') || ml.includes('overload') || ml.includes('high demand') || ml.includes('demand');
            const isModelNotFound = msg.includes('404') || ml.includes('not found') || ml.includes('is not supported') || ml.includes('not supported');
            const isTimeout = msg.includes('504') || ml.includes('deadline') || ml.includes('timeout') || ml.includes('timed out');
            const isInvalidKey = msg.includes('API_KEY_INVALID') || msg.includes('key not valid') || msg.includes('400');

            if (isOverload || isModelNotFound) {
                // Tự động chuyển sang model dự phòng
                currentModelIndex++;
                const nextModel = FALLBACK_MODELS[Math.min(currentModelIndex, FALLBACK_MODELS.length - 1)];
                console.log(`🔀 Model [${selectedModel}] không khả dụng/quá tải. Tự động chuyển sang model dự phòng [${nextModel}]...`);
            } else if (isRateLimit || isInvalidKey) {
                failedKeys.add(apiKey);
                console.log(`🚫 Đã đưa key [${keyDisplay}] vào danh sách tạm ngừng (còn ${validKeys.length - failedKeys.size} key)`);
            }

            if (attempt < RETRY_DELAYS.length - 1) {
                continue; // Thử lại với model khác hoặc key khác
            }

            // Nếu đã thử hết các lần
            return res.status(500).json({
                error: `Lỗi Gemini (${selectedModel}): ${msg.substring(0, 300)}`
            });
        }
    }

    return res.status(500).json({ error: 'Đã hết số lần thử lại nhưng không thành công.' });
});

// ========================================================
// HỆ THỐNG PHÒNG CHƠI ONLINE (WEBSOCKET ROOMS)
// ========================================================
// WEBSOCKET SERVER CHO CHẾ ĐỘ CHƠI ONLINE (MULTIPLAYER ROOMS)
// ========================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const DEFAULT_XIANGQI_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const FIXED_ROOM_CODE = '013579';
const RECONNECT_GRACE_MS = 90000; // 90 giây chờ kết nối lại nếu rớt mạng

const rooms = new Map(); // roomCode -> Room State

// Khởi tạo timer mặc định
function getDefaultTimer() {
    return {
        enabled: false,
        mode: 'none', // 'none' | 'increment' | 'per_move'
        baseMinutes: 15,
        incSeconds: 5,
        moveLimitSeconds: 60,
        stepSeconds: 60,
        redTimeMs: 15 * 60 * 1000,
        blackTimeMs: 15 * 60 * 1000,
        activeSide: null, // 'w' | 'b'
        isRunning: false,
        lastTick: null
    };
}

// Khởi tạo hoặc lấy phòng cố định 013579
function getOrCreateFixedRoom() {
    let room = rooms.get(FIXED_ROOM_CODE);
    if (!room) {
        room = {
            code: FIXED_ROOM_CODE,
            isPermanent: true,
            host: null,
            guest: null,
            hostColor: 'red',
            guestColor: 'black',
            fen: DEFAULT_XIANGQI_FEN,
            currentTurn: 'w',
            timer: getDefaultTimer(),
            spectators: new Map(), // userId -> { ws, userId, userName, connected }
            createdAt: Date.now()
        };
        rooms.set(FIXED_ROOM_CODE, room);
    }
    return room;
}
getOrCreateFixedRoom();

function generateRoomCode() {
    let code;
    let attempts = 0;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        attempts++;
    } while ((rooms.has(code) || code === FIXED_ROOM_CODE) && attempts < 100);
    return code;
}

// Helper gửi tin nhắn tới tất cả thành viên trong phòng (Host, Guest, Spectators)
function broadcastToRoom(room, messageObj, excludeWs = null) {
    if (!room) return;
    const msgStr = typeof messageObj === 'string' ? messageObj : JSON.stringify(messageObj);

    if (room.host && room.host.ws && room.host.ws.readyState === 1 && room.host.ws !== excludeWs) {
        try { room.host.ws.send(msgStr); } catch (e) {}
    }
    if (room.guest && room.guest.ws && room.guest.ws.readyState === 1 && room.guest.ws !== excludeWs) {
        try { room.guest.ws.send(msgStr); } catch (e) {}
    }
    if (room.spectators) {
        room.spectators.forEach((spec) => {
            if (spec.ws && spec.ws.readyState === 1 && spec.ws !== excludeWs) {
                try { spec.ws.send(msgStr); } catch (e) {}
            }
        });
    }
}

// Helper thông báo danh sách kỳ thủ & khán giả cập nhật
function broadcastPlayersUpdated(room) {
    if (!room) return;
    const specsList = [];
    if (room.spectators) {
        room.spectators.forEach((spec) => {
            specsList.push({
                userId: spec.userId,
                userName: spec.userName,
                connected: spec.connected
            });
        });
    }

    const payload = {
        type: 'ROOM_PLAYERS_UPDATED',
        host: room.host ? { userId: room.host.userId, userName: room.host.userName, color: room.host.color, connected: room.host.connected } : null,
        guest: room.guest ? { userId: room.guest.userId, userName: room.guest.userName, color: room.guest.color, connected: room.guest.connected } : null,
        spectators: specsList,
        spectatorCount: specsList.length
    };
    broadcastToRoom(room, payload);
}

// Dọn dẹp phòng cũ sau mỗi 30 phút (trừ phòng cố định 013579)
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        if (room.isPermanent) continue;
        const isHostAlive = room.host && room.host.ws && room.host.ws.readyState === 1;
        const isGuestAlive = room.guest && room.guest.ws && room.guest.ws.readyState === 1;
        const hasSpectators = room.spectators && room.spectators.size > 0;
        if (!isHostAlive && !isGuestAlive && !hasSpectators && !room.host?.disconnectTimer && !room.guest?.disconnectTimer) {
            rooms.delete(code);
        } else if (now - room.createdAt > 8 * 60 * 60 * 1000) {
            rooms.delete(code);
        }
    }
}, 30 * 60 * 1000);

// Heartbeat giữ kết nối không bị ngắt (đặc biệt trên Render / Cloud hosting)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        try { ws.ping(); } catch (e) {}
    });
}, 30000);

// Timer Tick Checker: Đếm ngược thời gian và xử lý Hết Giờ (Timeout)
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        if (!room.timer || !room.timer.enabled || !room.timer.isRunning || !room.timer.lastTick || !room.timer.activeSide) {
            continue;
        }

        const elapsed = now - room.timer.lastTick;
        let timeoutOccurred = false;
        let timeoutReason = '';
        let loserSide = null;

        // 1. Kiểm tra giới hạn thời gian cho 1 nước đi (nếu có bật stepSeconds > 0 hoặc chế độ per_move)
        const stepLimitSec = room.timer.mode === 'per_move' ? (room.timer.moveLimitSeconds || 60) : (room.timer.stepSeconds || 0);
        if (stepLimitSec > 0 && elapsed >= stepLimitSec * 1000) {
            timeoutOccurred = true;
            loserSide = room.timer.activeSide === 'w' ? 'red' : 'black';
            timeoutReason = `quá thời gian suy nghĩ 1 nước (${stepLimitSec} giây)`;
        }

        // 2. Kiểm tra tổng thời gian chính của ván cờ (nếu chưa bị xử thua nước đi)
        if (!timeoutOccurred && room.timer.mode === 'increment') {
            if (room.timer.activeSide === 'w') {
                const remaining = room.timer.redTimeMs - elapsed;
                if (remaining <= 0) {
                    room.timer.redTimeMs = 0;
                    timeoutOccurred = true;
                    loserSide = 'red';
                    timeoutReason = 'hết tổng thời gian chính của ván đấu';
                }
            } else if (room.timer.activeSide === 'b') {
                const remaining = room.timer.blackTimeMs - elapsed;
                if (remaining <= 0) {
                    room.timer.blackTimeMs = 0;
                    timeoutOccurred = true;
                    loserSide = 'black';
                    timeoutReason = 'hết tổng thời gian chính của ván đấu';
                }
            }
        }

        if (timeoutOccurred) {
            room.timer.isRunning = false;
            room.timer.lastTick = null;
            const winnerSide = loserSide === 'red' ? 'black' : 'red';
            const loserName = loserSide === 'red'
                ? (room.host.color === 'red' ? room.host.userName : room.guest?.userName || 'Bên Đỏ')
                : (room.host.color === 'black' ? room.host.userName : room.guest?.userName || 'Bên Đen');
            const winnerName = winnerSide === 'red'
                ? (room.host.color === 'red' ? room.host.userName : room.guest?.userName || 'Bên Đỏ')
                : (room.host.color === 'black' ? room.host.userName : room.guest?.userName || 'Bên Đen');

            console.log(`⏰ [Online] Hết giờ phòng [${code}]: ${loserName} (${loserSide}) thua do ${timeoutReason}, ${winnerName} (${winnerSide}) thắng!`);

            const timeoutMsg = {
                type: 'GAME_TIMEOUT',
                loserSide,
                winnerSide,
                loserName,
                winnerName,
                timeoutReason,
                timer: {
                    enabled: room.timer.enabled,
                    mode: room.timer.mode,
                    stepSeconds: room.timer.stepSeconds,
                    moveLimitSeconds: room.timer.moveLimitSeconds,
                    redTimeMs: room.timer.redTimeMs,
                    blackTimeMs: room.timer.blackTimeMs,
                    activeSide: null,
                    isRunning: false,
                    lastTick: null
                },
                message: `⏰ HẾT GIỜ! ${loserName} (${loserSide === 'red' ? 'Đỏ' : 'Đen'}) bị xử thua do ${timeoutReason}. ${winnerName} giành chiến thắng!`
            };
            broadcastToRoom(room, timeoutMsg);
        }
    }
}, 500);

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (messageRaw) => {
        let data;
        try {
            data = JSON.parse(messageRaw);
        } catch (e) {
            return;
        }

        const { type } = data;
        const userId = data.userId ? String(data.userId).trim() : null;
        const userName = data.userName ? String(data.userName).trim().slice(0, 25) : null;

        // 1. TẠO PHÒNG MỚI (PHÒNG RIÊNG TƯ)
        if (type === 'CREATE_ROOM') {
            const roomCode = generateRoomCode();
            const hostColor = data.hostColor === 'black' ? 'black' : 'red';
            const guestColor = hostColor === 'red' ? 'black' : 'red';
            const fen = data.initialFen || DEFAULT_XIANGQI_FEN;
            const currentTurn = fen.split(' ')[1] || 'w';
            const hostName = userName || 'Chủ phòng';

            const room = {
                code: roomCode,
                isPermanent: false,
                host: { ws, userId, userName: hostName, color: hostColor, connected: true, disconnectTimer: null },
                guest: null,
                guestColor: guestColor,
                fen: fen,
                currentTurn: currentTurn,
                timer: getDefaultTimer(),
                spectators: new Map(),
                createdAt: Date.now()
            };

            rooms.set(roomCode, room);
            ws.roomCode = roomCode;
            ws.isHost = true;
            ws.isSpectator = false;
            ws.userId = userId;
            ws.userName = hostName;

            console.log(`🏠 [Online] Phòng mới được tạo: [${roomCode}] bởi ${hostName} (${hostColor}) [UID: ${userId}]`);

            ws.send(JSON.stringify({
                type: 'ROOM_CREATED',
                roomCode,
                myColor: hostColor,
                myUserName: hostName,
                guestColor,
                fen,
                currentTurn,
                timer: room.timer,
                spectatorCount: 0
            }));
            return;
        }

        // 2. VÀO PHÒNG (BẰNG MÃ HOẶC PHÒNG CỐ ĐỊNH 013579 HOẶC KẾT NỐI LẠI)
        if (type === 'JOIN_ROOM') {
            const roomCode = String(data.roomCode || '').trim();
            let room = rooms.get(roomCode);

            if (roomCode === FIXED_ROOM_CODE) {
                room = getOrCreateFixedRoom();
            }

            if (!room) {
                return ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: 'Mã phòng không tồn tại hoặc đã đóng!'
                }));
            }

            // KIỂM TRA TRƯỜNG HỢP: NGƯỜI CHƠI KẾT NỐI LẠI (RECONNECT) BẰNG USER_ID
            if (userId) {
                // a) Chủ phòng kết nối lại
                if (room.host && room.host.userId === userId) {
                    if (room.host.disconnectTimer) {
                        clearTimeout(room.host.disconnectTimer);
                        room.host.disconnectTimer = null;
                    }
                    if (userName) room.host.userName = userName;
                    room.host.ws = ws;
                    room.host.connected = true;
                    ws.roomCode = roomCode;
                    ws.isHost = true;
                    ws.isSpectator = false;
                    ws.userId = userId;
                    ws.userName = room.host.userName;

                    console.log(`🔄 [Online] Chủ phòng [${roomCode}] (${room.host.userName}) kết nối lại thành công! [UID: ${userId}]`);

                    ws.send(JSON.stringify({
                        type: 'ROOM_RECONNECTED',
                        roomCode,
                        isHost: true,
                        isSpectator: false,
                        myColor: room.host.color,
                        myUserName: room.host.userName,
                        opponentUserName: room.guest ? room.guest.userName : 'Đối thủ',
                        opponentColor: room.guestColor,
                        opponentJoined: !!(room.guest && room.guest.connected),
                        fen: room.fen,
                        currentTurn: room.currentTurn,
                        timer: room.timer,
                        spectatorCount: room.spectators ? room.spectators.size : 0
                    }));

                    broadcastPlayersUpdated(room);

                    if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                        room.guest.ws.send(JSON.stringify({
                            type: 'PLAYER_RECONNECTED',
                            opponentUserName: room.host.userName,
                            message: `${room.host.userName} đã kết nối lại! Tiếp tục trận đấu.`
                        }));
                    }
                    return;
                }

                // b) Khách kết nối lại
                if (room.guest && room.guest.userId === userId) {
                    if (room.guest.disconnectTimer) {
                        clearTimeout(room.guest.disconnectTimer);
                        room.guest.disconnectTimer = null;
                    }
                    if (userName) room.guest.userName = userName;
                    room.guest.ws = ws;
                    room.guest.connected = true;
                    ws.roomCode = roomCode;
                    ws.isHost = false;
                    ws.isSpectator = false;
                    ws.userId = userId;
                    ws.userName = room.guest.userName;

                    console.log(`🔄 [Online] Khách [${roomCode}] (${room.guest.userName}) kết nối lại thành công! [UID: ${userId}]`);

                    ws.send(JSON.stringify({
                        type: 'ROOM_RECONNECTED',
                        roomCode,
                        isHost: false,
                        isSpectator: false,
                        myColor: room.guest.color,
                        myUserName: room.guest.userName,
                        opponentUserName: room.host ? room.host.userName : 'Chủ phòng',
                        opponentColor: room.host ? room.host.color : 'red',
                        opponentJoined: !!(room.host && room.host.connected),
                        fen: room.fen,
                        currentTurn: room.currentTurn,
                        timer: room.timer,
                        spectatorCount: room.spectators ? room.spectators.size : 0
                    }));

                    broadcastPlayersUpdated(room);

                    if (room.host && room.host.ws && room.host.ws.readyState === 1) {
                        room.host.ws.send(JSON.stringify({
                            type: 'PLAYER_RECONNECTED',
                            opponentUserName: room.guest.userName,
                            message: `${room.guest.userName} đã kết nối lại! Tiếp tục trận đấu.`
                        }));
                    }
                    return;
                }

                // c) Khán giả kết nối lại
                if (room.spectators && room.spectators.has(userId)) {
                    const spec = room.spectators.get(userId);
                    spec.ws = ws;
                    spec.connected = true;
                    if (userName) spec.userName = userName;
                    ws.roomCode = roomCode;
                    ws.isHost = false;
                    ws.isSpectator = true;
                    ws.userId = userId;
                    ws.userName = spec.userName;

                    console.log(`🔄 [Online] Khán giả [${roomCode}] (${spec.userName}) kết nối lại!`);

                    ws.send(JSON.stringify({
                        type: 'ROOM_JOINED_SPECTATOR',
                        roomCode,
                        isPermanent: room.isPermanent,
                        myUserName: spec.userName,
                        host: room.host ? { userName: room.host.userName, color: room.host.color } : null,
                        guest: room.guest ? { userName: room.guest.userName, color: room.guest.color } : null,
                        fen: room.fen,
                        currentTurn: room.currentTurn,
                        timer: room.timer,
                        spectatorCount: room.spectators.size
                    }));

                    broadcastPlayersUpdated(room);
                    return;
                }
            }

            // XỬ LÝ PHÒNG CỐ ĐỊNH 013579 (AI VÀO TRƯỚC LÀM CHỦ, VÀO SAU LÀM KHÁCH, VÀO THỨ 3+ LÀM KHÁN GIẢ)
            if (room.isPermanent) {
                // Nếu chưa có chủ phòng hoặc chủ phòng cũ đã ngắt kết nối hết hạn
                if (!room.host || !room.host.connected) {
                    const hostName = userName || 'Chủ phòng';
                    room.host = { ws, userId, userName: hostName, color: room.hostColor || 'red', connected: true, disconnectTimer: null };
                    ws.roomCode = roomCode;
                    ws.isHost = true;
                    ws.isSpectator = false;
                    ws.userId = userId;
                    ws.userName = hostName;

                    console.log(`👑 [Fixed Room 013579] ${hostName} nhận quyền Chủ phòng (UID: ${userId})`);

                    ws.send(JSON.stringify({
                        type: 'ROOM_CREATED',
                        roomCode,
                        isPermanent: true,
                        myColor: room.host.color,
                        myUserName: hostName,
                        guestColor: room.guestColor || 'black',
                        fen: room.fen,
                        currentTurn: room.currentTurn,
                        timer: room.timer,
                        spectatorCount: room.spectators ? room.spectators.size : 0
                    }));

                    broadcastPlayersUpdated(room);

                    if (room.guest && room.guest.connected && room.guest.ws && room.guest.ws.readyState === 1) {
                        ws.send(JSON.stringify({
                            type: 'PLAYER_JOINED',
                            opponentUserName: room.guest.userName,
                            message: `${room.guest.userName} đã có sẵn trong phòng.`,
                            guestColor: room.guest.color
                        }));
                    }
                    return;
                }

                // Nếu đã có chủ phòng nhưng chưa có khách (hoặc khách cũ đã thoát)
                if (!room.guest || !room.guest.connected) {
                    const guestColor = room.host.color === 'red' ? 'black' : 'red';
                    const guestName = userName || 'Khách';
                    room.guest = { ws, userId, userName: guestName, color: guestColor, connected: true, disconnectTimer: null };
                    ws.roomCode = roomCode;
                    ws.isHost = false;
                    ws.isSpectator = false;
                    ws.userId = userId;
                    ws.userName = guestName;

                    console.log(`👥 [Fixed Room 013579] ${guestName} tham gia phòng làm Khách (UID: ${userId})`);

                    ws.send(JSON.stringify({
                        type: 'ROOM_JOINED',
                        roomCode,
                        isPermanent: true,
                        myColor: guestColor,
                        myUserName: guestName,
                        hostColor: room.host.color,
                        opponentUserName: room.host.userName,
                        fen: room.fen,
                        currentTurn: room.currentTurn,
                        timer: room.timer,
                        spectatorCount: room.spectators ? room.spectators.size : 0
                    }));

                    broadcastPlayersUpdated(room);

                    if (room.host && room.host.ws && room.host.ws.readyState === 1) {
                        room.host.ws.send(JSON.stringify({
                            type: 'PLAYER_JOINED',
                            opponentUserName: guestName,
                            message: `${guestName} đã tham gia phòng! Sẵn sàng thi đấu.`,
                            guestColor: guestColor
                        }));
                    }
                    return;
                }

                // Cả 2 slot Host & Guest đều đã có người -> NGƯỜI VÀO SAU LÀ KHÁN GIẢ (SPECTATOR)!
                const specName = userName || ('Khán giả ' + Math.floor(100 + Math.random() * 900));
                const specId = userId || ('spec_' + Math.random().toString(36).substring(2, 8));
                room.spectators.set(specId, { ws, userId: specId, userName: specName, connected: true });
                ws.roomCode = roomCode;
                ws.isHost = false;
                ws.isSpectator = true;
                ws.userId = specId;
                ws.userName = specName;

                console.log(`👁️ [Fixed Room 013579] ${specName} tham gia xem cờ (UID: ${specId})`);

                ws.send(JSON.stringify({
                    type: 'ROOM_JOINED_SPECTATOR',
                    roomCode,
                    isPermanent: true,
                    myUserName: specName,
                    host: { userName: room.host.userName, color: room.host.color },
                    guest: { userName: room.guest.userName, color: room.guest.color },
                    fen: room.fen,
                    currentTurn: room.currentTurn,
                    timer: room.timer,
                    spectatorCount: room.spectators.size
                }));

                broadcastPlayersUpdated(room);
                broadcastToRoom(room, {
                    type: 'CHAT_MESSAGE',
                    senderRole: 'system',
                    senderName: 'Hệ thống',
                    text: `👁️ ${specName} đã vào phòng xem cờ.`,
                    time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                }, ws);
                return;
            }

            // XỬ LÝ PHÒNG RIÊNG TƯ (NẾU CHƯA CÓ KHÁCH -> LÀM KHÁCH; ĐÃ ĐỦ 2 NGƯỜI -> LÀM KHÁN GIẢ)
            if (!room.guest || !room.guest.connected) {
                const guestName = userName || 'Khách';
                room.guest = { ws, userId, userName: guestName, color: room.guestColor, connected: true, disconnectTimer: null };
                ws.roomCode = roomCode;
                ws.isHost = false;
                ws.isSpectator = false;
                ws.userId = userId;
                ws.userName = guestName;

                console.log(`👥 [Online] ${guestName} đã tham gia phòng: [${roomCode}] (${room.guestColor})`);

                ws.send(JSON.stringify({
                    type: 'ROOM_JOINED',
                    roomCode,
                    myColor: room.guestColor,
                    myUserName: guestName,
                    hostColor: room.host ? room.host.color : 'red',
                    opponentUserName: room.host ? room.host.userName : 'Chủ phòng',
                    fen: room.fen,
                    currentTurn: room.currentTurn,
                    timer: room.timer,
                    spectatorCount: room.spectators ? room.spectators.size : 0
                }));

                broadcastPlayersUpdated(room);

                if (room.host && room.host.ws && room.host.ws.readyState === 1) {
                    room.host.ws.send(JSON.stringify({
                        type: 'PLAYER_JOINED',
                        opponentUserName: guestName,
                        message: `${guestName} đã tham gia phòng! Sẵn sàng thi đấu.`,
                        guestColor: room.guestColor
                    }));
                }
                return;
            }

            // Phòng riêng tư đã có đủ 2 người thi đấu -> VÀO VỚI TƯ CÁCH KHÁN GIẢ (SPECTATOR)
            const specName = userName || ('Khán giả ' + Math.floor(100 + Math.random() * 900));
            const specId = userId || ('spec_' + Math.random().toString(36).substring(2, 8));
            room.spectators.set(specId, { ws, userId: specId, userName: specName, connected: true });
            ws.roomCode = roomCode;
            ws.isHost = false;
            ws.isSpectator = true;
            ws.userId = specId;
            ws.userName = specName;

            console.log(`👁️ [Online] ${specName} tham gia phòng riêng [${roomCode}] làm KHÁN GIẢ`);

            ws.send(JSON.stringify({
                type: 'ROOM_JOINED_SPECTATOR',
                roomCode,
                isPermanent: false,
                myUserName: specName,
                host: room.host ? { userName: room.host.userName, color: room.host.color } : null,
                guest: { userName: room.guest.userName, color: room.guest.color },
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer,
                spectatorCount: room.spectators.size
            }));

            broadcastPlayersUpdated(room);
            broadcastToRoom(room, {
                type: 'CHAT_MESSAGE',
                senderRole: 'system',
                senderName: 'Hệ thống',
                text: `👁️ ${specName} đã vào phòng xem cờ.`,
                time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            }, ws);
            return;
        }

        // Các hành động sau yêu cầu đã ở trong phòng
        const roomCode = ws.roomCode || data.roomCode;
        const room = rooms.get(roomCode);
        if (!room) return;

        // 3. ĐI QUÂN (MOVE) - CHỈ CHỦ HOẶC KHÁCH MỚI ĐƯỢC PHÉP ĐI QUÂN
        if (type === 'MOVE') {
            if (ws.isSpectator) {
                return ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: 'Bạn đang ở chế độ xem cờ! Không thể đi quân.'
                }));
            }

            const prevTurn = room.currentTurn || (room.fen.split(' ')[1] || 'w');
            room.fen = data.newFen || room.fen;
            const nextTurn = data.nextTurn || (room.fen.split(' ')[1] || 'w');
            room.currentTurn = nextTurn;

            // XỬ LÝ ĐỒNG HỒ TÍNH GIỜ KHI ĐI NƯỚC CỜ
            if (room.timer && room.timer.enabled) {
                const now = Date.now();
                if (room.timer.isRunning && room.timer.lastTick) {
                    const elapsed = Math.max(0, now - room.timer.lastTick);
                    if (prevTurn === 'w') {
                        room.timer.redTimeMs = Math.max(0, room.timer.redTimeMs - elapsed);
                        if (room.timer.mode === 'increment') {
                            room.timer.redTimeMs += (room.timer.incSeconds * 1000);
                        }
                    } else {
                        room.timer.blackTimeMs = Math.max(0, room.timer.blackTimeMs - elapsed);
                        if (room.timer.mode === 'increment') {
                            room.timer.blackTimeMs += (room.timer.incSeconds * 1000);
                        }
                    }
                }

                // Nếu là chế độ thời gian mỗi nước đi (per_move) -> reset lại thời gian cho bên tiếp theo
                if (room.timer.mode === 'per_move') {
                    if (nextTurn === 'w') {
                        room.timer.redTimeMs = room.timer.moveLimitSeconds * 1000;
                    } else {
                        room.timer.blackTimeMs = room.timer.moveLimitSeconds * 1000;
                    }
                }

                // Bắt đầu tính giờ cho bên tiếp theo
                room.timer.activeSide = nextTurn;
                room.timer.isRunning = true;
                room.timer.lastTick = now;
            }

            const movePayload = JSON.stringify({
                type: 'OPPONENT_MOVE',
                moveCommand: data.moveCommand,
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer
            });

            // Gửi cho đối thủ
            const opponent = ws.isHost ? room.guest : room.host;
            if (opponent && opponent.ws && opponent.ws.readyState === 1) {
                opponent.ws.send(movePayload);
            }

            // Gửi cho TẤT CẢ khán giả đang xem cờ
            if (room.spectators) {
                room.spectators.forEach((spec) => {
                    if (spec.ws && spec.ws.readyState === 1) {
                        try { spec.ws.send(movePayload); } catch (e) {}
                    }
                });
            }

            // Đồng bộ lại đồng hồ cho toàn bộ phòng
            if (room.timer && room.timer.enabled) {
                broadcastToRoom(room, {
                    type: 'TIMER_SYNC',
                    timer: room.timer
                });
            }
            return;
        }

        // 3.1. CÀI ĐẶT ĐỒNG HỒ TÍNH GIỜ (CHỦ PHÒNG THIẾT LẬP)
        if (type === 'SET_TIMER_SETTINGS') {
            if (!ws.isHost) {
                return ws.send(JSON.stringify({ type: 'ERROR', message: 'Chỉ Chủ phòng mới có quyền cài đặt đồng hồ!' }));
            }

            const s = data.settings || {};
            const mode = s.mode || 'none';
            // enabled là true nếu mode là 'increment' hoặc 'per_move', và s.enabled không phải là false
            const enabled = (mode !== 'none') && (s.enabled !== undefined ? !!s.enabled : true);
            const baseMinutes = Math.max(1, Math.min(180, Number(s.baseMinutes) || 15));
            const incSeconds = Math.max(0, Math.min(60, Number(s.incSeconds !== undefined ? s.incSeconds : s.incrementSeconds) || 0));
            const moveLimitSeconds = Math.max(10, Math.min(600, Number(s.moveLimitSeconds !== undefined ? s.moveLimitSeconds : s.perMoveSeconds) || 60));
            let stepSeconds = Math.max(0, Math.min(600, Number(s.stepSeconds !== undefined ? s.stepSeconds : s.stepLimitSeconds) || 0));
            if (mode === 'per_move') {
                stepSeconds = moveLimitSeconds;
            }

            room.timer = {
                enabled,
                mode: enabled ? mode : 'none',
                baseMinutes,
                incSeconds,
                moveLimitSeconds,
                stepSeconds,
                redTimeMs: mode === 'per_move' ? moveLimitSeconds * 1000 : baseMinutes * 60 * 1000,
                blackTimeMs: mode === 'per_move' ? moveLimitSeconds * 1000 : baseMinutes * 60 * 1000,
                activeSide: null,
                isRunning: false,
                lastTick: null
            };

            console.log(`⏱️ [Online] Chủ phòng [${roomCode}] thiết lập đồng hồ: ${mode} (${baseMinutes}p + ${incSeconds}s / ${stepSeconds}s/nước, enabled: ${enabled})`);

            let desc = 'Tắt đồng hồ';
            if (enabled) {
                if (mode === 'increment') {
                    desc = `${baseMinutes} phút + ${incSeconds}s`;
                    if (stepSeconds > 0) desc += ` (giới hạn ${stepSeconds}s/nước)`;
                } else if (mode === 'per_move') {
                    desc = `${moveLimitSeconds} giây mỗi nước`;
                }
            }

            broadcastToRoom(room, {
                type: 'TIMER_SYNC',
                timer: room.timer,
                message: `Chủ phòng đã cài đặt đồng hồ: [${desc}]`
            });
            return;
        }

        // 3.2. CHỦ PHÒNG CHỌN KHÁN GIẢ VÀO ĐÁNH THAY THẾ (SUBSTITUTE_GUEST)
        if (type === 'SUBSTITUTE_GUEST') {
            if (!ws.isHost) {
                return ws.send(JSON.stringify({ type: 'ERROR', message: 'Chỉ Chủ phòng mới có quyền thay đổi kỳ thủ!' }));
            }

            const targetUserId = data.targetUserId ? String(data.targetUserId).trim() : null;
            if (!targetUserId || !room.spectators || !room.spectators.has(targetUserId)) {
                return ws.send(JSON.stringify({ type: 'ERROR', message: 'Không tìm thấy khán giả này trong phòng!' }));
            }

            const targetSpec = room.spectators.get(targetUserId);
            const oldGuest = room.guest;
            const guestColor = room.guestColor || (room.host.color === 'red' ? 'black' : 'red');

            console.log(`🔄 [Online] Chủ phòng [${roomCode}] đổi người: ${targetSpec.userName} vào đánh thay cho ${oldGuest ? oldGuest.userName : 'vị trí trống'}`);

            // Khách cũ bị chuyển xuống làm Khán giả xem cờ
            if (oldGuest && oldGuest.userId) {
                oldGuest.connected = true;
                if (oldGuest.ws) {
                    oldGuest.ws.isHost = false;
                    oldGuest.ws.isSpectator = true;
                    try {
                        oldGuest.ws.send(JSON.stringify({
                            type: 'DEMOTED_TO_SPECTATOR',
                            message: 'Bạn đã được chuyển sang chế độ Khán giả xem cờ.'
                        }));
                    } catch (e) {}
                }
                room.spectators.set(oldGuest.userId, {
                    ws: oldGuest.ws,
                    userId: oldGuest.userId,
                    userName: oldGuest.userName,
                    connected: oldGuest.connected
                });
            }

            // Khán giả được chọn nâng lên thành Khách thi đấu
            room.spectators.delete(targetUserId);
            room.guest = {
                ws: targetSpec.ws,
                userId: targetSpec.userId,
                userName: targetSpec.userName,
                color: guestColor,
                connected: true,
                disconnectTimer: null
            };

            if (targetSpec.ws) {
                targetSpec.ws.isHost = false;
                targetSpec.ws.isSpectator = false;
                try {
                    targetSpec.ws.send(JSON.stringify({
                        type: 'PROMOTED_TO_GUEST',
                        myColor: guestColor,
                        opponentUserName: room.host.userName,
                        opponentColor: room.host.color,
                        message: `Bạn đã được Chủ phòng chọn vào thi đấu! Bạn cầm quân [${guestColor === 'red' ? 'Đỏ' : 'Đen'}].`
                    }));
                } catch (e) {}
            }

            // Reset timer về trạng thái chờ nước đi mới
            if (room.timer && room.timer.enabled) {
                room.timer.redTimeMs = room.timer.mode === 'per_move' ? room.timer.moveLimitSeconds * 1000 : room.timer.baseMinutes * 60 * 1000;
                room.timer.blackTimeMs = room.timer.mode === 'per_move' ? room.timer.moveLimitSeconds * 1000 : room.timer.baseMinutes * 60 * 1000;
                room.timer.activeSide = null;
                room.timer.isRunning = false;
                room.timer.lastTick = null;
                broadcastToRoom(room, { type: 'TIMER_SYNC', timer: room.timer });
            }

            broadcastPlayersUpdated(room);
            broadcastToRoom(room, {
                type: 'CHAT_MESSAGE',
                senderRole: 'system',
                senderName: 'Hệ thống',
                text: `⚔️ Chủ phòng đã chọn ${targetSpec.userName} vào thi đấu thay thế!`,
                time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            });
            return;
        }

        // 4. CHỦ PHÒNG CHỈNH SỬA BÀN CỜ (XẾP QUÂN)
        if (type === 'HOST_UPDATE_BOARD') {
            if (!ws.isHost) return;

            room.fen = data.fen;
            room.currentTurn = data.currentTurn || (data.fen.split(' ')[1] || 'w');

            console.log(`🛠️ [Online] Chủ phòng [${roomCode}] đã cập nhật thế cờ mới`);

            broadcastToRoom(room, {
                type: 'BOARD_UPDATED',
                fen: room.fen,
                currentTurn: room.currentTurn,
                message: 'Chủ phòng đã chỉnh sửa và cập nhật bàn cờ mới!'
            }, ws);
            return;
        }

        // 5. CHỦ PHÒNG CHỌN TỚI LƯỢT AI ĐI
        if (type === 'HOST_SET_TURN') {
            if (!ws.isHost) return;

            const newTurn = data.turn === 'b' ? 'b' : 'w';
            room.currentTurn = newTurn;

            if (room.fen) {
                const parts = room.fen.split(' ');
                parts[1] = newTurn;
                room.fen = parts.join(' ');
            }

            console.log(`🎯 [Online] Chủ phòng [${roomCode}] chọn lượt đi: ${newTurn === 'w' ? 'Đỏ' : 'Đen'}`);

            broadcastToRoom(room, {
                type: 'TURN_CHANGED',
                currentTurn: newTurn,
                fen: room.fen,
                message: `Chủ phòng đã chọn lượt đi: ${newTurn === 'w' ? 'Bên Đỏ' : 'Bên Đen'}`
            });
            return;
        }

        // 6. CHỦ PHÒNG ĐỔI BÊN (HOÁN ĐỔI ĐỎ / ĐEN)
        if (type === 'HOST_SWAP_SIDES') {
            if (!ws.isHost) return;

            const oldHostColor = room.host.color;
            room.host.color = oldHostColor === 'red' ? 'black' : 'red';
            room.guestColor = oldHostColor;
            if (room.guest) room.guest.color = room.guestColor;

            console.log(`🔄 [Online] Chủ phòng [${roomCode}] hoán đổi phe: Chủ=${room.host.color}, Khách=${room.guestColor}`);

            if (room.host && room.host.ws && room.host.ws.readyState === 1) {
                room.host.ws.send(JSON.stringify({
                    type: 'SIDES_SWAPPED',
                    myColor: room.host.color,
                    opponentColor: room.guestColor,
                    message: `Bạn đổi sang cầm quân [${room.host.color === 'red' ? 'Đỏ' : 'Đen'}]`
                }));
            }
            if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                room.guest.ws.send(JSON.stringify({
                    type: 'SIDES_SWAPPED',
                    myColor: room.guestColor,
                    opponentColor: room.host.color,
                    message: `Chủ phòng đã đổi phe! Bạn đổi sang cầm quân [${room.guestColor === 'red' ? 'Đỏ' : 'Đen'}]`
                }));
            }
            broadcastPlayersUpdated(room);
            return;
        }

        // 7. VÁN MỚI
        if (type === 'RESET_GAME') {
            if (!ws.isHost) return;

            room.fen = data.fen || DEFAULT_XIANGQI_FEN;
            room.currentTurn = 'w';

            // Reset timer về trạng thái ban đầu
            if (room.timer && room.timer.enabled) {
                room.timer.redTimeMs = room.timer.mode === 'per_move' ? room.timer.moveLimitSeconds * 1000 : room.timer.baseMinutes * 60 * 1000;
                room.timer.blackTimeMs = room.timer.mode === 'per_move' ? room.timer.moveLimitSeconds * 1000 : room.timer.baseMinutes * 60 * 1000;
                room.timer.activeSide = null;
                room.timer.isRunning = false;
                room.timer.lastTick = null;
            }

            console.log(`🆕 [Online] Chủ phòng [${roomCode}] bắt đầu ván mới`);

            broadcastToRoom(room, {
                type: 'GAME_RESET',
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer,
                message: 'Chủ phòng đã khởi tạo ván cờ mới!'
            });
            return;
        }

        // 8. TIN NHẮN CHAT TRONG TRẬN (CHỦ, KHÁCH VÀ KHÁN GIẢ ĐỀU ĐƯỢC CHAT)
        if (type === 'CHAT') {
            const text = String(data.text || '').trim();
            if (!text) return;
            const senderRole = ws.isHost ? 'host' : (ws.isSpectator ? 'spectator' : 'guest');
            let senderName = data.senderName || ws.userName || (ws.isHost ? 'Chủ phòng' : (ws.isSpectator ? 'Khán giả' : 'Khách'));
            if (ws.isSpectator && !senderName.includes('Khán giả')) {
                senderName = `[Khán giả] ${senderName}`;
            }
            const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

            const payload = {
                type: 'CHAT_MESSAGE',
                senderRole,
                senderName,
                senderUserId: ws.userId,
                text: text.slice(0, 250),
                time
            };

            broadcastToRoom(room, payload);
            return;
        }

        // 8.1. ĐỔI TÊN HIỂN THỊ (USERNAME) TRONG TRẬN
        if (type === 'SET_USERNAME') {
            const newName = String(data.userName || '').trim().slice(0, 25);
            if (!newName) return;
            ws.userName = newName;
            if (ws.isHost && room.host) room.host.userName = newName;
            else if (!ws.isHost && !ws.isSpectator && room.guest) room.guest.userName = newName;
            else if (ws.isSpectator && room.spectators.has(ws.userId)) {
                room.spectators.get(ws.userId).userName = newName;
            }

            broadcastPlayersUpdated(room);
            broadcastToRoom(room, {
                type: 'OPPONENT_RENAMED',
                role: ws.isHost ? 'host' : (ws.isSpectator ? 'spectator' : 'guest'),
                userId: ws.userId,
                newName: newName
            }, ws);
            return;
        }

        // 9. WEBRTC AUDIO & VIDEO SIGNALING RELAY (CAMERA + MICROPHONE)
        if (type === 'WEBRTC_OFFER' || type === 'WEBRTC_ANSWER' || type === 'WEBRTC_ICE' || type === 'VOICE_STATUS' || type === 'CAMERA_STATUS') {
            // Khán giả KHÔNG ĐƯỢC PHÉP bật camera!
            if (ws.isSpectator && type === 'CAMERA_STATUS' && data.isCameraActive) {
                return ws.send(JSON.stringify({
                    type: 'ERROR',
                    message: 'Khán giả chỉ có thể bật Mic, không thể bật Camera!'
                }));
            }

            // Gắn thông tin người gửi
            data.fromUserId = ws.userId;
            data.fromRole = ws.isHost ? 'host' : (ws.isSpectator ? 'spectator' : 'guest');

            // Nếu có chỉ định targetUserId -> gửi tới đích
            if (data.targetUserId) {
                let targetWs = null;
                if (room.host && room.host.userId === data.targetUserId) targetWs = room.host.ws;
                else if (room.guest && room.guest.userId === data.targetUserId) targetWs = room.guest.ws;
                else if (room.spectators && room.spectators.has(data.targetUserId)) targetWs = room.spectators.get(data.targetUserId).ws;

                if (targetWs && targetWs.readyState === 1) {
                    targetWs.send(JSON.stringify(data));
                }
                return;
            }

            // Mặc định relay giữa Chủ phòng và Khách đấu
            if (type === 'CAMERA_STATUS') {
                // Broadcast trạng thái camera tới toàn phòng để khán giả cũng thấy avatar/trạng thái
                broadcastToRoom(room, data);
            } else {
                const opponent = ws.isHost ? room.guest : room.host;
                if (opponent && opponent.ws && opponent.ws.readyState === 1) {
                    opponent.ws.send(JSON.stringify(data));
                }
            }
            return;
        }

        // 10. RỜI PHÒNG RÕ RÀNG (BẤM NÚT "RỜI PHÒNG")
        if (type === 'LEAVE_ROOM') {
            handleClientExplicitLeave(ws);
            return;
        }
    });

    // MẤT KẾT NỐI DO MẠNG / F5 / ĐÓNG TAB (ÁP DỤNG THỜI GIAN CHỜ GRACE PERIOD 90S)
    ws.on('close', () => {
        handleClientNetworkDrop(ws);
    });

    ws.on('error', (err) => {
        console.error('⚠️ [WebSocket] Lỗi kết nối client:', err.message);
        handleClientNetworkDrop(ws);
    });
});

// Xử lý khi rớt mạng tạm thời (giữ phòng trong 90s để kết nối lại)
function handleClientNetworkDrop(ws) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) return;

    const room = rooms.get(ws.roomCode);
    const roomCode = ws.roomCode;

    // A) KHÁN GIẢ RỚT MẠNG
    if (ws.isSpectator) {
        if (room.spectators && room.spectators.has(ws.userId)) {
            room.spectators.delete(ws.userId);
            console.log(`👁️ [Online] Khán giả [${ws.userName || ws.userId}] rời phòng [${roomCode}] do ngắt kết nối.`);
            broadcastPlayersUpdated(room);
        }
        return;
    }

    // B) CHỦ PHÒNG RỚT MẠNG
    if (ws.isHost && room.host && room.host.ws === ws) {
        room.host.connected = false;
        room.host.ws = null;
        console.log(`⏳ [Online] Chủ phòng [${roomCode}] tạm thời mất kết nối. Giữ phòng trong ${RECONNECT_GRACE_MS / 1000}s...`);

        if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
            room.guest.ws.send(JSON.stringify({
                type: 'PLAYER_DISCONNECTED',
                role: 'host',
                message: 'Chủ phòng tạm thời mất mạng... Đang chờ kết nối lại.'
            }));
        }

        room.host.disconnectTimer = setTimeout(() => {
            console.log(`⏰ [Online] Hết hạn chờ chủ phòng kết nối lại phòng [${roomCode}].`);
            if (room.isPermanent) {
                room.host = null;
                // Nếu khách vẫn còn trong phòng cố định, chuyển quyền chủ phòng cho khách
                if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                    room.host = room.guest;
                    room.guest = null;
                    room.host.ws.isHost = true;
                    room.host.ws.send(JSON.stringify({
                        type: 'PROMOTED_TO_HOST',
                        message: 'Chủ phòng trước đã rời đi. Bạn được chuyển thành Chủ phòng mới!'
                    }));
                } else if (!room.guest || !room.guest.connected) {
                    room.guest = null;
                    room.fen = DEFAULT_XIANGQI_FEN;
                    room.currentTurn = 'w';
                }
                broadcastPlayersUpdated(room);
            } else {
                if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                    room.guest.ws.send(JSON.stringify({
                        type: 'HOST_LEFT',
                        message: 'Chủ phòng đã rời phòng. Phòng đấu kết thúc.'
                    }));
                    room.guest.ws.roomCode = null;
                }
                broadcastToRoom(room, {
                    type: 'HOST_LEFT',
                    message: 'Chủ phòng đã rời phòng. Phòng đấu kết thúc.'
                });
                rooms.delete(roomCode);
            }
        }, RECONNECT_GRACE_MS);

    // C) KHÁCH ĐẤU RỚT MẠNG
    } else if (!ws.isHost && room.guest && room.guest.ws === ws) {
        room.guest.connected = false;
        room.guest.ws = null;
        console.log(`⏳ [Online] Khách [${roomCode}] tạm thời mất kết nối. Giữ slot trong ${RECONNECT_GRACE_MS / 1000}s...`);

        if (room.host && room.host.ws && room.host.ws.readyState === 1) {
            room.host.ws.send(JSON.stringify({
                type: 'PLAYER_DISCONNECTED',
                role: 'guest',
                message: 'Đối thủ tạm thời mất mạng... Đang chờ kết nối lại.'
            }));
        }

        room.guest.disconnectTimer = setTimeout(() => {
            console.log(`⏰ [Online] Hết hạn chờ khách kết nối lại phòng [${roomCode}].`);
            room.guest = null;
            if (room.host && room.host.ws && room.host.ws.readyState === 1) {
                room.host.ws.send(JSON.stringify({
                    type: 'GUEST_LEFT',
                    message: 'Đối thủ đã rời phòng. Bạn có thể chọn khán giả vào thi đấu tiếp!'
                }));
            }
            if (room.isPermanent && (!room.host || !room.host.connected)) {
                room.host = null;
                room.fen = DEFAULT_XIANGQI_FEN;
                room.currentTurn = 'w';
            }
            broadcastPlayersUpdated(room);
        }, RECONNECT_GRACE_MS);
    }
}

// Xử lý khi người chơi bấm nút "Rời phòng" chủ động (thoát tức thì không cần chờ)
function handleClientExplicitLeave(ws) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) return;

    const room = rooms.get(ws.roomCode);
    const roomCode = ws.roomCode;

    // A) KHÁN GIẢ RỜI PHÒNG
    if (ws.isSpectator) {
        if (room.spectators && room.spectators.has(ws.userId)) {
            room.spectators.delete(ws.userId);
            console.log(`👁️ [Online] Khán giả [${ws.userName || ws.userId}] chủ động rời phòng [${roomCode}].`);
            broadcastPlayersUpdated(room);
        }
        ws.roomCode = null;
        return;
    }

    // B) CHỦ PHÒNG RỜI PHÒNG
    if (ws.isHost) {
        if (room.host?.disconnectTimer) clearTimeout(room.host.disconnectTimer);
        console.log(`🚪 [Online] Chủ phòng [${roomCode}] chủ động rời phòng.`);

        if (room.isPermanent) {
            room.host = null;
            if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                room.host = room.guest;
                room.guest = null;
                room.host.ws.isHost = true;
                room.host.ws.send(JSON.stringify({
                    type: 'PROMOTED_TO_HOST',
                    message: 'Chủ phòng trước đã rời đi. Bạn được chuyển thành Chủ phòng mới!'
                }));
            } else {
                room.guest = null;
                room.fen = DEFAULT_XIANGQI_FEN;
                room.currentTurn = 'w';
            }
            broadcastPlayersUpdated(room);
        } else {
            broadcastToRoom(room, {
                type: 'HOST_LEFT',
                message: 'Chủ phòng đã rời phòng. Phòng đấu kết thúc.'
            });
            if (room.guest && room.guest.ws) room.guest.ws.roomCode = null;
            if (room.spectators) room.spectators.forEach(s => { if (s.ws) s.ws.roomCode = null; });
            rooms.delete(roomCode);
        }

    // C) KHÁCH RỜI PHÒNG
    } else {
        if (room.guest?.disconnectTimer) clearTimeout(room.guest.disconnectTimer);
        console.log(`🚪 [Online] Khách [${roomCode}] chủ động rời phòng.`);
        room.guest = null;
        if (room.host && room.host.ws && room.host.ws.readyState === 1) {
            room.host.ws.send(JSON.stringify({
                type: 'GUEST_LEFT',
                message: 'Đối thủ đã rời phòng. Bạn có thể chọn khán giả vào thi đấu tiếp!'
            }));
        }
        if (room.isPermanent && (!room.host || !room.host.connected)) {
            room.host = null;
            room.fen = DEFAULT_XIANGQI_FEN;
            room.currentTurn = 'w';
        }
        broadcastPlayersUpdated(room);
    }

    ws.roomCode = null;
}

// Bật Server
server.listen(port, '0.0.0.0', () => {
    console.log(`\n✅ Máy chủ đã chạy thành công trên cổng ${port}!`);
    console.log(`🎮 Truy cập: http://0.0.0.0:${port}\n`);
});