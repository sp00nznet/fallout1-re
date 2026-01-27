<#
.SYNOPSIS
    Manages the Fallout 1 HTML5 Web Port Docker container.

.DESCRIPTION
    PowerShell script to build, start, stop, and manage the Fallout 1 web port container.

.PARAMETER Action
    The action to perform: start, stop, restart, build, convert, logs, status, clean

.EXAMPLE
    .\fallout-web.ps1 start
    Starts the Fallout 1 web container

.EXAMPLE
    .\fallout-web.ps1 convert
    Converts game assets from the gamefiles directory

.EXAMPLE
    .\fallout-web.ps1 stop
    Stops the running container
#>

param(
    [Parameter(Position=0)]
    [ValidateSet('start', 'stop', 'restart', 'build', 'convert', 'logs', 'status', 'clean', 'help')]
    [string]$Action = 'help'
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Colors for output
function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Success { Write-Host $args -ForegroundColor Green }
function Write-Warning { Write-Host $args -ForegroundColor Yellow }
function Write-Error { Write-Host $args -ForegroundColor Red }

function Show-Banner {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor DarkYellow
    Write-Host "  Fallout 1 HTML5 Web Port" -ForegroundColor Yellow
    Write-Host "  Container Management Script" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor DarkYellow
    Write-Host ""
}

function Show-Help {
    Show-Banner
    Write-Host "Usage: .\fallout-web.ps1 <action>" -ForegroundColor White
    Write-Host ""
    Write-Host "Actions:" -ForegroundColor Cyan
    Write-Host "  start     - Start the web server container"
    Write-Host "  stop      - Stop the running container"
    Write-Host "  restart   - Restart the container"
    Write-Host "  build     - Build the Docker image"
    Write-Host "  convert   - Convert game assets (run once)"
    Write-Host "  logs      - View container logs"
    Write-Host "  status    - Show container status"
    Write-Host "  clean     - Remove containers and images"
    Write-Host "  help      - Show this help message"
    Write-Host ""
    Write-Host "Setup Instructions:" -ForegroundColor Cyan
    Write-Host "  1. Copy your Fallout 1 game files to: docker\gamefiles\"
    Write-Host "     Required: master.dat, critter.dat"
    Write-Host "  2. Run: .\fallout-web.ps1 convert"
    Write-Host "  3. Run: .\fallout-web.ps1 build"
    Write-Host "  4. Run: .\fallout-web.ps1 start"
    Write-Host "  5. Open: http://localhost:8080"
    Write-Host ""
}

function Test-Docker {
    try {
        $null = docker --version
        return $true
    } catch {
        Write-Error "Docker is not installed or not running."
        Write-Host "Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
        return $false
    }
}

function Test-GameFiles {
    $masterDat = Join-Path $ScriptDir "gamefiles\master.dat"
    if (-not (Test-Path $masterDat)) {
        Write-Warning "Game files not found!"
        Write-Host "Please copy your Fallout 1 game files to:"
        Write-Host "  $ScriptDir\gamefiles\" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Required files:"
        Write-Host "  - master.dat"
        Write-Host "  - critter.dat (optional but recommended)"
        return $false
    }
    return $true
}

function Start-Container {
    Show-Banner
    Write-Info "Starting Fallout 1 Web container..."

    if (-not (Test-Docker)) { return }

    Push-Location $ScriptDir
    try {
        docker-compose up -d fallout1-web
        Write-Success ""
        Write-Success "Container started successfully!"
        Write-Success "Open your browser to: http://localhost:8080"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

function Stop-Container {
    Show-Banner
    Write-Info "Stopping Fallout 1 Web container..."

    if (-not (Test-Docker)) { return }

    Push-Location $ScriptDir
    try {
        docker-compose down
        Write-Success "Container stopped."
    } finally {
        Pop-Location
    }
}

function Restart-Container {
    Stop-Container
    Start-Container
}

function Build-Container {
    Show-Banner
    Write-Info "Building Fallout 1 Web container..."

    if (-not (Test-Docker)) { return }

    Push-Location $ScriptDir
    try {
        docker-compose build fallout1-web
        Write-Success ""
        Write-Success "Build complete!"
        Write-Host "Run '.\fallout-web.ps1 start' to start the container."
    } finally {
        Pop-Location
    }
}

function Convert-Assets {
    Show-Banner
    Write-Info "Converting game assets..."

    if (-not (Test-Docker)) { return }
    if (-not (Test-GameFiles)) { return }

    # Create assets directory if it doesn't exist
    $assetsDir = Join-Path $ScriptDir "assets"
    if (-not (Test-Path $assetsDir)) {
        New-Item -ItemType Directory -Path $assetsDir | Out-Null
    }

    Push-Location $ScriptDir
    try {
        docker-compose --profile tools build asset-converter
        docker-compose --profile tools run --rm asset-converter
        Write-Success ""
        Write-Success "Asset conversion complete!"
        Write-Host "Run '.\fallout-web.ps1 build' to build the container."
    } finally {
        Pop-Location
    }
}

function Show-Logs {
    if (-not (Test-Docker)) { return }

    Push-Location $ScriptDir
    try {
        docker-compose logs -f fallout1-web
    } finally {
        Pop-Location
    }
}

function Show-Status {
    Show-Banner

    if (-not (Test-Docker)) { return }

    Write-Info "Container Status:"
    Write-Host ""

    Push-Location $ScriptDir
    try {
        docker-compose ps
    } finally {
        Pop-Location
    }

    Write-Host ""

    # Check for game files
    Write-Info "Game Files:"
    $gamefilesDir = Join-Path $ScriptDir "gamefiles"
    if (Test-Path (Join-Path $gamefilesDir "master.dat")) {
        Write-Success "  master.dat: Found"
    } else {
        Write-Warning "  master.dat: Not found"
    }
    if (Test-Path (Join-Path $gamefilesDir "critter.dat")) {
        Write-Success "  critter.dat: Found"
    } else {
        Write-Warning "  critter.dat: Not found"
    }

    Write-Host ""

    # Check for converted assets
    Write-Info "Converted Assets:"
    $assetsDir = Join-Path $ScriptDir "assets"
    if (Test-Path $assetsDir) {
        $assetCount = (Get-ChildItem -Path $assetsDir -Recurse -File).Count
        Write-Success "  Assets directory: Found ($assetCount files)"
    } else {
        Write-Warning "  Assets directory: Not found (run 'convert' first)"
    }

    Write-Host ""
}

function Clean-All {
    Show-Banner
    Write-Warning "This will remove all containers and images for this project."
    $confirm = Read-Host "Are you sure? (y/N)"

    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Cancelled."
        return
    }

    if (-not (Test-Docker)) { return }

    Push-Location $ScriptDir
    try {
        Write-Info "Stopping containers..."
        docker-compose down --rmi all --volumes 2>$null
        Write-Success "Cleanup complete."
    } finally {
        Pop-Location
    }
}

# Main script
switch ($Action) {
    'start'   { Start-Container }
    'stop'    { Stop-Container }
    'restart' { Restart-Container }
    'build'   { Build-Container }
    'convert' { Convert-Assets }
    'logs'    { Show-Logs }
    'status'  { Show-Status }
    'clean'   { Clean-All }
    'help'    { Show-Help }
    default   { Show-Help }
}
