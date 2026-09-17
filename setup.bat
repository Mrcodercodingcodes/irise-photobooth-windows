@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title iRISE Photobooth - Setup
echo ==========================================
echo iRISE PHOTOBOOTH SETUP
echo ==========================================
echo Checking for Node.js...

node -v >nul 2>&1
if errorlevel 1 (
    echo Node.js LTS is not installed. Attempting to install via Winget...
    where winget >nul 2>&1
    if errorlevel 1 (
        echo Winget is unavailable. Install Node.js LTS manually from https://nodejs.org/
        pause
        exit /b 1
    )

    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo Node.js installation failed. Install Node.js LTS manually from https://nodejs.org/
        pause
        exit /b 1
    )

    rem Refresh PATH for the newly installed Node.js in this same setup run.
    if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;!PATH!"
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;!PATH!"
    node -v >nul 2>&1
    if errorlevel 1 (
        echo Node.js was installed, but this window cannot see it yet.
        echo Close this window, open a new one, and run setup.bat again.
        pause
        exit /b 1
    )
)

where npm >nul 2>&1
if errorlevel 1 (
    echo npm was not found. Reinstall Node.js LTS or open a new terminal and try again.
    pause
    exit /b 1
)

echo Node.js and npm are installed.
echo.
echo Installing the exact locked project dependencies...
call npm ci
if errorlevel 1 (
    echo Dependency installation failed. Check the npm output above and try again.
    pause
    exit /b 1
)

echo Verifying required runtime packages and native binaries...
call npm run verify:install
if errorlevel 1 (
    echo Required dependencies are incomplete. Run setup.bat again or inspect the npm output above.
    pause
    exit /b 1
)

IF NOT EXIST .env (
    copy /Y .env.example .env >nul
    echo Created local .env configuration from .env.example.
)

echo.
echo ==========================================
echo Setup complete. You can now run start.bat
echo ==========================================
pause
