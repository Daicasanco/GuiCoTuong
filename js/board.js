// js/board.js
import { state } from './state.js';
import { PIECE_MAP } from './config.js';
import { openModal } from './ui.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, getMainLine, ensureNodeData } from './game.js';
import { handleEditSquareClick } from './editor.js';
import { handleSquareClick } from './game.js';
import { renderEvalGraph } from './analysis/eval-graph.js';

export const imageCache = {}; 
export let isImagesLoaded = false;

const SHADOW_SCALE = 1.0;         // Kích thước bóng (1.05 = to hơn quân cờ 5%)
const SHADOW_OFFSET_X_PCT = 0.05;  // Lệch sang phải 4% khi nằm im
const SHADOW_OFFSET_Y_PCT = 0.1;  // Lệch xuống dưới 6% khi nằm im

const SELECTION_SCALE = 1.55;      // Ánh sáng dưới đáy quân cờ đang chọn (selection.webp)
const DOT_SCALE = 0.25;            // Chấm xanh nước đi hợp lệ & ăn quân (dot.webp)
const FROM_SCALE = 0.4;            // Điểm xuất phát nước đi trước (from.webp)
const TO_SCALE = 1.1;             // Điểm đến nước đi trước (to.webp)

// Tải ảnh lên RAM
export function preloadImages() {
    return new Promise((resolve) => {
        const boardPath = (state.appSettings && state.appSettings.boardStyle) || "style/1-mac_dinh";
        const piecePath = (state.appSettings && state.appSettings.pieceStyle) || "style/1-mac_dinh";

        const boardArea = document.getElementById('chess-board-area');
        if (boardArea) {
            boardArea.style.backgroundImage = `url('${boardPath}/board.webp')`;
            boardArea.style.setProperty('--bg-image', `url('${boardPath}/board.webp')`);
        }

        document.querySelectorAll('.piece-palette img').forEach(imgTag => {
            const pieceCode = imgTag.dataset.piece;
            if (pieceCode && PIECE_MAP[pieceCode]) {
                imgTag.src = `${piecePath}/${PIECE_MAP[pieceCode]}.webp`;
            }
        });

        const pieceKeys = Object.keys(PIECE_MAP);
        const extraImages = ['shadow', 'dot', 'from', 'to', 'selection', 'logo_kyly'];
        const tagImages = ['best', 'excellent', 'good', 'balanced', 'inaccuracy', 'mistake', 'blunder'];
        const blindPieces = ['blind_b', 'blind_w']; 
        
        let loadedCount = 0;
        const totalImages = pieceKeys.length + extraImages.length + tagImages.length + blindPieces.length + 1; // +1 cho board

        const checkDone = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                isImagesLoaded = true;
                resolve();
            }
        };

        // Nạp font chữ nghệ thuật cho canvas
        if (typeof document !== 'undefined' && document.fonts) {
            document.fonts.load('700 24px Charm').catch(() => {});
        }

        // Tải ảnh Bàn Cờ vào RAM
        const imgBoard = new Image();
        imgBoard.src = `${boardPath}/board.webp`;
        imgBoard.onload = () => { imageCache['board'] = imgBoard; checkDone(); };
        imgBoard.onerror = () => { checkDone(); };

        // Tải ảnh các hiệu ứng (UI) & logo
        extraImages.forEach(imgName => {
            const img = new Image();
            img.src = `style/${imgName}.webp`;
            img.onload = () => { imageCache[imgName] = img; checkDone(); };
            img.onerror = () => {
                const fallbackImg = new Image();
                fallbackImg.src = `style/${imgName}.png`;
                fallbackImg.onload = () => { imageCache[imgName] = fallbackImg; checkDone(); };
                fallbackImg.onerror = () => { checkDone(); };
            };
        });

        // Tải ảnh Nhãn dán Đánh giá phân tích (Tags)
        tagImages.forEach(tagName => {
            const img = new Image();
            img.src = `style/tags/${tagName}.webp`;
            img.onload = () => { imageCache[tagName] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });

        // Tải ảnh Mù
        blindPieces.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${key}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });

        // Tải ảnh các quân cờ
        pieceKeys.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${PIECE_MAP[key]}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });
    });
}

// HÀM TẢI LẠI RIÊNG BÀN CỜ (Dùng cho Setting)
export function reloadBoardImage(boardPath) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `${boardPath}/board.webp`;
        img.onload = () => { 
            imageCache['board'] = img;
            requestBoardRedraw();
            const boardArea = document.getElementById('chess-board-area');
            if (boardArea) {
                boardArea.style.backgroundImage = `url('${img.src}')`;
                boardArea.style.setProperty('--bg-image', `url('${img.src}')`);
            }
            resolve(); 
        };
        img.onerror = () => { console.error(`Lỗi tải ảnh bàn cờ: ${img.src}`); resolve(); };
    });
}

// HÀM TẢI LẠI RIÊNG QUÂN CỜ (Dùng cho Setting)
export function reloadPieceImages(piecePath) {
    return new Promise((resolve) => {
        const pieceKeys = Object.keys(PIECE_MAP);
        const extraPieces = ['blind_b', 'blind_w'];
        
        let loadedCount = 0;
        const totalImages = pieceKeys.length + extraPieces.length; 

        const checkDone = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                requestBoardRedraw();
                resolve();
            }
        };

        extraPieces.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${key}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });

        pieceKeys.forEach(key => {
            const img = new Image();
            img.src = `${piecePath}/${PIECE_MAP[key]}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { checkDone(); };
        });
        
        document.querySelectorAll('.piece-palette img').forEach(imgTag => {
            const pieceCode = imgTag.dataset.piece;
            if (pieceCode && PIECE_MAP[pieceCode]) {
                imgTag.src = `${piecePath}/${PIECE_MAP[pieceCode]}.webp`;
            }
        });
    });
}
// ==========================================
// HỆ THỐNG CANVAS RENDER ENGINE (60 FPS & ANIMATION)
// ==========================================
let canvas, ctx;
let boardRect = { width: 0, height: 0 };
let pieceSize = 0;
let isRenderLoopRunning = false;
export let animState = null;

// Hàm kích hoạt Animation trượt cờ
export function startCanvasAnimation(fromIccs, toIccs, pieceCode) {
    // TÍNH TOÁN SẴN TỌA ĐỘ PIXEL NGAY TỪ ĐẦU (Chống rác bộ nhớ)
    const fromXY = vschess.i2b[fromIccs];
    const toXY = vschess.i2b[toIccs];
    const pStart = getCanvasCoords(fromXY % 9, Math.floor(fromXY / 9));
    const pEnd = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    animState = {
        from: fromIccs,
        to: toIccs,
        piece: pieceCode,
        startX: pStart.cx,
        startY: pStart.cy,
        endX: pEnd.cx,
        endY: pEnd.cy,
        startTime: performance.now(),
        duration: 150 // Thời gian trượt 150ms
    };
}

export function startStudioCanvasAnimation(fromIccs, toIccs, pieceCode, startTimeMs, durationMs = 350) {
    if (vschess.i2b[fromIccs] === undefined || vschess.i2b[toIccs] === undefined) return;
    const fromXY = vschess.i2b[fromIccs];
    const toXY = vschess.i2b[toIccs];
    const pStart = getCanvasCoords(fromXY % 9, Math.floor(fromXY / 9));
    const pEnd = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    animState = {
        from: fromIccs,
        to: toIccs,
        piece: pieceCode,
        startX: pStart.cx,
        startY: pStart.cy,
        endX: pEnd.cx,
        endY: pEnd.cy,
        startTime: startTimeMs,
        duration: durationMs
    };
    state.isAnimating = true;
}

export function setBoardTheme(themeName) {
    const el = document.getElementById('chess-board-area') || document.querySelector('.board-wrapper');
    if (!el) return;
    const saved = themeName || localStorage.getItem('boardTheme') || 'default';
    if (!state.appSettings) state.appSettings = {};
    state.appSettings.boardTheme = saved;
    localStorage.setItem('boardTheme', saved);

    const themeMap = {
        'default': 'style/board.webp',
        'wood': 'style/boards/board_wood.png',
        'marble': 'style/boards/board_marble.png',
        'dark': 'style/boards/board_dark.png',
        'contest': 'style/boards/board_contest.png',
        'modern': 'style/boards/board_modern.png'
    };
    const bgUrl = themeMap[saved] || 'style/board.webp';
    el.style.backgroundImage = `url('${bgUrl}')`;
    el.style.backgroundSize = '100% 100%';
    el.style.backgroundPosition = 'center';
}

export function initCanvas() {
    canvas = document.getElementById('chess-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d', { alpha: true }); 
    
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
    
    setBoardTheme();
    resizeCanvas();

    if (!isCanvasEventsInitialized) {
        isCanvasEventsInitialized = true;
        canvas.addEventListener('click', handleCanvasClick);
        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        window.addEventListener('mousemove', handleCanvasMouseMove);
        window.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('dblclick', handleCanvasDblClick);

        // Hỗ trợ thiết bị cảm ứng (Touch)
        canvas.addEventListener('touchstart', handleCanvasMouseDown, { passive: true });
        window.addEventListener('touchmove', handleCanvasMouseMove, { passive: false });
        window.addEventListener('touchend', handleCanvasMouseUp, { passive: true });
    }
    
    if (!isRenderLoopRunning) {
        isRenderLoopRunning = true;
        requestAnimationFrame(renderLoop);
    }
}

let isCanvasEventsInitialized = false;

// ==========================================
// HỆ THỐNG VẼ ĐƯỜNG KẺ CHIẾN THUẬT (USER DRAW LINES)
// ==========================================
export let userDrawLines = [];
let dragStartLogic = null;
let dragStartClient = null;
let currentDragClient = null;
let isDraggingLine = false;
let dragJustFinishedTime = 0;

export function clearUserDrawLines() {
    userDrawLines = [];
}

export function getLogicCoordsFromClient(clientX, clientY) {
    if (!canvas || !boardRect || boardRect.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const percentX = (clientX - rect.left) / rect.width;
    const percentY = (clientY - rect.top) / rect.height;

    const paddingXPercent = 0.07;
    const paddingYPercent = 0.065;
    
    const gridWidthPercent = 1 - (paddingXPercent * 2);
    const gridHeightPercent = 1 - (paddingYPercent * 2);
    
    const cellXPercent = gridWidthPercent / 8;
    const cellYPercent = gridHeightPercent / 9;

    let logicX = Math.round((percentX - paddingXPercent) / cellXPercent);
    let logicY = Math.round((percentY - paddingYPercent) / cellYPercent);

    if (state.isBoardFlipped) {
        logicX = 8 - logicX;
        logicY = 9 - logicY;
    }

    if (logicX < 0 || logicX > 8 || logicY < 0 || logicY > 9) return null;
    return { logicX, logicY };
}

function handleCanvasMouseDown(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (e.shiftKey) return; // Nếu đang giữ Shift thì dùng để xóa đường trên click

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    if (clientX === undefined || clientY === undefined) return;

    const logic = getLogicCoordsFromClient(clientX, clientY);
    if (!logic) return;

    dragStartLogic = logic;
    dragStartClient = { x: clientX, y: clientY };
    currentDragClient = null;
    isDraggingLine = false;
}

function handleCanvasMouseMove(e) {
    if (!dragStartLogic || !dragStartClient) return;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    if (clientX === undefined || clientY === undefined) return;

    const dist = Math.hypot(clientX - dragStartClient.x, clientY - dragStartClient.y);
    if (dist > 8) {
        isDraggingLine = true;
        currentDragClient = { x: clientX, y: clientY };
        if (e.cancelable && e.type && e.type.startsWith('touch')) {
            e.preventDefault();
        }
    }
}

function handleCanvasMouseUp(e) {
    if (isDraggingLine && dragStartLogic) {
        let clientX, clientY;
        if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else if (e.clientX !== undefined) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (currentDragClient) {
            clientX = currentDragClient.x;
            clientY = currentDragClient.y;
        }

        if (clientX !== undefined && clientY !== undefined) {
            const endLogic = getLogicCoordsFromClient(clientX, clientY);
            if (endLogic && (endLogic.logicX !== dragStartLogic.logicX || endLogic.logicY !== dragStartLogic.logicY)) {
                userDrawLines.push({
                    from: { x: dragStartLogic.logicX, y: dragStartLogic.logicY },
                    to: { x: endLogic.logicX, y: endLogic.logicY },
                    number: userDrawLines.length + 1
                });
            }
        }
        dragJustFinishedTime = Date.now();
    }

    dragStartLogic = null;
    dragStartClient = null;
    currentDragClient = null;
    isDraggingLine = false;
}

function handleCanvasDblClick(e) {
    // Ấn đúp chuột: xóa toàn bộ các đường kẻ trước đó
    clearUserDrawLines();
    state.selectedSquare = null;
    state.legalMoves = [];
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}

function handleShiftClickDeleteLine(event) {
    if (!userDrawLines || userDrawLines.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickCanvasX = (event.clientX - rect.left) * (boardRect.width / rect.width);
    const clickCanvasY = (event.clientY - rect.top) * (boardRect.height / rect.height);

    let bestIndex = -1;
    let minDistance = Infinity;
    const threshold = Math.max(22, pieceSize * 0.45);

    for (let i = 0; i < userDrawLines.length; i++) {
        const item = userDrawLines[i];
        const p1 = getCanvasCoords(item.from.x, item.from.y);
        const p2 = getCanvasCoords(item.to.x, item.to.y);
        if (!p1 || !p2) continue;

        const distSeg = distanceToLineSegment(clickCanvasX, clickCanvasY, p1.cx, p1.cy, p2.cx, p2.cy);

        const dx = p2.cx - p1.cx;
        const dy = p2.cy - p1.cy;
        const dist = Math.hypot(dx, dy);
        let badgeX = (p1.cx + p2.cx) / 2;
        let badgeY = (p1.cy + p2.cy) / 2;
        if (dist > 1) {
            const arrowLen = Math.min(dist * 0.4, Math.max(14, pieceSize * 0.28));
            const badgeR = Math.max(10, pieceSize * 0.18);
            const baseX = p2.cx - (dx / dist) * arrowLen;
            const baseY = p2.cy - (dy / dist) * arrowLen;
            if (dist >= badgeR * 2.5) {
                badgeX = baseX - (dx / dist) * (badgeR * 0.4);
                badgeY = baseY - (dy / dist) * (badgeR * 0.4);
            }
        }
        const distBadge = Math.hypot(clickCanvasX - badgeX, clickCanvasY - badgeY);

        const d = Math.min(distSeg, distBadge);
        if (d <= threshold && d < minDistance) {
            minDistance = d;
            bestIndex = i;
        }
    }

    if (bestIndex !== -1) {
        userDrawLines.splice(bestIndex, 1);
        // Đánh số lại thứ tự các đường còn lại: 1, 2, 3...
        userDrawLines.forEach((line, idx) => {
            line.number = idx + 1;
        });
    }
}

let lastCanvasDpr = 0;

function resizeCanvas() {
    if (!canvas) return;
    const parent = document.getElementById('chess-board-area');

    // ĐÃ SỬA: Dùng offsetWidth thay vì getBoundingClientRect()
    // Để lấy kích thước gốc chưa bị ảnh hưởng bởi CSS transform: scale()
    const trueWidth = parent.offsetWidth;
    const trueHeight = parent.offsetHeight;

    boardRect = { width: trueWidth, height: trueHeight };
    // Chỉnh kích thước quân cờ (bạn có thể đổi lại 0.1 nếu thấy 0.088 hơi nhỏ)
    pieceSize = trueWidth * 0.1;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(trueWidth * dpr);
    const pixelHeight = Math.floor(trueHeight * dpr);

    // Sự kiện resize bắn rất nhiều lần (bàn phím điện thoại, toast, chat...) → chỉ cấp phát lại canvas khi kích thước thật sự đổi
    if (canvas.width === pixelWidth && canvas.height === pixelHeight && lastCanvasDpr === dpr) return;
    lastCanvasDpr = dpr;

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    // ĐÃ SỬA: Canvas luôn tự động fill đầy thẻ cha 100%
    canvas.style.width = `100%`;
    canvas.style.height = `100%`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestBoardRedraw();
}

// Raycasting: Tính toán tọa độ Click bằng TỶ LỆ PHẦN TRĂM (%)
function handleCanvasClick(event) {
    if (!boardRect || boardRect.width === 0) return;
    
    // 1. Nếu vừa kết thúc kéo thả vẽ đường -> Không đi cờ
    if (Date.now() - dragJustFinishedTime < 100) return;

    // 2. Nếu đè Shift: xóa đường kẻ được ấn vào
    if (event.shiftKey) {
        handleShiftClickDeleteLine(event);
        return;
    }

    // 3. Click chọn hoặc đi quân bình thường
    const logic = getLogicCoordsFromClient(event.clientX, event.clientY);
    if (!logic) return;

    const boardNum = logic.logicY * 9 + logic.logicX;
    const iccsPos = vschess.b2i[boardNum];

    if (state.isEditMode) handleEditSquareClick(iccsPos);
    else handleSquareClick(logic.logicX, logic.logicY, iccsPos);
}

export function getCanvasCoords(logicX, logicY) {
    const drawX = state.isBoardFlipped ? 8 - logicX : logicX;
    const drawY = state.isBoardFlipped ? 9 - logicY : logicY;
    const paddingX = boardRect.width * 0.07;
    const paddingY = boardRect.height * 0.065;
    const gridWidth = boardRect.width - (paddingX * 2);
    const gridHeight = boardRect.height - (paddingY * 2);
    const cellX = gridWidth / 8;
    const cellY = gridHeight / 9;

    return { cx: paddingX + (drawX * cellX), cy: paddingY + (drawY * cellY) };
}

function drawMoveBadge() {
    // Chỉ vẽ khi biểu đồ đã chạy xong, không ở chế độ xếp quân, và nước cờ có nhãn
    if (!state.isChartAnalyzed || !state.lastMove || state.isEditMode || !state.currentNode || !state.currentNode.classification) return;

    const toIccs = state.lastMove.substring(2, 4);
    const toXY = vschess.i2b[toIccs];
    const p2 = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    // Xử lý ngoại lệ: Nếu là missed_win thì dùng ảnh blunder
    let badgeName = state.currentNode.classification;
    if (badgeName === 'missed_win') badgeName = 'blunder';

    const badgeImg = imageCache[badgeName];
    if (badgeImg) {
        const badgeSize = Math.round(pieceSize * 0.45); 
        const bx = Math.round(p2.cx) + Math.round(pieceSize / 4) - Math.round(badgeSize * 0.15);
        const by = Math.round(p2.cy) - Math.round(pieceSize / 2) - Math.round(badgeSize * 0.15);
        ctx.drawImage(badgeImg, bx, by, badgeSize, badgeSize);
    }
}

// ==========================================
// CHỈ VẼ LẠI KHI CÓ THAY ĐỔI (TIẾT KIỆM PIN / CHỐNG NÓNG MÁY TRÊN ĐIỆN THOẠI)
// Trước đây bàn cờ được vẽ lại toàn bộ 60-120 lần/giây kể cả khi đứng yên.
// Giờ mỗi khung hình chỉ so "chữ ký" trạng thái (rất rẻ); có thay đổi hoặc đang có hiệu ứng mới vẽ.
// Ngoài ra vẫn vẽ lại định kỳ mỗi 1 giây để không bao giờ bị kẹt hình nếu có thay đổi nào chưa được theo dõi.
// ==========================================
let boardDirty = true;
let lastFrameSignature = '';
let lastFrameRefs = [];
let lastFullDrawAt = 0;
let wasAnimating = false;
let variationModalEl = null;
const IDLE_REDRAW_MS = 1000;

export function requestBoardRedraw() {
    boardDirty = true;
}

if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => requestBoardRedraw()).catch(() => {});
}

function computeFrameSignature() {
    const s = state;
    const sit = s.currentSituation;
    let hash = 0;
    if (sit) {
        for (let i = 0; i < 204; i++) hash = (hash * 31 + (sit[i] | 0)) | 0;
    }
    let pvSig = '';
    if (s.isAnalyzing && s.pvLines) {
        for (const line of s.pvLines) {
            if (line) pvSig += (line.bestMove || '') + ':' + (line.ponderMove || '') + ':' + (line.rank || '') + ',';
        }
    }
    const node = s.currentNode;
    const hovered = s.hoveredPVLine && s.hoveredPVLine.pv ? s.hoveredPVLine.pv.slice(0, 4).join('') : '';
    const legal = s.legalMoves;
    if (!variationModalEl) variationModalEl = document.getElementById('variation-modal');
    const editingParent = s.editingParentNode;
    return hash + '|' + s.lastMove + '|' + s.isEditMode + '|' + s.selectedBoardPiece + '|' +
        (s.selectedSquare ? s.selectedSquare.iccs : '') + '|' +
        (legal ? legal.length + (legal[0] || '') + (legal[legal.length - 1] || '') : '') + '|' +
        s.appMode + '|' + s.isPeeking + '|' + (s.memorizeSettings ? s.memorizeSettings.isBlind : '') + '|' +
        s.isBoardFlipped + '|' + s.isAnimating + '|' +
        (node ? (node.classification || '') + (node.children ? node.children.length : 0) + (node.parent ? node.parent.aiBestMove || '' : '') : '') + '|' +
        s.isChartAnalyzed + '|' + hovered + '|' + s.isAnalyzing + '|' + pvSig + '|' +
        (s.appSettings ? String(s.appSettings.arrows) + s.appSettings.boardTheme : '') + '|' +
        (editingParent && editingParent.children ? editingParent.children.length : '') + '|' +
        (variationModalEl ? variationModalEl.style.display : '') + '|' +
        userDrawLines.length + '|' + isDraggingLine + '|' +
        (currentDragClient ? currentDragClient.x + ',' + currentDragClient.y : '') + '|' +
        canvas.width + 'x' + canvas.height;
}

function frameRefsChanged() {
    const refs = [state.currentSituation, state.currentNode, state.pvLines, state.hoveredPVLine, state.legalMoves, state.editingParentNode, userDrawLines];
    let changed = refs.length !== lastFrameRefs.length;
    for (let i = 0; !changed && i < refs.length; i++) {
        if (refs[i] !== lastFrameRefs[i]) changed = true;
    }
    lastFrameRefs = refs;
    return changed;
}

// VÒNG LẶP RENDER CHÍNH
function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    if (state.isStudioMode) return;
    if (!ctx || !boardRect.width) return;

    const animating = !!(animState && state.isAnimating);
    const signature = computeFrameSignature();
    const refsChanged = frameRefsChanged();
    const frameTime = typeof now === 'number' ? now : performance.now();
    const needsDraw = animating || wasAnimating || boardDirty || refsChanged ||
        signature !== lastFrameSignature || (frameTime - lastFullDrawAt) >= IDLE_REDRAW_MS;
    wasAnimating = animating;
    if (!needsDraw) return;

    boardDirty = false;
    lastFrameSignature = signature;
    lastFullDrawAt = frameTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawRiverDecoration();       // Vẽ logo 2 bên cửa sông & chữ Kỳ Lý Cờ Tướng ở giữa
    drawLastMoveHighlights();
    drawStaticPieces();          // Vẽ các quân cờ bình thường trước
    drawAnimatingPiece();        // Vẽ quân đang bay
    drawSelectedPiece();         // <--- VẼ QUÂN ĐANG CHỌN PHÁT SÁNG NỔI LÊN TRÊN
    drawLegalMoveDots();         // Vẽ chấm xanh nước đi
    drawMoveBadge();             // <--- VẼ BADGE ĐÁNH GIÁ NƯỚC ĐI TỪ BIỂU ĐỒ PHÂN TÍCH
    drawBestMoveArrowCanvas();   // Vẽ mũi tên AI
    drawUserDrawnLines();        // <--- VẼ CÁC ĐƯỜNG KẺ CHIẾN THUẬT DO NGƯỜI DÙNG KÉO THẢ
}

// =========================================================
// STUDIO MODE DETERMINISTIC RENDERER
// =========================================================
export function renderStudioFrame(virtualTimeMs, customArrows = []) {
    if (!ctx || !boardRect.width) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Vẽ mặt bàn cờ trực tiếp lên Canvas (giúp Canvas tự đứng độc lập 100%)
    const boardImg = imageCache['board'];
    if (boardImg && boardImg.complete && boardImg.naturalWidth > 0) {
        ctx.drawImage(boardImg, 0, 0, boardRect.width, boardRect.height);
    }

    drawRiverDecoration();
    drawLastMoveHighlights();
    drawStaticPieces();
    drawAnimatingPieceStudio(virtualTimeMs);
    drawStudioArrows(customArrows);
}

function drawAnimatingPieceStudio(virtualTimeMs) {
    if (!animState || !state.isAnimating) return;

    const startX = animState.startX;
    const startY = animState.startY;
    const endX = animState.endX;
    const endY = animState.endY;
    const pieceCode = animState.piece;

    const elapsed = virtualTimeMs - animState.startTime;
    let progress = elapsed / animState.duration;

    if (progress >= 1) {
        progress = 1;
        animState = null;
        state.isAnimating = false;
    } else if (progress < 0) {
        progress = 0;
    }

    const f = 1 - progress;
    const easeOut = 1 - (f * f * f);

    const currentX = Math.round(startX + (endX - startX) * easeOut);
    const currentY = Math.round(startY + (endY - startY) * easeOut);

    const img = getPieceImage(pieceCode);
    if (img) {
        const pSize = Math.round(pieceSize);
        const halfSize = Math.round(pSize / 2);

        const shadowImg = imageCache['shadow'];
        if (shadowImg) {
            const sSize = Math.round(pSize * SHADOW_SCALE);
            const halfSSize = Math.round(sSize / 2);
            const flyOffsetX = Math.round(pSize * SHADOW_OFFSET_X_PCT);
            const flyOffsetY = Math.round(pSize * SHADOW_OFFSET_Y_PCT);
            ctx.drawImage(shadowImg, currentX - halfSSize + flyOffsetX, currentY - halfSSize + flyOffsetY, sSize, sSize);
        }

        ctx.drawImage(img, currentX - halfSize, currentY - halfSize, pSize, pSize);
    }
}

export function drawStudioArrows(arrows = []) {
    if (!ctx || !boardRect.width || !arrows || arrows.length === 0) return;

    arrows.forEach(arrow => {
        if (!arrow || !arrow.uci) return;
        const move = arrow.uci.trim().toLowerCase();
        if (move.length < 4) return;
        const fromKey = move.substring(0, 2);
        const toKey = move.substring(2, 4);
        if (vschess.i2b[fromKey] === undefined || vschess.i2b[toKey] === undefined) return;

        const fXY = vschess.i2b[fromKey];
        const tXY = vschess.i2b[toKey];
        const p1 = getCanvasCoords(fXY % 9, Math.floor(fXY / 9));
        const p2 = getCanvasCoords(tXY % 9, Math.floor(tXY / 9));
        if (!p1 || !p2) return;

        const dx = p2.cx - p1.cx;
        const dy = p2.cy - p1.cy;
        const angle = Math.atan2(dy, dx);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1) return;

        const headLength = pieceSize * 0.32;
        const headWidth = pieceSize * 0.46;
        const tailStartWidth = pieceSize * 0.05;
        const tailEndWidth = pieceSize * 0.22;

        ctx.save();
        if (arrow.opacity !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, arrow.opacity));
        ctx.translate(p1.cx, p1.cy);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(0, tailStartWidth / 2);
        ctx.lineTo(distance - headLength, tailEndWidth / 2);
        ctx.lineTo(distance - headLength, headWidth / 2);
        ctx.lineTo(distance, 0);
        ctx.lineTo(distance - headLength, -headWidth / 2);
        ctx.lineTo(distance - headLength, -tailEndWidth / 2);
        ctx.lineTo(0, -tailStartWidth / 2);
        ctx.closePath();

        ctx.fillStyle = arrow.color || 'rgba(230, 81, 0, 0.9)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 6;
        ctx.fill();

        ctx.restore();

        if (arrow.label) {
            const textOffset = headLength * 0.65;
            const textX = p2.cx - Math.cos(angle) * textOffset;
            const textY = p2.cy - Math.sin(angle) * textOffset;
            ctx.save();
            if (arrow.opacity !== undefined) ctx.globalAlpha = Math.max(0, Math.min(1, arrow.opacity));
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.round(pieceSize * 0.22)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(arrow.label, textX, textY + 1);
            ctx.restore();
        }
    });
}

// Vẽ các đường kẻ chiến thuật do người dùng vẽ (có đánh số thứ tự 1, 2, 3...)
function drawUserDrawnLines() {
    if (!ctx || !boardRect.width) return;
    if (userDrawLines.length === 0 && !isDraggingLine) return;

    const renderArrowItem = (p1, p2, num, isPreview = false) => {
        if (!p1 || !p2) return;
        const dx = p2.cx - p1.cx;
        const dy = p2.cy - p1.cy;
        const dist = Math.hypot(dx, dy);
        if (dist < 4) return;

        const ux = dx / dist;
        const uy = dy / dist;
        const px = -uy;
        const py = ux;

        const arrowLen = Math.min(dist * 0.38, Math.max(14, pieceSize * 0.28));
        const arrowW = arrowLen * 0.85;
        const baseX = p2.cx - ux * arrowLen;
        const baseY = p2.cy - uy * arrowLen;

        const c1X = baseX + px * (arrowW / 2);
        const c1Y = baseY + py * (arrowW / 2);
        const c2X = baseX - px * (arrowW / 2);
        const c2Y = baseY - py * (arrowW / 2);

        ctx.save();
        if (isPreview) {
            ctx.globalAlpha = 0.78;
        }

        // 1. Thân đường kẻ màu xanh lá cây rực rỡ
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(5, Math.round(pieceSize * 0.11));
        ctx.strokeStyle = '#22c55e'; // Green lime vibrant
        ctx.shadowColor = 'rgba(0, 0, 0, 0.32)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;

        ctx.beginPath();
        ctx.moveTo(p1.cx, p1.cy);
        ctx.lineTo(baseX, baseY);
        ctx.stroke();

        // 2. Chóp mũi tên
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.moveTo(p2.cx, p2.cy);
        ctx.lineTo(c1X, c1Y);
        ctx.lineTo(c2X, c2Y);
        ctx.closePath();
        ctx.fill();

        // 3. Huy hiệu tròn màu cam có số thứ tự
        const badgeR = Math.max(10, Math.round(pieceSize * 0.18));
        let bx, by;
        if (dist < badgeR * 2.5) {
            bx = (p1.cx + p2.cx) / 2;
            by = (p1.cy + p2.cy) / 2;
        } else {
            bx = baseX - ux * (badgeR * 0.4);
            by = baseY - uy * (badgeR * 0.4);
        }

        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = '#ff6b35'; // Coral orange
        ctx.fill();

        // Viền trắng sắc nét cho huy hiệu
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Số thứ tự màu trắng in đậm
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = '#ffffff';
        const fontSize = Math.max(10, Math.round(badgeR * 1.15));
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), bx, by);

        ctx.restore();
    };

    // Vẽ các đường đã cố định
    for (let i = 0; i < userDrawLines.length; i++) {
        const item = userDrawLines[i];
        const p1 = getCanvasCoords(item.from.x, item.from.y);
        const p2 = getCanvasCoords(item.to.x, item.to.y);
        renderArrowItem(p1, p2, item.number, false);
    }

    // Vẽ đường preview khi đang kéo thả chuột
    if (isDraggingLine && dragStartLogic && currentDragClient) {
        const p1 = getCanvasCoords(dragStartLogic.logicX, dragStartLogic.logicY);
        const hoverLogic = getLogicCoordsFromClient(currentDragClient.x, currentDragClient.y);
        let p2;
        if (hoverLogic && (hoverLogic.logicX !== dragStartLogic.logicX || hoverLogic.logicY !== dragStartLogic.logicY)) {
            p2 = getCanvasCoords(hoverLogic.logicX, hoverLogic.logicY);
        } else {
            const rect = canvas.getBoundingClientRect();
            p2 = {
                cx: (currentDragClient.x - rect.left) * (boardRect.width / rect.width),
                cy: (currentDragClient.y - rect.top) * (boardRect.height / rect.height)
            };
        }
        renderArrowItem(p1, p2, userDrawLines.length + 1, true);
    }
}

// Vẽ logo 2 bên cửa sông và chữ "Kỳ Lý Cờ Tướng" uốn lượn ở giữa khúc sông
function drawRiverDecoration() {
    if (!ctx || !boardRect.width) return;

    const paddingX = boardRect.width * 0.07;
    const paddingY = boardRect.height * 0.065;
    const gridWidth = boardRect.width - (paddingX * 2);
    const gridHeight = boardRect.height - (paddingY * 2);
    const cellX = gridWidth / 8;
    const cellY = gridHeight / 9;

    // Tâm dòng sông nằm chính giữa hàng 4 và 5
    const riverCenterY = paddingY + 4.5 * cellY;
    const riverHeight = cellY;

    // 1. Vẽ 2 ảnh Logo ở 2 bên cửa sông
    const logoImg = imageCache['logo_kyly'];
    const logoSize = Math.round(riverHeight * 0.88);

    // Cửa sông bên trái (cột 0 - 1) và bên phải (cột 7 - 8)
    const leftLogoCenterX = paddingX + 0.85 * cellX;
    const rightLogoCenterX = paddingX + 7.15 * cellX;

    if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;

        ctx.drawImage(
            logoImg,
            Math.round(leftLogoCenterX - logoSize / 2),
            Math.round(riverCenterY - logoSize / 2),
            logoSize,
            logoSize
        );

        ctx.drawImage(
            logoImg,
            Math.round(rightLogoCenterX - logoSize / 2),
            Math.round(riverCenterY - logoSize / 2),
            logoSize,
            logoSize
        );
        ctx.restore();
    }

    // 2. Chữ "Kỳ Lý Cờ Tướng" ở giữa khúc sông với font chữ uốn lượn
    ctx.save();
    const currentTheme = (state.appSettings && state.appSettings.boardTheme) || localStorage.getItem('boardTheme') || 'default';
    const isDark = currentTheme === 'dark';

    const fontSize = Math.max(14, Math.round(riverHeight * 0.44));
    ctx.font = `700 ${fontSize}px "Charm", "Dancing Script", "Playball", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textCenterX = boardRect.width / 2;
    const textCenterY = riverCenterY - 1;
    const riverText = 'Kỳ Lý Cờ Tướng';

    if (isDark) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#e8c460';
        ctx.fillText(riverText, textCenterX, textCenterY);
    } else {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
        ctx.shadowBlur = 2;
        ctx.shadowOffsetY = 1;
        ctx.fillStyle = '#3d1c08';
        ctx.fillText(riverText, textCenterX, textCenterY);
    }
    ctx.restore();
}

// Các hàm Render Phụ trợ
function drawLastMoveHighlights() {
    if (!state.lastMove || state.isEditMode) return;
    const fromXY = vschess.i2b[state.lastMove.substring(0, 2)];
    const toXY = vschess.i2b[state.lastMove.substring(2, 4)];
    const p1 = getCanvasCoords(fromXY % 9, Math.floor(fromXY / 9));
    const p2 = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

    const imgFrom = imageCache['from'];
    const imgTo = imageCache['to'];

    // Vẽ ảnh From (Xuất phát)
    if (imgFrom) {
        const size = Math.round(pieceSize * FROM_SCALE);
        ctx.drawImage(imgFrom, Math.round(p1.cx) - size/2, Math.round(p1.cy) - size/2, size, size);
    }
    
    // Vẽ ảnh To (Đích đến)
    if (imgTo) {
        const size = Math.round(pieceSize * TO_SCALE);
        ctx.drawImage(imgTo, Math.round(p2.cx) - size/2, Math.round(p2.cy) - size/2, size, size);
    }
}

function drawSelectedPiece() {
    let selectedIccs = null;
    let logicX, logicY;

    if (state.isEditMode && state.selectedBoardPiece) {
        selectedIccs = state.selectedBoardPiece;
        const toXY = vschess.i2b[selectedIccs];
        logicX = toXY % 9;
        logicY = Math.floor(toXY / 9);
    } else if (!state.isEditMode && state.selectedSquare) {
        selectedIccs = state.selectedSquare.iccs;
        logicX = state.selectedSquare.x;
        logicY = state.selectedSquare.y;
    }

    if (!selectedIccs) return;

    const sIndex = vschess.i2s[selectedIccs];
    const pieceCode = state.currentSituation[sIndex];
    if (pieceCode <= 1) return;

    const imgPiece = getPieceImage(pieceCode);
    const imgSelection = imageCache['selection'];
    if (!imgPiece) return;

    const p = getCanvasCoords(logicX, logicY);
    const cx = Math.round(p.cx);
    const cy = Math.round(p.cy);
    const pSize = Math.round(pieceSize);

    // 1. VẼ ẢNH LỰA CHỌN (selection.webp) NẰM BÊN DƯỚI QUÂN CỜ
    if (imgSelection) {
        const sSize = Math.round(pSize * SELECTION_SCALE);
        ctx.drawImage(imgSelection, cx - sSize/2, cy - sSize/2, sSize, sSize);
    }

    // 2. VẼ QUÂN CỜ ĐÈ LÊN TRÊN
    ctx.drawImage(imgPiece, cx - pSize/2, cy - pSize/2, pSize, pSize);
}

function drawLegalMoveDots() {
    const isBlindMode = state.appMode === 'blind' || (state.appMode === 'memorize' && state.memorizeSettings.isBlind);
    if (isBlindMode && !state.isPeeking) return;
    if (!state.legalMoves || state.legalMoves.length === 0) return;
    
    const imgDot = imageCache['dot'];
    if (!imgDot) return;

    const dSize = Math.round(pieceSize * DOT_SCALE);
    const halfDSize = Math.round(dSize / 2);

    state.legalMoves.forEach(move => {
        const toIccs = move.substring(2, 4);
        const toXY = vschess.i2b[toIccs];
        const p = getCanvasCoords(toXY % 9, Math.floor(toXY / 9));

        // Vẽ ảnh dot.webp
        // Lưu ý: Vì trong hàm renderLoop(), drawLegalMoveDots() được gọi SAU hàm drawStaticPieces(),
        // nên chấm dot.webp này sẽ tự động NẰM ĐÈ LÊN TRÊN quân cờ nếu đó là nước ăn quân!
        ctx.drawImage(imgDot, Math.round(p.cx) - halfDSize, Math.round(p.cy) - halfDSize, dSize, dSize);
    });
}

// Trả về ảnh của quân cờ tùy theo chế độ (Thường hoặc Mù)
function getPieceImage(pieceCode) {
    const isBlindMode = state.appMode === 'blind' || (state.appMode === 'memorize' && state.memorizeSettings.isBlind);
    if (isBlindMode && !state.isPeeking) {
        const char = vschess.n2f[pieceCode];
        // Ký tự viết hoa (R, N, B, A, K, C, P) là quân Đỏ
        const isRed = char === char.toUpperCase() && char !== '*'; 
        return isRed ? imageCache['blind_w'] : imageCache['blind_b'];
    }
    return imageCache[vschess.n2f[pieceCode]];
}

function drawStaticPieces() {
    if (!state.currentSituation) return;

    let selectedIccs = state.isEditMode ? state.selectedBoardPiece : (state.selectedSquare ? state.selectedSquare.iccs : null);
    
    // Tính toán trước kích thước và độ lệch
    const pSize = Math.round(pieceSize);
    const halfSize = Math.round(pSize / 2);
    
    // Lấy ảnh shadow và tính kích thước bóng
    const shadowImg = imageCache['shadow'];
    const sSize = Math.round(pSize * SHADOW_SCALE);
    const halfSSize = Math.round(sSize / 2);
    const offsetX = Math.round(pSize * SHADOW_OFFSET_X_PCT);
    const offsetY = Math.round(pSize * SHADOW_OFFSET_Y_PCT);

    for (let index = 51; index < 204; index++) {
        const pieceCode = state.currentSituation[index];
        if (pieceCode > 1) {
            const logicalIccs = vschess.s2i[index];
            if (animState && animState.to === logicalIccs && state.isAnimating) continue;
            if (logicalIccs === selectedIccs) continue;

            const boardNum = vschess.i2b[logicalIccs];
            const img = getPieceImage(pieceCode);
            if (img) {
                const coords = getCanvasCoords(boardNum % 9, Math.floor(boardNum / 9));
                const cx = Math.round(coords.cx);
                const cy = Math.round(coords.cy);

                // VẼ ẢNH BÓNG ĐỔ (Nếu có)
                if (shadowImg) {
                    ctx.drawImage(shadowImg, cx - halfSSize + offsetX, cy - halfSSize + offsetY, sSize, sSize);
                }

                // VẼ QUÂN CỜ
                ctx.drawImage(img, cx - halfSize, cy - halfSize, pSize, pSize);
            }
        }
    }
}

function drawAnimatingPiece() {
    if (!animState || !state.isAnimating) { 
        animState = null; 
        return; 
    }
    
    const startX = animState.startX;
    const startY = animState.startY;
    const endX = animState.endX;
    const endY = animState.endY;
    const pieceCode = animState.piece;

    const elapsed = performance.now() - animState.startTime;
    let progress = elapsed / animState.duration;
    
    if (progress >= 1) { 
        progress = 1; 
        animState = null; 
        state.isAnimating = false; 
    }
    
    const f = 1 - progress;
    const easeOut = 1 - (f * f * f);

    const currentX = Math.round(startX + (endX - startX) * easeOut);
    const currentY = Math.round(startY + (endY - startY) * easeOut);

    const img = getPieceImage(pieceCode);
    if (img) {
        const pSize = Math.round(pieceSize);
        const halfSize = Math.round(pSize / 2);

        // VẼ ẢNH BÓNG ĐỔ KHI BAY (Độ lệch lớn hơn)
        const shadowImg = imageCache['shadow'];
        if (shadowImg) {
            const sSize = Math.round(pSize * SHADOW_SCALE);
            const halfSSize = Math.round(sSize / 2);
            const flyOffsetX = Math.round(pSize * SHADOW_OFFSET_X_PCT);
            const flyOffsetY = Math.round(pSize * SHADOW_OFFSET_Y_PCT);
            
            ctx.drawImage(shadowImg, currentX - halfSSize + flyOffsetX, currentY - halfSSize + flyOffsetY, sSize, sSize);
        }
        
        // VẼ QUÂN CỜ ĐANG BAY
        ctx.drawImage(img, currentX - halfSize, currentY - halfSize, pSize, pSize);
    }
}

function drawBestMoveArrowCanvas() {
    if (state.isAnimating || state.isEditMode || state.appMode === 'blind' || state.appMode === 'memorize' || state.appMode === 'puzzle') return;
    
    if (!state.appSettings.arrows) return;

    // Hàm helper để vẽ 1 mũi tên đa giác
    const drawSingleArrow = (move, color, rank) => {
        if (!move || typeof move !== 'string') return;
        const cleanMove = move.trim().toLowerCase();
        if (cleanMove.length < 4) return;

        const fromKey = cleanMove.substring(0, 2);
        const toKey = cleanMove.substring(2, 4);

        if (vschess.i2b[fromKey] === undefined || vschess.i2b[toKey] === undefined) return;

        const fXY = vschess.i2b[fromKey];
        const tXY = vschess.i2b[toKey];

        const p1 = getCanvasCoords(fXY % 9, Math.floor(fXY / 9));
        const p2 = getCanvasCoords(tXY % 9, Math.floor(tXY / 9));

        if (!p1 || !p2 || isNaN(p1.cx) || isNaN(p1.cy) || isNaN(p2.cx) || isNaN(p2.cy)) return;

        // Tính toán góc xoay và khoảng cách giữa 2 điểm
        const dx = p2.cx - p1.cx;
        const dy = p2.cy - p1.cy;
        const angle = Math.atan2(dy, dx);
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1) return;

        // KÍCH THƯỚC CẤU TẠO MŨI TÊN
        const headLength = pieceSize * 0.3;      // Chiều dài chóp mũi tên
        const headWidth = pieceSize * 0.45;       // Chiều rộng chóp mũi tên
        const tailStartWidth = pieceSize * 0.03; // Độ rộng phần đuôi
        const tailEndWidth = pieceSize * 0.2;   // Độ rộng phần cổ

        ctx.save();
        ctx.translate(p1.cx, p1.cy);
        ctx.rotate(angle);

        ctx.beginPath();
        ctx.moveTo(0, tailStartWidth / 2);                    
        ctx.lineTo(distance - headLength, tailEndWidth / 2);  
        ctx.lineTo(distance - headLength, headWidth / 2);     
        ctx.lineTo(distance, 0);                              
        ctx.lineTo(distance - headLength, -headWidth / 2);    
        ctx.lineTo(distance - headLength, -tailEndWidth / 2); 
        ctx.lineTo(0, -tailStartWidth / 2);                   
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.fill();       

        ctx.restore(); 

        const textOffset = headLength * 0.65;
        const textX = p2.cx - Math.cos(angle) * textOffset;
        const textY = p2.cy - Math.sin(angle) * textOffset;

        ctx.fillStyle = "white"; 
        ctx.font = `bold ${pieceSize * 0.2}px Arial`;
        ctx.textAlign = "center"; 
        ctx.textBaseline = "middle";
        ctx.fillText(rank, textX, textY + 1); 
    };

    // TRƯỜNG HỢP SAU KHI PHÂN TÍCH: VẼ MŨI TÊN "AI" NẾU ĐI LỖI
    if (state.isChartAnalyzed && state.currentNode && state.currentNode.parent) {
        const cls = state.currentNode.classification;
        const aiMove = state.currentNode.parent.aiBestMove;
        
        // Nếu nước hiện tại bị đánh giá là lỗi (inaccuracy, mistake, blunder) và có nước đề xuất
        if (['balanced', 'inaccuracy', 'mistake', 'blunder', 'missed_win'].includes(cls) && aiMove) {
            drawSingleArrow(aiMove, "#008a3eb9", "AI");
            return; 
        }
    }

    // NẾU rê chuột vào một dòng PV cụ thể, vẽ chuỗi nước đi xem trước (PV Preview)
    if (state.hoveredPVLine && state.hoveredPVLine.pv) {
        const colors = ["#4caf4fbd", "#f44336bd", "#2196f3bd", "#ff9800bd"];
        state.hoveredPVLine.pv.slice(0, 4).forEach((move, index) => {
            drawSingleArrow(move, colors[index % colors.length], index + 1);
        });
        return; // Bỏ qua vẽ các dòng PV tĩnh để tránh rối mắt
    }

    // CHỈ VẼ MŨI TÊN GỢI Ý AI KHI NGƯỜI DÙNG BẬT THẨM CỜ (isAnalyzing === true)
    if (state.isAnalyzing && state.pvLines && state.pvLines.length > 0) {
        state.pvLines.forEach(line => {
            if (!line) return;
            // Vẽ mũi tên nước đi chính
            if (line.bestMove) {
                drawSingleArrow(line.bestMove, "#4caf4fbd", line.rank);
            }
            // Vẽ mũi tên nước đi dự đoán của đối thủ
            if (line.ponderMove) {
                drawSingleArrow(line.ponderMove, "#ff4080b9", line.rank);
            }
        });
        return;
    }

    // NẾU KHÔNG BẬT THẨM: VẼ MŨI TÊN ĐÁNH SỐ 1, 2, 3... CHO TẤT CẢ CÁC NHÁNH BIẾN HÓA (NẾU CÓ TRONG KỲ PHỔ)
    if (!state.isAnalyzing && state.appMode !== 'vsbot') {
        let varParentNode = null;
        const varModal = document.getElementById('variation-modal');
        const isVarModalOpen = varModal && (varModal.style.display === 'flex' || varModal.style.display === 'block');

        if (isVarModalOpen && state.editingParentNode && state.editingParentNode.children && state.editingParentNode.children.length > 1) {
            varParentNode = state.editingParentNode;
        } else if (state.currentNode && state.currentNode.children && state.currentNode.children.length > 1) {
            varParentNode = state.currentNode;
        }

        if (varParentNode && varParentNode.children && varParentNode.children.length > 1) {
            const variationColors = ["#4caf4fbd", "#f44336bd", "#2196f3bd", "#ff9800bd", "#9c27b0bd", "#00bcd4bd", "#e91e63bd"];
            varParentNode.children.forEach((child, index) => {
                const moveCmd = child ? (child.moveCommand || child.move) : null;
                if (moveCmd) {
                    const color = variationColors[index % variationColors.length];
                    drawSingleArrow(moveCmd, color, index + 1);
                }
            });
        }
    }
}

// ==========================================
// CÁC HÀM "BÙ NHÌN" ĐỂ TRÁNH LỖI IMPORT Ở CÁC FILE KHÁC
// ==========================================
export function renderBoardFull(situation) { state.currentSituation = situation; }
export function clearDots() {}
export function clearArrow() {}
export function drawLastMoveDots() {}
export function drawBestMoveArrow() {}

export function updateScoreBar(node = state.currentNode) {
    const scoreBarFill = document.getElementById("score-bar-fill");
    const scoreTextEl = document.getElementById("score-text");
    if (!scoreBarFill || !scoreTextEl) return;

    let absRedScore = 0;
    if (node && node.evalScore !== undefined) absRedScore = node.evalScore;
    else if (node && node.analysis && node.analysis.score !== undefined) absRedScore = node.analysis.score;

    const isFlipped = state.isBoardFlipped;
    const playerPerspectiveScore = isFlipped ? -absRedScore : absRedScore;

    let winRate = 50 + (playerPerspectiveScore * 10);
    winRate = Math.max(0, Math.min(100, winRate));

    scoreBarFill.style.width = `${winRate}%`;

    const prefix = isFlipped ? "Đen: " : "Đỏ: ";
    const formattedScore = (playerPerspectiveScore > 0 ? "+" : "") + playerPerspectiveScore.toFixed(2);
    scoreTextEl.innerText = `Điểm ${prefix}${formattedScore}`;

    const winFill = document.getElementById("wdl-win-fill");
    const drawFill = document.getElementById("wdl-draw-fill");
    const lossFill = document.getElementById("wdl-loss-fill");
    if (winFill && drawFill && lossFill) {
        let winPct, drawPct, lossPct;
        if (node && node.wdl) {
            winPct = node.wdl.win;
            drawPct = node.wdl.draw;
            lossPct = node.wdl.loss;
        } else {
            const cp = absRedScore * 100;
            const redWinProb = 1 / (1 + Math.exp(-cp / 200));
            const blackWinProb = 1 - redWinProb;
            const absCp = Math.abs(cp);
            const drawProb = Math.max(0, 0.30 - absCp * 0.0004);
            const remainForWinLoss = 1 - drawProb;
            winPct = Math.round(redWinProb * remainForWinLoss * 1000) / 10;
            lossPct = Math.round(blackWinProb * remainForWinLoss * 1000) / 10;
            drawPct = Math.round((100 - winPct - lossPct) * 10) / 10;
            if (drawPct < 0) drawPct = 0;
        }

        winFill.style.width = `${winPct}%`;
        winFill.innerText = winPct >= 10 ? `Đỏ ${winPct}%` : (winPct >= 5 ? `${winPct}%` : '');
        drawFill.style.width = `${drawPct}%`;
        drawFill.innerText = drawPct >= 10 ? `Hòa ${drawPct}%` : (drawPct >= 5 ? `${drawPct}%` : '');
        lossFill.style.width = `${lossPct}%`;
        lossFill.innerText = lossPct >= 10 ? `Đen ${lossPct}%` : (lossPct >= 5 ? `${lossPct}%` : '');
    }
}

export function renderMoveHistory() {
    updateScoreBar(state.currentNode);
    const container = document.getElementById('move-list-container');
    container.innerHTML = ''; 
    const path = getMainLine(); 

    // BƯỚC 1: Kiểm tra xem Bàn cờ gốc (lúc chưa đi nước nào) là Đỏ hay Đen đi trước
    let isRootBlack = false;
    if (path.length > 0 && path[0].fen) {
        isRootBlack = path[0].fen.split(" ")[1] === "b";
    }

    for (let i = 0; i < path.length; i++) {
        const node = path[i]; 
        ensureNodeData(node);
        const btn = document.createElement('button');
        
        if (i === 0) {
            btn.className = 'move-box header-box'; 
            btn.innerText = "Nước Đi";
        } else {
            btn.className = 'move-box';
            if (i > state.currentStepNum) btn.classList.add('move-future');
            
            const wasRedMove = node.fen.split(" ")[1] === "b";
            
            // Lấy số Round thực tế từ FEN
            let rawRoundNum = parseInt(node.roundNum, 10);
            if (isNaN(rawRoundNum) || rawRoundNum === 0) rawRoundNum = 1;

            // BƯỚC 2: CÔNG THỨC BÙ TRỪ 
            // Nếu Đen đi trước -> Trừ đi 1 để Đỏ hiển thị đúng số 1
            let displayRoundNum = rawRoundNum - (isRootBlack ? 1 : 0);
            if (displayRoundNum < 1) displayRoundNum = 1; // Đảm bảo không bao giờ < 1
            
            let htmlStr = '';
            // Gắn displayRoundNum vào html của quân Đỏ
            if (wasRedMove) htmlStr = `<span class="move-num">${displayRoundNum}.</span> <span class="move-text text-red">${node.notation}</span>`;
            else htmlStr = `<span class="move-num"></span> <span class="move-text text-black">${node.notation}</span>`;

            if (node.moveFlag === 'strong') {
                htmlStr += `<span class="user-flag-badge" style="background-color: #008a3e; color: #fff; padding: 2px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px; font-weight: bold; line-height: 1;">🟢 Nước Hay</span>`;
            } else if (node.moveFlag === 'inaccuracy') {
                htmlStr += `<span class="user-flag-badge" style="background-color: #d97706; color: #fff; padding: 2px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px; font-weight: bold; line-height: 1;">🟠 Sơ Hở</span>`;
            } else if (node.moveFlag === 'weak') {
                htmlStr += `<span class="user-flag-badge" style="background-color: #ef4444; color: #fff; padding: 2px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px; font-weight: bold; line-height: 1;">🔴 Phế Cờ</span>`;
            }

            if (node.parent && node.parent.children.length > 1) {
                const badgeClass = wasRedMove ? 'var-red' : 'var-black';
                htmlStr += `<span class="var-badge ${badgeClass}">(*)</span>`;
            }

            if (node.comment && node.comment.trim().length > 0) {
                htmlStr += `<span class="note-indicator-badge" title="Có ghi chú phân tích bài học" style="color: #d97706; font-size: 11px; margin-left: 4px; font-weight: bold;">📝</span>`;
            }

            if (node.moveQuality) {
                const q = node.moveQuality;
                let titleMsg = `Đánh giá: ${q.name}`;
                if (node.recommendedNotation) {
                    titleMsg += ` | Nước chuẩn khuyên dùng: ${node.recommendedNotation}`;
                }
                htmlStr += `<span class="quality-badge" title="${titleMsg}" style="background-color: ${q.color}; color: #fff; padding: 2px 4px; border-radius: 3px; font-size: 9px; margin-left: 4px; font-weight: bold; line-height: 1;">${q.symbol || q.icon}</span>`;

                if (node.recommendedNotation && q.symbol) {
                    htmlStr += `<span class="rec-badge" title="Nước chuẩn khuyên dùng: ${node.recommendedNotation}" style="color: #008a3e; font-size: 10px; font-weight: bold; margin-left: 3px; background: #e8f5e9; padding: 1px 3px; border-radius: 3px; border: 1px solid #c8e6c9;">💡 ${node.recommendedNotation}</span>`;
                }
            }
            btn.innerHTML = htmlStr;
        }
        
        if (i === state.currentStepNum) {
            btn.classList.add('move-active'); 
            btn.classList.remove('move-future'); 
            btn.id = 'active-move-btn'; 
        }

        btn.onclick = () => {
            if (state.isAutoPlaying) toggleAutoPlay(); 
            if (i === 0) { forceStopAIPlayers(); jumpToNode(state.rootNode); return; }
            if (node !== state.currentNode) jumpToNode(node); 
            else if (node.parent && node.parent.children.length > 1) openModal('variation-modal', node.parent);
        };
        container.appendChild(btn);
    }
    setTimeout(() => {
        scrollToActiveMove();
    }, 50); 
    const commentBox = document.getElementById('comment-box');
    if (commentBox) commentBox.value = state.currentNode.comment || "";
    
    try { renderEvalGraph(); } catch(e) {}

    if (state.isChartRunning && !state.isChartDrawing) {
        import('./chart.js').then(chart => chart.refreshChartUI());
    }
    const reviewBox = document.getElementById('review-container');
    if (reviewBox && reviewBox.style.display !== 'none') {
        import('./chart.js').then(chart => {
            chart.resetReviewCache(); 
            chart.updateReviewUI();
        });
    }
    
    const moveCommentInput = document.getElementById('move-comment-input');
    const moveNoteSection = document.getElementById('move-note-section');
    const noteHasBadge = document.getElementById('note-has-badge');
    const currentComment = (state.currentNode.comment || "").trim();

    if (moveCommentInput) {
        moveCommentInput.value = state.currentNode.comment || "";
        autoAdjustNoteTextareaHeight();
    }

    if (moveNoteSection) {
        if (currentComment.length > 0) {
            moveNoteSection.classList.add('has-note');
            if (noteHasBadge) noteHasBadge.style.display = 'inline-block';
        } else {
            moveNoteSection.classList.remove('has-note');
            if (noteHasBadge) noteHasBadge.style.display = 'none';
        }
    }

    const moveFlagSelect = document.getElementById('move-flag-select');
    if (moveFlagSelect) moveFlagSelect.value = state.currentNode.moveFlag || "normal";
}

export function autoAdjustNoteTextareaHeight() {
    const el = document.getElementById('move-comment-input');
    if (!el) return;
    el.style.height = '36px';
    if (el.value && el.value.trim().length > 0) {
        const newH = Math.min(Math.max(el.scrollHeight + 2, 36), 130);
        el.style.height = newH + 'px';
    }
}

export function scrollToActiveMove() {
    const container = document.getElementById('move-list-container');
    const activeBtn = document.getElementById('active-move-btn');
    if (container && activeBtn) {
        const containerRect = container.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        const targetScroll = container.scrollTop + (btnRect.top - containerRect.top) - (container.clientHeight / 2) + (btnRect.height / 2);
        container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
}