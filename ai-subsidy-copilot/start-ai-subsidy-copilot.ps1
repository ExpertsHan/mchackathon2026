$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not installed or is not available in PATH. $InstallHint"
    }
}

$NodeInstallDirs = @(
    (Join-Path ${env:ProgramFiles} "nodejs"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs")
)
foreach ($NodeInstallDir in $NodeInstallDirs) {
    if ((Test-Path (Join-Path $NodeInstallDir "node.exe")) -and
        -not (Get-Command node -ErrorAction SilentlyContinue)) {
        $env:Path = "$NodeInstallDir;$env:Path"
        break
    }
}

Require-Command "node" "Install Node.js LTS from https://nodejs.org/."

$PythonCommand = Get-Command "py" -ErrorAction SilentlyContinue
if (-not $PythonCommand) {
    $PythonCommand = Get-Command "python" -ErrorAction SilentlyContinue
}
if (-not $PythonCommand) {
    throw "Python is not installed or is not available in PATH. Install Python 3.11+ from https://www.python.org/downloads/."
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating backend virtual environment..." -ForegroundColor Cyan
    if ($PythonCommand.Name -eq "py.exe") {
        & $PythonCommand.Source -3.11 -m venv (Join-Path $BackendDir ".venv")
    } else {
        & $PythonCommand.Source -m venv (Join-Path $BackendDir ".venv")
    }
}

if (-not (Test-Path $VenvPython)) {
    throw "Could not create the backend virtual environment at $VenvPython"
}

$RequirementsMarker = Join-Path $BackendDir ".venv\.ai-subsidy-dependencies-installed"
if (-not (Test-Path $RequirementsMarker)) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -e "$BackendDir[dev]"
    New-Item -ItemType File -Path $RequirementsMarker -Force | Out-Null
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    try {
        & npm.cmd install
    } finally {
        Pop-Location
    }
}

$env:DATABASE_URL = "sqlite:///./ai_subsidy_demo.db"
$env:NEXT_PUBLIC_API_URL = "http://localhost:8000"

Write-Host "Initializing demo database..." -ForegroundColor Cyan
Push-Location $BackendDir
try {
    & $VenvPython -m app.scripts.init_db
    & $VenvPython -m app.scripts.seed
    & $VenvPython -m app.scripts.ingest_knowledge
} finally {
    Pop-Location
}

$BackendCommand = "Set-Location -LiteralPath '$BackendDir'; `$env:DATABASE_URL='sqlite:///./ai_subsidy_demo.db'; & '$VenvPython' -m uvicorn app.main:app --reload --port 8000"
$FrontendCommand = "Set-Location -LiteralPath '$FrontendDir'; `$env:NEXT_PUBLIC_API_URL='http://localhost:8000'; & npm.cmd run dev"

Write-Host "Starting backend and frontend in separate windows..." -ForegroundColor Green
Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $BackendCommand
Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $FrontendCommand

Write-Host "Citizen portal: http://localhost:3000" -ForegroundColor Green
Write-Host "Backend docs:    http://localhost:8000/docs" -ForegroundColor Green