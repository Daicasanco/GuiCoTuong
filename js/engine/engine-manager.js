// js/engine/engine-manager.js
// Bộ quản lý vòng đời và cấu hình tham số cho Engine Pikafish.

import { UCIParser } from './uci.js';

export class EngineManager {
    constructor() {
        this.currentWasmType = null;
        this.currentEngineInstance = null;
        this.engineModule = null;
        this.isSearching = false;
        this.fallbackTriggered = false;
        this.outputCallbacks = [];
        this.readyCallbacks = [];
    }

    // 1. Nhận diện cấu hình phần cứng thiết bị
    getDeviceTier() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) return 'PC';

        let ram = navigator.deviceMemory || 0;
        if (ram === 0) {
            const cores = navigator.hardwareConcurrency || 2;
            ram = cores >= 6 ? 6 : 4; 
        }

        if (ram < 6) return 'MOBILE_LOW';
        return 'MOBILE_HIGH';
    }

    // 2. Kiểm tra tính năng SharedArrayBuffer (Đa luồng)
    checkThreads() {
        try {
            return typeof SharedArrayBuffer !== 'undefined';
        } catch (e) {
            return false;
        }
    }

    // 3. Kiểm tra tập lệnh SIMD
    async checkSIMD() {
        try {
            const simdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]);
            return await WebAssembly.validate(simdWasm);
        } catch (e) { 
            return false; 
        }
    }

    // 4. Kiểm tra Relaxed SIMD (Dành cho PC)
    async checkRelaxedSIMD() {
        try {
            const relaxedSimdWasm = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]);
            return await WebAssembly.validate(relaxedSimdWasm);
        } catch (e) { 
            return false; 
        }
    }

    // 5. Chọn phiên bản engine tốt nhất
    async getBestEngineType() {
        const tier = this.getDeviceTier();
        const threads = this.checkThreads();
        const simd = await this.checkSIMD();
        let relaxedSimd = false;

        if (tier === 'PC') {
            relaxedSimd = await this.checkRelaxedSIMD();
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

    // 6. Đăng ký nhận kết quả đầu ra
    onOutput(callback) {
        this.outputCallbacks.push(callback);
    }

    onReady(callback) {
        this.readyCallbacks.push(callback);
    }

    // 7. Khởi tạo Pikafish
    async init(forceType = null) {
        const type = forceType || await this.getBestEngineType();
        this.currentWasmType = type;
        const basePath = window.location.href.replace(/\/[^\/]*$/, '');

        // Tránh tải đúp
        this.terminate();

        // PHÂN LUỒNG A: Bản Multi-threaded (Tải trên main thread)
        if (type.includes("multi")) {
            return new Promise((resolve, reject) => {
                const scriptUrl = `${basePath}/engines/${type}/pikafish.js`;
                const script = document.createElement('script');
                script.src = scriptUrl;
                script.onload = () => {
                    window.Pikafish({
                        locateFile: (path) => {
                            return path.endsWith('.data') ? `${basePath}/engines/${path}` : `${basePath}/engines/${type}/${path}`;
                        },
                        onReceiveStdout: (text) => this.handleOutput(text),
                        print: (text) => this.handleOutput(text),
                        ALLOW_MEMORY_GROWTH: true
                    }).then((module) => {
                        this.currentEngineInstance = module;
                        this.engineModule = {
                            sendCommand: (cmd) => {
                                if (typeof module.send_command === 'function') module.send_command(cmd);
                                else if (typeof module.sendCommand === 'function') module.sendCommand(cmd);
                            }
                        };
                        this.readyCallbacks.forEach(cb => cb(type));
                        resolve(type);
                    }).catch(err => {
                        reject(err);
                    });
                };
                script.onerror = (err) => reject("Lỗi load script Multi: " + err);
                document.head.appendChild(script);
            });
        }
        // PHÂN LUỒNG B: Bản Single-threaded (Chạy qua Web Worker để tránh CORS)
        else {
            return new Promise((resolve) => {
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
                            try {
                                self.importScripts(scriptToLoad);
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

                const blob = new Blob([workerScript], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                const engineWorker = new Worker(blobUrl);
                URL.revokeObjectURL(blobUrl);

                this.currentEngineInstance = engineWorker;
                this.engineModule = {
                    sendCommand: (cmd) => {
                        engineWorker.postMessage({ command: cmd });
                    }
                };

                engineWorker.onmessage = (e) => {
                    if (e.data.ready) {
                        this.readyCallbacks.forEach(cb => cb(type));
                        resolve(type);
                    } else if (e.data.stdout) {
                        this.handleOutput(e.data.stdout);
                    } else if (e.data.error) {
                        console.error("[Engine Worker Error]:", e.data.error);
                    }
                };

                engineWorker.postMessage({ wasm_type: type, basePath: basePath });
            });
        }
    }

    // 8. Nhận dữ liệu đầu ra từ Engine stdout
    handleOutput(text) {
        const parsed = UCIParser.parseLine(text);
        if (parsed) {
            if (parsed.type === 'bestmove') {
                this.isSearching = false;
            }
            this.outputCallbacks.forEach(cb => cb(parsed, text));
        }
    }

    // 9. Gửi lệnh UCI tùy chỉnh
    sendCommand(cmd) {
        if (this.engineModule) {
            this.engineModule.sendCommand(cmd);
        }
    }

    // 10. Bắt đầu tìm kiếm/phân tích hình cờ
    startSearch(fen, options = {}) {
        if (!this.engineModule) return;

        // Dừng tìm kiếm cũ nếu đang chạy
        this.stopSearch();

        const threads = options.threads || 1;
        const hash = options.hash || 64;
        const multipv = options.multipv || 1;
        const skill = options.skill !== undefined ? options.skill : 20;

        // Cập nhật cấu hình uci
        this.sendCommand(`setoption name Threads value ${threads}`);
        this.sendCommand(`setoption name Hash value ${hash}`);
        this.sendCommand(`setoption name MultiPV value ${multipv}`);
        this.sendCommand(`setoption name Skill Level value ${skill}`);
        
        // Thiết lập thế cờ và phát lệnh phân tích
        this.sendCommand(`position fen ${fen}`);
        
        if (options.movetime) {
            this.sendCommand(`go movetime ${options.movetime}`);
        } else if (options.depth) {
            this.sendCommand(`go depth ${options.depth}`);
        } else {
            this.sendCommand(`go infinite`);
        }
        
        this.isSearching = true;
    }

    // 11. Dừng tìm kiếm
    stopSearch() {
        if (!this.isSearching) return;

        // Quirk xử lý: Web Worker chạy đơn luồng bị block không nhận lệnh -> Ta hủy và tạo lại
        if (this.currentEngineInstance instanceof Worker) {
            this.terminate();
            this.isSearching = false;
            this.init(this.currentWasmType);
        } else if (this.engineModule) {
            this.sendCommand("stop");
            this.isSearching = false;
        }
    }

    // 12. Hủy hoàn toàn Engine
    terminate() {
        if (this.currentEngineInstance) {
            if (typeof this.currentEngineInstance.terminate === 'function') {
                this.currentEngineInstance.terminate(); // Đối với Web Worker
            }
            this.currentEngineInstance = null;
        }
        this.engineModule = null;
        this.isSearching = false;
    }
}
