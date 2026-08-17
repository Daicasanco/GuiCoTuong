// js/core/position.js
// Quản lý vị trí hình cờ, lượt đi, nước đi hợp lệ và chiếu tướng.

import { Board } from './board.js';

export class Position {
    constructor(fen = '') {
        this.board = new Board();
        this.sideToMove = 'w'; // 'w' (Đỏ) hoặc 'b' (Đen)
        this.fen = fen || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
        this.board.loadFEN(this.fen);
        this.updateSideToMove();
    }

    // Cập nhật lượt đi từ FEN
    updateSideToMove() {
        const parts = this.fen.split(' ');
        this.sideToMove = parts[1] || 'w';
    }

    // Thiết lập vị trí mới bằng FEN
    setFEN(fen) {
        this.fen = fen;
        this.board.loadFEN(fen);
        this.updateSideToMove();
    }

    // Lấy chuỗi FEN hiện tại
    getFEN() {
        return this.fen;
    }

    // Sinh danh sách nước đi hợp lệ dạng ICCS (ví dụ: ["h2e2", "h2g2"])
    getLegalMoves() {
        if (typeof window !== 'undefined' && window.vschess) {
            const situation = window.vschess.fenToSituation(this.fen);
            return window.vschess.legalMoveList(situation);
        }
        return [];
    }

    // Kiểm tra xem bên đi hiện tại có đang bị chiếu tướng không
    isCheck() {
        if (typeof window !== 'undefined' && window.vschess) {
            const situation = window.vschess.fenToSituation(this.fen);
            return window.vschess.checkThreat(situation);
        }
        return false;
    }

    // Thực hiện nước đi và trả về chuỗi FEN mới
    makeMove(moveStr) {
        if (typeof window !== 'undefined' && window.vschess) {
            const nextFen = window.vschess.fenMovePiece(this.fen, moveStr);
            this.setFEN(nextFen);
            return nextFen;
        }
        return this.fen;
    }
}
