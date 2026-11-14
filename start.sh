#!/usr/bin/env bash
set -e

echo "======================================================"
echo "Starting MUSII v1.9.1 (Pixel-Perfect Glass UI)"
echo "======================================================"

if ! command -v node &> /dev/null; then
    echo "[!] Node.js not detected. Opening standalone index.html..."
    xdg-open index.html 2>/dev/null || open index.html 2>/dev/null
    exit 0
fi

if [ ! -d "node_modules" ]; then
    echo "[*] Installing dependencies..."
    npm install
fi

echo "[*] Launching high-speed SQLite server on port 5050..."
npm start
