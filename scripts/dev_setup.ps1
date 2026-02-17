$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "AI Office dev setup starting in $root"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment (.venv) with Python 3.12..."
    py -3.12 -m venv .venv
}

Write-Host "Installing Python dependencies..."
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host "Installing frontend dependencies..."
Push-Location client
npm install
Pop-Location

Write-Host ""
Write-Host "Setup complete."
Write-Host "Next:"
Write-Host "  1) .\.venv\Scripts\python.exe run.py"
Write-Host "  2) cd client && npm run dev"
Write-Host "  3) Desktop mode: .\.venv\Scripts\python.exe start.py"

