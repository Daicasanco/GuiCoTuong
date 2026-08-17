// js/db.js
const DB_NAME = 'TuongKyVietDB';
const DB_VERSION = 1;
const STORE_NAME = 'Workspaces';

export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Lưu dữ liệu vào 1 trong 2 luồng (analyze_workspace hoặc vsbot_workspace)
export function saveWorkspace(key, data) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(data, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Lấy dữ liệu từ 1 trong 2 luồng
export function getWorkspace(key) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

// Xóa 1 dữ liệu bất kỳ bằng key
export function deleteWorkspace(key) {
    return new Promise(async (resolve, reject) => {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}