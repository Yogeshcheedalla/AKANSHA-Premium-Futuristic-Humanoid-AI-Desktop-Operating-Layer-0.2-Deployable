#!/bin/bash
# ============================================================
#  AKANSHA — macOS Installer & Launcher
#  Premium Futuristic AI Desktop Companion
# ============================================================
#  Double-click this file to install and launch Akansha.
# ============================================================

APP_DIR="$HOME/Akansha"

printf '\n\033[36m======================================\033[0m\n'
printf '\033[1m     A K A N S H A   -   macOS\033[0m\n'
printf '\033[2m     Premium AI Desktop Companion\033[0m\n'
printf '\033[36m======================================\033[0m\n\n'

printf '\033[33m[1/6]\033[0m Checking Node.js...\n'
if ! command -v node >/dev/null 2>&1; then
  printf '\033[31m      Node.js not found.\033[0m\n'
  printf '      Install via:  brew install node\n'
  printf '      Or download:  https://nodejs.org\n\n'
  read -p "Press Enter to exit..."
  exit 1
fi
printf '\033[32m      Node.js $(node --version) detected.\033[0m\n'

printf '\033[33m[2/6]\033[0m Preparing %s ...\n' "$APP_DIR"
mkdir -p "$APP_DIR"

printf '\033[33m[3/6]\033[0m Fetching Akansha source...\n'
if [ -f "$APP_DIR/package.json" ]; then
  printf '      Existing installation found — updating.\n'
  cd "$APP_DIR" && git pull >/dev/null 2>&1
else
  printf '      Place your Akansha project folder at:\n'
  printf '      \033[36m%s\033[0m\n' "$APP_DIR"
  printf '      Then re-run this launcher.\n\n'
  read -p "Press Enter to exit..."
  exit 1
fi

printf '\033[33m[4/6]\033[0m Installing dependencies...\n'
cd "$APP_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1

printf '\033[33m[5/6]\033[0m Building production bundle...\n'
cd "$APP_DIR" && npm run build >/dev/null 2>&1

printf '\033[33m[6/6]\033[0m Launching Akansha...\n'
printf '\n\033[32m======================================\033[0m\n'
printf '\033[1m     AKANSHA IS ONLINE\033[0m\n'
printf '\033[32m======================================\033[0m\n\n'
printf '  Opening \033[36mhttp://localhost:3000\033[0m ...\n\n'

sleep 2
open "http://localhost:3000" >/dev/null 2>&1 || true
cd "$APP_DIR" && npm run start
