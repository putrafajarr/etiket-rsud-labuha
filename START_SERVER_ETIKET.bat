@echo off
title SERVER ETIKET RSUD LABUHA
echo ===================================================
echo     MEMULAI SERVER ETIKET RSUD LABUHA (MANDIRI)
echo ===================================================
echo.
cd /d "%~dp0"

echo 1. Menjalankan Server Lokal (Port 3000)...
start "ETIKET-NODE-SERVER" /min node server/server.js

echo 2. Menjalankan Cloudflare Tunnel (Akses Internet Bebas Kuota)...
start "ETIKET-CLOUDFLARE-TUNNEL" /min bin\cloudflared.exe tunnel --url http://localhost:3000

echo.
echo ===================================================
echo  SERVER BERHASIL DIAKTIFKAN!
echo  - Akses Lokal RSUD : http://192.168.0.235:3000
echo  - Akses Internet   : Bebas Kuota via Cloudflare
echo ===================================================
timeout /t 4
