// sw.js
const CACHE_NAME = '0.8.9';

const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './main.js',
    './js/config.js',
    './js/state.js',
    './js/ui.js',
    './js/board.js',
    './js/game.js',
    './js/editor.js',
    './js/io.js',
    './js/events.js',
    './js/rules.js',
    './js/db.js',
    './manifest.json',
    './vschess/jquery.js',
    './vschess/vschess.function.js',

    './sql/sql-wasm.js',
    './sql/sql-wasm.wasm',

    './js/localbook.js',
    './js/localbook.worker.js',
    './js/parsers/bin/bin-detector.js',
    './js/database/engine-cache.js',
    './js/database/book-db.js',
    './js/database/game-db.js',

    // FILE DỮ LIỆU DÙNG CHUNG CỦA AI
    './engines/pikafish.data',

    // CÁC BẢN BUILD AI (Được load động bằng Blob Worker)
    './engines/single/pikafish.js',
    './engines/single/pikafish.wasm',

    './engines/single_simd/pikafish.js',
    './engines/single_simd/pikafish.wasm',

    './engines/multi/pikafish.js',
    './engines/multi/pikafish.wasm',
    './engines/multi/pikafish.worker.js',

    './engines/multi_simd/pikafish.js',
    './engines/multi_simd/pikafish.wasm',
    './engines/multi_simd/pikafish.worker.js',

    './engines/multi_simd_relaxed/pikafish.js',
    './engines/multi_simd_relaxed/pikafish.wasm',
    './engines/multi_simd_relaxed/pikafish.worker.js',

    // GIAO DIỆN VÀ ÂM THANH
    './style/board.webp', './style/shadow.webp', './style/dot.webp', './style/from.webp', './style/selection.webp', './style/to.webp',
    './style/br.webp', './style/bn.webp', './style/bb.webp', './style/ba.webp', './style/bk.webp', './style/bc.webp', './style/bp.webp',
    './style/wr.webp', './style/wn.webp', './style/wb.webp', './style/wa.webp', './style/wk.webp', './style/wc.webp', './style/wp.webp',
    './style/blind_b.webp', './style/blind_w.webp',
    './sound/check.mp3', './sound/eat.mp3', './sound/illegal.mp3', './sound/move.mp3', './sound/tuyetsat.mp3',

    // DỮ LIỆU CÁC BÀI TẬP 
    './data/challenge.json',
    './data/manifest.json',

    './data/chien_thuat/001-chieu-tuong-bat-quan.json',
    './data/chien_thuat/002-don-bat-doi.json',
    './data/chien_thuat/003-don-xien-tao.json',
    './data/chien_thuat/004-don-khong-che.json',
    './data/chien_thuat/005-don-vay-khon.json',
    './data/chien_thuat/006-don-ngan-chan.json',
    './data/chien_thuat/007-don-thao-can.json',
    './data/chien_thuat/008-loi-keo-ra-xa.json',
    './data/chien_thuat/009-loi-keo-lai-gan.json',
    './data/chien_thuat/010-Don-don-du.json',
    './data/chien_thuat/011-Don-chuyen-doi.json',
    './data/chien_thuat/012-Don-tac-duong.json',
    './data/chien_thuat/013-Don-pha-hoai.json',
    './data/chien_thuat/014-Don-chuyen-quan.json',
    './data/chien_thuat/015-Don-thi-quan.json',
    './data/chien_thuat/016-Don-bat-quan.json',
    './data/chien_thuat/manifest.json',

    './data/co_the/001-Thich-tinh-nha-thu-p1.json',
    './data/co_the/002-Thich-tinh-nha-thu-p2.json',
    './data/co_the/003-Thich-tinh-nha-thu-p3.json',
    './data/co_the/004-The-co-thu-vi.json',
    './data/co_the/manifest.json',

    './data/sat_phap/001-nuoc-sat-xe-phao-ma-tot.json',
    './data/sat_phap/002-sat-phap-co-ban-27-kieu.json',
    './data/sat_phap/003-Tuong-ky-sat-phap-can-ban.json',
    './data/sat_phap/004-Thuc-chien-sat-cuc.json',
    './data/sat_phap/005-Tuong-ky-sat-the.json',
    './data/sat_phap/006-Sat-cuc-bao-dien.json',
    './data/sat_phap/007-kiem-tra-suc-co.json',
    './data/sat_phap/manifest.json',

    './data/sat_phap/1_den_20_nuoc_lien_sat/001-1-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/002-2-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/003-3-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/004-4-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/005-5-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/006-6-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/007-7-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/008-8-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/009-9-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/010-10-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/011-11-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/012-12-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/013-13-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/014-14-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/015-15-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/016-16-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/017-17-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/018-18-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/019-19-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/020-20-nuoc-het-co.json',
    './data/sat_phap/1_den_20_nuoc_lien_sat/manifest.json',

    './data/sat_phap/3712_bai_sat_phap_co_ban/001-3712-bai-sat-phap-co-ban-(phan-1).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/002-3712-bai-sat-phap-co-ban-(phan-2).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/003-3712-bai-sat-phap-co-ban-(phan-3).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/004-3712-bai-sat-phap-co-ban-(phan-4).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/005-3712-bai-sat-phap-co-ban-(phan-5).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/006-3712-bai-sat-phap-co-ban-(phan-6).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/007-3712-bai-sat-phap-co-ban-(phan-7).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/008-3712-bai-sat-phap-co-ban-(phan-8).json',
    './data/sat_phap/3712_bai_sat_phap_co_ban/manifest.json',

    './data/tan_cuc/001-co_tan_tot.json',
    './data/tan_cuc/002-co_tan_ma.json',
    './data/tan_cuc/003-co_tan_hai_ma.json',
    './data/tan_cuc/004-co_tan_ma_tot.json',
    './data/tan_cuc/005-co_tan_phao.json',
    './data/tan_cuc/006-co_tan_phao_tot.json',
    './data/tan_cuc/007-co_tan_hai_phao.json',
    './data/tan_cuc/008-co_tan_phao_ma.json',
    './data/tan_cuc/009-co_tan_xe.json',
    './data/tan_cuc/010-co_tan_xe_tot.json',
    './data/tan_cuc/011-xe_phao_si_tuong_thang_xe_2_tuong.json',
    './data/tan_cuc/012-Tan-cuc-bao-dien.json',
    './data/tan_cuc/013-Tan-cuc-thuc-chien.json',
    './data/tan_cuc/016-tan_cuc_phi_tieu.json',
    './data/tan_cuc/017-tuong_ky_tan_cuc_sat_the.json',
    './data/tan_cuc/018-ki_xao_cong_sat_co_tan.json',
    './data/tan_cuc/019-sat-chuoc-dai-toan-p1.json',
    './data/tan_cuc/020-sat-chuoc-dai-toan-p2.json',
    './data/tan_cuc/021-sat-chuoc-dai-toan-p3.json',
    './data/tan_cuc/022-co_tan_cong_sat_p1.json',
    './data/tan_cuc/023-co_tan_cong_sat_p2.json',
    './data/tan_cuc/manifest.json',

    './data/tan_cuc/chuyen_tap/001-xe_ma_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/002-phao_tot_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/003-ma_tot_chuyen_tap.json',
    './data/tan_cuc/chuyen_tap/manifest.json',

    './data/tan_cuc/co_tan_thuc_dung/001-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/002-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/003-co_tan_thuc_dung.json',
    './data/tan_cuc/co_tan_thuc_dung/manifest.json',

    './data/trung_cuc/001-Chien-thuat-trung-cuc-co-ban.json',
    './data/trung_cuc/002-Trung-cuc-sat-phap.json',
    './data/trung_cuc/003-Trung-cuc-dieu-thu.json',
    './data/trung_cuc/004-Trung-cuc-tinh-dieu-chien-phap.json',
    './data/trung_cuc/005-Trung-cuc-thuc-chien.json',
    './data/trung_cuc/006-Trung-tan-kinh-dien.json',
    './data/trung_cuc/007-Trung-tan-thuc-chien-p1.json',
    './data/trung_cuc/008-Trung-tan-thuc-chien-p2.json',
    './data/trung_cuc/manifest.json'
];

self.addEventListener('install', (event) => {
    console.log('[Service Worker] Đang cài đặt và lưu trữ Cache...');
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // SỬA LỖI TREO APP: Tải từng file, lỗi file nào bỏ qua file đó!
            return Promise.all(
                urlsToCache.map(url => {
                    return cache.add(url).catch(err => {
                        console.warn('[SW] Không thể cache file (Bỏ qua):', url);
                    });
                })
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/')) return;
    if (event.request.url.startsWith('chrome-extension://')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return networkResponse;
            }).catch((err) => {
                console.log('[Service Worker] Lỗi mạng:', event.request.url, err);
                throw err;
            });
        })
    );
});