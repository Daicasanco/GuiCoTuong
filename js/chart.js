// js/chart.js
import { state } from './state.js';
import { generateExpertCommentary, calculateWinRatePercentage } from './analyzer.js';

let canvasMain, ctxMain; 
let isPointerListenerAdded = false;
let isDraggingCursor = false;

const Y_AXIS_WIDTH = 45;  
const PADDING_X = 15;     

const TIER_1 = { max: 400, steps: [-400, -300, -200, -100, 0, 100, 200, 300, 400] };
const TIER_2 = { max: 800, steps: [-800, -600, -400, -200, 0, 200, 400, 600, 800] };
const TIER_3 = { max: 1000, steps: [-1000, -750, -500, -250, 0, 250, 500, 750, 1000] };

export function initChartUI() {
    canvasMain = document.getElementById('analysis-chart');
    
    const canvasY = document.getElementById('y-axis-canvas');
    if (canvasY) canvasY.style.display = 'none';

    const container = document.getElementById('chart-container');
    if (container) {
        container.style.overflowX = 'hidden';
        container.style.overflowY = 'hidden';
    }

    if (!canvasMain) return;
    ctxMain = canvasMain.getContext('2d');
    
    canvasMain.style.touchAction = 'pan-y';

    if (!isPointerListenerAdded) {
        canvasMain.addEventListener('pointerdown', handlePointerDown);
        canvasMain.addEventListener('pointermove', handlePointerMove);
        canvasMain.addEventListener('pointerup', handlePointerUp);
        canvasMain.addEventListener('pointercancel', handlePointerUp);
        isPointerListenerAdded = true;
    }
    
    const scoreBar = document.querySelector('.score-bar-wrapper');
    const multipvList = document.getElementById('multipv-list-container');
    if (scoreBar) scoreBar.style.display = 'none';
    if (multipvList) multipvList.style.display = 'none';

    const chartWrapper = document.getElementById('chart-wrapper');
    if (chartWrapper) chartWrapper.style.display = 'block';

    state.chartData = [];
    state.isChartAnalyzed = false;
    state.chartReport = null;

    const pikaTab = document.querySelector('.ai-tab-btn[data-tab="pikafish"]');
    if (pikaTab) pikaTab.click(); 
    toggleChartTabsUI(true);
    
    requestAnimationFrame(() => { resizeAndDrawChart(); });
}

export function closeChartUI() {
    const scoreBar = document.querySelector('.score-bar-wrapper');
    const multipvList = document.getElementById('multipv-list-container');
    if (scoreBar) scoreBar.style.display = 'block';
    if (multipvList) multipvList.style.display = 'flex';

    const chartWrapper = document.getElementById('chart-wrapper');
    if (chartWrapper) chartWrapper.style.display = 'none';
    
    state.chartData = [];
    state.isChartAnalyzed = false;
    state.chartTotalMoves = 0;
    state.chartReport = null;
    
    const colRed = document.getElementById('mistake-col-red');
    const colBlack = document.getElementById('mistake-col-black');
    if (colRed) colRed.innerHTML = '';
    if (colBlack) colBlack.innerHTML = '';

    toggleChartTabsUI(false);
}

let chartRenderPending = false;
export function addChartPoint(score, isRedMoved, classification = null) {
    state.chartData.push({ score, isRedMoved, classification });
    resizeAndDrawChart();
}

export function refreshChartUI() {
    resizeAndDrawChart();
}

// --- TÍNH TOÁN TỌA ĐỘ VÀ SCALING ---

function getActiveTier() {
    if (state.chartData.length === 0) return TIER_1;
    let maxAbsScore = 0;
    
    for (let i = 0; i < state.chartData.length; i++) {
        const absScore = Math.abs(state.chartData[i].score);
        if (absScore > maxAbsScore) maxAbsScore = absScore;
    }
    
    if (maxAbsScore > 800) return TIER_3;
    if (maxAbsScore > 400) return TIER_2;
    return TIER_1; 
}

function getYPos(score, h, maxRange) {
    let visualScore = score;
    if (visualScore > maxRange) visualScore = maxRange;
    if (visualScore < -maxRange) visualScore = -maxRange;

    const usableHeight = h * 0.8; 
    const centerY = h / 2;        
    return centerY - (visualScore / maxRange) * (usableHeight / 2);
}

function getXPos(index, w) {
    const totalPoints = state.chartTotalMoves || Math.max(1, state.chartData.length);
    const startX = Y_AXIS_WIDTH + PADDING_X; 
    const availableWidth = w - startX - PADDING_X; 
    
    if (totalPoints <= 1) {
        return startX + availableWidth / 2;
    }
    
    const spacing = availableWidth / (totalPoints - 1);
    return startX + (index * spacing);
}

// --- XỬ LÝ SỰ KIỆN KÉO THẢ (SCRUBBING) ---
function getClosestIndex(clientX) {
    const rect = canvasMain.getBoundingClientRect();
    const xClick = clientX - rect.left;
    const w = canvasMain.clientWidth;
    
    let closestIndex = -1;
    let minDiff = Infinity;
    
    for (let i = 0; i < state.chartData.length; i++) {
        const px = getXPos(i, w);
        const diff = Math.abs(xClick - px);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }
    return closestIndex;
}

function jumpToIndex(index) {
    if (index < 0 || index >= state.chartData.length) return;
    
    // Nếu vẫn đang đứng ở nước hiện tại thì không làm gì cả để tránh lag
    if (index === state.currentStepNum - 1) return;

    let targetNode = state.rootNode;
    for (let i = 0; i <= index; i++) {
        if (targetNode.children.length > 0) {
            targetNode = targetNode.children[targetNode.mainLineIndex];
        } else break;
    }

    import('./game.js').then(game => {
        game.forceStopAIPlayers();
        game.instantJumpToNode(targetNode);
    });
}

function handlePointerDown(e) {
    if (state.isChartDrawing || state.chartData.length === 0) return;
    
    const rect = canvasMain.getBoundingClientRect();
    const xClick = e.clientX - rect.left;

    if (xClick <= Y_AXIS_WIDTH) {
        return;
    }

    isDraggingCursor = true;
    canvasMain.setPointerCapture(e.pointerId);
    canvasMain.style.cursor = "grabbing"; // Đổi icon trỏ chuột
    
    const idx = getClosestIndex(e.clientX);
    jumpToIndex(idx);
}

function handlePointerMove(e) {
    if (!isDraggingCursor) {
        canvasMain.style.cursor = "crosshair";
        return;
    }
    const idx = getClosestIndex(e.clientX);
    jumpToIndex(idx);
}

function handlePointerUp(e) {
    isDraggingCursor = false;
    canvasMain.style.cursor = "crosshair";
    canvasMain.releasePointerCapture(e.pointerId);
}

// --- VẼ BIỂU ĐỒ ---
function resizeAndDrawChart() {
    if (!canvasMain || !ctxMain) return;

    const wrapper = document.getElementById('chart-wrapper');
    if (!wrapper) return;

    const btnLegend = document.getElementById('btn-chart-legend');
    if (btnLegend) {
        btnLegend.disabled = !state.isChartAnalyzed; // Chỉ mở khóa khi phân tích xong
    }

    canvasMain.style.width = '0px';
    canvasMain.style.height = '0px';

    const exactHeight = wrapper.clientHeight;
    const exactWidth = wrapper.clientWidth; 
    
    if (exactHeight <= 0 || exactWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    
    canvasMain.width = exactWidth * dpr;
    canvasMain.height = exactHeight * dpr;
    canvasMain.style.width = `${exactWidth}px`;
    canvasMain.style.height = `${exactHeight}px`;
    
    ctxMain.scale(dpr, dpr);
    ctxMain.clearRect(0, 0, exactWidth, exactHeight);

    const activeTier = getActiveTier();

    drawGridLines(exactWidth, exactHeight, activeTier);
    drawYAxisText(exactHeight, activeTier);   
    drawPhaseBoundaries(exactWidth, exactHeight);               
    drawDataPoints(exactWidth, exactHeight, activeTier.max);  
    if (state.isChartAnalyzed) {
        drawClassificationDots(exactWidth, exactHeight, activeTier.max);
    }               
    drawCursor(exactWidth, exactHeight, activeTier.max); 
}

function drawGridLines(w, h, tier) {
    tier.steps.forEach(val => {
        const y = getYPos(val, h, tier.max);
        ctxMain.beginPath();
        ctxMain.moveTo(Y_AXIS_WIDTH, y); 
        ctxMain.lineTo(w, y);
        
        if (val === 0) { 
            ctxMain.strokeStyle = "#999"; 
            ctxMain.lineWidth = 1.5; 
        } else { 
            ctxMain.strokeStyle = "#e8e8e8"; 
            ctxMain.lineWidth = 1; 
        }
        ctxMain.stroke();
    });
}

function drawYAxisText(h, tier) {
    ctxMain.font = "10px Arial";
    ctxMain.textAlign = "right";
    ctxMain.textBaseline = "middle";

    tier.steps.forEach(val => {
        const y = getYPos(val, h, tier.max);
        if (val > 0) ctxMain.fillStyle = "#008a3e";       
        else if (val < 0) ctxMain.fillStyle = "#d32f2f";  
        else ctxMain.fillStyle = "#333333";               
        ctxMain.fillText(val.toString(), Y_AXIS_WIDTH - 5, y);
    });
}

function drawDataPoints(w, h, maxRange) {
    if (state.chartData.length === 0) return;

    ctxMain.lineWidth = 2;
    ctxMain.strokeStyle = "#1a73e8"; 
    ctxMain.beginPath();

    state.chartData.forEach((point, index) => {
        const x = getXPos(index, w);
        const displayScore = state.isBoardFlipped ? -point.score : point.score;
        const y = getYPos(displayScore, h, maxRange);
        
        if (index === 0) ctxMain.moveTo(x, y);
        else ctxMain.lineTo(x, y);
    });
    ctxMain.stroke();
}

function drawCursor(w, h, maxRange) {
    const stepIndex = state.currentStepNum - 1;
    const x = getXPos(stepIndex, w);
    
    ctxMain.save();
    
    // Xử lý text hiển thị bên cạnh đường gạch đứt
    const isLeftHalf = x < w / 2;
    const textX = isLeftHalf ? x + 6 : x - 6; 
    ctxMain.textAlign = isLeftHalf ? "left" : "right";

    let themeColor = "#333333";
    let displayScore = 0;
    let classification = null;
    
    // Nếu điểm này ĐÃ ĐƯỢC PHÂN TÍCH (tức là đã có trong chartData)
    if (stepIndex >= 0 && stepIndex < state.chartData.length) {
        const point = state.chartData[stepIndex];
        let rawAbsoluteScore = 0;
        let currNode = state.rootNode;
        for (let i = 0; i <= stepIndex; i++) {
            if (currNode && currNode.children.length > 0) {
                currNode = currNode.children[currNode.mainLineIndex];
            } else break;
        }

        if (currNode && currNode.normalizedScore !== undefined && currNode.normalizedScore !== null) {
            rawAbsoluteScore = currNode.normalizedScore;
        } else {
            rawAbsoluteScore = point.score; 
        }

        displayScore = state.isBoardFlipped ? -rawAbsoluteScore : rawAbsoluteScore;

        themeColor = point.isRedMoved ? "#cc0000" : "#000000";
        classification = point.classification;
        
        const graphScore = state.isBoardFlipped ? -point.score : point.score;
        const y = getYPos(graphScore, h, maxRange);

        // Vẽ Text Điểm Số (Đỉnh)
        ctxMain.fillStyle = themeColor; 
        ctxMain.font = "bold 11px Arial"; 
        ctxMain.textBaseline = "top"; 
        
        const prefix = state.isBoardFlipped ? "Điểm Đen: " : "Điểm Đỏ: ";
        const textScore = displayScore > 0 ? `+${displayScore}` : displayScore.toString();
        ctxMain.fillText(prefix + textScore, textX, 2);

        if (state.isChartAnalyzed && classification) {
            const classLangMap = {
                'best':       { text: "Tốt nhất",           color: "#5b9a32" }, // Xanh lá
                'excellent':  { text: "Xuất sắc",           color: "#8e44ad" }, // Tím
                'good':       { text: "Tốt",                color: "#1a73e8" }, // Xanh dương
                'balanced':   { text: "Cân bằng",           color: "#8d6e63" }, // Nâu nhạt hơi chàm
                'inaccuracy': { text: "Thiếu chính xác",    color: "#e6a817" }, // Vàng nâu nhẹ
                'mistake':    { text: "Sai lầm",            color: "#e67c17" }, // Cam
                'blunder':    { text: "Sai lầm nặng",       color: "#ca3431" }, // Đỏ đậm
                'missed_win': { text: "Bỏ lỡ chiến thắng",  color: "#ca3431" }
            };

            const clInfo = classLangMap[classification];
            if (clInfo) {
                ctxMain.fillStyle = clInfo.color;
                // Nhích xuống dưới Điểm số 15px
                ctxMain.fillText(clInfo.text, textX, 17); 
            }
        }

        // Vẽ Chấm tròn tại điểm giao cắt
        ctxMain.beginPath();
        ctxMain.setLineDash([]); 
        ctxMain.arc(x, y, 4.5, 0, 2 * Math.PI); 
        ctxMain.fillStyle = themeColor; 
        ctxMain.fill();
        ctxMain.strokeStyle = "#ffffff";
        ctxMain.lineWidth = 1.5;
        ctxMain.stroke();
    }

    // Tìm tên nước đi để vẽ ở Đáy biểu đồ
    let currNode = state.rootNode;
    for (let i = 0; i <= stepIndex; i++) {
        if (currNode && currNode.children.length > 0) {
            currNode = currNode.children[currNode.mainLineIndex];
        } else break;
    }
    
    let moveText = "";
    if (currNode && currNode.notation) {
        const startRound = parseInt(state.rootNode.fen.split(" ")[5], 10) || 1;
        const isRootBlack = state.rootNode.fen.split(" ")[1] === "b";
        
        const offset = isRootBlack ? 1 : 0;
        const displayRoundNum = startRound + Math.floor((stepIndex + offset) / 2);
        
        moveText = `${displayRoundNum}: ${currNode.notation}`;
    }

    // Vẽ Đường đứt nét dọc (Vẽ mờ nếu AI chưa phân tích tới)
    ctxMain.beginPath();
    ctxMain.setLineDash([5, 4]); 
    ctxMain.moveTo(x, 0); 
    ctxMain.lineTo(x, h); 
    ctxMain.strokeStyle = themeColor; 
    ctxMain.lineWidth = 1.5;
    ctxMain.globalAlpha = (stepIndex < state.chartData.length) ? 1.0 : 0.4; // Làm mờ nếu chưa tới
    ctxMain.stroke();
    ctxMain.globalAlpha = 1.0;

    // Vẽ Text Nước đi (Đáy)
    if (moveText) {
        ctxMain.fillStyle = themeColor; 
        ctxMain.font = "bold 11px Arial";
        ctxMain.textBaseline = "bottom"; 
        ctxMain.fillText(moveText, textX, h - 2); 
    }

    ctxMain.restore();
    updateReviewUI();
}

function drawClassificationDots(w, h, maxRange) {
    if (state.chartData.length === 0) return;

    // Bảng màu cho 3 loại lỗi
    const colorMap = {
        inaccuracy: "#c7ce00", // Vàng đất
        mistake: "#ef7400",    // Cam đất
        blunder: "#9d0000",    // Đỏ đậm
        missed_win: "#9d0000"  // Dùng chung màu đỏ
    };

    state.chartData.forEach((point, index) => {
        if (point.classification && colorMap[point.classification]) {
            const x = getXPos(index, w);
            const displayScore = state.isBoardFlipped ? -point.score : point.score;
            const y = getYPos(displayScore, h, maxRange);
            
            ctxMain.beginPath();
            ctxMain.arc(x, y, 4.5, 0, 2 * Math.PI); 
            ctxMain.fillStyle = colorMap[point.classification]; 
            ctxMain.fill();
            
            ctxMain.lineWidth = 1.5;
            ctxMain.strokeStyle = "#ffffff";
            ctxMain.stroke();
        }
    });
}

export function toggleChartTabsUI(isChartMode) {
    const tabs = {
        title: { orig: "Tiêu Đề", chart: "Nhận Xét" },
        pikafish: { orig: "Phân Tích", chart: "Biểu Đồ" },
        cloudbook: { orig: "Cloud Book", chart: "Báo Cáo" },
        comment: { orig: "Ghi Chú", chart: "Sai Lầm" }
    };

    for (let key in tabs) {
        // 1. Đổi tên Nút Tab
        const btn = document.querySelector(`.ai-tab-btn[data-tab="${key}"]`);
        if (btn) btn.innerText = isChartMode ? tabs[key].chart : tabs[key].orig;

        // 2. Ẩn/Hiện nội dung bên trong Tab
        const contentDiv = document.getElementById(`tab-${key}`);
        if (contentDiv && key !== 'pikafish') { 
            if (key === 'title') {
                let reviewBox = document.getElementById('review-container');
                
                // Nếu chưa có (do game.js lỡ xóa mất), TỰ ĐỘNG TẠO LẠI!
                if (isChartMode && !reviewBox) {
                    reviewBox = document.createElement('div');
                    reviewBox.id = 'review-container';
                    reviewBox.style.cssText = 'display: flex; flex-direction: column; gap: 15px; width: 100%; text-align: left; padding-top: 5px; user-select: none; -webkit-user-select: none;';
                    reviewBox.innerHTML = `
                        <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #ccc; padding-bottom: 10px;">
                                <span style="font-size: 14px; color: #666;">Nước đi hiện tại:</span>
                                <span id="review-move-text" style="font-size: 22px; font-weight: 900; color: #333;">--</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <span style="font-size: 12px; color: #888;">Điểm số (Đỏ)</span>
                                    <span id="review-score-text" style="font-size: 20px; font-weight: bold;">--</span>
                                </div>
                                <div id="review-badge-box" style="display: flex; align-items: center; gap: 6px; background: #f0f0f0; padding: 6px 12px; border-radius: 20px;">
                                    <img id="review-badge-icon" src="" style="width: 22px; height: 22px; display: none;">
                                    <span id="review-badge-text" style="font-size: 14px; font-weight: bold;">Chưa có</span>
                                </div>
                            </div>
                            <!-- THÊM DÒNG TỈ LỆ THẮNG TẠI ĐÂY -->
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #eee; padding-top: 10px;">
                                <span style="font-size: 13px; color: #666; font-weight: bold;">Tỉ lệ thắng:</span>
                                <span id="review-winrate-text" style="font-size: 16px; font-weight: 900;">--</span>
                            </div>
                        </div>
                        <div style="background: #fffdf0; border: 1px solid #ffe082; border-radius: 8px; padding: 15px; min-height: 120px;">
                            <span style="font-size: 14px; font-weight: bold; color: #f57c00; margin-bottom: 8px; display: block;">Bình luận chuyên môn:</span>
                            <div id="review-comment-text" style="font-size: 14px; color: #555; line-height: 1.6;">
                                <i>Hệ thống đang chờ dữ liệu bình luận...</i>
                            </div>
                        </div>
                    `;
                    contentDiv.appendChild(reviewBox);
                }

                // Giấu sạch mọi thứ khác (bao gồm CHẾ ĐỘ PHÂN TÍCH, game list, v.v..)
                Array.from(contentDiv.children).forEach(child => {
                    if (child.id !== 'review-container') {
                        if (isChartMode) {
                            if (child.dataset.origDisplay === undefined) {
                                child.dataset.origDisplay = child.style.display || '';
                            }
                            child.style.display = 'none';
                        } else {
                            // Phục hồi lại trạng thái hiển thị
                            child.style.display = child.dataset.origDisplay !== undefined ? child.dataset.origDisplay : '';
                        }
                    }
                });

                // Kích hoạt khung Nhận xét
                if (reviewBox) {
                    reviewBox.style.display = isChartMode ? 'flex' : 'none';
                    if (isChartMode) {
                        lastReviewNodeId = null; // Reset cache để ép buộc render lại data
                        setTimeout(() => updateReviewUI(), 50);
                    }
                }
                continue; 
            }

            // ==========================================
            // XỬ LÝ CÁC TAB CÒN LẠI
            // ==========================================
            Array.from(contentDiv.children).forEach(child => {
                if (!child.classList.contains('chart-placeholder')) {
                    
                    if (key === 'cloudbook' && child.id === 'report-container') {
                        child.style.display = isChartMode ? 'flex' : 'none';
                    } else if (key === 'cloudbook' && child.id === 'cloudbook-list-container') {
                        child.style.display = isChartMode ? 'none' : 'flex';
                    } 
                    else if (key === 'comment' && child.id === 'mistakes-container') {
                        child.style.display = isChartMode ? 'flex' : 'none';
                        contentDiv.style.userSelect = isChartMode ? 'none' : 'auto';
                        contentDiv.style.webkitUserSelect = isChartMode ? 'none' : 'auto';
                    } else if (key === 'comment' && child.id === 'comment-box') {
                        child.style.display = isChartMode ? 'none' : 'block';
                        if (!isChartMode) {
                            document.querySelectorAll('.mistake-btn').forEach(b => {
                                b.classList.remove('mistake-active-red', 'mistake-active-black');
                            });
                        }
                    } 
                    else {
                        if (isChartMode) {
                            if (child.dataset.origDisplay === undefined) {
                                child.dataset.origDisplay = child.style.display || '';
                            }
                            child.style.display = 'none';
                        } else {
                            child.style.display = child.dataset.origDisplay !== undefined ? child.dataset.origDisplay : '';
                        }
                    }
                }
            });

            // Ẩn/hiện chữ "Chưa có dữ liệu"
            let placeholder = contentDiv.querySelector('.chart-placeholder');
            if (isChartMode) {
                if ((key === 'cloudbook' || key === 'comment') && state.chartReport) {
                    if (placeholder) placeholder.style.display = 'none';
                } else {
                    if (!placeholder) {
                        placeholder = document.createElement('div');
                        placeholder.className = 'chart-placeholder';
                        placeholder.style.cssText = 'text-align: center; color: #888; margin-top: 30px; font-size: 14px; font-style: italic;';
                        placeholder.innerText = `Chưa có dữ liệu ${tabs[key].chart}`;
                        contentDiv.appendChild(placeholder);
                    }
                    placeholder.style.display = 'block';
                }
            } else {
                if (placeholder) placeholder.style.display = 'none';
            }
        }
    }
    
    if (!isChartMode) {
        const cloudContainer = document.getElementById('cloudbook-list-container');
        if (cloudContainer) cloudContainer.style.display = 'flex'; 
    }
}

function drawPhaseBoundaries(w, h) {
    if (!state.chartReport || !state.isChartAnalyzed) return;
    const { openStep, endStep } = state.chartReport;
    const totalPoints = state.chartTotalMoves || Math.max(1, state.chartData.length);

    // 1. Tính toán trước các mốc tọa độ X trên biểu đồ
    let x0 = getXPos(0, w); // Tọa độ bắt đầu biểu đồ
    let xOpen = getXPos(Math.min(openStep, totalPoints - 1), w); 
    let xEnd = getXPos(Math.min(endStep, totalPoints - 1), w);   
    let xLast = getXPos(totalPoints - 1, w); 

    // 2. Vẽ các đường kẻ dọc nét liền
    ctxMain.beginPath();
    ctxMain.strokeStyle = "rgba(150, 150, 150, 0.5)"; // Màu xám nhạt
    ctxMain.setLineDash([]); // Nét liền
    ctxMain.lineWidth = 1;

    // Kẻ đường 1: Khai -> Trung
    if (openStep > 0 && openStep < totalPoints - 1) {
        ctxMain.moveTo(xOpen, 0); 
        ctxMain.lineTo(xOpen, h);
    }
    // Kẻ đường 2: Trung -> Tàn
    if (endStep > openStep && endStep < totalPoints - 1) {
        ctxMain.moveTo(xEnd, 0); 
        ctxMain.lineTo(xEnd, h);
    }
    ctxMain.stroke();

    // 3. VẼ TEXT TÊN GIAI ĐOẠN
    ctxMain.fillStyle = "rgba(100, 100, 100, 0.8)"; 
    ctxMain.font = "italic 10px Arial"; 
    ctxMain.textAlign = "center"; 
    ctxMain.textBaseline = "bottom"; 
    const textY = h - 2;

    let centerOpen = (x0 + xOpen) / 2;
    if (xOpen - x0 > 30) {
        ctxMain.fillText("Khai cục", centerOpen, textY);
    }

    // Tính điểm chính giữa của Khu vực Trung Cục
    if (openStep < totalPoints - 1) {
        let centerMid = (xOpen + xEnd) / 2;
        if (xEnd - xOpen > 45) { // Cần rộng hơn xíu vì chữ Trung cục dài hơn
            ctxMain.fillText("Trung cục", centerMid, textY);
        }
    }

    // Tính điểm chính giữa của Khu vực Tàn Cục
    if (endStep < totalPoints - 1 && endStep > openStep) {
        let centerEnd = (xEnd + xLast) / 2;
        if (xLast - xEnd > 40) {
            ctxMain.fillText("Tàn cục", centerEnd, textY);
        }
    }
}

let lastReviewNodeId = null;
export function resetReviewCache() {
    lastReviewNodeId = null;
}
export function updateReviewUI() {
    if (!state.isChartAnalyzed || !state.currentNode) return;
    
    if (lastReviewNodeId === state.currentNode.id) return;
    lastReviewNodeId = state.currentNode.id;

    const moveTextEl = document.getElementById('review-move-text');
    const scoreTextEl = document.getElementById('review-score-text');
    const scoreLabelEl = scoreTextEl ? scoreTextEl.previousElementSibling : null;
    
    const badgeBoxEl = document.getElementById('review-badge-box');
    const badgeIconEl = document.getElementById('review-badge-icon');
    const badgeTextEl = document.getElementById('review-badge-text');
    const winrateTextEl = document.getElementById('review-winrate-text');

    if (!moveTextEl || !scoreTextEl || !scoreLabelEl) return;

    // 1. Lấy thông tin Lượt đi
    const isRedMoved = state.currentNode.parent ? (state.currentNode.parent.fen.split(" ")[1] === "w") : true;

    // 2. Cập nhật Tên nước đi & Màu sắc
    moveTextEl.innerText = state.currentNode.notation || "Bắt đầu";
    moveTextEl.style.color = isRedMoved ? "#d32f2f" : "#333333";

    // Cập nhật nhãn "Điểm số bên Đỏ / Đen"
    scoreLabelEl.innerText = isRedMoved ? "Điểm số bên Đỏ" : "Điểm số bên Đen";

    // 3. Lấy dữ liệu phân tích của Node
    const score = state.currentNode.normalizedScore;
    const cls = state.currentNode.classification;

    if (score === null || score === undefined) {
        scoreTextEl.innerText = "--";
        scoreTextEl.style.color = "#888";
        badgeBoxEl.style.background = "#f0f0f0";
        badgeIconEl.style.display = "none";
        badgeTextEl.innerText = "Chưa có";
        badgeTextEl.style.color = "#888";

        if (winrateTextEl) {
            winrateTextEl.innerText = "--";
            winrateTextEl.style.color = "#888";
        }
        return;
    }

    // 4. Cập nhật Điểm Số (Theo hệ quy chiếu người đang đánh)
    const displayScore = isRedMoved ? score : -score; 
    
    scoreTextEl.innerText = displayScore > 0 ? `+${displayScore}` : displayScore;
    scoreTextEl.style.color = isRedMoved ? "#d32f2f" : "#333333";

    if (winrateTextEl) {
        const winRateStr = calculateWinRatePercentage(displayScore);
        winrateTextEl.innerText = winRateStr;
        winrateTextEl.style.color = isRedMoved ? "#d32f2f" : "#333333";
    }

    // 5. Cập nhật Nhãn Dán (Badge)
    const classLangMap = {
        'best':       { text: "Tốt nhất",           color: "#5b9a32", bg: "#eef7ea" },
        'excellent':  { text: "Xuất sắc",           color: "#8e44ad", bg: "#f3e5f5" },
        'good':       { text: "Tốt",                color: "#1a73e8", bg: "#e8f0fe" },
        'balanced':   { text: "Cân bằng",           color: "#8d6e63", bg: "#efebe9" },
        'inaccuracy': { text: "Thiếu chính xác",    color: "#e6a817", bg: "#fff8e1" },
        'mistake':    { text: "Sai lầm",            color: "#e67c17", bg: "#fff3e0" },
        'blunder':    { text: "Sai lầm nặng",       color: "#ca3431", bg: "#fdecea" },
        'missed_win': { text: "Bỏ lỡ sát cục",      color: "#ca3431", bg: "#fdecea" }
    };

    let actualCls = cls;
    if (actualCls === 'missed_win') actualCls = 'blunder'; // Dùng chung icon blunder

    const clInfo = classLangMap[cls]; 
    
    if (clInfo && actualCls) {
        badgeBoxEl.style.background = clInfo.bg;
        badgeTextEl.innerText = clInfo.text;
        badgeTextEl.style.color = clInfo.color;
        badgeIconEl.src = `style/tags/${actualCls}.webp`;
        badgeIconEl.style.display = "block";
    } else {
        badgeBoxEl.style.background = "#f0f0f0";
        badgeTextEl.innerText = "Khởi đầu";
        badgeTextEl.style.color = "#888";
        badgeIconEl.style.display = "none";
    }

    const commentTextEl = document.getElementById('review-comment-text');
    if (commentTextEl) {
        if (!state.currentNode || !state.currentNode.parent || score === null) {
            commentTextEl.innerHTML = "<i>Hãy chọn một nước đi đã được AI phân tích để xem bình luận...</i>";
        } else {
            import('./game.js').then(({ customTranslator }) => {
                let translatedBestMove = null;
                // Nếu có nước đề xuất từ AI
                if (state.currentNode.parent.aiBestMove) {
                    translatedBestMove = customTranslator(state.currentNode.parent.aiBestMove, state.currentNode.parent.fen);
                }
            
                commentTextEl.innerHTML = generateExpertCommentary(state.currentNode, translatedBestMove);
            });
        }
    }
}

window.addEventListener('resize', () => {
    if (state.isChartRunning || document.getElementById('chart-wrapper').style.display === 'block') {
        resizeAndDrawChart();
    }
});
window.addEventListener('orientationchange', () => {
    setTimeout(resizeAndDrawChart, 200);
});