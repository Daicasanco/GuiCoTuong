// js/analysis/eval-graph.js
import { state } from '../state.js';
import { jumpToNode, getMainLine } from '../game.js';

let graphCanvas = null;
let graphCtx = null;

export function renderEvalGraph() {
    graphCanvas = document.getElementById('eval-graph-canvas');
    if (!graphCanvas) return;
    graphCtx = graphCanvas.getContext('2d');
    if (!graphCtx) return;

    const parent = graphCanvas.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = rect.width || 300;
    const displayHeight = rect.height || 95;

    graphCanvas.width = displayWidth * dpr;
    graphCanvas.height = displayHeight * dpr;

    graphCtx.save();
    graphCtx.scale(dpr, dpr);

    const w = displayWidth;
    const h = displayHeight;
    graphCtx.clearRect(0, 0, w, h);

    if (!state.rootNode) { graphCtx.restore(); return; }
    const mainLine = getMainLine();
    if (mainLine.length <= 1) {
        graphCtx.fillStyle = '#888888';
        graphCtx.font = '12px sans-serif';
        graphCtx.textAlign = 'center';
        graphCtx.fillText('Chưa có dữ liệu phân tích ván đấu (Bấm "Tự Phân Tích" hoặc "Bật Thẩm")', w / 2, h / 2 + 4);
        graphCtx.restore();
        return;
    }

    const paddingX = 32;
    const paddingTop = 18;
    const paddingBottom = 18;
    const drawW = w - (paddingX * 2);
    const drawH = h - (paddingTop + paddingBottom);
    const centerY = paddingTop + (drawH / 2);

    // Đường vạch trung tâm 0.00
    graphCtx.strokeStyle = '#d1d5db';
    graphCtx.lineWidth = 1;
    graphCtx.setLineDash([3, 3]);
    graphCtx.beginPath();
    graphCtx.moveTo(paddingX, centerY);
    graphCtx.lineTo(w - paddingX, centerY);
    graphCtx.stroke();
    graphCtx.setLineDash([]);

    // Trục nhãn điểm bên trái
    const isFlipped = state.isBoardFlipped;
    graphCtx.fillStyle = '#6b7280';
    graphCtx.font = '9px sans-serif';
    graphCtx.textAlign = 'right';
    graphCtx.fillText('+5.0', paddingX - 4, paddingTop + 6);
    graphCtx.fillText('0.0', paddingX - 4, centerY + 3);
    graphCtx.fillText('-5.0', paddingX - 4, h - paddingBottom + 2);

    const points = [];
    const numMoves = mainLine.length - 1;
    const stepX = drawW / Math.max(numMoves, 1);

    mainLine.forEach((node, idx) => {
        let absRedScore = 0;
        if (node.evalScore !== undefined) absRedScore = node.evalScore;
        else if (node.analysis && node.analysis.score !== undefined) absRedScore = node.analysis.score;

        // Quy đổi về điểm từ GÓC NHÌN NGƯỜI CHƠI (Dương = Ưu thế, Âm = Thất thế)
        const playerPerspectiveScore = isFlipped ? -absRedScore : absRedScore;

        const clampedScore = Math.max(-6, Math.min(6, playerPerspectiveScore));
        const px = paddingX + (idx * stepX);
        const py = centerY - ((clampedScore / 6) * (drawH / 2));
        points.push({ x: px, y: py, node: node, score: playerPerspectiveScore, absRedScore: absRedScore, index: idx });
    });

    // Gradient Ưu thế
    const topGrad = graphCtx.createLinearGradient(0, paddingTop, 0, centerY);
    topGrad.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
    topGrad.addColorStop(1, 'rgba(16, 185, 129, 0.02)');

    const botGrad = graphCtx.createLinearGradient(0, centerY, 0, h - paddingBottom);
    botGrad.addColorStop(0, 'rgba(239, 68, 68, 0.02)');
    botGrad.addColorStop(1, 'rgba(239, 68, 68, 0.3)');

    // Nền trên (Ưu thế)
    graphCtx.beginPath();
    graphCtx.moveTo(points[0].x, centerY);
    points.forEach(pt => graphCtx.lineTo(pt.x, Math.min(centerY, pt.y)));
    graphCtx.lineTo(points[points.length - 1].x, centerY);
    graphCtx.closePath();
    graphCtx.fillStyle = topGrad;
    graphCtx.fill();

    // Nền dưới (Thất thế)
    graphCtx.beginPath();
    graphCtx.moveTo(points[0].x, centerY);
    points.forEach(pt => graphCtx.lineTo(pt.x, Math.max(centerY, pt.y)));
    graphCtx.lineTo(points[points.length - 1].x, centerY);
    graphCtx.closePath();
    graphCtx.fillStyle = botGrad;
    graphCtx.fill();

    // Đường biểu đồ chính
    graphCtx.beginPath();
    graphCtx.lineWidth = 2.5;
    graphCtx.strokeStyle = '#2563eb';
    points.forEach((pt, idx) => {
        if (idx === 0) graphCtx.moveTo(pt.x, pt.y);
        else graphCtx.lineTo(pt.x, pt.y);
    });
    graphCtx.stroke();

    // Hiển thị điểm số trực quan trực tiếp trên đồ thị cho các nước cờ nổi bật hoặc đang chọn
    points.forEach((pt, idx) => {
        if (idx === 0) return;

        // Vẽ chấm tròn nước đi
        graphCtx.beginPath();
        graphCtx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        graphCtx.fillStyle = pt.node.moveFlag === 'weak' ? '#ef4444' : (pt.node.moveFlag === 'inaccuracy' ? '#f59e0b' : (pt.node.moveFlag === 'strong' ? '#10b981' : '#3b82f6'));
        graphCtx.fill();

        // Nếu điểm lệch hoặc là phế cờ / sơ hở, vẽ số điểm mốc trực quan trên đồ thị
        if (pt.node.moveFlag === 'weak' || pt.node.moveFlag === 'inaccuracy' || Math.abs(pt.score) >= 1.0) {
            const labelScore = (pt.score > 0 ? "+" : "") + pt.score.toFixed(1);
            graphCtx.font = 'bold 9px sans-serif';
            graphCtx.fillStyle = pt.node.moveFlag === 'weak' ? '#dc2626' : (pt.score >= 0 ? '#047857' : '#b91c1c');
            graphCtx.textAlign = 'center';
            const textY = pt.y < centerY ? pt.y - 6 : pt.y + 12;
            graphCtx.fillText(labelScore, pt.x, textY);
        }
    });

    // Vị trí nước cờ đang được chọn hiện tại
    const activeIdx = mainLine.findIndex(n => n === state.currentNode);
    if (activeIdx >= 0 && points[activeIdx]) {
        const activePt = points[activeIdx];
        graphCtx.beginPath();
        graphCtx.arc(activePt.x, activePt.y, 6.5, 0, Math.PI * 2);
        graphCtx.fillStyle = '#dc2626';
        graphCtx.fill();
        graphCtx.lineWidth = 2;
        graphCtx.strokeStyle = '#ffffff';
        graphCtx.stroke();

        // Badge điểm nước hiện tại lớn
        const scoreStr = (activePt.score > 0 ? "+" : "") + activePt.score.toFixed(2);
        graphCtx.fillStyle = '#0f172a';
        graphCtx.font = 'bold 10px sans-serif';
        graphCtx.textAlign = activePt.x > (w / 2) ? 'right' : 'left';
        const tooltipX = activePt.x > (w / 2) ? activePt.x - 10 : activePt.x + 10;
        const tooltipY = activePt.y < centerY ? activePt.y + 14 : activePt.y - 8;
        graphCtx.fillText(`Điểm: ${scoreStr}`, tooltipX, tooltipY);
    }

    graphCtx.restore();

    // Click handler chọn nước đi tương ứng
    graphCanvas.onclick = (e) => {
        const rectCanvas = graphCanvas.getBoundingClientRect();
        const clickX = e.clientX - rectCanvas.left;
        let closestPt = null;
        let minDist = Infinity;

        points.forEach(pt => {
            const dist = Math.abs(pt.x - clickX);
            if (dist < minDist) {
                minDist = dist;
                closestPt = pt;
            }
        });

        if (closestPt && closestPt.node) {
            jumpToNode(closestPt.node);
            renderEvalGraph();
        }
    };
}
