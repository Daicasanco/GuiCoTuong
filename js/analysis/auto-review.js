// js/analysis/auto-review.js
import { state } from '../state.js';
import { ensureNodeData } from '../game.js';
import { showToast, showLoading, hideLoading } from '../ui.js';
import { renderEvalGraph } from './eval-graph.js';
import { renderMoveHistory } from '../board.js';

let isAnalyzingGame = false;

/**
 * Duyệt toàn bộ cây cờ (DFS) từ rootNode để lấy tất cả các nhánh chính và biến phụ
 */
export function getAllTreeNodes(rootNode) {
    if (!rootNode) return [];
    const list = [];
    
    function traverse(node, branchName = "Nhánh chính") {
        if (!node) return;
        try {
            ensureNodeData(node);
        } catch(e) {}

        node._branchLabel = branchName;
        list.push(node);

        if (node.children && node.children.length > 0) {
            node.children.forEach((child, idx) => {
                let childBranch = branchName;
                if (idx > 0) {
                    try { ensureNodeData(child); } catch(e) {}
                    const moveText = child.notation || child.moveCommand || `Biến ${idx + 1}`;
                    childBranch = `Biến phụ (${moveText})`;
                }
                traverse(child, childBranch);
            });
        }
    }

    traverse(rootNode, "Nhánh chính");
    return list;
}

export async function runAutoGameReview() {
    if (isAnalyzingGame) {
        showToast("⚠️ Đang trong quá trình phân tích ván đấu!");
        return;
    }

    if (!state.rootNode) {
        showToast("❌ Chưa có ván cờ để phân tích!");
        return;
    }

    const allNodes = getAllTreeNodes(state.rootNode);
    if (allNodes.length <= 1) {
        showToast("❌ Chưa có nước đi nào để phân tích!");
        return;
    }

    isAnalyzingGame = true;
    window.isAnalyzingGameGlobal = true;
    const total = allNodes.length - 1;
    showLoading(`Đang khởi tạo động cơ Pikafish...`);

    const { sendEngineCommand, engineOutputListeners, initPikafish } = await import('../engine.js');
    const { customTranslator } = await import('../game.js');

    if (!state.engineModule) {
        try {
            await initPikafish();
        } catch(e) {}
    }

    // Đặt sức mạnh tối đa Cấp 10 (Skill Level 20) cho Pikafish giống như chế độ Thẩm cờ
    sendEngineCommand(`setoption name Skill Level value 20`);
    sendEngineCommand(`setoption name MultiPV value 1`);

    // Đánh giá lần lượt từng Node FEN trong TOÀN BỘ CÂY CỜ (bao gồm tất cả các nhánh biến)
    for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        if (!node || !node.fen) {
            try { ensureNodeData(node); } catch(e) {}
            if (!node.fen) continue;
        }

        const moveTitle = node.notation || node.moveCommand || "";
        const branchInfo = node._branchLabel ? ` [${node._branchLabel}]` : "";

        if (i === 0) showLoading(`Đang phân tích thế cờ gốc (Cấp 10)...`);
        else showLoading(`Đang phân tích nước ${i}/${total} (Cấp 10): ${moveTitle}${branchInfo}...`);

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
                // Phân tích sâu với độ sâu cấp 10 (depth 18-20 / movetime 600ms)
                sendEngineCommand(`go depth 20 movetime 600`);

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
                }, 650);
            });
        } catch (e) {}
    }

    // Tính toán độ tụt ưu thế (Drop) chuẩn xác từng nước đi cho TOÀN BỘ CÁC BIẾN
    for (let i = 0; i < allNodes.length; i++) {
        const currNode = allNodes[i];
        const prevNode = currNode.parent;

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
    showToast(`✅ Đã hoàn tất phân tích toàn bộ ${allNodes.length - 1} nước đi và tất cả các nhánh biến!`);
    renderMoveHistory();
    renderEvalGraph();
}
