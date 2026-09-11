#!/bin/bash
# AKANSHA — Linux Installer & Launcher
APP_DIR="$HOME/Akansha"

printf '\n\033[36m======================================\033[0m\n'
printf '\033[1m     A K A N S H A   -   Linux\033[0m\n'
printf '\033[2m     Premium AI Desktop Companion\033[0m\n'
printf '\033[36m======================================\033[0m\n\n'

printf '\033[33m[1/5]\033[0m Checking Node.js...\n'
command -v node >/dev/null 2>&1 || { printf '\033[31mNode.js missing.\033[0m Install: sudo apt install nodejs\n'; exit 1; }
printf '\033[32m      Node.js $(node --version)\033[0m\n'

printf '\033[33m[2/5]\033[0m Preparing %s\n' "$APP_DIR"
mkdir -p "$APP_DIR"

if [ ! -f "$APP_DIR/package.json" ]; then
  printf '      Place your Akansha project at \033[36m%s\033[0m\n' "$APP_DIR"
  exit 1
fi

printf '\033[33m[3/5]\033[0m Installing dependencies...\n'
cd "$APP_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1

printf '\033[33m[4/5]\033[0m Building...\n'
cd "$APP_DIR" && npm run build >/dev/null 2>&1

printf '\033[33m[5/5]\033[0m Launching Akansha...\n\n'
printf '\033[32m     AKANSHA IS ONLINE — http://localhost:3000\033[0m\n\n'
cd "$APP_DIR" && npm run start
