// file: server.js
process.env.TZ = 'Asia/Ho_Chi_Minh';
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch'); // Đảm bảo bạn đã cài node-fetch@2
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');

// Nạp biến môi trường từ file .env (nếu có) — không cần cài thêm thư viện dotenv
(function loadDotEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    try {
        fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (!match || process.env[match[1]] !== undefined) return;
            process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
        });
    } catch (e) {
        console.error('⚠️ Không đọc được file .env:', e.message);
    }
})();

// Helper định dạng giờ Việt Nam (GMT+7)
function getVietnamTimeString() {
    return new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false
    });
}

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

// ----------------------------------------------------
// ICE SERVERS (STUN + TURN) CHO VOICE / CAMERA WEBRTC
// Không có TURN thì người dùng ở các mạng khác nhau (4G, wifi công ty...) thường KHÔNG kết nối được với nhau.
// Cấu hình qua biến môi trường (xem file .env.example):
//   - Cloudflare:  CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN
//   - Metered.ca:  METERED_TURN_DOMAIN + METERED_TURN_API_KEY
//   - coturn:      TURN_URLS + TURN_SECRET (static-auth-secret)  hoặc  TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL
// ----------------------------------------------------
const PUBLIC_STUN_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
];
const ICE_TTL_SECONDS = 12 * 60 * 60;
let iceProviderCache = { servers: null, expiresAt: 0, failUntil: 0 };

function splitEnvList(value) {
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
}

function getTurnProviderName() {
    if (process.env.TURN_URLS && (process.env.TURN_SECRET || (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL))) return 'coturn';
    if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) return 'Cloudflare';
    if (process.env.METERED_TURN_DOMAIN && process.env.METERED_TURN_API_KEY) return 'Metered';
    return null;
}

// Trình duyệt chặn cổng 53 → bỏ các URL đó để tránh ICE bị treo chờ timeout
function sanitizeIceServers(list) {
    return (list || []).map((server) => {
        const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(u => typeof u === 'string' && !/:53(\?|$)/.test(u));
        return urls.length ? { ...server, urls } : null;
    }).filter(Boolean);
}

async function fetchProviderTurnServers() {
    const now = Date.now();
    if (iceProviderCache.servers && iceProviderCache.expiresAt > now) return iceProviderCache.servers;
    if (iceProviderCache.failUntil > now) return null;

    let servers = null;
    try {
        if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
            const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(process.env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ttl: ICE_TTL_SECONDS * 2 }),
                timeout: 5000
            });
            if (!res.ok) throw new Error(`Cloudflare TURN HTTP ${res.status}`);
            const data = await res.json();
            servers = Array.isArray(data.iceServers) ? data.iceServers : (data.iceServers ? [data.iceServers] : null);
        } else if (process.env.METERED_TURN_DOMAIN && process.env.METERED_TURN_API_KEY) {
            const res = await fetch(`https://${process.env.METERED_TURN_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_TURN_API_KEY)}`, { timeout: 5000 });
            if (!res.ok) throw new Error(`Metered TURN HTTP ${res.status}`);
            const data = await res.json();
            servers = Array.isArray(data) ? data : (data.iceServers || null);
        }
    } catch (e) {
        console.error('⚠️ [TURN] Không lấy được TURN credentials:', e.message);
        iceProviderCache.failUntil = now + 60 * 1000;
        return null;
    }

    servers = sanitizeIceServers(servers);
    if (servers.length) iceProviderCache = { servers, expiresAt: now + ICE_TTL_SECONDS * 1000, failUntil: 0 };
    return servers.length ? servers : null;
}

function buildCoturnServers(userId) {
    const urls = splitEnvList(process.env.TURN_URLS);
    if (urls.length === 0) return null;
    if (process.env.TURN_SECRET) {
        // TURN REST API: username = "<hết hạn>:<uid>", credential = HMAC-SHA1(secret, username)
        const expiry = Math.floor(Date.now() / 1000) + ICE_TTL_SECONDS;
        const safeUid = String(userId || 'guest').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'guest';
        const username = `${expiry}:${safeUid}`;
        const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
        return [{ urls, username, credential }];
    }
    if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        return [{ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }];
    }
    return null;
}

app.get('/api/ice-servers', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const uid = String(req.query.uid || '').slice(0, 64);
    // Chỉ cấp TURN cho người đang ở trong 1 phòng online (tránh người ngoài lấy credentials dùng chùa băng thông TURN)
    if (getTurnProviderName() && !isUserInAnyRoom(uid)) {
        return res.json({ iceServers: PUBLIC_STUN_SERVERS, hasTurn: false, ttl: 60 });
    }
    let turnServers = buildCoturnServers(uid);
    if (!turnServers) turnServers = await fetchProviderTurnServers();
    res.json({
        iceServers: [...PUBLIC_STUN_SERVERS, ...(turnServers || [])],
        hasTurn: !!(turnServers && turnServers.length),
        ttl: ICE_TTL_SECONDS
    });
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
// Giới hạn kích thước 1 tin nhắn (SDP/ICE chỉ vài KB) để tránh client xấu gửi tin cực lớn làm đầy RAM server
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

const DEFAULT_XIANGQI_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const FIXED_ROOM_CODE = '013579';
const RECONNECT_GRACE_MS = 90000; // 90 giây chờ kết nối lại nếu rớt mạng (áp dụng cho cả kỳ thủ & khán giả)

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
            spectators: new Map(), // userId -> { ws, userId, userName, connected, micOn, disconnectTimer }
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

function sendJson(ws, obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
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

// Tìm thành viên (host/guest/khán giả) đang dùng đúng socket này
function getMemberByWs(room, ws) {
    if (!room || !ws) return null;
    if (room.host && room.host.ws === ws) return room.host;
    if (room.guest && room.guest.ws === ws) return room.guest;
    if (room.spectators && ws.userId && room.spectators.has(ws.userId)) {
        const spec = room.spectators.get(ws.userId);
        if (spec.ws === ws) return spec;
    }
    return null;
}

function getMemberSocketByUserId(room, userId) {
    if (!room || !userId) return null;
    if (room.host && room.host.userId === userId) return room.host.ws;
    if (room.guest && room.guest.userId === userId) return room.guest.ws;
    if (room.spectators && room.spectators.has(userId)) return room.spectators.get(userId).ws;
    return null;
}

function isUserInAnyRoom(userId) {
    if (!userId) return false;
    for (const room of rooms.values()) {
        if ((room.host && room.host.userId === userId) || (room.guest && room.guest.userId === userId)) return true;
        if (room.spectators && room.spectators.has(userId)) return true;
    }
    return false;
}

function publicMember(m) {
    if (!m) return null;
    return {
        userId: m.userId,
        userName: m.userName,
        color: m.color,
        connected: m.connected !== false,
        micOn: !!m.micOn,
        camOn: !!m.camOn
    };
}

// Khi cùng 1 người (cùng UID) vào lại từ tab/thiết bị khác, báo cho phiên cũ biết để không còn "phiên ma"
function retireOldSocket(oldWs, newWs) {
    if (!oldWs || oldWs === newWs) return;
    if (oldWs.readyState === 1) {
        sendJson(oldWs, { type: 'SESSION_REPLACED', message: 'Bạn vừa vào phòng này từ một tab/thiết bị khác.' });
    }
    oldWs.roomCode = null;
}

function connectedSpectatorCount(room) {
    let count = 0;
    if (room && room.spectators) room.spectators.forEach(s => { if (s.connected !== false) count++; });
    return count;
}

// Helper thông báo danh sách kỳ thủ & khán giả cập nhật
function broadcastPlayersUpdated(room) {
    if (!room) return;
    const specsList = [];
    if (room.spectators) {
        room.spectators.forEach((spec) => {
            specsList.push(publicMember(spec));
        });
    }

    const payload = {
        type: 'ROOM_PLAYERS_UPDATED',
        host: publicMember(room.host),
        guest: publicMember(room.guest),
        spectators: specsList,
        spectatorCount: connectedSpectatorCount(room)
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

// ========================================================
// XIN HỒI NƯỚC (UNDO)
// Mỗi nước đi lưu thế cờ trước/sau → chỉ hồi được khi lịch sử khớp thế cờ hiện tại
// (tự vô hiệu sau khi chủ phòng xếp lại bàn, đổi lượt, ván mới...).
// ========================================================
const UNDO_REQUEST_TIMEOUT_MS = 20000;
const UNDO_DECLINE_COOLDOWN_MS = 10000;
const MAX_MOVE_HISTORY = 400;

function recordMoveHistory(room, fenBefore, turnBefore, fenAfter, moveCommand) {
    if (!room.moveHistory) room.moveHistory = [];
    room.moveHistory.push({ fenBefore, turnBefore, fenAfter, moveCommand });
    if (room.moveHistory.length > MAX_MOVE_HISTORY) room.moveHistory.shift();
}

// Số nước cần hồi để người xin quay lại đúng lượt của mình (1 nếu vừa đi, 2 nếu đối thủ đã đáp lại)
function getUndoPlan(room, player) {
    const hist = room.moveHistory || [];
    const myTurn = player.color === 'red' ? 'w' : 'b';
    const plies = room.currentTurn === myTurn ? 2 : 1;
    if (hist.length < plies) return null;
    const last = hist[hist.length - 1];
    if (last.fenAfter !== room.fen) return null; // lịch sử đã cũ (bàn cờ bị đổi bằng cách khác)
    if (plies === 2 && hist[hist.length - 2].fenAfter !== last.fenBefore) return null;
    const target = hist[hist.length - plies];
    if (target.turnBefore !== myTurn) return null; // nước cần hồi không phải của người xin
    return { plies, historyLen: hist.length };
}

function cancelUndoRequest(room, message) {
    const req = room && room.undoRequest;
    if (!req) return;
    clearTimeout(req.timer);
    room.undoRequest = null;
    [room.host, room.guest].forEach((p) => {
        if (p) sendJson(p.ws, { type: 'UNDO_CANCELLED', message: message || 'Lời xin hồi nước đã bị huỷ.' });
    });
}

// Tên kỳ thủ cầm 1 màu (an toàn khi chủ phòng/khách đang trống)
function getPlayerNameByColor(room, color) {
    if (room.host && room.host.color === color) return room.host.userName;
    if (room.guest && room.guest.color === color) return room.guest.userName;
    return color === 'red' ? 'Bên Đỏ' : 'Bên Đen';
}

// Timer Tick Checker: Đếm ngược thời gian và xử lý Hết Giờ (Timeout)
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        try {
            checkRoomTimeout(code, room, now);
        } catch (err) {
            console.error(`⚠️ [Online] Lỗi kiểm tra đồng hồ phòng [${code}]:`, err);
        }
    }
}, 500);

function checkRoomTimeout(code, room, now) {
    if (!room.timer || !room.timer.enabled || !room.timer.isRunning || !room.timer.lastTick || !room.timer.activeSide) {
        return;
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

    if (!timeoutOccurred) return;

    room.timer.isRunning = false;
    room.timer.lastTick = null;
    const winnerSide = loserSide === 'red' ? 'black' : 'red';
    const loserName = getPlayerNameByColor(room, loserSide);
    const winnerName = getPlayerNameByColor(room, winnerSide);

    console.log(`⏰ [Online] Hết giờ phòng [${code}]: ${loserName} (${loserSide}) thua do ${timeoutReason}, ${winnerName} (${winnerSide}) thắng!`);

    broadcastToRoom(room, {
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
    });
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (messageRaw) => {
        // Bọc try/catch: 1 tin nhắn lỗi định dạng không được phép làm sập toàn bộ server (mất hết các phòng)
        try {
            handleSocketMessage(ws, messageRaw);
        } catch (err) {
            console.error('⚠️ [WebSocket] Lỗi xử lý tin nhắn:', err);
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

const RTC_RELAY_FIELDS = ['pcId', 'toPcId', 'offer', 'answer', 'candidate', 'reason', 'knownRemotePcId', 'isMicActive', 'isCameraActive', 'silent'];

function handleSocketMessage(ws, messageRaw) {
    ws.isAlive = true;
    let data;
    try {
        data = JSON.parse(messageRaw);
    } catch (e) {
        return;
    }
    if (!data || typeof data !== 'object') return;

    const { type } = data;
    const userId = data.userId ? String(data.userId).trim().slice(0, 64) : null;
    const userName = data.userName ? String(data.userName).trim().slice(0, 25) : null;

    // 0. PING ỨNG DỤNG: client kiểm tra kết nối còn sống khi vừa mở lại app trên điện thoại
    if (type === 'PING') {
        sendJson(ws, { type: 'PONG' });
        return;
    }

    // 1. TẠO PHÒNG MỚI (PHÒNG RIÊNG TƯ)
    if (type === 'CREATE_ROOM') {
        const roomCode = generateRoomCode();
        const hostColor = data.hostColor === 'black' ? 'black' : 'red';
        const guestColor = hostColor === 'red' ? 'black' : 'red';
        const fen = (typeof data.initialFen === 'string' && data.initialFen.length < 200) ? data.initialFen : DEFAULT_XIANGQI_FEN;
        const currentTurn = fen.split(' ')[1] || 'w';
        const hostName = userName || 'Chủ phòng';

        const room = {
            code: roomCode,
            isPermanent: false,
            host: { ws, userId, userName: hostName, color: hostColor, connected: true, disconnectTimer: null, micOn: false, camOn: false },
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

        sendJson(ws, {
            type: 'ROOM_CREATED',
            roomCode,
            myColor: hostColor,
            myUserName: hostName,
            guestColor,
            fen,
            currentTurn,
            timer: room.timer,
            spectatorCount: 0
        });
        broadcastPlayersUpdated(room);
        return;
    }

    // 2. VÀO PHÒNG (BẰNG MÃ HOẶC PHÒNG CỐ ĐỊNH 013579 HOẶC KẾT NỐI LẠI)
    if (type === 'JOIN_ROOM') {
        handleJoinRoom(ws, data, userId, userName);
        return;
    }

    // Các hành động sau yêu cầu đã ở trong phòng
    const roomCode = ws.roomCode || data.roomCode;
    const room = rooms.get(roomCode);
    if (!room) return;

    // Bàn cờ sắp thay đổi → huỷ lời xin hồi nước đang chờ
    if (room.undoRequest && ['MOVE', 'RESET_GAME', 'HOST_UPDATE_BOARD', 'HOST_SET_TURN', 'HOST_SWAP_SIDES', 'SUBSTITUTE_GUEST', 'LEAVE_ROOM'].includes(type)) {
        cancelUndoRequest(room, type === 'MOVE' ? 'Lời xin hồi nước đã huỷ vì có nước đi mới.' : 'Lời xin hồi nước đã huỷ vì bàn cờ thay đổi.');
    }

    // 3. ĐI QUÂN (MOVE) - CHỈ CHỦ HOẶC KHÁCH MỚI ĐƯỢC PHÉP ĐI QUÂN
    if (type === 'MOVE') {
        if (ws.isSpectator) {
            return sendJson(ws, {
                type: 'ERROR',
                message: 'Bạn đang ở chế độ xem cờ! Không thể đi quân.'
            });
        }

        const mover = (room.host && room.host.ws === ws) ? room.host : ((room.guest && room.guest.ws === ws) ? room.guest : null);
        if (!mover) {
            return sendJson(ws, { type: 'ERROR', message: 'Bạn không còn là kỳ thủ trong phòng này!' });
        }

        const prevTurn = room.currentTurn || (room.fen.split(' ')[1] || 'w');
        const moverTurn = mover.color === 'red' ? 'w' : 'b';
        const newFen = typeof data.newFen === 'string' && data.newFen.length < 200 ? data.newFen : null;
        if (moverTurn !== prevTurn || !newFen) {
            // Nước đi không hợp lệ (lệch lượt do mạng chậm / đổi bên cùng lúc) → trả về thế cờ chuẩn để client đồng bộ lại
            return sendJson(ws, {
                type: 'MOVE_REJECTED',
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer,
                message: 'Nước đi không hợp lệ hoặc chưa tới lượt — bàn cờ đã được đồng bộ lại.'
            });
        }

        const fenBefore = room.fen;
        room.fen = newFen;
        const nextTurn = data.nextTurn === 'b' || data.nextTurn === 'w' ? data.nextTurn : (room.fen.split(' ')[1] || 'w');
        room.currentTurn = nextTurn;
        recordMoveHistory(room, fenBefore, prevTurn, room.fen, typeof data.moveCommand === 'string' ? data.moveCommand.slice(0, 8) : null);

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
            moveCommand: typeof data.moveCommand === 'string' ? data.moveCommand.slice(0, 8) : null,
            fen: room.fen,
            currentTurn: room.currentTurn,
            timer: room.timer
        });

        // Gửi cho đối thủ
        const opponent = mover === room.host ? room.guest : room.host;
        if (opponent && opponent.ws && opponent.ws.readyState === 1) {
            try { opponent.ws.send(movePayload); } catch (e) {}
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
            return sendJson(ws, { type: 'ERROR', message: 'Chỉ Chủ phòng mới có quyền cài đặt đồng hồ!' });
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
        if (!ws.isHost || !room.host) {
            return sendJson(ws, { type: 'ERROR', message: 'Chỉ Chủ phòng mới có quyền thay đổi kỳ thủ!' });
        }

        const targetUserId = data.targetUserId ? String(data.targetUserId).trim() : null;
        if (!targetUserId || !room.spectators || !room.spectators.has(targetUserId)) {
            return sendJson(ws, { type: 'ERROR', message: 'Không tìm thấy khán giả này trong phòng!' });
        }

        const targetSpec = room.spectators.get(targetUserId);
        if (targetSpec.connected === false || !targetSpec.ws || targetSpec.ws.readyState !== 1) {
            return sendJson(ws, { type: 'ERROR', message: 'Khán giả này đang mất kết nối, hãy chọn người khác!' });
        }
        if (targetSpec.disconnectTimer) {
            clearTimeout(targetSpec.disconnectTimer);
            targetSpec.disconnectTimer = null;
        }

        const oldGuest = room.guest;
        const guestColor = room.guestColor || (room.host.color === 'red' ? 'black' : 'red');

        console.log(`🔄 [Online] Chủ phòng [${roomCode}] đổi người: ${targetSpec.userName} vào đánh thay cho ${oldGuest ? oldGuest.userName : 'vị trí trống'}`);

        // Khách cũ: nếu còn kết nối thì chuyển xuống làm Khán giả, nếu đang rớt mạng thì giải phóng luôn
        if (oldGuest) {
            if (oldGuest.disconnectTimer) {
                clearTimeout(oldGuest.disconnectTimer);
                oldGuest.disconnectTimer = null;
            }
            if (oldGuest.userId && oldGuest.connected !== false && oldGuest.ws && oldGuest.ws.readyState === 1) {
                oldGuest.ws.isHost = false;
                oldGuest.ws.isSpectator = true;
                sendJson(oldGuest.ws, {
                    type: 'DEMOTED_TO_SPECTATOR',
                    message: 'Bạn đã được chuyển sang chế độ Khán giả xem cờ.'
                });
                room.spectators.set(oldGuest.userId, {
                    ws: oldGuest.ws,
                    userId: oldGuest.userId,
                    userName: oldGuest.userName,
                    connected: true,
                    micOn: !!oldGuest.micOn,
                    camOn: false,
                    disconnectTimer: null
                });
            }
        }

        // Khán giả được chọn nâng lên thành Khách thi đấu
        room.spectators.delete(targetUserId);
        room.guest = {
            ws: targetSpec.ws,
            userId: targetSpec.userId,
            userName: targetSpec.userName,
            color: guestColor,
            connected: true,
            disconnectTimer: null,
            micOn: !!targetSpec.micOn,
            camOn: false
        };

        targetSpec.ws.isHost = false;
        targetSpec.ws.isSpectator = false;
        sendJson(targetSpec.ws, {
            type: 'PROMOTED_TO_GUEST',
            myColor: guestColor,
            opponentUserName: room.host.userName,
            opponentColor: room.host.color,
            message: `Bạn đã được Chủ phòng chọn vào thi đấu! Bạn cầm quân [${guestColor === 'red' ? 'Đỏ' : 'Đen'}].`
        });

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
            time: getVietnamTimeString()
        });
        return;
    }

    // 4. CHỦ PHÒNG CHỈNH SỬA BÀN CỜ (XẾP QUÂN)
    if (type === 'HOST_UPDATE_BOARD') {
        if (!ws.isHost) return;
        if (typeof data.fen !== 'string' || data.fen.length > 200) return;

        room.fen = data.fen;
        room.currentTurn = data.currentTurn === 'b' || data.currentTurn === 'w' ? data.currentTurn : (data.fen.split(' ')[1] || 'w');

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
        if (!ws.isHost || !room.host) return;

        const oldHostColor = room.host.color;
        room.host.color = oldHostColor === 'red' ? 'black' : 'red';
        room.guestColor = oldHostColor;
        if (room.guest) room.guest.color = room.guestColor;

        console.log(`🔄 [Online] Chủ phòng [${roomCode}] hoán đổi phe: Chủ=${room.host.color}, Khách=${room.guestColor}`);

        sendJson(room.host.ws, {
            type: 'SIDES_SWAPPED',
            myColor: room.host.color,
            opponentColor: room.guestColor,
            message: `Bạn đổi sang cầm quân [${room.host.color === 'red' ? 'Đỏ' : 'Đen'}]`
        });
        if (room.guest) {
            sendJson(room.guest.ws, {
                type: 'SIDES_SWAPPED',
                myColor: room.guestColor,
                opponentColor: room.host.color,
                message: `Chủ phòng đã đổi phe! Bạn đổi sang cầm quân [${room.guestColor === 'red' ? 'Đỏ' : 'Đen'}]`
            });
        }
        broadcastPlayersUpdated(room);
        return;
    }

    // 7. VÁN MỚI
    if (type === 'RESET_GAME') {
        if (!ws.isHost) return;

        room.fen = (typeof data.fen === 'string' && data.fen.length < 200) ? data.fen : DEFAULT_XIANGQI_FEN;
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

    // 7.1. XIN HỒI NƯỚC (KỲ THỦ XIN ĐI LẠI NƯỚC VỪA RỒI, ĐỐI THỦ QUYẾT ĐỊNH)
    if (type === 'UNDO_REQUEST') {
        const me = (room.host && room.host.ws === ws) ? room.host : ((room.guest && room.guest.ws === ws) ? room.guest : null);
        if (!me) return sendJson(ws, { type: 'ERROR', message: 'Chỉ kỳ thủ đang đấu mới được xin hồi nước.' });
        const opp = me === room.host ? room.guest : room.host;
        if (!opp || opp.connected === false || !opp.ws || opp.ws.readyState !== 1) {
            return sendJson(ws, { type: 'UNDO_DECLINED', message: 'Đối thủ chưa vào phòng hoặc đang mất mạng.' });
        }
        if (room.undoRequest) return sendJson(ws, { type: 'UNDO_DECLINED', message: 'Đang có một lời xin hồi nước chờ trả lời.' });
        if (me.undoCooldownUntil && me.undoCooldownUntil > Date.now()) {
            return sendJson(ws, { type: 'UNDO_DECLINED', message: 'Vui lòng chờ vài giây rồi hãy xin lại.' });
        }
        const plan = getUndoPlan(room, me);
        if (!plan) return sendJson(ws, { type: 'UNDO_DECLINED', message: 'Chưa có nước nào của bạn để hồi.' });

        room.undoRequest = {
            fromUserId: me.userId,
            plies: plan.plies,
            historyLen: plan.historyLen,
            timer: setTimeout(() => {
                if (!room.undoRequest || room.undoRequest.fromUserId !== me.userId) return;
                room.undoRequest = null;
                me.undoCooldownUntil = Date.now() + UNDO_DECLINE_COOLDOWN_MS;
                sendJson(me.ws, { type: 'UNDO_DECLINED', message: 'Đối thủ không trả lời lời xin hồi nước.' });
                sendJson(opp.ws, { type: 'UNDO_CANCELLED', message: 'Đã hết thời gian trả lời lời xin hồi nước.' });
            }, UNDO_REQUEST_TIMEOUT_MS)
        };
        sendJson(opp.ws, { type: 'UNDO_REQUESTED', fromName: me.userName, plies: plan.plies, timeoutSec: UNDO_REQUEST_TIMEOUT_MS / 1000 });
        sendJson(ws, { type: 'UNDO_PENDING', plies: plan.plies, timeoutSec: UNDO_REQUEST_TIMEOUT_MS / 1000 });
        return;
    }

    if (type === 'UNDO_RESPONSE') {
        const req = room.undoRequest;
        const me = (room.host && room.host.ws === ws) ? room.host : ((room.guest && room.guest.ws === ws) ? room.guest : null);
        if (!req || !me || me.userId === req.fromUserId) return;
        const requester = [room.host, room.guest].find(p => p && p.userId === req.fromUserId);
        clearTimeout(req.timer);
        room.undoRequest = null;
        if (!requester) return;

        const plan = getUndoPlan(room, requester);
        if (!data.accept || !plan || plan.plies !== req.plies || plan.historyLen !== req.historyLen) {
            requester.undoCooldownUntil = Date.now() + UNDO_DECLINE_COOLDOWN_MS;
            sendJson(requester.ws, { type: 'UNDO_DECLINED', message: data.accept ? 'Không thể hồi nước vì bàn cờ đã thay đổi.' : `${me.userName} không đồng ý cho hồi nước.` });
            sendJson(ws, { type: 'UNDO_CANCELLED' });
            return;
        }

        const removed = room.moveHistory.splice(room.moveHistory.length - req.plies, req.plies);
        room.fen = removed[0].fenBefore;
        room.currentTurn = removed[0].turnBefore;

        // Đồng hồ: tính giờ lại cho bên được đi tiếp
        if (room.timer && room.timer.enabled) {
            if (room.timer.mode === 'per_move') {
                if (room.currentTurn === 'w') room.timer.redTimeMs = room.timer.moveLimitSeconds * 1000;
                else room.timer.blackTimeMs = room.timer.moveLimitSeconds * 1000;
            }
            if (room.timer.isRunning) {
                room.timer.activeSide = room.currentTurn;
                room.timer.lastTick = Date.now();
            }
        }

        console.log(`↩️ [Online] Phòng [${roomCode}]: ${me.userName} đồng ý cho ${requester.userName} hồi ${req.plies} nước`);
        broadcastToRoom(room, {
            type: 'MOVE_UNDONE',
            plies: req.plies,
            fen: room.fen,
            currentTurn: room.currentTurn,
            timer: room.timer,
            message: `${me.userName} đã đồng ý cho ${requester.userName} hồi nước.`
        });
        broadcastToRoom(room, {
            type: 'CHAT_MESSAGE',
            senderRole: 'system',
            senderName: 'Hệ thống',
            text: `↩️ ${requester.userName} đã được hồi nước (${req.plies === 2 ? '2 nước' : '1 nước'}).`,
            time: getVietnamTimeString()
        });
        return;
    }

    // 8. TIN NHẮN CHAT TRONG TRẬN (CHỦ, KHÁCH VÀ KHÁN GIẢ ĐỀU ĐƯỢC CHAT)
    if (type === 'CHAT') {
        const text = String(data.text || '').trim();
        if (!text) return;
        const senderRole = ws.isHost ? 'host' : (ws.isSpectator ? 'spectator' : 'guest');
        let senderName = String(data.senderName || ws.userName || (ws.isHost ? 'Chủ phòng' : (ws.isSpectator ? 'Khán giả' : 'Khách'))).slice(0, 25);
        if (ws.isSpectator && !senderName.includes('Khán giả')) {
            senderName = `[Khán giả] ${senderName}`;
        }
        const time = getVietnamTimeString();

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
        const member = getMemberByWs(room, ws);
        if (member) member.userName = newName;

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
    if (type === 'WEBRTC_OFFER' || type === 'WEBRTC_ANSWER' || type === 'WEBRTC_ICE' || type === 'WEBRTC_REQUEST' || type === 'VOICE_STATUS' || type === 'CAMERA_STATUS') {
        // Khán giả KHÔNG ĐƯỢC PHÉP bật camera!
        if (ws.isSpectator && type === 'CAMERA_STATUS' && data.isCameraActive) {
            return sendJson(ws, {
                type: 'ERROR',
                message: 'Khán giả chỉ có thể bật Mic, không thể bật Camera!'
            });
        }

        const member = getMemberByWs(room, ws);
        if (!member) return; // socket cũ (đã bị phiên khác thay thế) → bỏ qua

        // Lưu trạng thái mic/cam để người vào sau biết ai đang bật
        if (type === 'VOICE_STATUS') member.micOn = !!data.isMicActive;
        if (type === 'CAMERA_STATUS') member.camOn = !!data.isCameraActive && !ws.isSpectator;

        // Chỉ chuyển tiếp các trường cần thiết (không relay dữ liệu tùy ý từ client)
        const relay = {
            type,
            fromUserId: ws.userId,
            fromUserName: ws.userName || (ws.isHost ? 'Chủ phòng' : (ws.isSpectator ? 'Khán giả' : 'Khách')),
            fromRole: ws.isHost ? 'host' : (ws.isSpectator ? 'spectator' : 'guest')
        };
        RTC_RELAY_FIELDS.forEach((key) => {
            if (data[key] !== undefined) relay[key] = data[key];
        });

        // Nếu có chỉ định targetUserId -> gửi trực tiếp tới đích (Full Mesh P2P signaling)
        if (data.targetUserId) {
            const targetUserId = String(data.targetUserId);
            relay.targetUserId = targetUserId;
            sendJson(getMemberSocketByUserId(room, targetUserId), relay);
            return;
        }

        // Broadcast trạng thái Mic hoặc Camera tới toàn bộ thành viên khác trong phòng (bao gồm khán giả)
        if (type === 'CAMERA_STATUS' || type === 'VOICE_STATUS') {
            broadcastToRoom(room, relay, ws);
        }
        return;
    }

    // 10. RỜI PHÒNG RÕ RÀNG (BẤM NÚT "RỜI PHÒNG")
    if (type === 'LEAVE_ROOM') {
        handleClientExplicitLeave(ws);
        return;
    }
}

// Gán socket vào 1 vai trò trong phòng
function bindSocket(ws, roomCode, member, role) {
    ws.roomCode = roomCode;
    ws.isHost = role === 'host';
    ws.isSpectator = role === 'spectator';
    ws.userId = member.userId;
    ws.userName = member.userName;
}

function addSpectator(ws, room, roomCode, userId, userName) {
    const specName = userName || ('Khán giả ' + Math.floor(100 + Math.random() * 900));
    const specId = userId || ('spec_' + Math.random().toString(36).substring(2, 8));
    const spec = { ws, userId: specId, userName: specName, connected: true, micOn: false, camOn: false, disconnectTimer: null };
    room.spectators.set(specId, spec);
    bindSocket(ws, roomCode, spec, 'spectator');

    console.log(`👁️ [Online] ${specName} tham gia phòng [${roomCode}] làm KHÁN GIẢ (UID: ${specId})`);

    sendJson(ws, {
        type: 'ROOM_JOINED_SPECTATOR',
        roomCode,
        isPermanent: room.isPermanent,
        myUserName: specName,
        host: publicMember(room.host),
        guest: publicMember(room.guest),
        fen: room.fen,
        currentTurn: room.currentTurn,
        timer: room.timer,
        spectatorCount: connectedSpectatorCount(room)
    });

    broadcastPlayersUpdated(room);
    broadcastToRoom(room, {
        type: 'CHAT_MESSAGE',
        senderRole: 'system',
        senderName: 'Hệ thống',
        text: `👁️ ${specName} đã vào phòng xem cờ.`,
        time: getVietnamTimeString()
    }, ws);
}

function handleJoinRoom(ws, data, userId, userName) {
    const roomCode = String(data.roomCode || '').trim();
    let room = rooms.get(roomCode);

    if (roomCode === FIXED_ROOM_CODE) {
        room = getOrCreateFixedRoom();
    }

    if (!room) {
        return sendJson(ws, {
            type: 'ERROR',
            code: 'ROOM_NOT_FOUND',
            message: 'Mã phòng không tồn tại hoặc đã đóng!'
        });
    }

    // KIỂM TRA TRƯỜNG HỢP: NGƯỜI CHƠI KẾT NỐI LẠI (RECONNECT) BẰNG USER_ID
    if (userId) {
        // a) Chủ phòng kết nối lại
        if (room.host && room.host.userId === userId) {
            if (room.host.disconnectTimer) {
                clearTimeout(room.host.disconnectTimer);
                room.host.disconnectTimer = null;
            }
            retireOldSocket(room.host.ws, ws);
            if (userName) room.host.userName = userName;
            room.host.ws = ws;
            room.host.connected = true;
            bindSocket(ws, roomCode, room.host, 'host');

            console.log(`🔄 [Online] Chủ phòng [${roomCode}] (${room.host.userName}) kết nối lại thành công! [UID: ${userId}]`);

            sendJson(ws, {
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
                spectatorCount: connectedSpectatorCount(room)
            });

            broadcastPlayersUpdated(room);

            if (room.guest) {
                sendJson(room.guest.ws, {
                    type: 'PLAYER_RECONNECTED',
                    opponentUserName: room.host.userName,
                    message: `${room.host.userName} đã kết nối lại! Tiếp tục trận đấu.`
                });
            }
            return;
        }

        // b) Khách kết nối lại
        if (room.guest && room.guest.userId === userId) {
            if (room.guest.disconnectTimer) {
                clearTimeout(room.guest.disconnectTimer);
                room.guest.disconnectTimer = null;
            }
            retireOldSocket(room.guest.ws, ws);
            if (userName) room.guest.userName = userName;
            room.guest.ws = ws;
            room.guest.connected = true;
            bindSocket(ws, roomCode, room.guest, 'guest');

            console.log(`🔄 [Online] Khách [${roomCode}] (${room.guest.userName}) kết nối lại thành công! [UID: ${userId}]`);

            sendJson(ws, {
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
                spectatorCount: connectedSpectatorCount(room)
            });

            broadcastPlayersUpdated(room);

            if (room.host) {
                sendJson(room.host.ws, {
                    type: 'PLAYER_RECONNECTED',
                    opponentUserName: room.guest.userName,
                    message: `${room.guest.userName} đã kết nối lại! Tiếp tục trận đấu.`
                });
            }
            return;
        }

        // c) Khán giả kết nối lại (vẫn giữ chỗ trong 90s sau khi rớt mạng)
        if (room.spectators && room.spectators.has(userId)) {
            const spec = room.spectators.get(userId);
            if (spec.disconnectTimer) {
                clearTimeout(spec.disconnectTimer);
                spec.disconnectTimer = null;
            }
            retireOldSocket(spec.ws, ws);
            spec.ws = ws;
            spec.connected = true;
            if (userName) spec.userName = userName;
            bindSocket(ws, roomCode, spec, 'spectator');

            console.log(`🔄 [Online] Khán giả [${roomCode}] (${spec.userName}) kết nối lại!`);

            sendJson(ws, {
                type: 'ROOM_JOINED_SPECTATOR',
                roomCode,
                isPermanent: room.isPermanent,
                myUserName: spec.userName,
                host: publicMember(room.host),
                guest: publicMember(room.guest),
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer,
                spectatorCount: connectedSpectatorCount(room)
            });

            broadcastPlayersUpdated(room);
            return;
        }
    }

    // XỬ LÝ PHÒNG CỐ ĐỊNH 013579 (AI VÀO TRƯỚC LÀM CHỦ, VÀO SAU LÀM KHÁCH, VÀO THỨ 3+ LÀM KHÁN GIẢ)
    // Lưu ý: ghế của người đang rớt mạng được GIỮ trong 90s, người mới vào không được chiếm ghế đó.
    if (room.isPermanent) {
        if (!room.host) {
            const hostName = userName || 'Chủ phòng';
            room.host = { ws, userId, userName: hostName, color: room.hostColor || 'red', connected: true, disconnectTimer: null, micOn: false, camOn: false };
            bindSocket(ws, roomCode, room.host, 'host');

            console.log(`👑 [Fixed Room 013579] ${hostName} nhận quyền Chủ phòng (UID: ${userId})`);

            sendJson(ws, {
                type: 'ROOM_CREATED',
                roomCode,
                isPermanent: true,
                myColor: room.host.color,
                myUserName: hostName,
                guestColor: room.guestColor || 'black',
                fen: room.fen,
                currentTurn: room.currentTurn,
                timer: room.timer,
                spectatorCount: connectedSpectatorCount(room)
            });

            broadcastPlayersUpdated(room);

            if (room.guest && room.guest.connected && room.guest.ws && room.guest.ws.readyState === 1) {
                sendJson(ws, {
                    type: 'PLAYER_JOINED',
                    opponentUserName: room.guest.userName,
                    message: `${room.guest.userName} đã có sẵn trong phòng.`,
                    guestColor: room.guest.color
                });
            }
            return;
        }

        if (!room.guest) {
            const guestColor = room.host.color === 'red' ? 'black' : 'red';
            const guestName = userName || 'Khách';
            room.guest = { ws, userId, userName: guestName, color: guestColor, connected: true, disconnectTimer: null, micOn: false, camOn: false };
            bindSocket(ws, roomCode, room.guest, 'guest');

            console.log(`👥 [Fixed Room 013579] ${guestName} tham gia phòng làm Khách (UID: ${userId})`);

            sendJson(ws, {
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
                spectatorCount: connectedSpectatorCount(room)
            });

            broadcastPlayersUpdated(room);

            sendJson(room.host.ws, {
                type: 'PLAYER_JOINED',
                opponentUserName: guestName,
                message: `${guestName} đã tham gia phòng! Sẵn sàng thi đấu.`,
                guestColor: guestColor
            });
            return;
        }

        // Cả 2 slot Host & Guest đều đã có người -> NGƯỜI VÀO SAU LÀ KHÁN GIẢ (SPECTATOR)!
        addSpectator(ws, room, roomCode, userId, userName);
        return;
    }

    // XỬ LÝ PHÒNG RIÊNG TƯ (NẾU CHƯA CÓ KHÁCH -> LÀM KHÁCH; ĐÃ ĐỦ 2 NGƯỜI -> LÀM KHÁN GIẢ)
    if (!room.guest) {
        const guestName = userName || 'Khách';
        room.guest = { ws, userId, userName: guestName, color: room.guestColor, connected: true, disconnectTimer: null, micOn: false, camOn: false };
        bindSocket(ws, roomCode, room.guest, 'guest');

        console.log(`👥 [Online] ${guestName} đã tham gia phòng: [${roomCode}] (${room.guestColor})`);

        sendJson(ws, {
            type: 'ROOM_JOINED',
            roomCode,
            myColor: room.guestColor,
            myUserName: guestName,
            hostColor: room.host ? room.host.color : 'red',
            opponentUserName: room.host ? room.host.userName : 'Chủ phòng',
            fen: room.fen,
            currentTurn: room.currentTurn,
            timer: room.timer,
            spectatorCount: connectedSpectatorCount(room)
        });

        broadcastPlayersUpdated(room);

        if (room.host) {
            sendJson(room.host.ws, {
                type: 'PLAYER_JOINED',
                opponentUserName: guestName,
                message: `${guestName} đã tham gia phòng! Sẵn sàng thi đấu.`,
                guestColor: room.guestColor
            });
        }
        return;
    }

    // Phòng riêng tư đã có đủ 2 người thi đấu -> VÀO VỚI TƯ CÁCH KHÁN GIẢ (SPECTATOR)
    addSpectator(ws, room, roomCode, userId, userName);
}

// Xử lý khi rớt mạng tạm thời (giữ chỗ trong 90s để kết nối lại)
function handleClientNetworkDrop(ws) {
    if (!ws.roomCode || !rooms.has(ws.roomCode)) return;

    const room = rooms.get(ws.roomCode);
    const roomCode = ws.roomCode;

    // A) KHÁN GIẢ RỚT MẠNG: giữ chỗ 90s (không làm đứt voice của cả phòng khi chỉ chập chờn vài giây)
    if (ws.isSpectator) {
        const spec = room.spectators && room.spectators.get(ws.userId);
        if (spec && spec.ws === ws) {
            spec.connected = false;
            spec.ws = null;
            if (spec.disconnectTimer) clearTimeout(spec.disconnectTimer);
            spec.disconnectTimer = setTimeout(() => {
                if (rooms.get(roomCode) !== room || room.spectators.get(spec.userId) !== spec) return;
                room.spectators.delete(spec.userId);
                console.log(`👁️ [Online] Khán giả [${spec.userName || spec.userId}] rời phòng [${roomCode}] do mất kết nối quá 90s.`);
                broadcastPlayersUpdated(room);
            }, RECONNECT_GRACE_MS);
            broadcastPlayersUpdated(room);
        }
        return;
    }

    // Kỳ thủ rớt mạng → huỷ lời xin hồi nước đang chờ
    if (!ws.isSpectator && ((room.host && room.host.ws === ws) || (room.guest && room.guest.ws === ws))) {
        cancelUndoRequest(room, 'Lời xin hồi nước đã huỷ vì có người mất kết nối.');
    }

    // B) CHỦ PHÒNG RỚT MẠNG
    if (ws.isHost && room.host && room.host.ws === ws) {
        const hostSlot = room.host;
        hostSlot.connected = false;
        hostSlot.ws = null;
        console.log(`⏳ [Online] Chủ phòng [${roomCode}] tạm thời mất kết nối. Giữ phòng trong ${RECONNECT_GRACE_MS / 1000}s...`);

        if (room.guest) {
            sendJson(room.guest.ws, {
                type: 'PLAYER_DISCONNECTED',
                role: 'host',
                message: 'Chủ phòng tạm thời mất mạng... Đang chờ kết nối lại.'
            });
        }
        broadcastPlayersUpdated(room);

        if (hostSlot.disconnectTimer) clearTimeout(hostSlot.disconnectTimer);
        hostSlot.disconnectTimer = setTimeout(() => {
            // Chỉ xử lý nếu ghế vẫn thuộc về đúng người đã rớt mạng (tránh đá nhầm người khác)
            if (rooms.get(roomCode) !== room || room.host !== hostSlot) return;
            hostSlot.disconnectTimer = null;
            console.log(`⏰ [Online] Hết hạn chờ chủ phòng kết nối lại phòng [${roomCode}].`);
            if (room.isPermanent) {
                room.host = null;
                // Nếu khách vẫn còn trong phòng cố định, chuyển quyền chủ phòng cho khách
                if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                    room.host = room.guest;
                    room.guest = null;
                    room.host.ws.isHost = true;
                    room.host.ws.isSpectator = false;
                    sendJson(room.host.ws, {
                        type: 'PROMOTED_TO_HOST',
                        message: 'Chủ phòng trước đã rời đi. Bạn được chuyển thành Chủ phòng mới!'
                    });
                } else if (!room.guest || !room.guest.connected) {
                    if (room.guest && room.guest.disconnectTimer) clearTimeout(room.guest.disconnectTimer);
                    room.guest = null;
                    room.fen = DEFAULT_XIANGQI_FEN;
                    room.currentTurn = 'w';
                    room.timer = getDefaultTimer();
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
        }, RECONNECT_GRACE_MS);

    // C) KHÁCH ĐẤU RỚT MẠNG
    } else if (!ws.isHost && room.guest && room.guest.ws === ws) {
        const guestSlot = room.guest;
        guestSlot.connected = false;
        guestSlot.ws = null;
        console.log(`⏳ [Online] Khách [${roomCode}] tạm thời mất kết nối. Giữ slot trong ${RECONNECT_GRACE_MS / 1000}s...`);

        if (room.host) {
            sendJson(room.host.ws, {
                type: 'PLAYER_DISCONNECTED',
                role: 'guest',
                message: 'Đối thủ tạm thời mất mạng... Đang chờ kết nối lại.'
            });
        }
        broadcastPlayersUpdated(room);

        if (guestSlot.disconnectTimer) clearTimeout(guestSlot.disconnectTimer);
        guestSlot.disconnectTimer = setTimeout(() => {
            if (rooms.get(roomCode) !== room || room.guest !== guestSlot) return;
            guestSlot.disconnectTimer = null;
            console.log(`⏰ [Online] Hết hạn chờ khách kết nối lại phòng [${roomCode}].`);
            room.guest = null;
            if (room.host) {
                sendJson(room.host.ws, {
                    type: 'GUEST_LEFT',
                    message: 'Đối thủ đã rời phòng. Bạn có thể chọn khán giả vào thi đấu tiếp!'
                });
            }
            if (room.isPermanent && (!room.host || !room.host.connected)) {
                if (room.host && room.host.disconnectTimer) clearTimeout(room.host.disconnectTimer);
                room.host = null;
                room.fen = DEFAULT_XIANGQI_FEN;
                room.currentTurn = 'w';
                room.timer = getDefaultTimer();
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
        const spec = room.spectators && room.spectators.get(ws.userId);
        if (spec && (spec.ws === ws || !spec.ws)) {
            if (spec.disconnectTimer) clearTimeout(spec.disconnectTimer);
            room.spectators.delete(ws.userId);
            console.log(`👁️ [Online] Khán giả [${ws.userName || ws.userId}] chủ động rời phòng [${roomCode}].`);
            broadcastPlayersUpdated(room);
        }
        ws.roomCode = null;
        return;
    }

    // B) CHỦ PHÒNG RỜI PHÒNG
    if (ws.isHost && room.host && room.host.ws === ws) {
        if (room.host.disconnectTimer) clearTimeout(room.host.disconnectTimer);
        console.log(`🚪 [Online] Chủ phòng [${roomCode}] chủ động rời phòng.`);

        if (room.isPermanent) {
            room.host = null;
            if (room.guest && room.guest.ws && room.guest.ws.readyState === 1) {
                room.host = room.guest;
                room.guest = null;
                room.host.ws.isHost = true;
                room.host.ws.isSpectator = false;
                sendJson(room.host.ws, {
                    type: 'PROMOTED_TO_HOST',
                    message: 'Chủ phòng trước đã rời đi. Bạn được chuyển thành Chủ phòng mới!'
                });
            } else {
                if (room.guest && room.guest.disconnectTimer) clearTimeout(room.guest.disconnectTimer);
                room.guest = null;
                room.fen = DEFAULT_XIANGQI_FEN;
                room.currentTurn = 'w';
                room.timer = getDefaultTimer();
            }
            broadcastPlayersUpdated(room);
        } else {
            broadcastToRoom(room, {
                type: 'HOST_LEFT',
                message: 'Chủ phòng đã rời phòng. Phòng đấu kết thúc.'
            }, ws);
            if (room.guest && room.guest.disconnectTimer) clearTimeout(room.guest.disconnectTimer);
            if (room.guest && room.guest.ws) room.guest.ws.roomCode = null;
            if (room.spectators) room.spectators.forEach(s => {
                if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
                if (s.ws) s.ws.roomCode = null;
            });
            rooms.delete(roomCode);
        }

    // C) KHÁCH RỜI PHÒNG
    } else if (room.guest && room.guest.ws === ws) {
        if (room.guest.disconnectTimer) clearTimeout(room.guest.disconnectTimer);
        console.log(`🚪 [Online] Khách [${roomCode}] chủ động rời phòng.`);
        room.guest = null;
        if (room.host) {
            sendJson(room.host.ws, {
                type: 'GUEST_LEFT',
                message: 'Đối thủ đã rời phòng. Bạn có thể chọn khán giả vào thi đấu tiếp!'
            });
        }
        if (room.isPermanent && (!room.host || !room.host.connected)) {
            if (room.host && room.host.disconnectTimer) clearTimeout(room.host.disconnectTimer);
            room.host = null;
            room.fen = DEFAULT_XIANGQI_FEN;
            room.currentTurn = 'w';
            room.timer = getDefaultTimer();
        }
        broadcastPlayersUpdated(room);
    }

    ws.roomCode = null;
}

// Bật Server
server.listen(port, '0.0.0.0', () => {
    console.log(`\n✅ Máy chủ đã chạy thành công trên cổng ${port}!`);
    console.log(`🎮 Truy cập: http://0.0.0.0:${port}`);
    const turnProvider = getTurnProviderName();
    if (turnProvider) {
        console.log(`🔁 TURN cho voice/camera: ĐÃ CẤU HÌNH (${turnProvider})\n`);
    } else {
        console.log('⚠️ TURN cho voice/camera: CHƯA CẤU HÌNH — người chơi ở các mạng khác nhau (4G, wifi công ty...) có thể không nghe được nhau. Xem .env.example\n');
    }
});
