@echo off
setlocal
cd /d "%~dp0"
title iRISE Photobooth Server
echo ==========================================
echo   iRISE Photobooth - Server Launcher
echo ==========================================
echo.

IF NOT EXIST node_modules (
    echo Dependencies are missing. Run setup.bat first.
    pause
    exit /b 1
)

echo Starting the local server (default port: 8080)
echo Booth: http://localhost:8080/photobooth.html
echo If you changed PORT in .env, use that port instead.
echo Press Ctrl+C to stop the server.
echo.
call npm start

pause
