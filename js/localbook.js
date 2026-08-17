// js/localbook.js
import { state } from './state.js';
import { showToast, showLoading, hideLoading } from './ui.js';
import { getWorkspace, saveWorkspace, deleteWorkspace } from './db.js';

let worker = null;
let isDbLoaded = false;
let isDbLoading = false; // Cờ theo dõi trạng thái đang giải nén vào RAM

let requestCounter = 0;
const pendingRequests = new Map();

function initWorker() {
    if (worker) return;
    worker = new Worker('js/localbook.worker.js');
    worker.onmessage = (e) => {
        const { type, msg, data, dbType, requestId } = e.data;
        
        if (type === 'STATUS') {
            console.log("[LocalBook Status]:", msg);
        } else if (type === 'LOAD_SUCCESS') {
            isDbLoaded = true;
            isDbLoading = false; 
            hideLoading();
            
            // NẠP VÀO RAM XONG -> Mở khóa nút Xóa
            updateLocalBookUI_DBLoaded(false);

            if (state.currentNode) {
                import('./engine.js').then(module => {
                    module.fetchCloudBook(state.currentNode.fen);
                });
            }
        } else if (type === 'ERROR') {
            isDbLoading = false;
            hideLoading();
            console.error("[LocalBook Error]:", msg);
            showToast(`❌ Lỗi đọc Book: ${msg}`);
            
            // CÓ LỖI CŨNG PHẢI MỞ KHÓA NÚT XÓA (Để người dùng còn xóa file lỗi đi)
            updateLocalBookUI_DBLoaded(false);
            
        } else if (type === 'QUERY_RESULT') {
            if (requestId && pendingRequests.has(requestId)) {
                const resolveFunc = pendingRequests.get(requestId);
                resolveFunc(data);
                pendingRequests.delete(requestId);
            }
        }
    };
}

export async function uploadLocalBook(file) {
    if (file.size > 1024 * 1024 * 1024) { 
        showToast("❌ File quá lớn! Vui lòng chọn file dưới 1GB.");
        return;
    }
    showLoading("Đang sao chép file vào bộ nhớ...");
    isDbLoading = true;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const arrayBuffer = e.target.result;
        try {
            await deleteWorkspace('local_book_data');
            await saveWorkspace('local_book_data', {
                name: file.name,
                buffer: arrayBuffer
            });
            
            // LƯU DB XONG -> Hiện tên file và nút Xóa bị vô hiệu hóa
            updateLocalBookUI_DBLoaded(true);
            const filenameSpan = document.getElementById('local-book-filename');
            if(filenameSpan) {
                filenameSpan.innerText = file.name;
                filenameSpan.style.color = "#008a3e";
            }

            initWorker();
            showLoading("Đang nạp dữ liệu SQLite...");
            worker.postMessage({ action: 'LOAD_DB', buffer: arrayBuffer }, [arrayBuffer]); 
        } catch (err) {
            isDbLoading = false;
            hideLoading();
            showToast("❌ Không đủ bộ nhớ để lưu Book này!");
        }
    };
    reader.readAsArrayBuffer(file);
}

export async function deleteLocalBook() {
    await deleteWorkspace('local_book_data');
    if (worker) {
        worker.terminate();
        worker = null;
    }
    isDbLoaded = false;
    isDbLoading = false;
    pendingRequests.clear(); 
    showToast("✅ Đã xóa Local Book khỏi bộ nhớ!");
    updateLocalBookUI_DBRemoved();
    
    // Tự động quét lại Cloud Book sau khi xóa
    if (state.currentNode) {
        import('./engine.js').then(module => module.fetchCloudBook(state.currentNode.fen));
    }
}

export async function loadLocalBookFromDB() {
    if (isDbLoaded) {
        if (state.currentNode) {
            import('./engine.js').then(module => module.fetchCloudBook(state.currentNode.fen));
        }
        return true;
    }
    
    // NẾU ĐANG TRONG QUÁ TRÌNH LOAD: Ép giao diện hiện nút Xóa (Bị vô hiệu hóa)
    if (isDbLoading) {
        updateLocalBookUI_DBLoaded(true);
        return false;
    }

    isDbLoading = true;
    const bookData = await getWorkspace('local_book_data');
    if (bookData && bookData.buffer) {
        
        // ĐÃ TÌM THẤY FILE -> Hiện tên file và hiện nút Xóa bị vô hiệu hóa NGAY LẬP TỨC
        updateLocalBookUI_DBLoaded(true);
        
        const filenameSpan = document.getElementById('local-book-filename');
        if(filenameSpan) {
            filenameSpan.innerText = bookData.name;
            filenameSpan.style.color = "#008a3e";
        }
        
        initWorker();
        worker.postMessage({ action: 'LOAD_DB', buffer: bookData.buffer }, [bookData.buffer]);
        return true;
    }
    
    isDbLoading = false;
    if (state.currentNode) {
        import('./engine.js').then(module => module.fetchCloudBook(state.currentNode.fen));
    }
    return false;
}

export function queryLocalBookWorker(fen) {
    return new Promise((resolve) => {
        if (isDbLoading) {
            resolve('LOADING'); 
            return;
        }
        
        // NẾU WORKER CHƯA ĐƯỢC BẬT (TỨC LÀ KHÔNG CÓ FILE) -> TRẢ VỀ TÍN HIỆU NO_DB
        if (!worker || !isDbLoaded) {
            resolve('NO_DB');
            return;
        }
        
        // NẾU CÓ FILE BÌNH THƯỜNG -> GỬI QUERY CHO WORKER
        const reqId = ++requestCounter;
        pendingRequests.set(reqId, resolve);
        worker.postMessage({ action: 'QUERY', fen: fen, requestId: reqId });
    });
}

export function updateLocalBookUI_DBLoaded(isLoading = false) {
    const btnUp = document.getElementById('btn-upload-local-book');
    const btnDel = document.getElementById('btn-delete-local-book');
    const title = document.getElementById('local-book-title');

    if (btnUp) btnUp.style.display = 'none';
    if (btnDel) {
        btnDel.style.display = 'flex';
        // Vô hiệu hóa nút Xóa khi đang Load vào RAM
        if (isLoading) {
            btnDel.disabled = true;
            btnDel.style.opacity = '0.4';
            btnDel.style.cursor = 'not-allowed';
        } else {
            btnDel.disabled = false;
            btnDel.style.opacity = '1';
            btnDel.style.cursor = 'pointer';
        }
    }
    if (title) title.innerText = "Thiết lập Local Book";

    const typeSelect = document.getElementById('book-type-select');
    if (typeSelect && typeSelect.value === 'local') {
        const cloudTab = document.querySelector('.ai-tab-btn[data-tab="cloudbook"]');
        if (cloudTab) cloudTab.innerText = "Local Book";
    }
}

function updateLocalBookUI_DBRemoved() {
    const btnUp = document.getElementById('btn-upload-local-book');
    const btnDel = document.getElementById('btn-delete-local-book');
    const title = document.getElementById('local-book-title');
    const filenameSpan = document.getElementById('local-book-filename');
    
    if (btnUp) btnUp.style.display = 'flex';
    if (btnDel) btnDel.style.display = 'none';
    if (title) title.innerText = "Tải lên Local Book";
    
    if (filenameSpan) {
        filenameSpan.innerText = "Hỗ trợ .bin, .cbl, .xqf, .pgn, .xqb, .obk, .pfbook";
        filenameSpan.style.color = "#888";
    }

    const cloudTab = document.querySelector('.ai-tab-btn[data-tab="cloudbook"]');
    if (cloudTab) cloudTab.innerText = "Cloud Book";
}