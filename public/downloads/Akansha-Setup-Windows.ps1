# ============================================================
#  AKANSHA — DEVELOPER / SOURCE-MODE BOOTSTRAP (Windows)
# ------------------------------------------------------------
#  This is NOT the packaged desktop installer.
#  It clones the source, runs `npm install` / `npm run build`,
#  and starts the development server. Requires Node.js + Git.
#
#  For normal use, download the real desktop app:  Akansha-Setup.exe
#  (built via `npm run dist:win`, which produces an Electron NSIS
#   installer with a native window, shortcuts and an uninstaller).
# ============================================================
#  Run:  Right-click -> "Run with PowerShell"
# ============================================================

$ErrorActionPreference = "Continue"
$AppDir = "$env:LOCALAPPDATA\Akansha"

# Developer bootstrap only. The repo URL must be supplied explicitly — there is
# intentionally NO hardcoded/placeholder repository. Set $env:AKANSHA_REPO or pass
# a local source folder path.
$RepoUrl = $env:AKANSHA_REPO

$Repo = Read-Host "Akansha source folder path (blank = git clone from `$env:AKANSHA_REPO)"
if ([string]::IsNullOrWhiteSpace($Repo)) {
  if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
    Write-Host "  [!] This is a DEVELOPER bootstrap, not the packaged desktop app." -ForegroundColor Red
    Write-Host "      Provide a local source folder, or set the AKANSHA_REPO env var" -ForegroundColor Red
    Write-Host "      to your real repository URL, then re-run." -ForegroundColor Red
    Write-Host "      For normal use, install Akansha-Setup.exe instead." -ForegroundColor Yellow
    exit 1
  }
  $Repo = $RepoUrl
}

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host "     A K A N S H A   -   DEVELOPER BOOTSTRAP" -ForegroundColor White
Write-Host "     (source install: requires Node.js + Git)" -ForegroundColor DarkCyan
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host ""

# --- Check Node.js ---
Write-Host "[1/6] Checking Node.js runtime..." -ForegroundColor Yellow
try {
  $nodeVer = (node --version) 2>$null
  Write-Host "      Node.js $nodeVer detected." -ForegroundColor Green
} catch {
  Write-Host "      Node.js NOT found." -ForegroundColor Red
  Write-Host "      Install from https://nodejs.org then re-run." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

# --- Create app directory ---
Write-Host "[2/6] Preparing $AppDir ..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

# --- Fetch source ---
Write-Host "[3/6] Fetching Akansha source..." -ForegroundColor Yellow
if (Test-Path "$AppDir\package.json") {
  Write-Host "      Existing installation found — updating." -ForegroundColor DarkGray
  Push-Location $AppDir
  git pull 2>$null
  Pop-Location
} else {
  if ($Repo -like "http*") {
    git clone $Repo $AppDir 2>$null
    if (-not (Test-Path "$AppDir\package.json")) {
      Write-Host "      Git clone unavailable. Copy your Akansha folder to:" -ForegroundColor Red
      Write-Host "      $AppDir" -ForegroundColor Cyan
      Read-Host "Press Enter to exit"
      exit 1
    }
  } else {
    if (Test-Path "$Repo\package.json") {
      Copy-Item -Path "$Repo\*" -Destination $AppDir -Recurse -Force
    } else {
      Write-Host "      Source not found at $Repo" -ForegroundColor Red
      Read-Host "Press Enter to exit"
      exit 1
    }
  }
}

# --- Install dependencies ---
Write-Host "[4/6] Installing dependencies (this may take a minute)..." -ForegroundColor Yellow
Push-Location $AppDir
npm install --no-audit --no-fund 2>$null
Pop-Location

# --- Build ---
Write-Host "[5/6] Building production bundle..." -ForegroundColor Yellow
Push-Location $AppDir
npm run build 2>$null
Pop-Location

# --- Desktop shortcut ---
Write-Host "[6/6] Creating desktop shortcut..." -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Akansha.lnk")
$Shortcut.TargetPath = "$AppDir\Akansha-Windows-Launcher.bat"
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.Description = "Akansha — Premium AI Desktop Companion"
$Shortcut.Save()

# --- Create the runtime launcher inside the app dir ---
$Launcher = @"
@echo off
title AKANSHA - Premium AI Desktop Companion
color 0B
echo.
echo   ==========================================
echo        A K A N S H A
echo      Premium AI Desktop Companion
echo   ==========================================
echo.
cd /d "$AppDir"
echo   Starting Akansha runtime...
echo.
start "" http://localhost:3000
npm run start
pause
"@
Set-Content -Path "$AppDir\Akansha-Windows-Launcher.bat" -Value $Launcher -Encoding ASCII

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Green
Write-Host "     INSTALLATION COMPLETE" -ForegroundColor White
Write-Host "  ======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Desktop shortcut : Akansha.lnk" -ForegroundColor Cyan
Write-Host "  App directory    : $AppDir" -ForegroundColor Cyan
Write-Host ""
$launch = Read-Host "  Launch Akansha now? (Y/n)"
if ($launch -ne "n") {
  Start-Process "$AppDir\Akansha-Windows-Launcher.bat"
}
