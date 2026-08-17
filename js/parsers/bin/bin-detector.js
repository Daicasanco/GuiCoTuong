// js/parsers/bin/bin-detector.js
// Bộ nhận diện định dạng file nhị phân (SQLite OBK, Polyglot, CCBridge, XQF).

class BinBookDetector {
    // Phân tích một mảng ArrayBuffer/Uint8Array và phát hiện định dạng
    static detect(buffer) {
        if (!buffer || buffer.length === 0) {
            return { format: 'unknown', confidence: 0, description: 'File trống hoặc không hợp lệ' };
        }

        const view = new Uint8Array(buffer.buffer || buffer);

        // 1. Kiểm tra SQLite format 3 (OBK / PFBOOK / XQB)
        // Chuỗi: "SQLite format 3\0" (16 bytes)
        const sqliteHeader = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
        let isSqlite = true;
        for (let i = 0; i < 16; i++) {
            if (view[i] !== sqliteHeader[i]) {
                isSqlite = false;
                break;
            }
        }
        if (isSqlite) {
            return {
                format: 'sqlite',
                confidence: 1.0,
                description: 'Định dạng SQLite Database (Binghe OBK / Pikafish Book)'
            };
        }

        // 2. Kiểm tra CCBridge Library (.cbl)
        // Chuỗi: "CCBridgeLibrary" (15 bytes: 43 43 42 72 69 64 67 65 4c 69 62 72 61 72 79)
        const cblHeader = "43434272696467654c696272617279";
        if (this.matchHex(view, 0, 15) === cblHeader) {
            return {
                format: 'cbl',
                confidence: 1.0,
                description: 'Định dạng thư viện cờ tướng CCBridge (.cbl)'
            };
        }

        // 3. Kiểm tra CCBridge Record (.cbr)
        // Chuỗi: "CCBridge Record" (15 bytes: 43 43 42 72 69 64 67 65 20 52 65 63 6f 72 64)
        const cbrHeader = "4343427269646765205265636f7264";
        if (this.matchHex(view, 0, 15) === cbrHeader) {
            return {
                format: 'cbr',
                confidence: 1.0,
                description: 'Định dạng biên bản cờ tướng CCBridge (.cbr)'
            };
        }

        // 4. Kiểm tra định dạng XQF (.xqf)
        // 2 byte đầu là "Q2" (0x51, 0x32)
        if (view.length > 1024 && view[0] === 0x51 && view[1] === 0x32) {
            return {
                format: 'xqf',
                confidence: 1.0,
                description: 'Định dạng biên bản cờ tướng XQF (.xqf)'
            };
        }

        // 5. Kiểm tra định dạng Polyglot (.bin)
        // Kích thước tệp phải chia hết cho 16 bytes và tối thiểu 16 bytes
        if (view.length >= 16 && view.length % 16 === 0) {
            // Thực hiện kiểm tra phân bổ dữ liệu (đặc biệt là 2 byte move & 2 byte weight)
            let validRecords = 0;
            const recordsToCheck = Math.min(10, Math.floor(view.length / 16));
            for (let i = 0; i < recordsToCheck; i++) {
                const offset = i * 16;
                // Lấy weight (offset + 10, 2 bytes)
                const weight = (view[offset + 10] << 8) | view[offset + 11];
                // Lấy move (offset + 8, 2 bytes)
                const move = (view[offset + 8] << 8) | view[offset + 9];
                
                // Trọng số thường > 0 và không quá lớn, nước đi phải khác 0
                if (weight >= 0 && move > 0) {
                    validRecords++;
                }
            }

            if (validRecords === recordsToCheck) {
                return {
                    format: 'polyglot',
                    confidence: 0.9,
                    description: 'Định dạng sách khai cuộc Polyglot (.bin)'
                };
            }
        }

        return {
            format: 'unknown',
            confidence: 0.1,
            description: 'Định dạng nhị phân không xác định'
        };
    }

    // Helper: Trích xuất chuỗi hex từ mảng byte để so sánh chữ ký
    static matchHex(view, start, length) {
        let hex = '';
        for (let i = start; i < start + length; i++) {
            if (i >= view.length) break;
            let h = view[i].toString(16);
            if (h.length === 1) h = '0' + h;
            hex += h;
        }
        return hex;
    }
}

// UMD/Hybrid assignment
if (typeof self !== 'undefined') {
    self.BinBookDetector = BinBookDetector;
}
if (typeof window !== 'undefined') {
    window.BinBookDetector = BinBookDetector;
}
if (typeof globalThis !== 'undefined') {
    globalThis.BinBookDetector = BinBookDetector;
}
if (typeof exports !== 'undefined') {
    exports.BinBookDetector = BinBookDetector;
}
