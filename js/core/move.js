// js/core/move.js
// Quản lý thông tin nước đi và chuyển đổi định dạng (ICCS, WXF, Tiếng Việt).

const CHINESE_TO_VIETNAMESE = {
    // Quân cờ
    '帅': 'Tướng', '将': 'Tướng',
    '仕': 'Sĩ', '士': 'Sĩ',
    '相': 'Tượng', '象': 'Tượng',
    '马': 'Mã', '馬': 'Mã',
    '车': 'Xe', '車': 'Xe',
    '炮': 'Pháo', '砲': 'Pháo',
    '兵': 'Tốt', '卒': 'Tốt',
    // Hướng đi
    '进': 'tấn',
    '退': 'thoái',
    '平': 'bình',
    // Vị trí phụ
    '前': 'Trước',
    '后': 'Sau', '後': 'Sau',
    '中': 'Giữa',
    // Số cờ
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9',
    '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
    '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9'
};

// Dịch nước đi từ tiếng Trung sang tiếng Việt
export function translateChineseToVietnamese(chineseMove) {
    if (!chineseMove) return '';
    const words = [];
    for (let char of chineseMove) {
        words.push(CHINESE_TO_VIETNAMESE[char] || char);
    }
    
    // Đảo ngữ pháp cờ tướng Trung - Việt: "Trước Pháo" -> "Pháo trước"
    if (['Trước', 'Sau', 'Giữa'].includes(words[0]) && 
        ['Mã', 'Pháo', 'Xe', 'Tốt', 'Sĩ', 'Tượng', 'Tướng'].includes(words[1])) {
        const position = words[0].toLowerCase();
        const piece = words[1];
        words[0] = piece;
        words[1] = position;
    }
    
    return words.join(' ');
}

export class Move {
    constructor(fromIndex, toIndex, piece = '', capture = '') {
        this.from = fromIndex; // 0-89
        this.to = toIndex;     // 0-89
        this.piece = piece;    // Quân đi
        this.capture = capture; // Quân bị ăn (nếu có)
    }

    // Lấy chuỗi tọa độ ICCS (ví dụ: "h2e2")
    toICCS() {
        if (typeof window !== 'undefined' && window.vschess) {
            return window.vschess.b2i[this.from] + window.vschess.b2i[this.to];
        }
        // Fallback tự tính toán nếu chưa load thư viện vschess
        const files = ['a','b','c','d','e','f','g','h','i'];
        const fromX = this.from % 9;
        const fromY = 9 - Math.floor(this.from / 9);
        const toX = this.to % 9;
        const toY = 9 - Math.floor(this.to / 9);
        return files[fromX] + fromY + files[toX] + toY;
    }

    // Sinh nước đi từ chuỗi ICCS
    static fromICCS(iccsStr) {
        if (!iccsStr || iccsStr.length < 4) return null;
        if (typeof window !== 'undefined' && window.vschess) {
            const from = window.vschess.i2b[iccsStr.substring(0, 2)];
            const to = window.vschess.i2b[iccsStr.substring(2, 4)];
            if (from !== undefined && to !== undefined) {
                return new Move(from, to);
            }
        }
        // Fallback tự tính toán
        const files = {a:0, b:1, c:2, d:3, e:4, f:5, g:6, h:7, i:8};
        const fromX = files[iccsStr[0]];
        const fromY = 9 - parseInt(iccsStr[1]);
        const toX = files[iccsStr[2]];
        const toY = 9 - parseInt(iccsStr[3]);
        return new Move(fromY * 9 + fromX, toY * 9 + toX);
    }

    // Định dạng nước đi ra tiếng Trung (WXF/Chinese)
    toChinese(fen) {
        if (typeof window !== 'undefined' && window.vschess) {
            const iccs = this.toICCS();
            const result = window.vschess.Node2Chinese(iccs, fen);
            return result ? result.move : '';
        }
        return '';
    }

    // Định dạng nước đi ra tiếng Việt
    toVietnamese(fen) {
        const chinese = this.toChinese(fen);
        return translateChineseToVietnamese(chinese);
    }

    // Định dạng WXF quốc tế (ví dụ: "C2.5")
    toWXF(fen) {
        if (typeof window !== 'undefined' && window.vschess) {
            const iccs = this.toICCS();
            const result = window.vschess.Node2WXF(iccs, fen);
            return result ? result.move : '';
        }
        return '';
    }
}
