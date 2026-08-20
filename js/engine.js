// js/engine.js
import { drawBestMoveArrow, clearArrow } from './board.js';
import { customTranslator, executeMove } from './game.js'; 
import { showToast, showAILoading, hideAILoading } from './ui.js';
import { getStrictLegalMoves } from './rules.js';
import { state, storage } from './state.js'; // Thêm storage vào đây
import { queryLocalBookWorker } from './localbook.js';

let pendingAction = null; 
let stopTimeoutId = null; 
let isEngineSearching = false; 
let cloudBookTimeoutId = null; 
let lastUiUpdateTime = 0;

export let engineOutputListeners = [];

let currentEngineInstance = null; // Lưu trữ Worker (nếu là single) hoặc Module (nếu là multi)
let currentWasmType = null;
let fallbackTriggered = false;


export function getDeviceTier() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return 'PC';

    // Nhận diện RAM (Chỉ hoạt động trên Chromium)
    let ram = navigator.deviceMemory || 0;
    
    // Fallback cho iOS/Safari (Không hỗ trợ deviceMemory)
    if (ram === 0) {
        const cores = navigator.hardwareConcurrency || 2;
        ram = cores >= 6 ? 6 : 4; // iPhone từ 6 lõi trở lên thường khá mạnh (Tương đương 6GB)
    }

    if (ram < 6) return 'MOBILE_LOW';
    return 'MOBILE_HIGH';
}

export let botProfiles = { 
    standard: [
        {id: 1, levelName: "Cấp 1 - Tập sự (Elo 800)", uciSkillLevel: 0, searchDepth: 3, maxMovetimeMs: 150},
        {id: 2, levelName: "Cấp 2 - Nhập môn (Elo 1000)", uciSkillLevel: 2, searchDepth: 5, maxMovetimeMs: 300},
        {id: 3, levelName: "Cấp 3 - Nghiệp dư (Elo 1200)", uciSkillLevel: 4, searchDepth: 7, maxMovetimeMs: 450},
        {id: 4, levelName: "Cấp 4 - Phong trào (Elo 1400)", uciSkillLevel: 6, searchDepth: 9, maxMovetimeMs: 650},
        {id: 5, levelName: "Cấp 5 - Bán chuyên (Elo 1600)", uciSkillLevel: 9, searchDepth: 11, maxMovetimeMs: 900},
        {id: 6, levelName: "Cấp 6 - Kiện tướng Huyện (Elo 1800)", uciSkillLevel: 12, searchDepth: 13, maxMovetimeMs: 1200},
        {id: 7, levelName: "Cấp 7 - Kiện tướng Tỉnh (Elo 2000)", uciSkillLevel: 15, searchDepth: 15, maxMovetimeMs: 1500},
        {id: 8, levelName: "Cấp 8 - Dự bị Quốc Gia (Elo 2200)", uciSkillLevel: 17, searchDepth: 17, maxMovetimeMs: 1800},
        {id: 9, levelName: "Cấp 9 - Đại Kiện Tướng (Elo 2500)", uciSkillLevel: 19, searchDepth: 20, maxMovetimeMs: 2200},
        {id: 10, levelName: "Cấp 10 - Siêu AI Thần Thoại (Elo 2800+)", uciSkillLevel: 20, searchDepth: 26, maxMovetimeMs: 3500}
    ], 
    human: [
        {id: 1, levelName: "Cấp 1 - Tập sự (Elo 800)", searchDepth: 4, maxMovetimeMs: 400, multiPVCount: 5, pvProbabilities: [0.05, 0.15, 0.25, 0.25, 0.30], maxCentipawnDrop: 500, minFakeThinkTime: 0.5, maxFakeThinkTime: 0.8},
        {id: 2, levelName: "Cấp 2 - Nhập môn (Elo 1000)", searchDepth: 6, maxMovetimeMs: 500, multiPVCount: 4, pvProbabilities: [0.15, 0.25, 0.30, 0.30], maxCentipawnDrop: 350, minFakeThinkTime: 0.6, maxFakeThinkTime: 0.9},
        {id: 3, levelName: "Cấp 3 - Nghiệp dư (Elo 1200)", searchDepth: 8, maxMovetimeMs: 650, multiPVCount: 4, pvProbabilities: [0.25, 0.30, 0.25, 0.20], maxCentipawnDrop: 220, minFakeThinkTime: 0.7, maxFakeThinkTime: 1.0},
        {id: 4, levelName: "Cấp 4 - Phong trào (Elo 1400)", searchDepth: 10, maxMovetimeMs: 800, multiPVCount: 3, pvProbabilities: [0.40, 0.35, 0.25], maxCentipawnDrop: 140, minFakeThinkTime: 0.9, maxFakeThinkTime: 1.2},
        {id: 5, levelName: "Cấp 5 - Bán chuyên (Elo 1600)", searchDepth: 12, maxMovetimeMs: 950, multiPVCount: 3, pvProbabilities: [0.55, 0.30, 0.15], maxCentipawnDrop: 90, minFakeThinkTime: 1.0, maxFakeThinkTime: 1.3},
        {id: 6, levelName: "Cấp 6 - Kiện tướng Huyện (Elo 1800)", searchDepth: 14, maxMovetimeMs: 1100, multiPVCount: 3, pvProbabilities: [0.68, 0.22, 0.10], maxCentipawnDrop: 60, minFakeThinkTime: 1.2, maxFakeThinkTime: 1.5},
        {id: 7, levelName: "Cấp 7 - Kiện tướng Tỉnh (Elo 2000)", searchDepth: 16, maxMovetimeMs: 1300, multiPVCount: 2, pvProbabilities: [0.78, 0.22], maxCentipawnDrop: 40, minFakeThinkTime: 1.4, maxFakeThinkTime: 1.7},
        {id: 8, levelName: "Cấp 8 - Dự bị Quốc Gia (Elo 2200)", searchDepth: 18, maxMovetimeMs: 1600, multiPVCount: 2, pvProbabilities: [0.88, 0.12], maxCentipawnDrop: 20, minFakeThinkTime: 1.6, maxFakeThinkTime: 1.9},
        {id: 9, levelName: "Cấp 9 - Đại Kiện Tướng (Elo 2500)", searchDepth: 20, maxMovetimeMs: 2000, multiPVCount: 1, pvProbabilities: [1.0], maxCentipawnDrop: 0, minFakeThinkTime: 2.0, maxFakeThinkTime: 2.3},
        {id: 10, levelName: "Cấp 10 - Siêu AI Thần Thoại (Elo 2800+)", searchDepth: 26, maxMovetimeMs: 2800, multiPVCount: 1, pvProbabilities: [1.0], maxCentipawnDrop: 0, minFakeThinkTime: 2.3, maxFakeThinkTime: 2.7}
    ] 
};

// =====================================================================
// TÍNH NĂNG FEATURE DETECTION (NHẬN DIỆN PHẦN CỨNG)
// =====================================================================
function checkThreads() {
    try {
        return typeof SharedArrayBuffer !== 'undefined';
    } catch (e) {
        console.error("Check Threads Error:", e);
        return false;
    }
}

async function checkSIMD() {
    try {
        const simdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
        let res = await WebAssembly.validate(simdWasm);
        return res;
    } catch (e) { 
        console.error("Check SIMD Error:", e);
        return false; 
    }
}

async function checkRelaxedSIMD() {
    try {
        const relaxedSimdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]);
        let res = await WebAssembly.validate(relaxedSimdWasm);
        return res;
    } catch (e) { 
        console.error("Check Relaxed SIMD Error:", e);
        return false; 
    }
}

async function getBestEngineType() {
    const tier = getDeviceTier();
    const threads = checkThreads();
    const simd = await checkSIMD();
    let relaxedSimd = false;

    if (tier === 'PC') {
        relaxedSimd = await checkRelaxedSIMD();
    }

    if (tier === 'MOBILE_LOW') {
        if (simd) return 'single_simd';
        return 'single';
    }

    if (threads) {
        if (relaxedSimd) return 'multi_simd_relaxed';
        if (simd) return 'multi_simd';
        return 'multi';
    } else {
        if (simd) return 'single_simd';
        return 'single';
    }
}

// =====================================================================
// KHỞI TẠO ĐỘNG CƠ: TÁCH LUỒNG THEO KIẾN TRÚC XIANGQIAI.COM
// =====================================================================
function applyEngineHardwareLimits(type) {
    const tier = getDeviceTier();
    const isSingle = type.includes('single') || tier === 'MOBILE_LOW'; 
    
    const inputThreads = document.getElementById('input-threads');
    const descThreads = document.getElementById('desc-threads');
    let maxThreads = 1;
    
    if (!isSingle) {
        if (navigator.deviceMemory) {
            maxThreads = Math.max(1, Math.floor(navigator.deviceMemory / 2));
        } else if (navigator.hardwareConcurrency) {
            maxThreads = Math.max(1, Math.floor(navigator.hardwareConcurrency / 2));
        }
        if (maxThreads > 16) maxThreads = 16;
    }

    if (inputThreads) {
        inputThreads.setAttribute('max', maxThreads);
        if (state.aiSettings.threads > maxThreads) {
            state.aiSettings.threads = maxThreads;
        }
        inputThreads.value = state.aiSettings.threads;
    }
    if (descThreads) {
        descThreads.innerText = isSingle ? `Tối đa: 1 luồng (Dành cho máy yếu)` : `Tối đa: ${maxThreads} luồng (Đã tối ưu theo RAM)`;
    }

    let maxHash, defaultHash, maxDepth, defaultDepth;
    if (tier === 'PC') {
        maxHash = 512; defaultHash = 128;
        maxDepth = 100; defaultDepth = 50;
    } else if (tier === 'MOBILE_HIGH') {
        maxHash = 512; defaultHash = 64;
        maxDepth = 60; defaultDepth = 30;
    } else { // MOBILE_LOW
        maxHash = 256; defaultHash = 32;
        maxDepth = 30; defaultDepth = 20;
    }

    const inputHash = document.getElementById('input-hash');
    if (inputHash) {
        inputHash.setAttribute('max', maxHash);
        if (!storage.getAnalysis() || !storage.getAnalysis().hash) {
            state.aiSettings.hash = defaultHash; 
        }
        if (state.aiSettings.hash > maxHash) state.aiSettings.hash = maxHash;
        inputHash.value = state.aiSettings.hash;
    }

    const inputDepth = document.getElementById('input-depth');
    if (inputDepth) {
        inputDepth.setAttribute('max', maxDepth);
        if (!storage.getAnalysis() || !storage.getAnalysis().depth) {
            state.aiSettings.depth = defaultDepth; 
        }
        if (state.aiSettings.depth > maxDepth) state.aiSettings.depth = maxDepth;
        inputDepth.value = state.aiSettings.depth;
    }
    
    storage.saveAnalysis(state.aiSettings); 

    const btnGoInstant = document.getElementById('btn-go-instant');
    if (btnGoInstant) {
        if (isSingle) {
            btnGoInstant.style.display = 'none'; 
        } else {
            btnGoInstant.style.display = ''; 
        }
    }
}

export async function initPikafish(forceType = null) {
    const type = forceType || await getBestEngineType();
    currentWasmType = type;

    applyEngineHardwareLimits(type);
    attachCrashHandlers();

    const basePath = window.location.href.replace(/\/[^\/]*$/, '');

    if (type.includes("multi")) {
        const scriptUrl = `${basePath}/engines/${type}/pikafish.js`;
        
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.onload = () => {
            window.Pikafish({
                locateFile: function(path) {
                    let finalPath = path.endsWith('.data') ? `${basePath}/engines/${path}` : `${basePath}/engines/${type}/${path}`;
                    return finalPath;
                },
                onReceiveStdout: function(text) { handleEngineOutput(text); },
                print: function(text) { handleEngineOutput(text); },
                ALLOW_MEMORY_GROWTH: true
            }).then(function(module) {
                currentEngineInstance = module;
                state.engineModule = {
                    sendCommand: (cmd) => {
                        if (typeof module.send_command === 'function') module.send_command(cmd);
                        else if (typeof module.sendCommand === 'function') module.sendCommand(cmd);
                    }
                };
                onEngineReady(type);
            }).catch(err => onEngineError("Lỗi Promise Pikafish() Multi: " + err));
        };
        script.onerror = (e) => onEngineError("Lỗi onload thẻ script: Không thể tải " + scriptUrl);
        document.head.appendChild(script);
    } 
    else {
        const workerScript = `
            var EngineInstance = null;
            self.onmessage = function (e) {
                if (e.data.command != null) {
                    if(EngineInstance && typeof EngineInstance.send_command === 'function') EngineInstance.send_command(e.data.command);
                    else if(EngineInstance && typeof EngineInstance.sendCommand === 'function') EngineInstance.sendCommand(e.data.command);
                } else if (e.data.wasm_type != null) {
                    let wasmType = e.data.wasm_type;
                    let basePath = e.data.basePath;
                    let scriptToLoad = basePath + "/engines/" + wasmType + "/pikafish.js";
                    
                    self.postMessage({ debug: "Worker bắt đầu gọi importScripts: " + scriptToLoad });
                    
                    try {
                        self.importScripts(scriptToLoad);
                        self.postMessage({ debug: "Worker importScripts thành công!" });
                    } catch(err) {
                        self.postMessage({ error: "Lỗi importScripts trong Worker: " + err.toString() });
                        return;
                    }
                    
                    self['Pikafish']({
                        onReceiveStdout: (text) => self.postMessage({ stdout: text }),
                        print: (text) => self.postMessage({ stdout: text }),
                        locateFile: (url) => {
                            if (url === 'pikafish.data') return basePath + "/engines/" + url;
                            return basePath + "/engines/" + wasmType + "/" + url;
                        }
                    }).then(p => {
                        EngineInstance = p;
                        self.postMessage({ ready: true });
                    }).catch(err => {
                        self.postMessage({ error: "Lỗi Promise Pikafish() trong Worker: " + err.toString() });
                    });
                }
            }
        `;

        try {
            const blob = new Blob([workerScript], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            const engineWorker = new Worker(blobUrl, { type: "classic" });
            
            URL.revokeObjectURL(blobUrl);

            engineWorker.onerror = (err) => {
                console.error("Worker Object Error (Main Thread bắt được):", err.message || err);
                onEngineError("Worker Object Error: " + (err.message || err));
            };

            currentEngineInstance = engineWorker;

            state.engineModule = {
                sendCommand: (cmd) => {
                    engineWorker.postMessage({ command: cmd });
                }
            };

            engineWorker.onmessage = (e) => {
                if (e.data.debug) {
                } else if (e.data.error) {
                    onEngineError(e.data.error);
                } else if (e.data.ready) {
                    console.log("Worker gửi tín hiệu READY!");
                    onEngineReady(type);
                } else if (e.data.stdout) {
                    handleEngineOutput(e.data.stdout);
                }
            };

            engineWorker.postMessage({ wasm_type: type, basePath: basePath });
        } catch (e) {
            console.error("Lỗi bao ngoài khi khởi tạo Single Worker:", e);
            onEngineError("Lỗi khởi tạo Worker: " + e.toString());
        }
    }
}

function onEngineReady(type) {
    state.engineModule.sendCommand("uci");
    state.engineModule.sendCommand("setoption name UCI_ShowWDL value true");
    state.engineModule.sendCommand("isready");
    
    const overlay = document.getElementById('loading-overlay');
    if (overlay) { 
        overlay.style.opacity = '0'; 
        setTimeout(() => { overlay.style.display = 'none'; }, 500); 
    }

    if (pendingAction) {
        if (state.appMode !== 'vsbot') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
        }
        executePendingAction();
    } else {
        applyEngineSettings(); 
    }
}

function onEngineError(err) {
    console.error("Lỗi khởi tạo AI (Hàm onEngineError):", err);
    const overlay = document.getElementById('loading-overlay');
    if(overlay) overlay.innerHTML = `<h2 style='color:red; text-align:center;'>Lỗi tải Engine AI</h2><p style='text-align:center;'>${err.toString()}</p>`;
}

export function selectHumanLikeMove(parsedMultiPVList, currentLevelData) {
    if (!parsedMultiPVList || parsedMultiPVList.length === 0) return null;
    const pv1 = parsedMultiPVList[0];
    if (pv1.isMate || parsedMultiPVList.some(pv => pv.isMate)) {
        return { selectedMove: pv1.move, fakeDelayMs: getRandomDelay(0.5, 1.5) };
    }
    const probs = currentLevelData.pvProbabilities;
    let roll = Math.random(); let cumulative = 0.0; let selectedIndex = 0;
    for (let i = 0; i < probs.length; i++) {
        cumulative += probs[i];
        if (roll <= cumulative) { selectedIndex = i; break; }
    }
    if (selectedIndex >= parsedMultiPVList.length) selectedIndex = parsedMultiPVList.length - 1;
    let selectedPv = parsedMultiPVList[selectedIndex];
    const cpDrop = pv1.cp - selectedPv.cp; 
    if (cpDrop > currentLevelData.maxCentipawnDrop) selectedPv = pv1; 
    return { selectedMove: selectedPv.move, fakeDelayMs: getRandomDelay(currentLevelData.minFakeThinkTime, currentLevelData.maxFakeThinkTime) };
}

function getRandomDelay(minSeconds, maxSeconds) {
    const minMs = minSeconds * 1000; const maxMs = maxSeconds * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

export function applyEngineSettings() {
    if (!state.engineModule) return;
    pendingAction = 'eval';
    handleStateTransition(); 
}

let currentCloudFetchId = 0;
export async function fetchCloudBook(fen) {
    const isRedTurn = fen.split(" ")[1] === "w";
    const isAITurn = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    const container = document.getElementById('cloudbook-list-container');
    if (!container) return;

    const bookType = state.appSettings.bookType || 'cloud';

    if (bookType === 'local') {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Đang tìm trong Local Book...</div>';
        
        const localMoves = await queryLocalBookWorker(fen);
        
        if (localMoves === 'LOADING') {
            container.innerHTML = '<div style="text-align: center; color: #1a73e8; margin-top: 10px;">⏳ Đang nạp Local Book vào RAM...</div>';
            return;
        }
        
        if (localMoves === 'NO_DB') {
            container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 15px; line-height: 1.5;">Chưa có dữ liệu Local Book<br><span style="font-size: 12px; color: #666; font-weight: normal;">Vui lòng vào <b>Cài đặt</b> ⚙️ để tải lên tệp</span></div>';
            if (isAITurn) triggerEngineOnly();
            return;
        }
        
        handleBookResults(localMoves, isAITurn, isRedTurn, container, fen);
        return;
    }

    if (!navigator.onLine) {
        container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 15px;">❌ Không có kết nối mạng để tải Cloud Book</div>';
        if (isAITurn) setTimeout(() => triggerEngineOnly(), 10);
        return; 
    }
    
    const fetchId = ++currentCloudFetchId;
    container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Đang tải dữ liệu Cloud...</div>';
    let shortFen = fen.split(" ").slice(0, 2).join(" ");
    let url = `https://www.chessdb.cn/chessdb.php?action=queryall&board=${encodeURIComponent(shortFen)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    fetch(url, { signal: controller.signal }).then(res => {
        clearTimeout(timeoutId);
        return res.text();
    }).then(text => {
        if (fetchId !== currentCloudFetchId) return;
        
        let isValidCloudData = text && !text.includes("unknown") && !text.includes("invalid");
        let parsedMoves = [];
        
        if (isValidCloudData) {
            let moves = text.split('|');
            moves.forEach(mStr => {
                let parts = mStr.split(','); let moveObj = {};
                parts.forEach(p => { let [k, v] = p.split(':'); moveObj[k] = v; });
                if (moveObj.move) parsedMoves.push(moveObj);
            });
        }
        
        handleBookResults(parsedMoves, isAITurn, isRedTurn, container, fen);
        
    }).catch(err => {
        if (fetchId !== currentCloudFetchId) return;
        container.innerHTML = '<div style="text-align: center; color: #d32f2f; margin-top: 10px;">❌ Lỗi kết nối máy chủ CloudDB</div>';
        if (isAITurn) triggerEngineOnly();
    });
}

function handleBookResults(movesList, isAITurn, isRedTurn, container, fen) {
    const currentRoundNum = parseInt(fen.split(" ")[5]) || 1;
    let effectiveCloudLimit = state.appMode === 'vsbot' ? 1 : state.appSettings.cloudBookLimit;
    const canUseBook = state.appSettings.cloudBookEnabled && (currentRoundNum <= effectiveCloudLimit);

    if (isAITurn && canUseBook && movesList.length > 0) {
        let bestMove = movesList[0].move;
        if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(bestMove)) {
            let delayMs = state.appMode !== 'vsbot' ? (state.aiSettings.moveTime || 1) * 1000 : 1000;
            showAILoading();
            
            clearTimeout(cloudBookTimeoutId);
            cloudBookTimeoutId = setTimeout(() => { 
                const isRedTurnNow = state.currentNode.fen.split(" ")[1] === "w";
                const willAIOperate = (isRedTurnNow && state.aiPlaysRed) || (!isRedTurnNow && state.aiPlaysBlack);
                if (willAIOperate) {
                    hideAILoading();
                    executeMove(bestMove); 
                } else {
                    hideAILoading();
                }
            }, delayMs); 
            return;
        }
    }

    if (isAITurn) triggerEngineOnly();

    if (movesList.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Không có dữ liệu khai cuộc</div>';
        return;
    }
    
    container.innerHTML = ''; 
    let headerBtn = document.createElement('div'); headerBtn.className = 'cloud-btn cloud-header';
    let spanHeaderMove = document.createElement('span'); spanHeaderMove.innerText = 'Nước Đi';
    let spanHeaderScore = document.createElement('span'); spanHeaderScore.innerText = isRedTurn ? 'Điểm Bên Đỏ' : 'Điểm Bên Đen';
    headerBtn.appendChild(spanHeaderMove); headerBtn.appendChild(spanHeaderScore); container.appendChild(headerBtn);
    
    movesList.forEach(moveObj => {
        let isPositive = true; let scoreText = "0";
        if (moveObj.score !== undefined) {
            let score = parseInt(moveObj.score); isPositive = score >= 0; scoreText = (isPositive ? '+' : '') + score;
        } else if (moveObj.winrate !== undefined) {
            let wr = parseFloat(moveObj.winrate); isPositive = wr >= 50.0; scoreText = `${wr}%`; 
        }
        
        import('./game.js').then(({ customTranslator }) => {
            let notation = customTranslator(moveObj.move, fen) || moveObj.move;
            let btn = document.createElement('button'); btn.className = `cloud-btn ${isPositive ? 'cloud-blue' : 'cloud-red'}`;
            let spanMove = document.createElement('span'); spanMove.innerText = notation;
            let spanScore = document.createElement('span'); spanScore.innerText = scoreText;
            btn.appendChild(spanMove); btn.appendChild(spanScore);
            btn.onclick = () => {
                if (getStrictLegalMoves(state.currentSituation, state.currentNode.fen).includes(moveObj.move)) { executeMove(moveObj.move); } 
                else { showToast("⚠️ Nước đi này bị cấm do luật lặp lại!"); }
            };
            container.appendChild(btn);
        });
    });
}

export function triggerEngineEvaluation() {
    if (!state.engineModule || state.isEditMode) return;
    pendingAction = 'eval';
    handleStateTransition();
}

export function triggerHintEvaluation() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'hint';
    handleStateTransition();
}

export function triggerAnalyzeOnly() {
    if (!state.engineModule || state.isAnimating || state.isAutoPlaying) return;
    pendingAction = 'analyze';
    handleStateTransition();
}

function handleStateTransition() {
    clearTimeout(cloudBookTimeoutId); 
    
    if (isEngineSearching) {
        if (currentEngineInstance instanceof Worker) {
            currentEngineInstance.terminate();
            currentEngineInstance = null;
            state.engineModule = null;
            isEngineSearching = false;
            
            initPikafish(currentWasmType);
        } else {
            state.engineModule.sendCommand("stop");
            clearTimeout(stopTimeoutId);
            stopTimeoutId = setTimeout(() => {
                if (pendingAction) {
                    isEngineSearching = false;
                    executePendingAction();
                }
            }, 150);
        }
    } else {
        executePendingAction();
    }
}

function executePendingAction() {
    const action = pendingAction;
    pendingAction = null; 
    clearTimeout(stopTimeoutId); 

    setTimeout(() => {
        if (action === 'eval') {
            const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
            const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

            if (!willAIPlay && state.isAnalyzing) {
                triggerEngineOnly();
            }

            fetchCloudBook(state.currentNode.fen);
        }
        else if (action === 'hint') {
            const style = state.vsBotSettings.botStyle;
            let profile = (style === 'human') ? botProfiles.human[9] : botProfiles.standard[9];

            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value 1`); 
            state.pvLines = []; clearArrow(); renderMultiPVList();

            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
            isEngineSearching = true; 
        }
        else if (action === 'analyze') {
            state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
            state.pvLines = []; clearArrow(); renderMultiPVList();

            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
            
            const tier = getDeviceTier();
            let analyzeDepth = 100;
            if (tier === 'MOBILE_HIGH') analyzeDepth = 60;
            else if (tier === 'MOBILE_LOW') analyzeDepth = 30;
            
            state.engineModule.sendCommand(`go depth ${analyzeDepth}`);
            isEngineSearching = true; 
        }
        else if (action === 'go_instant') {
            state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`); 
            state.engineModule.sendCommand("go movetime 100"); 
            isEngineSearching = true;
        }
    }, 10);
}

function triggerEngineOnly() {
    if (!state.engineModule || state.isAnimating || state.isEditMode || state.isAutoPlaying) return;
    const strictMoves = getStrictLegalMoves(state.currentSituation, state.currentNode.fen);
    if (strictMoves.length === 0) return;

    if (state.appMode !== 'vsbot') {
        state.engineModule.sendCommand(`setoption name Skill Level value ${state.aiSettings.skill}`);
        state.engineModule.sendCommand(`setoption name MultiPV value ${state.aiSettings.multiPV}`);
    }

    state.pvLines = []; clearArrow(); renderMultiPVList();

    state.engineModule.sendCommand(`position fen ${state.currentNode.fen}`);
    
    const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
    const willAIPlay = (isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack);

    if (state.appMode === 'vsbot' && willAIPlay) {
        const style = state.vsBotSettings.botStyle;
        const levelIdx = state.vsBotSettings.level - 1;
        let profile;
        if (style === 'human') {
            profile = botProfiles.human[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value ${profile.multiPVCount}`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        } else {
            profile = botProfiles.standard[levelIdx];
            state.engineModule.sendCommand(`setoption name Skill Level value ${profile.uciSkillLevel}`);
            state.engineModule.sendCommand(`setoption name MultiPV value 1`);
            state.engineModule.sendCommand(`go depth ${profile.searchDepth} movetime ${profile.maxMovetimeMs}`);
        }
        isEngineSearching = true; 
        showAILoading(); 
    } 
    else {
        if (willAIPlay) {
            const moveTimeMs = Math.floor(state.aiSettings.moveTime * 1000);
            state.engineModule.sendCommand(`go depth ${state.aiSettings.depth} movetime ${moveTimeMs}`);
            isEngineSearching = true; 
            showAILoading(); 
        } else if (state.isAnalyzing) {
            const tier = getDeviceTier();
            let analyzeDepth = 100;
            if (tier === 'MOBILE_HIGH') analyzeDepth = 60;
            else if (tier === 'MOBILE_LOW') analyzeDepth = 30;
            
            state.engineModule.sendCommand(`go depth ${analyzeDepth}`);
            isEngineSearching = true; 
        }
    }
}

function renderMultiPVList() {
    const container = document.getElementById("multipv-list-container");
    if (!container) return;
    if (!state.pvLines || state.pvLines.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #888; margin-top: 10px;">Chưa có dữ liệu phân tích</div>';
        return;
    }
    let html = ''; 
    const startFen = state.currentNode ? state.currentNode.fen : "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

    state.pvLines.forEach(line => {
        if (!line) return;

        let npsFormatted = line.nps ? (line.nps >= 1000000 ? (line.nps / 1000).toFixed(0) + "K" : (line.nps / 1000).toFixed(1) + "K") : "0K";
        let timeStr = line.time ? (line.time / 1000).toFixed(1) + "s" : "0.0s";
        let scoreStr = line.scoreText || "0";
        let depthStr = line.depth || 0;
        let rankStr = `PV${line.rank}`;
        
        let movesHtml = "";
        if (line.pvMoves && line.pvMoves.length > 0) {
            let currentFen = startFen;
            let movesArray = [];

            for (let i = 0; i < line.pvMoves.length; i++) {
                const uciMove = line.pvMoves[i];
                if (!uciMove) break;
                
                const notation = customTranslator(uciMove, currentFen);
                if (!notation) break;

                const isRedTurn = currentFen.split(" ")[1] === "w";
                const colorClass = isRedTurn ? "pv-move-red" : "pv-move-black";
                movesArray.push(`<span class="pv-move ${colorClass}">${notation}</span>`);

                if (typeof vschess !== 'undefined' && typeof vschess.fenMovePiece === 'function') {
                    currentFen = vschess.fenMovePiece(currentFen, uciMove);
                } else {
                    break;
                }
            }
            movesHtml = movesArray.join("");
        } else if (line.bestMove) {
            const notation = customTranslator(line.bestMove, startFen) || line.bestMove;
            const isRedTurn = startFen.split(" ")[1] === "w";
            movesHtml = `<span class="pv-move ${isRedTurn ? 'pv-move-red' : 'pv-move-black'}">${notation}</span>`;
        }

        html += `
            <div class="multipv-card">
                <div class="multipv-header-bar">
                    <strong>${rankStr}</strong> | 
                    <span>Độ sâu: <strong>${depthStr}</strong></span> | 
                    <span>Điểm: <strong>${scoreStr}</strong></span> | 
                    <span>NPS: <strong>${npsFormatted}</strong></span> | 
                    <span>Time: <strong>${timeStr}</strong></span>
                </div>
                <div class="multipv-moves-body">
                    ${movesHtml}
                </div>
            </div>`;
    });
    container.innerHTML = html;
}

export function handleEngineOutput(text) {
    if (Array.isArray(engineOutputListeners)) {
        for (let i = engineOutputListeners.length - 1; i >= 0; i--) {
            try {
                if (typeof engineOutputListeners[i] === 'function') {
                    engineOutputListeners[i](text);
                }
            } catch(e) {}
        }
    }

    if (text.startsWith("info depth")) {
        const depthMatch = text.match(/depth (\d+)/);
        const scoreCpMatch = text.match(/score cp (-?\d+)/);
        const scoreMateMatch = text.match(/score mate (-?\d+)/);
        const timeMatch = text.match(/time (\d+)/);
        const npsMatch = text.match(/nps (\d+)/);
        const multipvMatch = text.match(/multipv (\d+)/);
        const wdlMatch = text.match(/wdl (\d+) (\d+) (\d+)/);
        
        const pvIdx = text.indexOf(" pv ");
        let pvMoves = [];
        if (pvIdx !== -1) {
            const pvStr = text.substring(pvIdx + 4).trim();
            pvMoves = pvStr.split(/\s+/).filter(m => /^[a-i][0-9][a-i][0-9]$/.test(m));
        }
        
        let rank = multipvMatch ? parseInt(multipvMatch[1]) : 1;
        let isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        let turnPrefix = isRedTurn ? "Điểm Đỏ: " : "Điểm Đen: "; 
        let scoreText = "0"; let finalScoreForBar = 0; let relativeScore = 0;    
        let winPct = 0, drawPct = 0, lossPct = 0;
        let hasWdlData = false;

        if (wdlMatch) {
            hasWdlData = true;
            const w = parseInt(wdlMatch[1], 10);
            const d = parseInt(wdlMatch[2], 10);
            const l = parseInt(wdlMatch[3], 10);
            const total = w + d + l || 1000;
            const wVal = Math.round((w / total) * 1000) / 10;
            const dVal = Math.round((d / total) * 1000) / 10;
            const lVal = Math.round((l / total) * 1000) / 10;
            
            if (isRedTurn) {
                winPct = wVal;
                drawPct = dVal;
                lossPct = lVal;
            } else {
                winPct = lVal;
                drawPct = dVal;
                lossPct = wVal;
            }
        }

        if (scoreCpMatch) {
            let cp = parseInt(scoreCpMatch[1]); relativeScore = cp; 
            scoreText = (relativeScore > 0 ? "+" : "") + relativeScore;
            if (relativeScore === 0) scoreText = "0";
            finalScoreForBar = isRedTurn ? cp : -cp;
            if (rank === 1) {
                let winRate = 50 + (finalScoreForBar / 20); 
                if (winRate > 100) winRate = 100; if (winRate < 0) winRate = 0;
                const scoreBarFill = document.getElementById("score-bar-fill");
                if (scoreBarFill) scoreBarFill.style.width = `${winRate}%`;
                const scoreTextEl = document.getElementById("score-text");
                if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;

                if (!hasWdlData) {
                    hasWdlData = true;
                    // Sigmoid model: tính xác suất thắng của Đỏ từ centipawns (finalScoreForBar luôn theo góc Đỏ)
                    const redWinProb = 1 / (1 + Math.exp(-finalScoreForBar / 200));
                    const blackWinProb = 1 - redWinProb;
                    // Xác suất hòa giảm dần khi chênh lệch điểm càng lớn
                    const absCp = Math.abs(finalScoreForBar);
                    const drawProb = Math.max(0, 0.30 - absCp * 0.0004);
                    // Phân bổ tỷ lệ
                    const remainForWinLoss = 1 - drawProb;
                    winPct = Math.round(redWinProb * remainForWinLoss * 1000) / 10;
                    lossPct = Math.round(blackWinProb * remainForWinLoss * 1000) / 10;
                    drawPct = Math.round((100 - winPct - lossPct) * 10) / 10;
                    if (drawPct < 0) drawPct = 0;
                }

                if (state.currentNode && !window.isAnalyzingGameGlobal) {
                    state.currentNode.evalScore = finalScoreForBar / 100.0;
                    import('./analysis/eval-graph.js').then(m => m.renderEvalGraph()).catch(() => {});
                }
            }
        } 
        else if (scoreMateMatch) {
            let mate = parseInt(scoreMateMatch[1]); relativeScore = mate > 0 ? 10000 : -10000;
            scoreText = `chiếu hết(${mate > 0 ? '+' : '-'}${Math.abs(mate)})`;
            if (rank === 1) {
                let isRedWin = (isRedTurn && mate > 0) || (!isRedTurn && mate < 0);
                const scoreBarFill = document.getElementById("score-bar-fill");
                if (scoreBarFill) scoreBarFill.style.width = isRedWin ? `100%` : `0%`;
                const scoreTextEl = document.getElementById("score-text");
                if (scoreTextEl) scoreTextEl.innerText = turnPrefix + scoreText;

                hasWdlData = true;
                if (isRedWin) { winPct = 100; drawPct = 0; lossPct = 0; }
                else { winPct = 0; drawPct = 0; lossPct = 100; }
            }
        }

        // CHỈ cập nhật thanh WDL khi thực sự có dữ liệu mới (tránh ghi đè bằng giá trị mặc định)
        if (rank === 1 && hasWdlData) {
            const winFill = document.getElementById("wdl-win-fill");
            const drawFill = document.getElementById("wdl-draw-fill");
            const lossFill = document.getElementById("wdl-loss-fill");
            if (winFill && drawFill && lossFill) {
                winFill.style.width = `${winPct}%`;
                winFill.innerText = winPct >= 10 ? `Đỏ ${winPct}%` : (winPct >= 5 ? `${winPct}%` : '');
                drawFill.style.width = `${drawPct}%`;
                drawFill.innerText = drawPct >= 10 ? `Hòa ${drawPct}%` : (drawPct >= 5 ? `${drawPct}%` : '');
                lossFill.style.width = `${lossPct}%`;
                lossFill.innerText = lossPct >= 10 ? `Đen ${lossPct}%` : (lossPct >= 5 ? `${lossPct}%` : '');
            }
        }
        if (pvMoves.length > 0) {
            state.pvLines[rank - 1] = {
                rank: rank,
                bestMove: pvMoves[0],
                ponderMove: pvMoves[1] || null,
                pvMoves: pvMoves,
                scoreText: scoreText,
                relativeScore: relativeScore, 
                depth: depthMatch ? parseInt(depthMatch[1]) : 0,
                time: timeMatch ? parseInt(timeMatch[1]) : 0,
                nps: npsMatch ? parseInt(npsMatch[1]) : 0
            };
            const now = Date.now();
            if (now - lastUiUpdateTime > 100) {
                renderMultiPVList(); 
                drawBestMoveArrow();
                lastUiUpdateTime = now;
            }
        }
    } 
    
    else if (text.startsWith("bestmove")) {
        isEngineSearching = false;

        renderMultiPVList();
        drawBestMoveArrow();

        if (pendingAction) {
            executePendingAction();
            return; 
        }

        if (state.isAutoPlaying || state.isAnimating) return;
        const parts = text.split(" "); 
        const bestMove = parts[1] ? parts[1].trim() : "";
        
        if (bestMove === '(none)' || bestMove === 'none' || bestMove === '') {
            state.pvLines = []; clearArrow(); renderMultiPVList(); 
            hideAILoading();
            return;
        }

        const isRedTurn = state.currentNode.fen.split(" ")[1] === "w";
        
        if (state.appMode === 'vsbot' && !((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack))) {
            state.pendingAIMove = bestMove; 
            hideAILoading();
            return;
        }

        if ((isRedTurn && state.aiPlaysRed) || (!isRedTurn && state.aiPlaysBlack)) {
            if (state.appMode === 'vsbot' && state.vsBotSettings.botStyle === 'human') {
                const levelIdx = state.vsBotSettings.level - 1;
                const currentLevelData = botProfiles.human[levelIdx];
                let parsedMultiPVList = state.pvLines.filter(p => p).map(p => ({
                    move: p.bestMove, cp: p.relativeScore, isMate: p.scoreText.includes('chiếu hết')
                }));
                parsedMultiPVList.sort((a, b) => b.cp - a.cp);
                const result = selectHumanLikeMove(parsedMultiPVList, currentLevelData);

                if (result) {
                    setTimeout(() => { 
                        state.pendingAIMove = result.selectedMove; 
                        hideAILoading();
                    }, result.fakeDelayMs);
                } else {
                    state.pendingAIMove = bestMove; 
                    hideAILoading();
                }
            } else {
                state.pendingAIMove = bestMove;
                hideAILoading();
            }
        } else {
            hideAILoading();
        }
    }
}

function attachCrashHandlers() {
    window.addEventListener('error', handleEngineCrash);
    window.addEventListener('unhandledrejection', handleEngineCrash);
}

function handleEngineCrash(e) {
    const msg = (e?.error?.message) || (e?.reason?.message) || String(e?.reason || "");
    if (msg.includes("Out of bounds memory access") || msg.includes("memory access out of bounds")) {
        fallbackToSingleThread(msg);
    }
}

function fallbackToSingleThread(reason) {
    if (fallbackTriggered || !currentWasmType || !currentWasmType.includes("multi")) return;
    
    fallbackTriggered = true;
    console.warn("🔥 Trình duyệt sập bộ nhớ do đa luồng. Kích hoạt Cứu Hộ (Fallback) về Đơn luồng!", reason);
    showToast("⚠️ Trình duyệt cạn RAM! Đang tự động chuyển về chế độ An toàn...");

    try {
        if (currentEngineInstance && typeof currentEngineInstance.terminate === 'function') {
            currentEngineInstance.terminate();
        }
    } catch (err) { console.warn("Lỗi khi kill engine", err); }

    currentEngineInstance = null;
    state.engineModule = null;

    let newType = "single";
    if (currentWasmType.includes("simd")) newType = "single_simd";

    setTimeout(() => {
        initPikafish(newType);
    }, 500);
}

export function triggerGoInstant() {
    if (!state.engineModule) return;
    pendingAction = 'go_instant';
    handleStateTransition(); 
}

export function forceStopEngine() {
    if (!state.engineModule || !isEngineSearching) return;
    pendingAction = null; 
    
    if (currentEngineInstance instanceof Worker) {
        currentEngineInstance.terminate();
        currentEngineInstance = null;
        state.engineModule = null;
        isEngineSearching = false;
        initPikafish(currentWasmType); 
    } else {
        state.engineModule.sendCommand("stop");
        isEngineSearching = false;
    }
}

export function sendEngineCommand(cmd) {
    if (state.engineModule && typeof state.engineModule.sendCommand === 'function') {
        state.engineModule.sendCommand(cmd);
    }
}