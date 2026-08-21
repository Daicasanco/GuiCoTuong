// js/ui/multipv.js
// Quản lý việc hiển thị danh sách MultiPV gợi ý từ Engine và tính năng Xem trước (Preview).

import { state } from '../state.js';
import { translateChineseToVietnamese } from '../core/move.js';

export function renderMultiPVList() {
    const container = document.getElementById("multipv-list-container");
    if (!container) return;
    
    if (!state.isAnalyzing) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Chưa bật chế độ phân tích</div>';
        return;
    }

    if (!state.pvLines || state.pvLines.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Chưa có dữ liệu phân tích</div>';
        return;
    }
    
    let html = '';
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const colorText = isRedTurn ? "Điểm Đỏ" : "Điểm Đen";
    
    state.pvLines.forEach(line => {
        if (!line) return;
        
        // Dịch nước đi tốt nhất sang tiếng Việt
        let notation = line.bestMove;
        if (typeof window !== 'undefined' && window.vschess) {
            const chineseResult = window.vschess.Node2Chinese(line.bestMove, state.currentNode.fen);
            if (chineseResult && chineseResult.move) {
                notation = translateChineseToVietnamese(chineseResult.move);
            }
        }
        
        let npsStr = line.nps ? line.nps.toLocaleString() : "0";
        let timeStr = line.time ? (line.time / 1000).toFixed(1) + "s" : "0.0s";
        let scoreStr = line.scoreText || "0";
        let blockColor = (line.relativeScore >= 0) ? "#1a73e8" : "#d32f2f";
        
        html += `
            <div class="multipv-item" data-rank="${line.rank}" style="color: ${blockColor}; cursor: pointer; padding: 8px; margin: 4px 0; border-radius: 6px; border: 1px solid rgba(0,0,0,0.05); transition: all 0.2s ease;">
                <div class="multipv-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 13px; color: #666;">Biến số ${line.rank}</span>
                    <span class="multipv-bestmove" style="font-weight: bold; font-size: 15px;">${notation}</span>
                </div>
                <div class="multipv-details" style="display: flex; justify-content: space-between; font-size: 12px; color: inherit; opacity: 0.85;">
                    <span>${colorText}: <strong>${scoreStr}</strong></span>
                    <span>Độ sâu: ${line.depth || 0}</span>
                </div>
                <div class="multipv-details" style="display: flex; justify-content: space-between; font-size: 12px; color: inherit; opacity: 0.85;">
                    <span>Thời gian: ${timeStr}</span>
                    <span>NPS: ${npsStr}</span>
                </div>
            </div>`;
    });
    
    container.innerHTML = html;
    
    // Đăng ký sự kiện rê chuột (hover) và click cho từng biến số
    const items = container.querySelectorAll('.multipv-item');
    items.forEach(item => {
        const rank = parseInt(item.getAttribute('data-rank'));
        const line = state.pvLines[rank - 1];
        if (!line) return;
        
        // Khi rê chuột vào: Kích hoạt chế độ xem trước (highlight đường đi)
        item.addEventListener('mouseenter', () => {
            state.hoveredPVLine = line;
            item.style.backgroundColor = 'rgba(26, 115, 232, 0.08)';
            item.style.transform = 'scale(1.02)';
        });
        
        // Khi rời chuột: Hủy xem trước
        item.addEventListener('mouseleave', () => {
            state.hoveredPVLine = null;
            item.style.backgroundColor = '';
            item.style.transform = '';
        });
        
        // Khi click: Thực hiện nước đi này luôn (nếu đang ở chế độ phân tích)
        item.addEventListener('click', () => {
            if (state.isAnalyzing && !state.isAnimating && !state.isAutoPlaying) {
                // Thực hiện nước đi qua game.js executeMove
                import('../game.js').then(({ executeMove }) => {
                    executeMove(line.bestMove);
                });
            }
        });
    });
}
