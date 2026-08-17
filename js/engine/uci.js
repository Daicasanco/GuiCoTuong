// js/engine/uci.js
// Bộ phân tích và dịch giao thức UCI (Universal Chess Interface).

export class UCIParser {
    // Phân tích một dòng đầu ra từ Engine stdout
    static parseLine(text) {
        if (!text) return null;
        text = text.trim();

        // 1. Phân tích dòng thông tin tìm kiếm: "info depth..."
        if (text.startsWith("info ")) {
            const result = { type: 'info' };

            const depthMatch = text.match(/depth (\d+)/);
            if (depthMatch) result.depth = parseInt(depthMatch[1]);

            const seldepthMatch = text.match(/seldepth (\d+)/);
            if (seldepthMatch) result.seldepth = parseInt(seldepthMatch[1]);

            const timeMatch = text.match(/time (\d+)/);
            if (timeMatch) result.time = parseInt(timeMatch[1]);

            const nodesMatch = text.match(/nodes (\d+)/);
            if (nodesMatch) result.nodes = parseInt(nodesMatch[1]);

            const npsMatch = text.match(/nps (\d+)/);
            if (npsMatch) result.nps = parseInt(npsMatch[1]);

            const multipvMatch = text.match(/multipv (\d+)/);
            if (multipvMatch) result.multipv = parseInt(multipvMatch[1]);

            // Phân tích điểm số (score cp hoặc score mate)
            const scoreCpMatch = text.match(/score cp (-?\d+)/);
            const scoreMateMatch = text.match(/score mate (-?\d+)/);
            if (scoreCpMatch) {
                result.scoreType = 'cp';
                result.scoreValue = parseInt(scoreCpMatch[1]);
            } else if (scoreMateMatch) {
                result.scoreType = 'mate';
                result.scoreValue = parseInt(scoreMateMatch[1]);
            }

            // Phân tích toàn bộ dãy nước đi gợi ý (PV - Principal Variation)
            const pvIndex = text.indexOf(" pv ");
            if (pvIndex !== -1) {
                const pvString = text.substring(pvIndex + 4).trim();
                result.pv = pvString.split(/\s+/); // Cắt thành mảng các nước đi, ví dụ ["h2e2", "h7e7", ...]
            }

            return result;
        }

        // 2. Phân tích kết quả tìm kiếm tốt nhất: "bestmove h2e2 ponder..."
        if (text.startsWith("bestmove")) {
            const parts = text.split(/\s+/);
            const result = {
                type: 'bestmove',
                bestMove: parts[1] === '(none)' ? '' : (parts[1] || '')
            };

            const ponderIndex = parts.indexOf("ponder");
            if (ponderIndex !== -1 && parts[ponderIndex + 1]) {
                result.ponder = parts[ponderIndex + 1];
            }

            return result;
        }

        // 3. Phân tích các thông điệp cờ khác
        if (text === "uciok") {
            return { type: 'uciok' };
        }
        if (text === "readyok") {
            return { type: 'readyok' };
        }

        return null;
    }
}
