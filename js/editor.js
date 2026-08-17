// js/editor.js
import { state } from './state.js';
import { showToast, updateTurnToggleUI, openModal } from './ui.js';
import { renderBoardFull, renderMoveHistory} from './board.js';
import { initGame, forceStopAIPlayers, updateVsBotToolButtons } from './game.js';
import { START_FEN, VschessErrorDict } from './config.js';

function translateVschessError(errStr) {
    let trans = errStr;
    for (let key in VschessErrorDict) {
        trans = trans.replace(new RegExp(key, 'g'), VschessErrorDict[key]);
    }
    return trans;
}

export function handleEditSquareClick(iccsPos) {
    const sIndex = vschess.i2s[iccsPos];
    
    if (state.selectedPalettePiece) {
        state.currentSituation[sIndex] = vschess.f2n[state.selectedPalettePiece];
        state.selectedPalettePiece = null;
        document.querySelectorAll('.piece-palette img').forEach(img => img.classList.remove('piece-selected'));
        state.selectedBoardPiece = null; 
    } 
    else {
        if (state.currentSituation[sIndex] > 1 && state.selectedBoardPiece === null) {
            state.selectedBoardPiece = iccsPos;
            document.querySelectorAll('.piece-palette').forEach(el => el.style.pointerEvents = 'none');
        } 
        else if (state.selectedBoardPiece !== null) {
            const oldIndex = vschess.i2s[state.selectedBoardPiece];
            if (iccsPos === state.selectedBoardPiece) {
                state.selectedBoardPiece = null;
            } 
            else {
                state.currentSituation[sIndex] = state.currentSituation[oldIndex];
                state.currentSituation[oldIndex] = 1; 
                state.selectedBoardPiece = null; 
            }
            document.querySelectorAll('.piece-palette').forEach(el => el.style.pointerEvents = 'auto');
        }
    }
    
    renderBoardFull(state.currentSituation);
}

document.addEventListener('click', function(e) {
    if (!state.isEditMode || state.selectedBoardPiece === null) return;
    const boardArea = document.getElementById('chess-board-area');
    const palettes = document.querySelectorAll('.piece-palette');
    
    // Nếu bấm ra ngoài bàn cờ VÀ KHÔNG PHẢI bấm vào thẻ Khay chọn quân (Palette)
    let isClickOnPalette = false;
    palettes.forEach(p => {
        if (p.contains(e.target)) isClickOnPalette = true;
    });

    if (!boardArea.contains(e.target) && !isClickOnPalette) {
        // Đang cầm 1 quân cờ nhấc khỏi bàn mà vứt ra đất -> XÓA QUÂN ĐÓ
        state.currentSituation[vschess.i2s[state.selectedBoardPiece]] = 1; 
        state.selectedBoardPiece = null;
        
        // Gọi hàm của board.js (Canvas tự render vòng lặp rồi, ta chỉ gọi hàm rỗng để đồng bộ flow)
        renderBoardFull(state.currentSituation);
        
        document.querySelectorAll('.piece-palette').forEach(el => el.style.pointerEvents = 'auto');
        document.querySelectorAll('.piece-palette img').forEach(img => img.classList.remove('piece-selected'));
    }
}, true);


export function turnOnEditMode(btn) {
    state.pvLines = [];
    
    state.selectedSquare = null;
    state.legalMoves = [];

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
    
    if (state.isAnalyzing) document.getElementById('btn-analyze').click();
    forceStopAIPlayers();

    if (state.appMode === 'blind') {
        state.isPeeking = true;
        const btnPeek = document.getElementById('btn-peek');
        if (btnPeek) {
            btnPeek.classList.add('tool-active');
            document.getElementById('icon-eye-closed').style.display = 'none';
            document.getElementById('icon-eye-open').style.display = 'block';
        }
    }
    
    state.preEditFenBase = vschess.situationToFen(state.currentSituation).split(" ")[0];
    state.preEditTurn = state.currentNode.fen.split(" ")[1] || 'w';
    state.preEditNode = state.currentNode;
    state.preEditStepNum = state.currentStepNum;
    
    state.editTurn = state.preEditTurn;
    updateTurnToggleUI();
    import('./game.js').then(module => module.syncNavbarWidth());
}

export function finishEditing(btn) {
    let newFenBase = vschess.situationToFen(state.currentSituation).split(" ")[0];
    let newFenFull = newFenBase + ` ${state.editTurn} - - 0 1`;
    
    const errorList = vschess.checkFen(newFenFull);
    if (errorList && errorList.length > 0) {
        const vnError = translateVschessError(errorList[0]);
        showToast(`❌ ${vnError}`); 
        return; 
    }

    state.isEditMode = false;
    state.pvLines = []; 
    
    btn.classList.remove('tool-active');
    document.body.classList.remove('edit-mode');
    document.getElementById('btn-clear-board').style.display = 'none';
    document.getElementById('piece-palette-pc').style.display = 'none';
    document.getElementById('piece-palette-mobile').style.display = 'none';
    
    // FIX LỖI: Cài lại cứng thành "none". Thẻ CSS .vsbot-only (display:flex!important) sẽ định đoạt khi ở chế độ Bot!
    const btnUndo = document.getElementById('btn-undo');
    if(btnUndo) btnUndo.style.display = 'none';
    
    const btnHint = document.getElementById('btn-hint');
    if(btnHint) btnHint.style.display = 'none';
    
    state.selectedPalettePiece = null;
    state.selectedBoardPiece = null;
    document.querySelectorAll('.piece-palette img').forEach(img => img.classList.remove('piece-selected'));

    if (state.appMode === 'blind') {
        state.isPeeking = false;
        const btnPeek = document.getElementById('btn-peek');
        if (btnPeek) {
            btnPeek.classList.remove('tool-active');
            document.getElementById('icon-eye-closed').style.display = 'block';
            document.getElementById('icon-eye-open').style.display = 'none';
        }
    }
    
    if (newFenBase !== state.preEditFenBase || state.editTurn !== state.preEditTurn) {
        if (state.appMode === 'vsbot') {
            state.vsBotSetupOrigin = 'edit_mode'; 
            document.getElementById('setup-bot-fen').value = newFenFull;
            document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
            openModal('vsbot-setup-modal');
        } else {
            initGame(newFenFull); 
        }
    } else {
        state.currentNode = state.preEditNode;
        state.currentStepNum = state.preEditStepNum;
        state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
        renderBoardFull(state.currentSituation); 
        renderMoveHistory();
        
        const commentBox = document.getElementById('comment-box');
        if (commentBox) commentBox.value = state.currentNode.comment || "";
        
        if (state.appMode === 'vsbot') {
            if (state.vsBotSettings.botColor === 'red') state.aiPlaysRed = true;
            else state.aiPlaysBlack = true;
            updateVsBotToolButtons();
        }
        import('./game.js').then(module => module.syncNavbarWidth());
    }
}