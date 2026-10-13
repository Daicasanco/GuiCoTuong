// js/online.js
import { state } from './state.js';
import { showToast, showLoading, hideLoading, openModal, closeModal, updateTurnToggleUI } from './ui.js';
import { initGame, executeMove } from './game.js';
import { START_FEN } from './config.js';
import { clearUserDrawLines, renderBoardFull } from './board.js';

export const onlineState = {
    connected: false,
    roomCode: null,
    isHost: false,
    myColor: 'red',          // 'red' | 'black'
    opponentColor: 'black',  // 'red' | 'black'
    currentTurn: 'w',        // 'w' | 'b'
    opponentJoined: false,
    ws: null
};

export function isOnlineMode() {
    return state.appMode === 'online';
}

export function isMyOnlineTurn() {
    if (!isOnlineMode()) return true;
    const isRedTurn = (state.currentNode ? state.currentNode.fen.split(' ')[1] : onlineState.currentTurn) === 'w';
    return (onlineState.myColor === 'red' && isRedTurn) || (onlineState.myColor === 'black' && !isRedTurn);
}

export function getMyOnlineColor() {
    return onlineState.myColor;
}

function getWebSocketUrl() {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    // Nếu chạy qua port dev hoặc cùng host
    return `${protocol}//${loc.host}`;
}

// Khởi tạo kết nối WebSocket
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
                showToast('❌ Không thể kết nối tới máy chủ Online!');
                reject(err);
            };

            ws.onclose = () => {
                onlineState.connected = false;
                if (isOnlineMode() && onlineState.roomCode) {
                    showToast('⚠️ Mất kết nối tới máy chủ phòng!');
                    updateOnlineRoomBar();
                }
            };
        } catch (e) {
            reject(e);
        }
    });
}

// Xử lý các thông điệp từ Server
function handleOnlineMessage(data) {
    const { type } = data;

    // 1. TẠO PHÒNG THÀNH CÔNG
    if (type === 'ROOM_CREATED') {
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = true;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.guestColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.opponentJoined = false;

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🏠 Đã tạo phòng [${data.roomCode}]! Hãy gửi mã cho bạn bè.`);
        updateOnlineRoomBar();
        return;
    }

    // 2. VÀO PHÒNG THÀNH CÔNG (GUEST)
    if (type === 'ROOM_JOINED') {
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = false;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.hostColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.opponentJoined = true;

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🎉 Đã vào phòng [${data.roomCode}]! Bạn cầm quân [${data.myColor === 'red' ? 'Đỏ' : 'Đen'}].`);
        updateOnlineRoomBar();
        return;
    }

    // 3. ĐỐI THỦ VÀO PHÒNG (HOST NHẬN)
    if (type === 'PLAYER_JOINED') {
        onlineState.opponentJoined = true;
        showToast('👥 ' + (data.message || 'Đối thủ đã tham gia phòng!'));
        updateOnlineRoomBar();
        return;
    }

    // 4. ĐỐI THỦ ĐI QUÂN
    if (type === 'OPPONENT_MOVE') {
        onlineState.currentTurn = data.currentTurn;
        if (data.moveCommand) {
            executeMove(data.moveCommand);
        }
        updateOnlineRoomBar();
        return;
    }

    // 5. CHỦ PHÒNG CẬP NHẬT BÀN CỜ (XẾP QUÂN)
    if (type === 'BOARD_UPDATED') {
        onlineState.currentTurn = data.currentTurn;
        showToast('🛠️ ' + (data.message || 'Chủ phòng đã cập nhật thế cờ mới!'));
        if (data.fen) {
            initGame(data.fen, false);
        }
        updateOnlineRoomBar();
        return;
    }

    // 6. THAY ĐỔI LƯỢT ĐI
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
        return;
    }

    // 7. ĐỔI BÊN
    if (type === 'SIDES_SWAPPED') {
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor;
        showToast('🔄 ' + (data.message || 'Đã hoán đổi bên!'));
        // Tự động lật bàn cờ phù hợp
        state.isBoardFlipped = (onlineState.myColor === 'black');
        if (state.currentSituation) {
            renderBoardFull(state.currentSituation);
        }
        updateOnlineRoomBar();
        return;
    }

    // 8. VÁN MỚI
    if (type === 'GAME_RESET') {
        onlineState.currentTurn = data.currentTurn;
        showToast('🆕 ' + (data.message || 'Ván cờ mới bắt đầu!'));
        initGame(data.fen || START_FEN, true);
        updateOnlineRoomBar();
        return;
    }

    // 9. CHỦ PHÒNG RỜI ĐI
    if (type === 'HOST_LEFT') {
        showToast('🚪 ' + (data.message || 'Chủ phòng đã rời phòng!'));
        onlineState.roomCode = null;
        onlineState.opponentJoined = false;
        updateOnlineRoomBar();
        return;
    }

    // 10. KHÁCH RỜI ĐI
    if (type === 'GUEST_LEFT') {
        showToast('🚪 ' + (data.message || 'Đối thủ đã rời đi. Đang đợi người chơi khác...'));
        onlineState.opponentJoined = false;
        updateOnlineRoomBar();
        return;
    }

    // 11. BÁO LỖI
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

    // CẤM BẬT THẨM / TẮT HOÀN TOÀN ENGINE PIKAFISH
    state.isAnalyzing = false;
    state.aiPlaysRed = false;
    state.aiPlaysBlack = false;
    if (state.engineModule) {
        state.engineModule.sendCommand('stop');
    }

    // Tự động xoay bàn cờ: nếu cầm Đen thì xoay để quân Đen ở dưới
    state.isBoardFlipped = (myColor === 'black');

    await initGame(initialFen || START_FEN, false);
    updateOnlineRoomBar();
}

// Tạo phòng mới
export async function createOnlineRoom(hostColor = 'red') {
    showLoading('Đang tạo phòng...');
    try {
        const ws = await connectOnlineSocket();
        const initialFen = state.currentNode ? state.currentNode.fen : START_FEN;

        ws.send(JSON.stringify({
            type: 'CREATE_ROOM',
            hostColor: hostColor,
            initialFen: initialFen
        }));
    } catch (e) {
        showToast('❌ Lỗi tạo phòng: ' + e.message);
    } finally {
        hideLoading();
    }
}

// Vào phòng bằng mã
export async function joinOnlineRoom(roomCode) {
    const code = String(roomCode || '').trim();
    if (!code) {
        showToast('⚠️ Vui lòng nhập mã phòng!');
        return;
    }

    showLoading('Đang vào phòng...');
    try {
        const ws = await connectOnlineSocket();
        ws.send(JSON.stringify({
            type: 'JOIN_ROOM',
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

    onlineState.ws.send(JSON.stringify({
        type: 'MOVE',
        roomCode: onlineState.roomCode,
        moveCommand: moveCommand,
        newFen: newFen,
        nextTurn: nextTurn
    }));
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
    if (onlineState.ws && onlineState.roomCode) {
        try {
            onlineState.ws.send(JSON.stringify({
                type: 'LEAVE_ROOM',
                roomCode: onlineState.roomCode
            }));
        } catch (e) {}
    }

    onlineState.roomCode = null;
    onlineState.opponentJoined = false;
    showToast('🚪 Đã rời phòng chơi.');

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
    const isMyTurn = (onlineState.myColor === 'red' && isRedTurn) || (onlineState.myColor === 'black' && !isRedTurn);

    const roomCodeEl = document.getElementById('online-bar-roomcode');
    if (roomCodeEl) roomCodeEl.textContent = onlineState.roomCode;

    const myRoleEl = document.getElementById('online-bar-role');
    if (myRoleEl) {
        myRoleEl.textContent = onlineState.isHost ? 'Chủ phòng' : 'Khách';
        myRoleEl.style.color = onlineState.isHost ? '#d97706' : '#2563eb';
    }

    const mySideEl = document.getElementById('online-bar-myside');
    if (mySideEl) {
        if (onlineState.myColor === 'red') {
            mySideEl.innerHTML = '<span style="color: #dc2626; font-weight: bold;">🔴 Quân Đỏ</span>';
        } else {
            mySideEl.innerHTML = '<span style="color: #1f2937; font-weight: bold;">⚫ Quân Đen</span>';
        }
    }

    const oppStatusEl = document.getElementById('online-bar-oppstatus');
    if (oppStatusEl) {
        if (onlineState.opponentJoined) {
            oppStatusEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;">🟢 Đã vào phòng</span>';
        } else {
            oppStatusEl.innerHTML = '<span style="color: #ea580c; font-weight: bold;">⏳ Đang chờ...</span>';
        }
    }

    const turnIndicatorEl = document.getElementById('online-bar-turn');
    if (turnIndicatorEl) {
        if (!onlineState.opponentJoined && onlineState.isHost) {
            turnIndicatorEl.innerHTML = '<span style="color: #ea580c;">Đang chờ bạn vào mã...</span>';
        } else if (isMyTurn) {
            turnIndicatorEl.innerHTML = '<span style="color: #16a34a; font-weight: bold; animation: pulse 1.5s infinite;">👉 TỚI LƯỢT BẠN</span>';
        } else {
            turnIndicatorEl.innerHTML = '<span style="color: #6b7280;">⏳ Đợi đối thủ đi...</span>';
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
}
