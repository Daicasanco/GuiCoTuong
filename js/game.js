// js/game.js
import { state, storage } from './state.js';
import { START_FEN, defaultGameInfo } from './config.js';
import { getWorkspace, saveWorkspace } from './db.js';
import { openModal, showToast, renderGameList,hideAILoading } from './ui.js';
import { renderBoardFull, clearDots, drawLastMoveDots, renderMoveHistory, clearArrow, startCanvasAnimation } from './board.js';
import { initPikafish, triggerEngineEvaluation } from './engine.js'; // Đã xóa fetchCloudBook ở đây
import { handleEditSquareClick } from './editor.js';
import { formatGameInfoString, mergeGameInfo, saveGameState } from './io.js';
import { checkDraw60Moves, getStrictLegalMoves } from './rules.js';

import { playAudio } from './audio.js';

function playSound(type) {
    if (state.appSettings && state.appSettings.sound === false) return;
    try {
        playAudio(type);
    } catch (e) {}
}

setInterval(() => {
    if (state.pendingAIMove && !state.isAnimating && !state.isAutoPlaying) {
        const move = state.pendingAIMove.trim();
        state.pendingAIMove = null; 
        
        const baseLegalMoves = vschess.legalMoveList(state.currentSituation);
        const strictMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen);

        if (baseLegalMoves.includes(move)) {
            if (strictMoves.includes(move)) {
                executeMove(move);
            } else {
                console.warn("AI đã bị chặn do cố tình vi phạm luật Cấm Chiếu 6 lần liên tiếp!");
                showToast("⚠️ AI đã bị chặn vì chiếu liên tục quá 5 lần!");
            }
        }
    }
}, 50);

function updateBotTitleBoard() {
    if (state.appMode !== 'vsbot' && state.appMode !== 'puzzle') return;
    
    const titleHeader = document.getElementById('tab-title');
    if (!titleHeader) return;
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    let isBotTurn = false;
    let titleText = "";
    let infoRows = "";
    let limitRow = ""; // Khai báo biến rỗng riêng biệt cho dòng giới hạn

    if (state.appMode === 'vsbot') {
        isBotTurn = (state.vsBotSettings.botColor === 'red' && isRedTurn) || (state.vsBotSettings.botColor === 'black' && !isRedTurn);
        titleText = "ĐẤU VS BOT";
        infoRows = `
            <div class="bot-info-row"><span>Phong cách:</span> <span class="bot-info-val">${state.vsBotSettings.botStyle === 'human' ? "Giống Người" : "Tiêu Chuẩn"}</span></div>
            <div class="bot-info-row"><span>Độ khó:</span> <span class="bot-info-val">Level ${state.vsBotSettings.level}</span></div>
        `;
    } else if (state.appMode === 'puzzle') {
        isBotTurn = (state.aiPlaysRed && isRedTurn) || (state.aiPlaysBlack && !isRedTurn);
        titleText = "GIẢI BÀI TẬP";
        
        infoRows = `
            <div class="bot-info-row" style="justify-content: center; color: #1a73e8; font-weight: bold;">
                ${state.currentPuzzleName} - Bài ${state.currentPuzzleIndex + 1}
            </div>
        `;

        // Ép kiểu về số nguyên để đảm bảo luôn tính toán đúng
        const maxMoves = parseInt(state.currentPuzzleMaxMoves, 10);
        if (!isNaN(maxMoves) && maxMoves < 100) {
            limitRow = `<div class="bot-info-row"><span>Giới hạn:</span> <span class="bot-info-val" style="color: #d32f2f;">${maxMoves} nước</span></div>`;
        }
    }

    const turnText = isBotTurn ? `<span class="bot-info-val bot-turn-ai">MÁY TÍNH</span>` : `<span class="bot-info-val bot-turn-player">BẠN ĐI</span>`;

    // Xuất HTML: Đặt biến ${limitRow} ở dưới cùng, ngay sau phần Lượt đi
    titleHeader.innerHTML = `
        <strong style="font-size: 18px; color: #333; display: block; width: 100%;">${titleText}</strong>
        <div class="bot-info-board">
            ${infoRows}
            <div class="bot-info-row"><span>Lượt đi:</span> ${turnText}</div>
            ${limitRow}
        </div>
    `;
}

export function updateBlindTurnUI() {
    if (state.appMode !== 'blind' && state.appMode !== 'memorize') return;
    
    const turnTextEl = document.getElementById('blind-turn-text');
    if (!turnTextEl) return;
    
    // Kiểm tra xem lượt đi hiện tại là Đỏ (w) hay Đen (b)
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    
    if (isRedTurn) {
        turnTextEl.innerText = "Bên Đỏ";
        turnTextEl.style.color = "#cc0000"; // Màu đỏ tươi
    } else {
        turnTextEl.innerText = "Bên Đen";
        turnTextEl.style.color = "#000000"; // Màu đen đặc
    }

    if (state.appMode === 'memorize') {
        const errRed = document.getElementById('memo-err-red');
        const errBlack = document.getElementById('memo-err-black');
        if (errRed) errRed.innerText = state.memoMistakesRed;
        if (errBlack) errBlack.innerText = state.memoMistakesBlack;
    }
}

// js/game.js

// Hàm nối dây (Wire Tree) siêu tốc - 0 mili-giây
export function fastWireTree(rawNode, parent = null) {
    if (!rawNode) return null;
    let moveCmd = rawNode.moveCommand || rawNode.move || null;
    
    // CHỈ Node Gốc (Root) mới được nhận FEN. Tất cả Node con gán NULL hết!
    let fen = parent ? null : (rawNode.fen || "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1"); 
    let notation = null;
    let isRed = fen ? (fen.split(" ")[1] === "w") : false;
    
    let roundNum = fen ? parseInt(fen.split(" ")[5]) || 1 : 1;
    if (roundNum === 0) roundNum = 1; // SỬA: Đưa dòng này XUỐNG DƯỚI dòng khai báo

    let node = createRawNode(fen, moveCmd, notation, isRed, roundNum, parent);
    if (rawNode.id) node.id = rawNode.id;
    if (rawNode.comment) node.comment = rawNode.comment;
    if (typeof rawNode.defaultIndex === 'number' && rawNode.defaultIndex >= 0) {
        node.mainLineIndex = rawNode.defaultIndex;
    } else if (typeof rawNode.mainLineIndex === 'number') {
        node.mainLineIndex = rawNode.mainLineIndex;
    } else {
        node.mainLineIndex = 0;
    }

    let childArray = rawNode.next || rawNode.children || [];
    for (let child of childArray) {
        node.children.push(fastWireTree(child, node));
    }
    return node;
}

function processLoadedGameNode(node) {
    if (!node) return;
    let comment = node.comment || "";
    if (comment.includes("Tượng Kỳ Việt")) {
        comment = comment.replace(/Tượng Kỳ Việt/g, "Sơn 9.3");
        node.comment = comment;
    }
    if (comment.startsWith('[Flag:Strong]')) {
        node.moveFlag = 'strong';
        node.comment = comment.substring(13);
    } else if (comment.startsWith('[Flag:Weak]')) {
        node.moveFlag = 'weak';
        node.comment = comment.substring(11);
    } else {
        node.moveFlag = 'normal';
    }
    if (node.children) {
        for (let child of node.children) {
            processLoadedGameNode(child);
        }
    }
}

// Hàm 3: Nạp 1 ván cờ từ gameList lên RAM (Thay thế loadTreeFromNodeData cũ)
export function loadGameFromList(index, targetPtrId = null) {
    if (state.gameList.length === 0 || !state.gameList[index]) return;
    
    state.currentGameIndex = index;
    let gameData = state.gameList[index];
    
    state.currentGameInfo = gameData.info ? Object.assign({}, gameData.info) : Object.assign({}, defaultGameInfo);
    state.rootNode = fastWireTree(gameData.node, null);
    processLoadedGameNode(state.rootNode);
    
    // Tìm lại vị trí con trỏ (Pointer) đang xem dở
    state.currentNode = state.rootNode;
    if (targetPtrId) {
        let foundNode = null;
        function findNode(node) {
            if (node.id === targetPtrId) foundNode = node;
            if (foundNode) return;
            for (let c of node.children) findNode(c);
        }
        findNode(state.rootNode);
        if (foundNode) state.currentNode = foundNode;
    }

    ensureNodeData(state.currentNode);

    let step = 0; let temp = state.currentNode;
    while(temp.parent) { step++; temp = temp.parent; }
    state.currentStepNum = step;

    state.currentSituation = vschess.fenToSituation(state.currentNode.fen); 
    state.lastMove = state.currentNode.moveCommand || null;

    state.selectedSquare = null; state.legalMoves = [];
    
    const commentBox = document.getElementById('comment-box');
    if (commentBox) commentBox.value = state.currentNode.comment;

    renderBoardFull(state.currentSituation); 
    if(!state.isEditMode) renderMoveHistory();
    renderGameList(false);
    updateBlindTurnUI();
    //if (state.appMode === 'memorize') triggerMemorizeBot();
}

export function updateVsBotToolButtons() {
    if (state.appMode !== 'vsbot' && state.appMode !== 'memorize' && state.appMode !== 'puzzle') return;
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    let isBotTurn = false;

    if (state.appMode === 'vsbot') {
        isBotTurn = (state.vsBotSettings.botColor === 'red' && isRedTurn) || (state.vsBotSettings.botColor === 'black' && !isRedTurn);
    } else if (state.appMode === 'memorize' || state.appMode === 'puzzle') {
        // GIẢI BÀI TẬP & LUYỆN NHỚ: Máy sẽ đi khi tới lượt màu quân mà máy được chỉ định cầm
        isBotTurn = (state.aiPlaysRed && isRedTurn) || (state.aiPlaysBlack && !isRedTurn);
    }

    let isMemoEnd = false;
    if (state.appMode === 'memorize') {
        const children = state.currentNode.children;
        const isSegmentEnd = (state.memorizeSettings.method === 'segment' && state.currentNode.id === state.memorizeSettings.endNodeId);
        if (children.length === 0 || isSegmentEnd) {
            isMemoEnd = true;
        }
    }
    
    const btnUndo = document.getElementById('btn-undo');
    const btnHint = document.getElementById('btn-hint');
    const btnEdit = document.getElementById('btn-edit');
    const btnImport = document.getElementById('btn-import'); 
    
    // Đã có isMemoEnd để sử dụng
    if (isBotTurn || state.isAnimating || state.isAutoPlaying || isMemoEnd) {
        if(btnUndo) btnUndo.classList.add('disabled');
        if(btnHint) btnHint.classList.add('disabled');
        if(btnEdit) btnEdit.classList.add('disabled'); 
        if(btnImport) btnImport.classList.add('disabled');
    } else {
        if(btnHint) btnHint.classList.remove('disabled');
        if(btnEdit) btnEdit.classList.remove('disabled'); 
        if(btnImport) btnImport.classList.remove('disabled');
        
        let stepCount = 0; let temp = state.currentNode;
        while(temp.parent) { stepCount++; temp = temp.parent; }

        let minSteps = 2; // Mặc định Lùi 2 bước để ăn mất nước của Bot
        if (state.appMode === 'memorize' && !state.aiPlaysRed && !state.aiPlaysBlack) minSteps = 1; 
        
        if (stepCount >= minSteps && btnUndo) {
            btnUndo.classList.remove('disabled');
        } else if (btnUndo) {
            btnUndo.classList.add('disabled');
        }
    }
    
    updateBotTitleBoard();
}
export function applyAutoBoardFlip() {
    const boardArea = document.getElementById('chess-board-area');
    const btnFlip = document.getElementById('btn-flip');
    
    if (state.appMode === 'vsbot') {
        state.isBoardFlipped = (state.vsBotSettings.botColor === 'red');
    } else if (state.appMode === 'memorize') {
        state.isBoardFlipped = (state.memorizeSettings.side === 'black');
    } else if (state.appMode === 'puzzle') {
        // GIẢI BÀI TẬP: Lật bàn nếu người chơi (đi trước) cầm quân Đen
        const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
        state.isBoardFlipped = !isRedFirst; 
    } else {
        state.isBoardFlipped = false;
    }

    if (boardArea) {
        if (state.isBoardFlipped) {
            boardArea.classList.add('board-flipped');
            if (btnFlip) btnFlip.classList.add('tool-active');
        } else {
            boardArea.classList.remove('board-flipped');
            if (btnFlip) btnFlip.classList.remove('tool-active');
        }
    }
}

export async function initGame(fenString = START_FEN, loadFromStorage = false) {
     if (!state.isEditMode) {
        state.isPeeking = false; 
        const btnPeek = document.getElementById('btn-peek');
        const eyeClosed = document.getElementById('icon-eye-closed');
        const eyeOpen = document.getElementById('icon-eye-open');
        if (btnPeek) btnPeek.classList.remove('tool-active');
        if (eyeClosed) eyeClosed.style.display = 'block';
        if (eyeOpen) eyeOpen.style.display = 'none';
    } else {
        // NẾU ĐANG TRONG XẾP QUÂN, ĐẢM BẢO MẮT LUÔN MỞ
        state.isPeeking = true;
        const btnPeek = document.getElementById('btn-peek');
        const eyeClosed = document.getElementById('icon-eye-closed');
        const eyeOpen = document.getElementById('icon-eye-open');
        if (btnPeek) btnPeek.classList.add('tool-active');
        if (eyeClosed) eyeClosed.style.display = 'none';
        if (eyeOpen) eyeOpen.style.display = 'block';
    }

    const titleTabBtn = document.querySelector('.ai-tab-btn[data-tab="title"]');
    const titleHeader = document.getElementById('tab-title');
    if (titleTabBtn && titleHeader) {
        titleTabBtn.click();
        if (state.appMode === 'vsbot' || state.appMode === 'puzzle') {
            updateBotTitleBoard(); // Trả quyền render cho hàm chuyên dụng
        } else {
            const modeTitleMap = { "analyze": "CHẾ ĐỘ PHÂN TÍCH", "blind": "CHẾ ĐỘ CỜ MÙ", "opening": "LUYỆN KHAI CUỘC" };
            titleHeader.innerHTML = `
                <strong style="font-size: 17px; color: #333; display: block; width: 100%;">${modeTitleMap[state.appMode] || "CHẾ ĐỘ PHÂN TÍCH"}</strong>
                <div id="blind-turn-indicator" class="blind-only" style="display: none; margin-top: 15px; font-size: 16px; font-weight: bold; color: #555;">
                    Lượt đi: <span id="blind-turn-text">Bên Đỏ</span>
                </div>
            `;
        }
    }
    
    // XỬ LÝ CLASS BODY CHO CHẾ ĐỘ MỚI
    document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize', 'mode-puzzle');
    const navBar = document.getElementById('nav-bar');

    if (state.appMode === 'vsbot') {
        document.body.classList.add('mode-vsbot');
        if (navBar) { navBar.style.opacity = '0.5'; navBar.style.pointerEvents = 'none'; }
    } else if (state.appMode === 'blind') {
        document.body.classList.add('mode-blind');
        if (navBar) { navBar.style.opacity = '1'; navBar.style.pointerEvents = 'auto'; }
    } else if (state.appMode === 'puzzle') {
        document.body.classList.add('mode-puzzle');
        // Vô hiệu hóa và làm mờ NavBar trong chế độ Giải Bài Tập
        if (navBar) { navBar.style.opacity = '0.5'; navBar.style.pointerEvents = 'none'; }
    } else {
        if (navBar) { navBar.style.opacity = '1'; navBar.style.pointerEvents = 'auto'; }
    }

    if (loadFromStorage) {
        try {
            let dbKey = 'analyze_workspace';
            if (state.appMode === 'vsbot') dbKey = 'vsbot_workspace';
            else if (state.appMode === 'blind') dbKey = 'blind_workspace';

            const workspace = await getWorkspace(dbKey);
            
            if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                state.gameList = workspace.gameList;
                loadGameFromList(workspace.currentIndex || 0, workspace.ptrId);
                
                syncNavbarWidth(); applyAutoBoardFlip(); 
                if (state.appMode === 'vsbot' && !state.isEditMode) {
                    if (state.vsBotSettings.botColor === 'red') { state.aiPlaysRed = true; state.aiPlaysBlack = false; } 
                    else { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                    updateVsBotToolButtons();
                }

                if (!state.isEditMode) {
                    if (!state.engineModule) initPikafish(); else triggerEngineEvaluation();
                }
                updateBlindTurnUI();
                return; // Thoát hàm nếu load DB thành công
            }
        } catch (e) { console.error("Lỗi đọc IndexedDB", e); }
    }

    // NẾU TẠO VÁN MỚI HOẶC DB TRỐNG -> TẠO LIST MỚI CÓ 1 VÁN KHỞI TẠO
    state.currentGameInfo = Object.assign({}, defaultGameInfo);
    let rawNode = { fen: fenString, comment: formatGameInfoString(state.currentGameInfo, ""), next: [], defaultIndex: 0 };
    
    state.gameList = [{ info: state.currentGameInfo, node: rawNode }];
    loadGameFromList(0); // Bơm ván trắng này lên RAM

    state.lastMove = null; state.pendingAIMove = null; state.isAnimating = false; 
    state.pvLines = []; clearArrow(); state.hasAutoSwitchedToAnalyze = false;
    
    syncNavbarWidth(); applyAutoBoardFlip();

    if(fenString === START_FEN) state.currentGameInfo = Object.assign({}, defaultGameInfo);
    
    state.rootNode = createRawNode(fenString, null, "Nước Đi", false, 0, null);
    state.rootNode.comment = formatGameInfoString(state.currentGameInfo, "");

    state.currentNode = state.rootNode; state.currentStepNum = 0; 
    state.currentSituation = vschess.fenToSituation(fenString); 
    state.lastMove = null; state.pendingAIMove = null; state.isAnimating = false; 
    state.pvLines = []; clearArrow(); state.hasAutoSwitchedToAnalyze = false;
    state.selectedSquare = null; state.legalMoves = [];
    
    const commentBox = document.getElementById('comment-box');
    if (commentBox) commentBox.value = state.rootNode.comment;

    renderBoardFull(state.currentSituation); 
    if(!state.isEditMode) renderMoveHistory();
    syncNavbarWidth(); applyAutoBoardFlip(); 
    
    if (state.appMode === 'vsbot' && !state.isEditMode) {
        if (state.vsBotSettings.botColor === 'red') { state.aiPlaysRed = true; state.aiPlaysBlack = false; } 
        else { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
        updateVsBotToolButtons();
    } else if (state.appMode === 'puzzle' && !state.isEditMode) {
        // GIẢI BÀI TẬP: Người luôn đi trước, Máy luôn đi sau
        const isRedFirst = fenString.split(" ")[1] === "w";
        state.aiPlaysRed = !isRedFirst; // Máy cầm Đỏ nếu Đen đi trước
        state.aiPlaysBlack = isRedFirst; // Máy cầm Đen nếu Đỏ đi trước
        updateVsBotToolButtons();
    }

    saveGameState(); 

    if (!state.isEditMode) {
        if (!state.engineModule) initPikafish(); else triggerEngineEvaluation();
    }
    updateBlindTurnUI(); 
    if (state.appMode === 'memorize') triggerMemorizeBot();
}

export function handleSquareClick(x, y, iccsPos) {
    if (state.isEditMode) { handleEditSquareClick(iccsPos); return; }
    if (state.isAnimating) return; 
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";

    if (state.appMode === 'vsbot') {
        const isBotTurn = (state.vsBotSettings.botColor === 'red' && isRedTurn) || (state.vsBotSettings.botColor === 'black' && !isRedTurn);
        if (isBotTurn) return; 
    } 
    else if (state.appMode === 'memorize') {
        // TRONG CHẾ ĐỘ LUYỆN NHỚ
        // Nếu chọn "Luyện cả 2 bên", state.aiPlaysRed = false và state.aiPlaysBlack = false -> Lệnh này tự động cho phép người chơi đi cả 2 phe!
        const isBotTurn = (state.aiPlaysRed && isRedTurn) || (state.aiPlaysBlack && !isRedTurn);
        if (isBotTurn) {
            return; 
        }
    } 
    else {
        if ((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack)) return;
    }
    
    if (state.isAutoPlaying) toggleAutoPlay();

    if (state.selectedSquare) {
        const moveCommand = state.selectedSquare.iccs + iccsPos; 
        if (state.legalMoves.includes(moveCommand)) { 
            
            // TRONG CHẾ ĐỘ LUYỆN NHỚ: CHỈ CHO PHÉP ĐI NƯỚC CÓ TRONG BÀI
            if (state.appMode === 'memorize') {
                let isValidMemory = false;
                
                // NẾU LÀ NHÁNH CHÍNH -> Chỉ chấp nhận nước đi đầu tiên trong mảng children (index = 0)
                if (state.memorizeSettings.path === 'main') {
                    isValidMemory = state.currentNode.children.length > 0 && state.currentNode.children[0].moveCommand === moveCommand;
                } else {
                    // Nếu là tự chọn/random -> Chấp nhận mọi nhánh có trong dữ liệu
                    isValidMemory = state.currentNode.children.some(c => c.moveCommand === moveCommand);
                }

                if (!isValidMemory) {
                    if (isRedTurn) state.memoMistakesRed++;
                    else state.memoMistakesBlack++;
                    updateBlindTurnUI();

                    const errMsg = state.memorizeSettings.path === 'main' 
                                 ? "❌ Nước đi sai! Bạn đang ở chế độ chỉ luyện Nhánh Chính." 
                                 : "❌ Nước đi sai! Hãy chọn nước đi có trong bài học.";
                    
                    showToast(errMsg);
                    state.selectedSquare = null;
                    state.legalMoves = [];
                    import('./board.js').then(m => m.renderBoardFull(state.currentSituation));
                    return;
                }
            }
            
            executeMove(moveCommand); 
            return; 
        }
    }
    
    const pieceCode = state.currentSituation[vschess.i2s[iccsPos]];
    if (pieceCode > 1 && (pieceCode >> 4) === state.currentSituation[0]) {
        state.selectedSquare = { x, y, iccs: iccsPos };
        state.legalMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen).filter(m => m.startsWith(iccsPos));
    } else {
        if (state.selectedSquare) playSound('illegal');
        state.selectedSquare = null;
        state.legalMoves = [];
    }
}

export function customTranslator(moveCommand, oldFEN) {
    const fenParts = oldFEN.split(" ");
    const isRedTurn = fenParts[1] === "w";
    const boardState = fenParts[0];
    let board = []; let rows = boardState.split("/");
    for(let r=0; r<10; r++) {
        let colChars = [];
        for(let c=0; c<rows[r].length; c++) {
            let char = rows[r][c];
            if(!isNaN(char)) { for(let i=0; i<parseInt(char); i++) colChars.push('*'); } 
            else { colChars.push(char); }
        }
        board.push(colChars);
    }
    const fromX = vschess.i2b[moveCommand.substring(0, 2)] % 9;
    const fromY = Math.floor(vschess.i2b[moveCommand.substring(0, 2)] / 9);
    const pieceChar = board[fromY][fromX]; 
    let samePiecesOnCol = []; 
    for (let r=0; r<10; r++) {
        if (board[r][fromX] === pieceChar) samePiecesOnCol.push(r); 
    }
    let wxf = vschess.Node2WXF(moveCommand, oldFEN).move; 
    if(wxf === "None") return "";
    const pieceMapR = {'R':'X', 'N':'M', 'B':'T', 'A':'S', 'K':'Tg', 'C':'P', 'P':'B'};
    const pieceMapB = {'r':'x', 'n':'m', 'b':'t', 'a':'s', 'k':'tg', 'c':'p', 'p':'b'};
    const opMap = {'+': '.', '-': '/', '.': '-'};

    let pStr = isRedTurn ? pieceMapR[pieceChar.toUpperCase()] : pieceMapB[pieceChar.toLowerCase()];
    let col1, action, col2;
    let pChar = wxf.charAt(0); 
    let isFrontRear = (pChar === '+' || pChar === '-');   
    
    if (isFrontRear) { action = wxf.charAt(2); col2 = wxf.charAt(3); } 
    else { col1 = wxf.charAt(1); action = wxf.charAt(2); col2 = wxf.charAt(3); }
    action = opMap[action] || action;

    let prefix = ""; let usePrefix = false;
    if (samePiecesOnCol.length > 1) {
        usePrefix = true;
        if (isRedTurn) samePiecesOnCol.sort((a, b) => a - b); 
        else samePiecesOnCol.sort((a, b) => b - a);

        const myIndex = samePiecesOnCol.indexOf(fromY); 
        if (samePiecesOnCol.length === 2) { prefix = (myIndex === 0) ? "." : "/"; } 
        else if (samePiecesOnCol.length === 3) {
            if (myIndex === 0) prefix = "."; else if (myIndex === 1) prefix = "-"; else prefix = "/";
        }
        else if (samePiecesOnCol.length >= 4) {
            if (myIndex === 0) prefix = "."; else if (myIndex === samePiecesOnCol.length - 1) prefix = "/"; else prefix = (myIndex + 1).toString();
        }
    }
    if (usePrefix) return `${prefix}${pStr}${action}${col2}`;
    else return `${pStr}${col1}${action}${col2}`;
}

export function forceStopAIPlayers() {
    hideAILoading();
    state.aiPlaysRed = false; 
    document.getElementById('btn-ai-red').classList.remove('tool-active');
    state.aiPlaysBlack = false; 
    document.getElementById('btn-ai-black').classList.remove('tool-active');
    state.pendingAIMove = null;
    
    state.pvLines = [];
    if (!state.isAnalyzing) {
        const isRedTurn = state.currentNode ? (state.currentNode.fen.split(" ")[1] === "w") : true;
        const prefix = isRedTurn ? "Điểm Đỏ: " : "Điểm Đen: ";
        const elScore = document.getElementById("score-text"); if(elScore) elScore.innerText = prefix + "0";
        const elBar = document.getElementById("score-bar-fill"); if(elBar) elBar.style.width = "50%";
    }
}

export function checkGameOver() {
    const puzModal = document.getElementById('puzzle-result-modal');
    if (puzModal && puzModal.style.display === 'flex') return true;

    const gameModal = document.getElementById('new-game-modal');
    if (gameModal && gameModal.style.display === 'flex') return true;

    const memoModal = document.getElementById('memo-gameover-modal');
    if (memoModal && memoModal.style.display === 'flex') return true;
    
    if (state.appMode === 'memorize') {
        const children = state.currentNode.children;
        const isSegmentEnd = (state.memorizeSettings.method === 'segment' && state.currentNode.id === state.memorizeSettings.endNodeId);
        if (children.length === 0 || isSegmentEnd) {
            import('./ui.js').then(ui => {
                document.getElementById('memo-end-err-red').innerText = state.memoMistakesRed;
                document.getElementById('memo-end-err-black').innerText = state.memoMistakesBlack;
                ui.openModal('memo-gameover-modal');
            });
            return true; 
        }
        return false; 
    }
    
    const isDraw = checkDraw60Moves(state.currentNode);
    const strictMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen);

    // --- LOGIC XỬ LÝ RIÊNG CHO GIẢI BÀI TẬP ---
    if (state.appMode === 'puzzle') {
        const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        const isBotTurn = (state.aiPlaysRed && isRedTurn) || (state.aiPlaysBlack && !isRedTurn);
        
        // Thắng: Không hòa VÀ Bot đến lượt nhưng hết nước đi (Bị chiếu bí)
        const isPlayerWin = (!isDraw && isBotTurn && strictMoves.length === 0);

        // Đếm số hiệp trọn vẹn đã hoàn thành (1 hiệp = 1 nước Player + 1 nước Bot)
        // Dùng Math.floor: Đi 5 bước (Player 3, Bot 2) -> floor(5/2) = 2. Đi 6 bước (Player 3, Bot 3) -> floor(6/2) = 3.
        const completedRounds = Math.floor(state.currentStepNum / 2);
        
        // SỬA ĐỔI QUAN TRỌNG TẠI ĐÂY:
        // Đạt giới hạn khi: Số hiệp trọn vẹn >= max_moves VÀ hiện tại đang là lượt của Player
        // (Tức là Bot đã đi xong nước đáp trả cuối cùng, và Player chuẩn bị đi lố giới hạn)
        const isLimitReached = (state.currentPuzzleMaxMoves < 100 && completedRounds >= state.currentPuzzleMaxMoves && !isBotTurn);

        // Thua: Hòa cờ HOẶC Player bị bí HOẶC Hết số nước giới hạn (Bot vừa đỡ xong)
        const isPlayerLoss = isDraw || (!isBotTurn && strictMoves.length === 0) || (!isPlayerWin && isLimitReached);

        if (isPlayerWin || isPlayerLoss) {
            forceStopAIPlayers();
            if (state.isAutoPlaying) toggleAutoPlay();

            import('./ui.js').then(ui => {
                const header = document.getElementById('puzzle-result-header');
                const desc = document.getElementById('puzzle-result-desc');
                const btnNext = document.getElementById('btn-puz-res-next');
                
                if (isPlayerWin) {
                    header.innerText = "Giải Thành Công 🎉";
                    header.style.color = "#008a3e";
                    
                    const winMoveCount = Math.ceil(state.currentStepNum / 2);
                    desc.innerText = `Chúc mừng! Bạn đã giải xong trong ${winMoveCount} nước.`;
                    
                    // --- LƯU BÀI TẬP ĐÃ GIẢI VÀO DATABASE ---
                    const isChallenge = state.currentPuzzleName === "Thử Thách" || state.currentPuzzleKey.includes("challenge");
                    
                    if (isChallenge) {
                        // Challenge: Chỉ lưu Max Index
                        const maxSolvedIndex = state.currentPuzzleSolved.length > 0 ? state.currentPuzzleSolved[0] : -1;
                        if (state.currentPuzzleIndex > maxSolvedIndex) {
                            state.currentPuzzleSolved = [state.currentPuzzleIndex]; // Ghi đè bằng index cao nhất
                            saveWorkspace('puz_solved_' + state.currentPuzzleSolvedKey, state.currentPuzzleSolved);
                        }
                    } else {
                        // Bài thường: Lưu mảng dồn
                        if (!state.currentPuzzleSolved.includes(state.currentPuzzleIndex)) {
                            state.currentPuzzleSolved.push(state.currentPuzzleIndex);
                            saveWorkspace('puz_solved_' + state.currentPuzzleSolvedKey, state.currentPuzzleSolved);
                        }
                    }
                    
                    btnNext.style.display = 'block';
                    if (state.currentPuzzleIndex >= state.puzzleFens.length - 1) {
                        btnNext.style.opacity = '0.4';
                        btnNext.style.pointerEvents = 'none';
                    } else {
                        btnNext.style.opacity = '1';
                        btnNext.style.pointerEvents = 'auto';
                    }
                } else {
                    header.innerText = "Giải Thất Bại ❌";
                    header.style.color = "#d32f2f";
                    btnNext.style.display = 'none';
                    
                    if (isDraw) desc.innerText = "Hòa cờ (Luật 30 nước hoặc lặp lại nước đi)!";
                    else if (!isBotTurn && strictMoves.length === 0) desc.innerText = "Bạn đã bị chiếu bí!";
                    else if (isLimitReached) desc.innerText = `Không thể chiếu hết trong giới hạn ${state.currentPuzzleMaxMoves} nước đi!`;
                }
                ui.openModal('puzzle-result-modal');
            });
            return true; // Báo hiệu Game Over
        }
        return false; // Chưa Game Over
    }

    if (isDraw || strictMoves.length === 0) {
        forceStopAIPlayers();
        if (state.isAutoPlaying) toggleAutoPlay();

        const modal = document.getElementById('new-game-modal');
        const modalHeader = modal.querySelector('.modal-header');
        const modalBody = modal.querySelector('.modal-body');
        modalHeader.style.color = "black";
        
        if (isDraw) {
            state.currentGameInfo.result = "1/2-1/2";
            modalHeader.innerText = "Kết Thúc Ván";
            modalBody.innerHTML = `<strong style="color: #008a3e; font-size: 18px; display: block; margin-bottom: 10px;">HÒA CỜ</strong><span style="color: black; font-weight: normal; font-size: 14px;">(Hai bên đã đi 60 nước không ăn quân)<br>Bạn có muốn chơi ván mới không?</span>`;
        } else {
            const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
            state.currentGameInfo.result = isRedTurn ? "0-1" : "1-0"; 
            modalHeader.innerText = "Kết Thúc Ván";
            if (isRedTurn) {
                modalBody.innerHTML = `<strong style="color: black; font-size: 18px; display: block; margin-bottom: 10px;">BÊN ĐEN THẮNG</strong><span style="color: black; font-weight: normal; font-size: 14px;">Bạn có muốn chơi ván mới không?</span>`;
            } else {
                modalBody.innerHTML = `<strong style="color: red; font-size: 18px; display: block; margin-bottom: 10px;">BÊN ĐỎ THẮNG</strong><span style="color: black; font-weight: normal; font-size: 14px;">Bạn có muốn chơi ván mới không?</span>`;
            }
        }

        let rawComment = state.rootNode.comment.split("-------------------\n")[1] || "";
        state.rootNode.comment = formatGameInfoString(state.currentGameInfo, rawComment);
        
        document.getElementById('btn-new-confirm').innerText = "Xác nhận";
        openModal('new-game-modal');
        return true; // Game Over
    }
    return false; // Chưa Game Over
}

export function triggerMemorizeBot() {
    if (state.appMode !== 'memorize' || state.isAnimating) return;
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const isBotTurn = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);
    
    const children = state.currentNode.children;
    const varContainer = document.getElementById('memo-variation-container');
    if (varContainer) varContainer.style.display = 'none'; // Ẩn UI chọn biến cũ

    if (children.length === 0) {
        return; 
    }

    // YÊU CẦU 2: CÓ NHÁNH BIẾN + CHỌN MANUAL -> DỪNG LẠI & TRẢ QUYỀN CHO PLAYER BẤT KỂ LƯỢT AI
    if (children.length > 1 && state.memorizeSettings.path === 'manual') {
        showToast("💡 Đến nhánh biến hóa! Mời bạn tự tay chọn nước đi.");
        
        // Cướp quyền của Bot (Trở thành chế độ "Luyện 2 bên" tạm thời)
        state.aiPlaysRed = false;
        state.aiPlaysBlack = false;
        
        // Đảm bảo tất cả các nhánh con đều được dịch tên nước đi
        children.forEach(child => ensureNodeData(child));

        // Vẽ danh sách nút bấm ra màn hình
        if (varContainer) {
            varContainer.innerHTML = '<div style="font-size: 13px; color: #d32f2f; margin-bottom: 5px;">Mời bạn chọn biến để luyện tiếp:</div>';
            children.forEach((child, index) => {
                const btn = document.createElement('button');
                btn.className = 'export-btn';
                btn.style.cssText = 'justify-content: center; background: #e8f0fe; border-color: #bbdefb; color: #1a73e8; cursor: pointer;';
                btn.innerText = `${index + 1}. ${child.notation}`;
                btn.onclick = () => {
                    varContainer.style.display = 'none';
                    executeForwardStep(child); // Đi nước đã chọn
                };
                varContainer.appendChild(btn);
            });
            varContainer.style.display = 'flex';
        }
        
        return; // DỪNG HOÀN TOÀN BOT TẠI ĐÂY!
    }

    // NẾU KHÔNG CHỌN MANUAL MÀ LÀ LƯỢT CỦA BOT -> BOT TỰ ĐI
    if (isBotTurn) {
        let selectedChild = null;
        
        if (state.memorizeSettings.path === 'main') {
            // [THÊM MỚI] LUÔN ĐI NHÁNH CHÍNH
            selectedChild = children[0];
            state.currentNode.mainLineIndex = 0;
        } else if (children.length === 1) {
            selectedChild = children[0]; // Có 1 đường -> Bot tự đi
        } else if (state.memorizeSettings.path === 'random') {
            const randIdx = Math.floor(Math.random() * children.length);
            selectedChild = children[randIdx]; // Bốc random
            state.currentNode.mainLineIndex = randIdx;
        }

        if (selectedChild) {
            import('./ui.js').then(ui => {
                ui.showAILoading();
                setTimeout(() => {
                    ui.hideAILoading();
                    state.pvLines = [];
                    state.selectedSquare = null;
                    state.legalMoves = [];
                    
                    const moveCommand = selectedChild.moveCommand;
                    const fromIccs = moveCommand.substring(0, 2); 
                    const toIccs = moveCommand.substring(2, 4);
                    const movingPieceCode = state.currentSituation[vschess.i2s[fromIccs]];
                    
                    // [THÊM MỚI] Kiểm tra xem có ăn quân hay không trước khi cập nhật bàn cờ
                    const isCapture = state.currentSituation[vschess.i2s[toIccs]] > 1;
                    
                    if (state.appSettings.animation) {
                        state.isAnimating = true;
                        import('./board.js').then(b => b.startCanvasAnimation(fromIccs, toIccs, movingPieceCode));
                    }

                    state.currentNode = selectedChild; 
                    state.currentStepNum++;
                    ensureNodeData(state.currentNode);
                    state.lastMove = moveCommand;
                    state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
                    
                    // [THÊM MỚI] Phát âm thanh cờ
                    let soundToPlay = 'move';
                    if (isCapture) soundToPlay = 'eat';
                    if (vschess.checkThreat(state.currentSituation)) soundToPlay = 'check';
                    if (!vschess.hasLegalMove(state.currentSituation)) soundToPlay = 'lose';
                    playSound(soundToPlay, isCapture);
                    
                    import('./board.js').then(b => b.renderMoveHistory());
                    updateBlindTurnUI();
                    updateVsBotToolButtons();
                    
                    setTimeout(() => { 
                        state.isAnimating = false; 
                        updateVsBotToolButtons();
                        checkGameOver(); 
                        triggerMemorizeBot(); // Xem xét đi tiếp
                    }, state.appSettings.animation ? 150 : 0);
                    
                }, 800); 
            });
        }
    }
}

export function executeMove(moveCommand, isJump = false, isReverse = false) {
    state.pvLines = [];
    const varContainer = document.getElementById('memo-variation-container');
    if (varContainer) varContainer.style.display = 'none';
    const useAnim = state.appSettings.animation;
    if (useAnim) state.isAnimating = true;
    updateVsBotToolButtons(); 

    const fromIccs = !isReverse ? moveCommand.substring(0, 2) : moveCommand.substring(2, 4);
    const toIccs = !isReverse ? moveCommand.substring(2, 4) : moveCommand.substring(0, 2);
    
    // Lấy mã quân cờ sẽ di chuyển TRƯỚC KHI cập nhật state
    const movingPieceCode = state.currentSituation[vschess.i2s[fromIccs]];

    let isCapture = false;
    if (!isReverse && !isJump) {
        const freshSit = vschess.fenToSituation(state.currentNode.fen);
        const targetPieceCode = freshSit[vschess.i2s[toIccs]];
        if (targetPieceCode > 1) isCapture = true; 
    }

    if (!isJump) {
        const notation = customTranslator(moveCommand, state.currentNode.fen);
        const isRedMove = (state.currentNode.fen.split(" ")[1] === "w");
        
        let roundNum = parseInt(state.currentNode.fen.split(" ")[5], 10);
        if (isNaN(roundNum) || roundNum === 0) roundNum = 1;
        
        ensureNodeData(state.currentNode);
        let existingChildIndex = state.currentNode.children.findIndex(c => c.moveCommand === moveCommand);

        if (existingChildIndex !== -1) {
            state.currentNode.mainLineIndex = existingChildIndex;
            state.currentNode = state.currentNode.children[existingChildIndex];
            ensureNodeData(state.currentNode);
        } else {
            const nextFEN = vschess.fenMovePiece(state.currentNode.fen, moveCommand);
            const newNode = createRawNode(nextFEN, moveCommand, notation, isRedMove, roundNum, state.currentNode);
            state.currentNode.children.push(newNode);
            state.currentNode.mainLineIndex = state.currentNode.children.length - 1; 
            state.currentNode = newNode;
        }
        state.currentStepNum++; 
    }
    
    state.lastMove = state.currentNode.moveCommand;
    state.selectedSquare = null;
    state.legalMoves = []; 

    // GỌI CANVAS ANIMATION THAY VÌ DOM
    if (useAnim) startCanvasAnimation(fromIccs, toIccs, movingPieceCode);

    state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
    
    if (!isJump) {
        let soundToPlay = 'move';
        if (isCapture) soundToPlay = 'eat';
        if (!isReverse) {
            if (vschess.checkThreat(state.currentSituation)) soundToPlay = 'check'; 
            if (!vschess.hasLegalMove(state.currentSituation)) soundToPlay = 'lose'; 
        }
        playSound(soundToPlay, isCapture);
    }

    renderMoveHistory();
    saveGameState(); 

    setTimeout(() => {
        state.isAnimating = false;
        
        // Đợi thêm 400ms để người chơi nhìn thấy nước cờ cuối cùng VÀ âm thanh được phát xong
        // rồi MỚI cho phép hiện Modal Kết thúc ván
        setTimeout(() => {
            const isGameOver = checkGameOver();
            if (isGameOver) return;
            if (state.appMode === 'puzzle') {
                const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
                state.aiPlaysRed = !isRedFirst;  // Máy chỉ cầm quân địch
                state.aiPlaysBlack = isRedFirst;
            }
            if (!isJump && state.appMode !== 'memorize') triggerEngineEvaluation(); 
            updateVsBotToolButtons(); 
            updateBlindTurnUI();
            if (state.appMode === 'memorize') {
                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                triggerMemorizeBot();
            }
        }, 600);

    }, useAnim ? 150 : 0);
}

export function executeForwardStep(targetNode) {
    state.pvLines = [];
    const varContainer = document.getElementById('memo-variation-container');
    if (varContainer) varContainer.style.display = 'none';
    const useAnim = state.appSettings.animation;
    if (useAnim) state.isAnimating = true;
    updateVsBotToolButtons();

    const moveCommand = targetNode.moveCommand;
    const fromIccs = moveCommand.substring(0, 2); 
    const toIccs = moveCommand.substring(2, 4);
    
    const movingPieceCode = state.currentSituation[vschess.i2s[fromIccs]];
    let isCapture = state.currentSituation[vschess.i2s[toIccs]] > 1;
    
    if (useAnim) startCanvasAnimation(fromIccs, toIccs, movingPieceCode);

    state.currentNode = targetNode; state.currentStepNum++;
    ensureNodeData(state.currentNode);
    state.lastMove = state.currentNode.moveCommand;
    state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
    
    state.selectedSquare = null;
    state.legalMoves = [];
    
    let soundToPlay = 'move';
    if (isCapture) soundToPlay = 'eat';
    if (vschess.checkThreat(state.currentSituation)) soundToPlay = 'check';
    if (!vschess.hasLegalMove(state.currentSituation)) soundToPlay = 'lose';
    playSound(soundToPlay, isCapture);
    
    renderMoveHistory();
    saveGameState(); 
    
    setTimeout(() => { 
        state.isAnimating = false; 
        
        setTimeout(() => {
            const isGameOver = checkGameOver();
            if (isGameOver) return; 
            if (state.appMode !== 'memorize') triggerEngineEvaluation(); 
            updateVsBotToolButtons();
            updateBlindTurnUI();
            if (state.appMode === 'memorize') {
                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                triggerMemorizeBot();
            }
        }, 600);

    }, useAnim ? 150 : 0);
}

export function executeReverseStep(nodeToReverse) {
    state.pvLines = [];
    const useAnim = state.appSettings.animation;
    if (useAnim) state.isAnimating = true;
    updateVsBotToolButtons();

    const moveCommand = nodeToReverse.moveCommand; 
    const fromIccs = moveCommand.substring(0, 2);  
    const toIccs = moveCommand.substring(2, 4);    

    // Khi lùi lại, quân cờ nằm ở toIccs sẽ quay về fromIccs
    const movingPieceCode = state.currentSituation[vschess.i2s[toIccs]];

    if (useAnim) startCanvasAnimation(toIccs, fromIccs, movingPieceCode);

    state.currentNode = nodeToReverse.parent; state.currentStepNum--;
    ensureNodeData(state.currentNode);
    state.lastMove = state.currentNode.moveCommand;
    state.currentSituation = vschess.fenToSituation(state.currentNode.fen);

    state.selectedSquare = null;
    state.legalMoves = [];
    
    playSound('move');
    renderMoveHistory();
    saveGameState(); 

    setTimeout(() => { 
        state.isAnimating = false; 
        
        setTimeout(() => {
            const isGameOver = checkGameOver();
            if (isGameOver) return;

            if (state.appMode !== 'memorize') triggerEngineEvaluation(); 
            updateVsBotToolButtons();
            updateBlindTurnUI();
            if (state.appMode === 'memorize') {
                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                triggerMemorizeBot();
            }
        }, 600);

    }, useAnim ? 150 : 0);
}

export function undoVsBot() {
    if (state.isAnimating || !state.currentNode.parent || !state.currentNode.parent.parent) return;
    forceStopAIPlayers();
    const targetNode = state.currentNode.parent.parent;
    targetNode.children = []; targetNode.mainLineIndex = 0;
    state.currentNode = targetNode; state.currentStepNum -= 2;
    state.lastMove = state.currentNode.moveCommand;
    state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
    
    state.selectedSquare = null;
    state.legalMoves = [];
    
    playSound('move');
    renderMoveHistory(); saveGameState();
    
    // PHỤC HỒI BOT CHO ĐÚNG MODE
    if (state.appMode === 'puzzle') {
        const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
        state.aiPlaysRed = !isRedFirst;
        state.aiPlaysBlack = isRedFirst;
    } else if (state.appMode === 'vsbot') {
        if (state.vsBotSettings.botColor === 'red') state.aiPlaysRed = true;
        else state.aiPlaysBlack = true;
    }
    
    triggerEngineEvaluation();
    updateVsBotToolButtons();

    if (state.appMode === 'memorize') {
        const side = state.memorizeSettings.side;
        if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
        else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
        triggerMemorizeBot();
    }
}

export function instantJumpToNode(targetNode) {
    state.pvLines = [];
    state.currentNode = targetNode; 
    ensureNodeData(state.currentNode);
    state.currentSituation = vschess.fenToSituation(state.currentNode.fen); 
    state.lastMove = state.currentNode.moveCommand; 
    state.selectedSquare = null;
    state.legalMoves = [];
    
    let step = 0; let temp = targetNode;
    while(temp.parent) { step++; temp = temp.parent; }
    state.currentStepNum = step;

    renderMoveHistory(); saveGameState(); updateVsBotToolButtons();
    if (state.appMode !== 'memorize') triggerEngineEvaluation(); 
    updateBlindTurnUI();
    if (state.appMode === 'memorize') triggerMemorizeBot();
}

export function jumpToNode(targetNode) {
    if (!targetNode || targetNode === state.currentNode) return;
    if (state.isAnimating) return;
    
    if (targetNode.parent === state.currentNode) {
        forceStopAIPlayers(); executeForwardStep(targetNode);
    }
    else if (state.currentNode.parent === targetNode) {
        forceStopAIPlayers(); executeReverseStep(state.currentNode);
    }
    else {
        forceStopAIPlayers(); instantJumpToNode(targetNode); checkGameOver(); triggerEngineEvaluation(); 
    }
}

export function getMainLine() {
    let path = []; let temp = state.rootNode;
    while(temp !== null) { 
        path.push(temp); 
        if(temp.children.length === 0) break; 
        temp = temp.children[temp.mainLineIndex]; 
    }
    return path;
}

export function toggleAutoPlay() {
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    state.isAutoPlaying = !state.isAutoPlaying;

    if (state.isAutoPlaying) {
        iconPlay.style.display = 'none'; iconPause.style.display = 'block';
        forceStopAIPlayers(); 
        if (state.currentNode.children.length === 0) { toggleAutoPlay(); return; }

        state.autoPlayInterval = setInterval(() => {
            if (!state.isAnimating && state.currentNode && state.currentNode.children.length > 0) {
                const idx = state.currentNode.mainLineIndex || 0;
                const target = state.currentNode.children[idx] || state.currentNode.children[0];
                if (target) executeForwardStep(target);
            } else if (!state.isAnimating && state.currentNode && state.currentNode.children.length === 0) {
                toggleAutoPlay();
            }
        }, 1200); 
    } else {
        clearInterval(state.autoPlayInterval);
        iconPlay.style.display = 'block'; iconPause.style.display = 'none';
    }
}

export function createRawNode(fen, moveCommand, notation, isRed, roundNum, parent) {
    return {
        id: (window.vschess && vschess.guid) ? vschess.guid() : Math.random().toString(36).substr(2, 9),
        moveCommand: moveCommand,
        parent: parent,
        children: [],
        mainLineIndex: 0,
        comment: "",
        fen: fen || null,
        notation: notation || null,
        isRed: isRed || false,
        roundNum: roundNum || 1
    };
}

export function ensureNodeData(node) {
    if (node.fen && node.notation) return; 
    if (!node.parent || !node.moveCommand) return; 

    if (!node.parent.fen) ensureNodeData(node.parent);

    try {
        node.fen = vschess.fenMovePiece(node.parent.fen, node.moveCommand);
        node.notation = customTranslator(node.moveCommand, node.parent.fen);
        node.isRed = node.fen.split(" ")[1] === "w";
        node.roundNum = parseInt(node.fen.split(" ")[5]) || 1;
        if (node.roundNum === 0) node.roundNum = 1;
    } catch (e) {
        console.error("Lỗi tính toán FEN động:", e);
    }
}

export function syncNavbarWidth() {
    if (window.innerHeight < 100) return; 

    const wrapper = document.querySelector('.board-wrapper');
    const boardArea = document.getElementById('chess-board-area');
    const navBar = document.getElementById('nav-bar');
    const mainContent = document.getElementById('main-content');
    
    if(!wrapper || !boardArea || !navBar || !mainContent) return;

    const isMobile = (window.innerWidth / window.innerHeight) <= 1;

    wrapper.style.transform = 'scale(1)';
    wrapper.style.marginBottom = '0px';

    if (isMobile) wrapper.style.transformOrigin = 'top center';
    
    if (isMobile) {
        wrapper.style.width = '100%';
        const availableHeight = window.innerHeight - 210 - 45; 
        const currentHeight = wrapper.offsetHeight;
        
        if (currentHeight > availableHeight) {
            const scaleRatio = availableHeight / currentHeight;
            wrapper.style.transform = `scale(${scaleRatio})`;
            wrapper.style.marginBottom = `-${currentHeight * (1 - scaleRatio)}px`;
        }
        setTimeout(() => { 
            const realBoardWidth = boardArea.getBoundingClientRect().width;
            navBar.style.width = `${realBoardWidth}px`; 
        }, 10);
    } else {
        setTimeout(() => { 
            navBar.style.width = `${boardArea.offsetWidth}px`; 
        }, 10);
    }
}

window.addEventListener('resize', syncNavbarWidth);
window.addEventListener('orientationchange', () => setTimeout(syncNavbarWidth, 200));