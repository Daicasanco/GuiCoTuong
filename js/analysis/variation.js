// js/analysis/variation.js
// Các hàm hỗ trợ quản lý các nhánh cờ biến phụ.

export function getAlternativeMoves(currentNode) {
    if (!currentNode || !currentNode.parent) return [];
    // Trả về các nước đi thay thế khác từ cùng một vị trí cha
    return currentNode.parent.children.filter(child => child.id !== currentNode.id);
}
