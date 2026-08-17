// main.js

window.module = window.module || {};

// Import các Module chính
import { initGame } from './js/game.js';
import { initEvents } from './js/events.js';
import { preloadImages, initCanvas } from './js/board.js';

// Cài đặt Event Toàn cục
initEvents();

// Vòng đời ứng dụng (Khi trang Web tải xong)
window.onload = async () => {
    
    await preloadImages();
    initCanvas();

    // Truyền tham số thứ 2 là 'true' để hệ thống bóc LocalStorage ra dùng
    initGame(undefined, true);
    
    // Lấy thông tin phiên bản từ file Service Worker để in ra Cài đặt
    fetchAppVersion();

    const resizeObserver = new ResizeObserver(() => {
        window.dispatchEvent(new Event('resize'));
    });
    resizeObserver.observe(document.body);
};

// Đăng ký Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(() => { console.log("✅ PWA Ready"); })
        .catch(err => console.log("❌ PWA Error:", err));
    });
}

// Hàm đọc file sw.js để lấy biến CACHE_NAME
function fetchAppVersion() {
    const el = document.getElementById('app-version-text');
    if (!el) return;
    
    fetch('./sw.js')
        .then(response => response.text())
        .then(text => {
            // Tìm dòng chứa CACHE_NAME = '...'
            const match = text.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                el.innerText = `Phiên bản: ${match[1]}`;
            } else {
                el.innerText = `Phiên bản: Không xác định`;
            }
        })
        .catch(err => {
            el.innerText = `Phiên bản: Lỗi đọc SW`;
        });
}