# Fallout 1 HTML5 Web Port - Docker Deployment

This directory contains Docker configuration for running the Fallout 1 HTML5 port in a container.

> **IMPORTANT**: This directory and its contents should NOT be committed to git. It contains or will contain your personal game files.

## Prerequisites

- Docker Desktop installed and running
- Your legally owned copy of Fallout 1 game files

## Quick Start

### 1. Copy Game Files

Copy your Fallout 1 game files to the `gamefiles/` directory:

```
docker/
└── gamefiles/
    ├── master.dat      (required)
    ├── critter.dat     (required)
    └── ...other files
```

### 2. Convert Assets

Run the asset converter to extract and convert game files:

```powershell
.\fallout-web.ps1 convert
```

This will:
- Extract DAT archives
- Convert FRM sprites to web-friendly format
- Copy palette and data files

### 3. Build Container

```powershell
.\fallout-web.ps1 build
```

### 4. Start Container

```powershell
.\fallout-web.ps1 start
```

### 5. Play!

Open your browser to: **http://localhost:8080**

## PowerShell Commands

| Command | Description |
|---------|-------------|
| `.\fallout-web.ps1 start` | Start the web server |
| `.\fallout-web.ps1 stop` | Stop the container |
| `.\fallout-web.ps1 restart` | Restart the container |
| `.\fallout-web.ps1 build` | Rebuild the Docker image |
| `.\fallout-web.ps1 convert` | Convert game assets |
| `.\fallout-web.ps1 logs` | View container logs |
| `.\fallout-web.ps1 status` | Check status |
| `.\fallout-web.ps1 clean` | Remove containers/images |
| `.\fallout-web.ps1 help` | Show help |

## Directory Structure

```
docker/
├── Dockerfile              # Main web server image
├── Dockerfile.converter    # Asset conversion image
├── docker-compose.yml      # Container orchestration
├── convert-assets.sh       # Asset conversion script
├── fallout-web.ps1         # PowerShell management script
├── README.md               # This file
├── gamefiles/              # Your game files (gitignored)
│   ├── master.dat
│   └── critter.dat
└── assets/                 # Converted assets (gitignored)
    ├── sprites/
    ├── data/
    └── ...
```

## Troubleshooting

### "Game files not found"
Make sure you've copied `master.dat` and `critter.dat` to the `gamefiles/` directory.

### "Docker is not installed"
Install Docker Desktop from https://www.docker.com/products/docker-desktop

### Container won't start
Check logs with `.\fallout-web.ps1 logs`

### Assets not loading in browser
1. Make sure you ran `.\fallout-web.ps1 convert` first
2. Check that the `assets/` directory has files
3. Rebuild with `.\fallout-web.ps1 build`

## Port Configuration

By default, the container runs on port 8080. To change this, edit `docker-compose.yml`:

```yaml
ports:
  - "3000:80"  # Change 8080 to your preferred port
```
