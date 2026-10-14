// js/analyzer.js


const SEGMENTS = [
    { low: -5000, high: -2000, deductionPerPoint: 100 / 3000 },
    { low: -2000, high: -1100, deductionPerPoint: 100 / 900 },
    { low: -1100, high: -750,  deductionPerPoint: 0.1 },
    { low: -750,  high: -450,  deductionPerPoint: 65 / 300 },
    { low: -450,  high: -150,  deductionPerPoint: 100 / 300 },
    { low: -150,  high: 0,     deductionPerPoint: 100 / 150 },
    { low: 0,     high: 150,   deductionPerPoint: 100 / 150 },
    { low: 150,   high: 450,   deductionPerPoint: 100 / 300 },
    { low: 450,   high: 750,   deductionPerPoint: 65 / 300 },
    { low: 750,   high: 1100,  deductionPerPoint: 0.1 },
    { low: 1100,  high: 2000,  deductionPerPoint: 100 / 900 },
    { low: 2000,  high: 5000,  deductionPerPoint: 100 / 3000 }
];


export function normalizeScore(scoreObj) {
    if (!scoreObj) return 0;
    if (scoreObj.mate !== undefined && scoreObj.mate !== null) {
        // Mate > 0 (Đỏ thắng), Mate < 0 (Đen thắng)
        return scoreObj.mate > 0 ? (30000 - scoreObj.mate) : (-30000 - scoreObj.mate);
    }
    return scoreObj.cp || 0;
}

/**
 * Tính số bước sát cục dựa trên điểm tuyệt đối.
 * @returns {number} Số bước sát cục, hoặc -1 nếu không có sát cục.
 */
function getMateStep(score) {
    // Ngưỡng 29000 (0x7148) là ngưỡng sát cục của TKVG
    if (score >= 29000) return Math.ceil((30000 - score) / 2);
    if (score <= -29000) return Math.ceil((30000 - Math.abs(score)) / 2);
    return -1;
}

/**
 * TÍNH TOÁN ĐIỂM SỐ NƯỚC ĐI (0 - 100)
 * Lấy điểm tốt nhất (AI khuyên đi) so với điểm thực tế người chơi đi.
 * @param {number} bestScore - Điểm chuẩn hóa của nước tốt nhất
 * @param {number} playedScore - Điểm chuẩn hóa của nước thực tế
 * @param {string} turnColor - 'w' (Đỏ) hoặc 'b' (Đen)
 */
export function evaluateMoveScore(bestScore, playedScore, turnColor) {
    // Nếu nước đi thực tế bằng hoặc thậm chí tốt hơn AI (do độ sâu search khác nhau) -> 100 điểm
    if (turnColor === 'w' && playedScore >= bestScore) return 100;
    if (turnColor === 'b' && playedScore <= bestScore) return 100;

    // 1. Kẹp điểm CP trong giới hạn ±5000 để tính bậc thang
    let clampBest = Math.max(-5000, Math.min(bestScore, 5000));
    let clampPlayed = Math.max(-5000, Math.min(playedScore, 5000));

    let minVal = Math.min(clampBest, clampPlayed);
    let maxVal = Math.max(clampBest, clampPlayed);

    let deduction = 0;
    
    // 2. Tính điểm trừ (Deduction) theo mảng bậc thang
    if (minVal < maxVal) {
        for (let i = 0; i < SEGMENTS.length; i++) {
            let seg = SEGMENTS[i];
            let overlapLow = Math.max(minVal, seg.low);
            let overlapHigh = Math.min(maxVal, seg.high);
            if (overlapHigh > overlapLow) {
                deduction += (overlapHigh - overlapLow) * seg.deductionPerPoint;
            }
        }
    }

    // 3. Tính điểm trừ Sát cục (Mate Penalty)
    let mateDeduction = 0;
    if (Math.abs(bestScore) >= 29000 || Math.abs(playedScore) >= 29000) {
        let stepBest = Math.max(0, getMateStep(bestScore));
        let stepPlayed = Math.max(0, getMateStep(playedScore));

        // Trừ điểm dựa trên độ chênh lệch số bước sát cục (Tối đa trừ 50 điểm)
        let diff = Math.abs(stepPlayed - stepBest);
        mateDeduction = Math.min(diff, 50);
    }

    let totalDeduction = deduction + mateDeduction;
    
    // 4. Tính điểm cuối cùng trên thang 100
    return Math.max(0, 100 - totalDeduction);
}

/**
 * PHÂN LOẠI NƯỚC ĐI
 * @param {number} moveScore - Điểm số nước đi (0 - 100)
 * @param {boolean} isMissedWin - Cờ báo hiệu bỏ lỡ sát cục
 */
export function classifyMove(moveScore, isMissedWin) {
    if (isMissedWin && moveScore >= 55) return "missed_win"; 

    moveScore = Math.round(moveScore);
    if (moveScore >= 98) return "best";        // Điểm tuyệt đối
    if (moveScore >= 90) return "excellent";   // Rất tốt
    if (moveScore >= 80) return "good";        // Tốt
    if (moveScore >= 70) return "balanced";    // Cân bằng (Bình thường, không tốt không xấu)
    if (moveScore >= 59) return "inaccuracy";  // Không chính xác
    if (moveScore >= 40) return "mistake";     // Sai lầm
    return "blunder";                          // Bại thủ
}

export function generateExpertCommentary(node, translatedBestMove) {
    if (!node || !node.parent || node.normalizedScore === null) {
        return "<i>Hệ thống đang chờ AI phân tích...</i>";
    }

    // 1. CHUẨN BỊ DỮ LIỆU
    const isRedMoved = node.parent.fen.split(" ")[1] === "w";
    const playerColorHTML = isRedMoved ? `<span style="color: #d32f2f; font-weight: bold;">Đỏ</span>` : `<span style="color: #000; font-weight: bold;">Đen</span>`;
    const notationHTML = `<span style="color: #333; font-weight: 900;">${node.notation}</span>`;

    // Quy đổi điểm số về góc nhìn của người VỪA ĐI (Dương = Có lợi cho người đó)
    const currScore = isRedMoved ? node.normalizedScore : -node.normalizedScore;
    const bestScore = isRedMoved ? node.parent.normalizedScore : -node.parent.normalizedScore;

    // Hàm format điểm số hiển thị
    const fmtScore = (s) => {
        if (s >= 29000) return `<span style="color: #008a3e; font-weight: bold;">[Sát cục]</span>`;
        if (s <= -29000) return `<span style="color: #d32f2f; font-weight: bold;">[Bị sát cục]</span>`;
        if (s === 0) return `<span style="color: #666; font-weight: bold;">[0]</span>`;
        return s > 0 ? `<span style="color: #008a3e; font-weight: bold;">[+${s}]</span>` : `<span style="color: #d32f2f; font-weight: bold;">[${s}]</span>`;
    };

    // PHẦN 1: ĐÁNH GIÁ NƯỚC ĐI HIỆN TẠI
    let levelText = "";
    let subjectText = playerColorHTML;

    if (node.classification === 'missed_win') {
        levelText = "bỏ lỡ sát cục";
    } else if (currScore >= 29000) {
        levelText = "sắp thắng";
    } else if (currScore >= 400) {
        levelText = "ưu thế lớn";
    } else if (currScore >= 150) {
        levelText = "ưu thế";
    } else if (currScore >= 80) {
        levelText = "ưu thế nhẹ";
    } else if (currScore >= -80) {
        subjectText = `<span style="color: #1a73e8; font-weight: bold;">Thế trận</span>`;
        levelText = "cân bằng";
    } else if (currScore >= -150) {
        levelText = "thất thế nhẹ";
    } else if (currScore >= -400) {
        levelText = "thất thế";
    } else if (currScore > -29000) {
        levelText = "thất thế nặng";
    } else {
        levelText = "sắp thua";
    }

    let sentence1 = `Nước đi hiện tại ${notationHTML}; ${subjectText} đang ${levelText} ${fmtScore(currScore)}.`;

    // PHẦN 2: ĐÁNH GIÁ NƯỚC ĐI ĐỀ XUẤT
    const goodClasses = ['best', 'excellent', 'good'];
    let sentence2 = "";

    // Chỉ sinh câu đề xuất nếu nước đi hiện tại không nằm trong nhóm Tốt và AI có đề xuất nước khác
    if (!goodClasses.includes(node.classification) && translatedBestMove) {
        const bestMoveHTML = `<span style="color: #333; font-weight: 900;">${translatedBestMove}</span>`;
        let statusA = "";
        let actionB = "";
        let prep = "thành"; // chữ nối (thành/về)

        // Phân loại nhóm điểm (1: Lợi thế, 0: Cân bằng, -1: Bất lợi)
        const getGroup = (s) => s > 80 ? 1 : (s >= -80 ? 0 : -1);
        const currGroup = getGroup(currScore);
        const bestGroup = getGroup(bestScore);

        if (currGroup === 1 && bestGroup === 1) {
            statusA = "lợi thế"; actionB = "gia tăng"; prep = "thành";
        } else if (currGroup === 0 && bestGroup === 1) {
            statusA = "cân bằng"; actionB = "chuyển thành ưu thế"; prep = "thành";
        } else if (currGroup === 0 && bestGroup === 0) {
            statusA = "cân bằng"; actionB = "củng cố vững chắc hơn"; prep = "thành";
        } else if (currGroup === -1 && bestGroup === 1) {
            statusA = "bất lợi"; actionB = "chuyển thành ưu thế"; prep = "thành";
        } else if (currGroup === -1 && bestGroup === 0) {
            statusA = "bất lợi"; actionB = "trở về cân bằng"; prep = "về";
        } else if (currGroup === -1 && bestGroup === -1) {
            statusA = "bất lợi"; actionB = "giảm"; prep = "về";
        }

        sentence2 = `<br><br>Nước đi đề xuất ${bestMoveHTML}; ${statusA} của ${playerColorHTML} sẽ được <b>${actionB}</b> từ ${fmtScore(currScore)} ${prep} ${fmtScore(bestScore)}.`;
    }

    return sentence1 + sentence2;
}

// TÍNH TỈ LỆ CHIẾN THẮNG (WIN RATE PROBABILITY)
export function calculateWinRatePercentage(displayScore) {
    // Nếu không phải số hợp lệ
    if (typeof displayScore !== "number" || isNaN(displayScore)) {
        return "--";
    }
    
    // Máy báo chiếu bí đối thủ (Mate > 0)
    if (displayScore >= 29000) return "100.0%";
    
    // Máy báo mình bị chiếu bí (Mate < 0)
    if (displayScore <= -29000) return "0.0%";

    // Công thức Sigmoid chuyển đổi từ CP sang Tỉ lệ thắng %
    const winRate = 100 / (1 + Math.pow(10, -displayScore / 400));
    
    // Làm tròn 1 chữ số thập phân
    return winRate.toFixed(1) + "%";
}