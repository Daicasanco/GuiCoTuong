// js/analysis/ai-annotate.js
import { state, storage } from '../state.js';
import { customTranslator, ensureNodeData } from '../game.js';
import { showToast, showLoading, hideLoading, openModal } from '../ui.js';
import { renderMoveHistory, renderBoardFull } from '../board.js';
import { saveGameState } from '../io.js';
import { runAutoGameReview, getAllTreeNodes } from './auto-review.js';

let isAnnotating = false;

/**
 * Thu thập danh sách TẤT CẢ các nước đi trong cây cờ (bao gồm tất cả các biến/nhánh CBL)
 */
export function collectMovesDataForAI() {
    if (!state.rootNode) return { allNodes: [], movesData: [] };
    const allNodes = getAllTreeNodes(state.rootNode);
    if (allNodes.length <= 1) return { allNodes: [], movesData: [] };

    const movesData = [];
    let counter = 1;

    for (let i = 1; i < allNodes.length; i++) {
        const node = allNodes[i];
        const prevNode = node.parent;
        node._aiIndex = counter++;

        try {
            ensureNodeData(node);
        } catch(e) {}

        const isRedMove = (node.fen && node.fen.split(' ')[1] === 'b'); // Sau khi Đỏ đi thì tới lượt Đen ('b')

        let notation = node.notation || node.moveCommand || `Nước ${node._aiIndex}`;
        if (!node.notation && node.moveCommand && prevNode && prevNode.fen) {
            try {
                const trans = customTranslator(node.moveCommand, prevNode.fen);
                if (trans) notation = trans;
            } catch (e) {}
        }

        let bestNotation = prevNode?.bestMoveAI || node?.bestMoveAI || '';
        if (bestNotation && prevNode?.fen) {
            try {
                const trans = customTranslator(bestNotation, prevNode.fen);
                if (trans) bestNotation = trans;
            } catch (e) {}
        }

        // Tính drop (tụt điểm) nếu có evalScore
        let drop = null;
        if (prevNode && prevNode.evalScore !== undefined && node.evalScore !== undefined) {
            const calculatedDrop = isRedMove
                ? (prevNode.evalScore - node.evalScore)
                : (node.evalScore - prevNode.evalScore);
            if (calculatedDrop > 0) drop = calculatedDrop;
        }

        movesData.push({
            i: node._aiIndex,
            move: node.moveCommand,
            notation: notation,
            branch: node._branchLabel || 'Nhánh chính',
            side: isRedMove ? 'Đỏ' : 'Đen',
            round: node.roundNum || 1,
            evalScore: node.evalScore !== undefined ? node.evalScore : null,
            moveFlag: node.moveFlag || null,
            bestMove: bestNotation || null,
            drop: drop,
            fen: node.fen ? node.fen.split(' ').slice(0, 2).join(' ') : null,
            prevFen: prevNode?.fen ? prevNode.fen.split(' ').slice(0, 2).join(' ') : null
        });
    }

    return { allNodes, movesData };
}

/**
 * Chạy quy trình phân tích và tạo ghi chú bằng Gemini AI cho TOÀN BỘ CÂY CỜ (tất cả các biến)
 */
export async function runAIAnnotation() {
    if (isAnnotating) {
        showToast("⚠️ Đang trong quá trình sinh ghi chú AI, vui lòng chờ!");
        return;
    }

    // 1. Kiểm tra API Keys
    const geminiSettings = state.geminiSettings || storage.getGemini() || {};
    const rawKeys = geminiSettings.apiKeys || [];
    const keys = rawKeys.filter(k => k && typeof k === 'string' && k.trim().length > 0);

    if (keys.length === 0) {
        showToast("⚙️ Bạn chưa cài đặt API Key Gemini! Mở Cài Đặt để thêm key.");
        openModal('settings-modal');
        setTimeout(() => {
            const geminiGroup = document.getElementById('settings-group-gemini');
            if (geminiGroup) geminiGroup.scrollIntoView({ behavior: 'smooth' });
        }, 200);
        return;
    }

    // 2. Kiểm tra ván đấu
    if (!state.rootNode) {
        showToast("❌ Chưa có ván cờ hoặc nước đi nào để phân tích!");
        return;
    }

    const { allNodes, movesData } = collectMovesDataForAI();
    if (movesData.length === 0) {
        showToast("❌ Chưa có nước đi nào để phân tích!");
        return;
    }

    // 3. Kiểm tra xem ván cờ đã được Pikafish phân tích chưa
    const hasEvalData = allNodes.some(n => n.evalScore !== undefined);
    if (!hasEvalData) {
        const confirmAutoReview = confirm(`💡 Cây cờ (${movesData.length} nước và các biến) chưa được Pikafish phân tích điểm số Cấp 10.\nBạn có muốn chạy 'Tự Phân Tích' trước để AI Gemini có dữ liệu chuẩn xác nhất không?`);
        if (confirmAutoReview) {
            await runAutoGameReview();
        }
    }

    // 4. Kiểm tra xem đã có ghi chú AI trước đó chưa
    const hasExistingAI = allNodes.some(n => n.comment && n.comment.includes('🤖'));
    if (hasExistingAI) {
        const confirmOverwrite = confirm("⚠️ Kỳ phổ này đã có ghi chú AI từ trước.\nBạn có muốn phân tích lại và ghi đè ghi chú AI cũ không?");
        if (!confirmOverwrite) {
            return;
        }
    }

    // 5. Chia Batch thông minh (80 nước / batch tối ưu tốc độ và an toàn dưới ngưỡng 8,192 Output Tokens của Gemini)
    isAnnotating = true;
    const BATCH_SIZE = 80;
    const batches = [];
    for (let i = 0; i < movesData.length; i += BATCH_SIZE) {
        batches.push(movesData.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;
    showLoading(`🤖 Chuẩn bị phân tích ${movesData.length} nước qua ${totalBatches} batch...`);

    // Tạo map để tra cứu nhanh node theo _aiIndex
    const nodeMap = new Map();
    for (let i = 1; i < allNodes.length; i++) {
        if (allNodes[i]._aiIndex) {
            nodeMap.set(allNodes[i]._aiIndex, allNodes[i]);
        }
    }

    let totalAnnotated = 0;
    let lastUsedKey = "";
    const selectedModel = geminiSettings.model || "gemini-2.5-flash";

    try {
        for (let b = 0; b < totalBatches; b++) {
            const batchMoves = batches[b];
            const batchNum = b + 1;
            const startMove = b * BATCH_SIZE + 1;
            const endMove = Math.min((b + 1) * BATCH_SIZE, movesData.length);

            showLoading(`🤖 Đang sinh ghi chú AI: Batch ${batchNum}/${totalBatches} (Nước ${startMove} - ${endMove}/${movesData.length})...`);

            let result = null;
            let lastErr = null;

            for (let retry = 0; retry < 3; retry++) {
                try {
                    if (retry > 0) {
                        showLoading(`⏳ Đang thử lại Batch ${batchNum}/${totalBatches} (Lần ${retry + 1}/3)...`);
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    const response = await fetch('/api/gemini-annotate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            keys: keys,
                            model: selectedModel,
                            movesData: batchMoves,
                            gameInfo: state.currentGameInfo || {}
                        })
                    });

                    result = await response.json();
                    if (response.ok && result.success) {
                        lastErr = null;
                        break;
                    } else {
                        lastErr = new Error(result.error || `Lỗi HTTP ${response.status} ở Batch ${batchNum}`);
                    }
                } catch(e) {
                    lastErr = e;
                }
            }

            if (lastErr || !result || !result.success) {
                throw lastErr || new Error(`Lỗi sinh ghi chú ở Batch ${batchNum}`);
            }

            lastUsedKey = result.usedKey || lastUsedKey;
            const annotations = result.annotations || [];

            // Gắn kết quả của batch vào game tree ngay lập tức
            annotations.forEach(item => {
                const moveIdx = parseInt(item.i);
                const targetNode = nodeMap.get(moveIdx);
                if (targetNode) {
                    const cleanNote = String(item.c || '').trim();
                    if (cleanNote) {
                        // Loại bỏ ghi chú AI cũ nếu có
                        const currentComment = (targetNode.comment || '')
                            .replace(/^🤖 [^\n]*(\n|$)/gm, '')
                            .trim();

                        const newAIComment = `🤖 ${cleanNote}`;
                        targetNode.comment = currentComment ? `${newAIComment}\n\n${currentComment}` : newAIComment;
                        totalAnnotated++;
                    }
                }
            });

            // Cập nhật giao diện và lưu trạng thái sau mỗi batch
            renderMoveHistory();
            saveGameState();

            if (state.currentNode) {
                const moveCommentInput = document.getElementById('move-comment-input');
                const commentBox = document.getElementById('comment-box');
                if (moveCommentInput) moveCommentInput.value = state.currentNode.comment || "";
                if (commentBox) commentBox.value = state.currentNode.comment || "";
                
                const noteBadge = document.getElementById('note-has-badge');
                if (noteBadge) {
                    noteBadge.style.display = (state.currentNode.comment && state.currentNode.comment.trim()) ? 'inline-block' : 'none';
                }
            }

            // Khoảng nghỉ nhỏ 500ms giữa các batch để tránh dồn dập
            if (b < totalBatches - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        hideLoading();
        showToast(`✅ Đã sinh ghi chú AI thành công cho ${totalAnnotated}/${movesData.length} nước đi (${totalBatches} batch)!`);

    } catch (error) {
        console.error("Lỗi AI Annotation:", error);
        hideLoading();
        showToast(`❌ Lỗi sinh ghi chú AI: ${error.message}${totalAnnotated > 0 ? ` (Đã lưu thành công ${totalAnnotated} nước trước đó)` : ''}`);
    } finally {
        isAnnotating = false;
    }
}
