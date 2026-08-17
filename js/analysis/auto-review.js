// js/analysis/auto-review.js
import { state } from '../state.js';
import { getMainLine } from '../game.js';
import { showToast, showLoading, hideLoading } from '../ui.js';
import { renderEvalGraph } from './eval-graph.js';
import { renderMoveHistory } from '../board.js';

let isAnalyzingGame = false;

export async function runAutoGameReview() {
    if (isAnalyzingGame) {
        showToast("⚠️ Đang trong quá trình phân tích ván đấu!");
        return;
    }

    const mainLine = getMainLine();
    if (mainLine.length <= 1) {
        showToast("❌ Chưa có ván cờ để phân tích!");
        return;
    }

    isAnalyzingGame = true;
    window.isAnalyzingGameGlobal = true;
    const total = mainLine.length - 1;
    showLoading(`Đang khởi tạo động cơ Pikafish...`);

    const { sendEngineCommand, engineOutputListeners, initPikafish } = await import('../engine.js');
    const { customTranslator } = await import('../game.js');

    if (!state.engineModule) {
        try {
            await initPikafish();
        } catch(e) {}
    }

    // Đánh giá lần lượt từng Node FEN trong toàn bộ ván đấu
    for (let i = 0; i < mainLine.length; i++) {
        const node = mainLine[i];
        if (!node || !node.fen) continue;

        if (i === 0) showLoading(`Đang phân tích thế cờ gốc...`);
        else showLoading(`Đang phân tích nước ${i}/${total}...`);

        try {
            await new Promise(resolve => {
                let nodeEvalScore = undefined;
                let nodeBestMove = "";

                const onData = (line) => {
                    if (typeof line === 'string' && line.includes('info depth')) {
                        const scoreMatch = line.match(/score cp (-?\d+)/);
                        if (scoreMatch) {
                            const cp = parseInt(scoreMatch[1]);
                            const isRedTurn = (node.fen.split(' ')[1] === 'w');
                            nodeEvalScore = (isRedTurn ? cp : -cp) / 100.0;
                        }
                        const pvIdx = line.indexOf(" pv ");
                        if (pvIdx !== -1) {
                            const pvStr = line.substring(pvIdx + 4).trim();
                            nodeBestMove = pvStr.split(/\s+/)[0] || "";
                        }
                    }
                };

                if (Array.isArray(engineOutputListeners)) {
                    engineOutputListeners.push(onData);
                }

                sendEngineCommand(`position fen ${node.fen}`);
                sendEngineCommand(`go movetime 350`);

                setTimeout(() => {
                    if (nodeEvalScore !== undefined) {
                        node.evalScore = nodeEvalScore;
                    }
                    node.bestMoveAI = nodeBestMove;
                    if (Array.isArray(engineOutputListeners)) {
                        const idx = engineOutputListeners.indexOf(onData);
                        if (idx !== -1) engineOutputListeners.splice(idx, 1);
                    }
                    resolve();
                }, 400);
            });
        } catch (e) {}
    }

    // Tính toán độ tụt ưu thế (Drop) chuẩn xác từng nước đi
    for (let i = 1; i < mainLine.length; i++) {
        const prevNode = mainLine[i - 1];
        const currNode = mainLine[i];
        if (prevNode && currNode && prevNode.evalScore !== undefined && currNode.evalScore !== undefined) {
            const wasRedMove = (currNode.fen.split(' ')[1] === 'b');
            const drop = wasRedMove ? (prevNode.evalScore - currNode.evalScore) : (currNode.evalScore - prevNode.evalScore);

            let bestNotation = prevNode.bestMoveAI || currNode.bestMoveAI;
            if (bestNotation && prevNode.fen) {
                try {
                    const translated = customTranslator(bestNotation, prevNode.fen);
                    if (translated) bestNotation = translated;
                } catch(e) {}
            }

            if (drop > 1.2) {
                currNode.moveFlag = 'weak'; // 🔴 Phế Cờ / Blunder
                const oldComment = (currNode.comment || "").replace(/^🔴 Nước phế cờ.*\n?/, "").replace(/^🟠 Nước sơ hở.*\n?/, "");
                currNode.comment = `🔴 Nước phế cờ (Tụt điểm ${drop.toFixed(2)}). Gợi ý nước tốt: ${bestNotation || ''}${oldComment ? '\n' + oldComment : ''}`;
            } else if (drop > 0.5) {
                currNode.moveFlag = 'inaccuracy'; // 🟠 Sơ Hở / Mistake
                const oldComment = (currNode.comment || "").replace(/^🔴 Nước phế cờ.*\n?/, "").replace(/^🟠 Nước sơ hở.*\n?/, "");
                currNode.comment = `🟠 Nước sơ hở (Tụt điểm ${drop.toFixed(2)}). Gợi ý nước tốt: ${bestNotation || ''}${oldComment ? '\n' + oldComment : ''}`;
            } else if (drop <= 0.2) {
                currNode.moveFlag = 'strong'; // 🟢 Nước Hay / Best move
            } else {
                delete currNode.moveFlag;
            }
        }
    }

    window.isAnalyzingGameGlobal = false;
    isAnalyzingGame = false;
    hideLoading();
    showToast("✅ Đã hoàn tất phân tích tự động toàn bộ ván cờ!");
    renderMoveHistory();
    renderEvalGraph();
}
