# Fallout Reference Edition

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Web%20%7C%20Docker-blue" alt="Platform">
  <img src="https://img.shields.io/badge/Multiplayer-Supported-green" alt="Multiplayer">
  <img src="https://img.shields.io/badge/License-Sustainable%20Use-orange" alt="License">
</p>

A reverse-engineered source code recreation of **Fallout: A Post Nuclear Role Playing Game**, featuring an HTML5 web port and full multiplayer support.

---

## Overview

| Component | Description |
|-----------|-------------|
| **Native Engine** | Restored Windows/x86 source code matching the original binary |
| **Web Port** | HTML5/TypeScript browser-based client |
| **Multiplayer Server** | Node.js backend with real-time game sync |
| **Bot System** | AI players for solo or mixed games |

## Quick Start

### Option 1: Native Windows

Download latest build or compile from source. Copy `fallout-re.exe` to your Fallout directory as a drop-in replacement for `falloutw.exe`.

### Option 2: Web Browser (Single Player)

```bash
cd fallout1-web
npm install
npm run dev
```

Open http://localhost:5173

### Option 3: Multiplayer (Docker)

```powershell
# Start everything
.\scripts\server.ps1 -Start

# Or manually:
cd docker
docker-compose up -d
```

Open http://localhost:8080

---

## Project Structure

```
fallout1-re/
├── src/                    # Original C engine source
│   ├── game/               # Game logic (combat, dialogue, maps)
│   └── plib/               # Platform library (graphics, input)
│
├── fallout1-web/           # HTML5 Web Port
│   └── src/
│       ├── core/           # Engine, asset management
│       ├── platform/       # Graphics, audio, input, storage
│       ├── multiplayer/    # Real-time sync, player rendering
│       ├── ui/             # Login, lobby, game browser, HUD
│       └── services/       # Auth, game API clients
│
├── fallout1-server/        # Multiplayer Backend
│   └── src/
│       ├── api/            # REST endpoints
│       ├── websocket/      # Real-time communication
│       ├── services/       # Business logic
│       └── bots/           # AI player system
│
├── docker/                 # Container configs
├── scripts/                # Management scripts
└── docs/                   # Documentation
```

---

## Multiplayer Features

<table>
<tr>
<td width="50%">

### Player Features
- User registration & authentication
- Cloud save synchronization
- Character import from saves
- Public & private game lobbies
- Real-time chat
- Turn-based combat

</td>
<td width="50%">

### Technical Features
- WebSocket real-time sync
- JWT authentication
- PostgreSQL persistence
- Redis session caching
- Automatic reconnection
- Delta state updates

</td>
</tr>
</table>

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      NGINX (Port 8080)                       │
│         Static files + /api proxy + /ws WebSocket            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
┌───────────────────┐                    ┌───────────────────┐
│     Frontend      │◄──── WebSocket ───►│     Backend       │
│   (Vite + TS)     │                    │  (Node + Express) │
└───────────────────┘                    └───────────────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    ▼                             ▼                             ▼
             ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
             │ PostgreSQL  │              │    Redis    │              │  Bot System │
             │   Users     │              │  Sessions   │              │  Host/Player│
             │   Games     │              │  Timers     │              │     AI      │
             └─────────────┘              └─────────────┘              └─────────────┘
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Multiplayer Guide](docs/MULTIPLAYER.md) | How multiplayer works, WebSocket protocol |
| [Deployment Guide](docs/DEPLOYMENT.md) | Production deployment instructions |
| [API Reference](docs/API.md) | REST & WebSocket API documentation |

---

## Development

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Original Fallout game files

### Local Development

```bash
# Backend
cd fallout1-server
npm install
npm run dev

# Frontend (separate terminal)
cd fallout1-web
npm install
npm run dev
```

### Database Setup

```bash
cd fallout1-server
npx prisma migrate dev
npx prisma studio  # Optional: DB viewer
```

---

## Management Script

Use the PowerShell script for easy server management:

```powershell
# Start all services
.\scripts\server.ps1 -Start

# Stop all services
.\scripts\server.ps1 -Stop

# View logs
.\scripts\server.ps1 -Logs

# Restart specific service
.\scripts\server.ps1 -Restart -Service api

# Check status
.\scripts\server.ps1 -Status

# Run database migrations
.\scripts\server.ps1 -Migrate
```

---

## Bot System

The server includes AI bots for testing and filling games:

| Bot Type | Description |
|----------|-------------|
| **Host Bot** | Auto-creates public games at intervals |
| **Player Bot** | Joins games and plays using combat AI |

Bots evaluate targets based on hit chance × expected damage, heal when low HP, and use tactical positioning.

---

## Legal

The source code is produced by reverse engineering the original binary for documentation and interoperability purposes. You must own a legal copy of Fallout to use this project.

**Purchase:** [GOG](https://www.gog.com/game/fallout) | [Steam](https://store.steampowered.com/app/38400)

---

## Credits

- Original reverse engineering by [alexbatalov](https://github.com/alexbatalov)
- Based on [Fallout 2 Reference Edition](https://github.com/alexbatalov/fallout2-re)
- [c6](https://github.com/c6-dev): Extensive gameplay testing

---

## License

[Sustainable Use License](LICENSE.md)
