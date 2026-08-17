// js/database/game-db.js
// Quản lý việc lưu trữ ván đấu lịch sử và các cây biến hóa vào SQLite.

export class GameDatabase {
    // Trả về danh sách ván đấu đã lưu
    static async getSavedGames() {
        return [];
    }

    // Lưu ván đấu mới
    static async saveGame(gameInfo, moveTreeRaw) {
        return true;
    }
}
