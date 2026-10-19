// js/online.js
import { state } from './state.js';
import { showToast, showLoading, hideLoading, openModal, closeModal, updateTurnToggleUI } from './ui.js';
import { initGame, executeMove, getMainLine, instantJumpToNode } from './game.js';
import { START_FEN } from './config.js';
import { clearUserDrawLines, renderBoardFull } from './board.js';

// Escape HTML cho mọi dữ liệu do người chơi khác gửi (tên, chat) trước khi chèn bằng innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Toast an toàn cho nội dung có chứa tên/tin nhắn của người khác
function notify(text) {
    showToast(escapeHtml(text));
}

// Phiên bản giao thức voice (phải khớp VOICE_PROTOCOL trong server.js).
// Máy chạy code cũ (do cache) không kết nối voice được với máy bản mới → được nhắc tải lại trang.
const CLIENT_VOICE_PROTOCOL = 2;

function isTouchDevice() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}

// Lấy tên hiển thị từ thiết bị hoặc tự sinh mặc định
export function getOnlineUserName() {
    let name = localStorage.getItem('tuongky_username');
    if (!name || !name.trim()) {
        name = 'Kỳ thủ ' + Math.floor(100 + Math.random() * 900);
        localStorage.setItem('tuongky_username', name);
    }
    return name.trim();
}

// Cập nhật tên hiển thị của người dùng (lưu vào cache thiết bị và đồng bộ phòng)
export function setOnlineUserName(newName) {
    const clean = String(newName || '').trim().slice(0, 25);
    if (!clean) return false;

    localStorage.setItem('tuongky_username', clean);
    onlineState.myUserName = clean;

    const inputName = document.getElementById('input-online-username');
    if (inputName) inputName.value = clean;

    updateOnlineRoomBar();
    scheduleVoiceUIUpdate();

    if (onlineState.roomCode) {
        wsSend({
            type: 'SET_USERNAME',
            roomCode: onlineState.roomCode,
            userName: clean
        });
    }
    return true;
}

// Lấy hoặc tạo UID cố định của người dùng trong trình duyệt
export function getOrCreateUserId() {
    let uid = localStorage.getItem('tuongky_online_uid');
    if (!uid) {
        uid = 'u_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        localStorage.setItem('tuongky_online_uid', uid);
    }
    return uid;
}

export const onlineState = {
    connected: false,
    roomCode: null,
    isHost: false,
    isSpectator: false,      // true nếu là người xem cờ
    myColor: 'red',          // 'red' | 'black'
    opponentColor: 'black',  // 'red' | 'black'
    myUserName: getOnlineUserName(),
    opponentUserName: 'Đối thủ',
    currentTurn: 'w',        // 'w' | 'b'
    opponentJoined: false,
    opponentConnected: false,
    ws: null,
    // Voice & Video WebRTC (Full Mesh "luôn kết nối" như Google Meet — tối đa VOICE_MESH_LIMIT người)
    isMicActive: false,
    isCameraActive: false,
    isSpeakerMuted: false,
    localStream: null,
    localVideoStream: null,
    // Map<userId, Peer> — mỗi thành viên 1 kết nối riêng (Peer.pc là RTCPeerConnection)
    peerConnections: new Map(),
    // Set<userId> — danh sách những người đang bật Mic trong phòng
    micUsers: new Set(),
    // Danh sách thành viên trong phòng: { userId, userName, role, connected, micOn, camOn }
    roomMembers: [],
    // Đồng hồ tính giờ
    timerState: {
        enabled: false,
        mode: 'none',        // 'none' | 'increment' | 'per_move'
        baseMinutes: 10,
        incSeconds: 5,
        moveLimitSeconds: 90,
        redTimeMs: 10 * 60 * 1000,
        blackTimeMs: 10 * 60 * 1000,
        activeSide: null,
        isRunning: false,
        lastTick: null
    },
    // Danh sách khán giả & kỳ thủ trong phòng
    spectatorCount: 0,
    spectatorsList: [],
    players: { host: null, guest: null },
    // Chat UI state
    unreadChatCount: 0
};

export function isOnlineMode() {
    return state.appMode === 'online';
}

export function isSpectator() {
    return isOnlineMode() && !!onlineState.isSpectator;
}

export function isMyOnlineTurn() {
    if (!isOnlineMode()) return true;
    if (onlineState.isSpectator) return false; // Khán giả không được đi quân
    const isRedTurn = (state.currentNode ? state.currentNode.fen.split(' ')[1] : onlineState.currentTurn) === 'w';
    return (onlineState.myColor === 'red' && isRedTurn) || (onlineState.myColor === 'black' && !isRedTurn);
}

export function getMyOnlineColor() {
    return onlineState.myColor;
}

// Socket đang mở và sẵn sàng gửi tin (dùng để chặn đi quân khi đang mất mạng → tránh lệch bàn cờ)
export function isOnlineSocketReady() {
    return !!onlineState.ws && onlineState.ws.readyState === WebSocket.OPEN;
}

// Gửi tin an toàn: không ném lỗi khi socket đang đóng
function wsSend(obj) {
    const ws = onlineState.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch (e) {
        return false;
    }
}

// ============================================================
// HỆ THỐNG ĐỒNG HỒ TÍNH GIỜ (DIGITAL CHESS CLOCKS)
// ============================================================
let clockInterval = null;

export function formatClockTime(ms) {
    if (ms === null || ms === undefined || ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function startClockTicker() {
    if (clockInterval) clearInterval(clockInterval);
    updateClocksTick();

    const timer = onlineState.timerState;
    if (!timer || !timer.enabled || !timer.isRunning) {
        clockInterval = null;
        return;
    }

    // Tối ưu cho mobile: Chạy 500ms thay vì 100ms để giảm 80% tải CPU & reflow
    clockInterval = setInterval(() => {
        updateClocksTick();
    }, 500);
}

export function stopClockTicker() {
    if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
    }
}

export function updateClocksTick() {
    const timer = onlineState.timerState;
    const topClock = document.getElementById('online-clock-top');
    const botClock = document.getElementById('online-clock-bottom');

    if (!timer || !timer.enabled) {
        [topClock, botClock].forEach(clock => {
            if (!clock) return;
            if (clock.textContent !== '--:--') clock.textContent = '--:--';
            if (clock.className !== 'online-digital-clock clock-off') clock.className = 'online-digital-clock clock-off';
            clock.title = 'Chưa bật đồng hồ (chủ phòng có thể bật trong "Đồng Hồ")';
        });
        return;
    }

    let currentRedMs = timer.redTimeMs;
    let currentBlackMs = timer.blackTimeMs;
    let stepRemainSec = null;

    if (timer.isRunning && timer.lastTick && timer.activeSide) {
        const elapsed = Date.now() - timer.lastTick;
        if (timer.activeSide === 'w') {
            currentRedMs = Math.max(0, timer.redTimeMs - elapsed);
        } else if (timer.activeSide === 'b') {
            currentBlackMs = Math.max(0, timer.blackTimeMs - elapsed);
        }

        const stepLimitSec = timer.mode === 'per_move' ? (timer.moveLimitSeconds || 60) : (timer.stepSeconds || 0);
        if (stepLimitSec > 0) {
            stepRemainSec = Math.max(0, Math.ceil((stepLimitSec * 1000 - elapsed) / 1000));
        }
    }

    // Phân bổ đồng hồ cho Top và Bottom theo hướng xoay bàn cờ
    const isBottomRed = !state.isBoardFlipped;
    const bottomMs = isBottomRed ? currentRedMs : currentBlackMs;
    const topMs = isBottomRed ? currentBlackMs : currentRedMs;

    const isBottomActive = timer.isRunning && ((isBottomRed && timer.activeSide === 'w') || (!isBottomRed && timer.activeSide === 'b'));
    const isTopActive = timer.isRunning && ((!isBottomRed && timer.activeSide === 'w') || (isBottomRed && timer.activeSide === 'b'));

    function renderClockText(totalMs, isActive) {
        if (timer.mode === 'per_move') {
            if (isActive && stepRemainSec !== null) {
                return `${stepRemainSec}s`;
            }
            return `${timer.moveLimitSeconds || 60}s`;
        }
        // mode === 'increment'
        const baseStr = formatClockTime(totalMs);
        if (isActive && stepRemainSec !== null && timer.stepSeconds > 0) {
            return `${baseStr} (${stepRemainSec}s)`;
        }
        return baseStr;
    }

    if (botClock) {
        const text = renderClockText(bottomMs, isBottomActive);
        if (botClock.textContent !== text) botClock.textContent = text;
        const isWarning = timer.isRunning && (bottomMs <= 30000 || (isBottomActive && stepRemainSec !== null && stepRemainSec <= 10));
        const newClass = 'online-digital-clock' + (isBottomActive ? ' clock-active' : '') + (isWarning ? ' time-warning' : '');
        if (botClock.className !== newClass) botClock.className = newClass;
    }

    if (topClock) {
        const text = renderClockText(topMs, isTopActive);
        if (topClock.textContent !== text) topClock.textContent = text;
        const isWarning = timer.isRunning && (topMs <= 30000 || (isTopActive && stepRemainSec !== null && stepRemainSec <= 10));
        const newClass = 'online-digital-clock' + (isTopActive ? ' clock-active' : '') + (isWarning ? ' time-warning' : '');
        if (topClock.className !== newClass) topClock.className = newClass;
    }
}

// Thông tin kỳ thủ đang cầm 1 màu (dùng cho dải tên trên/dưới bàn cờ)
function getPlayerByColor(color) {
    const myId = getOrCreateUserId();
    if (!onlineState.isSpectator) {
        if (onlineState.myColor === color) {
            return { userName: onlineState.myUserName, userId: myId, isMe: true, connected: isOnlineSocketReady(), micOn: onlineState.isMicActive };
        }
        const opp = onlineState.roomMembers.find(m => (m.role === 'host' || m.role === 'guest') && m.userId !== myId);
        if (!onlineState.opponentJoined) return { userName: 'Đang chờ đối thủ...', userId: null, waiting: true };
        return {
            userName: onlineState.opponentUserName || 'Đối thủ',
            userId: opp ? opp.userId : null,
            connected: onlineState.opponentConnected,
            micOn: !!(opp && opp.micOn && opp.connected)
        };
    }
    const players = onlineState.players || {};
    const p = [players.host, players.guest].find(x => x && x.color === color);
    if (!p) return { userName: 'Chờ kỳ thủ...', userId: null, waiting: true };
    return { userName: p.userName, userId: p.userId || null, connected: p.connected !== false, micOn: !!p.micOn && p.connected !== false };
}

function getTurnColor() {
    const turn = state.currentNode ? state.currentNode.fen.split(' ')[1] : onlineState.currentTurn;
    return turn === 'b' ? 'black' : 'red';
}

function renderPlayerStrip(pos, color, turnColor, bothSeated) {
    const strip = document.getElementById(`online-player-strip-${pos}`);
    if (!strip) return;
    const p = getPlayerByColor(color);
    const nameEl = document.getElementById(`online-name-${pos}`);
    const sideEl = document.getElementById(`online-side-${pos}`);
    const micEl = document.getElementById(`online-mic-${pos}`);
    const turnEl = document.getElementById(`online-turn-${pos}`);

    if (nameEl) {
        const name = p.isMe ? `${p.userName} (Bạn)` : p.userName;
        if (nameEl.textContent !== name) nameEl.textContent = name;
        nameEl.title = name;
    }
    const isTurn = bothSeated && turnColor === color;
    if (sideEl) {
        // Dòng 2 dưới tên: bên cờ + "Lượt của bạn"/"Đang đi" (đặt ở đây để tên và đồng hồ không bị chèn ép)
        const sideHtml = (color === 'red' ? '<span class="side-chip side-red">Đỏ</span>' : '<span class="side-chip side-black">Đen</span>') +
            (isTurn ? `<span class="strip-turn-label">${p.isMe ? 'Lượt của bạn' : 'Đang đi…'}</span>` : '') +
            (p.connected === false ? '<span class="strip-net">📡 mất mạng</span>' : '');
        if (sideEl.innerHTML !== sideHtml) sideEl.innerHTML = sideHtml;
    }
    if (micEl) {
        micEl.textContent = p.micOn ? '🎙️' : '';
        micEl.title = p.micOn ? 'Đang bật mic' : '';
    }

    strip.classList.toggle('is-turn', isTurn);
    strip.classList.toggle('is-me', !!p.isMe);
    strip.classList.toggle('is-waiting', !!p.waiting);
    strip.classList.toggle('is-offline', p.connected === false);
    strip.dataset.uid = p.userId || '';
    if (turnEl) turnEl.textContent = '';
}

// Cập nhật dải thông tin người chơi và camera trên/dưới bàn cờ.
// Dải DƯỚI luôn là bên đang nằm ở phía dưới bàn cờ (đổi chỗ đúng khi bấm "Lật cờ").
export function updatePlayerStripsUI() {
    const topStrip = document.getElementById('online-player-strip-top');
    const botStrip = document.getElementById('online-player-strip-bottom');
    if (!topStrip || !botStrip) return;

    if (!isOnlineMode() || !onlineState.roomCode) {
        topStrip.style.display = 'none';
        botStrip.style.display = 'none';
        return;
    }

    topStrip.style.display = 'flex';
    botStrip.style.display = 'flex';

    const bottomColor = state.isBoardFlipped ? 'black' : 'red';
    const topColor = bottomColor === 'red' ? 'black' : 'red';
    const bothSeated = onlineState.isSpectator
        ? !!(onlineState.players && onlineState.players.host && onlineState.players.guest)
        : !!onlineState.opponentJoined;
    const turnColor = getTurnColor();
    renderPlayerStrip('top', topColor, turnColor, bothSeated);
    renderPlayerStrip('bottom', bottomColor, turnColor, bothSeated);
    lastStripsKey = getStripsKey();

    updateClocksTick();
}

// Dải tên cần vẽ lại khi hướng bàn cờ hoặc lượt đi đổi (kể cả khi đổi từ chỗ khác: lật cờ, đi quân, xem lại nước cũ)
let lastStripsKey = '';
function getStripsKey() {
    return `${state.isBoardFlipped}|${getTurnColor()}`;
}

// ============================================================
// XEM LẠI NƯỚC CŨ ↔ THẾ CỜ HIỆN TẠI
// ============================================================
function getLiveTip() {
    const path = getMainLine();
    return path.length ? path[path.length - 1] : state.currentNode;
}

export function isOnlineAtLiveTip() {
    if (!state.currentNode || !state.rootNode) return true;
    return getLiveTip() === state.currentNode;
}

// Đưa bàn cờ về nước mới nhất (dùng khi đang xem lại nước cũ)
export function jumpToLiveTip(silent = false) {
    const tip = getLiveTip();
    if (!tip || tip === state.currentNode) return;
    instantJumpToNode(tip, silent);
    updateLiveButton();
}

function updateLiveButton() {
    const btn = document.getElementById('online-live-btn');
    if (!btn) return;
    const show = isOnlineMode() && !!onlineState.roomCode && !isOnlineAtLiveTip();
    const display = show ? 'inline-flex' : 'none';
    if (btn.style.display !== display) btn.style.display = display;
}

// ============================================================
// BỐ CỤC: TAB NƯỚC ĐI / CHAT (ĐIỆN THOẠI) & KHUNG CHỦ PHÒNG THU GỌN
// ============================================================
function isStackedLayout() {
    try {
        return window.matchMedia('(max-aspect-ratio: 1/1), (orientation: landscape) and (max-height: 500px)').matches;
    } catch (e) {
        return false;
    }
}

export function setOnlineInfoPane(pane) {
    const info = document.getElementById('info-section');
    if (!info) return;
    const target = pane === 'chat' ? 'chat' : 'moves';
    info.classList.toggle('online-pane-chat', target === 'chat');
    info.classList.toggle('online-pane-moves', target === 'moves');
    document.querySelectorAll('.online-info-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pane === target);
    });
    if (target === 'chat') {
        resetChatUnread();
        scrollChatToBottom();
    } else {
        import('./board.js').then(b => b.scrollToActiveMove && b.scrollToActiveMove()).catch(() => { });
    }
}

export function toggleHostControls(forceOpen) {
    const box = document.getElementById('online-bar-host-controls');
    if (!box) return;
    const collapse = forceOpen === undefined ? !box.classList.contains('collapsed') : !forceOpen;
    box.classList.toggle('collapsed', collapse);
}

// Tab đã chọn trên điện thoại được ghi nhớ (chọn Chat 1 lần thì lần sau vào phòng vẫn mở Chat)
const PANE_STORAGE_KEY = 'tuongky_online_pane';
const MOVES_COLLAPSED_KEY = 'tuongky_online_moves_collapsed';

function getSavedInfoPane() {
    try { return localStorage.getItem(PANE_STORAGE_KEY); } catch (e) { return null; }
}

export function chooseOnlineInfoPane(pane) {
    try { localStorage.setItem(PANE_STORAGE_KEY, pane); } catch (e) { }
    setOnlineInfoPane(pane);
}

// Thu gọn / mở biên bản trên máy tính (dành chỗ cho chat). Lựa chọn được ghi nhớ.
export function toggleOnlineMovesPanel(forceCollapsed) {
    const collapsed = forceCollapsed !== undefined ? !!forceCollapsed : !document.body.classList.contains('online-moves-collapsed');
    document.body.classList.toggle('online-moves-collapsed', collapsed);
    try { localStorage.setItem(MOVES_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { }
    const btn = document.getElementById('btn-online-toggle-moves');
    if (btn) {
        btn.textContent = collapsed ? '▸' : '▾';
        btn.title = collapsed ? 'Mở biên bản' : 'Thu gọn biên bản (để dành chỗ cho chat)';
    }
}

function applySavedMovesPanelState() {
    let saved = null;
    try { saved = localStorage.getItem(MOVES_COLLAPSED_KEY); } catch (e) { }
    toggleOnlineMovesPanel(saved === '1');
}

// ============================================================
// XIN HỒI NƯỚC (đối thủ đồng ý thì cả phòng cùng lùi lại)
// ============================================================
export function requestOnlineUndo() {
    if (!onlineState.roomCode) return;
    if (onlineState.isSpectator) {
        showToast('👁️ Khán giả không thể xin hồi nước.');
        return;
    }
    if (onlineState.undoPending) {
        showToast('⏳ Đang chờ đối thủ trả lời lời xin hồi nước...');
        return;
    }
    if (!onlineState.opponentJoined || !onlineState.opponentConnected) {
        showToast('⚠️ Đối thủ chưa vào phòng hoặc đang mất mạng.');
        return;
    }
    if (!wsSend({ type: 'UNDO_REQUEST', roomCode: onlineState.roomCode })) {
        showToast('📡 Đang mất kết nối máy chủ, thử lại sau.');
    }
}

function respondOnlineUndo(accept) {
    wsSend({ type: 'UNDO_RESPONSE', roomCode: onlineState.roomCode, accept: !!accept });
    closeUndoPrompt();
}

let undoPromptTimer = null;

function closeUndoPrompt() {
    clearInterval(undoPromptTimer);
    undoPromptTimer = null;
    const el = document.getElementById('online-undo-prompt');
    if (el) el.remove();
}

function showUndoPrompt(fromName, plies, timeoutSec) {
    closeUndoPrompt();
    const el = document.createElement('div');
    el.id = 'online-undo-prompt';
    el.className = 'online-undo-prompt';
    el.setAttribute('role', 'alertdialog');
    el.innerHTML = `
        <div class="undo-title">↩️ Xin hồi nước</div>
        <div class="undo-text"></div>
        <div class="undo-actions">
            <button type="button" class="undo-decline">Từ chối</button>
            <button type="button" class="undo-accept">Đồng ý <span class="undo-count"></span></button>
        </div>`;
    el.querySelector('.undo-text').textContent = plies === 2
        ? `${fromName} xin quay ngược thời gian (lùi 2 nước: nước của họ và nước bạn vừa đáp). Mong được duyệt quyền năng.`
        : `${fromName} xin quay ngược thời gian. Mong được duyệt quyền năng`;
    el.querySelector('.undo-accept').onclick = () => respondOnlineUndo(true);
    el.querySelector('.undo-decline').onclick = () => respondOnlineUndo(false);
    document.body.appendChild(el);

    let remain = Math.max(1, Math.round(timeoutSec));
    const countEl = el.querySelector('.undo-count');
    countEl.textContent = `(${remain}s)`;
    undoPromptTimer = setInterval(() => {
        remain--;
        if (remain <= 0) {
            closeUndoPrompt();
            return;
        }
        countEl.textContent = `(${remain}s)`;
    }, 1000);
}

// Lùi bàn cờ đúng số nước đã hồi và xoá các nước đó khỏi biên bản (để nước đi mới không thành nhánh phụ)
function applyUndo(plies, serverFen) {
    jumpToLiveTip(true);
    let node = state.currentNode;
    for (let i = 0; i < plies && node && node.parent; i++) {
        const parent = node.parent;
        const idx = parent.children.indexOf(node);
        if (idx >= 0) parent.children.splice(idx, 1);
        parent.mainLineIndex = parent.children.length ? Math.min(parent.mainLineIndex || 0, parent.children.length - 1) : 0;
        node = parent;
    }
    if (node && node !== state.currentNode) instantJumpToNode(node);

    // Phòng hờ lệch thế cờ → đồng bộ lại theo máy chủ
    if (serverFen && (!state.currentNode || !sameFenPosition(state.currentNode.fen, serverFen))) {
        initGame(serverFen, false).then(() => {
            if (state.currentSituation) renderBoardFull(state.currentSituation);
            updateOnlineRoomBar();
            updatePlayerStripsUI();
        });
    }
}

// ============================================================
// POPUP TIN NHẮN (khi khung chat đang ẩn): hiện ~2 giây cạnh nút Chat rồi tự ẩn
// ============================================================
const CHAT_PEEK_MS = 2200;
let chatPeekTimer = null;

function hideChatPeek() {
    clearTimeout(chatPeekTimer);
    chatPeekTimer = null;
    const el = document.getElementById('online-chat-peek');
    if (el) el.classList.remove('show');
}

function showChatPeek(senderName, text) {
    let el = document.getElementById('online-chat-peek');
    if (!el) {
        el = document.createElement('div');
        el.id = 'online-chat-peek';
        el.className = 'online-chat-peek';
        el.innerHTML = '<div class="peek-name"></div><div class="peek-text"></div>';
        el.addEventListener('click', () => {
            hideChatPeek();
            toggleChatBox(true);
        });
        document.body.appendChild(el);
    }
    const msg = String(text || '');
    el.querySelector('.peek-name').textContent = senderName || 'Tin nhắn mới';
    el.querySelector('.peek-text').textContent = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;

    // Đặt ngay trên nút Chat nếu nút đang nằm trong màn hình, nếu không thì ở giữa đáy màn hình
    const btn = document.getElementById('btn-online-chat');
    const r = btn ? btn.getBoundingClientRect() : null;
    const anchored = !!(r && r.width > 0 && r.top > 80 && r.bottom <= window.innerHeight);
    el.classList.toggle('anchored', anchored);
    if (anchored) {
        el.style.left = 'auto';
        el.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
        el.style.bottom = `${Math.round(window.innerHeight - r.top + 10)}px`;
    } else {
        el.style.right = 'auto';
        el.style.left = '50%';
        el.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
    }

    // Khởi động lại hiệu ứng khi có tin liên tiếp
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(chatPeekTimer);
    chatPeekTimer = setTimeout(hideChatPeek, CHAT_PEEK_MS);
}

function getWebSocketUrl() {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${loc.host}`;
}

// ============================================================
// KẾT NỐI WEBSOCKET (TỰ PHỤC HỒI KHI RỚT MẠNG / MỞ LẠI APP TRÊN ĐIỆN THOẠI)
// ============================================================
let reconnectTimer = null;
let reconnectAttempts = 0;
let connectPromise = null;
let pongTimer = null;
let lastJoinAttemptCode = null; // mã phòng của yêu cầu JOIN_ROOM gần nhất (để hiểu đúng lỗi ROOM_NOT_FOUND)
const MAX_RECONNECT_ATTEMPTS = 45; // ~2 phút (máy chủ chỉ giữ chỗ 90s)

// Khởi tạo kết nối WebSocket với khả năng tự phục hồi
export function connectOnlineSocket() {
    const current = onlineState.ws;
    if (current && current.readyState === WebSocket.OPEN) {
        return Promise.resolve(current);
    }
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
        let settled = false;
        let ws;
        try {
            ws = new WebSocket(getWebSocketUrl());
        } catch (e) {
            connectPromise = null;
            reject(e);
            return;
        }

        // Mạng di động chập chờn có thể treo ở trạng thái CONNECTING rất lâu → tự huỷ sau 10s
        const openTimeout = setTimeout(() => {
            if (!settled) {
                try { ws.close(); } catch (e) { }
            }
        }, 10000);

        ws.onopen = () => {
            clearTimeout(openTimeout);
            settled = true;
            connectPromise = null;

            const previous = onlineState.ws;
            onlineState.ws = ws;
            onlineState.connected = true;
            if (previous && previous !== ws) {
                previous.onclose = null;
                previous.onmessage = null;
                try { previous.close(); } catch (e) { }
            }

            reconnectAttempts = 0;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }

            // Nếu đang có phòng cờ dở dang (rớt mạng), tự động gửi yêu cầu tái kết nối
            const savedRoom = onlineState.roomCode || sessionStorage.getItem('tuongky_active_room');
            if (savedRoom) {
                console.log(`🔄 [Online] Đang tự động kết nối lại vào phòng [${savedRoom}]...`);
                lastJoinAttemptCode = savedRoom;
                wsSend({
                    type: 'JOIN_ROOM',
                    roomCode: savedRoom,
                    userId: getOrCreateUserId(),
                    userName: getOnlineUserName(),
                    clientVersion: CLIENT_VOICE_PROTOCOL
                });
            }

            updateOnlineRoomBar();
            resolve(ws);
        };

        ws.onmessage = (event) => {
            if (onlineState.ws !== ws) return;
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            try {
                handleOnlineMessage(data);
            } catch (e) {
                console.error('[Online] Lỗi xử lý tin nhắn socket:', e);
            }
        };

        ws.onerror = () => {
            // onclose luôn được gọi sau onerror → xử lý tập trung ở onclose
        };

        ws.onclose = () => {
            clearTimeout(openTimeout);
            if (!settled) {
                settled = true;
                connectPromise = null;
                reject(new Error('Không kết nối được máy chủ'));
            }
            if (onlineState.ws !== ws) return; // socket cũ đã được thay thế
            onlineState.connected = false;
            if (pongTimer) {
                clearTimeout(pongTimer);
                pongTimer = null;
            }

            if (onlineState.roomCode) {
                showToast('⚠️ Mất kết nối máy chủ, đang kết nối lại... (voice vẫn giữ nếu mạng còn)');
                updateOnlineRoomBar();
                scheduleSocketReconnect();
            }
        };
    });

    return connectPromise;
}

// Lên lịch tự động kết nối lại khi mạng bị đứt
function scheduleSocketReconnect(delayOverride) {
    if (reconnectTimer || connectPromise) return;
    if (!onlineState.roomCode) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showToast('❌ Không thể kết nối lại máy chủ. Vui lòng vào lại phòng.');
        leaveOnlineRoom({ notifyServer: false, silent: true });
        return;
    }

    const delay = delayOverride !== undefined ? delayOverride : (reconnectAttempts === 0 ? 500 : Math.min(3000, 1000 * reconnectAttempts));
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        console.log(`🔄 [Online] Thử kết nối lại lần ${reconnectAttempts}...`);
        connectOnlineSocket().catch(() => {
            scheduleSocketReconnect();
        });
    }, delay);
}

// Điện thoại vừa mở lại app / đổi mạng: socket có thể đã "chết" mà trình duyệt chưa biết → kiểm tra ngay
function ensureSocketAlive() {
    if (!onlineState.roomCode) return;
    const ws = onlineState.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        scheduleSocketReconnect(0);
        return;
    }
    if (ws.readyState !== WebSocket.OPEN || pongTimer) return;
    if (!wsSend({ type: 'PING' })) return;
    pongTimer = setTimeout(() => {
        pongTimer = null;
        if (onlineState.ws !== ws) return;
        // Không nhận được PONG → kết nối nửa sống nửa chết, bỏ và kết nối lại ngay
        console.warn('[Online] Socket không phản hồi, kết nối lại...');
        ws.onclose = null;
        ws.onmessage = null;
        try { ws.close(); } catch (e) { }
        onlineState.connected = false;
        updateOnlineRoomBar();
        scheduleSocketReconnect(0);
    }, 5000);
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) ensureSocketAlive();
    });
    window.addEventListener('online', () => {
        ensureSocketAlive();
        recoverStalledPeers();
    });
    if (navigator.connection && typeof navigator.connection.addEventListener === 'function') {
        navigator.connection.addEventListener('change', () => {
            ensureSocketAlive();
            recoverStalledPeers();
        });
    }
}

// Cập nhật danh sách thành viên từ ROOM_PLAYERS_UPDATED
function applyRoomMembers(data) {
    const members = [];
    const pushMember = (m, role) => {
        if (!m || !m.userId) return;
        members.push({
            userId: m.userId,
            userName: m.userName,
            role,
            connected: m.connected !== false,
            micOn: !!m.micOn,
            camOn: !!m.camOn,
            vp: Number(m.vp) || 1
        });
    };
    pushMember(data.host, 'host');
    pushMember(data.guest, 'guest');
    (data.spectators || []).forEach(s => pushMember(s, 'spectator'));
    onlineState.roomMembers = members;

    const myId = getOrCreateUserId();
    onlineState.micUsers = new Set(members.filter(m => m.micOn && m.connected && m.userId !== myId).map(m => m.userId));
    if (onlineState.isMicActive) onlineState.micUsers.add(myId);
}

// Đồng bộ trạng thái sau khi vào/vào lại phòng
function onJoinedRoom() {
    getRtcConfig().catch(() => { }); // tải trước ICE servers để kết nối voice nhanh hơn
    startVoiceMonitors();
    watchChatVisibility();
    // Báo lại trạng thái mic/cam hiện tại cho máy chủ (khôi phục sau khi rớt mạng, không hiện thông báo)
    sendVoiceStatus(onlineState.isMicActive, true);
    if (onlineState.isCameraActive) sendCameraStatus(true, true);
    scheduleVoiceUIUpdate();
}

// Xử lý các thông điệp từ Server
function handleOnlineMessage(data) {
    const { type } = data;

    // 0. PHẢN HỒI PING
    // Máy chủ đã nâng cấp giao thức voice mà máy này còn bản cũ → nhắc tải lại trang
    if (type === 'SERVER_INFO') {
        if (Number(data.voiceProtocol) > CLIENT_VOICE_PROTOCOL) showAppUpdateBanner();
        return;
    }

    if (type === 'PONG') {
        if (pongTimer) {
            clearTimeout(pongTimer);
            pongTimer = null;
        }
        return;
    }

    // 1. TẠO PHÒNG THÀNH CÔNG
    if (type === 'ROOM_CREATED') {
        const rejoin = onlineState.roomCode === data.roomCode;
        if (onlineState.roomCode && !rejoin) teardownVoice();
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = true;
        onlineState.isSpectator = false;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.guestColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.myUserName = data.myUserName || getOnlineUserName();
        onlineState.opponentUserName = 'Đang chờ...';
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        onlineState.timerState = data.timer || onlineState.timerState;
        onlineState.spectatorCount = data.spectatorCount || 0;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, data.myColor, rejoin);
        closeModal('online-room-modal');
        showToast(`🏠 Đã tạo phòng [${escapeHtml(data.roomCode)}]! Hãy gửi mã cho bạn bè.`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        onJoinedRoom();
        return;
    }

    // 2. VÀO PHÒNG THÀNH CÔNG (GUEST)
    if (type === 'ROOM_JOINED') {
        const rejoin = onlineState.roomCode === data.roomCode;
        if (onlineState.roomCode && !rejoin) teardownVoice();
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = false;
        onlineState.isSpectator = false;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.hostColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.myUserName = data.myUserName || getOnlineUserName();
        onlineState.opponentUserName = data.opponentUserName || (data.hostColor === 'red' ? 'Chủ phòng (Đỏ)' : 'Chủ phòng (Đen)');
        onlineState.opponentJoined = true;
        onlineState.opponentConnected = true;
        onlineState.timerState = data.timer || onlineState.timerState;
        onlineState.spectatorCount = data.spectatorCount || 0;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, data.myColor, rejoin);
        closeModal('online-room-modal');
        showToast(`🎉 Đã vào phòng [${escapeHtml(data.roomCode)}]! Bạn cầm quân [${data.myColor === 'red' ? 'Đỏ' : 'Đen'}].`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        onJoinedRoom();
        return;
    }

    // 2.1. VÀO PHÒNG VỚI TƯ CÁCH KHÁN GIẢ (SPECTATOR)
    if (type === 'ROOM_JOINED_SPECTATOR') {
        const rejoin = onlineState.roomCode === data.roomCode;
        if (onlineState.roomCode && !rejoin) teardownVoice();
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = false;
        onlineState.isSpectator = true;
        onlineState.myUserName = data.myUserName || getOnlineUserName();
        onlineState.currentTurn = data.currentTurn;
        onlineState.timerState = data.timer || onlineState.timerState;
        onlineState.spectatorCount = data.spectatorCount || 0;
        onlineState.players = { host: data.host, guest: data.guest };
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        if (onlineState.isCameraActive) stopOnlineCamera();
        enterOnlineGame(data.fen, 'red', rejoin); // Khán giả nhìn bàn cờ mặc định (Đỏ ở dưới)
        closeModal('online-room-modal');
        showToast(rejoin
            ? `🔄 Đã kết nối lại phòng [${escapeHtml(data.roomCode)}].`
            : `👁️ Bạn đã vào phòng [${escapeHtml(data.roomCode)}] ở chế độ XEM CỜ!`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        onJoinedRoom();
        return;
    }

    // 3. TÁI KẾT NỐI VÀO PHÒNG THÀNH CÔNG (RECONNECTED SAU KHI RỚT MẠNG)
    if (type === 'ROOM_RECONNECTED') {
        const rejoin = onlineState.roomCode === data.roomCode;
        if (onlineState.roomCode && !rejoin) teardownVoice();
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = !!data.isHost;
        onlineState.isSpectator = !!data.isSpectator;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.myUserName = data.myUserName || getOnlineUserName();
        onlineState.opponentUserName = data.opponentUserName || 'Đối thủ';
        onlineState.opponentJoined = !!data.opponentJoined;
        onlineState.opponentConnected = !!data.opponentJoined;
        onlineState.timerState = data.timer || onlineState.timerState;
        onlineState.spectatorCount = data.spectatorCount || 0;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, data.myColor || 'red', rejoin);
        closeModal('online-room-modal');
        showToast(`🔄 Đã kết nối lại phòng [${escapeHtml(data.roomCode)}]! Ván cờ tiếp tục.`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        onJoinedRoom();
        return;
    }

    // 3.1. CẬP NHẬT DANH SÁCH NGƯỜI CHƠI & KHÁN GIẢ TRONG PHÒNG
    if (type === 'ROOM_PLAYERS_UPDATED') {
        onlineState.players = { host: data.host, guest: data.guest };
        onlineState.spectatorsList = data.spectators || [];
        onlineState.spectatorCount = data.spectatorCount || 0;

        applyRoomMembers(data);
        reconcileVoiceMesh();
        applyLocalTracksToAll();
        refreshRemoteVideo();

        const specCountEl = document.getElementById('online-spectator-count');
        if (specCountEl) specCountEl.textContent = onlineState.spectatorCount;

        const modalCountEl = document.getElementById('modal-spectator-count');
        if (modalCountEl) modalCountEl.textContent = onlineState.spectatorCount;

        renderSpectatorsModalList();
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 3.2. ĐƯỢC CHỦ PHÒNG CHỌN VÀO ĐÁNH THAY THẾ (PROMOTED_TO_GUEST)
    if (type === 'PROMOTED_TO_GUEST') {
        onlineState.isSpectator = false;
        onlineState.isHost = false;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor || (data.myColor === 'red' ? 'black' : 'red');
        onlineState.opponentUserName = data.opponentUserName || 'Chủ phòng';
        state.isBoardFlipped = (onlineState.myColor === 'black');

        if (state.currentSituation) {
            renderBoardFull(state.currentSituation);
        }

        notify('⚔️ ' + (data.message || 'Bạn đã được chọn vào thi đấu!'));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 3.3. BỊ CHUYỂN SANG CHẾ ĐỘ XEM CỜ (DEMOTED_TO_SPECTATOR)
    if (type === 'DEMOTED_TO_SPECTATOR') {
        onlineState.isSpectator = true;
        onlineState.isHost = false;
        stopOnlineCamera(); // Tắt cam vì khán giả không được bật cam (voice vẫn giữ nguyên)

        notify('👁️ ' + (data.message || 'Bạn đã chuyển sang chế độ Khán giả xem cờ.'));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 3.4. ĐỒNG BỘ ĐỒNG HỒ TÍNH GIỜ (TIMER_SYNC)
    if (type === 'TIMER_SYNC') {
        if (data.timer) {
            onlineState.timerState = data.timer;
        }
        if (data.message) {
            notify('⏱️ ' + data.message);
        }
        updateClocksTick();
        startClockTicker();
        return;
    }

    // 3.5. HẾT GIỜ THI ĐẤU (GAME_TIMEOUT)
    if (type === 'GAME_TIMEOUT') {
        if (data.timer) {
            onlineState.timerState = data.timer;
        }
        onlineState.timerState.isRunning = false;
        updateClocksTick();
        stopClockTicker();
        notify(data.message || '⏰ Hết giờ!');
        return;
    }

    // 4. ĐỐI THỦ VÀO PHÒNG (HOST NHẬN)
    if (type === 'PLAYER_JOINED') {
        onlineState.opponentJoined = true;
        onlineState.opponentConnected = true;
        if (data.opponentUserName) onlineState.opponentUserName = data.opponentUserName;
        notify('👥 ' + (data.message || `${onlineState.opponentUserName} đã tham gia phòng!`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 5. ĐỐI THỦ TẠM THỜI MẤT MẠNG (ĐANG CHỜ 90S)
    if (type === 'PLAYER_DISCONNECTED') {
        onlineState.opponentConnected = false;
        notify('⏳ ' + (data.message || `${onlineState.opponentUserName} tạm mất mạng, đang chờ 90s...`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 6. ĐỐI THỦ ĐÃ KẾT NỐI LẠI THÀNH CÔNG
    if (type === 'PLAYER_RECONNECTED') {
        onlineState.opponentConnected = true;
        onlineState.opponentJoined = true;
        if (data.opponentUserName) onlineState.opponentUserName = data.opponentUserName;
        notify('🟢 ' + (data.message || `${onlineState.opponentUserName} đã kết nối lại phòng!`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 7. ĐỐI THỦ ĐỔI TÊN HIỂN THỊ
    if (type === 'OPPONENT_RENAMED') {
        if (data.newName) {
            const isOpponent = !onlineState.isSpectator && (data.role === 'host' || data.role === 'guest');
            if (isOpponent) onlineState.opponentUserName = data.newName;
            notify(`👤 Một người trong phòng đã đổi tên thành: ${data.newName}`);
            updateOnlineRoomBar();
            updatePlayerStripsUI();
            scheduleVoiceUIUpdate();
        }
        return;
    }

    // 8. ĐƯỢC CHUYỂN QUYỀN CHỦ PHÒNG (TRONG PHÒNG CỐ ĐỊNH 013579)
    if (type === 'PROMOTED_TO_HOST') {
        onlineState.isHost = true;
        onlineState.isSpectator = false;
        notify('👑 ' + (data.message || 'Bạn đã trở thành Chủ phòng mới!'));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 9. ĐỐI THỦ HOẶC BÀN CỜ ĐI QUÂN
    if (type === 'OPPONENT_MOVE') {
        onlineState.currentTurn = data.currentTurn;
        if (data.timer) {
            onlineState.timerState = data.timer;
        }
        if (data.moveCommand) {
            // Đang xem lại nước cũ → về thế cờ mới nhất trước, nếu không nước của đối thủ bị gắn nhầm thành nhánh phụ
            jumpToLiveTip(true);
            executeMove(data.moveCommand);
            // Phòng hờ lệch thế cờ (hiếm) → đồng bộ lại theo máy chủ
            if (data.fen && state.currentNode && !sameFenPosition(state.currentNode.fen, data.fen)) {
                console.warn('[Online] Thế cờ lệch với máy chủ → đồng bộ lại');
                initGame(data.fen, false).then(() => {
                    if (state.currentSituation) renderBoardFull(state.currentSituation);
                    updateOnlineRoomBar();
                    updatePlayerStripsUI();
                });
            }
        }
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        updateClocksTick();
        return;
    }

    // 9.1. MÁY CHỦ TỪ CHỐI NƯỚC ĐI (LỆCH LƯỢT) → ĐỒNG BỘ LẠI THẾ CỜ CHUẨN
    if (type === 'MOVE_REJECTED') {
        onlineState.currentTurn = data.currentTurn;
        if (data.timer) onlineState.timerState = data.timer;
        notify('⚠️ ' + (data.message || 'Nước đi bị từ chối, bàn cờ đã được đồng bộ lại.'));
        if (data.fen) {
            initGame(data.fen, false).then(() => {
                state.isBoardFlipped = (onlineState.myColor === 'black');
                if (state.currentSituation) renderBoardFull(state.currentSituation);
                updateOnlineRoomBar();
                updatePlayerStripsUI();
            });
        }
        return;
    }

    // 9.2. XIN HỒI NƯỚC
    if (type === 'UNDO_REQUESTED') {
        showUndoPrompt(data.fromName || 'Đối thủ', data.plies || 1, data.timeoutSec || 20);
        return;
    }
    if (type === 'UNDO_PENDING') {
        onlineState.undoPending = true;
        showToast('↩️ Đã gửi lời xin hồi nước, chờ đối thủ trả lời...');
        updateOnlineRoomBar();
        return;
    }
    if (type === 'UNDO_DECLINED') {
        onlineState.undoPending = false;
        notify('🙅 ' + (data.message || 'Đối thủ không đồng ý cho hồi nước.'));
        updateOnlineRoomBar();
        return;
    }
    if (type === 'UNDO_CANCELLED') {
        onlineState.undoPending = false;
        closeUndoPrompt();
        if (data.message) notify('↩️ ' + data.message);
        updateOnlineRoomBar();
        return;
    }
    if (type === 'MOVE_UNDONE') {
        onlineState.undoPending = false;
        closeUndoPrompt();
        onlineState.currentTurn = data.currentTurn;
        if (data.timer) onlineState.timerState = data.timer;
        applyUndo(data.plies || 1, data.fen);
        notify('↩️ ' + (data.message || 'Đã hồi nước.'));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        return;
    }

    // 10. CHỦ PHÒNG CẬP NHẬT BÀN CỜ (XẾP QUÂN)
    if (type === 'BOARD_UPDATED') {
        onlineState.currentTurn = data.currentTurn;
        notify('🛠️ ' + (data.message || 'Chủ phòng đã cập nhật thế cờ mới!'));
        if (data.fen) {
            initGame(data.fen, false);
        }
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 11. THAY ĐỔI LƯỢT ĐI
    if (type === 'TURN_CHANGED') {
        onlineState.currentTurn = data.currentTurn;
        notify('🎯 ' + (data.message || 'Lượt đi đã thay đổi!'));
        if (data.fen && state.currentNode) {
            state.currentNode.fen = data.fen;
            if (typeof vschess !== 'undefined') {
                state.currentSituation = vschess.fenToSituation(data.fen);
                state.selectedSquare = null;
                state.legalMoves = [];
                renderBoardFull(state.currentSituation);
                updateTurnToggleUI();
            }
        }
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 12. ĐỔI BÊN
    if (type === 'SIDES_SWAPPED') {
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor;
        notify('🔄 ' + (data.message || 'Đã hoán đổi bên!'));
        state.isBoardFlipped = (onlineState.myColor === 'black');
        if (state.currentSituation) {
            renderBoardFull(state.currentSituation);
        }
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 13. VÁN MỚI
    if (type === 'GAME_RESET') {
        onlineState.currentTurn = data.currentTurn || 'w';
        if (data.timer) {
            onlineState.timerState = data.timer;
        }
        notify('🆕 ' + (data.message || 'Ván cờ mới bắt đầu!'));
        initGame(data.fen || START_FEN, false).then(() => {
            state.isBoardFlipped = (onlineState.myColor === 'black');
            if (state.currentSituation) {
                renderBoardFull(state.currentSituation);
            }
            updateTurnToggleUI();
            updateOnlineRoomBar();
            updatePlayerStripsUI();
        });
        return;
    }

    // 14. CHỦ PHÒNG RỜI ĐI HẲN (PHÒNG ĐÓNG)
    if (type === 'HOST_LEFT') {
        notify('🚪 ' + (data.message || 'Chủ phòng đã rời phòng!'));
        sessionStorage.removeItem('tuongky_active_room');
        teardownVoice();
        closeUndoPrompt();
        onlineState.undoPending = false;
        onlineState.roomCode = null;
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        document.body.classList.remove('mode-online');
        stopClockTicker();
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 15. KHÁCH RỜI ĐI HẲN (voice với các khán giả vẫn giữ nguyên)
    if (type === 'GUEST_LEFT') {
        notify('🚪 ' + (data.message || 'Đối thủ đã rời đi.'));
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        onlineState.opponentUserName = 'Đang chờ...';
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 15.1. CÙNG TÀI KHOẢN VỪA VÀO PHÒNG TỪ TAB/THIẾT BỊ KHÁC
    if (type === 'SESSION_REPLACED') {
        leaveOnlineRoom({ notifyServer: false, silent: true });
        notify('📱 ' + (data.message || 'Bạn đã vào phòng từ nơi khác.'));
        return;
    }

    // 16. TIN NHẮN CHAT MỚI
    if (type === 'CHAT_MESSAGE') {
        appendChatMessage(data);
        return;
    }

    // 17. TRẠNG THÁI CAMERA
    if (type === 'CAMERA_STATUS') {
        handleCameraStatus(data);
        return;
    }

    // 18. WEBRTC SIGNALING RELAY (VOICE & VIDEO) — xử lý tuần tự theo từng người
    if (type === 'WEBRTC_OFFER' || type === 'WEBRTC_ANSWER' || type === 'WEBRTC_ICE' || type === 'WEBRTC_REQUEST') {
        handleRtcSignal(data);
        return;
    }
    if (type === 'VOICE_STATUS') {
        handleVoiceStatus(data);
        return;
    }

    // 19. BÁO LỖI
    if (type === 'ERROR') {
        // Phòng không còn (máy chủ khởi động lại / phòng đã đóng) trong lúc đang tự kết nối lại
        if (data.code === 'ROOM_NOT_FOUND' && onlineState.roomCode && lastJoinAttemptCode === onlineState.roomCode) {
            leaveOnlineRoom({ notifyServer: false, silent: true });
        }
        notify('❌ ' + (data.message || 'Đã xảy ra lỗi!'));
        return;
    }
}

function sameFenPosition(a, b) {
    const pa = String(a || '').trim().split(/\s+/);
    const pb = String(b || '').trim().split(/\s+/);
    return pa[0] === pb[0] && (pa[1] || 'w') === (pb[1] || 'w');
}

// Tắt hẳn engine Pikafish để giải phóng RAM khi chơi online (chỉ dùng engine khi phân tích)
function shutdownEngineForOnline() {
    import('./engine.js').then(m => {
        if (typeof m.shutdownEngine === 'function') m.shutdownEngine();
    }).catch(() => { });
}

// Bắt đầu vào chế độ Online Game
async function enterOnlineGame(initialFen, myColor, rejoin = false) {
    const serverFen = initialFen || START_FEN;
    // Kết nối lại cùng phòng và thế cờ không đổi → giữ nguyên biên bản nước đi, không vẽ lại từ đầu
    const keepBoard = rejoin && state.appMode === 'online' && state.currentNode && sameFenPosition(state.currentNode.fen, serverFen);

    state.appMode = 'online';
    state.appSettings.appMode = 'online';
    document.body.classList.add('mode-online');

    // CẤM BẬT THẨM / TẮT HOÀN TOÀN ENGINE PIKAFISH
    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;
    shutdownEngineForOnline();

    // Tự động xoay bàn cờ: nếu cầm Đen thì xoay để quân Đen ở dưới
    state.isBoardFlipped = (myColor === 'black');

    if (keepBoard) {
        if (state.currentSituation) renderBoardFull(state.currentSituation);
    } else {
        clearUserDrawLines();
        // Tự động chuyển tab dưới sang Biên Bản
        const historyTabBtn = document.querySelector('.lower-tab-btn[data-tab="history"]');
        if (historyTabBtn) historyTabBtn.click();
        await initGame(serverFen, false);
    }

    updateOnlineRoomBar();
    updatePlayerStripsUI();
    if (!rejoin) {
        // Điện thoại: mở lại tab đã chọn lần trước (mặc định kỳ thủ xem Nước đi, khán giả xem Chat); máy tính hiện cả hai
        setOnlineInfoPane(getSavedInfoPane() || (onlineState.isSpectator ? 'chat' : 'moves'));
        applySavedMovesPanelState();
        toggleHostControls(!isStackedLayout());
    }
    window.dispatchEvent(new Event('resize'));
}

// Tạo phòng mới
export async function createOnlineRoom(hostColor = 'red') {
    showLoading('Đang tạo phòng...');
    try {
        await connectOnlineSocket();
        const initialFen = state.currentNode ? state.currentNode.fen : START_FEN;

        wsSend({
            type: 'CREATE_ROOM',
            userId: getOrCreateUserId(),
            userName: getOnlineUserName(),
            hostColor: hostColor,
            initialFen: initialFen,
            clientVersion: CLIENT_VOICE_PROTOCOL
        });
    } catch (e) {
        showToast('❌ Lỗi tạo phòng: ' + escapeHtml(e.message));
    } finally {
        hideLoading();
    }
}

// Vào phòng bằng mã (hoặc phòng cố định 013579)
export async function joinOnlineRoom(roomCode) {
    const code = String(roomCode || '').trim().toUpperCase();
    if (!code) {
        showToast('⚠️ Vui lòng nhập mã phòng!');
        return;
    }

    showLoading(`Đang vào phòng ${escapeHtml(code)}...`);
    try {
        await connectOnlineSocket();
        lastJoinAttemptCode = code;
        wsSend({
            type: 'JOIN_ROOM',
            userId: getOrCreateUserId(),
            userName: getOnlineUserName(),
            roomCode: code,
            clientVersion: CLIENT_VOICE_PROTOCOL
        });
    } catch (e) {
        showToast('❌ Lỗi kết nối phòng: ' + escapeHtml(e.message));
    } finally {
        hideLoading();
    }
}

// Gửi nước đi khi người chơi thực hiện
export function sendOnlineMove(moveCommand, newFen, nextTurn) {
    if (!isOnlineMode() || !onlineState.roomCode) return;
    if (onlineState.isSpectator) return;

    const sent = wsSend({
        type: 'MOVE',
        roomCode: onlineState.roomCode,
        moveCommand: moveCommand,
        newFen: newFen,
        nextTurn: nextTurn
    });
    if (!sent) {
        showToast('⚠️ Chưa gửi được nước đi do mất kết nối. Bàn cờ sẽ đồng bộ lại khi có mạng.');
    }
}

// Chủ phòng gửi cấu hình đồng hồ tính giờ
export function sendTimerSettings(settings) {
    if (!onlineState.isHost || !onlineState.roomCode) {
        showToast('⚠️ Chỉ Chủ phòng mới có quyền cài đặt đồng hồ!');
        return;
    }

    wsSend({
        type: 'SET_TIMER_SETTINGS',
        roomCode: onlineState.roomCode,
        settings: settings
    });
}

// Chủ phòng chọn khán giả vào đánh thay thế
export function substituteGuest(targetUserId) {
    if (!onlineState.isHost || !onlineState.roomCode) {
        showToast('⚠️ Chỉ Chủ phòng mới có quyền thay đổi người đánh!');
        return;
    }

    wsSend({
        type: 'SUBSTITUTE_GUEST',
        roomCode: onlineState.roomCode,
        targetUserId: targetUserId
    });
}

// Render danh sách trong Modal Khán Giả
export function renderSpectatorsModalList() {
    const listEl = document.getElementById('modal-spectators-list');
    const playersEl = document.getElementById('modal-players-current');
    if (!listEl || !playersEl) return;

    const myId = getOrCreateUserId();
    const hostUser = onlineState.players?.host;
    const guestUser = onlineState.players?.guest;
    const statusOf = (user) => {
        if (!user) return '<span style="font-size: 11px; color: #ea580c; font-weight: bold;">⏳ Trống</span>';
        if (user.connected === false) return '<span style="font-size: 11px; color: #ef4444; font-weight: bold;">📡 Mất mạng</span>';
        return '<span style="font-size: 11px; color: #16a34a; font-weight: bold;">🟢 Đang đấu</span>';
    };

    playersEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
            <div>
                <strong>👑 ${escapeHtml(hostUser?.userName || 'Chủ phòng')}</strong>
                <span style="font-size: 11px; color: ${hostUser?.color === 'red' ? '#dc2626' : '#1e293b'}; font-weight: bold;">
                    (${hostUser?.color === 'red' ? '🔴 Đỏ' : '⚫ Đen'})
                </span>
                ${hostUser?.userId === myId ? '<span style="font-size: 10px; color: #0284c7;">(Bạn)</span>' : ''}
            </div>
            ${statusOf(hostUser)}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
            <div>
                <strong>⚔️ ${escapeHtml(guestUser?.userName || 'Đang chờ đối thủ...')}</strong>
                ${guestUser ? `<span style="font-size: 11px; color: ${guestUser.color === 'red' ? '#dc2626' : '#1e293b'}; font-weight: bold;">(${guestUser.color === 'red' ? '🔴 Đỏ' : '⚫ Đen'})</span>` : ''}
                ${guestUser && guestUser.userId === myId ? '<span style="font-size: 10px; color: #0284c7;">(Bạn)</span>' : ''}
            </div>
            ${statusOf(guestUser)}
        </div>
    `;

    const specs = onlineState.spectatorsList || [];
    if (specs.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12px; color: #94a3b8; font-style: italic; text-align: center; padding: 10px;">Chưa có khán giả nào vào phòng.</div>';
        return;
    }

    listEl.innerHTML = specs.map(spec => {
        const isMe = spec.userId === myId;
        const canSubstitute = onlineState.isHost && !isMe && spec.connected !== false;
        const subButton = canSubstitute
            ? `<button class="btn-substitute" data-userid="${escapeHtml(spec.userId)}" data-username="${escapeHtml(spec.userName)}">⚔️ Cho Vào Đánh</button>`
            : '';

        return `
            <div class="spectator-item-row">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span>${spec.connected === false ? '📡' : '👁️'}</span>
                    <strong>${escapeHtml(spec.userName)}</strong>
                    ${isMe ? '<span style="font-size: 10.5px; color: #0284c7; font-weight: bold;">(Bạn)</span>' : ''}
                </div>
                <div>${subButton}</div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.btn-substitute').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const uid = e.currentTarget.getAttribute('data-userid');
            const uname = e.currentTarget.getAttribute('data-username');
            if (uid) {
                if (confirm(`Bạn có chắc muốn chọn [${uname}] vào thi đấu tiếp?`)) {
                    substituteGuest(uid);
                    closeModal('online-spectators-modal');
                }
            }
        });
    });
}

// Chủ phòng gửi cập nhật thế cờ (sau khi xếp quân xong)
export function sendHostBoardUpdate(newFenFull) {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost) return;

    const turn = newFenFull.split(' ')[1] || 'w';
    onlineState.currentTurn = turn;

    wsSend({
        type: 'HOST_UPDATE_BOARD',
        roomCode: onlineState.roomCode,
        fen: newFenFull,
        currentTurn: turn
    });
    updateOnlineRoomBar();
}

// Chủ phòng đổi lượt đi
export function sendHostSetTurn(turn) {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost) return;

    onlineState.currentTurn = turn;
    wsSend({
        type: 'HOST_SET_TURN',
        roomCode: onlineState.roomCode,
        turn: turn
    });
    updateOnlineRoomBar();
}

// Chủ phòng hoán đổi phe (Đỏ / Đen)
export function sendHostSwapSides() {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost) return;

    wsSend({
        type: 'HOST_SWAP_SIDES',
        roomCode: onlineState.roomCode
    });
}

// Chủ phòng khởi động ván mới
export function sendResetGame() {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost) return;

    wsSend({
        type: 'RESET_GAME',
        roomCode: onlineState.roomCode,
        fen: START_FEN
    });
}

// Rời phòng (notifyServer=false: phòng đã đóng / phiên bị thay thế → chỉ dọn dẹp phía máy mình)
export function leaveOnlineRoom(options = {}) {
    const { notifyServer = true, silent = false } = options || {};
    sessionStorage.removeItem('tuongky_active_room');

    if (notifyServer && onlineState.roomCode) {
        wsSend({
            type: 'LEAVE_ROOM',
            roomCode: onlineState.roomCode
        });
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    reconnectAttempts = 0;

    teardownVoice();
    stopClockTicker();
    closeUndoPrompt();
    hideChatPeek();
    onlineState.undoPending = false;

    onlineState.roomCode = null;
    onlineState.roomMembers = [];
    onlineState.players = { host: null, guest: null };
    onlineState.spectatorsList = [];
    onlineState.opponentJoined = false;
    onlineState.opponentConnected = false;
    onlineState.isSpectator = false;
    onlineState.isHost = false;
    document.body.classList.remove('mode-online');
    if (!silent) showToast('🚪 Đã rời phòng chơi.');

    const topStrip = document.getElementById('online-player-strip-top');
    const botStrip = document.getElementById('online-player-strip-bottom');
    const chatBox = document.getElementById('online-chat-box');
    if (topStrip) topStrip.style.display = 'none';
    if (botStrip) botStrip.style.display = 'none';
    if (chatBox) chatBox.style.display = 'none';

    // Có bản cập nhật chờ áp dụng trong lúc đang chơi → tải lại ngay bây giờ
    if (window.__pendingAppUpdate) {
        window.location.reload();
        return;
    }

    // Chuyển lại về chế độ Phân Tích mặc định (engine sẽ được khởi động lại ở đó)
    import('./events.js').then(m => {
        if (m.switchMode) m.switchMode('analyze');
    });

    updateOnlineRoomBar();
    window.dispatchEvent(new Event('resize'));
}

// Cập nhật thanh hiển thị trạng thái phòng Online trên màn hình
export function updateOnlineRoomBar() {
    const bar = document.getElementById('online-room-bar');
    if (!bar) return;

    const inRoom = isOnlineMode() && !!onlineState.roomCode;
    document.body.classList.toggle('online-in-room', inRoom);
    if (!inRoom) {
        bar.style.display = 'none';
        updateLiveButton();
        return;
    }

    bar.style.display = 'flex';

    // Lượt đi hiện tại
    const isRedTurn = (state.currentNode ? state.currentNode.fen.split(' ')[1] : onlineState.currentTurn) === 'w';
    const isMyTurn = isMyOnlineTurn();

    const roomCodeEl = document.getElementById('online-bar-roomcode');
    if (roomCodeEl) roomCodeEl.textContent = onlineState.roomCode;

    // Hiển thị tên người dùng và vai trò
    const myNameEl = document.getElementById('online-bar-myname');
    if (myNameEl) {
        const roleStr = onlineState.isSpectator ? 'Khán giả' : (onlineState.isHost ? 'Chủ' : 'Khách');
        const netStr = isOnlineSocketReady() ? '' : ' 📡';
        myNameEl.innerHTML = `<strong>${escapeHtml(onlineState.myUserName)}</strong> (${roleStr}) ✏️${netStr}`;
    }

    const mySideEl = document.getElementById('online-bar-myside');
    if (mySideEl) {
        if (onlineState.isSpectator) {
            mySideEl.innerHTML = '<span style="color: #0284c7; font-weight: bold;">👁️ Xem cờ</span>';
        } else if (onlineState.myColor === 'red') {
            mySideEl.innerHTML = '<span style="color: #dc2626; font-weight: bold;">🔴 Đỏ</span>';
        } else {
            mySideEl.innerHTML = '<span style="color: #1f2937; font-weight: bold;">⚫ Đen</span>';
        }
    }

    const oppStatusEl = document.getElementById('online-bar-oppstatus');
    if (oppStatusEl) {
        const oppName = escapeHtml(onlineState.opponentUserName);
        if (onlineState.isSpectator) {
            const hostName = escapeHtml(onlineState.players?.host?.userName || 'Chủ phòng');
            const guestName = escapeHtml(onlineState.players?.guest?.userName || 'Chờ đối thủ');
            oppStatusEl.innerHTML = `<span style="color: #475569; font-weight: 600;">${hostName} vs ${guestName}</span>`;
        } else if (onlineState.opponentJoined && onlineState.opponentConnected) {
            oppStatusEl.innerHTML = `<span style="color: #16a34a; font-weight: bold;" title="Đối thủ">🟢 ${oppName}</span>`;
        } else if (onlineState.opponentJoined && !onlineState.opponentConnected) {
            oppStatusEl.innerHTML = `<span style="color: #ef4444; font-weight: bold;" title="Đối thủ tạm rớt mạng">⏳ ${oppName} (90s)</span>`;
        } else {
            oppStatusEl.innerHTML = '<span style="color: #ea580c; font-weight: bold;">⏳ Chờ đối thủ...</span>';
        }
    }

    const turnIndicatorEl = document.getElementById('online-bar-turn');
    if (turnIndicatorEl) {
        if (onlineState.isSpectator) {
            turnIndicatorEl.innerHTML = `<span style="color: #0284c7; font-weight: bold;">👁️ Lượt của: ${isRedTurn ? '🔴 Đỏ' : '⚫ Đen'}</span>`;
        } else if (!onlineState.opponentJoined && onlineState.isHost) {
            turnIndicatorEl.innerHTML = '<span style="color: #ea580c;">⏳ Chờ đối thủ vào...</span>';
        } else if (isMyTurn) {
            turnIndicatorEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;">👉 LƯỢT CỦA BẠN</span>';
        } else {
            turnIndicatorEl.innerHTML = `<span style="color: #64748b;">⏳ Đợi ${escapeHtml(onlineState.opponentUserName || 'đối thủ')}</span>`;
        }
    }

    // Các nút quyền năng của Chủ phòng
    const hostControls = document.getElementById('online-bar-host-controls');
    if (hostControls) {
        hostControls.style.display = onlineState.isHost ? 'flex' : 'none';
    }

    // Cập nhật nhãn nút lượt đi của chủ phòng
    const btnSetTurn = document.getElementById('btn-online-set-turn');
    if (btnSetTurn && onlineState.isHost) {
        btnSetTurn.textContent = isRedTurn ? '🎯 Lượt: Đỏ ➔ Đen' : '🎯 Lượt: Đen ➔ Đỏ';
    }

    // Cập nhật trạng thái nút Mic
    const btnMic = document.getElementById('btn-online-mic');
    if (btnMic) {
        btnMic.classList.toggle('active-mic', onlineState.isMicActive);
        setToolButton(btnMic, onlineState.isMicActive ? '🎙️' : '🔇', onlineState.isMicActive ? 'Mic bật' : 'Mic tắt');
    }

    // Cập nhật trạng thái nút Loa
    const btnSpeaker = document.getElementById('btn-online-speaker');
    if (btnSpeaker) {
        btnSpeaker.classList.toggle('speaker-muted', onlineState.isSpeakerMuted);
        setToolButton(btnSpeaker, onlineState.isSpeakerMuted ? '🔈' : '🔊', onlineState.isSpeakerMuted ? 'Loa tắt' : 'Loa');
    }

    // Cập nhật trạng thái nút Cam
    const btnCam = document.getElementById('btn-online-cam');
    if (btnCam) {
        btnCam.classList.toggle('tool-locked', onlineState.isSpectator);
        btnCam.classList.toggle('active-cam', !onlineState.isSpectator && onlineState.isCameraActive);
        if (onlineState.isSpectator) {
            btnCam.title = 'Khán giả không được bật camera!';
            setToolButton(btnCam, '📷', 'Cam khoá');
        } else {
            btnCam.title = 'Bật/Tắt Camera (chỉ 2 người đấu)';
            setToolButton(btnCam, onlineState.isCameraActive ? '📹' : '📷', onlineState.isCameraActive ? 'Cam bật' : 'Cam tắt');
        }
    }

    // Nút xin hồi nước: chỉ dành cho kỳ thủ
    const btnUndo = document.getElementById('btn-online-undo');
    if (btnUndo) {
        btnUndo.classList.toggle('tool-hidden', onlineState.isSpectator);
        btnUndo.classList.toggle('tool-locked', !!onlineState.undoPending);
        setToolButton(btnUndo, onlineState.undoPending ? '⏳' : '↩️', onlineState.undoPending ? 'Đang chờ' : 'Hồi nước');
    }

    // Cập nhật badge số người xem
    const specCountEl = document.getElementById('online-spectator-count');
    if (specCountEl) {
        specCountEl.textContent = onlineState.spectatorCount || 0;
    }

    updateChatBadges();
    updateLiveButton();
    updatePlayerStripsUI();
}

// Đổi icon + nhãn của nút công cụ (giữ nguyên các phần tử con khác như badge)
function setToolButton(btn, icon, label) {
    const ico = btn.querySelector('.tool-ico');
    const lbl = btn.querySelector('.tool-lbl');
    if (ico && ico.textContent !== icon) ico.textContent = icon;
    if (lbl && lbl.textContent !== label) lbl.textContent = label;
}

// ============================================================
// TÍNH NĂNG CHAT TRÒ CHUYỆN TRONG TRẬN
// ============================================================
const MAX_CHAT_MESSAGES = 150; // giới hạn số tin giữ trên màn hình để không phình DOM/RAM khi chơi lâu

// Nút "Chat" / nút ✕ của khung chat.
// - Điện thoại / máy tính bảng: chuyển giữa tab Chat và tab Nước đi.
// - Máy tính: khung chat luôn hiện, nút ✕ chỉ thu gọn để nhường chỗ cho biên bản.
export function toggleChatBox(forceOpen, options = {}) {
    const chatBox = document.getElementById('online-chat-box');
    if (!chatBox) return;

    if (isOnlineMode() && isStackedLayout()) {
        const open = forceOpen !== undefined ? forceOpen : true;
        setOnlineInfoPane(open ? 'chat' : 'moves');
        if (open && options.scroll !== false) {
            const tabs = document.getElementById('online-info-tabs');
            (tabs || chatBox).scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }

    chatBox.style.display = 'flex';
    const collapsed = chatBox.classList.contains('chat-collapsed');
    const open = forceOpen !== undefined ? forceOpen : collapsed;
    chatBox.classList.toggle('chat-collapsed', !open);
    document.body.classList.toggle('online-chat-collapsed', !open);

    if (open) {
        resetChatUnread();
        // Không tự bật bàn phím trên điện thoại (che mất bàn cờ); chỉ focus khi người dùng chủ động mở chat trên máy tính
        const wantFocus = options.focus !== false && !isTouchDevice();
        const input = document.getElementById('online-chat-input');
        if (input && wantFocus) setTimeout(() => input.focus(), 50);
        scrollChatToBottom();
    }
}

// Người dùng có đang THỰC SỰ nhìn thấy khung tin nhắn không
// (trên điện thoại: đang ở tab Chat nhưng vuốt lên để đánh cờ thì khung chat nằm ngoài màn hình → coi như không thấy)
function isChatPaneVisible() {
    if (document.hidden) return false;
    const chatBox = document.getElementById('online-chat-box');
    if (!chatBox || chatBox.classList.contains('chat-collapsed')) return false;
    const list = document.getElementById('online-chat-messages') || chatBox;
    if (list.getClientRects().length === 0) return false;
    const r = list.getBoundingClientRect();
    const visibleHeight = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    return visibleHeight >= Math.min(80, r.height * 0.5);
}

// Vuốt tới khung chat (tin nhắn hiện lên màn hình) → xoá số tin chưa đọc
let chatSeenObserver = null;
function watchChatVisibility() {
    if (chatSeenObserver || typeof IntersectionObserver === 'undefined') return;
    const list = document.getElementById('online-chat-messages');
    if (!list) return;
    chatSeenObserver = new IntersectionObserver(() => {
        if (onlineState.unreadChatCount > 0 && isChatPaneVisible()) {
            resetChatUnread();
            hideChatPeek();
        }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    chatSeenObserver.observe(list);
}

function resetChatUnread() {
    onlineState.unreadChatCount = 0;
    updateChatBadges();
}

function updateChatBadges() {
    const count = onlineState.unreadChatCount || 0;
    const text = count > 9 ? '9+' : String(count);
    ['online-chat-badge', 'online-chat-tab-badge'].forEach(id => {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
        badge.textContent = text;
    });
}

export function sendOnlineChat(text) {
    const msg = String(text || '').trim();
    if (!msg || !onlineState.roomCode) return;

    const sent = wsSend({
        type: 'CHAT',
        roomCode: onlineState.roomCode,
        senderName: getOnlineUserName(),
        text: msg
    });
    if (!sent) showToast('⚠️ Đang mất kết nối, tin nhắn chưa được gửi.');
}

function appendChatMessage(data) {
    const chatMessages = document.getElementById('online-chat-messages');
    if (!chatMessages) return;

    const isMine = data.senderUserId === getOrCreateUserId() || (data.senderRole === (onlineState.isHost ? 'host' : (onlineState.isSpectator ? 'spectator' : 'guest')) && data.senderName === onlineState.myUserName);
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isMine ? 'mine' : 'theirs'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = data.text;

    const info = document.createElement('div');
    info.className = 'chat-msg-info';
    const timeStr = data.time || new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
    info.textContent = `${isMine ? `Bạn (${onlineState.myUserName})` : (data.senderName || 'Đối thủ')} • ${timeStr}`;

    row.appendChild(bubble);
    row.appendChild(info);
    chatMessages.appendChild(row);

    while (chatMessages.childElementCount > MAX_CHAT_MESSAGES) {
        chatMessages.firstElementChild.remove();
    }

    scrollChatToBottom();

    // Khung chat đang bị ẩn/thu gọn và người gửi không phải mình -> hiển thị badge số tin chưa đọc
    if (!isMine && data.senderRole !== 'system' && !isChatPaneVisible()) {
        onlineState.unreadChatCount++;
        updateChatBadges();
        showChatPeek(data.senderName, data.text);
    }
}

function scrollChatToBottom() {
    const chatMessages = document.getElementById('online-chat-messages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// ============================================================
// VOICE & VIDEO WEBRTC — MESH "LUÔN KẾT NỐI" (KIỂU GOOGLE MEET / ZOOM)
// ------------------------------------------------------------
// - Vào phòng là tự kết nối voice với mọi người (tối đa VOICE_MESH_LIMIT người), không cần ai bật mic trước.
// - Bật/tắt mic, camera chỉ thay track (replaceTrack) → tức thì, không phải đàm phán lại, tắt mic vẫn nghe được.
// - Chỉ bên có UID lớn hơn tạo offer → không bao giờ "đụng offer"; bên còn lại gửi WEBRTC_REQUEST khi cần.
// - Mỗi RTCPeerConnection có pcId riêng → nhận ra ngay khi bên kia tải lại trang/tạo kết nối mới.
// - TURN lấy từ máy chủ (/api/ice-servers) → kết nối được giữa 4G, wifi công ty, mạng khác nhau.
// - Tự phục hồi: ICE restart khi mạng chập chờn/đổi wifi↔4G, dựng lại kết nối nếu vẫn hỏng, watchdog 15s.
// ============================================================

const VOICE_MESH_LIMIT = 8;
const FALLBACK_ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
];
const CONNECT_TIMEOUT_MS = 15000;      // quá thời gian này chưa kết nối được → tự phục hồi
const DISCONNECTED_GRACE_MS = 3000;    // 'disconnected' kéo dài quá mức này → ICE restart
const MAX_ICE_RESTARTS = 2;            // ICE restart tối đa trước khi dựng lại hẳn kết nối
const REQUEST_CONNECT_DELAY_MS = 1200; // bên UID nhỏ chờ offer một chút trước khi chủ động nhờ kết nối
const VOICE_HEALTH_INTERVAL_MS = 5000;
const AUDIO_MAX_BITRATE = 32000;       // Opus giọng nói 32kbps: rõ, nhẹ mạng 4G
const VIDEO_MAX_BITRATE = 300000;

let iceConfigCache = null;   // { config, hasTurn, expiresAt }
let iceConfigPromise = null;
let voiceEpoch = 0;          // tăng mỗi lần rời phòng → huỷ mọi tác vụ voice cũ còn đang chạy
const signalQueues = new Map();          // uid -> Promise (xử lý tuần tự signaling theo từng người)
const pendingConnectRequests = new Map(); // uid -> timeoutId
const lastConnectRequestAt = new Map();   // uid -> thời điểm gửi WEBRTC_REQUEST gần nhất
const rebuildState = new Map();           // uid -> { count, timer }
let voiceHealthTimer = null;
let speakingTimer = null;
let audioUnlockNeeded = false;
let voiceUIScheduled = false;
let meshLimitNotified = false;
let turnNoticeShown = false;

function isInRoom() {
    return !!onlineState.roomCode;
}

function isInitiatorFor(remoteUid) {
    return getOrCreateUserId() > remoteUid;
}

function newPcId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function getLiveTrack(stream, kind) {
    if (!stream) return null;
    const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    return tracks.find(t => t.readyState === 'live') || null;
}

function enqueueSignal(uid, task) {
    const epoch = voiceEpoch;
    const prev = signalQueues.get(uid) || Promise.resolve();
    const next = prev.then(() => {
        if (epoch !== voiceEpoch) return;
        return task();
    }).catch(err => console.warn(`[WebRTC] Lỗi signaling với ${uid}:`, err));
    signalQueues.set(uid, next);
    next.then(() => {
        if (signalQueues.get(uid) === next) signalQueues.delete(uid);
    });
    return next;
}

// Lấy cấu hình ICE (STUN + TURN) từ máy chủ, có cache
async function getRtcConfig() {
    if (iceConfigCache && iceConfigCache.expiresAt > Date.now()) return iceConfigCache.config;
    if (!iceConfigPromise) {
        iceConfigPromise = (async () => {
            let iceServers = FALLBACK_ICE_SERVERS;
            let hasTurn = false;
            let ttl = 600;
            try {
                const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
                const res = await fetch(`/api/ice-servers?uid=${encodeURIComponent(getOrCreateUserId())}`, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
                if (timer) clearTimeout(timer);
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data.iceServers) && data.iceServers.length) {
                        iceServers = data.iceServers;
                        hasTurn = !!data.hasTurn;
                        ttl = Number(data.ttl) || 3600;
                    }
                }
            } catch (e) {
                console.warn('[WebRTC] Không lấy được ICE servers từ máy chủ, dùng STUN mặc định:', e);
            }
            if (!hasTurn) {
                console.warn('[WebRTC] Máy chủ chưa cấu hình TURN → người chơi ở mạng khác nhau có thể không nghe được nhau.');
            }
            const config = { iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
            iceConfigCache = { config, hasTurn, expiresAt: Date.now() + Math.max(60, ttl - 300) * 1000 };
            return config;
        })().finally(() => {
            iceConfigPromise = null;
        });
    }
    return iceConfigPromise;
}

// Opus: bật DTX (im lặng thì gần như không tốn băng thông), FEC (chống mất gói trên 4G), giới hạn bitrate
function tuneOpusSdp(sdp) {
    if (!sdp) return sdp;
    const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (!rtpmap) return sdp;
    const pt = rtpmap[1];
    const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    if (!fmtpRe.test(sdp)) return sdp;
    const extra = { usedtx: '1', useinbandfec: '1', maxaveragebitrate: String(AUDIO_MAX_BITRATE) };
    return sdp.replace(fmtpRe, (_line, params) => {
        const map = new Map();
        params.split(';').map(p => p.trim()).filter(Boolean).forEach(p => {
            const i = p.indexOf('=');
            if (i > 0) map.set(p.slice(0, i), p.slice(i + 1));
            else map.set(p, '');
        });
        Object.entries(extra).forEach(([k, v]) => {
            if (!map.has(k)) map.set(k, v);
        });
        return `a=fmtp:${pt} ` + [...map].map(([k, v]) => (v !== '' ? `${k}=${v}` : k)).join(';');
    });
}

// Danh sách người được kết nối voice (giữ thứ tự của máy chủ: chủ phòng, khách, khán giả theo thứ tự vào)
function isMemberOutdated(m) {
    return (m.vp || 1) !== CLIENT_VOICE_PROTOCOL;
}

function getVoiceTargets() {
    const myId = getOrCreateUserId();
    // Máy chạy phiên bản cũ không kết nối voice được → bỏ qua (hiện chip "bản cũ" thay vì kết nối mãi không được)
    const eligible = onlineState.roomMembers.filter(m => m.userId && (m.userId === myId || !isMemberOutdated(m))).slice(0, VOICE_MESH_LIMIT);
    const inMesh = eligible.some(m => m.userId === myId);
    return { inMesh, targets: eligible.filter(m => m.userId !== myId) };
}

function shouldConnectTo(uid) {
    const { inMesh, targets } = getVoiceTargets();
    return inMesh && targets.some(m => m.userId === uid);
}

function getMember(uid) {
    return onlineState.roomMembers.find(m => m.userId === uid) || null;
}

// Đối thủ (kỳ thủ còn lại) — camera chỉ gửi giữa 2 người đang đấu
function getOpponentMember() {
    if (onlineState.isSpectator) return null;
    const myId = getOrCreateUserId();
    return onlineState.roomMembers.find(m => m.userId !== myId && (m.role === 'host' || m.role === 'guest')) || null;
}

function isPeerConnected(peer) {
    const s = peer.pc.connectionState || peer.pc.iceConnectionState;
    return s === 'connected' || s === 'completed';
}

// ============================
// QUẢN LÝ PEER CONNECTION
// ============================

async function createPeer(uid, initiator) {
    const epoch = voiceEpoch;
    const config = await getRtcConfig();
    if (epoch !== voiceEpoch || !isInRoom()) return null;

    const pc = new RTCPeerConnection(config);
    const peer = {
        uid,
        pc,
        initiator,
        pcId: newPcId(),
        remotePcId: null,
        audioTx: null,
        videoTx: null,
        audioEl: null,
        remoteVideoTrack: null,
        pendingCandidates: [],
        iceRestarts: 0,
        connectTimer: null,
        disconnectTimer: null,
        status: 'connecting',
        createdAt: Date.now(),
        closed: false,
        tuned: false,
        speaking: false
    };

    if (initiator) {
        // Tạo sẵn kênh audio + video 2 chiều; track thật được gắn/gỡ bằng replaceTrack
        peer.audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        peer.videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
        await applyLocalTracks(peer);
    }

    pc.ontrack = (ev) => handleRemoteTrack(peer, ev);
    pc.onicecandidate = (ev) => {
        if (!ev.candidate || peer.closed) return;
        wsSend({
            type: 'WEBRTC_ICE',
            roomCode: onlineState.roomCode,
            targetUserId: uid,
            pcId: peer.pcId,
            toPcId: peer.remotePcId,
            candidate: typeof ev.candidate.toJSON === 'function' ? ev.candidate.toJSON() : ev.candidate
        });
    };
    const onStateChange = () => handlePeerStateChange(peer);
    pc.onconnectionstatechange = onStateChange;
    pc.oniceconnectionstatechange = onStateChange;

    onlineState.peerConnections.set(uid, peer);
    armConnectWatchdog(peer);
    scheduleVoiceUIUpdate();
    return peer;
}

function closePeer(uid) {
    const peer = onlineState.peerConnections.get(uid);
    if (!peer) return;
    peer.closed = true;
    clearTimeout(peer.connectTimer);
    clearTimeout(peer.disconnectTimer);
    try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.close();
    } catch (e) { }
    if (peer.audioEl) {
        peer.audioEl.srcObject = null;
        peer.audioEl.remove();
        peer.audioEl = null;
    }
    onlineState.peerConnections.delete(uid);
    refreshRemoteVideo();
    scheduleVoiceUIUpdate();
}

// Gắn đúng track của mình vào từng kết nối: mic cho mọi người, camera chỉ cho đối thủ
async function applyLocalTracks(peer) {
    if (!peer || peer.closed) return;
    const micTrack = onlineState.isMicActive ? getLiveTrack(onlineState.localStream, 'audio') : null;
    const opponent = getOpponentMember();
    const camTrack = (onlineState.isCameraActive && opponent && opponent.userId === peer.uid)
        ? getLiveTrack(onlineState.localVideoStream, 'video')
        : null;
    await replaceSenderTrack(peer.audioTx, micTrack);
    await replaceSenderTrack(peer.videoTx, camTrack);
}

async function replaceSenderTrack(transceiver, track) {
    if (!transceiver || !transceiver.sender) return;
    if (transceiver.sender.track === track) return;
    try {
        await transceiver.sender.replaceTrack(track);
    } catch (e) {
        console.warn('[WebRTC] replaceTrack lỗi:', e);
    }
}

async function applyLocalTracksToAll() {
    const peers = [...onlineState.peerConnections.values()];
    await Promise.all(peers.map(p => applyLocalTracks(p)));
}

// Bên nhận offer: lấy 2 transceiver (audio/video) do bên kia tạo và mở chiều gửi
function bindTransceivers(peer) {
    const transceivers = peer.pc.getTransceivers();
    if (!peer.audioTx) peer.audioTx = transceivers.find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio') || null;
    if (!peer.videoTx) peer.videoTx = transceivers.find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video') || null;
    [peer.audioTx, peer.videoTx].forEach(t => {
        if (t && t.direction !== 'sendrecv' && t.direction !== 'stopped') {
            try { t.direction = 'sendrecv'; } catch (e) { }
        }
    });
}

async function setSenderEncoding(sender, encoding) {
    if (!sender || typeof sender.getParameters !== 'function') return;
    try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) return;
        Object.assign(params.encodings[0], encoding);
        await sender.setParameters(params);
    } catch (e) { }
}

// Ưu tiên gói tin giọng nói + giới hạn bitrate camera (chạy 1 lần khi kết nối thành công)
async function tuneSenders(peer) {
    if (peer.tuned) return;
    peer.tuned = true;
    await setSenderEncoding(peer.audioTx && peer.audioTx.sender, { maxBitrate: AUDIO_MAX_BITRATE, priority: 'high', networkPriority: 'high' });
    await setSenderEncoding(peer.videoTx && peer.videoTx.sender, { maxBitrate: VIDEO_MAX_BITRATE, maxFramerate: 15 });
}

function handleRemoteTrack(peer, ev) {
    if (peer.closed) return;
    const track = ev.track;
    if (track.kind === 'audio') {
        if (!peer.audioEl) {
            const el = document.createElement('audio');
            el.autoplay = true;
            el.setAttribute('playsinline', '');
            el.dataset.uid = peer.uid;
            (document.getElementById('online-remote-audios') || document.body).appendChild(el);
            peer.audioEl = el;
        }
        peer.audioEl.srcObject = new MediaStream([track]);
        peer.audioEl.muted = onlineState.isSpeakerMuted;
        playRemoteAudio(peer.audioEl);
    } else if (track.kind === 'video') {
        peer.remoteVideoTrack = track;
        refreshRemoteVideo();
    }
}

function playRemoteAudio(el) {
    if (!el || onlineState.isSpeakerMuted) return;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
        p.catch(() => requireAudioUnlock());
    }
}

// iPhone/Safari chặn tự phát âm thanh khi chưa chạm màn hình → chạm bất kỳ đâu (hoặc nút "Bấm để nghe") sẽ mở khoá
function requireAudioUnlock() {
    if (audioUnlockNeeded) return;
    audioUnlockNeeded = true;
    ['click', 'touchend', 'keydown'].forEach(evt => document.addEventListener(evt, unlockRemoteAudio, { capture: true, once: true }));
    scheduleVoiceUIUpdate();
}

export function unlockRemoteAudio() {
    if (!audioUnlockNeeded) return;
    audioUnlockNeeded = false;
    ['click', 'touchend', 'keydown'].forEach(evt => document.removeEventListener(evt, unlockRemoteAudio, { capture: true }));
    for (const peer of onlineState.peerConnections.values()) {
        if (peer.audioEl) playRemoteAudio(peer.audioEl);
    }
    scheduleVoiceUIUpdate();
}

// Hiển thị camera của đối thủ (nếu đối thủ đang bật cam)
function refreshRemoteVideo() {
    const remoteVideo = document.getElementById('online-remote-video');
    const placeholder = document.getElementById('cam-top-placeholder');
    if (!remoteVideo) return;

    let track = null;
    const opponent = getOpponentMember();
    if (opponent && opponent.camOn) {
        const peer = onlineState.peerConnections.get(opponent.userId);
        if (peer && peer.remoteVideoTrack && peer.remoteVideoTrack.readyState === 'live') track = peer.remoteVideoTrack;
    }

    const current = remoteVideo.srcObject && remoteVideo.srcObject.getVideoTracks ? remoteVideo.srcObject.getVideoTracks()[0] : null;
    if (track) {
        if (current !== track) {
            remoteVideo.muted = true;
            remoteVideo.srcObject = new MediaStream([track]);
            remoteVideo.play().catch(() => { });
        }
        remoteVideo.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
    } else {
        if (remoteVideo.srcObject) remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
    }
}

// ============================
// TRẠNG THÁI KẾT NỐI & TỰ PHỤC HỒI
// ============================

function armConnectWatchdog(peer) {
    clearTimeout(peer.connectTimer);
    peer.connectTimer = setTimeout(() => {
        if (!peer.closed && isInRoom() && !isPeerConnected(peer)) {
            console.warn(`[WebRTC] Quá ${CONNECT_TIMEOUT_MS / 1000}s chưa kết nối được với ${peer.uid} → phục hồi`);
            recoverPeer(peer);
        }
    }, CONNECT_TIMEOUT_MS);
}

function handlePeerStateChange(peer) {
    if (peer.closed) return;
    const pc = peer.pc;
    const s = pc.connectionState || pc.iceConnectionState;

    if (s === 'connected' || s === 'completed') {
        peer.status = 'connected';
        peer.iceRestarts = 0;
        clearTimeout(peer.connectTimer);
        clearTimeout(peer.disconnectTimer);
        peer.disconnectTimer = null;
        const rb = rebuildState.get(peer.uid);
        if (rb) rb.count = 0;
        tuneSenders(peer);
        if (peer.audioEl) playRemoteAudio(peer.audioEl);
        maybeShowTurnNotice();
    } else if (s === 'disconnected') {
        // Chập chờn ngắn (đổi wifi ↔ 4G, sóng yếu) → đợi một chút rồi ICE restart nếu chưa tự hồi
        peer.status = 'reconnecting';
        if (!peer.disconnectTimer) {
            peer.disconnectTimer = setTimeout(() => {
                peer.disconnectTimer = null;
                if (!peer.closed && !isPeerConnected(peer)) recoverPeer(peer);
            }, DISCONNECTED_GRACE_MS);
        }
    } else if (s === 'failed') {
        peer.status = 'failed';
        recoverPeer(peer);
    } else if (s === 'new' || s === 'checking' || s === 'connecting') {
        if (peer.status !== 'reconnecting') peer.status = 'connecting';
    }
    scheduleVoiceUIUpdate();
}

function recoverPeer(peer) {
    if (peer.closed || !isInRoom()) return;
    const uid = peer.uid;
    if (peer.initiator) {
        enqueueSignal(uid, async () => {
            if (onlineState.peerConnections.get(uid) !== peer || peer.closed || isPeerConnected(peer)) return;
            if (peer.remotePcId && peer.iceRestarts < MAX_ICE_RESTARTS) {
                peer.iceRestarts++;
                console.log(`[WebRTC] ICE restart lần ${peer.iceRestarts} với ${uid}`);
                await sendOffer(peer, true);
                armConnectWatchdog(peer);
            } else {
                scheduleRebuild(uid);
            }
        });
    } else {
        // Bên nhận không tự tạo offer → nhờ bên khởi tạo ICE restart (hoặc dựng lại hẳn nếu đã thử nhiều lần)
        const reason = peer.iceRestarts < MAX_ICE_RESTARTS ? 'ice-restart' : 'reset';
        peer.iceRestarts++;
        requestFromInitiator(uid, reason, 0);
        armConnectWatchdog(peer);
    }
}

// Dựng lại kết nối với backoff (2s, 4s, 8s... tối đa 30s) để không spam khi mạng hỏng hẳn
function scheduleRebuild(uid) {
    const rb = rebuildState.get(uid) || { count: 0, timer: null };
    if (rb.timer) return;
    const delay = rb.count === 0 ? 0 : Math.min(30000, 2000 * Math.pow(2, rb.count - 1));
    rb.count++;
    rb.timer = setTimeout(() => {
        rb.timer = null;
        enqueueSignal(uid, () => rebuildPeerNow(uid));
    }, delay);
    rebuildState.set(uid, rb);
}

// Chỉ gọi bên trong enqueueSignal(uid, ...)
async function rebuildPeerNow(uid) {
    if (!isInRoom() || !shouldConnectTo(uid) || !isInitiatorFor(uid)) return;
    closePeer(uid);
    const peer = await createPeer(uid, true);
    if (peer) await sendOffer(peer);
}

function recoverStalledPeers() {
    if (!isInRoom()) return;
    for (const peer of onlineState.peerConnections.values()) {
        if (!isPeerConnected(peer)) recoverPeer(peer);
    }
    reconcileVoiceMesh();
}

// ============================
// SIGNALING: OFFER / ANSWER / ICE / REQUEST
// ============================

async function sendOffer(peer, iceRestart = false) {
    const pc = peer.pc;
    if (peer.closed) return;
    if (pc.signalingState === 'have-local-offer') {
        // Offer trước chưa được trả lời (có thể đã thất lạc) → huỷ để tạo offer mới
        try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) { }
    }
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : {});
    if (peer.closed || pc.signalingState !== 'stable') return;
    await pc.setLocalDescription(offer);
    wsSend({
        type: 'WEBRTC_OFFER',
        roomCode: onlineState.roomCode,
        targetUserId: peer.uid,
        pcId: peer.pcId,
        toPcId: peer.remotePcId,
        offer: { type: 'offer', sdp: pc.localDescription.sdp }
    });
}

function clearPendingConnectRequest(uid) {
    const t = pendingConnectRequests.get(uid);
    if (t) clearTimeout(t);
    pendingConnectRequests.delete(uid);
}

// Bên UID nhỏ nhờ bên UID lớn (bên khởi tạo) kết nối / ICE restart / dựng lại
function requestFromInitiator(uid, reason = 'connect', delayMs = 0) {
    clearPendingConnectRequest(uid);
    const send = () => {
        pendingConnectRequests.delete(uid);
        if (!isInRoom() || !shouldConnectTo(uid)) return;
        const peer = onlineState.peerConnections.get(uid);
        if (reason === 'connect' && peer && !peer.closed) return; // offer đã tới trong lúc chờ
        lastConnectRequestAt.set(uid, Date.now());
        wsSend({
            type: 'WEBRTC_REQUEST',
            roomCode: onlineState.roomCode,
            targetUserId: uid,
            reason,
            pcId: peer ? peer.pcId : null,
            knownRemotePcId: peer ? peer.remotePcId : null
        });
    };
    if (delayMs > 0) {
        lastConnectRequestAt.set(uid, Date.now());
        pendingConnectRequests.set(uid, setTimeout(send, delayMs));
    } else {
        send();
    }
}

function handleRtcSignal(data) {
    const uid = data.fromUserId;
    if (!uid || uid === getOrCreateUserId() || !isInRoom()) return;
    if (data.type === 'WEBRTC_OFFER') enqueueSignal(uid, () => handleRtcOffer(uid, data));
    else if (data.type === 'WEBRTC_ANSWER') enqueueSignal(uid, () => handleRtcAnswer(uid, data));
    else if (data.type === 'WEBRTC_ICE') enqueueSignal(uid, () => handleRtcIce(uid, data));
    else if (data.type === 'WEBRTC_REQUEST') enqueueSignal(uid, () => handleRtcRequest(uid, data));
}

async function handleRtcOffer(uid, data) {
    if (!data.offer || !data.offer.sdp || !data.pcId) return;
    if (isInitiatorFor(uid)) return; // theo giao thức chỉ bên UID lớn hơn gửi offer
    if (!shouldConnectTo(uid)) return;

    let peer = onlineState.peerConnections.get(uid);
    if (data.toPcId) {
        // Offer đàm phán lại (ICE restart) dành cho 1 kết nối cụ thể của mình
        if (!peer || peer.pcId !== data.toPcId || peer.remotePcId !== data.pcId) {
            // Kết nối đó không còn (mình đã tải lại trang...) → nhờ bên kia dựng kết nối mới
            requestFromInitiator(uid, 'reset', 0);
            return;
        }
    } else if (peer && peer.remotePcId && peer.remotePcId !== data.pcId) {
        // Bên kia vừa tạo kết nối mới → bỏ kết nối cũ
        closePeer(uid);
        peer = null;
    }

    if (!peer) {
        peer = await createPeer(uid, false);
        if (!peer) return;
    }
    peer.remotePcId = data.pcId;
    clearPendingConnectRequest(uid);

    const pc = peer.pc;
    if (pc.signalingState !== 'stable') {
        try { await pc.setLocalDescription({ type: 'rollback' }); } catch (e) { }
    }
    await pc.setRemoteDescription({ type: 'offer', sdp: tuneOpusSdp(data.offer.sdp) });
    if (peer.closed) return;
    bindTransceivers(peer);
    await applyLocalTracks(peer);
    await flushPendingCandidates(peer);

    const answer = await pc.createAnswer();
    if (peer.closed) return;
    await pc.setLocalDescription(answer);
    wsSend({
        type: 'WEBRTC_ANSWER',
        roomCode: onlineState.roomCode,
        targetUserId: uid,
        pcId: peer.pcId,
        toPcId: peer.remotePcId,
        answer: { type: 'answer', sdp: pc.localDescription.sdp }
    });
    armConnectWatchdog(peer);
}

async function handleRtcAnswer(uid, data) {
    const peer = onlineState.peerConnections.get(uid);
    if (!peer || peer.closed || !peer.initiator || !data.answer || !data.answer.sdp) return;
    if (data.toPcId !== peer.pcId) return; // trả lời cho kết nối cũ
    if (peer.remotePcId && peer.remotePcId !== data.pcId) {
        // Bên kia đã dựng kết nối mới → kết nối hiện tại không dùng được nữa
        await rebuildPeerNow(uid);
        return;
    }
    if (peer.pc.signalingState !== 'have-local-offer') return;
    peer.remotePcId = data.pcId;
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: tuneOpusSdp(data.answer.sdp) });
    await flushPendingCandidates(peer);
}

async function handleRtcIce(uid, data) {
    const peer = onlineState.peerConnections.get(uid);
    if (!peer || peer.closed || !data.candidate) return;
    if (data.toPcId && data.toPcId !== peer.pcId) return;
    if (peer.remotePcId && data.pcId !== peer.remotePcId) return;
    if (!peer.remotePcId || !peer.pc.remoteDescription) {
        peer.pendingCandidates.push({ pcId: data.pcId, candidate: data.candidate });
        if (peer.pendingCandidates.length > 100) peer.pendingCandidates.shift();
        return;
    }
    try {
        await peer.pc.addIceCandidate(data.candidate);
    } catch (e) { }
}

async function flushPendingCandidates(peer) {
    const list = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const item of list) {
        if (item.pcId !== peer.remotePcId) continue;
        try {
            await peer.pc.addIceCandidate(item.candidate);
        } catch (e) { }
    }
}

// Bên khởi tạo nhận yêu cầu kết nối / ICE restart / dựng lại từ bên UID nhỏ
async function handleRtcRequest(uid, data) {
    if (!isInitiatorFor(uid) || !shouldConnectTo(uid)) return;
    const reason = data.reason || 'connect';
    const peer = onlineState.peerConnections.get(uid);

    if (peer && !peer.closed) {
        const sameSession = !!data.knownRemotePcId && data.knownRemotePcId === peer.pcId;
        if (reason === 'connect') {
            if (sameSession) return; // bên kia đang giữ đúng kết nối hiện tại
            // Offer vừa gửi đang trên đường tới → không dựng lại
            if (!peer.remotePcId && Date.now() - peer.createdAt < CONNECT_TIMEOUT_MS) return;
        }
        if (reason === 'ice-restart' && sameSession && peer.remotePcId) {
            if (isPeerConnected(peer)) return;
            if (peer.iceRestarts < MAX_ICE_RESTARTS) {
                peer.iceRestarts++;
                await sendOffer(peer, true);
                armConnectWatchdog(peer);
                return;
            }
        }
    }
    await rebuildPeerNow(uid);
}

// Đối chiếu danh sách thành viên ↔ kết nối voice hiện có (chạy khi danh sách đổi + mỗi 5s để tự phục hồi)
function reconcileVoiceMesh() {
    if (!isInRoom() || typeof RTCPeerConnection === 'undefined') return;
    const { inMesh, targets } = getVoiceTargets();
    const wanted = new Set(targets.map(m => m.userId));

    for (const [uid, peer] of [...onlineState.peerConnections.entries()]) {
        if (!inMesh || !wanted.has(uid)) {
            enqueueSignal(uid, async () => closePeer(uid));
        } else if (peer.pc.signalingState === 'closed') {
            // Kết nối bị trình duyệt đóng ngầm (iOS chạy nền...) → bỏ để tạo lại bên dưới / ở lượt kiểm tra sau
            enqueueSignal(uid, async () => {
                if (onlineState.peerConnections.get(uid) === peer) closePeer(uid);
            });
        }
    }

    if (!inMesh) {
        if (!meshLimitNotified && onlineState.roomMembers.length > VOICE_MESH_LIMIT) {
            meshLimitNotified = true;
            showToast(`ℹ️ Phòng đông: voice chỉ dành cho ${VOICE_MESH_LIMIT} người đầu tiên, bạn vẫn xem cờ & chat bình thường.`);
        }
        scheduleVoiceUIUpdate();
        return;
    }

    const now = Date.now();
    for (const m of targets) {
        if (!m.connected) continue; // đang chờ kết nối lại: giữ nguyên kết nối cũ (có thể vẫn đang chạy tốt)
        const uid = m.userId;
        const existing = onlineState.peerConnections.get(uid);
        if (existing && existing.pc.signalingState !== 'closed') continue;
        if (isInitiatorFor(uid)) {
            enqueueSignal(uid, async () => {
                const current = onlineState.peerConnections.get(uid);
                if ((current && current.pc.signalingState !== 'closed') || !shouldConnectTo(uid)) return;
                if (current) closePeer(uid);
                const peer = await createPeer(uid, true);
                if (peer) await sendOffer(peer);
            });
        } else if (!pendingConnectRequests.has(uid)) {
            const last = lastConnectRequestAt.get(uid) || 0;
            if (now - last > 8000) {
                // Lần đầu chờ offer một chút; nếu offer bị thất lạc thì nhắc lại sau mỗi ~8s
                requestFromInitiator(uid, 'connect', last ? 0 : REQUEST_CONNECT_DELAY_MS);
            }
        }
    }

    applyLocalTracksToAll();
    refreshRemoteVideo();
    scheduleVoiceUIUpdate();
}

function startVoiceMonitors() {
    if (!voiceHealthTimer) {
        voiceHealthTimer = setInterval(() => {
            if (isInRoom() && !document.hidden) reconcileVoiceMesh();
        }, VOICE_HEALTH_INTERVAL_MS);
    }
    if (!speakingTimer) {
        speakingTimer = setInterval(onlineUiTick, 300);
    }
}

// Vòng cập nhật giao diện nhẹ (300ms): đèn đang nói, nút "về thế cờ hiện tại", dải tên khi lật cờ
function onlineUiTick() {
    if (document.hidden || !isInRoom()) return;
    updateSpeakingIndicators();
    updateLiveButton();
    if (lastStripsKey !== getStripsKey()) updatePlayerStripsUI();
}

function stopVoiceMonitors() {
    if (voiceHealthTimer) clearInterval(voiceHealthTimer);
    if (speakingTimer) clearInterval(speakingTimer);
    voiceHealthTimer = null;
    speakingTimer = null;
}

// Rời phòng: đóng mọi kết nối, tắt mic/cam
function teardownVoice() {
    voiceEpoch++;
    stopVoiceMonitors();
    for (const uid of [...onlineState.peerConnections.keys()]) closePeer(uid);
    signalQueues.clear();
    pendingConnectRequests.forEach(t => clearTimeout(t));
    pendingConnectRequests.clear();
    lastConnectRequestAt.clear();
    rebuildState.forEach(rb => { if (rb.timer) clearTimeout(rb.timer); });
    rebuildState.clear();

    if (onlineState.localStream) {
        onlineState.localStream.getTracks().forEach(t => t.stop());
        onlineState.localStream = null;
    }
    onlineState.isMicActive = false;
    stopOnlineCamera(true);
    onlineState.micUsers.clear();
    meshLimitNotified = false;
    if (audioUnlockNeeded) {
        audioUnlockNeeded = false;
        ['click', 'touchend', 'keydown'].forEach(evt => document.removeEventListener(evt, unlockRemoteAudio, { capture: true }));
    }
    refreshRemoteVideo();
    renderVoicePanel();
}

// ============================
// BẬT / TẮT MICROPHONE
// ============================

function describeMediaError(err, device) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return `Bạn đã chặn quyền ${device}. Hãy cho phép trong cài đặt trình duyệt rồi thử lại.`;
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return `Không tìm thấy ${device} trên thiết bị.`;
    if (name === 'NotReadableError' || name === 'AbortError') return `${device} đang bị ứng dụng khác sử dụng.`;
    return (err && err.message) || `Không mở được ${device}.`;
}

function ensureMediaSupport() {
    if (!window.isSecureContext) throw new Error('Micro/Camera chỉ hoạt động trên HTTPS (hoặc localhost).');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Trình duyệt không hỗ trợ Micro/Camera.');
}

async function ensureMicStream() {
    if (getLiveTrack(onlineState.localStream, 'audio')) return;
    ensureMediaSupport();
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
        },
        video: false
    });
    const track = stream.getAudioTracks()[0];
    if (track) {
        try { track.contentHint = 'speech'; } catch (e) { }
        // Micro bị ngắt từ ngoài (rút tai nghe, hệ điều hành thu hồi quyền...)
        track.onended = () => {
            if (onlineState.localStream !== stream) return;
            onlineState.localStream = null;
            if (onlineState.isMicActive) {
                onlineState.isMicActive = false;
                onlineState.micUsers.delete(getOrCreateUserId());
                applyLocalTracksToAll();
                sendVoiceStatus(false);
                updateOnlineRoomBar();
                scheduleVoiceUIUpdate();
                showToast('⚠️ Micro vừa bị ngắt (thiết bị hoặc quyền truy cập).');
            }
        };
    }
    onlineState.localStream = stream;
}

async function setMicEnabled(on) {
    if (on) {
        await ensureMicStream();
        unlockRemoteAudio(); // đang có thao tác chạm của người dùng → tranh thủ mở khoá âm thanh
    }
    const track = getLiveTrack(onlineState.localStream, 'audio');
    if (track) track.enabled = on;
    onlineState.isMicActive = on && !!track;

    const myId = getOrCreateUserId();
    if (onlineState.isMicActive) onlineState.micUsers.add(myId);
    else onlineState.micUsers.delete(myId);

    await applyLocalTracksToAll();
    sendVoiceStatus(onlineState.isMicActive);
}

export async function toggleOnlineVoiceMic() {
    if (!onlineState.roomCode) {
        showToast('⚠️ Bạn chưa vào phòng đấu!');
        return;
    }

    try {
        if (onlineState.isMicActive) {
            await setMicEnabled(false);
            showToast('🔇 Đã tắt mic (bạn vẫn nghe được mọi người).');
        } else {
            await setMicEnabled(true);
            showToast('🎙️ Đã bật mic!');
        }
    } catch (err) {
        console.error('[Voice] Lỗi mở Mic:', err);
        showToast('❌ ' + escapeHtml(describeMediaError(err, 'micro')));
    }
    updateOnlineRoomBar();
    scheduleVoiceUIUpdate();
}

// Tắt/bật loa: tắt tiếng toàn bộ voice của người khác trên máy mình
export function toggleOnlineSpeaker() {
    onlineState.isSpeakerMuted = !onlineState.isSpeakerMuted;
    for (const peer of onlineState.peerConnections.values()) {
        if (!peer.audioEl) continue;
        peer.audioEl.muted = onlineState.isSpeakerMuted;
        if (!onlineState.isSpeakerMuted) playRemoteAudio(peer.audioEl);
    }
    if (!onlineState.isSpeakerMuted) unlockRemoteAudio();
    showToast(onlineState.isSpeakerMuted ? '🔈 Đã tắt loa voice.' : '🔊 Đã bật loa voice.');
    updateOnlineRoomBar();
    scheduleVoiceUIUpdate();
}

// ============================
// BẬT / TẮT CAMERA (CHỈ HOST ↔ GUEST)
// ============================

export async function toggleOnlineCamera() {
    if (!onlineState.roomCode) {
        showToast('⚠️ Bạn chưa vào phòng đấu!');
        return;
    }

    if (onlineState.isSpectator) {
        showToast('⚠️ Khán giả chỉ có thể bật Mic, không thể bật Camera!');
        return;
    }

    if (onlineState.isCameraActive) {
        stopOnlineCamera();
        showToast('📷 Đã tắt Camera.');
    } else {
        try {
            await startOnlineCamera();
            showToast('📹 Đã bật Camera!');
        } catch (err) {
            console.error('[Camera] Lỗi mở Cam:', err);
            showToast('❌ ' + escapeHtml(describeMediaError(err, 'camera')));
        }
    }
    updateOnlineRoomBar();
}

async function startOnlineCamera() {
    ensureMediaSupport();
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' },
        audio: false
    });

    onlineState.localVideoStream = stream;
    onlineState.isCameraActive = true;
    const track = stream.getVideoTracks()[0];
    if (track) {
        track.onended = () => {
            if (onlineState.localVideoStream === stream) {
                stopOnlineCamera();
                updateOnlineRoomBar();
            }
        };
    }

    // Gắn vào video preview của mình
    const localVideo = document.getElementById('online-local-video');
    const localPlaceholder = document.getElementById('cam-bottom-placeholder');
    if (localVideo) {
        localVideo.srcObject = stream;
        localVideo.style.display = 'block';
        if (localPlaceholder) localPlaceholder.style.display = 'none';
        localVideo.play().catch(() => { });
    }

    // Camera chỉ gửi tới đối thủ (host ↔ guest), không gửi tới khán giả
    await applyLocalTracksToAll();
    sendCameraStatus(true);
}

export function stopOnlineCamera(silent = false) {
    const wasActive = onlineState.isCameraActive || !!onlineState.localVideoStream;
    onlineState.isCameraActive = false;

    if (onlineState.localVideoStream) {
        onlineState.localVideoStream.getTracks().forEach(t => t.stop());
        onlineState.localVideoStream = null;
    }

    const localVideo = document.getElementById('online-local-video');
    const localPlaceholder = document.getElementById('cam-bottom-placeholder');
    if (localVideo) {
        localVideo.srcObject = null;
        localVideo.style.display = 'none';
    }
    if (localPlaceholder) {
        localPlaceholder.style.display = 'flex';
    }

    // Gỡ camera khỏi các kết nối (giữ nguyên kết nối voice)
    applyLocalTracksToAll();

    if (wasActive && !silent) sendCameraStatus(false);
}

function sendCameraStatus(isActive, silent = false) {
    if (onlineState.roomCode) {
        wsSend({
            type: 'CAMERA_STATUS',
            roomCode: onlineState.roomCode,
            isCameraActive: isActive,
            silent
        });
    }
}

function handleCameraStatus(data) {
    const member = getMember(data.fromUserId);
    if (member) member.camOn = !!data.isCameraActive;
    refreshRemoteVideo();

    const opponent = getOpponentMember();
    if (!data.silent && opponent && opponent.userId === data.fromUserId) {
        const fromName = data.fromUserName || onlineState.opponentUserName || 'Đối thủ';
        notify(data.isCameraActive ? `📹 ${fromName} đã bật Camera.` : `📷 ${fromName} đã tắt Camera.`);
    }
}

// ============================
// VOICE STATUS BROADCAST
// ============================

function sendVoiceStatus(isActive, silent = false) {
    if (onlineState.roomCode) {
        wsSend({
            type: 'VOICE_STATUS',
            roomCode: onlineState.roomCode,
            isMicActive: isActive,
            silent
        });
    }
}

function handleVoiceStatus(data) {
    const fromUserId = data.fromUserId;
    if (!fromUserId) return;
    const member = getMember(fromUserId);
    if (member) member.micOn = !!data.isMicActive;

    if (data.isMicActive) onlineState.micUsers.add(fromUserId);
    else onlineState.micUsers.delete(fromUserId);

    if (!data.silent) {
        const fromName = data.fromUserName || data.fromRole || 'Ai đó';
        notify(data.isMicActive ? `🎙️ ${fromName} đã bật Microphone.` : `🔇 ${fromName} đã tắt Microphone.`);
    }
    // Khán giả xem trạng thái mic của kỳ thủ qua onlineState.players
    const players = onlineState.players || {};
    [players.host, players.guest].forEach(p => {
        if (p && p.userId === fromUserId) p.micOn = !!data.isMicActive;
    });
    scheduleVoiceUIUpdate();
    updatePlayerStripsUI();
}

// ============================
// VOICE PARTICIPANTS UI (AI ĐANG TRONG VOICE / ĐANG NÓI / TRẠNG THÁI KẾT NỐI)
// ============================

function maybeShowTurnNotice() {
    if (turnNoticeShown || !iceConfigCache || iceConfigCache.hasTurn) return;
    turnNoticeShown = true;
    console.warn('[WebRTC] Đang chạy không có TURN — nếu ai đó không nghe được, hãy cấu hình TURN trên máy chủ (.env.example).');
}

function scheduleVoiceUIUpdate() {
    if (voiceUIScheduled) return;
    voiceUIScheduled = true;
    setTimeout(renderVoicePanel, 60);
}

const VOICE_STATUS_TEXT = {
    me: 'Bạn',
    connected: 'Đã kết nối voice',
    connecting: 'Đang kết nối voice...',
    reconnecting: 'Đang kết nối lại voice...',
    failed: 'Không kết nối được voice (mạng chặn) — đang thử lại',
    away: 'Tạm mất mạng',
    off: 'Ngoài giới hạn voice của phòng',
    outdated: 'Máy này đang dùng phiên bản cũ của ứng dụng — cần tải lại trang để nghe/nói voice'
};

// Thanh nhắc cập nhật (khi máy chủ đã lên phiên bản mới hơn máy này)
function showAppUpdateBanner() {
    if (document.getElementById('online-update-banner')) return;
    const el = document.createElement('div');
    el.id = 'online-update-banner';
    el.className = 'online-update-banner';
    el.innerHTML = '<span>🔄 Đã có phiên bản mới. Tải lại để voice hoạt động với mọi người.</span><button type="button">Tải lại</button>';
    el.querySelector('button').onclick = () => window.location.reload();
    document.body.appendChild(el);
}

let lastVoicePanelHtml = '';

function renderVoicePanel() {
    voiceUIScheduled = false;
    const panel = document.getElementById('voice-participants-panel');
    const list = document.getElementById('voice-participants-list');
    const unlockBtn = document.getElementById('btn-voice-unlock');
    if (!panel || !list) return;

    if (unlockBtn) unlockBtn.style.display = audioUnlockNeeded ? 'inline-flex' : 'none';

    const myId = getOrCreateUserId();
    const others = onlineState.roomMembers.filter(m => m.userId !== myId);
    if (!isInRoom() || (others.length === 0 && !audioUnlockNeeded)) {
        panel.style.display = 'none';
        lastVoicePanelHtml = '';
        list.innerHTML = '';
        return;
    }
    panel.style.display = 'flex';

    const { inMesh, targets } = getVoiceTargets();
    const targetIds = new Set(targets.map(m => m.userId));
    const chips = [{
        uid: myId,
        name: `${onlineState.myUserName} (Bạn)`,
        mic: onlineState.isMicActive,
        status: inMesh ? 'me' : 'off',
        speaking: false
    }];

    others.forEach(m => {
        const peer = onlineState.peerConnections.get(m.userId);
        let status;
        if (isMemberOutdated(m)) status = 'outdated';
        else if (!inMesh || !targetIds.has(m.userId)) status = 'off';
        else if (!m.connected) status = 'away';
        else if (!peer) status = 'connecting';
        else status = peer.status || 'connecting';
        chips.push({ uid: m.userId, name: m.userName || 'Ẩn danh', mic: !!m.micOn && m.connected, status, speaking: !!(peer && peer.speaking) });
    });

    const html = chips.map(c =>
        `<span class="voice-chip is-${c.status}${c.uid === myId ? ' voice-me' : ''}${c.speaking ? ' speaking' : ''}" data-uid="${escapeHtml(c.uid)}" title="${escapeHtml(VOICE_STATUS_TEXT[c.status] || '')}">` +
        `<span class="voice-indicator"></span>${c.mic ? '🎙️' : '🔇'} ${escapeHtml(c.name)}${c.status === 'outdated' ? ' <span class="voice-outdated-tag">⚠️ bản cũ</span>' : ''}</span>`
    ).join('');

    if (html !== lastVoicePanelHtml) {
        lastVoicePanelHtml = html;
        list.innerHTML = html;
    }
}

// Đèn "đang nói": đọc mức âm lượng gói tin cuối (rất nhẹ, không cần Web Audio)
function updateSpeakingIndicators() {
    if (document.hidden || !isInRoom()) return;
    const list = document.getElementById('voice-participants-list');
    const strips = [document.getElementById('online-player-strip-top'), document.getElementById('online-player-strip-bottom')];

    const nowWall = performance.timeOrigin + performance.now();
    const nowPerf = performance.now();
    for (const peer of onlineState.peerConnections.values()) {
        let speaking = false;
        const receiver = peer.audioTx && peer.audioTx.receiver;
        if (receiver && typeof receiver.getSynchronizationSources === 'function' && isPeerConnected(peer)) {
            const src = receiver.getSynchronizationSources()[0];
            if (src && (src.audioLevel || 0) > 0.04) {
                const ts = src.timestamp || 0;
                speaking = Math.abs(nowWall - ts) < 1000 || Math.abs(nowPerf - ts) < 1000;
            }
        }
        if (speaking !== peer.speaking) {
            peer.speaking = speaking;
            const chip = list ? list.querySelector(`[data-uid="${CSS.escape(peer.uid)}"]`) : null;
            if (chip) chip.classList.toggle('speaking', speaking);
            lastVoicePanelHtml = ''; // để lần render sau không ghi đè trạng thái đang nói
        }
    }
    // Viền sáng trên dải tên của kỳ thủ đang nói
    strips.forEach(strip => {
        if (!strip) return;
        const peer = strip.dataset.uid ? onlineState.peerConnections.get(strip.dataset.uid) : null;
        strip.classList.toggle('speaking', !!(peer && peer.speaking));
    });
}

// Kiểm tra và khôi phục phòng nếu người chơi tải lại trang (F5)
export function checkAndResumeSavedRoom() {
    // Không tự động kết nối lại khi tải trang để tránh nhảy vào phòng ngoài ý muốn
    sessionStorage.removeItem('tuongky_active_room');
}
