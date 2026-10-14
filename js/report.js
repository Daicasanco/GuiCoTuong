// js/report.js
import { state } from './state.js';

// ==========================================
// 1. CÁC HÀM TIỆN ÍCH CƠ BẢN
// ==========================================
function parseICCS(moveCommand) {
    if (!moveCommand || moveCommand.length < 4) return null;
    return {
        fromX: moveCommand.charCodeAt(0) - 97,
        fromY: moveCommand.charCodeAt(1) - 48,
        toX: moveCommand.charCodeAt(2) - 97,
        toY: moveCommand.charCodeAt(3) - 48
    };
}

function getPieceFromFen(fen, x, y) {
    const boardStr = fen.split(" ")[0];
    const rows = boardStr.split("/");
    const fenRow = rows[9 - y]; // Tọa độ Y: 0 ở đáy (Đỏ), 9 ở đỉnh (Đen)
    if (!fenRow) return null;

    let currX = 0;
    for (let i = 0; i < fenRow.length; i++) {
        const char = fenRow[i];
        if (!isNaN(char)) currX += parseInt(char);
        else {
            if (currX === x) return char;
            currX++;
        }
    }
    return null;
}

function isRedPiece(pieceChar) { return pieceChar === pieceChar.toUpperCase(); }
function isMajorPiece(pieceChar) {
    const p = pieceChar.toLowerCase();
    return p === 'r' || p === 'c' || p === 'n' || p === 'p';
}
function isGuardPiece(pieceChar) {
    const p = pieceChar.toLowerCase();
    return p === 'a' || p === 'b';
}
function isBackward(fromY, toY, isRed) { return isRed ? toY < fromY : toY > fromY; }
function isInEnemyHalf(y, isRed) { return isRed ? y >= 5 : y <= 4; }
function isInPalace(x, y, isRed) {
    if (x < 3 || x > 5) return false;
    return isRed ? (y >= 0 && y <= 2) : (y >= 7 && y <= 9);
}
function getAverageScore(scoreArray) {
    if (scoreArray.length === 0) return null;
    let sum = scoreArray.reduce((a, b) => a + b, 0);
    return Math.floor(sum / scoreArray.length);
}

// ==========================================
// 2. THUẬT TOÁN ĐẾM QUÂN VÀ TÌM RANH GIỚI GIAI ĐOẠN
// ==========================================
function getMajorPieceStats(fen) {
    const boardStr = fen.split(" ")[0];
    let redValue = 0, blackValue = 0;
    let redRooks = 0, blackRooks = 0;

    for (let i = 0; i < boardStr.length; i++) {
        const c = boardStr[i];
        if (isNaN(c) && c !== '/') {
            if (c === 'R') { redValue += 2; redRooks++; }
            else if (c === 'r') { blackValue += 2; blackRooks++; }
            else if (c === 'N' || c === 'C') { redValue += 1; }
            else if (c === 'n' || c === 'c') { blackValue += 1; }
        }
    }
    return { redValue, blackValue, redRooks, blackRooks, totalValue: redValue + blackValue };
}

function findPhaseBoundaries(path) {
    let openStep = Math.min(30, path.length - 1); 
    let endStep = path.length - 1; 

    // Tìm ranh giới kết thúc Khai cuộc
    for (let i = 0; i < path.length; i++) {
        if (i > 30) break;
        if (getMajorPieceStats(path[i].parent.fen).totalValue < 14) {
            openStep = i; break;
        }
    }

    // Tìm ranh giới bắt đầu Tàn cuộc
    for (let i = 0; i < path.length; i++) {
        const stats = getMajorPieceStats(path[i].parent.fen);
        const noRooks = (stats.redRooks === 0 && stats.blackRooks === 0);
        const lowMajors = (stats.redValue <= 3 && stats.blackValue <= 3);
        if (noRooks || lowMajors) {
            endStep = i; break;
        }
    }

    if (openStep >= endStep) openStep = Math.max(0, endStep - 1);
    return { openStep, endStep };
}

// ==========================================
// 3. TỔNG HỢP VÀ PHÂN LỚP NƯỚC ĐI TKVG
// ==========================================
export function generateReportData() {
    const report = {
        red: {
            openingScores: [], midgameScores: [], endgameScores: [],
            attackScores: [], defenseScores: [],
            stats: { best: 0, excellent: 0, good: 0, balanced: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed_win: 0 },
            mistakeNodes: []
        },
        black: {
            openingScores: [], midgameScores: [], endgameScores: [],
            attackScores: [], defenseScores: [],
            stats: { best: 0, excellent: 0, good: 0, balanced: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed_win: 0 },
            mistakeNodes: []
        },
        final: {} 
    };

    let path = [];
    let curr = state.rootNode;
    while (curr.children.length > 0) {
        curr = curr.children[curr.mainLineIndex];
        path.push(curr);
    }

    if (path.length === 0) return null;

    const { openStep, endStep } = findPhaseBoundaries(path);

    // Duyệt qua từng nước cờ
    path.forEach((node, index) => {
        if (node.moveScore === null || node.moveScore === undefined) return;

        const score = node.moveScore;
        const cls = node.classification;
        const prevFen = node.parent.fen; // Hình cờ TRƯỚC khi đi
        const currFen = node.fen;        // Hình cờ SAU khi đi
        
        const coords = parseICCS(node.moveCommand);
        if (!coords) return;

        const pieceChar = getPieceFromFen(prevFen, coords.fromX, coords.fromY);
        if (!pieceChar) return;

        const isRed = isRedPiece(pieceChar);
        const playerObj = isRed ? report.red : report.black;

        // 1. Thống kê số lượng (Nhãn dán)
        if (cls && playerObj.stats[cls] !== undefined) {
            playerObj.stats[cls]++;
            if (['inaccuracy', 'mistake', 'blunder', 'missed_win'].includes(cls)) {
                playerObj.mistakeNodes.push({ node: node, index: index, cls: cls });
            }
        }

        // 2. Chấm điểm Giai đoạn
        if (index <= openStep) playerObj.openingScores.push(score);
        else if (index <= endStep) playerObj.midgameScores.push(score);
        else playerObj.endgameScores.push(score);

        // 3. THUẬT TOÁN TẤN CÔNG / PHÒNG THỦ CHÍNH XÁC CỦA TKVG
        const isCaptureMove = getPieceFromFen(prevFen, coords.toX, coords.toY) !== null;
        const isMoveBackward = isBackward(coords.fromY, coords.toY, isRed);
        
        // Sử dụng vschess để kiểm tra chiếu tướng
        let givesCheck = false;
        let inCheckBefore = false;
        if (window.vschess && window.vschess.checkThreat) {
            givesCheck = window.vschess.checkThreat(currFen); // Nước đi này có chiếu đối thủ không?
            inCheckBefore = window.vschess.checkThreat(prevFen); // Trước khi đi mình có đang bị chiếu không?
        }

        // --- ĐÁNH GIÁ TẤN CÔNG ---
        let isAttack = false;
        if (givesCheck) {
            // Điều kiện 1: Nước đi tạo ra chiếu tướng -> Tấn công
            isAttack = true;
        } else if (isCaptureMove && !isMoveBackward) {
            // Điều kiện 2: Ăn quân đối phương VÀ Không phải đi lùi -> Tấn công
            isAttack = true;
        } else if (isMajorPiece(pieceChar) && !isMoveBackward && isInEnemyHalf(coords.toY, isRed)) {
            // Điều kiện 3: Quân chủ lực đi lên hoặc đi ngang ở sân đối phương -> Tấn công
            isAttack = true;
        }

        if (isAttack) playerObj.attackScores.push(score);

        // --- ĐÁNH GIÁ PHÒNG THỦ ---
        let isDefense = false;
        if (inCheckBefore) {
            // Điều kiện 1: Nước đi giải sát (Trước khi đi đang bị chiếu) -> Chắc chắn là phòng thủ
            isDefense = true;
        } else if (isGuardPiece(pieceChar)) {
            // Điều kiện 2: Nước đi là Sĩ hoặc Tượng -> Luôn là phòng thủ
            isDefense = true;
        } else if (isCaptureMove && isMoveBackward) {
            // Điều kiện 3: Lùi quân về để ăn quân đối phương -> Phòng thủ (Bắt phản kích)
            isDefense = true;
        } else if (isMajorPiece(pieceChar) && isMoveBackward && isInPalace(coords.toX, coords.toY, isRed)) {
            // Điều kiện 4: Lùi quân chủ lực về Cửu Cung để che chắn -> Phòng thủ
            isDefense = true;
        }

        if (isDefense) playerObj.defenseScores.push(score);
    });

    // Tính toán đầu ra cuối cùng
    report.final = {
        openStep: openStep, 
        endStep: endStep,
        red: {
            stats: report.red.stats,
            mistakes: report.red.mistakeNodes,
            opening: getAverageScore(report.red.openingScores),
            midgame: getAverageScore(report.red.midgameScores),
            endgame: getAverageScore(report.red.endgameScores),
            attack: getAverageScore(report.red.attackScores),
            defense: getAverageScore(report.red.defenseScores)
        },
        black: {
            stats: report.black.stats,
            mistakes: report.black.mistakeNodes,
            opening: getAverageScore(report.black.openingScores),
            midgame: getAverageScore(report.black.midgameScores),
            endgame: getAverageScore(report.black.endgameScores),
            attack: getAverageScore(report.black.attackScores),
            defense: getAverageScore(report.black.defenseScores)
        }
    };

    return report.final;
}

// ==========================================
// 4. RENDER GIAO DIỆN (UI)
// ==========================================
export function renderReportUI() {
    const container = document.getElementById('report-container');
    if (!container) return;

    if (!state.chartReport) return;

    const data = state.chartReport;
    const pieceStyle = state.appSettings.pieceStyle || "style/1-mac_dinh";

    // HÀM FORMAT MỚI: Nếu là 0 hoặc null thì xám. Ngược lại thì Đỏ/Đen
    const fmtPhase = (val, isRed) => {
        if (val === null || val === undefined) return '<span class="report-empty">--</span>';
        if (val === 0) return '<span class="report-empty">0</span>';
        const colorClass = isRed ? 'red-score' : 'black-score';
        return `<span class="${colorClass}">${val}</span>`;
    };

    const calcOverall = (p) => {
        let sum = 0, count = 0;
        if (p.opening !== null) { sum += p.opening; count++; }
        if (p.midgame !== null) { sum += p.midgame; count++; }
        if (p.endgame !== null) { sum += p.endgame; count++; }
        return count === 0 ? 0 : Math.floor(sum / count);
    };

    const redScore = calcOverall(data.red);
    const blackScore = calcOverall(data.black);

    let html = `
        <div class="report-header">
            <div class="report-header-side">
                <span class="report-overall-score red-score">${redScore === 0 ? '<span class="report-empty">0</span>' : redScore}</span>
                <img src="${pieceStyle}/wk.webp" class="report-icon">
            </div>
            <div class="report-header-vs">VS</div>
            <div class="report-header-side">
                <img src="${pieceStyle}/bk.webp" class="report-icon">
                <span class="report-overall-score black-score">${blackScore === 0 ? '<span class="report-empty">0</span>' : blackScore}</span>
            </div>
        </div>

        <div class="report-section-title">Điểm Giai Đoạn & Chiến Thuật</div>

        <div class="report-row">
            <div class="report-val">${fmtPhase(data.red.opening, true)}</div>
            <div class="report-label">Khai cục</div>
            <div class="report-val">${fmtPhase(data.black.opening, false)}</div>
        </div>
        <div class="report-row">
            <div class="report-val">${fmtPhase(data.red.midgame, true)}</div>
            <div class="report-label">Trung cục</div>
            <div class="report-val">${fmtPhase(data.black.midgame, false)}</div>
        </div>
        <div class="report-row">
            <div class="report-val">${fmtPhase(data.red.endgame, true)}</div>
            <div class="report-label">Tàn cục</div>
            <div class="report-val">${fmtPhase(data.black.endgame, false)}</div>
        </div>
        <div class="report-row">
            <div class="report-val">${fmtPhase(data.red.attack, true)}</div>
            <div class="report-label">Tấn công</div>
            <div class="report-val">${fmtPhase(data.black.attack, false)}</div>
        </div>
        <div class="report-row">
            <div class="report-val">${fmtPhase(data.red.defense, true)}</div>
            <div class="report-label">Phòng thủ</div>
            <div class="report-val">${fmtPhase(data.black.defense, false)}</div>
        </div>

        <div class="report-section-title">Thống Kê Nước Đi</div>
    `;

    const statRows = [
        { key: 'best', name: 'Tốt nhất' },
        { key: 'excellent', name: 'Xuất sắc' },
        { key: 'good', name: 'Tốt' },
        { key: 'balanced', name: 'Cân bằng' },
        { key: 'inaccuracy', name: 'Thiếu chính xác' },
        { key: 'mistake', name: 'Sai lầm' },
        { key: 'blunder', name: 'Sai lầm nặng' },
        { key: 'missed_win', name: 'Bỏ lỡ sát cục' },
    ];

    // HÀM FORMAT CHO THỐNG KÊ LỖI
    const fmtStat = (val, isRed, isError) => {
        if (val === 0) return '<span class="report-empty">0</span>';
        let inlineColor = isRed ? 'color: #d32f2f;' : 'color: #333;';
        return `<span style="font-weight: bold; ${inlineColor}">${val}</span>`;
    };

    statRows.forEach(item => {
        const rVal = data.red.stats[item.key] || 0;
        const bVal = data.black.stats[item.key] || 0;

        const isError = ['inaccuracy', 'mistake', 'blunder', 'missed_win'].includes(item.key);

        let iconKey = item.key;
        if (iconKey === 'missed_win') iconKey = 'blunder';

        html += `
            <div class="report-row">
                <div class="report-val">${fmtStat(rVal, true, isError)}</div>
                <div class="report-label">
                    <img src="style/tags/${iconKey}.webp" class="report-tag-icon">
                    <span>${item.name}</span>
                </div>
                <div class="report-val">${fmtStat(bVal, false, isError)}</div>
            </div>
        `;
    });

    container.innerHTML = html;

    const placeholder = container.parentElement.querySelector('.chart-placeholder');
    if (placeholder) placeholder.style.display = 'none';
}

export function renderMistakesUI() {
    const colRed = document.getElementById('mistake-col-red');
    const colBlack = document.getElementById('mistake-col-black');
    if (!colRed || !colBlack || !state.chartReport) return;

    colRed.innerHTML = '<div style="text-align: center; color: #d32f2f; font-weight: 900; margin-bottom: 5px; font-size: 14px;">ĐỎ</div>';
    colBlack.innerHTML = '<div style="text-align: center; color: #333; font-weight: 900; margin-bottom: 5px; font-size: 14px;">ĐEN</div>';

    const redMs = state.chartReport.red.mistakes;
    const blackMs = state.chartReport.black.mistakes;

    const startRound = parseInt(state.rootNode.fen.split(" ")[5]) || 1;
    const isRootBlack = state.rootNode.fen.split(" ")[1] === "b";
    const offset = isRootBlack ? 1 : 0;

    const createBtn = (item, isRed) => {
        let iconKey = item.cls;
        if (iconKey === 'missed_win') iconKey = 'blunder'; // Lọt sát dùng chung hình blunder
        
        // Tính hiệp đấu (round) để hiển thị (1. 2. 3.)
        const displayRound = Math.floor((item.index + offset) / 2) + startRound;
        const colorClass = isRed ? 'mistake-txt-red' : 'mistake-txt-black';

        const btn = document.createElement('button');
        btn.className = 'mistake-btn';
        btn.innerHTML = `
            <div class="mistake-info">
                <span class="mistake-num">${displayRound}.</span>
                <span class="${colorClass}">${item.node.notation || '...'}</span>
            </div>
            <img src="style/tags/${iconKey}.webp" class="mistake-icon">
        `;

        btn.onclick = () => {
            // Xóa hiệu ứng sáng của toàn bộ nút khác
            document.querySelectorAll('.mistake-btn').forEach(b => {
                b.classList.remove('mistake-active-red', 'mistake-active-black');
            });
            // Thêm hiệu ứng sáng cho nút vừa click
            btn.classList.add(isRed ? 'mistake-active-red' : 'mistake-active-black');
            
            // Lệnh nhảy bàn cờ (Import động từ game.js)
            import('./game.js').then(game => {
                game.forceStopAIPlayers();
                game.instantJumpToNode(item.node);
            });
        };
        return btn;
    };

    if (redMs.length === 0) colRed.innerHTML += '<div class="mistake-empty">Không có</div>';
    else redMs.forEach(item => colRed.appendChild(createBtn(item, true)));

    if (blackMs.length === 0) colBlack.innerHTML += '<div class="mistake-empty">Không có</div>';
    else blackMs.forEach(item => colBlack.appendChild(createBtn(item, false)));

    const placeholder = document.getElementById('tab-comment').querySelector('.chart-placeholder');
    if (placeholder) placeholder.style.display = 'none';
}