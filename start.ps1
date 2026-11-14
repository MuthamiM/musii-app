Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Launching MUSII v1.9.1 (Pixel-Perfect Glass UI)" -ForegroundColor Magenta
Write-Host "======================================================" -ForegroundColor Cyan

$nodeExists = Get-Command node -ErrorAction SilentlyContinue

if (-not $nodeExists) {
    Write-Host "[!] Node.js not detected. Launching in standalone browser mode..." -ForegroundColor Yellow
    Start-Process "index.html"
    Exit
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[*] First run: Installing dependencies..." -ForegroundColor Green
    npm install
}

Write-Host "[*] Starting SQLite backend and opening http://localhost:5050..." -ForegroundColor Green
Start-Process "http://localhost:5050"
npm start
