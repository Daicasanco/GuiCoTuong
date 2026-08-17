// js/ui.js
import { state } from './state.js';
import { forceStopAIPlayers, jumpToNode, ensureNodeData,loadGameFromList } from './game.js';
import { getWorkspace, saveWorkspace, deleteWorkspace } from './db.js';

let toastTimeout;

export function showToast(message) {
    const toast = document.getElementById('toast-container');
    if (!toast) return;
    toast.innerHTML = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

export function showLoading(msg) {
    const overlay = document.getElementById('loading-overlay');
    overlay.innerHTML = `<div class="spinner"></div><h2 style="color:white; margin-top:15px;">${msg}</h2>`;
    overlay.style.display = 'flex'; 
    overlay.style.opacity = '1';
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.opacity = '0'; 
    setTimeout(() => overlay.style.display = 'none', 300);
}

export function syncNavbarWidth() {
    const boardArea = document.getElementById('chess-board-area');
    const navBar = document.getElementById('nav-bar');
    if(boardArea && navBar) navBar.style.width = `${boardArea.offsetWidth}px`;
}

export function updateTurnToggleUI() {
    document.querySelectorAll('.palette-turn-toggle').forEach(toggle => {
        if (state.editTurn === 'w') {
            toggle.className = 'palette-turn-toggle turn-red';
            toggle.innerHTML = 'Bên Đỏ<br>Đi Trước';
        } else {
            toggle.className = 'palette-turn-toggle turn-black';
            toggle.innerHTML = 'Bên Đen<br>Đi Trước';
        }
    });
}

export function openModal(modalId, targetParentNode = null) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    if (modalId === 'variation-modal') {
        if (targetParentNode) {
            state.editingParentNode = targetParentNode;
        } else if (state.currentNode && state.currentNode.parent && state.currentNode.parent.children && state.currentNode.parent.children.length > 1) {
            state.editingParentNode = state.currentNode.parent;
        } else if (state.currentNode && state.currentNode.children && state.currentNode.children.length > 1) {
            state.editingParentNode = state.currentNode;
        } else {
            state.editingParentNode = state.currentNode.parent || state.currentNode;
        }
        renderVariationModal();
    }
    if (modalId === 'info-modal') {
        for (let key in state.currentGameInfo) {
            const input = document.getElementById(`info-${key}`);
            if (input) input.value = state.currentGameInfo[key];
        }
    }
    modal.style.display = 'flex';
    setTimeout(() => { modal.classList.add('show'); }, 10);
}

let draggedVarIndex = null;

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('show'); 
    setTimeout(() => { modal.style.display = 'none'; }, 300); 
}

export function renderVariationModal() {
    const listContainer = document.getElementById('variation-list-container'); 
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (!state.editingParentNode || !state.editingParentNode.children) return;

    state.editingParentNode.children.forEach((child, index) => {
        ensureNodeData(child);
        const row = document.createElement('div'); 
        row.className = 'var-row';
        row.setAttribute('draggable', 'true');
        row.dataset.index = index;

        const isMain = (index === (state.editingParentNode.mainLineIndex || 0));
        if (isMain) row.classList.add('var-row-active');

        // Biểu tượng tay kéo (Drag handle)
        const dragHandle = document.createElement('span');
        dragHandle.className = 'var-drag-handle';
        dragHandle.innerHTML = '⠿';
        dragHandle.style.cssText = 'cursor: grab; margin-right: 8px; color: #94a3b8; font-size: 14px; user-select: none; flex-shrink: 0;';

        const indexSpan = document.createElement('span'); 
        indexSpan.className = 'var-index'; 
        indexSpan.innerText = `${index + 1}.`;
        
        const textSpan = document.createElement('div'); 
        textSpan.className = `var-text-modal ${isMain ? 'var-text-active' : ''}`; 
        textSpan.innerText = child.notation;
        
        row.onclick = (e) => { 
            if (e.target.closest('.var-btn-del') || e.target.closest('.var-drag-handle')) return;
            forceStopAIPlayers(); 
            if (state.editingParentNode) state.editingParentNode.mainLineIndex = index; 
            jumpToNode(child); 
            closeModal('variation-modal'); 
        };

        const btnDel = document.createElement('button'); 
        btnDel.className = 'var-btn-del'; 
        btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        btnDel.onclick = (e) => { 
            e.stopPropagation(); 
            deleteVariation(index); 
        };

        // SỰ KIỆN KÉO THẢ DRAG & DROP
        row.addEventListener('dragstart', (e) => {
            draggedVarIndex = index;
            row.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        });

        row.addEventListener('dragend', () => {
            row.style.opacity = '1';
            document.querySelectorAll('.var-row').forEach(r => r.style.borderTop = '');
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            row.style.borderTop = '2px solid #2563eb';
        });

        row.addEventListener('dragleave', () => {
            row.style.borderTop = '';
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.style.borderTop = '';
            const fromIdx = draggedVarIndex;
            const toIdx = index;

            if (fromIdx !== null && fromIdx !== toIdx) {
                reorderVariation(fromIdx, toIdx);
            }
        });

        row.appendChild(dragHandle);
        row.appendChild(indexSpan); 
        row.appendChild(textSpan); 
        row.appendChild(btnDel); 
        listContainer.appendChild(row);
    });
}

export function reorderVariation(fromIndex, toIndex) {
    if (!state.editingParentNode || !state.editingParentNode.children) return;

    const children = state.editingParentNode.children;
    const [movedItem] = children.splice(fromIndex, 1);
    children.splice(toIndex, 0, movedItem);

    state.editingParentNode.mainLineIndex = 0;

    renderVariationModal();
    import('./board.js').then(m => m.renderMoveHistory()).catch(() => {});
}

export function deleteVariation(index) {
    if (state.editingParentNode.children.length === 1) return; 
    
    state.editingParentNode.children.splice(index, 1);
    if (state.editingParentNode.mainLineIndex === index) {
        state.editingParentNode.mainLineIndex = 0; 
        jumpToNode(state.editingParentNode.children[0]); 
    } else if (state.editingParentNode.mainLineIndex > index) {
        state.editingParentNode.mainLineIndex--;
    }
    renderVariationModal();
}
// Đóng mở Menu chính
export function toggleMainMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('main-menu-panel');
    if (menu) menu.classList.toggle('show-menu');
}

export function closeMainMenu() {
    const menu = document.getElementById('main-menu-panel');
    if (menu && menu.classList.contains('show-menu')) {
        menu.classList.remove('show-menu');
    }
}

// Các hằng số tính toán cho Virtual List
let ITEM_HEIGHT = 52; // Mặc định PC: 44px height + 8px margin 52
let VISIBLE_ITEMS = 25; // Số lượng nút tái chế tối đa tạo ra
let domPool = []; // Mảng chứa các nút DOM tái chế

export function renderGameList(forceScrollToActive = false) {
    const titleTab = document.getElementById('tab-title');
    if (!titleTab) return;

    if (!state.gameList || state.gameList.length <= 1) {
        const oldViewport = document.getElementById('game-list-viewport');
        if (oldViewport) oldViewport.remove();
        return;
    }

    const isMobile = (window.innerWidth / window.innerHeight) <= 1;
    ITEM_HEIGHT = isMobile ? 42 : 52; 

    let viewport = document.getElementById('game-list-viewport');
    let spacer, container;

    if (!viewport) {
        viewport = document.createElement('div');
        viewport.id = 'game-list-viewport';
        
        spacer = document.createElement('div');
        spacer.id = 'game-list-spacer';
        
        container = document.createElement('div');
        container.id = 'game-list-container';

        viewport.appendChild(spacer);
        viewport.appendChild(container);
        titleTab.appendChild(viewport);

        domPool = [];
        for (let i = 0; i < VISIBLE_ITEMS; i++) {
            const btn = document.createElement('button');
            btn.className = 'game-list-btn';
            btn.innerHTML = `<span class="game-index"></span><span class="game-title"></span>`;
            
            btn.onclick = () => {
                const gameIndex = parseInt(btn.dataset.index);
                if (isNaN(gameIndex) || gameIndex === state.currentGameIndex) return;
                
                // MỞ RỘNG IMPORT ĐỂ LẤY THÊM saveGameState TỪ io.js
                Promise.all([
                    import('./game.js'),
                    import('./io.js'),
                    import('./engine.js')
                ]).then(([gameModule, ioModule, engineModule]) => {
                    gameModule.forceStopAIPlayers();
                    gameModule.loadGameFromList(gameIndex);
                    
                    renderGameList(false); 
                    
                    // LƯU NGAY LẬP TỨC: Cập nhật vị trí ván đấu mới xuống IndexedDB
                    ioModule.saveGameState();
                    
                    if (state.isAnalyzing) {
                        engineModule.triggerEngineEvaluation();
                    }
                });
            };
            
            domPool.push(btn);
            container.appendChild(btn);
        }

        viewport.addEventListener('scroll', () => {
            requestAnimationFrame(updateVirtualList);
        });
        
        // Mới khởi tạo lần đầu thì mặc định được phép cuộn
        forceScrollToActive = true;
    } else {
        spacer = document.getElementById('game-list-spacer');
        container = document.getElementById('game-list-container');
    }

    spacer.style.height = `${state.gameList.length * ITEM_HEIGHT}px`;

    // CHỈ TỰ ĐỘNG CUỘN KHI forceScrollToActive = TRUE (Lúc F5 hoặc lúc tải file)
    if (forceScrollToActive) {
        const targetScrollTop = state.currentGameIndex * ITEM_HEIGHT;
        viewport.scrollTop = targetScrollTop - (viewport.clientHeight / 2) + (ITEM_HEIGHT / 2);
    }

    updateVirtualList();
}

function updateVirtualList() {
    const viewport = document.getElementById('game-list-viewport');
    if (!viewport || domPool.length === 0) return;

    const scrollTop = viewport.scrollTop;
    
    // Tính toán xem đang ở "trang" nào của danh sách
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 2); // Trừ hao 2 nút ở trên cùng cho mượt
    const endIndex = Math.min(state.gameList.length - 1, startIndex + VISIBLE_ITEMS - 1);

    // Dịch chuyển Container chứa 15 nút xuống đúng vị trí cuộn
    const container = document.getElementById('game-list-container');
    container.style.transform = `translateY(${startIndex * ITEM_HEIGHT}px)`;

    // Đổ dữ liệu Data vào các nút DOM có sẵn
    for (let i = 0; i < VISIBLE_ITEMS; i++) {
        const btn = domPool[i];
        const dataIndex = startIndex + i;

        if (dataIndex <= endIndex) {
            const game = state.gameList[dataIndex];
            let title = (game.info && game.info.title) ? game.info.title : "Ván đấu mặc định";
            
            // Chỉ cập nhật dữ liệu DOM, KHÔNG TẠO MỚI thẻ
            btn.style.display = 'flex';
            btn.dataset.index = dataIndex;
            btn.querySelector('.game-index').innerText = `${dataIndex + 1}.`;
            
            const titleEl = btn.querySelector('.game-title');
            titleEl.innerText = title;
            titleEl.title = title;

            // Xử lý viền xanh cho nút đang Active
            if (dataIndex === state.currentGameIndex) {
                btn.classList.add('game-btn-active');
            } else {
                btn.classList.remove('game-btn-active');
            }
        } else {
            // Giấu các nút dư thừa ở đáy (nếu mảng < 15)
            btn.style.display = 'none';
        }
    }
}
export function showAILoading() {
    if (state.appMode === 'analyze' || state.appMode === 'blind') return;
    
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'block';
}
export function hideAILoading() {
    if (state.appMode === 'analyze' || state.appMode === 'blind') return;
    
    const spinner = document.getElementById('ai-thinking-spinner');
    if (spinner) spinner.style.display = 'none';
}

// ==========================================
// ==========================================
// CÂY THƯ VIỆN CỜ (CCBRIDGE LIBRARY TREE VIEW)
// ==========================================
export let pendingDeleteLibId = "";
export let pendingDeleteCollectionId = null;
let expandedCollections = new Set();
let expandedTreeFolders = new Set();
export let selectedLibraryCollectionId = "default_col";
export let currentLibraryList = [];

export function clearAllLibraryAction() {
    pendingDeleteCollectionId = { colId: "ALL_LIBRARY", colName: "TOÀN BỘ Thư Viện Cờ" };
    pendingDeleteLibId = "";
    const delNameEl = document.getElementById('delete-lib-name');
    if (delNameEl) delNameEl.innerText = "TOÀN BỘ ván cờ đã nạp trong Thư Viện";
    openModal('delete-lib-modal');
}

export async function renderLibraryList() {
    showLoading("Đang tải cây thư viện...");
    const rawList = await getWorkspace('library_workspace') || [];
    currentLibraryList = rawList;
    const container = document.getElementById('lib-tree-container');
    const emptyText = document.getElementById('lib-empty-text');
    const searchInput = document.getElementById('lib-search-input');

    if (!container) {
        hideLoading();
        return;
    }

    if (rawList.length === 0) {
        if (emptyText) emptyText.style.display = 'block';
        container.innerHTML = '';
        const gamesContainer = document.getElementById('lib-games-table-container');
        if (gamesContainer) gamesContainer.innerHTML = '';
        hideLoading();
        return;
    } else {
        if (emptyText) emptyText.style.display = 'none';
    }

    // 1. Gom nhóm ván cờ theo collection_name hoặc collection_id
    const collectionsMap = new Map();
    rawList.forEach(item => {
        const colName = item.collection_name || "Ván Tự Lưu";
        const colId = item.collection_id || "default_col";
        if (!collectionsMap.has(colId)) {
            collectionsMap.set(colId, {
                id: colId,
                name: colName,
                items: []
            });
        }
        collectionsMap.get(colId).items.push(item);
    });

    // Nếu selectedLibraryCollectionId chưa có trong map và không phải là chọn thư mục cha thì chọn cái đầu tiên
    const isFolderSelection = selectedLibraryCollectionId && selectedLibraryCollectionId.startsWith("folder_path:");
    if (!isFolderSelection && !collectionsMap.has(selectedLibraryCollectionId) && collectionsMap.size > 0) {
        selectedLibraryCollectionId = collectionsMap.keys().next().value;
    }

    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : "";

    // 2. Xây dựng cây phân cấp thư mục thống nhất (bên trái chỉ hiển thị Thư Mục)
    const tree = { name: "Root", children: {}, count: 0 };
    
    collectionsMap.forEach((col, colId) => {
        const parts = col.name.split('/');
        let current = tree;
        let pathAccumulator = "";
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            pathAccumulator = pathAccumulator ? `${pathAccumulator}/${part}` : part;
            
            if (!current.children[part]) {
                current.children[part] = {
                    name: part,
                    fullPath: pathAccumulator,
                    children: {},
                    colId: (i === parts.length - 1) ? colId : null,
                    count: 0
                };
            }
            current = current.children[part];
            current.count += col.items.length;
            if (i === parts.length - 1) {
                current.colId = colId;
            }
        }
    });

    // Hàm đệ quy render cây thư mục
    function renderTreeNode(node, depth = 0) {
        let html = '';
        const indent = depth * 12;
        
        for (let name in node.children) {
            const childNode = node.children[name];
            const fullPath = childNode.fullPath;
            const hasSubFolders = Object.keys(childNode.children).length > 0;
            const isExpanded = expandedTreeFolders.has(fullPath);
            const iconArrow = hasSubFolders ? (isExpanded ? '▼' : '▶') : ' ';
            const isActive = (selectedLibraryCollectionId === "folder_path:" + fullPath || (childNode.colId && selectedLibraryCollectionId === childNode.colId));
            
            html += `
                <div class="lib-tree-folder ${isActive ? 'lib-folder-active' : ''}" data-path="${fullPath}" data-colid="${childNode.colId || ''}" style="padding: 5px 6px; padding-left: ${indent + 6}px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.15s; background: ${isActive ? '#f0fdf4' : 'transparent'}; border-left: 3px solid ${isActive ? '#008a3e' : 'transparent'}; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 6px; flex: 1; overflow: hidden; text-align: left;">
                        <span style="font-size: 9px; color: #777; width: 10px; text-align: center; flex-shrink: 0;">${iconArrow}</span>
                        <span style="font-size: 13px; flex-shrink: 0;">📁</span>
                        <strong style="font-size: 12px; color: ${isActive ? '#008a3e' : '#333'}; word-break: break-word; line-height: 1.3;" title="${fullPath}">${name}</strong>
                        <span style="font-size: 11px; color: #888; flex-shrink: 0;">(${childNode.count})</span>
                    </div>
                    <button class="lib-btn-del-folder" data-path="${fullPath}" data-colid="${childNode.colId || ''}" title="Xóa thư mục này" style="background: transparent; border: none; cursor: pointer; color: #999; padding: 2px; display: flex; align-items: center; flex-shrink: 0;">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
            `;
            
            if (hasSubFolders && isExpanded) {
                html += renderTreeNode(childNode, depth + 1);
            }
        }
        
        return html;
    }

    container.innerHTML = renderTreeNode(tree);

    // Gắn sự kiện click cho thư mục
    container.querySelectorAll('.lib-tree-folder').forEach(el => {
        el.onclick = (e) => {
            const delFolderBtn = e.target.closest('.lib-btn-del-folder');
            if (delFolderBtn) {
                e.stopPropagation();
                const folderPath = delFolderBtn.dataset.path;
                const colId = delFolderBtn.dataset.colid;
                pendingDeleteCollectionId = { colId: colId || "folder_path", colName: folderPath };
                pendingDeleteLibId = "";
                document.getElementById('delete-lib-name').innerText = `thư mục "${folderPath}" và tất cả bên trong`;
                openModal('delete-lib-modal');
                return;
            }
            
            const folderPath = el.dataset.path;
            if (expandedTreeFolders.has(folderPath)) {
                expandedTreeFolders.delete(folderPath);
            } else {
                expandedTreeFolders.add(folderPath);
            }
            selectedLibraryCollectionId = "folder_path:" + folderPath;
            renderLibraryList();
        };
    });

    // 3. Render cột phải (Danh sách ván)
    renderLibGamesList(selectedLibraryCollectionId, searchTerm);

    // Sự kiện tìm kiếm ô input
    if (searchInput && !searchInput.dataset.wired) {
        searchInput.dataset.wired = "true";
        searchInput.oninput = () => {
            renderLibraryList();
        };
    }

    hideLoading();
}

let currentLibPage = 1;

export function renderLibGamesList(colId, searchTerm = '', page = 1) {
    const container = document.getElementById('lib-games-table-container');
    if (!container) return;

    if (page) currentLibPage = page;

    let targetFolderPath = "";
    if (colId && colId.startsWith("folder_path:")) {
        targetFolderPath = colId.replace("folder_path:", "");
    }

    const filteredGames = currentLibraryList.filter(game => {
        let matchesCol = false;
        if (targetFolderPath) {
            matchesCol = game.collection_name && (game.collection_name === targetFolderPath || game.collection_name.startsWith(targetFolderPath + '/'));
        } else {
            matchesCol = (colId === 'default_col') ? !game.collection_id : (game.collection_id === colId);
        }
        if (!matchesCol) return false;
        if (searchTerm) {
            return game.file_name.toLowerCase().includes(searchTerm);
        }
        return true;
    });

    const totalGames = filteredGames.length;
    if (totalGames === 0) {
        container.innerHTML = `<div style="text-align: center; color: #888; margin-top: 20px; font-size: 12px;">Không tìm thấy ván đấu nào</div>`;
        return;
    }

    // Phân trang 100 ván cờ mỗi trang để đảm bảo UI mượt mà 100%
    const pageSize = 100;
    const totalPages = Math.ceil(totalGames / pageSize);
    if (currentLibPage > totalPages) currentLibPage = totalPages;
    if (currentLibPage < 1) currentLibPage = 1;

    const startIdx = (currentLibPage - 1) * pageSize;
    const pageGames = filteredGames.slice(startIdx, startIdx + pageSize);

    let html = `
        <div style="display: flex; flex-direction: column; height: 100%;">
            <div style="flex: 1; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; table-layout: fixed;">
                    <thead>
                        <tr style="border-bottom: 2px solid #ddd; background: #fafafa; font-weight: bold; color: #555; font-size: 11px;">
                            <th style="padding: 6px 4px; width: 32px; text-align: center;">STT</th>
                            <th style="padding: 6px 4px;">Tên bài/ván</th>
                            <th style="padding: 6px 4px; width: 32px; text-align: center;">Xóa</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pageGames.map((game, idx) => {
                            const globalIdx = startIdx + idx + 1;
                            const isActive = state.activeLibraryGameId === game.id_key;
                            return `
                                <tr class="lib-game-row ${isActive ? 'lib-game-active' : ''}" data-idkey="${game.id_key}" data-filename="${game.file_name}" style="border-bottom: 1px solid #eee; cursor: pointer; transition: background 0.1s; background: ${isActive ? '#f0fdf4' : 'transparent'};">
                                    <td style="padding: 6px 4px; text-align: center; color: #666; font-weight: ${isActive ? 'bold' : 'normal'}; vertical-align: top;">${globalIdx}</td>
                                    <td style="padding: 6px 4px; font-weight: ${isActive ? 'bold' : 'normal'}; color: ${isActive ? '#008a3e' : '#333'}; word-break: break-word; line-height: 1.35; vertical-align: top;" title="${game.file_name}">${game.file_name}</td>
                                    <td style="padding: 6px 4px; text-align: center; vertical-align: top;">
                                        <button class="lib-btn-del-single" data-idkey="${game.id_key}" data-filename="${game.file_name}" style="background: transparent; border: none; cursor: pointer; color: #ef4444; padding: 2px; display: inline-flex; align-items: center;">
                                            <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                        </button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
    `;

    if (totalPages > 1) {
        html += `
            <div style="padding: 6px 8px; border-top: 1px solid #eee; background: #fff; display: flex; align-items: center; justify-content: space-between; font-size: 11px; flex-shrink: 0; user-select: none;">
                <button id="lib-page-prev" ${currentLibPage <= 1 ? 'disabled' : ''} style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; background: #fff; cursor: pointer; opacity: ${currentLibPage <= 1 ? '0.5' : '1'};">◀ Trước</button>
                <span style="color: #666; font-weight: bold;">Trang ${currentLibPage} / ${totalPages} (${totalGames} ván)</span>
                <button id="lib-page-next" ${currentLibPage >= totalPages ? 'disabled' : ''} style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; background: #fff; cursor: pointer; opacity: ${currentLibPage >= totalPages ? '0.5' : '1'};">Sau ▶</button>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;

    const prevBtn = document.getElementById('lib-page-prev');
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentLibPage > 1) renderLibGamesList(colId, searchTerm, currentLibPage - 1);
        };
    }

    const nextBtn = document.getElementById('lib-page-next');
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentLibPage < totalPages) renderLibGamesList(colId, searchTerm, currentLibPage + 1);
        };
    }

    // Click handler cho dòng ván đấu
    container.querySelectorAll('.lib-game-row').forEach(row => {
        row.onclick = (e) => {
            const delSingleBtn = e.target.closest('.lib-btn-del-single');
            if (delSingleBtn) {
                e.stopPropagation();
                pendingDeleteLibId = delSingleBtn.dataset.idkey;
                pendingDeleteCollectionId = null;
                document.getElementById('delete-lib-name').innerText = delSingleBtn.dataset.filename;
                openModal('delete-lib-modal');
                return;
            }

            const idKey = row.dataset.idkey;
            loadGameFromLibrary(idKey);
        };
    });
}

// Logic Nạp ván cờ từ Thư viện
// Logic Nạp ván cờ từ Thư viện
async function loadGameFromLibrary(idKey) {
    showLoading("Đang mở ván cờ...");
    try {
        const textData = await getWorkspace(idKey);
        if (textData) {
            let nodeData = vschess.dataToNode(textData);
            let infoData = vschess.dataToInfo(textData);
            if (nodeData) {
                if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                
                // =======================================================
                // CƯỠNG CHẾ TRỞ VỀ CHẾ ĐỘ PHÂN TÍCH (ANALYZE MODE)
                // =======================================================
                state.appMode = 'analyze';
                state.appSettings.appMode = 'analyze';
                state.activeLibraryGameId = idKey;
                
                // 1. Dọn dẹp CSS của chế độ Bot / Cờ mù / Luyện Nhớ Ván
                document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize');
                const navBar = document.getElementById('nav-bar');
                if (navBar) { navBar.style.opacity = '1'; navBar.style.pointerEvents = 'auto'; }
                state.isPeeking = false;

                // 2. Reset Tiêu đề Tab
                const titleHeader = document.getElementById('tab-title');
                if (titleHeader) {
                    titleHeader.innerHTML = `
                        <strong style="font-size: 17px; color: #333; display: block; width: 100%;">CHẾ ĐỘ PHÂN TÍCH</strong>
                        <div id="blind-turn-indicator" class="blind-only" style="display: none; margin-top: 15px; font-size: 16px; font-weight: bold; color: #555;">
                            Lượt đi: <span id="blind-turn-text">Bên Đỏ</span>
                        </div>
                    `;
                }
                const titleTabBtn = document.querySelector('.ai-tab-btn[data-tab="title"]');
                if (titleTabBtn) titleTabBtn.click();

                // 3. Reset Active Menu
                document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
                const activeMenuBtn = document.getElementById('menu-analyze');
                if (activeMenuBtn) activeMenuBtn.classList.add('menu-item-active');

                // 4. Tắt các nút Máy đánh (nếu có)
                const btnRed = document.getElementById('btn-ai-red');
                if(btnRed) btnRed.classList.remove('tool-active');
                const btnBlack = document.getElementById('btn-ai-black');
                if(btnBlack) btnBlack.classList.remove('tool-active');
                state.aiPlaysRed = false;
                state.aiPlaysBlack = false;
                // =======================================================

                state.gameList = [{ info: infoData, node: nodeData }];
                
                // 5. Import động các Module để thực thi lệnh
                const [gameModule, ioModule, stateModule] = await Promise.all([
                    import('./game.js'),
                    import('./io.js'),
                    import('./state.js')
                ]);
                
                stateModule.storage.saveSystem(state.appSettings); // Lưu Setting
                gameModule.forceStopAIPlayers(); // Hủy các luồng AI đang chạy
                gameModule.loadGameFromList(0); // Nạp ván cờ lên giao diện
                
                // Vì mode hiện tại đã là 'analyze', hàm này sẽ tự động đè ván cờ vào "analyze_workspace"
                ioModule.saveGameState(); 
                
                closeModal('library-modal');
                renderLibGamesList(selectedLibraryCollectionId);

                // Tự động chuyển tab sang Biên Bản Ván Cờ để xem danh sách nước đi
                const historyTabBtn = document.querySelector('#panel-history .lower-tab-btn[data-tab="history"]');
                if (historyTabBtn) historyTabBtn.click();
                showToast("✅ Đã mở ván cờ!");
            } else {
                showToast("❌ File lỗi hoặc không hợp lệ!");
            }
        } else {
            showToast("❌ Không tìm thấy ván cờ (Đã bị xóa?)");
        }
    } catch(e) { showToast("❌ Lỗi khi đọc dữ liệu!"); }
    hideLoading();
}

// Logic Xác nhận Xóa ván cờ
export async function confirmDeleteLibraryItem() {
    closeModal('delete-lib-modal');
    showLoading("Đang xóa...");
    try {
        if (pendingDeleteCollectionId) {
            const { colId, colName } = pendingDeleteCollectionId;
            let list = await getWorkspace('library_workspace') || [];
            let toDelete = [];
            
            if (colId === "folder_path") {
                // Xóa thư mục cha trung gian và tất cả thư mục con bên trong
                toDelete = list.filter(item => 
                    item.collection_name && 
                    (item.collection_name === colName || item.collection_name.startsWith(colName + '/'))
                );
                list = list.filter(item => 
                    !item.collection_name || 
                    (item.collection_name !== colName && !item.collection_name.startsWith(colName + '/'))
                );
            } else {
                // Xóa 1 bộ sưu tập lá
                toDelete = list.filter(item => 
                    (colId === 'default_col') ? !item.collection_id : (item.collection_id === colId)
                );
                list = list.filter(item => 
                    (colId === 'default_col') ? !!item.collection_id : (item.collection_id !== colId)
                );
            }

            // Xóa các file ván cờ thật sự khỏi IndexedDB
            for (let item of toDelete) {
                await deleteWorkspace(item.id_key);
            }
            await saveWorkspace('library_workspace', list);
            showToast("✅ Đã xóa thư mục/bộ sưu tập thành công!");

        } else if (pendingDeleteLibId) {
            // Xóa 1 ván cờ đơn lẻ
            await deleteWorkspace(pendingDeleteLibId);
            let list = await getWorkspace('library_workspace') || [];
            list = list.filter(item => item.id_key !== pendingDeleteLibId);
            await saveWorkspace('library_workspace', list);
            showToast("✅ Đã xóa ván cờ thành công!");
        }
        
        await renderLibraryList();
    } catch(e) {
        console.error(e);
        showToast("❌ Lỗi trong quá trình xóa!");
    }
    hideLoading();
}

// ==========================================
// CÂY THƯ VIỆN DÀNH CHO LUYỆN NHỚ VÁN
// ==========================================
let memoExpandedCollections = new Set();

export async function renderMemorizeList() {
    showLoading("Đang tải thư viện...");
    const rawList = await getWorkspace('library_workspace') || [];
    const container = document.getElementById('memo-list-container');
    const emptyText = document.getElementById('memo-empty-text');

    if (!container) {
        hideLoading();
        return;
    }

    if (rawList.length === 0) {
        if (emptyText) emptyText.style.display = 'block';
        container.innerHTML = '';
        hideLoading();
        return;
    } else {
        if (emptyText) emptyText.style.display = 'none';
    }

    // Gom nhóm ván cờ theo bộ thư viện
    const collectionsMap = new Map();
    rawList.forEach(item => {
        const colName = item.collection_name || "Ván Tự Lưu";
        const colId = item.collection_id || "default_col";
        if (!collectionsMap.has(colId)) {
            collectionsMap.set(colId, {
                id: colId,
                name: colName,
                items: []
            });
        }
        collectionsMap.get(colId).items.push(item);
    });

    if (memoExpandedCollections.size === 0 && collectionsMap.size > 0) {
        const firstColId = collectionsMap.keys().next().value;
        memoExpandedCollections.add(firstColId);
    }

    let html = '';
    collectionsMap.forEach((col, colId) => {
        const isExpanded = memoExpandedCollections.has(colId);
        const iconArrow = isExpanded ? '▼' : '▶';

        html += `
            <div class="lib-folder-block" data-colid="${colId}">
                <div class="lib-folder-header" data-action="memo-toggle-folder" data-colid="${colId}">
                    <div class="lib-folder-title-area">
                        <span class="lib-folder-arrow">${iconArrow}</span>
                        <span class="lib-folder-icon">📁</span>
                        <strong class="lib-folder-name">${col.name}</strong>
                        <span class="lib-folder-count">(${col.items.length} ván)</span>
                    </div>
                </div>
                ${isExpanded ? `
                <div class="lib-folder-children">
                    ${col.items.map((game, idx) => `
                        <div class="lib-game-item memo-game-item" data-idkey="${game.id_key}" data-filename="${game.file_name}">
                            <div class="lib-game-info">
                                <span class="lib-game-idx">${idx + 1}.</span>
                                <span class="lib-game-title">${game.file_name}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>` : ''}
            </div>`;
    });

    container.innerHTML = html;

    // Sự kiện Click chọn ván cờ hoặc đóng/mở thư mục
    container.onclick = async (e) => {
        const toggleArea = e.target.closest('[data-action="memo-toggle-folder"]');
        if (toggleArea) {
            const cid = toggleArea.dataset.colid;
            if (memoExpandedCollections.has(cid)) memoExpandedCollections.delete(cid);
            else memoExpandedCollections.add(cid);
            renderMemorizeList();
            return;
        }

        const gameItem = e.target.closest('.memo-game-item');
        if (gameItem) {
            showLoading("Đang nạp ván đấu...");
            try {
                const textData = await getWorkspace(gameItem.dataset.idkey);
                if (textData) {
                    const nodeData = vschess.dataToNode(textData);
                    const infoData = vschess.dataToInfo(textData);
                    if (nodeData && nodeData.fen) {
                        state.pendingMemorizeData = { node: nodeData, info: infoData };
                        closeModal('memorize-modal');
                        openModal('memorize-setup-modal');
                    } else showToast("❌ File hỏng!");
                }
            } catch (err) {
                console.error("Lỗi nạp ván luyện nhớ:", err);
            }
            hideLoading();
            return;
        }
    };

    hideLoading();
}

export function syncBookTabUI() {
    const typeSelect = document.getElementById('book-type-select');
    if (typeSelect) {
        // Lấy setting từ state (đã được nạp từ localStorage ở state.js)
        const currentType = state.appSettings.bookType || 'cloud';
        typeSelect.value = currentType;

        const cloudTab = document.querySelector('.ai-tab-btn[data-tab="cloudbook"]');
        if (cloudTab) {
            cloudTab.innerText = currentType === 'local' ? "Local Book" : "Cloud Book";
        }
    }
}