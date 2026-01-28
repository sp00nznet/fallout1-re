<#
.SYNOPSIS
    Fallout 1 Multiplayer Server Management Script

.DESCRIPTION
    Manages the Docker-based multiplayer server stack including
    the web frontend, API server, PostgreSQL, and Redis.

.EXAMPLE
    .\server.ps1 -Start
    .\server.ps1 -Stop
    .\server.ps1 -Status
    .\server.ps1 -Logs -Service api -Follow
#>

[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Start')]
    [switch]$Start,

    [Parameter(ParameterSetName = 'Stop')]
    [switch]$Stop,

    [Parameter(ParameterSetName = 'Restart')]
    [switch]$Restart,

    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status,

    [Parameter(ParameterSetName = 'Logs')]
    [switch]$Logs,

    [Parameter(ParameterSetName = 'Migrate')]
    [switch]$Migrate,

    [Parameter(ParameterSetName = 'Build')]
    [switch]$Build,

    [Parameter(ParameterSetName = 'Clean')]
    [switch]$Clean,

    [Parameter(ParameterSetName = 'Shell')]
    [switch]$Shell,

    [ValidateSet('web', 'api', 'postgres', 'redis', 'all')]
    [string]$Service = 'all',

    [switch]$Follow,

    [int]$Tail = 100
)

# Configuration
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DockerDir = Join-Path $ProjectRoot "docker"
$ComposeFile = Join-Path $DockerDir "docker-compose.yml"

# Service name mapping
$ServiceMap = @{
    'web'      = 'fallout1-web'
    'api'      = 'fallout1-api'
    'postgres' = 'postgres'
    'redis'    = 'redis'
}

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "=======================================================" -ForegroundColor Magenta
    Write-Host "  $Text" -ForegroundColor Magenta
    Write-Host "=======================================================" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Status {
    param(
        [string]$Label,
        [string]$Value,
        [string]$Color = 'White'
    )
    Write-Host "  $Label : " -NoNewline
    Write-Host $Value -ForegroundColor $Color
}

function Test-DockerRunning {
    try {
        $null = docker info 2>&1
        return $true
    }
    catch {
        Write-Host "ERROR: Docker is not running!" -ForegroundColor Red
        Write-Host "Please start Docker Desktop and try again." -ForegroundColor Yellow
        return $false
    }
}

function Get-ServiceName {
    param([string]$Name)
    if ($Name -eq 'all') { return $null }
    return $ServiceMap[$Name]
}

function Invoke-DockerCompose {
    param(
        [string[]]$Arguments,
        [switch]$PassThru
    )

    Push-Location $DockerDir
    try {
        $cmdArgs = @('-f', $ComposeFile) + $Arguments
        if ($PassThru) {
            & docker-compose @cmdArgs
        }
        else {
            $null = & docker-compose @cmdArgs 2>&1
        }
    }
    finally {
        Pop-Location
    }
}

function Show-Banner {
    $banner = @"

    FALLOUT 1 MULTIPLAYER SERVER
    ============================

"@
    Write-Host $banner -ForegroundColor Magenta
}

function Start-Services {
    Write-Header "Starting Services"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service

    Write-Host "  Starting containers..." -ForegroundColor Cyan

    if ($svcName) {
        Invoke-DockerCompose -Arguments @('up', '-d', $svcName) -PassThru
    }
    else {
        Invoke-DockerCompose -Arguments @('up', '-d') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "  Services started successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Web Client:  http://localhost:8080" -ForegroundColor Cyan
        Write-Host "  API:         http://localhost:8080/api" -ForegroundColor Cyan
        Write-Host "  WebSocket:   ws://localhost:8080/ws" -ForegroundColor Cyan
        Write-Host ""
    }
    else {
        Write-Host "  Failed to start services!" -ForegroundColor Red
    }
}

function Stop-Services {
    Write-Header "Stopping Services"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service

    Write-Host "  Stopping containers..." -ForegroundColor Cyan

    if ($svcName) {
        Invoke-DockerCompose -Arguments @('stop', $svcName) -PassThru
    }
    else {
        Invoke-DockerCompose -Arguments @('down') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Services stopped." -ForegroundColor Green
    }
}

function Restart-Services {
    Write-Header "Restarting Services"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service

    if ($svcName) {
        Write-Host "  Restarting $Service..." -ForegroundColor Cyan
        Invoke-DockerCompose -Arguments @('restart', $svcName) -PassThru
    }
    else {
        Write-Host "  Restarting all services..." -ForegroundColor Cyan
        Invoke-DockerCompose -Arguments @('restart') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Restart complete." -ForegroundColor Green
    }
}

function Show-Status {
    Write-Header "Service Status"

    if (-not (Test-DockerRunning)) { return }

    $containers = docker ps -a --filter "name=fallout1" --format "{{.Names}}|{{.Status}}|{{.Ports}}" 2>&1

    if ($containers) {
        Write-Host "  NAME                    STATUS                  PORTS" -ForegroundColor Cyan
        Write-Host "  ---------------------------------------------------------------" -ForegroundColor Gray

        foreach ($line in $containers) {
            $parts = $line -split '\|'
            if ($parts.Count -ge 2) {
                $name = $parts[0].PadRight(24)
                $status = $parts[1]
                $ports = if ($parts.Count -ge 3) { $parts[2] } else { "" }

                $color = if ($status -match "Up") { "Green" } else { "Yellow" }
                Write-Host "  $name" -NoNewline
                Write-Host $status.PadRight(24) -ForegroundColor $color -NoNewline
                Write-Host $ports -ForegroundColor Gray
            }
        }
    }
    else {
        Write-Host "  No containers found." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  Database Health:" -ForegroundColor Cyan

    $pgHealth = docker exec fallout1-postgres pg_isready -U fallout1 2>&1
    if ($pgHealth -match "accepting") {
        Write-Status -Label "PostgreSQL" -Value "Healthy" -Color Green
    }
    else {
        Write-Status -Label "PostgreSQL" -Value "Unavailable" -Color Red
    }

    $redisHealth = docker exec fallout1-redis redis-cli ping 2>&1
    if ($redisHealth -eq "PONG") {
        Write-Status -Label "Redis" -Value "Healthy" -Color Green
    }
    else {
        Write-Status -Label "Redis" -Value "Unavailable" -Color Red
    }

    Write-Host ""
}

function Show-Logs {
    Write-Header "Service Logs"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service

    $logArgs = @('logs', "--tail=$Tail")
    if ($Follow) { $logArgs += '-f' }
    if ($svcName) { $logArgs += $svcName }

    Invoke-DockerCompose -Arguments $logArgs -PassThru
}

function Invoke-Migration {
    Write-Header "Database Migration"

    if (-not (Test-DockerRunning)) { return }

    Write-Host "  Running Prisma migrations..." -ForegroundColor Cyan

    docker exec fallout1-api npx prisma migrate deploy

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Migrations complete." -ForegroundColor Green
    }
    else {
        Write-Host "  Migration failed!" -ForegroundColor Red
    }
}

function Build-Containers {
    Write-Header "Building Containers"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service

    Write-Host "  Building images..." -ForegroundColor Cyan

    if ($svcName) {
        Invoke-DockerCompose -Arguments @('build', '--no-cache', $svcName) -PassThru
    }
    else {
        Invoke-DockerCompose -Arguments @('build', '--no-cache') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Build complete." -ForegroundColor Green
    }
}

function Clean-Environment {
    Write-Header "Cleaning Environment"

    if (-not (Test-DockerRunning)) { return }

    Write-Host "  WARNING: This will remove all containers, volumes, and images!" -ForegroundColor Yellow
    $confirm = Read-Host "  Are you sure? (yes/no)"

    if ($confirm -ne 'yes') {
        Write-Host "  Cancelled." -ForegroundColor Cyan
        return
    }

    Write-Host "  Stopping containers..." -ForegroundColor Cyan
    Invoke-DockerCompose -Arguments @('down', '-v', '--rmi', 'local') -PassThru

    Write-Host "  Removing orphan volumes..." -ForegroundColor Cyan
    $null = docker volume prune -f 2>&1

    Write-Host "  Clean complete." -ForegroundColor Green
}

function Enter-Shell {
    Write-Header "Container Shell"

    if (-not (Test-DockerRunning)) { return }

    $svcName = Get-ServiceName $Service
    if (-not $svcName -or $Service -eq 'all') {
        $svcName = 'fallout1-api'
    }

    Write-Host "  Connecting to $svcName..." -ForegroundColor Cyan
    docker exec -it $svcName sh
}

# Main execution
Show-Banner

switch ($PSCmdlet.ParameterSetName) {
    'Start'   { Start-Services }
    'Stop'    { Stop-Services }
    'Restart' { Restart-Services }
    'Status'  { Show-Status }
    'Logs'    { Show-Logs }
    'Migrate' { Invoke-Migration }
    'Build'   { Build-Containers }
    'Clean'   { Clean-Environment }
    'Shell'   { Enter-Shell }
    default   { Show-Status }
}

Write-Host ""
