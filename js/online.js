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
    opponentConnected: false,
    ws: null,
    // Voice chat & WebRTC
    isMicActive: false,
    localStream: null,
    peerConnection: null,
    // Chat UI state
    unreadChatCount: 0
};

// Lấy hoặc tạo UID cố định của người dùng trong trình duyệt
export function getOrCreateUserId() {
    let uid = localStorage.getItem('tuongky_online_uid');
    if (!uid) {
        uid = 'u_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        localStorage.setItem('tuongky_online_uid', uid);
    }
    return uid;
}

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

                // Nếu đang có phòng cờ dở dang (ví dụ vừa bị rớt mạng hoặc F5), tự động gửi yêu cầu tái kết nối
                const savedRoom = sessionStorage.getItem('tuongky_active_room') || onlineState.roomCode;
                if (savedRoom) {
                    console.log(`🔄 [Online] Đang tự động kết nối lại vào phòng [${savedRoom}]...`);
                    ws.send(JSON.stringify({
                        type: 'JOIN_ROOM',
                        roomCode: savedRoom,
                        userId: getOrCreateUserId()
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
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.guestColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

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
        onlineState.opponentConnected = true;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🎉 Đã vào phòng [${data.roomCode}]! Bạn cầm quân [${data.myColor === 'red' ? 'Đỏ' : 'Đen'}].`);
        updateOnlineRoomBar();
        return;
    }

    // 3. TÁI KẾT NỐI VÀO PHÒNG THÀNH CÔNG (RECONNECTED SAU KHI RỚT MẠNG / F5)
    if (type === 'ROOM_RECONNECTED') {
        onlineState.roomCode = data.roomCode;
        onlineState.isHost = !!data.isHost;
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor;
        onlineState.currentTurn = data.currentTurn;
        onlineState.opponentJoined = !!data.opponentJoined;
        onlineState.opponentConnected = !!data.opponentJoined;
        sessionStorage.setItem('tuongky_active_room', data.roomCode);

        enterOnlineGame(data.fen, data.myColor);
        closeModal('online-room-modal');
        showToast(`🔄 Đã kết nối lại phòng [${data.roomCode}]! Ván cờ tiếp tục.`);
        updateOnlineRoomBar();
        return;
    }

    // 4. ĐỐI THỦ VÀO PHÒNG (HOST NHẬN)
    if (type === 'PLAYER_JOINED') {
        onlineState.opponentJoined = true;
        onlineState.opponentConnected = true;
        showToast('👥 ' + (data.message || 'Đối thủ đã tham gia phòng!'));
        updateOnlineRoomBar();
        return;
    }

    // 5. ĐỐI THỦ TẠM THỜI MẤT MẠNG (ĐANG CHỜ 90S)
    if (type === 'PLAYER_DISCONNECTED') {
        onlineState.opponentConnected = false;
        showToast('⏳ ' + (data.message || 'Đối thủ tạm mất mạng, đang chờ 90s...'));
        updateOnlineRoomBar();
        return;
    }

    // 6. ĐỐI THỦ ĐÃ KẾT NỐI LẠI THÀNH CÔNG
    if (type === 'PLAYER_RECONNECTED') {
        onlineState.opponentConnected = true;
        onlineState.opponentJoined = true;
        showToast('🟢 ' + (data.message || 'Đối thủ đã kết nối lại phòng!'));
        updateOnlineRoomBar();
        return;
    }

    // 7. ĐƯỢC CHUYỂN QUYỀN CHỦ PHÒNG (TRONG PHÒNG CỐ ĐỊNH 013579)
    if (type === 'PROMOTED_TO_HOST') {
        onlineState.isHost = true;
        showToast('👑 ' + (data.message || 'Bạn đã trở thành Chủ phòng mới!'));
        updateOnlineRoomBar();
        return;
    }

    // 8. ĐỐI THỦ ĐI QUÂN
    if (type === 'OPPONENT_MOVE') {
        onlineState.currentTurn = data.currentTurn;
        if (data.moveCommand) {
            executeMove(data.moveCommand);
        }
        updateOnlineRoomBar();
        return;
    }

    // 9. CHỦ PHÒNG CẬP NHẬT BÀN CỜ (XẾP QUÂN)
    if (type === 'BOARD_UPDATED') {
        onlineState.currentTurn = data.currentTurn;
        showToast('🛠️ ' + (data.message || 'Chủ phòng đã cập nhật thế cờ mới!'));
        if (data.fen) {
            initGame(data.fen, false);
        }
        updateOnlineRoomBar();
        return;
    }

    // 10. THAY ĐỔI LƯỢT ĐI
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

    // 11. ĐỔI BÊN
    if (type === 'SIDES_SWAPPED') {
        onlineState.myColor = data.myColor;
        onlineState.opponentColor = data.opponentColor;
        showToast('🔄 ' + (data.message || 'Đã hoán đổi bên!'));
        state.isBoardFlipped = (onlineState.myColor === 'black');
        if (state.currentSituation) {
            renderBoardFull(state.currentSituation);
        }
        updateOnlineRoomBar();
        return;
    }

    // 12. VÁN MỚI
    if (type === 'GAME_RESET') {
        onlineState.currentTurn = data.currentTurn || 'w';
        showToast('🆕 ' + (data.message || 'Ván cờ mới bắt đầu!'));
        initGame(data.fen || START_FEN, false).then(() => {
            state.isBoardFlipped = (onlineState.myColor === 'black');
            if (state.currentSituation) {
                renderBoardFull(state.currentSituation);
            }
            updateTurnToggleUI();
            updateOnlineRoomBar();
        });
        return;
    }

    // 13. CHỦ PHÒNG RỜI ĐI HẲN
    if (type === 'HOST_LEFT') {
        showToast('🚪 ' + (data.message || 'Chủ phòng đã rời phòng!'));
        sessionStorage.removeItem('tuongky_active_room');
        onlineState.roomCode = null;
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        document.body.classList.remove('mode-online');
        stopVoiceChat();
        updateOnlineRoomBar();
        return;
    }

    // 14. KHÁCH RỜI ĐI HẲN
    if (type === 'GUEST_LEFT') {
        showToast('🚪 ' + (data.message || 'Đối thủ đã rời đi. Đang đợi người chơi khác...'));
        onlineState.opponentJoined = false;
        onlineState.opponentConnected = false;
        stopVoiceChat();
        updateOnlineRoomBar();
        return;
    }

    // 15. TIN NHẮN CHAT MỚI
    if (type === 'CHAT_MESSAGE') {
        appendChatMessage(data);
        return;
    }

    // 16. WEBRTC SIGNALING RELAY (VOICE CHAT)
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

    // 17. BÁO LỖI
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
            userId: getOrCreateUserId(),
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
    onlineState.roomCode = null;
    onlineState.opponentJoined = false;
    onlineState.opponentConnected = false;
    document.body.classList.remove('mode-online');
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
            mySideEl.innerHTML = '<span style="color: #dc2626; font-weight: bold;">🔴 Đỏ</span>';
        } else {
            mySideEl.innerHTML = '<span style="color: #1f2937; font-weight: bold;">⚫ Đen</span>';
        }
    }

    const oppStatusEl = document.getElementById('online-bar-oppstatus');
    if (oppStatusEl) {
        if (onlineState.opponentJoined && onlineState.opponentConnected) {
            oppStatusEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;">🟢 Đã vào</span>';
        } else if (onlineState.opponentJoined && !onlineState.opponentConnected) {
            oppStatusEl.innerHTML = '<span style="color: #ef4444; font-weight: bold;">⏳ Rớt mạng (90s)</span>';
        } else {
            oppStatusEl.innerHTML = '<span style="color: #ea580c; font-weight: bold;">⏳ Đang chờ</span>';
        }
    }

    const turnIndicatorEl = document.getElementById('online-bar-turn');
    if (turnIndicatorEl) {
        if (!onlineState.opponentJoined && onlineState.isHost) {
            turnIndicatorEl.innerHTML = '<span style="color: #ea580c;">⏳ Chờ khách...</span>';
        } else if (isMyTurn) {
            turnIndicatorEl.innerHTML = '<span style="color: #16a34a; font-weight: bold;">👉 LƯỢT BẠN</span>';
        } else {
            turnIndicatorEl.innerHTML = '<span style="color: #64748b;">⏳ Đợi đối thủ</span>';
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
        text: msg
    }));
}

function appendChatMessage(data) {
    const chatMessages = document.getElementById('online-chat-messages');
    if (!chatMessages) return;

    const isMine = (data.senderRole === (onlineState.isHost ? 'host' : 'guest'));
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isMine ? 'mine' : 'theirs'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = data.text;

    const info = document.createElement('div');
    info.className = 'chat-msg-info';
    info.textContent = `${isMine ? 'Bạn' : data.senderName} • ${data.time || ''}`;

    row.appendChild(bubble);
    row.appendChild(info);
    chatMessages.appendChild(row);

    scrollChatToBottom();

    // Nếu hộp chat đang đóng và người gửi là đối thủ -> hiển thị badge số tin chưa đọc
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
// TÍNH NĂNG VOICE CHAT / MICROPHONE (WEBRTC AUDIO P2P)
// ============================================================

const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

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

    // Thông báo cho đối thủ trạng thái mic
    sendVoiceStatus(true);

    // Nếu là chủ phòng (hoặc người chủ động gọi), tạo offer
    createAndSendWebRTCOffer();
}

function initPeerConnection() {
    if (onlineState.peerConnection) return;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    onlineState.peerConnection = pc;

    // Khi nhận được âm thanh từ đối thủ
    pc.ontrack = (event) => {
        const remoteAudio = document.getElementById('online-remote-audio');
        if (remoteAudio && event.streams && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play().catch(e => console.warn('[Voice] Tự động phát âm thanh bị chặn:', e));
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
        console.log(`[Voice] WebRTC ICE State: ${pc.iceConnectionState}`);
    };
}

async function createAndSendWebRTCOffer() {
    if (!onlineState.peerConnection || !onlineState.ws) return;

    try {
        const offer = await onlineState.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        await onlineState.peerConnection.setLocalDescription(offer);

        onlineState.ws.send(JSON.stringify({
            type: 'WEBRTC_OFFER',
            roomCode: onlineState.roomCode,
            offer: offer
        }));
    } catch (e) {
        console.error('[Voice] Lỗi tạo Offer:', e);
    }
}

async function handleWebRTCOffer(data) {
    if (!data.offer) return;
    initPeerConnection();

    try {
        await onlineState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

        // Nếu đối thủ gửi offer mà mình chưa mở mic, vẫn có thể nhận nghe âm thanh của họ
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
        console.error('[Voice] Lỗi xử lý Offer:', e);
    }
}

async function handleWebRTCAnswer(data) {
    if (!data.answer || !onlineState.peerConnection) return;
    try {
        await onlineState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (e) {
        console.error('[Voice] Lỗi xử lý Answer:', e);
    }
}

async function handleWebRTCIce(data) {
    if (!data.candidate || !onlineState.peerConnection) return;
    try {
        await onlineState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
        console.error('[Voice] Lỗi thêm ICE Candidate:', e);
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
    if (data.isMicActive) {
        showToast('🎙️ Đối thủ đã bật Microphone đàm thoại.');
    } else {
        showToast('🔇 Đối thủ đã tắt Microphone.');
    }
}

function stopVoiceChat() {
    onlineState.isMicActive = false;

    if (onlineState.localStream) {
        onlineState.localStream.getTracks().forEach(track => track.stop());
        onlineState.localStream = null;
    }

    if (onlineState.peerConnection) {
        onlineState.peerConnection.close();
        onlineState.peerConnection = null;
    }

    const remoteAudio = document.getElementById('online-remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }

    sendVoiceStatus(false);
}

// Kiểm tra và khôi phục phòng nếu người chơi tải lại trang (F5)
export function checkAndResumeSavedRoom() {
    const savedRoom = sessionStorage.getItem('tuongky_active_room');
    if (savedRoom) {
        console.log(`🔄 [Online] Phát hiện phòng cũ [${savedRoom}]. Đang kết nối lại...`);
        connectOnlineSocket().catch(e => console.warn('[Online] Chưa thể kết nối lại ngay:', e));
    }
}
