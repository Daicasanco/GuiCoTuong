// js/studio.js
/**
 * STUDIO MODE CONTROLLER & DETERMINISTIC RENDERER
 * Tự động hóa sản xuất video hoạt họa cờ tướng 1080p từ timeline.json
 */

import { state } from './state.js';
import { renderStudioFrame, startStudioCanvasAnimation, setBoardTheme } from './board.js';

class StudioController {
    constructor() {
        this.timeline = null;
        this.events = [];
        this.totalDuration = 300; // Mặc định 5 phút
        this.currentTime = 0;     // Giây thực tế
        this.isPlaying = false;
        this.playbackSpeed = 1.0;
        this.lastRafTimestamp = null;

        // Caching thế cờ tại từng mốc event để nhảy tức thời O(1)
        this.checkpointMap = [];

        // Trạng thái ghi hình MediaRecorder trong trình duyệt
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;

        // Custom arrows đang hiển thị
        this.activeArrows = [];
    }

    async init() {
        console.log('🎬 Khởi chạy Chế độ Studio (Tướng Kỳ Việt Studio)...');
        state.isStudioMode = true;
        document.body.classList.add('studio-mode');

        this.injectUI();
        this.bindEvents();

        // Tự động tải timeline mặc định
        await this.loadDefaultTimeline();

        // Kích hoạt render frame đầu tiên
        this.renderCurrent();
        console.log('✅ Studio Mode đã sẵn sàng!');
    }

    injectUI() {
        const overlay = document.createElement('div');
        overlay.id = 'studio-overlay-container';
        overlay.innerHTML = `
            <div id="studio-top-bar">
                <div class="studio-title-badge" id="studio-title">Kỳ Lý Cờ Tướng</div>
                <div class="studio-sub-badge" id="studio-event-badge">Sự kiện: 0/0</div>
            </div>

            <div id="studio-subtitle-card" style="display: none;"></div>

            <div id="studio-controls">
                <button class="studio-btn" id="btn-studio-play" title="Phát / Tạm dừng">▶ Phát</button>
                <button class="studio-btn" id="btn-studio-rewind" title="Về đầu">⏮ Về đầu</button>
                <input type="range" id="studio-scrubber" min="0" max="300" step="0.05" value="0">
                <div id="studio-time-display">00:00 / 05:00</div>
                <button class="studio-btn" id="btn-studio-speed" title="Tốc độ phát">1.0x</button>
                <button class="studio-btn primary" id="btn-studio-record" title="Quay video WebM trực tiếp trên trình duyệt">🎥 Quay WebM</button>
                <button class="studio-btn" id="btn-studio-hide-ui" title="Ẩn/Hiện thanh điều khiển (Phím H)">👁 Ẩn UI</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    bindEvents() {
        const btnPlay = document.getElementById('btn-studio-play');
        const btnRewind = document.getElementById('btn-studio-rewind');
        const scrubber = document.getElementById('studio-scrubber');
        const btnSpeed = document.getElementById('btn-studio-speed');
        const btnRecord = document.getElementById('btn-studio-record');
        const btnHideUi = document.getElementById('btn-studio-hide-ui');

        if (btnPlay) {
            btnPlay.onclick = () => this.togglePlay();
        }
        if (btnRewind) {
            btnRewind.onclick = () => this.seek(0);
        }
        if (scrubber) {
            scrubber.oninput = (e) => {
                this.seek(parseFloat(e.target.value));
            };
        }
        if (btnSpeed) {
            btnSpeed.onclick = () => {
                const speeds = [0.5, 1.0, 1.5, 2.0, 4.0];
                const curIdx = speeds.indexOf(this.playbackSpeed);
                this.playbackSpeed = speeds[(curIdx + 1) % speeds.length];
                btnSpeed.innerText = `${this.playbackSpeed}x`;
            };
        }
        if (btnRecord) {
            btnRecord.onclick = () => this.toggleInBrowserRecording();
        }
        if (btnHideUi) {
            btnHideUi.onclick = () => this.toggleUI();
        }

        // Phím tắt bàn phím
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlay();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                this.seek(Math.max(0, this.currentTime - 5));
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                this.seek(Math.min(this.totalDuration, this.currentTime + 5));
            } else if (e.key === 'h' || e.key === 'H') {
                this.toggleUI();
            }
        });
    }

    async loadDefaultTimeline() {
        try {
            const res = await fetch('analysis_output/timeline_mvp.json');
            if (res.ok) {
                const data = await res.json();
                this.loadTimeline(data);
                return;
            }
        } catch (e) {
            console.warn('Không tải được timeline_mvp.json qua fetch, sử dụng fallback khởi tạo');
        }

        // Fallback timeline
        this.loadTimeline({
            opening_name: 'Bình Phong Mã đối Ngũ Lục Pháo Tuần Hà Mã',
            total_duration_sec: 300,
            initial_fen: 'r1bakabr1/8c/1cn3n2/p1p1p1R1p/6p2/2P6/P3P1P1P/1C2C1N2/9/RNBAKAB2 b - - 0 1',
            timeline_events: [
                { source_time: 0, action: 'load_fen', note: 'Thế cờ khởi đầu bài giảng' },
                { source_time: 44, action: 'move', uci: 'b2d2', note: 'Đỏ Pháo 2 bình 4' },
                { source_time: 130, action: 'move', uci: 'a9b9', note: 'Đen Xe 1 bình 2' }
            ]
        });
    }

    loadTimeline(timelineData) {
        this.timeline = timelineData;
        const initialFen = timelineData.initial_fen || 'r1bakabr1/8c/1cn3n2/p1p1p1R1p/6p2/2P6/P3P1P1P/1C2C1N2/9/RNBAKAB2 b - - 0 1';
        this.totalDuration = timelineData.meta?.analyzed_duration_sec || timelineData.total_duration_sec || 300;

        // Cập nhật tiêu đề
        const titleEl = document.getElementById('studio-title');
        if (titleEl && timelineData.opening_name) {
            titleEl.innerText = timelineData.opening_name;
        }

        const scrubber = document.getElementById('studio-scrubber');
        if (scrubber) scrubber.max = this.totalDuration;

        // Chuẩn hóa danh sách sự kiện
        this.events = (timelineData.timeline_events || []).map((e, idx) => ({
            id: idx,
            time: typeof e.source_time === 'number' ? e.source_time : 0,
            action: e.action || 'freeze',
            uci: e.uci || null,
            from: e.from || (e.uci ? e.uci.substring(0, 2) : null),
            to: e.to || (e.uci ? e.uci.substring(2, 4) : null),
            color: e.color || 'rgba(230, 81, 0, 0.9)',
            duration: e.duration || (e.duration_ms ? e.duration_ms / 1000 : 2.5),
            animDuration: (e.anim_duration_ms || 350) / 1000,
            note: e.note || '',
            branch: e.branch || 'main'
        })).sort((a, b) => a.time - b.time);

        // Precompute trạng thái FEN tuần tự
        this.precomputeCheckpoints(initialFen);

        this.seek(0);
        console.log(`📋 Đã nạp timeline: ${this.events.length} sự kiện, tổng thời lượng ${this.totalDuration}s`);
    }

    precomputeCheckpoints(initialFen) {
        this.checkpointMap = [];
        let currentFen = initialFen;

        // Khởi tạo checkpoint gốc t=0
        this.checkpointMap.push({
            time: 0,
            fen: currentFen,
            situation: vschess.fenToSituation(currentFen),
            lastMove: null,
            note: 'Bắt đầu bài giảng'
        });

        for (const ev of this.events) {
            if (ev.action === 'load_fen' && ev.fen) {
                currentFen = ev.fen;
            } else if (ev.action === 'move' && ev.uci) {
                try {
                    const nextFen = vschess.fenMovePiece(currentFen, ev.uci);
                    if (nextFen) currentFen = nextFen;
                } catch (err) {
                    console.warn(`Lỗi áp dụng move ${ev.uci} tại t=${ev.time}s:`, err.message);
                }
            }

            this.checkpointMap.push({
                time: ev.time,
                fen: currentFen,
                situation: vschess.fenToSituation(currentFen),
                lastMove: ev.uci || null,
                note: ev.note || ''
            });
        }
    }

    seek(timeSec) {
        this.currentTime = Math.max(0, Math.min(this.totalDuration, timeSec));
        this.renderCurrent();
        this.updateUI();
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.currentTime >= this.totalDuration) this.currentTime = 0;
        this.isPlaying = true;
        this.lastRafTimestamp = performance.now();
        const btnPlay = document.getElementById('btn-studio-play');
        if (btnPlay) btnPlay.innerText = '⏸ Tạm dừng';
        requestAnimationFrame((ts) => this.animationTick(ts));
    }

    pause() {
        this.isPlaying = false;
        const btnPlay = document.getElementById('btn-studio-play');
        if (btnPlay) btnPlay.innerText = '▶ Phát';
    }

    animationTick(timestamp) {
        if (!this.isPlaying) return;

        const delta = (timestamp - this.lastRafTimestamp) / 1000;
        this.lastRafTimestamp = timestamp;

        this.currentTime += delta * this.playbackSpeed;
        if (this.currentTime >= this.totalDuration) {
            this.currentTime = this.totalDuration;
            this.pause();
        }

        this.renderCurrent();
        this.updateUI();

        if (this.isPlaying) {
            requestAnimationFrame((ts) => this.animationTick(ts));
        }
    }

    /**
     * TÍNH TOÁN TRẠNG THÁI VÀ VẼ FRAME TẠI THỜI ĐIỂM CHÍNH XÁC
     */
    renderFrameAtTime(virtualTimeSec) {
        const t = virtualTimeSec;

        // 1. Tìm checkpoint gần nhất đã diễn ra trước hoặc tại t
        let activeCheckpoint = this.checkpointMap[0];
        let nextEvent = null;

        for (let i = 0; i < this.checkpointMap.length; i++) {
            if (this.checkpointMap[i].time <= t) {
                activeCheckpoint = this.checkpointMap[i];
            } else {
                nextEvent = this.events[i - 1]; // Sự kiện sắp tới
                break;
            }
        }

        // Cập nhật FEN & bàn cờ tĩnh
        state.currentSituation = activeCheckpoint.situation;
        state.lastMove = activeCheckpoint.lastMove;

        // 2. Kiểm tra xem có nước đi nào đang trong quá trình trượt (animation) không
        let activeAnimEvent = null;
        for (const ev of this.events) {
            if (ev.action === 'move' && ev.uci) {
                if (t >= ev.time && t < ev.time + ev.animDuration) {
                    activeAnimEvent = ev;
                    break;
                }
            }
        }

        if (activeAnimEvent) {
            // Nước đi đang trượt: khởi tạo animState với virtual time
            const fromIccs = activeAnimEvent.uci.substring(0, 2);
            const toIccs = activeAnimEvent.uci.substring(2, 4);
            const pieceCode = state.currentSituation[vschess.i2s[toIccs]] || state.currentSituation[vschess.i2s[fromIccs]] || 2;
            startStudioCanvasAnimation(
                fromIccs,
                toIccs,
                pieceCode,
                activeAnimEvent.time * 1000,
                activeAnimEvent.animDuration * 1000
            );
        } else {
            state.isAnimating = false;
        }

        // 3. Kiểm tra các mũi tên đang hiển thị tại thời điểm t
        const arrowsToDraw = [];
        for (const ev of this.events) {
            if (ev.action === 'arrow' && ev.uci) {
                if (t >= ev.time && t < ev.time + ev.duration) {
                    const elapsed = t - ev.time;
                    let opacity = 1.0;
                    // Fade in 0.2s, Fade out 0.3s
                    if (elapsed < 0.2) opacity = elapsed / 0.2;
                    else if (elapsed > ev.duration - 0.3) opacity = (ev.duration - elapsed) / 0.3;

                    arrowsToDraw.push({
                        uci: ev.uci,
                        color: ev.color,
                        opacity: opacity,
                        label: ev.note ? '★' : ''
                    });
                }
            }
        }

        // 4. Vẽ frame lên Canvas bằng renderStudioFrame
        renderStudioFrame(t * 1000, arrowsToDraw);

        // 5. Cập nhật ghi chú lời giảng
        const subtitleEl = document.getElementById('studio-subtitle-card');
        if (subtitleEl) {
            if (activeCheckpoint && activeCheckpoint.note && activeCheckpoint.note.trim()) {
                subtitleEl.innerText = activeCheckpoint.note;
                subtitleEl.style.display = 'block';
            } else {
                subtitleEl.style.display = 'none';
            }
        }
    }

    renderCurrent() {
        this.renderFrameAtTime(this.currentTime);
    }

    updateUI() {
        const scrubber = document.getElementById('studio-scrubber');
        if (scrubber && !this.isUserDraggingScrubber) {
            scrubber.value = this.currentTime;
        }

        const timeDisplay = document.getElementById('studio-time-display');
        if (timeDisplay) {
            const curStr = this.formatTime(this.currentTime);
            const totStr = this.formatTime(this.totalDuration);
            timeDisplay.innerText = `${curStr} / ${totStr}`;
        }

        const badge = document.getElementById('studio-event-badge');
        if (badge && this.events) {
            const pastCount = this.events.filter(e => e.time <= this.currentTime).length;
            badge.innerText = `Sự kiện: ${pastCount}/${this.events.length}`;
        }
    }

    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    toggleUI() {
        document.body.classList.toggle('studio-hide-controls');
    }

    /**
     * QUAY VIDEO WEBM TRỰC TIẾP TỪ CANVAS TRÌNH DUYỆT
     */
    toggleInBrowserRecording() {
        if (this.isRecording) {
            this.stopInBrowserRecording();
        } else {
            this.startInBrowserRecording();
        }
    }

    startInBrowserRecording() {
        const canvas = document.getElementById('chess-canvas');
        if (!canvas) return;

        console.log('🎥 Bắt đầu ghi hình Canvas WebM 60fps...');
        this.recordedChunks = [];
        this.isRecording = true;

        const btnRecord = document.getElementById('btn-studio-record');
        if (btnRecord) {
            btnRecord.classList.add('recording');
            btnRecord.innerText = '⏹ Dừng & Lưu';
        }

        const stream = canvas.captureStream(60);
        const options = { mimeType: 'video/webm; codecs=vp9' };

        try {
            this.mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            this.mediaRecorder = new MediaRecorder(stream);
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `video_banco_${Date.now()}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log('💾 Đã lưu file video WebM!');
        };

        this.mediaRecorder.start();

        // Tự động phát từ đầu
        this.seek(0);
        this.play();
    }

    stopInBrowserRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.pause();

        const btnRecord = document.getElementById('btn-studio-record');
        if (btnRecord) {
            btnRecord.classList.remove('recording');
            btnRecord.innerText = '🎥 Quay WebM';
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
    }
}

// KHỞI TẠO SINGLETON & GẮN VÀO WINDOW
export const studio = new StudioController();

if (typeof window !== 'undefined') {
    window.studio = studio;

    // HÀM RENDER XÁC ĐỊNH DÀNH RIÊNG CHO PUPPETEER EXPORT
    window.studioRenderFrame = (virtualTimeMs) => {
        const timeSec = virtualTimeMs / 1000;
        studio.renderFrameAtTime(timeSec);
        return true;
    };

    window.studioGetTotalDuration = () => {
        return studio.totalDuration;
    };

    window.studioLoadTimeline = (data) => {
        studio.loadTimeline(data);
        return true;
    };
}
