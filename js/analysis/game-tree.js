// js/analysis/game-tree.js
// Quản lý cấu trúc cây nước đi (Game Tree) và các biến hóa (Variations).

export class GameTreeNode {
    constructor(moveCommand = null, parent = null, id = null) {
        this.id = id || ((typeof window !== 'undefined' && window.vschess && window.vschess.guid) ? window.vschess.guid() : Math.random().toString(36).substr(2, 9));
        this.moveCommand = moveCommand; // Nước đi dưới dạng ICCS, ví dụ "h2e2". Gốc là null.
        this.parent = parent;          // Node cha
        this.children = [];            // Mảng các Node con (các biến hóa)
        this.mainLineIndex = 0;        // Nhánh chính mặc định (thường là children[0])
        this.comment = "";             // Bình luận tại nước đi này
        this.fen = null;               // FEN động sẽ được tính toán khi cần thiết
        this.notation = null;          // Dịch nước đi ("Pháo 2 bình 5", v.v.)
        this.isRed = false;            // Bên đi nước này là Đỏ?
        this.roundNum = 1;             // Số thứ tự lượt đi
    }

    // Đảm bảo dữ liệu FEN và dịch nước đi đã được tính toán (dynamic evaluation)
    ensureData() {
        if (this.fen && this.notation) return;
        if (!this.parent || !this.moveCommand) return;

        // Đệ quy đảm bảo dữ liệu node cha đã sẵn sàng
        this.parent.ensureData();

        try {
            if (typeof window !== 'undefined' && window.vschess) {
                this.fen = window.vschess.fenMovePiece(this.parent.fen, this.moveCommand);
                this.isRed = this.fen.split(" ")[1] === "w";
                this.roundNum = parseInt(this.fen.split(" ")[5]) || 1;
                if (this.roundNum === 0) this.roundNum = 1;
                
                // Trực tiếp import customTranslator động hoặc dùng hàm toàn cục
                // Để tránh circular dependency, chúng ta kiểm tra hàm window.customTranslator 
                // hoặc sử dụng hàm dịch của chúng ta từ js/core/move.js
                if (window.customTranslator) {
                    this.notation = window.customTranslator(this.moveCommand, this.parent.fen);
                } else {
                    // Fallback sang định dạng thô ICCS nếu chưa có bộ dịch UI
                    this.notation = this.moveCommand;
                }
            }
        } catch (e) {
            console.error("Lỗi tính toán dữ liệu nút cờ:", e);
        }
    }
}

export class GameTree {
    constructor(rootFen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1") {
        this.root = new GameTreeNode(null, null);
        this.root.fen = rootFen;
        this.root.isRed = false; 
        this.root.roundNum = 0;
        this.root.notation = "Thế cờ đầu";
    }

    // Nạp cây nước đi từ cấu trúc dữ liệu thô (đệ quy)
    static fromRaw(rawNode, parent = null) {
        if (!rawNode) return null;
        
        const node = new GameTreeNode(rawNode.moveCommand || rawNode.move || null, parent, rawNode.id);
        node.comment = rawNode.comment || "";
        node.mainLineIndex = rawNode.defaultIndex || rawNode.mainLineIndex || 0;
        
        // Nếu là node gốc, gán FEN gốc
        if (!parent) {
            node.fen = rawNode.fen || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
            node.notation = "Thế cờ đầu";
        }

        const rawChildren = rawNode.next || rawNode.children || [];
        for (let rawChild of rawChildren) {
            node.children.push(GameTree.fromRaw(rawChild, node));
        }
        return node;
    }

    // Xuất cây nước đi thành dạng Object thô để lưu trữ
    static toRaw(node) {
        if (!node) return null;
        
        const raw = {
            id: node.id,
            moveCommand: node.moveCommand,
            comment: node.comment,
            mainLineIndex: node.mainLineIndex,
            children: []
        };

        // Chỉ lưu FEN ở nút gốc để tối ưu dung lượng
        if (!node.parent) {
            raw.fen = node.fen;
        }

        for (let child of node.children) {
            raw.children.push(GameTree.toRaw(child));
        }
        return raw;
    }

    // Thêm nước đi mới vào node hiện tại
    addMove(parentNode, moveCommand) {
        // Kiểm tra xem nước đi này đã tồn tại trong các node con chưa
        let child = parentNode.children.find(c => c.moveCommand === moveCommand);
        if (child) {
            return child; // Đã có sẵn nhánh này, trả về luôn
        }

        // Tạo node mới
        const newNode = new GameTreeNode(moveCommand, parentNode);
        newNode.ensureData();
        parentNode.children.push(newNode);
        
        // Trả về node mới tạo
        return newNode;
    }

    // Xóa một nước đi/nhánh khỏi cây
    deleteMove(node) {
        if (!node.parent) return; // Không thể xóa nút gốc
        const index = node.parent.children.indexOf(node);
        if (index > -1) {
            node.parent.children.splice(index, 1);
            // Cập nhật lại mainLineIndex nếu chỉ số cũ vượt quá phạm vi
            if (node.parent.mainLineIndex >= node.parent.children.length) {
                node.parent.mainLineIndex = Math.max(0, node.parent.children.length - 1);
            }
        }
    }

    // Thăng cấp một biến hóa lên làm nhánh chính (Main Line)
    promoteVariation(node) {
        if (!node.parent) return;
        const index = node.parent.children.indexOf(node);
        if (index > 0) {
            // Đưa node lên đầu danh sách con của cha nó
            node.parent.children.splice(index, 1);
            node.parent.children.unshift(node);
            node.parent.mainLineIndex = 0;
        }
    }

    // Lấy danh sách nước đi chính (Main Line) từ nút hiện tại trở đi
    getMainLine(startNode) {
        const line = [];
        let curr = startNode;
        while (curr && curr.children.length > 0) {
            const nextNode = curr.children[curr.mainLineIndex] || curr.children[0];
            line.push(nextNode);
            curr = nextNode;
        }
        return line;
    }
}
