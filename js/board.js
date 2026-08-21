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
        const pieceKeys = Object.keys(PIECE_MAP);
        const extraImages = ['shadow', 'dot', 'from', 'to', 'selection', 'blind_b', 'blind_w']; // Các ảnh hiệu ứng
        
        let loadedCount = 0;
        const totalImages = pieceKeys.length + extraImages.length; 

        const checkDone = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                isImagesLoaded = true;
                resolve();
            }
        };

        // Tải ảnh các hiệu ứng (UI)
        extraImages.forEach(imgName => {
            const img = new Image();
            img.src = `style/${imgName}.webp`;
            img.onload = () => { imageCache[imgName] = img; checkDone(); };
            img.onerror = () => { console.error(`Lỗi tải ảnh: ${imgName}.webp`); checkDone(); };
        });

        // Tải ảnh các quân cờ
        pieceKeys.forEach(key => {
            const img = new Image();
            img.src = `style/${PIECE_MAP[key]}.webp`;
            img.onload = () => { imageCache[key] = img; checkDone(); };
            img.onerror = () => { console.error(`Lỗi tải ảnh quân cờ: ${img.src}`); checkDone(); };
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
    canvas.addEventListener('click', handleCanvasClick);
    
    if (!isRenderLoopRunning) {
        isRenderLoopRunning = true;
        requestAnimationFrame(renderLoop);
    }
}

function resizeCanvas() {
    if (!canvas) return;
    const parent = document.getElementById('chess-board-area');
    
    // ĐÃ SỬA: Dùng offsetWidth thay vì getBoundingClientRect()
    // Để lấy kích thước gốc chưa bị ảnh hưởng bởi CSS transform: scale()
    const trueWidth = parent.offsetWidth;
    const trueHeight = parent.offsetHeight;
    
    boardRect = { width: trueWidth, height: trueHeight };

    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = trueWidth * dpr;
    canvas.height = trueHeight * dpr;
    
    // ĐÃ SỬA: Canvas luôn tự động fill đầy thẻ cha 100%
    canvas.style.width = `100%`;
    canvas.style.height = `100%`;
    
    ctx.scale(dpr, dpr);
    
    // Chỉnh kích thước quân cờ (bạn có thể đổi lại 0.1 nếu thấy 0.088 hơi nhỏ)
    pieceSize = trueWidth * 0.1; 
}

// Raycasting: Tính toán tọa độ Click bằng TỶ LỆ PHẦN TRĂM (%)
function handleCanvasClick(event) {
    if (!boardRect || boardRect.width === 0) return;
    
    // Lấy khung hiển thị thực tế trên màn hình
    const rect = canvas.getBoundingClientRect();
    
    // ĐÃ SỬA: Tính ra % vị trí con trỏ chuột trên thẻ Canvas (từ 0.0 đến 1.0)
    // Việc dùng % giúp Click luôn chính xác dù CSS có scale hay zoom bao nhiêu đi nữa
    const percentX = (event.clientX - rect.left) / rect.width;
    const percentY = (event.clientY - rect.top) / rect.height;

    // Tỷ lệ lề của bàn cờ Tượng Kỳ (7% chiều ngang, 6.5% chiều dọc)
    const paddingXPercent = 0.07;
    const paddingYPercent = 0.065;
    
    // Không gian lưới chứa các đường kẻ
    const gridWidthPercent = 1 - (paddingXPercent * 2);
    const gridHeightPercent = 1 - (paddingYPercent * 2);
    
    // Kích thước 1 ô cờ tính bằng %
    const cellXPercent = gridWidthPercent / 8;
    const cellYPercent = gridHeightPercent / 9;

    // Quy đổi % ra tọa độ logic (0-8 cho X, 0-9 cho Y)
    let logicX = Math.round((percentX - paddingXPercent) / cellXPercent);
    let logicY = Math.round((percentY - paddingYPercent) / cellYPercent);

    if (state.isBoardFlipped) {
        logicX = 8 - logicX;
        logicY = 9 - logicY;
    }

    if (logicX < 0 || logicX > 8 || logicY < 0 || logicY > 9) return;
    const boardNum = logicY * 9 + logicX;
    const iccsPos = vschess.b2i[boardNum];

    if (state.isEditMode) handleEditSquareClick(iccsPos);
    else handleSquareClick(logicX, logicY, iccsPos);
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

// VÒNG LẶP RENDER CHÍNH
function renderLoop() {
    if (!ctx || !boardRect.width) { requestAnimationFrame(renderLoop); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawLastMoveHighlights();
    drawStaticPieces();          // Vẽ các quân cờ bình thường trước
    drawAnimatingPiece();        // Vẽ quân đang bay
    drawSelectedPiece();         // <--- VẼ QUÂN ĐANG CHỌN PHÁT SÁNG NỔI LÊN TRÊN
    drawLegalMoveDots();         // Vẽ chấm xanh nước đi
    drawBestMoveArrowCanvas();   // Vẽ mũi tên AI

    requestAnimationFrame(renderLoop);
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
        const activeBtn = document.getElementById('active-move-btn');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50); 
    const commentBox = document.getElementById('comment-box');
    if (commentBox) commentBox.value = state.currentNode.comment || "";
    
    try { renderEvalGraph(); } catch(e) {}
    
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