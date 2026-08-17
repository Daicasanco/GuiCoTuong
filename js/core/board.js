// js/core/board.js
// Quàn lý trạng thái bàn cờ 90 ô (0-89) và thông tin quân cờ.

export const EMPTY = '';

// Ký hiệu quân cờ tiêu chuẩn cờ tướng (chữ Hoa: Đỏ, chữ thường: Đen)
// R/r: Xe, N/n: Mã, B/b: Tượng, A/a: Sĩ, K/k: Tướng, C/c: Pháo, P/p: Tốt.
export const PIECES = {
    RED_ROOK: 'R', RED_KNIGHT: 'N', RED_BISHOP: 'B', RED_ADVISOR: 'A', RED_KING: 'K', RED_CANNON: 'C', RED_PAWN: 'P',
    BLACK_ROOK: 'r', BLACK_KNIGHT: 'n', BLACK_BISHOP: 'b', BLACK_ADVISOR: 'a', BLACK_KING: 'k', BLACK_CANNON: 'c', BLACK_PAWN: 'p'
};

export class Board {
    constructor() {
        this.grid = new Array(90).fill(EMPTY); // 90 ô cờ, index 0 (a9) -> 89 (i0)
    }

    // Reset bàn cờ về trạng thái ban đầu
    reset() {
        const startFEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
        this.loadFEN(startFEN);
    }

    // Clear toàn bộ quân cờ
    clear() {
        this.grid.fill(EMPTY);
    }

    // Lấy quân cờ tại tọa độ logic (0-8 cho x, 0-9 cho y)
    getPieceAt(x, y) {
        if (x < 0 || x > 8 || y < 0 || y > 9) return null;
        return this.grid[y * 9 + x];
    }

    // Đặt quân cờ tại tọa độ logic
    setPieceAt(x, y, piece) {
        if (x < 0 || x > 8 || y < 0 || y > 9) return;
        this.grid[y * 9 + x] = piece;
    }

    // Lấy quân cờ tại vị trí index (0-89)
    getPiece(index) {
        if (index < 0 || index > 89) return null;
        return this.grid[index];
    }

    setPiece(index, piece) {
        if (index < 0 || index > 89) return;
        this.grid[index] = piece;
    }

    // Tải vị trí cờ từ chuỗi FEN
    loadFEN(fen) {
        this.clear();
        const parts = fen.split(' ');
        const boardPart = parts[0];
        const rows = boardPart.split('/');
        
        for (let y = 0; y < 10; y++) {
            let x = 0;
            const rowStr = rows[y];
            if (!rowStr) continue;
            for (let i = 0; i < rowStr.length; i++) {
                const char = rowStr[i];
                if (!isNaN(char)) {
                    x += parseInt(char);
                } else {
                    this.setPieceAt(x, y, char);
                    x++;
                }
            }
        }
    }

    // Xuất thế trận hiện tại ra chuỗi FEN ngắn (không có lượt đi, v.v.)
    toFENShort() {
        let fenRows = [];
        for (let y = 0; y < 10; y++) {
            let rowStr = '';
            let emptyCount = 0;
            for (let x = 0; x < 9; x++) {
                const piece = this.getPieceAt(x, y);
                if (piece === EMPTY) {
                    emptyCount++;
                } else {
                    if (emptyCount > 0) {
                        rowStr += emptyCount;
                        emptyCount = 0;
                    }
                    rowStr += piece;
                }
            }
            if (emptyCount > 0) {
                rowStr += emptyCount;
            }
            fenRows.push(rowStr);
        }
        return fenRows.join('/');
    }
}
