// js/config.js

export const PIECE_MAP = {
    'r': 'br', 'n': 'bn', 'b': 'bb', 'a': 'ba', 'k': 'bk', 'c': 'bc', 'p': 'bp', 
    'R': 'wr', 'N': 'wn', 'B': 'wb', 'A': 'wa', 'K': 'wk', 'C': 'wc', 'P': 'wp'  
};

export const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

export const defaultGameInfo = {
    title: "Sơn 9.3",     	 
    event: "Tên giải đấu",          	 
    group: "Bảng/Nhóm thi đấu",          
    date: "Ngày thi đấu",                
    place: "Việt Nam",                   
    round: "Vòng 1",                     
    table: "Bàn thi đấu",                
    red: "Đội đỏ",                   	 
    redname: "Tên Kỳ thủ Đỏ",            
    redlevel: "Đẳng cấp kỳ thủ Đỏ",      
    redrating: "Elo kỳ thủ đỏ",          
    redtime: "Thời gian bên Đỏ",         
    black: "Đội Đen",             	 
    blackname: "Tên Kỳ thủ Đen",         
    blacklevel: "Đẳng cấp kỳ thủ Đen",   
    blackrating: "Elo kỳ thủ đen",       
    blacktime: "Thời gian bên Đen",      
    judge: "VsChess",     		 
    record: "Sơn 9.3",        	 
    remark: "Sơn 9.3",             
    author: "Sơn 9.3",             
    open: "Tên Khai cuộc",               
    variation: "Biến hóa khai cuộc", 	 
    ecco: "Mã ECCO khai cuộc",           
    result: "*"                          
};

export const VschessErrorDict = {
    "Fen 串不合法": "Chuỗi FEN không hợp lệ.",
    "红方帅的位置不符合规则": "Vị trí Tướng đỏ không hợp lệ.",
    "黑方将的位置不符合规则": "Vị trí Tướng đen không hợp lệ.",
    "红方相的位置不符合规则": "Vị trí Tượng đỏ không hợp lệ.",
    "黑方象的位置不符合规则": "Vị trí Tượng đen không hợp lệ.",
    "红方仕的位置不符合规则": "Vị trí Sĩ đỏ không hợp lệ.",
    "黑方士的位置不符合规则": "Vị trí Sĩ đen không hợp lệ.",
    "红方兵的位置不符合规则": "Vị trí Tốt đỏ không hợp lệ.",
    "黑方卒的位置不符合规则": "Vị trí Tốt đen không hợp lệ.",
    "帅将面对面了": "Lỗi: Hai Tướng đang Lộ Mặt nhau.",
    "红方九路出现未过河的重叠兵": "Cột 9 có Tốt đỏ chưa qua sông bị trùng.",
    "红方七路出现未过河的重叠兵": "Cột 7 có Tốt đỏ chưa qua sông bị trùng.",
    "红方五路出现未过河的重叠兵": "Cột 5 có Tốt đỏ chưa qua sông bị trùng.",
    "红方三路出现未过河的重叠兵": "Cột 3 có Tốt đỏ chưa qua sông bị trùng.",
    "红方一路出现未过河的重叠兵": "Cột 1 có Tốt đỏ chưa qua sông bị trùng.",
    "黑方１路出现未过河的重叠卒": "Cột 1 có Tốt đen chưa qua sông bị trùng.",
    "黑方３路出现未过河的重叠卒": "Cột 3 có Tốt đen chưa qua sông bị trùng.",
    "黑方５路出现未过河的重叠卒": "Cột 5 có Tốt đen chưa qua sông bị trùng.",
    "黑方７路出现未过河的重叠卒": "Cột 7 có Tốt đen chưa qua sông bị trùng.",
    "黑方９路出现未过河的重叠卒": "Cột 9 có Tốt đen chưa qua sông bị trùng.",
    "红方出现了": "Đỏ có ",
    "黑方出现了": "Đen có ",
    "个车，多了": " Xe (Dư ",
    "个马，多了": " Mã (Dư ",
    "个相，多了": " Tượng (Dư ",
    "个象，多了": " Tượng (Dư ",
    "个仕，多了": " Sĩ (Dư ",
    "个士，多了": " Sĩ (Dư ",
    "个炮，多了": " Pháo (Dư ",
    "个兵，多了": " Tốt (Dư ",
    "个卒，多了": " Tốt (Dư ",
    "个帅，多了": " Tướng (Dư ",
    "个将，多了": " Tướng (Dư ",
    "个": " quân)",
    "红方必须有一个帅": "Bên Đỏ bắt buộc phải có 1 Tướng.",
    "黑方必须有一个将": "Bên Đen bắt buộc phải có 1 Tướng.",
    "红黑双方同时被将军": "Lỗi: Cả hai bên đang cùng bị chiếu tướng.",
    "轮到黑方走棋，但此时红方正在被将军": "Lượt Đen đi, nhưng Đỏ đang bị chiếu.",
    "轮到红方走棋，但此时黑方正在被将军": "Lượt Đỏ đi, nhưng Đen đang bị chiếu."
};