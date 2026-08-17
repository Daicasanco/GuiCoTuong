// js/events.js
import { state, storage } from './state.js';
import { getWorkspace , saveWorkspace, deleteWorkspace } from './db.js';
import { toggleAutoPlay, forceStopAIPlayers, jumpToNode, initGame, loadGameFromList } from './game.js';
import { triggerEngineEvaluation, applyEngineSettings, getDeviceTier } from './engine.js';
import { openModal, closeModal, updateTurnToggleUI, showLoading, hideLoading, showToast, renderLibraryList, confirmDeleteLibraryItem, renderMemorizeList, syncBookTabUI } from './ui.js';
import { finishEditing, turnOnEditMode } from './editor.js';
import { handleImageRecognition, handleFileUpload, getMoveListAndComments, copyToClipboard, getVschessNodeTree, downloadFile, getFormattedDate, formatGameInfoString, saveGameState, createCBLBinaryFromGames } from './io.js';
import { renderBoardFull, drawBestMoveArrow, clearArrow, setBoardTheme } from './board.js';
import { START_FEN, VschessErrorDict } from './config.js';
import { uploadLocalBook, deleteLocalBook, loadLocalBookFromDB } from './localbook.js';
import { renderEvalGraph } from './analysis/eval-graph.js';
import { runAutoGameReview } from './analysis/auto-review.js';

let pendingDeletePuzKey = "";

function makeRandomString(length) {
    let result = '';
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function translateVschessError(errStr) {
    let trans = errStr;
    for (let key in VschessErrorDict) {
        trans = trans.replace(new RegExp(key, 'g'), VschessErrorDict[key]);
    }
    return trans;
}

function setupStepper(stateKey, inputId, minusId, plusId, min, defaultMax, step, isHash = false, targetType = 'ai') {
    const input = document.getElementById(inputId);
    const btnMinus = document.getElementById(minusId);
    const btnPlus = document.getElementById(plusId);
    if (!input || !btnMinus || !btnPlus) return;
    
    const hashValues = [32, 64, 128, 192, 256, 320, 384, 448, 512];

    let targetObj;
    if (targetType === 'ai') targetObj = state.aiSettings;
    else if (targetType === 'app') targetObj = state.appSettings;
    else if (targetType === 'bot') targetObj = state.vsBotSettings;

    if (targetObj[stateKey] !== undefined) {
        input.value = targetObj[stateKey];
    }

    function updateState(isFromUserClick = false) {
        let currentMax = parseFloat(input.getAttribute('max')) || defaultMax;
        let val = parseFloat(input.value);
        
        if (isNaN(val)) val = targetObj[stateKey];
        if (val < min) val = min;
        if (val > currentMax) val = currentMax;
        
        if (isHash && !hashValues.includes(val)) {
            val = hashValues.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
        }

        input.value = val;
        targetObj[stateKey] = val;
        
        if (isFromUserClick) {
            if (targetType === 'ai') storage.saveAnalysis(state.aiSettings);
            else if (targetType === 'app') storage.saveSystem(state.appSettings);
            else if (targetType === 'bot') storage.saveVsBot(state.vsBotSettings);
        }
        
        btnMinus.disabled = val <= min;
        btnPlus.disabled = val >= currentMax; 
    }

    btnMinus.onclick = () => {
        let val = parseFloat(input.value);
        if (isHash) {
            let idx = hashValues.indexOf(val);
            if (idx > 0) input.value = hashValues[idx - 1];
        } else {
            if (val - step >= min) input.value = val - step;
        }
        updateState(true);
        
        if (inputId === 'input-setup-level') document.getElementById('input-botlevel').value = input.value;
        if (inputId === 'input-botlevel') document.getElementById('input-setup-level').value = input.value;
    };

    btnPlus.onclick = () => {
        let currentMax = parseFloat(input.getAttribute('max')) || defaultMax;
        let val = parseFloat(input.value);
        if (isHash) {
            let idx = hashValues.indexOf(val);
            if (idx < hashValues.length - 1 && hashValues[idx + 1] <= currentMax) {
                input.value = hashValues[idx + 1];
            }
        } else {
            if (val + step <= currentMax) input.value = val + step;
        }
        updateState(true);
        
        if (inputId === 'input-setup-level') document.getElementById('input-botlevel').value = input.value;
        if (inputId === 'input-botlevel') document.getElementById('input-setup-level').value = input.value;
    };

    input.onblur = () => updateState(true);
    input.oninput = function() { this.value = this.value.replace(/[^0-9.]/g, ''); };
    
    updateState(false); 
}

function updateEngineToggleButtonUI() {
    const btn = document.getElementById('btn-engine-toggle');
    if (!btn) return;
    if (state.isAnalyzing) {
        btn.innerText = "Dừng Thẩm";
        btn.style.background = "#d32f2f";
    } else {
        btn.innerText = "Bật Thẩm";
        btn.style.background = "#008a3e";
    }
}

function resetAIUI() {
    updateEngineToggleButtonUI();
    if (!state.isAnalyzing && !state.aiPlaysRed && !state.aiPlaysBlack) {
        import('./engine.js').then(module => {
            module.forceStopEngine(); 
        });
    }
}

async function switchMode(newMode, customFen = START_FEN) {
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
    let targetMenuId = `menu-${newMode}`;
    if (newMode === 'vsbot') targetMenuId = 'menu-bot'; 

    const activeBtn = document.getElementById(targetMenuId);
    if (activeBtn) activeBtn.classList.add('menu-item-active');

    if (state.appMode === newMode && customFen === START_FEN) {
        closeModal('main-menu-modal');
        return;
    }

    showLoading("Đang tải dữ liệu...");

    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;

    const btnAnalyze = document.getElementById('btn-analyze');
    if (btnAnalyze) btnAnalyze.classList.remove('tool-active');

    const btnRed = document.getElementById('btn-ai-red');
    if (btnRed) btnRed.classList.remove('tool-active');

    const btnBlack = document.getElementById('btn-ai-black');
    if (btnBlack) btnBlack.classList.remove('tool-active');
    
    if (state.engineModule) {
        state.engineModule.sendCommand("stop");
    }
    if (state.appMode === 'memorize' || state.appMode === 'puzzle') {
        state.gameList = [];
    }

    setTimeout(async () => {
        closeModal('main-menu-modal');
        forceStopAIPlayers();
        
        state.appMode = newMode;
        state.appSettings.appMode = newMode;
        
        try { storage.saveSystem(state.appSettings); } catch(e) {}

        if (customFen !== START_FEN) {
            await initGame(customFen, false); 
        } else {
            await initGame(START_FEN, true); 
        }
        
        hideLoading(); 
    }, 50);
}

export function initEvents() {

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('main-menu-panel');
        const btnMenu = document.getElementById('btn-menu');
        if (menu && menu.classList.contains('show-menu') && !menu.contains(e.target) && !btnMenu.contains(e.target)) {
            closeModal('main-menu-modal'); 
        }
    });

    document.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT') return;

        if (state.appMode === 'vsbot' || state.appMode === 'memorize'|| state.appMode === 'puzzle') {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
                showToast("Bạn không thể tiến/lùi cờ trong chế độ Đấu Máy!");
                return;
            }
        }

        switch (e.code) {
            case 'ArrowUp': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode !== state.rootNode) { forceStopAIPlayers(); jumpToNode(state.rootNode); triggerEngineEvaluation(); }
                break;
            case 'ArrowDown': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay();
                if(state.currentNode.children.length) {
                    forceStopAIPlayers();
                    let temp = state.currentNode; 
                    while(temp.children.length) temp = temp.children[temp.mainLineIndex]; 
                    jumpToNode(temp); triggerEngineEvaluation(); 
                }
                break;
            case 'ArrowLeft': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode.parent) jumpToNode(state.currentNode.parent); 
                break;
            case 'ArrowRight': 
                e.preventDefault(); 
                if(state.isAutoPlaying) toggleAutoPlay(); 
                if(state.currentNode && state.currentNode.children.length) {
                    forceStopAIPlayers();
                    if (state.currentNode.children.length > 1) {
                        import('./ui.js').then(m => m.openModal('variation-modal', state.currentNode));
                    } else {
                        const idx = state.currentNode.mainLineIndex || 0;
                        const target = state.currentNode.children[idx] || state.currentNode.children[0];
                        if (target) jumpToNode(target);
                    }
                }
                break;
            case 'Space': 
                e.preventDefault(); 
                toggleAutoPlay();
                break;
        }
    });

    const btnUndo = document.getElementById('btn-undo');
    if (btnUndo) {
        btnUndo.onclick = () => {
            if (btnUndo.classList.contains('disabled')) return;
            
            import('./game.js').then(module => {
                if (state.appMode === 'memorize') {
                    module.forceStopAIPlayers();
                    if (state.memorizeSettings.side === 'both') {
                        if (state.currentNode.parent) module.jumpToNode(state.currentNode.parent);
                    } else {
                        if (state.currentNode.parent && state.currentNode.parent.parent) {
                            module.jumpToNode(state.currentNode.parent.parent);
                        }
                    }
                } else if (state.appMode === 'puzzle') {
                    module.undoVsBot();
                } else {
                    module.undoVsBot();
                }
            });
        };
    }

    const btnHint = document.getElementById('btn-hint');
    if (btnHint) {
        btnHint.onclick = () => {
            if (btnHint.classList.contains('disabled') || !state.engineModule) return;
            
            if (state.appMode === 'puzzle') {
                //showToast(`💡 Máy đang suy nghĩ nước giải...`);
                btnHint.classList.add('disabled');
                
                const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
                if (isRedTurn) state.aiPlaysRed = true; else state.aiPlaysBlack = true;
                
                import('./engine.js').then(module => {
                    module.triggerEngineEvaluation(); 
                });
                return;
            }
            
            const styleName = state.vsBotSettings.botStyle === 'human' ? 'Giống người' : 'Tiêu chuẩn';
            showToast(`💡 AI đang dùng Level 10 (${styleName}) để nghĩ nước đi...`);
            
            btnHint.classList.add('disabled');
            
            import('./engine.js').then(module => {
                module.triggerHintEvaluation();
            });
        };
    }

    function checkBlockedNav(e) {
        if (state.appMode === 'vsbot' || state.appMode === 'memorize'|| state.appMode === 'puzzle') {
            e.preventDefault(); e.stopPropagation();
            showToast("Bạn không thể tiến/lùi cờ trong chế độ này!");
            return true;
        }
        return false;
    }

    const btnAutoPlay = document.getElementById('btn-auto-play');
    if(btnAutoPlay) btnAutoPlay.onclick = (e) => { if(checkBlockedNav(e)) return; toggleAutoPlay(); };
    
    const btnStart = document.getElementById('btn-start');
    if(btnStart) btnStart.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode !== state.rootNode) { forceStopAIPlayers(); jumpToNode(state.rootNode); triggerEngineEvaluation(); }
    };
    
    const btnPrev = document.getElementById('btn-prev');
    if(btnPrev) btnPrev.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode.parent) { forceStopAIPlayers(); jumpToNode(state.currentNode.parent); }
    };
    
    const btnNext = document.getElementById('btn-next');
    if(btnNext) btnNext.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay(); 
        if(state.currentNode && state.currentNode.children.length) { 
            forceStopAIPlayers(); 
            if (state.currentNode.children.length > 1) {
                // HÀM TỰ ĐỘNG BẬT THÔNG BÁO CHỌN NƯỚC ĐI NÀO KHI CÓ NHIỀU HƠN 1 BIẾN CON
                import('./ui.js').then(m => m.openModal('variation-modal', state.currentNode));
            } else {
                const idx = state.currentNode.mainLineIndex || 0;
                const target = state.currentNode.children[idx] || state.currentNode.children[0];
                if (target) jumpToNode(target);
            }
        }
    };
    
    const btnEnd = document.getElementById('btn-end');
    if(btnEnd) btnEnd.onclick = (e) => { 
        if(checkBlockedNav(e)) return;
        if(state.isAutoPlaying) toggleAutoPlay();
        if(state.currentNode && state.currentNode.children.length) {
            forceStopAIPlayers();
            let temp = state.currentNode; 
            while(temp.children.length) {
                const idx = temp.mainLineIndex || 0;
                temp = temp.children[idx] || temp.children[0];
            }
            if (temp) { jumpToNode(temp); triggerEngineEvaluation(); }
        }
    };

    const btnMenu = document.getElementById('btn-menu');
    if(btnMenu) {
        btnMenu.onclick = () => { 
            btnMenu.classList.add('tool-active'); 
            setTimeout(() => btnMenu.classList.remove('tool-active'), 200); 
            
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) {
                activeBtn.classList.add('menu-item-active');
            }

            openModal('main-menu-modal');
        };
    }

    const btnCloseMainMenu = document.getElementById('btn-close-main-menu');
    if(btnCloseMainMenu) btnCloseMainMenu.onclick = () => { closeModal('main-menu-modal'); };
    
    const menuAnalyze = document.getElementById('menu-analyze');
    if(menuAnalyze) menuAnalyze.onclick = () => { switchMode('analyze'); };
    
    // ====== Đấu Vs Bot ======
    const menuBot = document.getElementById('menu-bot');
    if(menuBot) {
        menuBot.onclick = async () => { 
            try {
                const workspace = await getWorkspace('vsbot_workspace');
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    switchMode('vsbot');
                } else {
                    state.vsBotSetupOrigin = 'menu'; 
                    closeModal('main-menu-modal');
                    document.getElementById('setup-bot-fen').value = START_FEN;
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                }
            } catch (e) {
                state.vsBotSetupOrigin = 'menu';
                closeModal('main-menu-modal');
                openModal('vsbot-setup-modal');
            }
        };
    }

    document.getElementById('btn-setup-cancel').onclick = () => {
        closeModal('vsbot-setup-modal');
        
        if (state.vsBotSetupOrigin === 'menu') {
            openModal('main-menu-modal');
        } 
        else if (state.vsBotSetupOrigin === 'import_mode') {
        }
        else if (state.vsBotSetupOrigin === 'edit_mode') {
            state.currentNode = state.preEditNode;
            state.currentStepNum = state.preEditStepNum;
            state.currentSituation = vschess.fenToSituation(state.currentNode.fen);
            
            renderBoardFull(state.currentSituation); 
            renderMoveHistory();
            
            const commentBox = document.getElementById('comment-box');
            if (commentBox) commentBox.value = state.currentNode.comment || "";
            
            if (state.vsBotSettings.botColor === 'red') state.aiPlaysRed = true;
            else state.aiPlaysBlack = true;
            
            triggerEngineEvaluation();
            
            import('./game.js').then(module => module.updateVsBotToolButtons());
        }
    };
    document.getElementById('btn-setup-confirm').onclick = () => {
        let fenInput = document.getElementById('setup-bot-fen').value.trim();
        if (fenInput.includes("moves")) {
            showToast("❌ Không được nhập biên bản nước đi. Chỉ chấp nhận mã hình cờ FEN!");
            return;
        }

        if (!fenInput.includes(" w ") && !fenInput.includes(" b ")) {
            fenInput += " w - - 0 1";
        }

        const errorList = vschess.checkFen(fenInput);
        if (errorList && errorList.length > 0) {
            const vnError = translateVschessError(errorList[0]);
            showToast(`❌ ${vnError}`);
            return;
        }

        const isRedTurn = fenInput.split(" ")[1] === "w";
        const botRole = document.getElementById('setup-bot-first').value; 
        
        if (botRole === 'bot') {
            state.vsBotSettings.botColor = isRedTurn ? "red" : "black";
        } else {
            state.vsBotSettings.botColor = isRedTurn ? "black" : "red";
        }

        state.vsBotSettings.botStyle = document.getElementById('setup-bot-style').value;
        
        const mainStyle = document.getElementById('input-bot-style');
        if(mainStyle) mainStyle.value = state.vsBotSettings.botStyle;
        
        storage.saveVsBot(state.vsBotSettings);
        
        closeModal('vsbot-setup-modal');

        if (state.appMode === 'vsbot') {
            initGame(fenInput, false); 
        } else {
            switchMode('vsbot', fenInput); 
        }
    };

    const menuBlind = document.getElementById('menu-blind');
    if(menuBlind) {
        menuBlind.onclick = async () => { 
            try {
                const workspace = await getWorkspace('blind_workspace');
                if (workspace && workspace.gameList && workspace.gameList.length > 0) {
                    switchMode('blind'); 
                } else {
                    switchMode('blind', START_FEN); 
                }
            } catch (e) {
                switchMode('blind', START_FEN);
            }
        };
    }

    // ====== Giải Bài Tập ======
    const menuPuzzle = document.getElementById('menu-puzzle');
    if (menuPuzzle) {
        menuPuzzle.onclick = () => { 
            closeModal('main-menu-modal'); 
            if (state.appMode === 'puzzle') return; 
            
            state.puzzleOpenedFromMenu = true; 
            
            openModal('puzzle-modal');
            
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            } else {
                state.puzzleHistory = [];
                state.currentPuzzleFolder = { path: 'data', name: '' };
                loadPuzzleManifest(state.currentPuzzleFolder.path, state.currentPuzzleFolder.name);
            }
        };
    }

    const btnPuzzleClose = document.getElementById('btn-puzzle-close');
    if (btnPuzzleClose) btnPuzzleClose.onclick = () => {
        closeModal('puzzle-modal');
        if (state.puzzleOpenedFromMenu) {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) activeBtn.classList.add('menu-item-active');
            openModal('main-menu-modal');
        }
    };

    const btnPuzzleBack = document.getElementById('btn-puzzle-back');
    if (btnPuzzleBack) btnPuzzleBack.onclick = () => {
        const subtitle = document.getElementById('puzzle-modal-subtitle');

        if (state.isViewingPuzzleFens) {
            state.isViewingPuzzleFens = false;
            document.getElementById('puzzle-fen-view').style.display = 'none';
            document.getElementById('puzzle-manifest-view').style.display = 'flex';
            
            if (state.currentPuzzleFolder.name) {
                subtitle.innerText = state.currentPuzzleFolder.name;
                subtitle.style.display = 'block';
            } else {
                subtitle.style.display = 'none'; 
            }
            
            if (state.puzzleHistory.length === 0) btnPuzzleBack.style.display = 'none';
        } 
        else if (state.puzzleHistory.length > 0) {
            const prevFolder = state.puzzleHistory.pop();
            state.currentPuzzleFolder = prevFolder; 
            loadPuzzleManifest(prevFolder.path, prevFolder.name, true);
        }
    };

    const btnNewList = document.getElementById('btn-new-list');
    if (btnNewList) {
        btnNewList.onclick = () => {
            closeModal('new-game-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            }
        };
    }

    const btnPuzResList = document.getElementById('btn-puz-res-list');
    if (btnPuzResList) {
        btnPuzResList.onclick = () => {
            closeModal('puzzle-result-modal');
            state.puzzleOpenedFromMenu = false;
            
            openModal('puzzle-modal');
            
            if (state.isViewingPuzzleFens) {
                setTimeout(() => refreshPuzzleListUI(), 100);
            }
        };
    }

    const btnPuzResRetry = document.getElementById('btn-puz-res-retry');
    if (btnPuzResRetry) {
        btnPuzResRetry.onclick = () => {
            closeModal('puzzle-result-modal');
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                state.rootNode.children = [];
                state.rootNode.mainLineIndex = 0;
                m.instantJumpToNode(state.rootNode);
                
                const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
                state.aiPlaysRed = !isRedFirst;
                state.aiPlaysBlack = isRedFirst;
                m.updateVsBotToolButtons();
            });
        };
    }

    const btnPuzResNext = document.getElementById('btn-puz-res-next');
    if (btnPuzResNext) {
        btnPuzResNext.onclick = () => {
            closeModal('puzzle-result-modal');
            if (state.currentPuzzleIndex < state.puzzleFens.length - 1) {
                state.currentPuzzleIndex++;
                saveWorkspace('puz_prog_' + state.currentPuzzleSolvedKey, state.currentPuzzleIndex);
                const nextFen = state.puzzleFens[state.currentPuzzleIndex];
                switchMode('puzzle', nextFen);
                //showToast(`Đã mở bài số ${state.currentPuzzleIndex + 1}!`);
            }
        };
    }
    
    // ====== Luyện Nhớ Ván ======
    const menuOpening = document.getElementById('menu-memorize');
    if(menuOpening) {
        menuOpening.onclick = () => { 
            if (state.appMode === 'memorize') {
                closeModal('main-menu-modal');
                return;
            }
            closeModal('main-menu-modal');
            state.memorizeOpenedFromMenu = true; 
            openModal('memorize-modal');
            renderMemorizeList();
        };
    }
    const btnMemoClose = document.getElementById('btn-memo-close');
    if (btnMemoClose) btnMemoClose.onclick = () => {
        closeModal('memorize-modal');
        
        if (state.memorizeOpenedFromMenu) {
            document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
            let currentModeId = `menu-${state.appMode}`;
            if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
            
            const activeBtn = document.getElementById(currentModeId);
            if(activeBtn) activeBtn.classList.add('menu-item-active');

            openModal('main-menu-modal');
        }
    };
    const memoFileUpload = document.getElementById('memorize-file-upload');
    if (memoFileUpload) {
        memoFileUpload.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const extension = file.name.split('.').pop().toLowerCase();
            const validBinary = ['xqf', 'cbr', 'ccm'];
            const validText = ['pgn', 'pfc', 'che'];
            
            const reader = new FileReader();
            showLoading(`Đang đọc tệp ${file.name}...`);

            if (validBinary.includes(extension)) {
                reader.onload = (ev) => {
                    try {
                        const buffer = new Uint8Array(ev.target.result);
                        let nodeData, infoData;
                        if (extension === 'xqf') { nodeData = vschess.binaryToNode_XQF(buffer); infoData = vschess.binaryToInfo_XQF(buffer); }
                        else if (extension === 'cbr') { nodeData = vschess.binaryToNode_CBR(buffer); infoData = vschess.binaryToInfo_CBR(buffer); }
                        else if (extension === 'ccm') { nodeData = vschess.binaryToNode_CCM(buffer); }
                        
                        if (nodeData && nodeData.fen) {
                            state.pendingMemorizeData = { node: nodeData, info: infoData || {} };
                            closeModal('memorize-modal');
                            openModal('memorize-setup-modal');
                        } else showToast("❌ Lỗi đọc File!");
                    } catch (err) { showToast("❌ Có lỗi xảy ra!"); }
                    hideLoading();
                };
                reader.readAsArrayBuffer(file);
            } 
            else if (validText.includes(extension)) {
                reader.onload = (ev) => {
                    try {
                        const textData = ev.target.result;
                        let nodeData, infoData;
                        if (extension === 'pgn') { nodeData = vschess.dataToNode_PGN(textData); infoData = vschess.dataToInfo_PGN(textData); }
                        else if (extension === 'pfc') { nodeData = vschess.dataToNode_PFC(textData); infoData = vschess.dataToInfo_PFC(textData); }
                        else if (extension === 'che') { nodeData = vschess.dataToNode_QQNew(textData); }
                        
                        if (nodeData && nodeData.fen) {
                            state.pendingMemorizeData = { node: nodeData, info: infoData || {} };
                            closeModal('memorize-modal');
                            openModal('memorize-setup-modal');
                        } else showToast("❌ Lỗi đọc File!");
                    } catch (err) { showToast("❌ Có lỗi xảy ra!"); }
                    hideLoading();
                };
                reader.readAsText(file);
            } else {
                hideLoading();
                showToast(`❌ Định dạng .${extension} không được hỗ trợ!`);
            }
            e.target.value = '';
        };
    }

    const memoSetupBlind = document.getElementById('memo-setup-blind');
    const memoSetupPath = document.getElementById('memo-setup-path');
    const memoSetupMethod = document.getElementById('memo-setup-method');
    function syncMemoUI() {
        if (!memoSetupBlind || !memoSetupPath || !memoSetupMethod) return;

        memoSetupPath.disabled = false;
        memoSetupPath.style.opacity = '1';
        memoSetupBlind.disabled = false;
        memoSetupBlind.parentElement.style.opacity = '1';
        memoSetupMethod.disabled = false;
        memoSetupMethod.style.opacity = '1';

        if (memoSetupBlind.checked) {
            memoSetupMethod.value = 'full';
            memoSetupMethod.disabled = true;
            memoSetupMethod.style.opacity = '0.5';

            memoSetupPath.value = 'random';
            memoSetupPath.disabled = true;
            memoSetupPath.style.opacity = '0.5';
        } 
        else if (memoSetupMethod.value === 'segment') {
            memoSetupPath.value = 'main';
            memoSetupPath.disabled = true;
            memoSetupPath.style.opacity = '0.5';

            memoSetupBlind.checked = false;
            memoSetupBlind.disabled = true;
            memoSetupBlind.parentElement.style.opacity = '0.5';
        }
    }

    if (memoSetupBlind) memoSetupBlind.onchange = syncMemoUI;
    if (memoSetupPath) memoSetupPath.onchange = syncMemoUI;
    if (memoSetupMethod) memoSetupMethod.onchange = syncMemoUI;

    const btnMemoSetupCancel = document.getElementById('btn-memo-setup-cancel');
    if (btnMemoSetupCancel) {
        btnMemoSetupCancel.onclick = () => {
            state.pendingMemorizeData = null; 
            closeModal('memorize-setup-modal');
            openModal('memorize-modal');
        };
    }

    const btnMemoSetupConfirm = document.getElementById('btn-memo-setup-confirm');
    if (btnMemoSetupConfirm) {
        btnMemoSetupConfirm.onclick = () => {
            if (!state.pendingMemorizeData) return;
            
            state.memorizeSettings.side = document.getElementById('memo-setup-side').value;
            state.memorizeSettings.method = document.getElementById('memo-setup-method').value;
            state.memorizeSettings.path = document.getElementById('memo-setup-path').value;
            state.memorizeSettings.isBlind = document.getElementById('memo-setup-blind').checked;

            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;
            
            state.appMode = 'memorize';
            state.appSettings.appMode = 'memorize';
            
            state.isPeeking = !state.memorizeSettings.isBlind; 
            document.body.classList.remove('mode-vsbot', 'mode-blind', 'mode-memorize');
            document.body.classList.add('mode-memorize');
            if (state.memorizeSettings.isBlind) {
                document.body.classList.add('mode-blind');
            }

            const titleHeader = document.getElementById('tab-title');
            if (titleHeader) {
                titleHeader.innerHTML = `
                    <strong style="font-size: 17px; color: #333; display: block; width: 100%;">LUYỆN NHỚ VÁN</strong>
                    <div id="blind-turn-indicator" style="display:block; margin-top: 15px; font-size: 16px; font-weight: bold; color: #555;">
                        Lượt đi: <span id="blind-turn-text">Bên Đỏ</span>
                    </div>
                    <div id="memo-mistakes-indicator" style="display: flex; justify-content: center; gap: 15px; margin-top: 5px; font-size: 13px; font-weight: bold;">
                        <span style="color: #d32f2f;">Đỏ đi sai: <span id="memo-err-red">0</span></span>
                        <span style="color: #000;">Đen đi sai: <span id="memo-err-black">0</span></span>
                    </div>
                    <div id="memo-variation-container" style="display: none; margin-top: 15px; width: 100%; flex-direction: column; gap: 8px;">
                        <div style="font-size: 13px; color: #d32f2f; margin-bottom: 5px;">Mời bạn chọn biến:</div>
                    </div>
                `;
            }

            import('./game.js').then(m => {
                m.forceStopAIPlayers();

                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                else { state.aiPlaysRed = false; state.aiPlaysBlack = false; }

                state.gameList = [{ info: state.pendingMemorizeData.info, node: state.pendingMemorizeData.node }];
                m.loadGameFromList(0); 
                
                let pathNodes = [];
                let curr = state.rootNode;
                while(curr) {
                    pathNodes.push(curr);
                    if(curr.children.length > 0) curr = curr.children[0];
                    else break;
                }
                
                let totalMoves = pathNodes.length - 1; 

                if (state.memorizeSettings.method === 'segment' && totalMoves > 6) {
                    let maxStart = totalMoves - 6;
                    let startIdx = Math.floor(Math.random() * (maxStart + 1));
                    let maxLen = totalMoves - startIdx;
                    let len = Math.floor(Math.random() * (maxLen - 6 + 1)) + 6;
                    let endIdx = startIdx + len;

                    state.memorizeSettings.startNodeId = pathNodes[startIdx].id;
                    state.memorizeSettings.endNodeId = pathNodes[endIdx].id;
                    
                    m.instantJumpToNode(pathNodes[startIdx]);
                } else {
                    state.memorizeSettings.startNodeId = pathNodes[0].id;
                    state.memorizeSettings.endNodeId = pathNodes[pathNodes.length - 1].id;
                    m.instantJumpToNode(pathNodes[0]);
                }

                m.applyAutoBoardFlip();
                setTimeout(() => m.triggerMemorizeBot(), 300);
            });

            closeModal('memorize-setup-modal');
            //showToast("✅ Bắt đầu Luyện Nhớ Ván!");
        };
    }
    const btnMemoRetry = document.getElementById('btn-memo-retry');
    if (btnMemoRetry) {
        btnMemoRetry.onclick = () => {
            closeModal('memo-gameover-modal');
            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;
            
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                
                function findNodeById(node, id) {
                    if (node.id === id) return node;
                    for(let c of node.children) {
                        let found = findNodeById(c, id);
                        if (found) return found;
                    }
                    return null;
                }
                
                let startNode = findNodeById(state.rootNode, state.memorizeSettings.startNodeId) || state.rootNode;
                m.instantJumpToNode(startNode); 
                
                const side = state.memorizeSettings.side;
                if (side === 'red') { state.aiPlaysRed = false; state.aiPlaysBlack = true; }
                else if (side === 'black') { state.aiPlaysRed = true; state.aiPlaysBlack = false; }
                else { state.aiPlaysRed = false; state.aiPlaysBlack = false; }
                
                m.updateBlindTurnUI();
                setTimeout(() => m.triggerMemorizeBot(), 300);
            });
        };
    }
    const btnMemoNew = document.getElementById('btn-memo-new');
    if (btnMemoNew) {
        btnMemoNew.onclick = () => {
            closeModal('memo-gameover-modal');

            state.memoMistakesRed = 0;
            state.memoMistakesBlack = 0;

            state.memorizeOpenedFromMenu = false;
            openModal('memorize-modal');
            renderMemorizeList(); 
        };
    }

     // ====== Thư Viện ======
    const menuLibrary = document.getElementById('menu-library');
    if (menuLibrary) {
        menuLibrary.onclick = () => {
            closeModal('main-menu-modal');
            const libTabBtn = document.querySelector('#panel-history .lower-tab-btn[data-tab="library"]');
            if (libTabBtn) libTabBtn.click();
        };
    }
    const btnDelLibCancel = document.getElementById('btn-del-lib-cancel');
    if (btnDelLibCancel) btnDelLibCancel.onclick = () => closeModal('delete-lib-modal');

    const btnDelLibConfirm = document.getElementById('btn-del-lib-confirm');
    if (btnDelLibConfirm) btnDelLibConfirm.onclick = () => confirmDeleteLibraryAction();

    // ====== Setting ======
    const menuSettings = document.getElementById('menu-settings');
    if(menuSettings) menuSettings.onclick = () => { 
        closeModal('main-menu-modal'); 
        
        if (state.appMode === 'vsbot') {
            document.getElementById('settings-group-pikafish').style.display = 'none';
            document.getElementById('settings-group-vsbot').style.display = 'block';
        } else {
            document.getElementById('settings-group-pikafish').style.display = 'block';
            document.getElementById('settings-group-vsbot').style.display = 'none';
        }

        openModal('settings-modal'); 
    };

    const btnSettingsBack = document.getElementById('btn-settings-back');
    if(btnSettingsBack) btnSettingsBack.onclick = () => { 
        closeModal('settings-modal'); 
        if (state.appMode !== 'vsbot') applyEngineSettings(); 
        
        document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
        let currentModeId = `menu-${state.appMode}`;
        if (state.appMode === 'vsbot') currentModeId = 'menu-bot';
        
        const activeBtn = document.getElementById(currentModeId);
        if(activeBtn) activeBtn.classList.add('menu-item-active');
            
        openModal('main-menu-modal'); 
    };

    let maxThreads = 1; 
    if (navigator.deviceMemory) {
        maxThreads = Math.max(1, Math.floor(navigator.deviceMemory / 2));
    } else if (navigator.hardwareConcurrency) {
        maxThreads = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
    }
    if (maxThreads > 16) maxThreads = 16;
    
    const tier = getDeviceTier();
    let maxHash = 512, maxDepth = 100;
    if (tier === 'MOBILE_HIGH') { maxHash = 512; maxDepth = 60; }
    if (tier === 'MOBILE_LOW') { maxHash = 128; maxDepth = 30; maxThreads = 1; }

    const inputThreads = document.getElementById('input-threads');
    if (inputThreads) inputThreads.max = maxThreads;
    
    const descThreads = document.getElementById('desc-threads');
    if (descThreads) descThreads.innerText = tier === 'MOBILE_LOW' ? `Tối đa: 1 luồng (Dành cho máy yếu)` : `Tối đa: ${maxThreads} luồng (Tự động theo RAM)`;

    if (state.aiSettings.threads > maxThreads) {
        state.aiSettings.threads = maxThreads;
        if (inputThreads) inputThreads.value = maxThreads;
    }

    document.getElementById('input-hash')?.setAttribute('max', maxHash);
    document.getElementById('input-depth')?.setAttribute('max', maxDepth);

    setupStepper('skill', 'input-skill', 'btn-skill-minus', 'btn-skill-plus', 0, 20, 1, false, 'ai');
    setupStepper('threads', 'input-threads', 'btn-threads-minus', 'btn-threads-plus', 1, maxThreads, 1, false, 'ai');
    setupStepper('hash', 'input-hash', 'btn-hash-minus', 'btn-hash-plus', 32, maxHash, 32, true, 'ai');
    setupStepper('multiPV', 'input-multipv', 'btn-multipv-minus', 'btn-multipv-plus', 1, 5, 1, false, 'ai');
    setupStepper('moveTime', 'input-time', 'btn-time-minus', 'btn-time-plus', 0.5, 300, 0.5, false, 'ai');
    setupStepper('depth', 'input-depth', 'btn-depth-minus', 'btn-depth-plus', 1, maxDepth, 1, false, 'ai');
    setupStepper('cloudBookLimit', 'input-cloudlimit', 'btn-cloudlimit-minus', 'btn-cloudlimit-plus', 1, 50, 1, false, 'app');
    setupStepper('level', 'input-botlevel', 'btn-botlevel-minus', 'btn-botlevel-plus', 1, 10, 1, false, 'bot');
    setupStepper('level', 'input-setup-level', 'btn-setup-level-minus', 'btn-setup-level-plus', 1, 10, 1, false, 'bot');
    
    const inputBotStyle = document.getElementById('input-bot-style');
    if(inputBotStyle) {
        inputBotStyle.value = state.vsBotSettings.botStyle || "standard";
        inputBotStyle.onchange = (e) => {
            state.vsBotSettings.botStyle = e.target.value;
            storage.saveVsBot(state.vsBotSettings); 
            const setupStyle = document.getElementById('setup-bot-style');
            if(setupStyle) setupStyle.value = e.target.value;
            import('./game.js').then(module => module.updateVsBotToolButtons());
        };
    }
    
    const setupBotStyle = document.getElementById('setup-bot-style');
    if (setupBotStyle) {
        setupBotStyle.onchange = (e) => {
            state.vsBotSettings.botStyle = e.target.value;
            storage.saveVsBot(state.vsBotSettings);
            if (inputBotStyle) inputBotStyle.value = e.target.value;
            import('./game.js').then(module => module.updateVsBotToolButtons());
        };
    }

    const toggleAnimation = document.getElementById('toggle-animation');
    const toggleArrows = document.getElementById('toggle-arrows');
    const toggleSound = document.getElementById('toggle-sound');
    const toggleCloudbook = document.getElementById('toggle-cloudbook');

    if(toggleAnimation) toggleAnimation.checked = state.appSettings.animation;
    if(toggleArrows) toggleArrows.checked = state.appSettings.arrows;
    if(toggleSound) toggleSound.checked = state.appSettings.sound;
    if(toggleCloudbook) toggleCloudbook.checked = state.appSettings.cloudBookEnabled;

    if(toggleAnimation) toggleAnimation.onchange = (e) => {
        state.appSettings.animation = e.target.checked;
        storage.saveSystem(state.appSettings);
    };
    if(toggleArrows) {
        toggleArrows.onchange = (e) => {
            state.appSettings.arrows = e.target.checked;
            storage.saveSystem(state.appSettings);
            drawBestMoveArrow();
        };
    }
    if(toggleSound) toggleSound.onchange = (e) => {
        state.appSettings.sound = e.target.checked;
        storage.saveSystem(state.appSettings);
    };
    if(toggleCloudbook) toggleCloudbook.onchange = (e) => {
        state.appSettings.cloudBookEnabled = e.target.checked;
        storage.saveSystem(state.appSettings);
    };

    const btnImport = document.getElementById('btn-import');
    if(btnImport) btnImport.onclick = () => { 
        const btnImportFile = document.getElementById('btn-import-file');
        const importText = document.getElementById('import-text');
        
        if (state.appMode === 'vsbot') {
            if (btnImportFile) btnImportFile.style.display = 'none'; 
            if (importText) importText.placeholder = "Chỉ dán mã FEN hình cờ tĩnh vào đây...";
        } else {
            if (btnImportFile) btnImportFile.style.display = 'flex'; 
            if (importText) importText.placeholder = "Dán mã FEN, PGN hoặc UBB vào đây...";
        }
        openModal('import-modal'); 
    };
    
    const btnExport = document.getElementById('btn-export');
    if(btnExport) btnExport.onclick = () => { openModal('export-modal'); };

    const btnFlip = document.getElementById('btn-flip');
    if(btnFlip) {
        btnFlip.onclick = (e) => {
            state.isBoardFlipped = !state.isBoardFlipped; 
            if(state.isBoardFlipped) { 
                document.getElementById('chess-board-area').classList.add('board-flipped'); btnFlip.classList.add('tool-active');
            } else { 
                document.getElementById('chess-board-area').classList.remove('board-flipped'); btnFlip.classList.remove('tool-active');
            }
        };
    }

    const btnPeek = document.getElementById('btn-peek');
    if (btnPeek) {
        btnPeek.onclick = () => {
            state.isPeeking = !state.isPeeking;
            const eyeClosed = document.getElementById('icon-eye-closed');
            const eyeOpen = document.getElementById('icon-eye-open');
            
            if (state.isPeeking) {
                btnPeek.classList.add('tool-active');
                if (eyeClosed) eyeClosed.style.display = 'none';
                if (eyeOpen) eyeOpen.style.display = 'block';
            } else {
                btnPeek.classList.remove('tool-active');
                if (eyeClosed) eyeClosed.style.display = 'block';
                if (eyeOpen) eyeOpen.style.display = 'none';
            }
            
            import('./board.js').then(module => {
                module.renderBoardFull(state.currentSituation);
            });
        };
    }

    const btnRed = document.getElementById('btn-ai-red');
    const btnBlack = document.getElementById('btn-ai-black');
    const btnAnalyze = document.getElementById('btn-analyze');

    function toggleAI(colorFlag) {
        if (colorFlag === 'red') {
            state.aiPlaysRed = !state.aiPlaysRed;
            if (state.aiPlaysRed) {
                if(btnRed) btnRed.classList.add('tool-active');
                state.isAnalyzing = false; if(btnAnalyze) btnAnalyze.classList.remove('tool-active');
            } else { if(btnRed) btnRed.classList.remove('tool-active'); }
        } 
        else if (colorFlag === 'black') {
            state.aiPlaysBlack = !state.aiPlaysBlack;
            if (state.aiPlaysBlack) {
                if(btnBlack) btnBlack.classList.add('tool-active');
                state.isAnalyzing = false; if(btnAnalyze) btnAnalyze.classList.remove('tool-active');
            } else { if(btnBlack) btnBlack.classList.remove('tool-active'); }
        }
        
        if (state.aiPlaysRed || state.aiPlaysBlack || state.isAnalyzing) {
            triggerEngineEvaluation();
        }
        resetAIUI();
        updateEngineToggleButtonUI();
    }

    if(btnRed) btnRed.onclick = () => toggleAI('red');
    if(btnBlack) btnBlack.onclick = () => toggleAI('black');

    if(btnAnalyze) {
        btnAnalyze.onclick = () => {
            state.isAnalyzing = !state.isAnalyzing;
            if (state.isAnalyzing) {
                btnAnalyze.classList.add('tool-active');
                state.aiPlaysRed = false; if(btnRed) btnRed.classList.remove('tool-active');
                state.aiPlaysBlack = false; if(btnBlack) btnBlack.classList.remove('tool-active');
                
                if (!state.hasAutoSwitchedToAnalyze) {
                    const pikaTab = document.querySelector('.ai-tab-btn[data-tab="pikafish"]');
                    if (pikaTab) pikaTab.click();
                    state.hasAutoSwitchedToAnalyze = true;
                }
                
                triggerEngineEvaluation(); 
            } else {
                btnAnalyze.classList.remove('tool-active');
            }
            
            resetAIUI();
            updateEngineToggleButtonUI();
        };
    }

    const btnGoInstant = document.getElementById('btn-go-instant');
    if(btnGoInstant) {
        btnGoInstant.onclick = () => {
            if (!state.isAnalyzing) {
                showToast("Vui lòng Bật chế độ 'Phân Tích' trước khi Đi ngay!");
                return; 
            }
            if (state.engineModule && vschess.hasLegalMove(state.currentSituation)) {
                btnGoInstant.classList.add('tool-active');
                
                import('./engine.js').then(module => {
                    module.triggerGoInstant();
                });
                
                const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
                if (isRedTurn) state.aiPlaysRed = true; else state.aiPlaysBlack = true;
                
                setTimeout(() => {
                    btnGoInstant.classList.remove('tool-active');
                    if (isRedTurn) state.aiPlaysRed = false; else state.aiPlaysBlack = false;
                }, 500);
            }
        };
    }

    const btnReview = document.getElementById('btn-review');
    if (btnReview) {
        btnReview.onclick = () => {
            Promise.all([
                import('./engine.js'),
                import('./analysis/blunder.js')
            ]).then(async ([engineModule, blunderModule]) => {
                if (!state.engineModule) {
                    await engineModule.initPikafish();
                }
                
                if (!Array.isArray(engineModule.engineOutputListeners)) {
                    engineModule.engineOutputListeners = [];
                }

                const engineManagerInstance = {
                    currentWasmType: engineModule.currentWasmType || 'standard',
                    outputCallbacks: engineModule.engineOutputListeners,
                    onOutput(callback) {
                        if (!Array.isArray(engineModule.engineOutputListeners)) {
                            engineModule.engineOutputListeners = [];
                        }
                        engineModule.engineOutputListeners.push(callback);
                    },
                    sendCommand(cmd) {
                        if (state.engineModule && typeof state.engineModule.sendCommand === 'function') {
                            state.engineModule.sendCommand(cmd);
                        }
                    },
                    stopSearch() {
                        if (state.engineModule && typeof state.engineModule.sendCommand === 'function') {
                            state.engineModule.sendCommand("stop");
                        }
                    }
                };

                blunderModule.runAutoGameReview(engineManagerInstance, (completed, total, node) => {
                    console.log(`[Auto Review] Đang quét: ${completed}/${total} nước. Điểm chênh lệch NAG: ${node.centipawnLoss || 0} (${node.moveQuality.name})`);
                });
            }).catch(err => {
                console.error("Lỗi khi khởi chạy Auto Game Review:", err);
                showToast("❌ Không thể chạy phân tích sai lầm ván đấu!");
            });
        };
    }

    // Tab của panel-ai (trên)
    document.querySelectorAll('#panel-ai .ai-tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('#panel-ai .ai-tab-btn').forEach(b => b.classList.remove('tab-active'));
            e.target.classList.add('tab-active');
            const tabName = e.target.getAttribute('data-tab');
            document.querySelectorAll('#panel-ai .ai-content').forEach(box => box.style.display = 'none');
            const target = document.getElementById(`tab-${tabName}`);
            if (target) target.style.display = 'block';
        };
    });

    // Tab phụ ở dưới (Biên bản, Cloud Book, Thư viện, Ghi chú)
    document.querySelectorAll('#panel-history .lower-tab-btn').forEach(btn => {
        btn.onclick = async (e) => {
            document.querySelectorAll('#panel-history .lower-tab-btn').forEach(b => b.classList.remove('tab-active'));
            e.target.classList.add('tab-active');
            const tabName = e.target.getAttribute('data-tab');
            document.querySelectorAll('#panel-history .lower-tab-content').forEach(box => box.style.display = 'none');
            const targetBox = document.getElementById(`tab-${tabName}`);
            if (targetBox) {
                targetBox.style.display = (tabName === 'library' || tabName === 'history') ? 'flex' : 'block';
            }
            if (tabName === 'library') {
                const { renderLibraryList } = await import('./ui.js');
                await renderLibraryList();
            }
        };
    });

    // Nút Bật/Tắt Thẩm nhanh ở góc Engine Bar
    const btnEngineToggle = document.getElementById('btn-engine-toggle');
    if (btnEngineToggle) {
        btnEngineToggle.onclick = () => {
            const btnAnalyze = document.getElementById('btn-analyze');
            if (btnAnalyze) btnAnalyze.click();
        };
    }

    // Chọn nhanh số biến phân tích MultiPV ở Engine Bar
    const engineMultiPvSelect = document.getElementById('engine-multipv-select');
    if (engineMultiPvSelect) {
        engineMultiPvSelect.value = state.aiSettings.multiPV || 3;
        engineMultiPvSelect.onchange = async (e) => {
            const val = parseInt(e.target.value);
            state.aiSettings.multiPV = val;
            storage.saveAnalysis(state.aiSettings);
            
            if (state.engineModule) {
                state.engineModule.sendCommand(`setoption name MultiPV value ${val}`);
            }
            
            // Áp dụng trực tiếp nếu đang chạy Pikafish
            if (state.isAnalyzing || state.aiPlaysRed || state.aiPlaysBlack) {
                const { triggerEngineEvaluation } = await import('./engine.js');
                triggerEngineEvaluation();
            }
            
            // Đồng bộ sang giao diện cài đặt chính
            const multipvInput = document.getElementById('engine-multipv');
            if (multipvInput) multipvInput.value = val;
        };
    }

    const commentBox = document.getElementById('comment-box');
    if (commentBox) { 
        commentBox.addEventListener('input', function() { 
            if (state.currentNode) {
                state.currentNode.comment = this.value; 
                const moveCommentInput = document.getElementById('move-comment-input');
                if (moveCommentInput) moveCommentInput.value = this.value;
            }
        }); 
    }

    const moveCommentInput = document.getElementById('move-comment-input');
    if (moveCommentInput) {
        moveCommentInput.addEventListener('input', function() {
            if (state.currentNode) {
                state.currentNode.comment = this.value;
                const commentBox = document.getElementById('comment-box');
                if (commentBox) commentBox.value = this.value;

                const moveNoteSection = document.getElementById('move-note-section');
                const noteHasBadge = document.getElementById('note-has-badge');
                const currentComment = this.value.trim();

                if (moveNoteSection) {
                    if (currentComment.length > 0) {
                        moveNoteSection.classList.add('has-note');
                        if (noteHasBadge) noteHasBadge.style.display = 'inline-block';
                    } else {
                        moveNoteSection.classList.remove('has-note');
                        if (noteHasBadge) noteHasBadge.style.display = 'none';
                    }
                }
                import('./board.js').then(m => {
                    m.autoAdjustNoteTextareaHeight();
                    m.renderMoveHistory();
                }).catch(() => {});
            }
        });
    }

    const btnToggleGraph = document.getElementById('btn-toggle-graph');
    if (btnToggleGraph) {
        btnToggleGraph.onclick = (e) => {
            e.stopPropagation();
            const graphWrapper = document.getElementById('eval-graph-wrapper');
            if (!graphWrapper) return;
            const isCollapsed = graphWrapper.classList.toggle('graph-collapsed');
            if (isCollapsed) {
                graphWrapper.style.height = '28px';
                btnToggleGraph.innerText = '▼';
            } else {
                graphWrapper.style.height = '95px';
                btnToggleGraph.innerText = '▲';
            }
            import('./analysis/eval-graph.js').then(m => m.renderEvalGraph()).catch(() => {});
        };
    }

    const btnToggleNote = document.getElementById('btn-toggle-note');
    if (btnToggleNote) {
        btnToggleNote.onclick = (e) => {
            e.stopPropagation();
            const noteSection = document.getElementById('move-note-section');
            if (!noteSection) return;
            const isCollapsed = noteSection.classList.toggle('collapsed');
            btnToggleNote.innerText = isCollapsed ? '▼' : '▲';
        };
    }

    const moveFlagSelect = document.getElementById('move-flag-select');
    if (moveFlagSelect) {
        moveFlagSelect.onchange = function() {
            if (state.currentNode) {
                state.currentNode.moveFlag = this.value;
                import('./board.js').then(module => {
                    module.renderMoveHistory();
                });
            }
        };
    }

    const btnSaveToLib = document.getElementById('btn-save-to-lib');
    if (btnSaveToLib) {
        btnSaveToLib.onclick = async () => {
            const { saveCurrentGameToLibrary } = await import('./io.js');
            await saveCurrentGameToLibrary();
        };
    }

    const varBtnConfirm = document.getElementById('var-btn-confirm');
    if(varBtnConfirm) varBtnConfirm.onclick = () => closeModal('variation-modal');
    
    const btnNewCancel = document.getElementById('btn-new-cancel');
    if(btnNewCancel) btnNewCancel.onclick = () => closeModal('new-game-modal');
    
    const btnNewGame = document.getElementById('btn-new-game');
    if(btnNewGame) {
        btnNewGame.onclick = () => {
            if (state.isEditMode) { initGame(); return; }

            if (state.appMode === 'memorize') {
                state.memorizeOpenedFromMenu = false;
                openModal('memorize-modal');
                renderMemorizeList();
                return;
            }
            
            if (state.appMode === 'vsbot') {
                state.vsBotSetupOrigin = 'toolbar'; 
                document.getElementById('setup-bot-fen').value = START_FEN;
                document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                openModal('vsbot-setup-modal');
            } else if (state.appMode === 'puzzle') {
                const modal = document.getElementById('new-game-modal');
                if(!modal) return;
                modal.querySelector('.modal-header').innerText = "Chơi Lại Bài Tập";
                modal.querySelector('.modal-body').innerHTML = `Bạn có muốn giải lại từ đầu không?<br>Lịch sử nước đi sẽ bị xóa.`;
                document.getElementById('btn-new-confirm').innerText = "Đồng Ý";
                const btnList = document.getElementById('btn-new-list');
                if(btnList) btnList.style.display = 'block';
                openModal('new-game-modal');
            } else {
                const btnList = document.getElementById('btn-new-list');
                if(btnList) btnList.style.display = 'none';
                if (state.rootNode.children.length === 0) { initGame(); return; }
                const modal = document.getElementById('new-game-modal');
                if(!modal) return;
                modal.querySelector('.modal-header').innerText = "Chơi Ván Mới";
                modal.querySelector('.modal-body').innerHTML = `Bạn có chắc chắn muốn chơi ván mới không?<br>Những nước đi trước đó sẽ bị hủy.`;
                document.getElementById('btn-new-confirm').innerText = "Đồng Ý";
                openModal('new-game-modal');
            }
        };
    }
    
    const btnNewConfirm = document.getElementById('btn-new-confirm');
    if(btnNewConfirm) btnNewConfirm.onclick = () => { 
        closeModal('new-game-modal'); 
        
        if (state.appMode === 'puzzle') {
            import('./game.js').then(m => {
                m.forceStopAIPlayers();
                state.rootNode.children = [];
                state.rootNode.mainLineIndex = 0;
                m.instantJumpToNode(state.rootNode); 
                
                const isRedFirst = state.rootNode.fen.split(" ")[1] === "w";
                state.aiPlaysRed = !isRedFirst;
                state.aiPlaysBlack = isRedFirst;
                m.updateVsBotToolButtons();
            });
        } else {
            initGame(); 
        }
    };

    const btnImportCancel = document.getElementById('btn-import-cancel');
    if(btnImportCancel) btnImportCancel.onclick = () => { document.getElementById('import-text').value = ''; closeModal('import-modal'); };
    
    const btnImportConfirm = document.getElementById('btn-import-confirm');
    if(btnImportConfirm) {
        btnImportConfirm.onclick = () => {
            const textData = document.getElementById('import-text').value.trim();
            if (textData) {
                if (state.appMode === 'vsbot') {
                    if (textData.toLowerCase().includes("moves") || textData.includes("[") || textData.includes("DhtmlXQ")) {
                        showToast("❌ Chế độ Đấu Máy chỉ chấp nhận mã FEN hình cờ tĩnh, không nhận biên bản nước đi!");
                        return;
                    }
                    
                    let fenInput = textData;
                    if (!fenInput.includes(" w ") && !fenInput.includes(" b ")) {
                        fenInput += " w - - 0 1";
                    }

                    const errorList = vschess.checkFen(fenInput);
                    if (errorList && errorList.length > 0) {
                        showToast(`❌ Mã FEN không hợp lệ!`);
                        return;
                    }

                    closeModal('import-modal');
                    document.getElementById('import-text').value = '';
                    
                    state.vsBotSetupOrigin = 'import_mode'; 
                    document.getElementById('setup-bot-fen').value = fenInput;
                    document.getElementById('setup-bot-style').value = state.vsBotSettings.botStyle || 'standard';
                    openModal('vsbot-setup-modal');
                    return;
                }

                showLoading("Đang xử lý dữ liệu...");
                setTimeout(() => {
                    try {
                        const nodeData = vschess.dataToNode(textData);
                        const infoData = vschess.dataToInfo(textData);

                        if (nodeData && nodeData.fen) {
                            state.gameList = [{ info: infoData, node: nodeData }];
                            loadGameFromList(0); 
                            
                            closeModal('import-modal');
                            saveGameState(); 
                            showToast("✅ Tải dữ liệu thành công!");
                        } else { 
                            showToast("❌ Định dạng không hợp lệ hoặc không được hỗ trợ!"); 
                        }
                    } catch (error) { 
                        showToast("❌ Lỗi khi phân tích dữ liệu! Hãy xem Console (F12)."); 
                    }
                    hideLoading();
                }, 100); 
                document.getElementById('import-text').value = '';
            } else { 
                closeModal('import-modal'); 
            }
        };
    }

    const fileUpload = document.getElementById('file-upload');
    if(fileUpload) fileUpload.onchange = (e) => handleFileUpload(e.target.files[0]);
    
    const imageUpload = document.getElementById('image-upload');
    if(imageUpload) imageUpload.onchange = (e) => handleImageRecognition(e.target.files[0]);
    
    const cameraUpload = document.getElementById('camera-upload');
    if(cameraUpload) cameraUpload.onchange = (e) => handleImageRecognition(e.target.files[0]);

    const btnOpenInfoModal = document.getElementById('btn-open-info-modal');
    if(btnOpenInfoModal) btnOpenInfoModal.onclick = () => { closeModal('export-modal'); openModal('info-modal'); };
    
    const btnInfoCancel = document.getElementById('btn-info-cancel');
    if(btnInfoCancel) btnInfoCancel.onclick = () => { closeModal('info-modal'); openModal('export-modal'); };
    
    const btnInfoConfirm = document.getElementById('btn-info-confirm');
    if(btnInfoConfirm) {
        btnInfoConfirm.onclick = () => {
            for (let key in state.currentGameInfo) {
                const input = document.getElementById(`info-${key}`);
                if (input) state.currentGameInfo[key] = input.value;
            }
            let rawComment = state.rootNode.comment.split("-------------------\n")[1] || "";
            state.rootNode.comment = formatGameInfoString(state.currentGameInfo, rawComment);
            if(state.currentNode === state.rootNode && document.getElementById('comment-box')) {
                document.getElementById('comment-box').value = state.rootNode.comment;
            }
            closeModal('info-modal');
            openModal('export-modal');
            showToast("✅ Cập nhật thông tin thành công!");
        };
    }

    const btnEdit = document.getElementById('btn-edit');
    if(btnEdit) {
        btnEdit.onclick = () => {
            if (state.isEditMode) { finishEditing(btnEdit); return; }
            if (state.rootNode.children.length > 0) {
                document.getElementById('btn-edit-warning-cancel').onclick = () => { closeModal('edit-warning-modal'); };
                document.getElementById('btn-edit-warning-confirm').onclick = () => {
                    closeModal('edit-warning-modal');
                    turnOnEditMode(btnEdit); 
                };
                openModal('edit-warning-modal');
            } else {
                turnOnEditMode(btnEdit); 
            }
        };
    }

    document.querySelectorAll('.palette-turn-toggle').forEach(toggle => {
        toggle.onclick = () => {
            state.editTurn = (state.editTurn === 'w') ? 'b' : 'w';
            updateTurnToggleUI();
        };
    });

    const btnClearBoard = document.getElementById('btn-clear-board');
    if(btnClearBoard) {
        btnClearBoard.onclick = () => {
            for (let i=51; i<204; i++) {
                if (state.currentSituation[i] > 1) state.currentSituation[i] = 1;
            }
            state.currentSituation[199] = 21; 
            state.currentSituation[55] = 37;  
            renderBoardFull(state.currentSituation);
        };
    }

    document.querySelectorAll('.piece-palette img').forEach(img => {
        img.onclick = (e) => {
            if (state.selectedPalettePiece === e.target.dataset.piece) {
                state.selectedPalettePiece = null;
                e.target.classList.remove('piece-selected');
            } else {
                document.querySelectorAll('.piece-palette img').forEach(i => i.classList.remove('piece-selected'));
                e.target.classList.add('piece-selected');
                state.selectedPalettePiece = e.target.dataset.piece;
                state.selectedBoardPiece = null; 
                document.querySelectorAll('.chess-piece').forEach(p => p.classList.remove('piece-selected'));
            }
        };
    });
    
    const btnExportClose = document.getElementById('btn-export-close');
    if(btnExportClose) btnExportClose.onclick = () => closeModal('export-modal');

    const expFen = document.getElementById('exp-fen');
    if(expFen) expFen.onclick = () => copyToClipboard(state.currentNode.fen);

    const expMoveFen = document.getElementById('exp-move-fen');
    if(expMoveFen) {
        expMoveFen.onclick = () => {
            let { moves } = getMoveListAndComments();
            if (moves.length === 0) copyToClipboard(state.rootNode.fen);
            else copyToClipboard(state.rootNode.fen + " moves " + moves.join(" "));
        };
    }

    const expDhj = document.getElementById('exp-dhj');
    if(expDhj) {
        expDhj.onclick = () => {
            try {
                const vNode = getVschessNodeTree(state.rootNode);
                const data = vschess.nodeToData_DHJHtmlXQ(vNode, state.currentGameInfo, false);
                copyToClipboard(data);
            } catch (e) { showToast("❌ Lỗi khi xuất DHJHtmlXQ!"); }
        };
    }

    const expUbb = document.getElementById('exp-ubb');
    if(expUbb) {
        expUbb.onclick = () => {
            try {
                const vNode = getVschessNodeTree(state.rootNode);
                const data = vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
                copyToClipboard(data);
            } catch (e) { showToast("❌ Lỗi khi xuất DhtmlXQ UBB!"); }
        };
    }

    function openSaveModal(type) {
        state.pendingDownloadType = type;
        let { moves } = getMoveListAndComments();
        document.getElementById('save-file-moves').innerText = `Tổng cộng ${moves.length} nước đi`;
        document.getElementById('save-file-name').value = "TuongKyViet";
        closeModal('export-modal');
        openModal('save-file-modal');
    }

    const btnSaveCancel = document.getElementById('btn-save-cancel');
    if(btnSaveCancel) {
        btnSaveCancel.onclick = () => {
            closeModal('save-file-modal');
            openModal('export-modal');
        };
    }

    const btnSaveConfirm = document.getElementById('btn-save-confirm');
    if(btnSaveConfirm) {
        btnSaveConfirm.onclick = async () => {
            closeModal('save-file-modal'); 

            const rawFileName = document.getElementById('save-file-name').value.trim() || "Son93";
            const downloadFileName = rawFileName;
            
            try {
                let { moves, comments } = getMoveListAndComments();
                let vNode = getVschessNodeTree(state.rootNode);
                
                if (state.pendingDownloadType === 'cbl-library') {
                    showLoading("Đang xuất thư viện thành file .cbl...");
                    const rawList = await getWorkspace('library_workspace') || [];
                    let itemsToExport = [];
                    
                    const { selectedLibraryCollectionId } = await import('./ui.js');
                    if (selectedLibraryCollectionId && selectedLibraryCollectionId !== "ALL_LIBRARY") {
                        itemsToExport = rawList.filter(item => item.collection_id === selectedLibraryCollectionId);
                    }
                    if (itemsToExport.length === 0) itemsToExport = rawList;

                    let gamesList = [];
                    for (let item of itemsToExport) {
                        const textData = await getWorkspace(item.id_key);
                        gamesList.push({
                            file_name: item.file_name,
                            collection_name: item.collection_name,
                            dataText: textData
                        });
                    }

                    if (gamesList.length === 0 && state.rootNode) {
                        gamesList.push({ node: vNode, info: state.currentGameInfo });
                    }

                    const cblBuffer = createCBLBinaryFromGames(gamesList);
                    downloadFile(downloadFileName + ".cbl", cblBuffer, true);
                    hideLoading();
                } else if (state.pendingDownloadType === 'cbl') {
                    const cblBuffer = createCBLBinaryFromGames([{ node: vNode, info: state.currentGameInfo }]);
                    downloadFile(downloadFileName + ".cbl", cblBuffer, true);
                } else if (state.pendingDownloadType === 'library') {
                    showLoading("Đang lưu vào thư viện...");
                    const gameDataText = vschess.nodeToData_DhtmlXQ(vNode, state.currentGameInfo, false);
                    const idKey = 'lib_' + Date.now();
                    await saveWorkspace(idKey, gameDataText); 
                    let libraryList = await getWorkspace('library_workspace') || [];
                    libraryList.push({ id_key: idKey, file_name: rawFileName });
                    await saveWorkspace('library_workspace', libraryList);
                    hideLoading();
                    showToast(`✅ Đã lưu "${rawFileName}" vào Thư viện thành công!`);
                }
                else if (state.pendingDownloadType === 'pgn-wxf') {
                    let wxfMoves = vschess.nodeList2moveList(moves, state.rootNode.fen, "wxf", vschess.defaultOptions, false);
                    wxfMoves.shift(); 
                    const pgnData = vschess.moveListToData_PGN(wxfMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(downloadFileName + ".pgn", pgnData);
                } else if (state.pendingDownloadType === 'pgn-iccs') {
                    let iccsDashMoves = moves.map(m => m.substring(0,2) + "-" + m.substring(2,4));
                    const pgnData = vschess.moveListToData_PGN(iccsDashMoves, state.rootNode.fen, comments, state.currentGameInfo, state.currentGameInfo.result);
                    downloadFile(downloadFileName + ".pgn", pgnData);
                } else if (state.pendingDownloadType === 'xqf') {
                    const binArray = vschess.nodeToBinary_XQF(vNode, state.currentGameInfo, false);
                    downloadFile(downloadFileName + ".xqf", binArray, true);
                } else if (state.pendingDownloadType === 'cbr') {
                    const binArray = vschess.nodeToBinary_CBR(vNode, state.currentGameInfo, false);
                    downloadFile(downloadFileName + ".cbr", binArray, true);
                } else if (state.pendingDownloadType === 'che') {
                    const cheData = vschess.moveListToData_QQ(moves, false);
                    downloadFile(downloadFileName + ".che", cheData);
                }
            } catch(e) { console.error(e); hideLoading(); showToast("❌ Có lỗi xảy ra khi xuất file!"); }
        };
    }

    const btnAutoReview = document.getElementById('btn-auto-review-game');
    if(btnAutoReview) btnAutoReview.onclick = () => runAutoGameReview();

    const boardThemeSelect = document.getElementById('board-theme-select');
    if(boardThemeSelect) {
        boardThemeSelect.value = localStorage.getItem('boardTheme') || 'default';
        boardThemeSelect.onchange = (e) => setBoardTheme(e.target.value);
    }

    const expCbl = document.getElementById('exp-cbl');
    if(expCbl) expCbl.onclick = () => openSaveModal('cbl');

    const btnExportCblLib = document.getElementById('btn-export-cbl-library');
    if(btnExportCblLib) {
        btnExportCblLib.onclick = async () => {
            let { moves } = getMoveListAndComments();
            if (document.getElementById('save-file-moves')) {
                document.getElementById('save-file-moves').innerText = `Xuất thư viện tự tạo`;
            }
            const { selectedLibraryCollectionId } = await import('./ui.js');
            const rawList = await getWorkspace('library_workspace') || [];
            const activeCol = rawList.find(i => i.collection_id === selectedLibraryCollectionId);
            const defaultName = activeCol ? (activeCol.collection_name || "Thu_Vien_Tu_Tao") : "Thu_Vien_Tu_Tao";
            if (document.getElementById('save-file-name')) {
                document.getElementById('save-file-name').value = defaultName;
            }
            state.pendingDownloadType = 'cbl-library';
            openModal('save-file-modal');
        };
    }

    const expLibrary = document.getElementById('exp-library');
    if(expLibrary) expLibrary.onclick = () => openSaveModal('library');

    const expPgnWxf = document.getElementById('exp-pgn-wxf');
    if(expPgnWxf) expPgnWxf.onclick = () => openSaveModal('pgn-wxf');
    
    const expPgnIccs = document.getElementById('exp-pgn-iccs');
    if(expPgnIccs) expPgnIccs.onclick = () => openSaveModal('pgn-iccs');
    
    const expXqf = document.getElementById('exp-xqf');
    if(expXqf) expXqf.onclick = () => openSaveModal('xqf');
    
    const expCbr = document.getElementById('exp-cbr');
    if(expCbr) expCbr.onclick = () => openSaveModal('cbr');
    
    const expChe = document.getElementById('exp-che');
    if(expChe) expChe.onclick = () => openSaveModal('che');
    
    document.querySelectorAll('.menu-item').forEach(btn => btn.classList.remove('menu-item-active'));
    let initialModeId = `menu-${state.appMode}`;
    if (state.appMode === 'vsbot') initialModeId = 'menu-bot';
    
    if(document.getElementById(initialModeId)) {
        document.getElementById(initialModeId).classList.add('menu-item-active');
    }

    // ==========================================
    // XỬ LÝ LOCAL BOOK & CLOUD BOOK
    // ==========================================
    const bookTypeSelect = document.getElementById('book-type-select');
    const rowLocalBook = document.getElementById('row-local-book');
    const btnUploadLocal = document.getElementById('btn-upload-local-book');
    const inputLocalFile = document.getElementById('input-local-book-file');
    const btnDeleteLocal = document.getElementById('btn-delete-local-book');
    const localBookTitle = document.getElementById('local-book-title');
    const localBookFilename = document.getElementById('local-book-filename');

    syncBookTabUI();

    if (bookTypeSelect) {
        if (bookTypeSelect.value === 'local') {
            if (rowLocalBook) rowLocalBook.style.display = 'flex';
            loadLocalBookFromDB();
        }

        // Sự kiện đổi loại sách (Cloud/Local)
        bookTypeSelect.onchange = (e) => {
            const val = e.target.value;
            state.appSettings.bookType = val;
            storage.saveSystem(state.appSettings);
            
            // Cập nhật lại UI Tab
            syncBookTabUI();
            
            if (val === 'local') {
                if (rowLocalBook) rowLocalBook.style.display = 'flex';
                // Hàm này đã được bảo vệ, gọi nhiều lần không sao. Nó sẽ tự trigger quét lại.
                loadLocalBookFromDB(); 
            } else {
                if (rowLocalBook) rowLocalBook.style.display = 'none';
                // Nếu đổi về Cloud, ép hệ thống quét Cloud ngay lập tức
                import('./engine.js').then(m => m.fetchCloudBook(state.currentNode.fen));
            }
        };
    }

    // Sự kiện Click nút tải File
    if (btnUploadLocal && inputLocalFile) {
        btnUploadLocal.onclick = () => inputLocalFile.click();

        inputLocalFile.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Xử lý UI tạm thời để user biết file đang được đọc
            if (localBookTitle) localBookTitle.innerText = "Đang xử lý...";
            if (localBookFilename) {
                localBookFilename.innerText = file.name;
                localBookFilename.style.color = "#008a3e";
            }
            
            // Gọi hàm xử lý logic IndexedDB bên localbook.js
            uploadLocalBook(file);
            
            // Reset input để có thể chọn lại đúng file đó lần sau nếu cần
            e.target.value = '';
        };
    }

    // Sự kiện Click nút Xóa File
    if (btnDeleteLocal) {
        btnDeleteLocal.onclick = () => {
            // Lấy tên file đang hiển thị
            const fileName = document.getElementById('local-book-filename')?.innerText || "File Book";
            // Gán tên file vào Modal
            const nameEl = document.getElementById('delete-local-book-name');
            if (nameEl) nameEl.innerText = fileName;
            
            // Mở Modal hỏi xác nhận
            openModal('delete-local-book-modal');
        };
    }

    // Nút Hủy trong Modal Xóa Local Book
    const btnDelLocalCancel = document.getElementById('btn-del-local-book-cancel');
    if (btnDelLocalCancel) {
        btnDelLocalCancel.onclick = () => {
            closeModal('delete-local-book-modal'); // Chỉ đóng bảng
        };
    }

    // Nút Xác nhận trong Modal Xóa Local Book
    const btnDelLocalConfirm = document.getElementById('btn-del-local-book-confirm');
    if (btnDelLocalConfirm) {
        btnDelLocalConfirm.onclick = () => {
            closeModal('delete-local-book-modal'); // Đóng bảng
            if (inputLocalFile) inputLocalFile.value = '';
            deleteLocalBook(); // Gọi hàm xóa thực sự
        };
    }

    // === LOGIC XỬ LÝ MANIFEST VÀ LOCAL DB ===
    async function loadPuzzleManifest(folderPath, folderName = '', isBack = false) {
        showLoading("Đang tải danh sách...");
        state.isViewingPuzzleFens = false;
        
        document.getElementById('puzzle-fen-view').style.display = 'none';
        const container = document.getElementById('puzzle-manifest-view');
        container.style.display = 'flex';
        
        const subtitle = document.getElementById('puzzle-modal-subtitle');
        if (folderName) {
            subtitle.innerText = folderName;
            subtitle.style.display = 'block';
        } else {
            subtitle.style.display = 'none';
        }

        const btnBack = document.getElementById('btn-puzzle-back');
        if (state.puzzleHistory.length > 0) btnBack.style.display = 'block';
        else btnBack.style.display = 'none';

        container.innerHTML = ''; 

        if (folderPath === 'my_puzzles') {
            try {
                const btnUpload = document.createElement('button');
                btnUpload.className = 'import-btn btn-blue';
                btnUpload.style.cssText = 'width: 100%; margin-bottom: 5px; flex-shrink: 0;';
                btnUpload.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Tải File JSON Bài Tập`;
                btnUpload.onclick = () => document.getElementById('puzzle-file-upload').click();
                container.appendChild(btnUpload);

                let myPuzData = await getWorkspace('my_puzzle');
                if (!myPuzData || !myPuzData.files || myPuzData.files.length === 0) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.cssText = 'text-align:center; color:#888; margin-top:20px; font-size:14px;';
                    emptyDiv.innerText = 'Chưa có bài tập nào. Hãy tải lên file JSON!';
                    container.appendChild(emptyDiv);
                } else {
                    myPuzData.files.forEach(file => {
                        const item = document.createElement('div');
                        item.className = 'lib-item'; 
                        item.style.cssText = 'border-radius: 8px; border: 1px solid #eee; margin-bottom: 2px;';
                        item.innerHTML = `
                            <span class="puzzle-icon" style="margin-right:8px;">📄</span>
                            <span class="lib-title">${file.file_name}</span>
                            <button class="lib-btn-del" title="Xóa file này">
                                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            </button>
                        `;

                        item.onclick = (e) => {
                            if(e.target.closest('.lib-btn-del')) return; 
                            loadPuzzleFileData(file.file_name, file.file_key, true); 
                        };

                        item.querySelector('.lib-btn-del').onclick = (e) => {
                            e.stopPropagation();
                            pendingDeletePuzKey = file.file_key;
                            document.getElementById('delete-puz-name').innerText = file.file_name;
                            openModal('delete-puz-modal');
                        };

                        container.appendChild(item);
                    });
                }
            } catch (err) { showToast("❌ Lỗi khi đọc dữ liệu Bài Tập Của Tôi!"); }
            hideLoading();
            return; 
        }

        try {
            let isDevUnlocked = false;
            if (folderPath === 'data') {
                const devKey = await getWorkspace('dev_puzzle_unlocked');
                if (devKey) isDevUnlocked = true;
            }

            const response = await fetch(`${folderPath}/manifest.json`);
            if (!response.ok) throw new Error("Không tìm thấy file manifest");
            
            const data = await response.json();

            if (folderPath === 'data' && isDevUnlocked) {
                if (!data.folders) data.folders = [];
                data.folders.unshift({
                    folder_name: "Bài Tập Của Tôi",
                    folder_path: "my_puzzles" 
                });
            }

            if (data.folders && data.folders.length > 0) {
                data.folders.forEach(folder => {
                    const btn = document.createElement('button');
                    btn.className = 'puzzle-item';
                    btn.innerHTML = `<span class="puzzle-icon">📁</span><span class="puzzle-name">${folder.folder_name}</span>`;
                    btn.onclick = () => {
                        state.puzzleHistory.push({ ...state.currentPuzzleFolder }); 
                        state.currentPuzzleFolder = { path: folder.folder_path, name: folder.folder_name };
                        loadPuzzleManifest(state.currentPuzzleFolder.path, state.currentPuzzleFolder.name); 
                    };
                    container.appendChild(btn);
                });
            }

            if (data.files && data.files.length > 0) {
                data.files.forEach(file => {
                    const btn = document.createElement('button');
                    btn.className = 'puzzle-item';
                    btn.innerHTML = `<span class="puzzle-icon">📄</span><span class="puzzle-name">${file.file_name}</span>`;
                    btn.onclick = () => {
                        loadPuzzleFileData(file.file_name, file.file_path, false); 
                    };
                    container.appendChild(btn);
                });
            }

            if (folderPath === 'data' && !isDevUnlocked) {
                const hiddenDevArea = document.createElement('div');
                hiddenDevArea.style.flex = "1"; 
                hiddenDevArea.style.background = "transparent";
                hiddenDevArea.style.minHeight = "60px"; 
                
                let clickCount = 0;
                let clickTimer = null;

                hiddenDevArea.onclick = () => {
                    clickCount++;
                    clearTimeout(clickTimer);
                    if (clickCount >= 5) {
                        Promise.all([
                            saveWorkspace('dev_puzzle_unlocked', { unlock: true }),
                            getWorkspace('my_puzzle').then(res => {
                                if (!res) return saveWorkspace('my_puzzle', { files: [] });
                            })
                        ]).then(() => {
                            //showToast("🔓 Đã mở khóa Bài Tập Của Tôi!");
                            loadPuzzleManifest('data', ''); 
                        });
                        clickCount = 0;
                    } else {
                        clickTimer = setTimeout(() => { clickCount = 0; }, 1000);
                    }
                };
                container.appendChild(hiddenDevArea);
            }

        } catch (err) {
            showToast("❌ Không thể tải danh sách (Kiểm tra lại mạng)!");
            if (!isBack && state.puzzleHistory.length > 0) {
                state.currentPuzzleFolder = state.puzzleHistory.pop(); 
            }
        }
        hideLoading();
    }


    function handlePuzzleUpload(file) {
        if (!file) return;
        const reader = new FileReader();
        showLoading("Đang kiểm tra file JSON...");

        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                const keys = Object.keys(data);
                const requiredKeys = ['max_moves', 'key', 'fens'];
                
                const isStrictlyValid = keys.length === 3 && 
                                        requiredKeys.every(k => keys.includes(k)) && 
                                        Array.isArray(data.fens);

                if (!isStrictlyValid) {
                    throw new Error("Cấu trúc JSON không hợp lệ. Chỉ chấp nhận các key: max_moves, key, fens.");
                }

                const timeSuffix = getFormattedDate();
                const newFileKey = 'puz_' + Math.floor(Math.random()*1000) + '_' + timeSuffix;
                
                await saveWorkspace(newFileKey, data);
                
                let myPuz = await getWorkspace('my_puzzle');
                if (!myPuz) myPuz = { files: [] };
                
                const cleanFileName = file.name.replace('.json', '');
                myPuz.files.push({ file_name: cleanFileName, file_key: newFileKey });
                await saveWorkspace('my_puzzle', myPuz);
                
                loadPuzzleManifest('my_puzzles', 'Bài Tập Của Tôi', false);
                showToast(`✅ Đã tải lên file: ${cleanFileName}`);

            } catch (err) {
                showToast("❌ File lỗi: " + err.message);
            }
            hideLoading();
        };
        reader.readAsText(file);
    }

    async function confirmDeletePuzzleFile() {
        closeModal('delete-puz-modal');
        showLoading("Đang xóa...");
        try {
            await deleteWorkspace(pendingDeletePuzKey); 
            
            let myPuz = await getWorkspace('my_puzzle');
            
            if (myPuz && myPuz.files) {
                myPuz.files = myPuz.files.filter(f => f.file_key !== pendingDeletePuzKey);
                
                await saveWorkspace('my_puzzle', myPuz);
            }
            
            loadPuzzleManifest('my_puzzles', 'Bài Tập Của Tôi', false); 
            showToast("✅ Đã xóa bài tập!");
        } catch (err) {
            showToast("❌ Lỗi khi xóa!");
        }
        hideLoading();
    }


    let puzzleDomPool = [];
    const PUZ_ITEM_HEIGHT = 48; 
    const PUZ_VISIBLE_ITEMS = 25;

    async function loadPuzzleFileData(fileName, filePath, isLocal = false) {
        showLoading("Đang tải dữ liệu bài tập...");
        try {
            state.currentPuzzleName = fileName;
            let data;
            if (isLocal) {
                data = await getWorkspace(filePath);
                if (!data) throw new Error("Không tìm thấy dữ liệu trong máy");
            } else {
                const response = await fetch(`${filePath}`);
                if (!response.ok) throw new Error("Lỗi tải file JSON");
                data = await response.json();
            }
            
            if (data.fens && data.fens.length > 0) {
                state.puzzleFens = data.fens;
                state.currentPuzzleMaxMoves = data.max_moves || 1000;

                state.currentPuzzleKey = data.key || fileName; 
                
                let mappedKey = await getWorkspace('puz_map_' + state.currentPuzzleKey);
                if (!mappedKey) {
                    mappedKey = state.currentPuzzleKey + makeRandomString(5);
                    await saveWorkspace('puz_map_' + state.currentPuzzleKey, mappedKey);
                    await saveWorkspace('puz_solved_' + mappedKey, []); 
                }
                state.currentPuzzleSolvedKey = mappedKey;

                let solvedArray = await getWorkspace('puz_solved_' + mappedKey);
                state.currentPuzzleSolved = solvedArray || [];

                let savedIndex = await getWorkspace('puz_prog_' + mappedKey);
                state.currentPuzzleIndex = (savedIndex !== null && savedIndex < data.fens.length) ? savedIndex : 0;
                
                state.isViewingPuzzleFens = true;
                document.getElementById('puzzle-manifest-view').style.display = 'none';
                document.getElementById('puzzle-fen-view').style.display = 'flex';
                
                const subtitle = document.getElementById('puzzle-modal-subtitle');
                subtitle.innerText = fileName;
                subtitle.style.display = 'block';
                document.getElementById('btn-puzzle-back').style.display = 'block';

                renderPuzzleVirtualList();
            } else {
                showToast("❌ File không chứa bài tập nào!");
            }
        } catch (err) {
            showToast("❌ File bị lỗi hoặc cấu trúc sai!");
        }
        hideLoading();
    }

    function renderPuzzleVirtualList() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        const spacer = document.getElementById('puzzle-fen-spacer');
        const container = document.getElementById('puzzle-fen-container');

        if (puzzleDomPool.length === 0) {
            container.innerHTML = '';
            for (let i = 0; i < PUZ_VISIBLE_ITEMS; i++) {
                const item = document.createElement('div');
                item.className = 'lib-item'; 
                item.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 15px;">
                        <span style="width: 24px;"></span> 
                        <span class="lib-title" style="text-align: center; padding: 0; flex: 1;"></span>
                        <span class="puz-status-icon" style="display: flex; align-items: center; justify-content: flex-end; width: 24px;">
                        </span>
                    </div>
                `;
                
                item.onclick = () => {
                    const fenIndex = parseInt(item.dataset.index);
                    const selectedFen = state.puzzleFens[fenIndex];
                    
                    // FIX LỖI: So sánh trực tiếp mã FEN thay vì so sánh Index
                    // Nếu mã FEN bài đang chọn trùng khớp y hệt mã FEN đang hiển thị trên bàn cờ thì mới chặn
                    if (state.appMode === 'puzzle' && state.rootNode && state.rootNode.fen === selectedFen) {
                        closeModal('puzzle-modal');
                        return; 
                    }

                    state.currentPuzzleIndex = fenIndex;

                    saveWorkspace('puz_prog_' + state.currentPuzzleSolvedKey, fenIndex);
                    
                    closeModal('puzzle-modal');
                    switchMode('puzzle', selectedFen);
                    //showToast(`Đã mở bài tập số ${fenIndex + 1}!`);
                };

                puzzleDomPool.push(item);
                container.appendChild(item);
            }
            viewport.addEventListener('scroll', () => requestAnimationFrame(updatePuzzleVirtualList));
        }

        spacer.style.height = `${state.puzzleFens.length * PUZ_ITEM_HEIGHT}px`;
        
        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; 
        viewport.scrollTop = targetScroll;

        updatePuzzleVirtualList();
    }

    function updatePuzzleVirtualList() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        if (!viewport || puzzleDomPool.length === 0) return;

        const scrollTop = viewport.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / PUZ_ITEM_HEIGHT) - 2);
        const endIndex = Math.min(state.puzzleFens.length - 1, startIndex + PUZ_VISIBLE_ITEMS - 1);

        const container = document.getElementById('puzzle-fen-container');
        container.style.transform = `translateY(${startIndex * PUZ_ITEM_HEIGHT}px)`;

        for (let i = 0; i < PUZ_VISIBLE_ITEMS; i++) {
            const dom = puzzleDomPool[i];
            const dataIndex = startIndex + i;

            if (dataIndex <= endIndex) {
                dom.style.display = 'flex';
                dom.dataset.index = dataIndex;
                const titleSpan = dom.querySelector('.lib-title');
                const statusIcon = dom.querySelector('.puz-status-icon');
                
                titleSpan.innerText = `Bài số ${dataIndex + 1}`;

                const isChallenge = state.currentPuzzleName === "Thử Thách" || state.currentPuzzleKey.includes("challenge");
                
                let isSolved = state.currentPuzzleSolved.includes(dataIndex);
                let isActive = (dataIndex === state.currentPuzzleIndex);
                
                let maxUnlocked = 0;
                if (isChallenge) {
                    const maxSolvedIndex = state.currentPuzzleSolved.length > 0 ? state.currentPuzzleSolved[0] : -1;
                    maxUnlocked = maxSolvedIndex + 1; 

                    isSolved = (dataIndex <= maxSolvedIndex);
                    
                    if (!isSolved) {
                        if (dataIndex === maxUnlocked) {
                            statusIcon.innerHTML = '';
                            titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                            dom.style.opacity = '1';
                            dom.style.pointerEvents = 'auto'; 
                        } else {
                            statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg>`;
                            titleSpan.style.color = '#262626';
                            dom.style.opacity = '0.6';
                            dom.style.pointerEvents = 'none'; 
                        }
                    } else {
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                        dom.style.opacity = '1';
                        dom.style.pointerEvents = 'auto'; 
                    }
                } 
                else {
                    dom.style.opacity = '1';
                    dom.style.pointerEvents = 'auto'; 

                    if (isSolved) {
                        statusIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14a800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>`;
                        titleSpan.style.color = '#14a800';
                    } else {
                        statusIcon.innerHTML = '';
                        titleSpan.style.color = isActive ? '#008a3e' : '#1a73e8';
                    }
                }

                titleSpan.style.fontWeight = isActive ? '900' : 'bold';

                if (isActive) {
                    dom.style.backgroundColor = '#f0fdf4';
                    dom.style.borderLeft = '4px solid #008a3e';
                } else {
                    dom.style.backgroundColor = '#fff';
                    dom.style.borderLeft = 'none';
                }
            } else {
                dom.style.display = 'none';
            }
        }
    }
    function refreshPuzzleListUI() {
        const viewport = document.getElementById('puzzle-fen-viewport');
        if (!viewport || puzzleDomPool.length === 0) return;

        const viewportHeight = viewport.clientHeight || 300; 
        let targetScroll = (state.currentPuzzleIndex * PUZ_ITEM_HEIGHT) - (viewportHeight / 2) + (PUZ_ITEM_HEIGHT / 2);
        if (targetScroll < 0) targetScroll = 0; 
        
        viewport.scrollTop = targetScroll;

        updatePuzzleVirtualList();
    }
    const puzzleFileUpload = document.getElementById('puzzle-file-upload');
    if (puzzleFileUpload) {
        puzzleFileUpload.onchange = (e) => {
            handlePuzzleUpload(e.target.files[0]);
            e.target.value = ''; 
        };
    }

    const btnDelPuzCancel = document.getElementById('btn-del-puz-cancel');
    if (btnDelPuzCancel) btnDelPuzCancel.onclick = () => closeModal('delete-puz-modal');

    const btnDelPuzConfirm = document.getElementById('btn-del-puz-confirm');
    if (btnDelPuzConfirm) btnDelPuzConfirm.onclick = () => confirmDeletePuzzleFile();

    const btnLibUploadTrigger = document.getElementById('btn-lib-file-upload-trigger');
    const libFileUploadInput = document.getElementById('library-file-upload-input');
    if (btnLibUploadTrigger && libFileUploadInput) {
        btnLibUploadTrigger.onclick = () => libFileUploadInput.click();
        libFileUploadInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const { importFileToLibrary } = await import('./io.js');
            await importFileToLibrary(file);
            e.target.value = '';
        };
    }

    const btnClearAllLib = document.getElementById('btn-clear-all-library');
    if (btnClearAllLib) {
        btnClearAllLib.onclick = async () => {
            const { clearAllLibraryAction } = await import('./ui.js');
            clearAllLibraryAction();
        };
    }

    async function confirmDeleteLibraryAction() {
        closeModal('delete-lib-modal');
        const { pendingDeleteLibId, pendingDeleteCollectionId, renderLibraryList } = await import('./ui.js');
        showLoading("Đang xóa dữ liệu...");
        try {
            let libraryList = await getWorkspace('library_workspace') || [];
            if (pendingDeleteCollectionId && pendingDeleteCollectionId.colId === 'ALL_LIBRARY') {
                for (let item of libraryList) {
                    await deleteWorkspace(item.id_key);
                }
                await saveWorkspace('library_workspace', []);
                state.activeLibraryGameId = null;
                showToast("✅ Đã xóa toàn bộ ván cờ trong Thư Viện!");
            } else if (pendingDeleteCollectionId && pendingDeleteCollectionId.colId === 'folder_path') {
                const { colName } = pendingDeleteCollectionId;
                const toDelete = libraryList.filter(item => 
                    item.collection_name && (item.collection_name === colName || item.collection_name.startsWith(colName + '/'))
                );
                const toKeep = libraryList.filter(item => 
                    !item.collection_name || (item.collection_name !== colName && !item.collection_name.startsWith(colName + '/'))
                );

                for (let item of toDelete) {
                    await deleteWorkspace(item.id_key);
                }
                await saveWorkspace('library_workspace', toKeep);
                showToast(`✅ Đã xóa thư mục "${colName}" và tất cả bên trong!`);
            } else if (pendingDeleteCollectionId && pendingDeleteCollectionId.colId) {
                const { colId, colName } = pendingDeleteCollectionId;
                const toDelete = libraryList.filter(item => {
                    if (colId === 'default_col' || colName === 'Ván Tự Lưu') {
                        return !item.collection_id;
                    }
                    return item.collection_id === colId || item.collection_name === colName;
                });
                const toKeep = libraryList.filter(item => {
                    if (colId === 'default_col' || colName === 'Ván Tự Lưu') {
                        return !!item.collection_id;
                    }
                    return !(item.collection_id === colId || item.collection_name === colName);
                });

                for (let item of toDelete) {
                    await deleteWorkspace(item.id_key);
                }
                await saveWorkspace('library_workspace', toKeep);
                showToast(`✅ Đã xóa bộ thư viện "${colName}"!`);
            } else if (pendingDeleteLibId) {
                await deleteWorkspace(pendingDeleteLibId);
                libraryList = libraryList.filter(item => item.id_key !== pendingDeleteLibId);
                await saveWorkspace('library_workspace', libraryList);
                showToast("✅ Đã xóa ván cờ!");
            }
            await renderLibraryList();
        } catch (err) {
            console.error(err);
            showToast("❌ Lỗi khi xóa!");
        }
        hideLoading();
    }
    updateEngineToggleButtonUI();
}