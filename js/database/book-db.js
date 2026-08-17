// js/database/book-db.js
// Quản lý truy xuất dữ liệu sách khai cuộc từ SQLite.

import { uploadLocalBook, queryLocalBookWorker } from '../localbook.js';

export async function importBookFile(file) {
    return await uploadLocalBook(file);
}

export async function getBookMoves(fen) {
    return await queryLocalBookWorker(fen);
}
