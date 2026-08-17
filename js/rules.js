// js/rules.js
import { state } from './state.js';

// 1. KIỂM TRA LUẬT HÒA 60 NƯỚC (Không ăn quân)
export function checkDraw60Moves(node) {
    // Chỉ áp dụng cho Đấu Bot và Giải bài tập
    if (state.appMode !== 'vsbot' && state.appMode !== 'puzzle') return false;

    let count = 0;
    let curr = node;

    while (curr && curr.parent) {
        // Kiểm tra xem nước đi vừa rồi có ăn quân không (So sánh tổng số quân)
        const piecesBefore = vschess.countPieceLength(curr.parent.fen);
        const piecesAfter = vschess.countPieceLength(curr.fen);

        if (piecesAfter < piecesBefore) {
            break; // Đứt chuỗi, đếm lại từ đầu vì có ăn quân
        }

        // Kiểm tra xem nước đi vừa rồi có phải là nước chiếu tướng không
        const isCheck = vschess.checkThreat(curr.fen);

        if (!isCheck) {
            count++; // Chỉ cộng dồn những nước KHÔNG chiếu
        }

        // 30 nước cho mỗi bên = 60 nửa nước (plies)
        if (count >= 60) { 
            return true;
        }

        curr = curr.parent;
    }

    return false;
}

// 2. LỌC NƯỚC ĐI HỢP LỆ (CẤM NƯỚC CHIẾU THỨ 11 LIÊN TIẾP)
function filterConsecutiveChecks(legalMoves, currentFen) {
    if (state.appMode !== 'vsbot') return legalMoves;

    let checkStreak = 0;
    // Bắt đầu truy vết từ nước đi TRƯỚC ĐÓ CỦA CÙNG MỘT PHE
    let curr = state.currentNode ? state.currentNode.parent : null;

    while (curr && curr.parent) {
        // curr.fen là hình cờ sau khi phe ta đi. 
        // Nếu checkThreat(curr.fen) = true, có nghĩa phe ta vừa chiếu tướng đối thủ.
        if (vschess.checkThreat(curr.fen)) {
            checkStreak++;
        } else {
            break; // Nếu có 1 nước không chiếu xen ngang -> đứt chuỗi
        }

        // Lùi về 2 bước (để xem tiếp nước đi cũ của chính phe mình)
        if (curr.parent && curr.parent.parent) {
            curr = curr.parent.parent;
        } else {
            break;
        }
    }

    // Nếu đã truy chiếu 10 lần liên tiếp -> Quét và Xóa mọi nước chiếu ở lượt thứ 11
    if (checkStreak >= 10) {
        return legalMoves.filter(move => {
            const testFen = vschess.fenMovePiece(currentFen, move);
            return !vschess.checkThreat(testFen); // Bỏ qua nếu đi nước này lại tiếp tục chiếu
        });
    }

    return legalMoves;
}

// Hàm Bọc tổng hợp dùng để thay thế cho vschess.legalMoveList mặc định
export function getStrictLegalMoves(situation, fen) {
    let moves = vschess.legalMoveList(situation);
    return filterConsecutiveChecks(moves, fen);
}