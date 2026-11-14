@echo off
title MUSII - Minimal Glass Music
echo ======================================================
echo Starting MUSII v1.9.1 High-Speed SQLite Server...
echo ======================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [Notice] Node.js not found in PATH.
    echo Opening MUSII in Standalone Mode...
    start index.html
    pause
    exit /b
)

if not exist node_modules (
    echo [Setup] Installing dependencies...
    npm install
)

echo [Ready] Launching server and opening your browser...
start "" "http://localhost:5050"
npm start
