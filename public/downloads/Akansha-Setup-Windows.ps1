# ============================================================
#  AKANSHA — Windows Installer & Launcher
#  Premium Futuristic AI Desktop Companion
# ============================================================
#  Run:  Right-click -> "Run with PowerShell"
#  Or:   Akansha-Windows-Launcher.bat  (double-click)
# ============================================================

$ErrorActionPreference = "Continue"
$AppDir = "$env:LOCALAPPDATA\Akansha"

# Set $RepoUrl to the ACTUAL published repository before shipping this installer.
# It intentionally has no working default so we never clone a fake/placeholder URL.
$RepoUrl = "https://github.com/your-org/akansha.git"

$Repo = Read-Host "Akansha source folder path (blank = git clone from repo)"
if ([string]::IsNullOrWhiteSpace($Repo)) {
  if ($RepoUrl -eq "https://github.com/your-org/akansha.git") {
    Write-Host "  [!] No source path given and \$RepoUrl is still the placeholder." -ForegroundColor Red
    Write-Host "      Provide a local source folder, or set \$RepoUrl in this script to" -ForegroundColor Red
    Write-Host "      the real published repository, then re-run." -ForegroundColor Red
    exit 1
  }
  $Repo = $RepoUrl
}

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host "     A K A N S H A   -   INSTALLER" -ForegroundColor White
Write-Host "     Premium AI Desktop Companion" -ForegroundColor DarkCyan
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
