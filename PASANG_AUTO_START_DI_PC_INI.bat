@echo off
title PASANG AUTO-START SERVER ETIKET RSUD
echo ===================================================
echo   MEMASANG AUTO-START SERVER ETIKET DI PC INI
echo ===================================================
echo.
cd /d "%~dp0"

echo Memasang shortcut di folder Startup Windows...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Startup'), 'ETIKET_AUTO_START.lnk')); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"' + (Resolve-Path 'START_SERVER_SILENT.vbs') + '\"'; $s.WorkingDirectory = (Resolve-Path '.'); $s.Save()"

echo.
echo ===================================================
echo [SUKSES] Auto-start berhasil dipasang di PC ini!
echo Setiap kali PC ini dinyalakan atau restart,
echo server e-tiket akan otomatis langsung berjalan.
echo ===================================================
pause

