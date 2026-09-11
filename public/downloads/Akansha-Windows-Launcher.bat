@echo off
title AKANSHA - Premium AI Desktop Companion
color 0B
echo.
echo   ==========================================
echo        A K A N S H A
echo      Premium AI Desktop Companion
echo   ==========================================
echo.
echo   [1/4] Checking runtime...
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js not found. Download from https://nodejs.org
  pause
  exit /b
)
echo         Node.js OK
echo.
echo   [2/4] Installing Akansha if needed...
if not exist "%LOCALAPPDATA%\Akansha\package.json" (
  echo         Run Akansha-Setup-Windows.ps1 first.
  pause
  exit /b
)
echo         Installation found.
echo.
echo   [3/4] Starting Akansha server...
cd /d "%LOCALAPPDATA%\Akansha"
start "" http://localhost:3000
echo.
echo   [4/4] Akansha is online.
echo.
echo   Press Ctrl+C to stop Akansha.
echo.
npm run start
pause
