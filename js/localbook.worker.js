// js/localbook.worker.js
importScripts('../sql/sql-wasm.js');

let db = null;
let dbType = null; 

// 1. ZOBRIST UTILS
const c90 = [51, 52, 53, 54, 55, 56, 57, 58, 59, 67, 68, 69, 70, 71, 72, 73, 74, 75, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 101, 102, 103, 104, 105, 106, 107, 115, 116, 117, 118, 119, 120, 121, 122, 123, 131, 132, 133, 134, 135, 136, 137, 138, 139, 147, 148, 149, 150, 151, 152, 153, 154, 155, 163, 164, 165, 166, 167, 168, 169, 170, 171, 179, 180, 181, 182, 183, 184, 185, 186, 187, 195, 196, 197, 198, 199, 200, 201, 202, 203];
const san90 = ["a9", "b9", "c9", "d9", "e9", "f9", "g9", "h9", "i9", "a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8", "i8", "a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "i7", "a6", "b6", "c6", "d6", "e6", "f6", "g6", "h6", "i6", "a5", "b5", "c5", "d5", "e5", "f5", "g5", "h5", "i5", "a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4", "i4", "a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3", "i3", "a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "i2", "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "i1", "a0", "b0", "c0", "d0", "e0", "f0", "g0", "h0", "i0"];
const pieces = {'K':0, 'A':1, 'B':2, 'N':3, 'R':4, 'C':5, 'P':6, 'k':7, 'a':8, 'b':9, 'n':10, 'r':11, 'c':12, 'p':13};
const zobristPlayer = -6859497933297602728n;

const zobristTable = [];
(function initZobrist() {
    const rawLines = zobristString.split(',');
    for (let line of rawLines) {
        let cleaned = line.trim().replace('L', '');
        if (cleaned) zobristTable.push(BigInt(cleaned));
    }
})();

function getZobristFromBoard(fenBoard, isRedGo, isMirrored) {
    let key = 0n;
    let rank = 0;
    let file = 0;

    for (let i = 0; i < fenBoard.length; i++) {
        let char = fenBoard[i];
        if (char === '/') {
            rank++;
            file = 0;
        } else if (char >= '1' && char <= '9') {
            file += parseInt(char);
        } else if (pieces[char] !== undefined) {
            let actualFile = isMirrored ? (8 - file) : file;
            let cIndex = rank * 9 + actualFile;
            let sq90 = c90[cIndex];
            let pType = pieces[char];
            let index = sq90 * 14 + pType;

            key ^= zobristTable[index];
            file++;
        }
    }

    if (isRedGo) key ^= zobristPlayer;
    return key;
}

function rotateAndSwapFen(fenBoard) {
    let rows = fenBoard.split('/');
    let newRows = [];

    for (let r = 9; r >= 0; r--) {
        let rowStr = rows[r];
        let expanded = [];
        for (let char of rowStr) {
            if (char >= '1' && char <= '9') {
                let count = parseInt(char);
                for (let k = 0; k < count; k++) expanded.push('.');
            } else {
                expanded.push(char);
            }
        }
        
        expanded.reverse();

        let swapped = expanded.map(char => {
            if (char === '.') return '.';
            return char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();
        });

        let compressed = "";
        let emptyCount = 0;
        for (let char of swapped) {
            if (char === '.') {
                emptyCount++;
            } else {
                if (emptyCount > 0) {
                    compressed += emptyCount;
                    emptyCount = 0;
                }
                compressed += char;
            }
        }
        if (emptyCount > 0) compressed += emptyCount;
        newRows.push(compressed);
    }

    return newRows.join('/');
}

function rotateMove(sanMove) {
    if (!sanMove || sanMove.length < 4) return sanMove;
    
    let from = sanMove.substring(0, 2);
    let to = sanMove.substring(2, 4);

    function rotateSquare(sq) {
        let file = sq.charCodeAt(0) - 97; 
        let rank = parseInt(sq.charAt(1));
        
        let newFile = 8 - file;
        let newRank = 9 - rank;

        return String.fromCharCode(97 + newFile) + newRank;
    }

    return rotateSquare(from) + rotateSquare(to);
}

function getXqbKey(fen) {
    let board = new Array(90).fill(0);
    let parts = fen.split(" ");
    let fenBoard = parts[0];
    let isRedGo = parts[1] === 'w';

    let rank = 0;
    let file = 0;
    for (let i = 0; i < fenBoard.length; i++) {
        let char = fenBoard[i];
        if (char === '/') {
            rank++;
            file = 0;
        } else if (char >= '1' && char <= '9') {
            file += parseInt(char);
        } else {
            let sq90 = rank * 9 + file;
            let pieceVal = 0;
            switch(char) {
                case 'R': pieceVal = 1; break; case 'N': pieceVal = 2; break; case 'B': pieceVal = 3; break; case 'A': pieceVal = 4; break; case 'K': pieceVal = 5; break; case 'C': pieceVal = 6; break; case 'P': pieceVal = 7; break;
                case 'r': pieceVal = 8; break; case 'n': pieceVal = 9; break; case 'b': pieceVal = 10; break; case 'a': pieceVal = 11; break; case 'k': pieceVal = 12; break; case 'c': pieceVal = 13; break; case 'p': pieceVal = 14; break;
            }
            board[sq90] = pieceVal;
            file++;
        }
    }

    let byteString = "";
    for (let i = 0; i < 90; i++) {
        byteString += String.fromCharCode(board[i]);
    }
    byteString += isRedGo ? "w" : "b";

    let hash = 0;
    for (let i = 0; i < byteString.length; i++) {
        hash = (hash * 31 + byteString.charCodeAt(i)) & 0xFFFFFFFF;
    }
    
    let hex = (hash >>> 0).toString(16).padStart(8, '0');
    return hex;
}

function parseXqbMove(moveVal) {
    let fromSq = (moveVal >> 8) & 0xFF;
    let toSq = moveVal & 0xFF;
    
    let fromFile = String.fromCharCode(97 + (fromSq % 9));
    let fromRank = (9 - Math.floor(fromSq / 9)).toString();
    let toFile = String.fromCharCode(97 + (toSq % 9));
    let toRank = (9 - Math.floor(toSq / 9)).toString();
    
    return fromFile + fromRank + toFile + toRank;
}

function parseZobristMove(srcIndex, dstIndex, isMirrored) {
    let srcC90 = c90[srcIndex];
    let dstC90 = c90[dstIndex];

    let srcSan = san90[srcC90];
    let dstSan = san90[dstC90];

    if (isMirrored) {
        let srcFile = 8 - (srcSan.charCodeAt(0) - 97);
        let srcRank = srcSan.charAt(1);
        srcSan = String.fromCharCode(97 + srcFile) + srcRank;

        let dstFile = 8 - (dstSan.charCodeAt(0) - 97);
        let dstRank = dstSan.charAt(1);
        dstSan = String.fromCharCode(97 + dstFile) + dstRank;
    }

    return srcSan + dstSan;
}

// 2. KHỞI TẠO VÀ TRUY VẤN CƠ SỞ DỮ LIỆU SQLITE
async function initDB(arrayBuffer) {
    try {
        const SQL = await initSqlJs({
            locateFile: file => `../sql/${file}`
        });
        
        db = new SQL.Database(new Uint8Array(arrayBuffer));
        
        let tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
        let tables = tablesRes[0] ? tablesRes[0].values.map(v => v[0]) : [];
        
        if (tables.includes('book')) {
            dbType = 'xqb';
        } else if (tables.includes('mybook')) {
            dbType = 'obk'; 
        } else if (tables.includes('positions')) {
            dbType = 'pfbook';
        } else {
            dbType = 'unknown';
        }
        
        self.postMessage({ type: 'DB_LOADED', dbType: dbType });
    } catch (e) {
        console.error("Lỗi Worker nạp SQLite DB:", e);
        self.postMessage({ type: 'ERROR', msg: e.message });
    }
}

function fetchZobristTable(zKey, isMirrored, resultsArray) {
    try {
        let low = Number(zKey & 0xFFFFFFFFn);
        let high = Number((zKey >> 32n) & 0xFFFFFFFFn);

        let queryStr = `SELECT src, dst, vscore, winrate FROM mybook WHERE low = ? AND high = ?`;
        let stmt = db.prepare(queryStr);
        stmt.bind([low, high]);

        while (stmt.step()) {
            let row = stmt.getAsObject();
            let parsedMove = parseZobristMove(row.src, row.dst, isMirrored);
            let winRate = row.winrate !== undefined ? parseFloat(row.winrate).toFixed(1) : 0;
            
            resultsArray.push({
                move: parsedMove,
                score: row.vscore,
                winrate: winRate
            });
        }
        stmt.free();
    } catch(e) {
        console.error("Lỗi SQL truy vấn Zobrist:", e.message);
    }
}

function queryZobrist(fenBoard, isRedGo) {
    let results = [];
    let zKey = getZobristFromBoard(fenBoard, isRedGo, false);
    fetchZobristTable(zKey, false, results);

    let lrKey = getZobristFromBoard(fenBoard, isRedGo, true);
    if (lrKey !== zKey) {
        fetchZobristTable(lrKey, true, results);
    }
    return results;
}

// CORE: QUERY CHÍNH
function queryDB(fen, requestId) {
    try {
        if (!db || !dbType) {
            self.postMessage({ type: 'QUERY_RESULT', data: [], requestId });
            return;
        }

        let isRedGo = fen.split(" ")[1] === 'w';
        let fenBoard = fen.split(" ")[0];
        let results = [];

        if (dbType === 'xqb') {
            let hexKey = getXqbKey(fen);
            let stmt = db.prepare(`SELECT Move, Score, Win, Draw, Lost FROM book WHERE key = ?`);
            let hexArray = new Uint8Array(hexKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            stmt.bind([hexArray]);

            while (stmt.step()) {
                let row = stmt.getAsObject();
                let total = row.Win + row.Draw + row.Lost;
                results.push({
                    move: parseXqbMove(row.Move),
                    score: row.Score,
                    winrate: total > 0 ? ((row.Win + row.Draw / 2) / total * 100).toFixed(1) : 0
                });
            }
            stmt.free();
        } 
        else if (dbType === 'obk' || dbType === 'pfbook') {
            results = queryZobrist(fenBoard, isRedGo);

            if (results.length === 0 && !isRedGo) {
                let rotatedFenBoard = rotateAndSwapFen(fenBoard);
                let fallbackResults = queryZobrist(rotatedFenBoard, true); 

                for (let i = 0; i < fallbackResults.length; i++) {
                    fallbackResults[i].move = rotateMove(fallbackResults[i].move);
                    results.push(fallbackResults[i]);
                }
            }
        }

        // Lọc trùng lặp
        let uniqueMoves = new Set();
        let finalResults = [];
        for(let r of results) {
            if(!uniqueMoves.has(r.move) && r.move !== "") {
                uniqueMoves.add(r.move);
                finalResults.push(r);
            }
        }

        finalResults.sort((a, b) => b.score - a.score);
        self.postMessage({ type: 'QUERY_RESULT', data: finalResults, requestId });

    } catch (e) {
        console.error("Worker Catch Lỗi:", e);
        self.postMessage({ type: 'QUERY_RESULT', data: [], requestId });
    }
}

// LISTENERS
self.onmessage = function(e) {
    const { action, buffer, fen, requestId } = e.data;
    if (action === 'LOAD_DB') {
        initDB(buffer).catch(err => self.postMessage({ type: 'ERROR', msg: err.message, requestId }));
    } else if (action === 'QUERY') {
        queryDB(fen, requestId);
    }
};