// js/io.js
import { showToast, showLoading, hideLoading, closeModal, openModal, updateTurnToggleUI } from './ui.js';
import { state, storage } from './state.js';
import { defaultGameInfo } from './config.js';
import { loadGameFromList, initGame} from './game.js';
import { saveWorkspace } from './db.js';
import { turnOnEditMode } from './editor.js';
import { renderBoardFull, renderMoveHistory, clearArrow } from './board.js';

export function formatGameInfoString(info, rootCommentText) {
    let str = "";
    let titleStr = (info.title || "").replace(/Tượng Kỳ Việt/g, "Sơn 9.3");
    if (!titleStr) titleStr = "Sơn 9.3";
    let authorStr = (info.author || "").replace(/Tượng Kỳ Việt/g, "Sơn 9.3");
    if (!authorStr) authorStr = "Sơn 9.3";

    str += `Tiêu đề: ${titleStr}\n`;
    if (info.result) {
        const resMap = {"1-0": "Đỏ thắng", "0-1": "Đen thắng", "1/2-1/2": "Hòa", "*": "Chưa rõ/Đang đánh"};
        str += `Kết quả: ${resMap[info.result] || info.result}\n`;
    }
    str += `Tác giả: ${authorStr}\n`;
    if (str !== "") str += `-------------------\n`;
    if (rootCommentText) str += rootCommentText.replace(/Tượng Kỳ Việt/g, "Sơn 9.3");
    return str;
}

export function mergeGameInfo(infoData) {
    if (!infoData) return Object.assign({}, defaultGameInfo);
    let mergedInfo = {};
    for (let key in defaultGameInfo) {
        mergedInfo[key] = infoData[key] ? infoData[key] : defaultGameInfo[key];
    }
    return mergedInfo;
}

export function getFormattedDate() {
    const d = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${pad(d.getDate())}${pad(d.getMonth()+1)}${d.getFullYear()}`;
}

export function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast("✅ Đã sao chép vào bộ nhớ tạm!")).catch(() => showToast("❌ Lỗi Copy!"));
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        try { document.execCommand('copy'); showToast("✅ Đã sao chép vào bộ nhớ tạm!"); } catch (err) { showToast("❌ Lỗi Copy!"); }
        document.body.removeChild(textArea);
    }
}

export function downloadFile(filename, content, isBinary = false) {
    let blob;
    if (isBinary) {
        blob = new Blob([new Uint8Array(content)], { type: "application/octet-stream" });
    } else {
        blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(`✅ Đã tải tệp ${filename} thành công!`);
}

export function createCBLBinaryFromGames(gamesList) {
    const headerBuf = new Uint8Array(66560);
    const headerStr = "CCBridgeLibrary";
    for (let i = 0; i < headerStr.length; i++) {
        headerBuf[i] = headerStr.charCodeAt(i);
    }

    let chunks = [headerBuf];
    let totalLen = headerBuf.length;

    for (let g of gamesList) {
        let vsNode = null;
        let info = g.info || {};

        if (g.dataText) {
            vsNode = vschess.dataToNode(g.dataText);
        } else if (g.node) {
            vsNode = g.node;
        }

        if (vsNode) {
            if (!info.title && g.file_name) info.title = g.file_name;
            if (!info.group && g.collection_name && g.collection_name !== "Ván Tự Lưu") {
                info.group = g.collection_name;
            }
            const cbrArray = vschess.nodeToBinary_CBR(vsNode, info, false);
            if (cbrArray && cbrArray.length > 0) {
                chunks.push(new Uint8Array(cbrArray));
                totalLen += cbrArray.length;
            }
        }
    }

    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (let chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

export function getMoveListAndComments() {
    let moves = [];
    let comments = [state.rootNode.comment || ""];
    let temp = state.rootNode;
    while(temp.children.length > 0) {
        temp = temp.children[temp.mainLineIndex];
        moves.push(temp.moveCommand);
        comments.push(temp.comment || "");
    }
    return { moves, comments };
}

export function getVschessNodeTree(node) {
    if (!node) return null;
    let vNode = {
        id: node.id || "",
        fen: node.fen,
        comment: node.comment || "",
        move: node.moveCommand || "", 
        defaultIndex: 0,
        moveFlag: node.moveFlag || "",
        next: []
    };
    for (let i = 0; i < node.children.length; i++) {
        vNode.next.push(getVschessNodeTree(node.children[i]));
    }
    return vNode;
}

export function serializeMoveTree() {
    if (!state.rootNode) return "";
    const vNode = getVschessNodeTree(state.rootNode);
    return vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
}

export function serializeMoveTreePtr() {
    if (!state.currentNode) return null;
    return JSON.stringify({
        fen: state.currentNode.fen,
        move: state.currentNode.moveCommand,
        id: state.currentNode.id
    });
}

let saveTimeout = null;
let isSaving = false;

export async function saveGameState() {
    if (isSaving || state.isEditMode || state.gameList.length === 0 || state.appMode === 'memorize' || state.appMode === 'puzzle') return;
    isSaving = true;
    
    try {
        // LƯU TRỰC TIẾP Object trên RAM vào mảng (IndexedDB sẽ dùng Structured Clone tự lưu vòng)
        // Không gọi stripTree nữa, thời gian nén = 0 ms!
        state.gameList[state.currentGameIndex].node = state.rootNode;
        state.gameList[state.currentGameIndex].info = state.currentGameInfo;
        
        const workspaceData = {
            mode: state.appMode,
            gameList: state.gameList, 
            currentIndex: state.currentGameIndex,
            ptrId: state.currentNode.id
        };

        let dbKey = 'analyze_workspace';
        if (state.appMode === 'vsbot') dbKey = 'vsbot_workspace';
        else if (state.appMode === 'blind') dbKey = 'blind_workspace';
        
        await saveWorkspace(dbKey, workspaceData);

        storage.saveSystem(state.appSettings);
    } catch (e) {
        console.error("Lỗi khi Auto-Save IndexedDB:", e);
    } finally {
        isSaving = false;
    }
}

export function handleFileUpload(file) {
    if (state.isEditMode) { showToast("❌ Vui lòng tắt chế độ Xếp quân trước khi tải ván đấu!"); return; }
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    const validBinary = ['xqf', 'cbr', 'ccm', 'cbl','CBL'];
    const validText = ['pgn', 'pfc', 'che'];
    
    showLoading(`Đang đọc tệp ${file.name}...`);

    if (validBinary.includes(extension)) {
        reader.onload = (e) => {
            try {
                const buffer = new Uint8Array(e.target.result);
                state.gameList = []; // XÓA LIST CŨ

                if (extension === 'cbl' || extension === 'CBL') {
                    // XỬ LÝ FILE ĐA VÁN ĐẤU
                    const cblData = vschess.binaryToBook_CBL(buffer);
                    if (cblData && cblData.books && cblData.books.length > 0) {
                        state.gameList = cblData.books; // Gán toàn bộ mảng 100 ván vào State
                    }
                } else {
                    // XỬ LÝ FILE 1 VÁN
                    let nodeData, infoData;
                    if (extension === 'xqf') { nodeData = vschess.binaryToNode_XQF(buffer); infoData = vschess.binaryToInfo_XQF(buffer); }
                    else if (extension === 'cbr') { nodeData = vschess.binaryToNode_CBR(buffer); infoData = vschess.binaryToInfo_CBR(buffer); }
                    else if (extension === 'ccm') { nodeData = vschess.binaryToNode_CCM(buffer); }
                    
                    if (nodeData && nodeData.fen) {
                        state.gameList = [{ info: infoData, node: nodeData }]; // Bọc thành mảng 1 ván
                    }
                }

                if (state.gameList.length > 0) {
                    loadGameFromList(0); // Load ván đầu tiên lên RAM
                    saveGameState(); // Auto-save xuống IndexedDB
                    closeModal('import-modal');
                    showToast(`✅ Tải thành công ${state.gameList.length} ván đấu!`);
                } else { 
                    showToast("❌ Lỗi đọc File (File hỏng hoặc trống)!"); 
                }
            } catch (error) { showToast("❌ Có lỗi xảy ra khi giải mã File!"); }
            hideLoading();
        };
        reader.readAsArrayBuffer(file);
    } else if (validText.includes(extension)) {
        reader.onload = (e) => {
            try {
                const textData = e.target.result;
                let nodeData, infoData;
                if (extension === 'pgn') { nodeData = vschess.dataToNode_PGN(textData); infoData = vschess.dataToInfo_PGN(textData); }
                else if (extension === 'pfc') { nodeData = vschess.dataToNode_PFC(textData); infoData = vschess.dataToInfo_PFC(textData); }
                else if (extension === 'che') { nodeData = vschess.dataToNode_QQNew(textData); }
                if (nodeData && nodeData.fen) {
                    // SỬA Ở ĐÂY: Reset gameList và nạp ván mới dạng Object thô
                    state.gameList = [{ info: infoData, node: nodeData }];
                    loadGameFromList(0); // Nạp ván đầu tiên lên RAM
                    
                    closeModal('import-modal');
                    saveGameState(); // Lưu ngầm xuống IndexedDB
                    showToast("✅ Tải file Văn Bản thành công!");
                } else { showToast("❌ Lỗi đọc File Text (File hỏng)!"); }
            } catch (error) { showToast("❌ Có lỗi xảy ra khi phân tích File!"); }
            hideLoading();
        };
        reader.readAsText(file);
    } else {
        hideLoading();
        showToast(`❌ Định dạng .${extension} không được hỗ trợ!`);
    }
}

export async function importFileToLibrary(file) {
    if (!file) return;
    const filename = file.name;
    const extension = filename.split('.').pop().toLowerCase();
    const collectionName = filename.replace(/\.[^/.]+$/, "");
    const collectionId = 'col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    showLoading(`Đang nạp ${filename} vào Thư Viện...`);
    const reader = new FileReader();

    const validBinary = ['xqf', 'cbr', 'ccm', 'cbl'];
    const validText = ['pgn', 'pfc', 'che', 'json'];
    const { fastWireTree } = await import('./game.js');
    const { getWorkspace, saveWorkspace } = await import('./db.js');

    if (validBinary.includes(extension)) {
        reader.onload = async (e) => {
            try {
                const buffer = new Uint8Array(e.target.result);
                let gamesToSave = [];

                if (extension === 'cbl') {
                    const cblData = vschess.binaryToBook_CBL(buffer);
                    if (cblData && cblData.books && cblData.books.length > 0) {
                        gamesToSave = cblData.books;
                    }
                } else {
                    let nodeData, infoData;
                    if (extension === 'xqf') { nodeData = vschess.binaryToNode_XQF(buffer); infoData = vschess.binaryToInfo_XQF(buffer); }
                    else if (extension === 'cbr') { nodeData = vschess.binaryToNode_CBR(buffer); infoData = vschess.binaryToInfo_CBR(buffer); }
                    else if (extension === 'ccm') { nodeData = vschess.binaryToNode_CCM(buffer); }
                    
                    if (nodeData && nodeData.fen) {
                        gamesToSave = [{ info: infoData, node: nodeData }];
                    }
                }

                if (gamesToSave.length > 0) {
                    let libraryList = await getWorkspace('library_workspace') || [];
                    let addedCount = 0;

                    for (let g of gamesToSave) {
                        let vNode = fastWireTree(g.node, null);
                        if (!vNode) continue;
                        let title = (g.info && g.info.title) ? g.info.title : file.name.replace(/\.[^/.]+$/, "");
                        if (gamesToSave.length > 1 && (!g.info || !g.info.title)) {
                            title = `${title} (${addedCount + 1})`;
                        }
                        let vsNode = getVschessNodeTree(vNode);
                        const gameDataText = vschess.nodeToData_DhtmlXQ(vsNode, g.info || {}, false);
                        const idKey = 'lib_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                        await saveWorkspace(idKey, gameDataText);
                        let targetColName = collectionName;
                        let targetColId = collectionId;
                        if (g.info && (g.info.group || g.info.event)) {
                            const subGroup = (g.info.group || g.info.event).trim().replace(/\\/g, '/');
                            if (subGroup && subGroup !== '.') {
                                targetColName = `${collectionName}/${subGroup}`;
                                targetColId = 'col_' + btoa(unescape(encodeURIComponent(targetColName))).replace(/=/g, '');
                            }
                        }

                        libraryList.push({ 
                            id_key: idKey, 
                            file_name: title,
                            collection_id: targetColId,
                            collection_name: targetColName
                        });
                        addedCount++;
                    }

                    await saveWorkspace('library_workspace', libraryList);
                    const { renderLibraryList } = await import('./ui.js');
                    await renderLibraryList();
                    showToast(`✅ Đã nạp thành công ${addedCount} ván vào Thư Viện!`);
                } else {
                    showToast("❌ Không thể đọc ván đấu từ file!");
                }
            } catch (err) {
                console.error("Lỗi nạp thư viện:", err);
                showToast("❌ Có lỗi xảy ra khi nạp file vào Thư Viện!");
            }
            hideLoading();
        };
        reader.readAsArrayBuffer(file);
    } else if (validText.includes(extension)) {
        reader.onload = async (e) => {
            try {
                const textData = e.target.result;
                let gamesToSave = [];

                if (extension === 'json') {
                    // XỬ LÝ FILE GÓI THƯ MỤC KYPO (BUNDLE JSON)
                    const packData = JSON.parse(textData);
                    if (Array.isArray(packData) && packData.length > 0 && packData[0].path && packData[0].data) {
                        let libraryList = await getWorkspace('library_workspace') || [];
                        let addedCount = 0;
                        const folderMap = new Map();

                        const total = packData.length;
                        let index = 0;

                        async function processChunk() {
                            const chunkSize = 200; // Xử lý 200 file mỗi lô
                            const end = Math.min(index + chunkSize, total);
                            showLoading(`Đang trích xuất: ${index}/${total} ván cờ...`);

                            for (let i = index; i < end; i++) {
                                const item = packData[i];
                                const itemPath = item.path;
                                const base64Data = item.data;

                                const parts = itemPath.split('/');
                                const fileName = parts.pop();
                                const relativeDir = parts.length > 0 ? parts.join('/') : "";

                                // Tên thư mục cha tổng (gốc) dựa theo tên tệp gói JSON
                                const masterFolderName = collectionName.replace(/_pack$/i, "");
                                let colName = relativeDir ? `${masterFolderName}/${relativeDir}` : masterFolderName;
                                let colId = "";
                                if (!folderMap.has(colName)) {
                                    colId = 'col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                                    folderMap.set(colName, { colId, colName });
                                } else {
                                    const folderInfo = folderMap.get(colName);
                                    colId = folderInfo.colId;
                                    colName = folderInfo.colName;
                                }

                                // Base64 to binary
                                const binaryString = atob(base64Data);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let k = 0; k < binaryString.length; k++) {
                                    bytes[k] = binaryString.charCodeAt(k);
                                }

                                const itemExt = fileName.split('.').pop().toLowerCase();
                                let parsedGames = [];

                                if (itemExt === 'cbl') {
                                    const cblData = vschess.binaryToBook_CBL(bytes);
                                    if (cblData && cblData.books && cblData.books.length > 0) {
                                        parsedGames = cblData.books;
                                    }
                                } else if (itemExt === 'xqf') {
                                    const nodeData = vschess.binaryToNode_XQF(bytes);
                                    const infoData = vschess.binaryToInfo_XQF(bytes);
                                    if (nodeData) {
                                        if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                                        parsedGames = [{ info: infoData, node: nodeData }];
                                    }
                                } else if (itemExt === 'cbr') {
                                    const nodeData = vschess.binaryToNode_CBR(bytes);
                                    const infoData = vschess.binaryToInfo_CBR(bytes);
                                    if (nodeData) {
                                        if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                                        parsedGames = [{ info: infoData, node: nodeData }];
                                    }
                                } else if (itemExt === 'ccm') {
                                    const nodeData = vschess.binaryToNode_CCM(bytes);
                                    if (nodeData) {
                                        if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                                        parsedGames = [{ info: null, node: nodeData }];
                                    }
                                } else if (itemExt === 'pgn') {
                                    let textStr = "";
                                    try {
                                        textStr = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
                                    } catch (e) {
                                        textStr = String.fromCharCode.apply(null, bytes);
                                    }
                                    let pgnBlocks = textStr.split(/(?=\[Event\s+)/i).filter(b => b.trim().length > 0);
                                    if (pgnBlocks.length === 0) pgnBlocks = [textStr];
                                    for (let block of pgnBlocks) {
                                        let cleanBlock = block;
                                        if (!cleanBlock.includes('[Format')) {
                                            if (/[a-i]\d-?[a-i]\d/i.test(cleanBlock)) {
                                                cleanBlock = '[Format "ICCS"]\n' + cleanBlock;
                                            } else if (/[A-Z][0-9\.\+-]/i.test(cleanBlock)) {
                                                cleanBlock = '[Format "WXF"]\n' + cleanBlock;
                                            }
                                        }
                                        let nodeData = vschess.dataToNode_PGN(cleanBlock);
                                        let infoData = vschess.dataToInfo_PGN(cleanBlock);
                                        if (nodeData) {
                                            if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                                            parsedGames.push({ info: infoData, node: nodeData });
                                        }
                                    }
                                }

                                for (let g of parsedGames) {
                                    let vNode = fastWireTree(g.node, null);
                                    if (!vNode) continue;
                                    let title = (g.info && g.info.title) ? g.info.title : fileName.replace(/\.[^/.]+$/, "");
                                    if (parsedGames.length > 1 && (!g.info || !g.info.title)) {
                                        title = `${title} (${parsedGames.indexOf(g) + 1})`;
                                    }
                                    let vsNode = getVschessNodeTree(vNode);
                                    const gameDataText = vschess.nodeToData_DhtmlXQ(vsNode, g.info || {}, false);
                                    const idKey = 'lib_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                                    await saveWorkspace(idKey, gameDataText);

                                    libraryList.push({
                                        id_key: idKey,
                                        file_name: title,
                                        collection_id: colId,
                                        collection_name: colName
                                    });
                                    addedCount++;
                                }
                            }

                            index = end;
                            if (index < total) {
                                setTimeout(processChunk, 0);
                            } else {
                                await saveWorkspace('library_workspace', libraryList);
                                const { renderLibraryList } = await import('./ui.js');
                                await renderLibraryList();
                                showToast(`✅ Đã giải nén và nạp thành công ${addedCount} ván vào Thư Viện!`);
                                hideLoading();
                            }
                        }

                        await processChunk();
                        return;
                    } else {
                        showToast("❌ Định dạng gói JSON không hợp lệ!");
                        hideLoading();
                        return;
                    }
                }

                if (extension === 'pgn') {
                    let cleanText = textData;
                    if (!cleanText.includes('[Format')) {
                        if (/[a-i]\d-?[a-i]\d/i.test(cleanText)) {
                            cleanText = '[Format "ICCS"]\n' + cleanText;
                        } else if (/[A-Z][0-9\.\+-]/i.test(cleanText)) {
                            cleanText = '[Format "WXF"]\n' + cleanText;
                        }
                    }
                    let pgnBlocks = cleanText.split(/(?=\[Event\s+)/i).filter(b => b.trim().length > 0);
                    if (pgnBlocks.length === 0) pgnBlocks = [cleanText];
                    
                    for (let block of pgnBlocks) {
                        let nodeData = vschess.dataToNode_PGN(block);
                        let infoData = vschess.dataToInfo_PGN(block);
                        if (nodeData) {
                            if (!nodeData.fen) nodeData.fen = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
                            gamesToSave.push({ info: infoData, node: nodeData });
                        }
                    }
                } else {
                    let nodeData, infoData;
                    if (extension === 'pfc') { nodeData = vschess.dataToNode_PFC(textData); infoData = vschess.dataToInfo_PFC(textData); }
                    else if (extension === 'che') { nodeData = vschess.dataToNode_QQNew(textData); }
                    if (nodeData && nodeData.fen) {
                        gamesToSave.push({ info: infoData, node: nodeData });
                    }
                }

                if (gamesToSave.length > 0) {
                    let libraryList = await getWorkspace('library_workspace') || [];
                    let addedCount = 0;

                    for (let g of gamesToSave) {
                        let vNode = fastWireTree(g.node, null);
                        if (!vNode) continue;
                        let title = (g.info && g.info.title) ? g.info.title : file.name.replace(/\.[^/.]+$/, "");
                        if (gamesToSave.length > 1 && (!g.info || !g.info.title)) {
                            title = `${title} (${addedCount + 1})`;
                        }
                        let vsNode = getVschessNodeTree(vNode);
                        const gameDataText = vschess.nodeToData_DhtmlXQ(vsNode, g.info || {}, false);
                        const idKey = 'lib_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                        await saveWorkspace(idKey, gameDataText);
                        libraryList.push({ 
                            id_key: idKey, 
                            file_name: title,
                            collection_id: collectionId,
                            collection_name: collectionName
                        });
                        addedCount++;
                    }

                    await saveWorkspace('library_workspace', libraryList);
                    const { renderLibraryList } = await import('./ui.js');
                    await renderLibraryList();
                    showToast(`✅ Đã nạp thành công ${addedCount} ván vào Thư Viện!`);
                } else {
                    showToast("❌ Không tìm thấy dữ liệu ván cờ hợp lệ!");
                }
            } catch (err) {
                console.error("Lỗi nạp thư viện:", err);
                showToast("❌ Lỗi giải mã tệp văn bản!");
            }
            hideLoading();
        };
        reader.readAsText(file);
    } else {
        hideLoading();
        showToast(`❌ Định dạng .${extension} không được hỗ trợ!`);
    }
}

// Hàm nén ảnh trước khi gửi lên Server
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.8) {
    return new Promise((resolve) => {
        // Chỉ xử lý nếu file là ảnh, nếu không trả về file gốc
        if (!file.type.startsWith('image/')) {
            return resolve(file);
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            // Giải phóng bộ nhớ ngay sau khi load xong ảnh
            URL.revokeObjectURL(objectUrl);

            let { width, height } = img;

            // Tính toán kích thước mới giữ nguyên tỷ lệ khung hình
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // Tạo canvas ảo
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            // Vẽ ảnh lên canvas
            ctx.drawImage(img, 0, 0, width, height);

            // Xuất file ảnh JPEG với chất lượng 0.8
            canvas.toBlob((blob) => {
                if (!blob) {
                    return resolve(file); // Trả về file gốc nếu tạo blob thất bại
                }
                
                // Đổi đuôi file thành .jpg
                const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                const compressedFile = new File([blob], newFileName, {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                });
                
                resolve(compressedFile); // Trả về file đã nén
            }, 'image/jpeg', quality);
        };

        img.onerror = () => {
            // Xử lý giải phóng bộ nhớ và trả về file gốc nếu lỗi
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}

export async function handleImageRecognition(file) {
    if (state.isEditMode) { showToast("❌ Vui lòng tắt chế độ Xếp quân trước khi quét ảnh!"); return; }
    if (!navigator.onLine) { showToast("❌ Bạn đang Offline! Cần kết nối Internet để quét ảnh."); return; }
    if (!file) return;

    showLoading("Đang nén và quét ảnh bằng AI...");
    
    // Gọi hàm nén ảnh trước khi nạp vào FormData
    const compressedFile = await compressImage(file, 1920, 1920, 0.8);

    const formData = new FormData(); 
    // Sử dụng compressedFile thay vì file gốc
    formData.append('image', compressedFile);

    fetch('/api/pikafish-recognize', { method: 'POST', body: formData })
    .then(res => res.json())
    .then(result => {
        if (result && result.data && result.data.fen) {
            let fen = result.data.fen;
            if (!fen.includes(' w ') && !fen.includes(' b ')) {
                fen += " w - - 0 1"; 
            }
            
            closeModal('import-modal');

            // LƯU LẠI THÔNG TIN VÁN CỜ CŨ TRƯỚC KHI GHI ĐÈ ẢNH QUÉT
            const trueOriginalFen = state.currentNode.fen;
            const trueOriginalNode = state.currentNode;
            const trueOriginalStepNum = state.currentStepNum;

            // Ghi đè bàn cờ bằng cách cập nhật gameList hiện tại
            let rawNode = { fen: fen, comment: "", next: [], defaultIndex: 0 };
            state.gameList = [{ info: Object.assign({}, defaultGameInfo), node: rawNode }]; 
            loadGameFromList(0); 
            clearArrow();
            
            // Ép hệ thống chuyển sang chế độ Xếp quân
            const btn = document.getElementById('btn-edit');
            if(!state.isEditMode) {
                state.isEditMode = true;
                btn.classList.add('tool-active');
                document.body.classList.add('edit-mode');
                document.getElementById('btn-clear-board').style.display = 'flex';
                
                const btnUndo = document.getElementById('btn-undo');
                if(btnUndo) btnUndo.style.setProperty('display', 'none', 'important');
                const btnHint = document.getElementById('btn-hint');
                if(btnHint) btnHint.style.setProperty('display', 'none', 'important');
                
                if(window.innerWidth > window.innerHeight) {
                    document.getElementById('piece-palette-pc').style.display = 'flex';
                } else {
                    document.getElementById('piece-palette-mobile').style.display = 'flex';
                }
            }

            // Gán dữ liệu so sánh cho trình Editor
            state.preEditFenBase = trueOriginalFen.split(" ")[0];
            state.preEditTurn = trueOriginalFen.split(" ")[1] || 'w';
            state.preEditNode = trueOriginalNode;
            state.preEditStepNum = trueOriginalStepNum;
            
            state.editTurn = fen.split(" ")[1] || 'w';
            updateTurnToggleUI();
            
            renderBoardFull(state.currentSituation);
            renderMoveHistory();
            saveGameState();
            
            showToast("📸 Đã nhận diện! Vui lòng chỉnh sửa (nếu có lỗi) rồi nhấn nút Xếp Quân để bắt đầu.");
        } else {
            showToast("❌ Lỗi nhận diện từ AI: " + (result.msg || "Không tìm thấy bàn cờ hợp lệ"));
        }
    })
    .catch(err => { showToast("❌ Lỗi: Máy chủ nhận diện không phản hồi."); })
    .finally(() => { hideLoading(); });
}

export async function saveCurrentGameToLibrary() {
    if (!state.rootNode) {
        showToast("❌ Chưa có ván đấu để lưu!");
        return;
    }

    const { getWorkspace, saveWorkspace } = await import('./db.js');
    const { renderLibraryList } = await import('./ui.js');

    if (!state.activeLibraryGameId) {
        // Chưa mở từ thư viện -> Lưu thành ván mới trong thư mục mặc định "Ván Tự Lưu"
        showLoading("Đang lưu ván mới vào thư viện...");
        try {
            let libraryList = await getWorkspace('library_workspace') || [];
            
            // Biên dịch cây nước đi
            const vsNode = getVschessNodeTree(state.rootNode);
            
            // Xử lý đính kèm Flag vào comment trước khi tạo string DhtmlXQ
            function injectFlags(node) {
                if (!node) return;
                const originalComment = node.comment || "";
                if (node.moveFlag === 'strong') {
                    node.comment = `[Flag:Strong]${originalComment}`;
                } else if (node.moveFlag === 'weak') {
                    node.comment = `[Flag:Weak]${originalComment}`;
                }
                if (node.next) {
                    for (let n of node.next) injectFlags(n);
                }
            }
            injectFlags(vsNode);
            
            const gameDataText = vschess.nodeToData_DhtmlXQ(vsNode, state.currentGameInfo, false);
            
            const idKey = 'lib_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            await saveWorkspace(idKey, gameDataText);
            
            const title = state.currentGameInfo.title || `Ván Tự Lưu ${getFormattedDate()}`;
            libraryList.push({
                id_key: idKey,
                file_name: title,
                collection_id: "default_col",
                collection_name: "Ván Tự Lưu"
            });
            
            await saveWorkspace('library_workspace', libraryList);
            state.activeLibraryGameId = idKey;

            // Cập nhật RAM gameList nếu đang mở ván cờ này
            if (state.currentGameIndex !== null && state.gameList[state.currentGameIndex]) {
                const { fastWireTree } = await import('./game.js');
                state.gameList[state.currentGameIndex].node = fastWireTree(vsNode, null);
                state.gameList[state.currentGameIndex].info = Object.assign({}, state.currentGameInfo);
            }
            
            await renderLibraryList();
            showToast("✅ Đã lưu ván cờ mới vào Thư Viện!");
        } catch (err) {
            console.error(err);
            showToast("❌ Lỗi khi lưu ván mới!");
        }
        hideLoading();
        return;
    }

    // Trường hợp ghi đè ván cờ hiện tại
    showLoading("Đang lưu thay đổi...");
    try {
        let libraryList = await getWorkspace('library_workspace') || [];
        const item = libraryList.find(i => i.id_key === state.activeLibraryGameId);
        
        // Đảm bảo cập nhật title/file_name nếu có thay đổi trong currentGameInfo
        if (item && state.currentGameInfo.title) {
            item.file_name = state.currentGameInfo.title;
        }

        // Tạo cấu trúc vsNode với Flag được đính kèm vào comment
        const vsNode = getVschessNodeTree(state.rootNode);
        
        function injectFlags(node) {
            if (!node) return;
            const originalComment = node.comment || "";
            if (node.moveFlag === 'strong') {
                node.comment = `[Flag:Strong]${originalComment}`;
            } else if (node.moveFlag === 'weak') {
                node.comment = `[Flag:Weak]${originalComment}`;
            }
            if (node.next) {
                for (let n of node.next) injectFlags(n);
            }
        }
        injectFlags(vsNode);

        const gameDataText = vschess.nodeToData_DhtmlXQ(vsNode, state.currentGameInfo, false);
        
        // Lưu đè dữ liệu ván đấu
        await saveWorkspace(state.activeLibraryGameId, gameDataText);
        
        // Lưu lại danh mục thư viện
        await saveWorkspace('library_workspace', libraryList);

        // Cập nhật RAM gameList nếu đang mở ván cờ này
        if (state.currentGameIndex !== null && state.gameList[state.currentGameIndex]) {
            const { fastWireTree } = await import('./game.js');
            state.gameList[state.currentGameIndex].node = fastWireTree(vsNode, null);
            state.gameList[state.currentGameIndex].info = Object.assign({}, state.currentGameInfo);
        }
        
        await renderLibraryList();
        showToast("✅ Đã lưu thay đổi vào Thư Viện!");
    } catch (err) {
        console.error(err);
        showToast("❌ Lỗi khi lưu thay đổi!");
    }
    hideLoading();
}