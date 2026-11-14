@echo off
title SERVER ETIKET RSUD LABUHA
echo ===================================================
echo     MEMULAI SERVER ETIKET RSUD LABUHA (MANDIRI)
echo ===================================================
echo.
cd /d "%~dp0"

:: Cek Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di PC ini!
    echo Silakan unduh dan pasang Node.js LTS dari: https://nodejs.org
    echo Setelah pasang, jalankan file ini kembali.
    pause
    exit /b 1
)

:: Deteksi IP Lokal Komputer Ini
set LOCAL_IP=127.0.0.1
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set LOCAL_IP=%%a
    goto :ip_found
)
:ip_found
set LOCAL_IP=%LOCAL_IP: =%

echo 1. Menjalankan Server Lokal (Port 3000)...
start "ETIKET-NODE-SERVER" /min node server/server.js

echo 2. Menjalankan Cloudflare Tunnel (Akses Internet Bebas Kuota)...
if not exist "bin\cloudflared.exe" (
    echo    Mengunduh alat tunnel cloudflare...
    powershell -NoProfile -Command "New-Item -ItemType Directory -Path 'bin' -Force; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'bin/cloudflared.exe'"
)
start "ETIKET-CLOUDFLARE-TUNNEL" /min bin\cloudflared.exe tunnel --url http://localhost:3000

echo.
echo ===================================================
echo  SERVER BERHASIL DIAKTIFKAN DI PC INI!
echo  - Akses Lokal RSUD : http://%LOCAL_IP%:3000
echo  - Form Lapor RSUD  : http://%LOCAL_IP%:3000/lapor.html
echo  - Akses Internet   : Bebas Kuota via Cloudflare Tunnel
echo ===================================================
timeout /t 5
