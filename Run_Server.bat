@echo off
title Son 9.3 - May Chu Localhost 3000
chcp 65001 > nul
cd /d "%~dp0"

echo ===================================================
echo   CHƯƠNG TRÌNH KHỞI ĐỘNG MÁY CHỦ SƠN 9.3 (PORT 3000)
echo ===================================================
echo.
echo [*] Dang mo trinh duyet web http://localhost:3000 ...
start http://localhost:3000

echo [*] Dang khoi chay Node.js Server ...
echo (Nhan Ctrl + C de dung May Chu khi khong su dung)
echo.
node server.js
pause
