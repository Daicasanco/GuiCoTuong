// js/analysis/ai-annotate.js
import { state, storage } from '../state.js';
import { getMainLine, customTranslator } from '../game.js';
import { showToast, showLoading, hideLoading, openModal } from '../ui.js';
import { renderMoveHistory, renderBoardFull } from '../board.js';
import { saveGameState } from '../io.js';
import { runAutoGameReview } from './auto-review.js';

let isAnnotating = false;

/**
 * Thu thập danh sách nước đi kèm đánh giá engine và biến phụ
 */
export function collectMovesDataForAI() {
    const mainLine = getMainLine();
    if (mainLine.length <= 1) return [];

    const movesData = [];
    for (let i = 1; i < mainLine.length; i++) {
        const node = mainLine[i];
        const prevNode = mainLine[i - 1];
        const isRedMove = (node.fen.split(' ')[1] === 'b'); // Sau khi Đỏ đi thì tới lượt Đen ('b')

        let notation = node.notation || node.moveCommand || `Nước ${i}`;
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

        // Thu thập các biến phụ tại vị trí trước nước đi này
        const variations = [];
        if (prevNode && prevNode.children && prevNode.children.length > 1) {
            for (let v = 0; v < prevNode.children.length; v++) {
                const child = prevNode.children[v];
                if (child === node) continue; // Biến chính
                let vNotation = child.notation || child.moveCommand;
                if (!child.notation && child.moveCommand && prevNode.fen) {
                    try {
                        const trans = customTranslator(child.moveCommand, prevNode.fen);
                        if (trans) vNotation = trans;
                    } catch (e) {}
                }
                variations.push({
                    move: child.moveCommand,
                    notation: vNotation,
                    evalScore: child.evalScore !== undefined ? child.evalScore : null
                });
            }
        }

        movesData.push({
            index: i,
            move: node.moveCommand,
            notation: notation,
            side: isRedMove ? 'Đỏ' : 'Đen',
            evalScore: node.evalScore !== undefined ? node.evalScore : null,
            moveFlag: node.moveFlag || null,
            bestMove: bestNotation || null,
            drop: drop,
            variations: variations
        });
    }

    return movesData;
}

/**
 * Chạy quy trình phân tích và tạo ghi chú bằng Gemini AI
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
    const mainLine = getMainLine();
    if (mainLine.length <= 1) {
        showToast("❌ Chưa có ván cờ hoặc nước đi nào để phân tích!");
        return;
    }

    // 3. Kiểm tra xem ván cờ đã được Pikafish phân tích chưa
    const hasEvalData = mainLine.some(n => n.evalScore !== undefined);
    if (!hasEvalData) {
        const confirmAutoReview = confirm("💡 Ván cờ chưa được Pikafish phân tích điểm số.\nBạn có muốn chạy 'Tự Phân Tích' trước để AI Gemini có dữ liệu chuẩn xác nhất không?");
        if (confirmAutoReview) {
            await runAutoGameReview();
        }
    }

    // 4. Kiểm tra xem đã có ghi chú AI trước đó chưa (Q2: Hỏi xác nhận ghi đè)
    const hasExistingAI = mainLine.some(n => n.comment && n.comment.includes('🤖'));
    if (hasExistingAI) {
        const confirmOverwrite = confirm("⚠️ Ván cờ này đã có ghi chú AI từ trước.\nBạn có muốn phân tích lại và ghi đè ghi chú AI cũ không?");
        if (!confirmOverwrite) {
            return;
        }
    }

    // 5. Thu thập dữ liệu nước đi
    isAnnotating = true;
    showLoading("🤖 Đang chuẩn bị dữ liệu và gửi lên Gemini AI...");

    try {
        const movesData = collectMovesDataForAI();
        if (movesData.length === 0) {
            throw new Error("Không có nước đi hợp lệ để phân tích.");
        }

        const selectedModel = geminiSettings.model || "gemini-2.5-flash";
        showLoading(`🤖 Đang kết nối Gemini AI (${selectedModel}) phân tích ${movesData.length} nước...`);

        const response = await fetch('/api/gemini-annotate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                keys: keys,
                model: selectedModel,
                movesData: movesData,
                gameInfo: state.currentGameInfo || {}
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || `Lỗi HTTP ${response.status}`);
        }

        const annotations = result.annotations || [];
        showLoading(`🤖 Đang gắn ghi chú vào ${annotations.length} nước đi...`);

        // 6. Gắn kết quả vào game tree
        annotations.forEach(item => {
            const moveIdx = parseInt(item.i);
            if (!isNaN(moveIdx) && moveIdx >= 1 && moveIdx < mainLine.length) {
                const targetNode = mainLine[moveIdx];
                const cleanNote = String(item.c || '').trim();
                if (cleanNote) {
                    // Loại bỏ ghi chú AI cũ nếu có
                    const currentComment = (targetNode.comment || '')
                        .replace(/^🤖 [^\n]*(\n|$)/gm, '')
                        .trim();

                    const newAIComment = `🤖 ${cleanNote}`;
                    targetNode.comment = currentComment ? `${newAIComment}\n\n${currentComment}` : newAIComment;
                }
            }
        });

        // 7. Cập nhật giao diện
        renderMoveHistory();

        // Cập nhật ô ghi chú hiện tại nếu đang xem
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

        saveGameState();
        hideLoading();
        showToast(`✅ Đã sinh ghi chú AI thành công cho ${annotations.length} nước! (Model: ${result.model}, Key: ${result.usedKey})`);

    } catch (error) {
        console.error("Lỗi AI Annotation:", error);
        hideLoading();
        showToast(`❌ Lỗi sinh ghi chú AI: ${error.message}`);
    } finally {
        isAnnotating = false;
    }
}
