// js/database/engine-cache.js
// Lớp bọc ngoài truy xuất bộ nhớ đệm phân tích (Engine Cache) từ SQLite.

import { queryEngineCache, saveEngineCache } from '../localbook.js';

export async function getCache(positionKey, engine, version, depth, multipv) {
    try {
        const result = await queryEngineCache(positionKey, engine, version, depth, multipv);
        return result; // Trả về { score, pv } hoặc null
    } catch(e) {
        console.error("Lỗi khi đọc Engine Cache:", e);
        return null;
    }
}

export async function saveCache(positionKey, engine, version, depth, multipv, score, pv) {
    try {
        return await saveEngineCache(positionKey, engine, version, depth, multipv, score, pv);
    } catch(e) {
        console.error("Lỗi khi ghi Engine Cache:", e);
        return false;
    }
}
