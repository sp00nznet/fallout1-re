<#
.SYNOPSIS
    Fallout 1 Multiplayer Server Management Script

.DESCRIPTION
    Manages the Docker-based multiplayer server stack including
    the web frontend, API server, PostgreSQL, and Redis.

.PARAMETER Start
    Start all services

.PARAMETER Stop
    Stop all services

.PARAMETER Restart
    Restart services (all or specific)

.PARAMETER Status
    Show service status

.PARAMETER Logs
    View service logs

.PARAMETER Migrate
    Run database migrations

.PARAMETER Build
    Rebuild containers

.PARAMETER Clean
    Remove containers, volumes, and images

.PARAMETER Service
    Specific service to target (web, api, postgres, redis)

.PARAMETER Follow
    Follow log output (use with -Logs)

.PARAMETER Tail
    Number of log lines to show (default: 100)

.EXAMPLE
    .\server.ps1 -Start

.EXAMPLE
    .\server.ps1 -Logs -Service api -Follow

.EXAMPLE
    .\server.ps1 -Restart -Service api
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

# Colors
$Colors = @{
    Success = 'Green'
    Error   = 'Red'
    Warning = 'Yellow'
    Info    = 'Cyan'
    Header  = 'Magenta'
}

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Header
    Write-Host "  $Text" -ForegroundColor $Colors.Header
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Header
    Write-Host ""
}

function Write-Status {
    param(
        [string]$Text,
        [string]$Status,
        [string]$Color = 'White'
    )
    Write-Host "  $Text : " -NoNewline
    Write-Host $Status -ForegroundColor $Color
}

function Test-DockerRunning {
    try {
        docker info 2>&1 | Out-Null
        return $true
    }
    catch {
        Write-Host "ERROR: Docker is not running!" -ForegroundColor $Colors.Error
        Write-Host "Please start Docker Desktop and try again." -ForegroundColor $Colors.Warning
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
        $cmd = "docker-compose -f `"$ComposeFile`" $($Arguments -join ' ')"
        if ($PassThru) {
            Invoke-Expression $cmd
        }
        else {
            Invoke-Expression $cmd | Out-Null
        }
    }
    finally {
        Pop-Location
    }
}

function Show-Banner {
    Write-Host @"

    ███████╗ █████╗ ██╗     ██╗      ██████╗ ██╗   ██╗████████╗     ██╗
    ██╔════╝██╔══██╗██║     ██║     ██╔═══██╗██║   ██║╚══██╔══╝    ███║
    █████╗  ███████║██║     ██║     ██║   ██║██║   ██║   ██║       ╚██║
    ██╔══╝  ██╔══██║██║     ██║     ██║   ██║██║   ██║   ██║        ██║
    ██║     ██║  ██║███████╗███████╗╚██████╔╝╚██████╔╝   ██║        ██║
    ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝    ╚═╝        ╚═╝
                        MULTIPLAYER SERVER

"@ -ForegroundColor $Colors.Header
}

function Start-Services {
    Write-Header "Starting Services"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service

    Write-Host "  Starting containers..." -ForegroundColor $Colors.Info

    if ($serviceName) {
        Invoke-DockerCompose @('up', '-d', $serviceName) -PassThru
    }
    else {
        Invoke-DockerCompose @('up', '-d') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "  Services started successfully!" -ForegroundColor $Colors.Success
        Write-Host ""
        Write-Host "  Web Client:  http://localhost:8080" -ForegroundColor $Colors.Info
        Write-Host "  API:         http://localhost:8080/api" -ForegroundColor $Colors.Info
        Write-Host "  WebSocket:   ws://localhost:8080/ws" -ForegroundColor $Colors.Info
        Write-Host ""
    }
    else {
        Write-Host "  Failed to start services!" -ForegroundColor $Colors.Error
    }
}

function Stop-Services {
    Write-Header "Stopping Services"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service

    Write-Host "  Stopping containers..." -ForegroundColor $Colors.Info

    if ($serviceName) {
        Invoke-DockerCompose @('stop', $serviceName) -PassThru
    }
    else {
        Invoke-DockerCompose @('down') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Services stopped." -ForegroundColor $Colors.Success
    }
}

function Restart-Services {
    Write-Header "Restarting Services"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service

    if ($serviceName) {
        Write-Host "  Restarting $Service..." -ForegroundColor $Colors.Info
        Invoke-DockerCompose @('restart', $serviceName) -PassThru
    }
    else {
        Write-Host "  Restarting all services..." -ForegroundColor $Colors.Info
        Invoke-DockerCompose @('restart') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Restart complete." -ForegroundColor $Colors.Success
    }
}

function Show-Status {
    Write-Header "Service Status"

    if (-not (Test-DockerRunning)) { return }

    $containers = docker ps -a --filter "name=fallout1" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1

    if ($containers) {
        Write-Host "  NAME                    STATUS                  PORTS" -ForegroundColor $Colors.Info
        Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor Gray

        foreach ($line in $containers) {
            $parts = $line -split "`t"
            if ($parts.Count -ge 2) {
                $name = $parts[0].PadRight(24)
                $status = $parts[1]
                $ports = if ($parts.Count -ge 3) { $parts[2] } else { "" }

                $color = if ($status -match "Up") { $Colors.Success } else { $Colors.Warning }
                Write-Host "  $name" -NoNewline
                Write-Host $status.PadRight(24) -ForegroundColor $color -NoNewline
                Write-Host $ports -ForegroundColor Gray
            }
        }
    }
    else {
        Write-Host "  No containers found." -ForegroundColor $Colors.Warning
    }

    # Check database connection
    Write-Host ""
    Write-Host "  Database Health:" -ForegroundColor $Colors.Info
    $pgHealth = docker exec fallout1-postgres pg_isready -U fallout1 2>&1
    if ($pgHealth -match "accepting") {
        Write-Status "PostgreSQL" "Healthy" $Colors.Success
    }
    else {
        Write-Status "PostgreSQL" "Unavailable" $Colors.Error
    }

    # Check Redis
    $redisHealth = docker exec fallout1-redis redis-cli ping 2>&1
    if ($redisHealth -eq "PONG") {
        Write-Status "Redis" "Healthy" $Colors.Success
    }
    else {
        Write-Status "Redis" "Unavailable" $Colors.Error
    }

    Write-Host ""
}

function Show-Logs {
    Write-Header "Service Logs"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service

    $args = @('logs', "--tail=$Tail")
    if ($Follow) { $args += '-f' }
    if ($serviceName) { $args += $serviceName }

    Invoke-DockerCompose $args -PassThru
}

function Invoke-Migration {
    Write-Header "Database Migration"

    if (-not (Test-DockerRunning)) { return }

    Write-Host "  Running Prisma migrations..." -ForegroundColor $Colors.Info

    docker exec fallout1-api npx prisma migrate deploy

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Migrations complete." -ForegroundColor $Colors.Success
    }
    else {
        Write-Host "  Migration failed!" -ForegroundColor $Colors.Error
    }
}

function Build-Containers {
    Write-Header "Building Containers"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service

    Write-Host "  Building images..." -ForegroundColor $Colors.Info

    if ($serviceName) {
        Invoke-DockerCompose @('build', '--no-cache', $serviceName) -PassThru
    }
    else {
        Invoke-DockerCompose @('build', '--no-cache') -PassThru
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Build complete." -ForegroundColor $Colors.Success
    }
}

function Clean-Environment {
    Write-Header "Cleaning Environment"

    if (-not (Test-DockerRunning)) { return }

    Write-Host "  WARNING: This will remove all containers, volumes, and images!" -ForegroundColor $Colors.Warning
    $confirm = Read-Host "  Are you sure? (yes/no)"

    if ($confirm -ne 'yes') {
        Write-Host "  Cancelled." -ForegroundColor $Colors.Info
        return
    }

    Write-Host "  Stopping containers..." -ForegroundColor $Colors.Info
    Invoke-DockerCompose @('down', '-v', '--rmi', 'local') -PassThru

    Write-Host "  Removing orphan volumes..." -ForegroundColor $Colors.Info
    docker volume prune -f 2>&1 | Out-Null

    Write-Host "  Clean complete." -ForegroundColor $Colors.Success
}

function Enter-Shell {
    Write-Header "Container Shell"

    if (-not (Test-DockerRunning)) { return }

    $serviceName = Get-ServiceName $Service
    if (-not $serviceName -or $Service -eq 'all') {
        $serviceName = 'fallout1-api'
    }

    Write-Host "  Connecting to $serviceName..." -ForegroundColor $Colors.Info
    docker exec -it $serviceName sh
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
