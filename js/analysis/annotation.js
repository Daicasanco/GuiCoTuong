// js/analysis/annotation.js
// Quản lý các nhãn đánh giá nước đi (NAG) và bình luận.

export const MOVE_ANNOTATIONS = {
    BRILLIANT: { symbol: '!!', desc: 'Nước đi thiên tài', color: '#1b5e20' },
    GOOD: { symbol: '!', desc: 'Nước đi tốt', color: '#2e7d32' },
    INTERESTING: { symbol: '!?', desc: 'Nước đi thú vị', color: '#0277bd' },
    DUBIOUS: { symbol: '?!', desc: 'Nước đi nghi ngờ', color: '#f57f17' },
    MISTAKE: { symbol: '?', desc: 'Nước đi sai lầm', color: '#ef6c00' },
    BLUNDER: { symbol: '??', desc: 'Nước đi ngớ ngẩn (blunder)', color: '#c62828' }
};

export function getAnnotationSymbol(node) {
    if (!node || !node.comment) return '';
    // Tìm ký hiệu đánh giá từ đầu comment (ví dụ: "!! Rất hay")
    for (let key in MOVE_ANNOTATIONS) {
        const symbol = MOVE_ANNOTATIONS[key].symbol;
        if (node.comment.startsWith(symbol)) {
            return symbol;
        }
    }
    return '';
}
