// js/online.js
import { state } from './state.js';
import { showToast, showLoading, hideLoading, openModal, closeModal, updateTurnToggleUI } from './ui.js';
import { initGame, executeMove } from './game.js';
import { START_FEN } from './config.js';
import { clearUserDrawLines, renderBoardFull } from './board.js';

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

    if (onlineState.ws && onlineState.roomCode) {
        onlineState.ws.send(JSON.stringify({
            type: 'SET_USERNAME',
            roomCode: onlineState.roomCode,
            userName: clean
        }));
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
    // Voice & Video WebRTC
    isMicActive: false,
    isCameraActive: false,
    localStream: null,
    localVideoStream: null,
    peerConnection: null,
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
    clockInterval = setInterval(() => {
        updateClocksTick();
    }, 100);
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
        if (topClock) { topClock.textContent = '--:--'; topClock.className = 'online-digital-clock'; }
        if (botClock) { botClock.textContent = '--:--'; botClock.className = 'online-digital-clock'; }
        return;
    }

    let currentRedMs = timer.redTimeMs;
    let currentBlackMs = timer.blackTimeMs;

    if (timer.isRunning && timer.lastTick && timer.activeSide) {
        const elapsed = Date.now() - timer.lastTick;
        if (timer.activeSide === 'w') {
            currentRedMs = Math.max(0, timer.redTimeMs - elapsed);
        } else if (timer.activeSide === 'b') {
            currentBlackMs = Math.max(0, timer.blackTimeMs - elapsed);
        }
    }

    // Phân bổ đồng hồ cho Top và Bottom theo hướng xoay bàn cờ
    const isBottomRed = !state.isBoardFlipped;
    const bottomMs = isBottomRed ? currentRedMs : currentBlackMs;
    const topMs = isBottomRed ? currentBlackMs : currentRedMs;

    const isBottomActive = timer.isRunning && ((isBottomRed && timer.activeSide === 'w') || (!isBottomRed && timer.activeSide === 'b'));
    const isTopActive = timer.isRunning && ((!isBottomRed && timer.activeSide === 'w') || (isBottomRed && timer.activeSide === 'b'));

    if (botClock) {
        botClock.textContent = formatClockTime(bottomMs);
        botClock.className = 'online-digital-clock' + (isBottomActive ? ' clock-active' : '') + (bottomMs <= 30000 && timer.isRunning ? ' time-warning' : '');
    }

    if (topClock) {
        topClock.textContent = formatClockTime(topMs);
        topClock.className = 'online-digital-clock' + (isTopActive ? ' clock-active' : '') + (topMs <= 30000 && timer.isRunning ? ' time-warning' : '');
    }
}

// Cập nhật dải thông tin người chơi và camera trên/dưới bàn cờ
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

    const topNameEl = document.getElementById('online-name-top');
    const topSideEl = document.getElementById('online-side-top');
    const botNameEl = document.getElementById('online-name-bottom');
    const botSideEl = document.getElementById('online-side-bottom');

    if (onlineState.isSpectator) {
        // Khán giả xem cờ: Bottom = Red, Top = Black
        const hostIsRed = onlineState.players?.host?.color === 'red';
        const redPlayer = hostIsRed ? onlineState.players?.host : onlineState.players?.guest;
        const blackPlayer = hostIsRed ? onlineState.players?.guest : onlineState.players?.host;

        if (topNameEl) topNameEl.textContent = blackPlayer?.userName || 'Chờ đối thủ...';
        if (topSideEl) topSideEl.innerHTML = '<span style="color: #1e293b; font-weight: bold;">⚫ Bên Đen</span>';

        if (botNameEl) botNameEl.textContent = redPlayer?.userName || 'Chờ chủ phòng...';
        if (botSideEl) botSideEl.innerHTML = '<span style="color: #dc2626; font-weight: bold;">🔴 Bên Đỏ</span>';
    } else {
        // Người chơi thi đấu
        const isMeRed = onlineState.myColor === 'red';
        const myName = onlineState.myUserName;
        const oppName = onlineState.opponentUserName || 'Đang chờ...';

        if (botNameEl) botNameEl.textContent = `${myName} (Bạn)`;
        if (botSideEl) botSideEl.innerHTML = isMeRed ? '<span style="color: #dc2626; font-weight: bold;">🔴 Bên Đỏ</span>' : '<span style="color: #1e293b; font-weight: bold;">⚫ Bên Đen</span>';

        if (topNameEl) topNameEl.textContent = oppName;
        if (topSideEl) topSideEl.innerHTML = isMeRed ? '<span style="color: #1e293b; font-weight: bold;">⚫ Bên Đen</span>' : '<span style="color: #dc2626; font-weight: bold;">🔴 Bên Đỏ</span>';
    }

    updateClocksTick();
}

function getWebSocketUrl() {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${loc.host}`;
}

let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 30; // Thử kết nối lại trong vòng ~90s

// Khởi tạo kết nối WebSocket với khả năng tự phục hồi
export function connectOnlineSocket() {
    return new Promise((resolve, reject) => {
        if (onlineState.ws && onlineState.ws.readyState === WebSocket.OPEN) {
            return resolve(onlineState.ws);
        }

        try {
            const wsUrl = getWebSocketUrl();
            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                onlineState.connected = true;
                onlineState.ws = ws;
                reconnectAttempts = 0;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }

                // Nếu đang có phòng cờ dở dang (rớt mạng hoặc F5), tự động gửi yêu cầu tái kết nối
                const savedRoom = sessionStorage.getItem('tuongky_active_room') || onlineState.roomCode;
                if (savedRoom) {
                    console.log(`🔄 [Online] Đang tự động kết nối lại vào phòng [${savedRoom}]...`);
                    ws.send(JSON.stringify({
                        type: 'JOIN_ROOM',
                        roomCode: savedRoom,
                        userId: getOrCreateUserId(),
                        userName: getOnlineUserName()
                    }));
                }

                resolve(ws);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleOnlineMessage(data);
                } catch (e) {
                    console.error('[Online] Lỗi xử lý tin nhắn socket:', e);
                }
            };

            ws.onerror = (err) => {
                console.error('[Online] Lỗi kết nối WebSocket:', err);
                reject(err);
            };

            ws.onclose = () => {
                onlineState.connected = false;
                const activeRoom = sessionStorage.getItem('tuongky_active_room') || onlineState.roomCode;

                if (activeRoom) {
                    showToast('⚠️ Mất kết nối mạng tạm thời! Đang thử kết nối lại...');
                    updateOnlineRoomBar();
                    scheduleSocketReconnect();
                }
            };
        } catch (e) {
            reject(e);
        }
    });
}

// Lên lịch tự động kết nối lại khi mạng bị đứt
function scheduleSocketReconnect() {
    if (reconnectTimer) return;
    const activeRoom = sessionStorage.getItem('tuongky_active_room') || onlineState.roomCode;
    if (!activeRoom) return;

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showToast('❌ Không thể kết nối lại máy chủ sau 90 giây.');
        sessionStorage.removeItem('tuongky_active_room');
        leaveOnlineRoom();
        return;
    }

    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        console.log(`🔄 [Online] Thử kết nối lại lần ${reconnectAttempts}...`);
        connectOnlineSocket().catch(() => {
            scheduleSocketReconnect();
        });
    }, 3000);
}

// Xử lý các thông điệp từ Server
function handleOnlineMessage(data) {
    const { type } = data;

    // 1. TẠO PHÒNG THÀNH CÔNG
    if (type === 'ROOM_CREATED') {
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

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🏠 Đã tạo phòng [${data.roomCode}]! Hãy gửi mã cho bạn bè.`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        return;
    }

    // 2. VÀO PHÒNG THÀNH CÔNG (GUEST)
    if (type === 'ROOM_JOINED') {
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

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🎉 Đã vào phòng [${data.roomCode}]! Bạn cầm quân [${data.myColor === 'red' ? 'Đỏ' : 'Đen'}].`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        return;
    }

    // 2.1. VÀO PHÒNG VỚI TƯ CÁCH KHÁN GIẢ (SPECTATOR)
    if (type === 'ROOM_JOINED_SPECTATOR') {
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = false;
        onlineState.isSpectator = true;
        onlineState.myUserName = data.myUserName || getOnlineUserName();
        onlineState.currentTurn = data.currentTurn;
        onlineState.timerState = data.timer || onlineState.timerState;
        onlineState.spectatorCount = data.spectatorCount || 0;
        onlineState.players = { host: data.host, guest: data.guest };
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, 'red'); // Khán giả nhìn bàn cờ mặc định (Đỏ ở dưới)
        closeModal('online-room-modal');
        showToast(`👁️ Bạn đã vào phòng [${data.roomCode}] ở chế độ XEM CỜ!`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        return;
    }

    // 3. TÁI KẾT NỐI VÀO PHÒNG THÀNH CÔNG (RECONNECTED SAU KHI RỚT MẠNG / F5)
    if (type === 'ROOM_RECONNECTED') {
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

        enterOnlineGame(data.fen, data.myColor || 'red');
        closeModal('online-room-modal');
        showToast(`🔄 Đã kết nối lại phòng [${data.roomCode}]! Ván cờ tiếp tục.`);
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        startClockTicker();
        return;
    }

    // 3.1. CẬP NHẬT DANH SÁCH NGƯỜI CHƠI & KHÁN GIẢ TRONG PHÒNG
    if (type === 'ROOM_PLAYERS_UPDATED') {
        onlineState.players = { host: data.host, guest: data.guest };
        onlineState.spectatorsList = data.spectators || [];
        onlineState.spectatorCount = data.spectatorCount || 0;

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

        showToast('⚔️ ' + (data.message || 'Bạn đã được chọn vào thi đấu!'));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 3.3. BỊ CHUYỂN SANG CHẾ ĐỘ XEM CỜ (DEMOTED_TO_SPECTATOR)
    if (type === 'DEMOTED_TO_SPECTATOR') {
        onlineState.isSpectator = true;
        onlineState.isHost = false;
        stopOnlineCamera(); // Tắt cam vì khán giả không được bật cam

        showToast('👁️ ' + (data.message || 'Bạn đã chuyển sang chế độ Khán giả xem cờ.'));
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
            showToast('⏱️ ' + data.message);
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
        showToast(data.message || '⏰ Hết giờ!');
        return;
    }

    // 4. ĐỐI THỦ VÀO PHÒNG (HOST NHẬN)
    if (type === 'PLAYER_JOINED') {
        onlineState.opponentJoined = true;
        onlineState.opponentConnected = true;
        if (data.opponentUserName) onlineState.opponentUserName = data.opponentUserName;
        showToast('👥 ' + (data.message || `${onlineState.opponentUserName} đã tham gia phòng!`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 5. ĐỐI THỦ TẠM THỜI MẤT MẠNG (ĐANG CHỜ 90S)
    if (type === 'PLAYER_DISCONNECTED') {
        onlineState.opponentConnected = false;
        showToast('⏳ ' + (data.message || `${onlineState.opponentUserName} tạm mất mạng, đang chờ 90s...`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 6. ĐỐI THỦ ĐÃ KẾT NỐI LẠI THÀNH CÔNG
    if (type === 'PLAYER_RECONNECTED') {
        onlineState.opponentConnected = true;
        onlineState.opponentJoined = true;
        if (data.opponentUserName) onlineState.opponentUserName = data.opponentUserName;
        showToast('🟢 ' + (data.message || `${onlineState.opponentUserName} đã kết nối lại phòng!`));
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 7. ĐỐI THỦ ĐỔI TÊN HIỂN THỊ
    if (type === 'OPPONENT_RENAMED') {
        if (data.newName) {
            onlineState.opponentUserName = data.newName;
            showToast(`👤 Đối thủ đã đổi tên thành: ${data.newName}`);
            updateOnlineRoomBar();
            updatePlayerStripsUI();
        }
        return;
    }

    // 8. ĐƯỢC CHUYỂN QUYỀN CHỦ PHÒNG (TRONG PHÒNG CỐ ĐỊNH 013579)
    if (type === 'PROMOTED_TO_HOST') {
        onlineState.isHost = true;
        onlineState.isSpectator = false;
        showToast('👑 ' + (data.message || 'Bạn đã trở thành Chủ phòng mới!'));
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
            executeMove(data.moveCommand);
        }
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        updateClocksTick();
        return;
    }

    // 10. CHỦ PHÒNG CẬP NHẬT BÀN CỜ (XẾP QUÂN)
    if (type === 'BOARD_UPDATED') {
        onlineState.currentTurn = data.currentTurn;
        showToast('🛠️ ' + (data.message || 'Chủ phòng đã cập nhật thế cờ mới!'));
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
        showToast('🎯 ' + (data.message || 'Lượt đi đã thay đổi!'));
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
        showToast('🔄 ' + (data.message || 'Đã hoán đổi bên!'));
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
        showToast('🆕 ' + (data.message || 'Ván cờ mới bắt đầu!'));
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

    // 14. CHỦ PHÒNG RỜI ĐI HẲN
    if (type === 'HOST_LEFT') {
        showToast('🚪 ' + (data.message || 'Chủ phòng đã rời phòng!'));
        sessionStorage.removeItem('tuongky_active_room');
        onlineState.roomCode = null;
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        document.body.classList.remove('mode-online');
        stopVoiceChat();
        stopOnlineCamera();
        stopClockTicker();
        updateOnlineRoomBar();
        updatePlayerStripsUI();
        return;
    }

    // 15. KHÁCH RỜI ĐI HẲN
    if (type === 'GUEST_LEFT') {
        showToast('🚪 ' + (data.message || 'Đối thủ đã rời đi.'));
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        onlineState.opponentUserName = 'Đang chờ...';
        stopVoiceChat();
        stopOnlineCamera();
        updateOnlineRoomBar();
        updatePlayerStripsUI();
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

    // 18. WEBRTC SIGNALING RELAY (VOICE & VIDEO)
    if (type === 'WEBRTC_OFFER') {
        handleWebRTCOffer(data);
        return;
    }
    if (type === 'WEBRTC_ANSWER') {
        handleWebRTCAnswer(data);
        return;
    }
    if (type === 'WEBRTC_ICE') {
        handleWebRTCIce(data);
        return;
    }
    if (type === 'VOICE_STATUS') {
        handleVoiceStatus(data);
        return;
    }

    // 19. BÁO LỖI
    if (type === 'ERROR') {
        showToast('❌ ' + (data.message || 'Đã xảy ra lỗi!'));
        return;
    }
}

// Bắt đầu vào chế độ Online Game
async function enterOnlineGame(initialFen, myColor) {
    clearUserDrawLines();
    state.appMode = 'online';
    state.appSettings.appMode = 'online';
    document.body.classList.add('mode-online');

    // CẤM BẬT THẨM / TẮT HOÀN TOÀN ENGINE PIKAFISH
    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;
    if (state.engineModule) {
        state.engineModule.sendCommand('stop');
    }

    // Tự động xoay bàn cờ: nếu cầm Đen thì xoay để quân Đen ở dưới
    state.isBoardFlipped = (myColor === 'black');

    // Tự động chuyển tab dưới sang Biên Bản
    const historyTabBtn = document.querySelector('.lower-tab-btn[data-tab="history"]');
    if (historyTabBtn) historyTabBtn.click();

    await initGame(initialFen || START_FEN, false);
    updateOnlineRoomBar();
    updatePlayerStripsUI();
}

// Tạo phòng mới
export async function createOnlineRoom(hostColor = 'red') {
    showLoading('Đang tạo phòng...');
    try {
        const ws = await connectOnlineSocket();
        const initialFen = state.currentNode ? state.currentNode.fen : START_FEN;

        ws.send(JSON.stringify({
            type: 'CREATE_ROOM',
            userId: getOrCreateUserId(),
            userName: getOnlineUserName(),
            hostColor: hostColor,
            initialFen: initialFen
        }));
    } catch (e) {
        showToast('❌ Lỗi tạo phòng: ' + e.message);
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

    showLoading(`Đang vào phòng ${code}...`);
    try {
        const ws = await connectOnlineSocket();
        ws.send(JSON.stringify({
            type: 'JOIN_ROOM',
            userId: getOrCreateUserId(),
            userName: getOnlineUserName(),
            roomCode: code
        }));
    } catch (e) {
        showToast('❌ Lỗi kết nối phòng: ' + e.message);
    } finally {
        hideLoading();
    }
}

// Gửi nước đi khi người chơi thực hiện
export function sendOnlineMove(moveCommand, newFen, nextTurn) {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.ws) return;
    if (onlineState.isSpectator) return;

    onlineState.ws.send(JSON.stringify({
        type: 'MOVE',
        roomCode: onlineState.roomCode,
        moveCommand: moveCommand,
        newFen: newFen,
        nextTurn: nextTurn
    }));
}

// Chủ phòng gửi cấu hình đồng hồ tính giờ
export function sendTimerSettings(settings) {
    if (!onlineState.isHost || !onlineState.ws || !onlineState.roomCode) {
        showToast('⚠️ Chỉ Chủ phòng mới có quyền cài đặt đồng hồ!');
        return;
    }

    onlineState.ws.send(JSON.stringify({
        type: 'SET_TIMER_SETTINGS',
        roomCode: onlineState.roomCode,
        settings: settings
    }));
}

// Chủ phòng chọn khán giả vào đánh thay thế
export function substituteGuest(targetUserId) {
    if (!onlineState.isHost || !onlineState.ws || !onlineState.roomCode) {
        showToast('⚠️ Chỉ Chủ phòng mới có quyền thay đổi người đánh!');
        return;
    }

    onlineState.ws.send(JSON.stringify({
        type: 'SUBSTITUTE_GUEST',
        roomCode: onlineState.roomCode,
        targetUserId: targetUserId
    }));
}

// Render danh sách trong Modal Khán Giả
export function renderSpectatorsModalList() {
    const listEl = document.getElementById('modal-spectators-list');
    const playersEl = document.getElementById('modal-players-current');
    if (!listEl || !playersEl) return;

    const hostUser = onlineState.players?.host;
    const guestUser = onlineState.players?.guest;

    playersEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
            <div>
                <strong>👑 ${hostUser?.userName || 'Chủ phòng'}</strong>
                <span style="font-size: 11px; color: ${hostUser?.color === 'red' ? '#dc2626' : '#1e293b'}; font-weight: bold;">
                    (${hostUser?.color === 'red' ? '🔴 Đỏ' : '⚫ Đen'})
                </span>
                ${hostUser?.userId === onlineState.ws?.userId ? '<span style="font-size: 10px; color: #0284c7;">(Bạn)</span>' : ''}
            </div>
            <span style="font-size: 11px; color: #16a34a; font-weight: bold;">🟢 Đang đấu</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px;">
            <div>
                <strong>⚔️ ${guestUser?.userName || 'Đang chờ đối thủ...'}</strong>
                ${guestUser ? `<span style="font-size: 11px; color: ${guestUser.color === 'red' ? '#dc2626' : '#1e293b'}; font-weight: bold;">(${guestUser.color === 'red' ? '🔴 Đỏ' : '⚫ Đen'})</span>` : ''}
                ${guestUser && guestUser.userId === onlineState.ws?.userId ? '<span style="font-size: 10px; color: #0284c7;">(Bạn)</span>' : ''}
            </div>
            <span style="font-size: 11px; color: ${guestUser ? '#16a34a' : '#ea580c'}; font-weight: bold;">${guestUser ? '🟢 Đang đấu' : '⏳ Trống'}</span>
        </div>
    `;

    const specs = onlineState.spectatorsList || [];
    if (specs.length === 0) {
        listEl.innerHTML = '<div style="font-size: 12px; color: #94a3b8; font-style: italic; text-align: center; padding: 10px;">Chưa có khán giả nào vào phòng.</div>';
        return;
    }

    listEl.innerHTML = specs.map(spec => {
        const isMe = spec.userId === onlineState.ws?.userId;
        const subButton = (onlineState.isHost && !isMe)
            ? `<button class="btn-substitute" data-userid="${spec.userId}" data-username="${spec.userName}">⚔️ Cho Vào Đánh</button>`
            : '';

        return `
            <div class="spectator-item-row">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span>👁️</span>
                    <strong>${spec.userName}</strong>
                    ${isMe ? '<span style="font-size: 10.5px; color: #0284c7; font-weight: bold;">(Bạn)</span>' : ''}
                </div>
                <div>${subButton}</div>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.btn-substitute').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const uid = e.target.getAttribute('data-userid');
            const uname = e.target.getAttribute('data-username');
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
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost || !onlineState.ws) return;

    const turn = newFenFull.split(' ')[1] || 'w';
    onlineState.currentTurn = turn;

    onlineState.ws.send(JSON.stringify({
        type: 'HOST_UPDATE_BOARD',
        roomCode: onlineState.roomCode,
        fen: newFenFull,
        currentTurn: turn
    }));
    updateOnlineRoomBar();
}

// Chủ phòng đổi lượt đi
export function sendHostSetTurn(turn) {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost || !onlineState.ws) return;

    onlineState.currentTurn = turn;
    onlineState.ws.send(JSON.stringify({
        type: 'HOST_SET_TURN',
        roomCode: onlineState.roomCode,
        turn: turn
    }));
    updateOnlineRoomBar();
}

// Chủ phòng hoán đổi phe (Đỏ / Đen)
export function sendHostSwapSides() {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost || !onlineState.ws) return;

    onlineState.ws.send(JSON.stringify({
        type: 'HOST_SWAP_SIDES',
        roomCode: onlineState.roomCode
    }));
}

// Chủ phòng khởi động ván mới
export function sendResetGame() {
    if (!isOnlineMode() || !onlineState.roomCode || !onlineState.isHost || !onlineState.ws) return;

    onlineState.ws.send(JSON.stringify({
        type: 'RESET_GAME',
        roomCode: onlineState.roomCode,
        fen: START_FEN
    }));
}

// Rời phòng
export function leaveOnlineRoom() {
    sessionStorage.removeItem('tuongky_active_room');

    if (onlineState.ws && onlineState.roomCode) {
        try {
            onlineState.ws.send(JSON.stringify({
                type: 'LEAVE_ROOM',
                roomCode: onlineState.roomCode
            }));
        } catch (e) {}
    }

    stopVoiceChat();
    stopOnlineCamera();
    stopClockTicker();

    onlineState.roomCode = null;
    onlineState.opponentJoined = false;
    onlineState.opponentConnected = false;
    onlineState.isSpectator = false;
    document.body.classList.remove('mode-online');
    showToast('🚪 Đã rời phòng chơi.');

    const topStrip = document.getElementById('online-player-strip-top');
    const botStrip = document.getElementById('online-player-strip-bottom');
    if (topStrip) topStrip.style.display = 'none';
    if (botStrip) botStrip.style.display = 'none';

    // Chuyển lại về chế độ Phân Tích mặc định
    import('./events.js').then(m => {
        if (m.switchMode) m.switchMode('analyze');
    });

    updateOnlineRoomBar();
}

// Cập nhật thanh hiển thị trạng thái phòng Online trên màn hình
export function updateOnlineRoomBar() {
    const bar = document.getElementById('online-room-bar');
    if (!bar) return;

    if (!isOnlineMode() || !onlineState.roomCode) {
        bar.style.display = 'none';
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
        myNameEl.innerHTML = `<strong>${onlineState.myUserName}</strong> (${roleStr}) ✏️`;
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
        if (onlineState.isSpectator) {
            const hostName = onlineState.players?.host?.userName || 'Chủ phòng';
            const guestName = onlineState.players?.guest?.userName || 'Chờ đối thủ';
            oppStatusEl.innerHTML = `<span style="color: #475569; font-weight: 600;">${hostName} vs ${guestName}</span>`;
        } else if (onlineState.opponentJoined && onlineState.opponentConnected) {
            oppStatusEl.innerHTML = `<span style="color: #16a34a; font-weight: bold;" title="Đối thủ">🟢 ${onlineState.opponentUserName}</span>`;
        } else if (onlineState.opponentJoined && !onlineState.opponentConnected) {
            oppStatusEl.innerHTML = `<span style="color: #ef4444; font-weight: bold;" title="Đối thủ tạm rớt mạng">⏳ ${onlineState.opponentUserName} (90s)</span>`;
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
            turnIndicatorEl.innerHTML = `<span style="color: #64748b;">⏳ Đợi ${onlineState.opponentUserName || 'đối thủ'}</span>`;
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
        if (onlineState.isMicActive) {
            btnMic.classList.add('active-mic');
            btnMic.innerHTML = '🎙️ Mic: Bật';
        } else {
            btnMic.classList.remove('active-mic');
            btnMic.innerHTML = '🎙️ Mic: Tắt';
        }
    }

    // Cập nhật trạng thái nút Cam
    const btnCam = document.getElementById('btn-online-cam');
    if (btnCam) {
        if (onlineState.isSpectator) {
            btnCam.style.opacity = '0.5';
            btnCam.style.cursor = 'not-allowed';
            btnCam.title = 'Khán giả không được bật camera!';
            btnCam.innerHTML = '📷 Cam: Khóa';
        } else {
            btnCam.style.opacity = '1';
            btnCam.style.cursor = 'pointer';
            btnCam.title = 'Bật/Tắt Camera WebRTC';
            if (onlineState.isCameraActive) {
                btnCam.classList.add('active-cam');
                btnCam.innerHTML = '📹 Cam: Bật';
            } else {
                btnCam.classList.remove('active-cam');
                btnCam.innerHTML = '📹 Cam: Tắt';
            }
        }
    }

    // Cập nhật badge số người xem
    const specCountEl = document.getElementById('online-spectator-count');
    if (specCountEl) {
        specCountEl.textContent = onlineState.spectatorCount || 0;
    }
}

// ============================================================
// TÍNH NĂNG CHAT TRÒ CHUYỆN TRONG TRẬN
// ============================================================

export function toggleChatBox(forceOpen) {
    const chatBox = document.getElementById('online-chat-box');
    if (!chatBox) return;

    const shouldShow = forceOpen !== undefined ? forceOpen : (chatBox.style.display === 'none');
    chatBox.style.display = shouldShow ? 'flex' : 'none';

    if (shouldShow) {
        onlineState.unreadChatCount = 0;
        const badge = document.getElementById('online-chat-badge');
        if (badge) {
            badge.style.display = 'none';
            badge.textContent = '0';
        }
        const input = document.getElementById('online-chat-input');
        if (input) setTimeout(() => input.focus(), 50);
        scrollChatToBottom();
    }
}

export function sendOnlineChat(text) {
    const msg = String(text || '').trim();
    if (!msg || !onlineState.ws || !onlineState.roomCode) return;

    onlineState.ws.send(JSON.stringify({
        type: 'CHAT',
        roomCode: onlineState.roomCode,
        senderName: getOnlineUserName(),
        text: msg
    }));
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
    info.textContent = `${isMine ? `Bạn (${onlineState.myUserName})` : (data.senderName || 'Đối thủ')} • ${data.time || ''}`;

    row.appendChild(bubble);
    row.appendChild(info);
    chatMessages.appendChild(row);

    scrollChatToBottom();

    // Nếu hộp chat đang đóng và người gửi không phải mình -> hiển thị badge số tin chưa đọc
    const chatBox = document.getElementById('online-chat-box');
    if (!isMine && (!chatBox || chatBox.style.display === 'none')) {
        onlineState.unreadChatCount++;
        const badge = document.getElementById('online-chat-badge');
        if (badge) {
            badge.style.display = 'inline-block';
            badge.textContent = onlineState.unreadChatCount > 9 ? '9+' : onlineState.unreadChatCount;
        }
        showToast(`💬 ${data.senderName}: ${data.text.slice(0, 35)}...`);
    }
}

function scrollChatToBottom() {
    const chatMessages = document.getElementById('online-chat-messages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// ============================================================
// TÍNH NĂNG WEBRTC: VOICE CHAT & VIDEO CAMERA
// ============================================================

const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// BẬT / TẮT MICROPHONE
export async function toggleOnlineVoiceMic() {
    if (!onlineState.roomCode) {
        showToast('⚠️ Bạn chưa vào phòng đấu!');
        return;
    }

    if (onlineState.isMicActive) {
        stopVoiceChat();
        showToast('🔇 Đã tắt Microphone đàm thoại.');
    } else {
        try {
            await startVoiceChat();
            showToast('🎙️ Đã bật Microphone đàm thoại!');
        } catch (err) {
            console.error('[Voice] Lỗi mở Mic:', err);
            showToast('❌ Không thể mở Microphone: ' + (err.message || 'Chưa cấp quyền mic'));
        }
    }
    updateOnlineRoomBar();
}

async function startVoiceChat() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ truy cập Microphone!');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });

    onlineState.localStream = stream;
    onlineState.isMicActive = true;

    initPeerConnection();

    // Thêm các track âm thanh vào WebRTC
    stream.getTracks().forEach(track => {
        onlineState.peerConnection.addTrack(track, stream);
    });

    sendVoiceStatus(true);
    createAndSendWebRTCOffer();
}

// BẬT / TẮT CAMERA (CHỈ 2 NGƯỜI ĐẤU ĐƯỢC PHÉP)
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
            showToast('❌ Không thể mở Camera: ' + (err.message || 'Chưa cấp quyền cam'));
        }
    }
    updateOnlineRoomBar();
}

async function startOnlineCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Trình duyệt không hỗ trợ truy cập Camera!');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false
    });

    onlineState.localVideoStream = stream;
    onlineState.isCameraActive = true;

    // Gắn vào video preview của mình
    const localVideo = document.getElementById('online-local-video');
    const localPlaceholder = document.getElementById('cam-bottom-placeholder');
    if (localVideo) {
        localVideo.srcObject = stream;
        localVideo.style.display = 'block';
        if (localPlaceholder) localPlaceholder.style.display = 'none';
        localVideo.play().catch(e => console.warn(e));
    }

    initPeerConnection();

    // Thêm track video vào PeerConnection
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && onlineState.peerConnection) {
        onlineState.peerConnection.addTrack(videoTrack, stream);
    }

    sendCameraStatus(true);
    createAndSendWebRTCOffer();
}

export function stopOnlineCamera() {
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

    // Gỡ video track khỏi PeerConnection
    if (onlineState.peerConnection) {
        const senders = onlineState.peerConnection.getSenders();
        senders.forEach(sender => {
            if (sender.track && sender.track.kind === 'video') {
                try { onlineState.peerConnection.removeTrack(sender); } catch (e) {}
            }
        });
    }

    sendCameraStatus(false);
    createAndSendWebRTCOffer();
}

function sendCameraStatus(isActive) {
    if (onlineState.ws && onlineState.roomCode) {
        onlineState.ws.send(JSON.stringify({
            type: 'CAMERA_STATUS',
            roomCode: onlineState.roomCode,
            isCameraActive: isActive
        }));
    }
}

function handleCameraStatus(data) {
    const remoteVideo = document.getElementById('online-remote-video');
    const placeholder = document.getElementById('cam-top-placeholder');

    if (data.isCameraActive) {
        if (remoteVideo) remoteVideo.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        showToast(`📹 ${onlineState.opponentUserName} đã bật Camera.`);
    } else {
        if (remoteVideo) {
            remoteVideo.style.display = 'none';
            remoteVideo.srcObject = null;
        }
        if (placeholder) placeholder.style.display = 'flex';
        showToast(`📷 ${onlineState.opponentUserName} đã tắt Camera.`);
    }
}

function initPeerConnection() {
    if (onlineState.peerConnection) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    onlineState.peerConnection = pc;

    // Khi nhận được âm thanh hoặc video từ đối thủ
    pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
            const remoteAudio = document.getElementById('online-remote-audio');
            if (remoteAudio && event.streams && event.streams[0]) {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().catch(e => console.warn('[Voice] Tự động phát âm thanh bị chặn:', e));
            }
        } else if (event.track.kind === 'video') {
            const remoteVideo = document.getElementById('online-remote-video');
            const placeholder = document.getElementById('cam-top-placeholder');
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
                remoteVideo.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                remoteVideo.play().catch(e => console.warn('[Video] Tự động phát video bị chặn:', e));
            }
        }
    };

    // Khi tìm thấy ứng viên ICE candidate
    pc.onicecandidate = (event) => {
        if (event.candidate && onlineState.ws && onlineState.roomCode) {
            onlineState.ws.send(JSON.stringify({
                type: 'WEBRTC_ICE',
                roomCode: onlineState.roomCode,
                candidate: event.candidate
            }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE State: ${pc.iceConnectionState}`);
    };
}

async function createAndSendWebRTCOffer() {
    if (!onlineState.peerConnection || !onlineState.ws) return;

    try {
        const offer = await onlineState.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await onlineState.peerConnection.setLocalDescription(offer);

        onlineState.ws.send(JSON.stringify({
            type: 'WEBRTC_OFFER',
            roomCode: onlineState.roomCode,
            offer: offer
        }));
    } catch (e) {
        console.error('[WebRTC] Lỗi tạo Offer:', e);
    }
}

async function handleWebRTCOffer(data) {
    if (!data.offer) return;
    initPeerConnection();

    try {
        await onlineState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await onlineState.peerConnection.createAnswer();
        await onlineState.peerConnection.setLocalDescription(answer);

        if (onlineState.ws && onlineState.roomCode) {
            onlineState.ws.send(JSON.stringify({
                type: 'WEBRTC_ANSWER',
                roomCode: onlineState.roomCode,
                answer: answer
            }));
        }
    } catch (e) {
        console.error('[WebRTC] Lỗi xử lý Offer:', e);
    }
}

async function handleWebRTCAnswer(data) {
    if (!data.answer || !onlineState.peerConnection) return;
    try {
        await onlineState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (e) {
        console.error('[WebRTC] Lỗi xử lý Answer:', e);
    }
}

async function handleWebRTCIce(data) {
    if (!data.candidate || !onlineState.peerConnection) return;
    try {
        await onlineState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
        console.error('[WebRTC] Lỗi thêm ICE Candidate:', e);
    }
}

function sendVoiceStatus(isActive) {
    if (onlineState.ws && onlineState.roomCode) {
        onlineState.ws.send(JSON.stringify({
            type: 'VOICE_STATUS',
            roomCode: onlineState.roomCode,
            isMicActive: isActive
        }));
    }
}

function handleVoiceStatus(data) {
    const oppName = onlineState.opponentUserName || 'Đối thủ';
    if (data.isMicActive) {
        showToast(`🎙️ ${oppName} đã bật Microphone.`);
    } else {
        showToast(`🔇 ${oppName} đã tắt Microphone.`);
    }
}

function stopVoiceChat() {
    onlineState.isMicActive = false;

    if (onlineState.localStream) {
        onlineState.localStream.getTracks().forEach(track => track.stop());
        onlineState.localStream = null;
    }

    const remoteAudio = document.getElementById('online-remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }

    sendVoiceStatus(false);
}

// Kiểm tra và khôi phục phòng nếu người chơi tải lại trang (F5)
export function checkAndResumeSavedRoom() {
    // Không tự động kết nối lại khi tải trang để tránh nhảy vào phòng ngoài ý muốn
    sessionStorage.removeItem('tuongky_active_room');
}
