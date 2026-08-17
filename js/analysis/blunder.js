// js/analysis/blunder.js
// Thuật toán quét và phân loại sai lầm ván đấu (Auto-Game Review / Centipawn Loss).

import { state } from '../state.js';
import { showToast, showLoading, hideLoading } from '../ui.js';
import { getZobristKey } from '../core/zobrist.js';

export const MOVE_QUALITY = {
    BRILLIANT: { name: 'Thiên tài', symbol: '!!', color: '#1b5e20', icon: '💎' },
    BEST: { name: 'Tốt nhất', symbol: '', color: '#2e7d32', icon: '⭐' },
    EXCELLENT: { name: 'Tuyệt vời', symbol: '', color: '#4caf50', icon: '✅' },
    GOOD: { name: 'Tốt', symbol: '', color: '#8bc34a', icon: '👍' },
    INACCURACY: { name: 'Sai số', symbol: '?!', color: '#f57f17', icon: '?!' },
    MISTAKE: { name: 'Sai lầm', symbol: '?', color: '#ef6c00', icon: '?' },
    BLUNDER: { name: 'Sơ hở lớn', symbol: '??', color: '#d32f2f', icon: '??' },
    BOOK: { name: 'Thư viện', symbol: '', color: '#00bcd4', icon: '📖' }
};

// Phân loại chất lượng nước đi dựa trên số điểm Centipawn bị mất (Centipawn Loss)
export function classifyMoveQuality(centipawnLoss) {
    const loss = Math.abs(centipawnLoss);
    if (loss <= 15) return MOVE_QUALITY.BEST;
    if (loss <= 30) return MOVE_QUALITY.EXCELLENT;
    if (loss <= 60) return MOVE_QUALITY.GOOD;
    if (loss <= 120) return MOVE_QUALITY.INACCURACY;
    if (loss <= 220) return MOVE_QUALITY.MISTAKE;
    return MOVE_QUALITY.BLUNDER;
}

// Chạy quy trình quét tự động toàn bộ ván đấu
export async function runAutoGameReview(engineManager, onProgress) {
    if (!state.rootNode) {
        showToast("⚠️ Không tìm thấy ván đấu nào để phân tích!");
        return;
    }

    // Lấy danh sách toàn bộ nước đi trong ván đấu chính
    const mainLineNodes = [];
    let curr = state.rootNode;
    while (curr) {
        if (curr.parent) {
            mainLineNodes.push(curr);
        }
        curr = curr.children[curr.mainLineIndex] || curr.children[0];
    }

    if (mainLineNodes.length === 0) {
        showToast("⚠️ Ván đấu trống!");
        return;
    }

    showLoading(`Đang khởi động phân tích tự động (${mainLineNodes.length} nước)...`);
    
    // Tạm dừng động cơ chính nếu đang chạy phân tích thủ công
    const wasAnalyzing = state.isAnalyzing;
    if (wasAnalyzing) {
        const { forceStopAIPlayers } = await import('../game.js');
        forceStopAIPlayers();
    }

    let completed = 0;
    
    // Duyệt từng nước đi để chấm điểm chất lượng
    for (let i = 0; i < mainLineNodes.length; i++) {
        const node = mainLineNodes[i];
        const parentFen = node.parent.fen;
        const playedMove = node.moveCommand;
        
        // 1. Kiểm tra xem nước đi này có nằm trong Sách Khai Cuộc không
        let isBook = false;
        if (i < 12) {
            const bookMoves = await import('../localbook.js').then(m => m.queryLocalBookWorker(parentFen));
            if (Array.isArray(bookMoves) && bookMoves.some(m => m.move === playedMove)) {
                isBook = true;
                node.moveQuality = MOVE_QUALITY.BOOK;
            }
        }

        if (!isBook) {
            let parentAnalysis = await analyzePositionBriefly(engineManager, parentFen, 800);
            let childAnalysis = await analyzePositionBriefly(engineManager, node.fen, 800);
            
            let bestScore = parentAnalysis.score;
            let bestMove = parentAnalysis.bestMove;
            let playedMoveScore = -childAnalysis.score;

            // Tính toán Centipawn Loss
            const centipawnLoss = bestScore - playedMoveScore;
            node.centipawnLoss = centipawnLoss;
            node.moveQuality = classifyMoveQuality(centipawnLoss);

            // Dịch nước đi tối ưu mà Engine khuyên dùng ra ký hiệu cờ Việt Nam
            if (bestMove) {
                const { customTranslator } = await import('../game.js');
                const bestNotation = customTranslator(bestMove, parentFen) || bestMove;
                node.recommendedMove = bestMove;
                node.recommendedNotation = bestNotation;

                // Nếu nước đi của người chơi bị đánh giá lỗi (Sai số ?!, Sai lầm ?, Sơ hở ??)
                if (node.moveQuality.symbol && playedMove !== bestMove) {
                    const sym = node.moveQuality.symbol;
                    const recText = `[💡 Nước chuẩn: ${bestNotation}]`;
                    if (!node.comment.includes("Nước chuẩn")) {
                        if (!node.comment.startsWith(sym)) {
                            node.comment = `${sym} ${recText} ${node.comment}`.trim();
                        } else {
                            node.comment = `${node.comment} ${recText}`.trim();
                        }
                    }

                    // Tự động thêm nước đi chuẩn vào cây biến hóa (GameTree branch)
                    if (node.parent && Array.isArray(node.parent.children)) {
                        const hasBranch = node.parent.children.some(c => c.moveCommand === bestMove);
                        if (!hasBranch) {
                            const { GameTreeNode } = await import('./game-tree.js');
                            const recNode = new GameTreeNode(bestMove, node.parent);
                            recNode.comment = `★ Nước đi chuẩn tối ưu của Engine (${bestNotation})`;
                            recNode.moveQuality = MOVE_QUALITY.BEST;
                            if (typeof window !== 'undefined' && window.vschess && window.vschess.fenMovePiece) {
                                recNode.fen = window.vschess.fenMovePiece(parentFen, bestMove);
                            }
                            recNode.notation = bestNotation;
                            node.parent.children.push(recNode);
                        }
                    }
                }
            }
        }

        completed++;
        if (onProgress) {
            onProgress(completed, mainLineNodes.length, node);
        }
    }

    hideLoading();
    showToast(`✅ Đã hoàn thành phân tích ván đấu!`);
    
    // Lưu lại trạng thái ván cờ mới vào database/IndexedDB
    const { saveGameState } = await import('../io.js');
    saveGameState();
    
    // Cập nhật giao diện danh sách nước đi bên tay phải
    const { renderMoveHistory } = await import('../board.js');
    renderMoveHistory();
}

// Chạy engine phân tích nhanh một hình cờ trong thời gian giới hạn (ms)
function analyzePositionBriefly(engineManager, fen, timeoutMs) {
    return new Promise((resolve) => {
        let score = 0;
        let bestMove = null;
        
        const outputHandler = (data) => {
            if (typeof data === 'string') {
                if (data.startsWith("info depth")) {
                    const scoreCpMatch = data.match(/score cp (-?\d+)/);
                    const scoreMateMatch = data.match(/score mate (-?\d+)/);
                    if (scoreCpMatch) {
                        score = parseInt(scoreCpMatch[1]);
                    } else if (scoreMateMatch) {
                        const mate = parseInt(scoreMateMatch[1]);
                        score = mate > 0 ? 10000 : -10000;
                    }
                    const pvMatch = data.match(/ pv ([a-i][0-9][a-i][0-9])/);
                    if (pvMatch) {
                        bestMove = pvMatch[1];
                    }
                }
                if (data.startsWith("bestmove")) {
                    const parts = data.split(/\s+/);
                    if (parts[1] && parts[1] !== '(none)' && parts[1] !== 'none') {
                        bestMove = parts[1];
                    }
                    cleanup();
                    resolve({ score, bestMove });
                }
            } else if (data && data.type === 'info') {
                if (data.scoreValue !== undefined) score = data.scoreValue;
                if (data.bestMove) bestMove = data.bestMove;
            } else if (data && data.type === 'bestmove') {
                if (data.bestMove) bestMove = data.bestMove;
                cleanup();
                resolve({ score, bestMove });
            }
        };

        const cleanup = () => {
            if (Array.isArray(engineManager.outputCallbacks)) {
                const idx = engineManager.outputCallbacks.indexOf(outputHandler);
                if (idx > -1) engineManager.outputCallbacks.splice(idx, 1);
            }
            clearTimeout(timerId);
        };

        engineManager.onOutput(outputHandler);
        engineManager.sendCommand(`position fen ${fen}`);
        engineManager.sendCommand(`go movetime ${timeoutMs}`);

        const timerId = setTimeout(() => {
            engineManager.stopSearch();
            cleanup();
            resolve({ score, bestMove });
        }, timeoutMs + 300);
    });
}


