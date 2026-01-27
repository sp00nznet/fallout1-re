# Multiplayer Guide

This document explains how the Fallout 1 multiplayer system works, including the WebSocket protocol, game flow, and integration with the original game engine.

---

## Table of Contents

- [Overview](#overview)
- [Game Flow](#game-flow)
- [Turn System](#turn-system)
- [WebSocket Protocol](#websocket-protocol)
- [State Synchronization](#state-synchronization)
- [Combat System](#combat-system)
- [Bot System](#bot-system)
- [Integration](#integration)

---

## Overview

The multiplayer system transforms Fallout 1's single-player experience into a shared world where multiple players can:

- Explore the wasteland together
- Engage in turn-based combat
- Trade items and interact
- Chat in real-time

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Game Session** | A multiplayer game instance with a host and participants |
| **Participant** | A player or bot in a game session |
| **Turn** | A player's opportunity to act during combat |
| **State Sync** | Real-time synchronization of game state |

---

## Game Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Login   │───►│  Browse  │───►│  Lobby   │───►│  Playing │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │               │
                     │  Create Game  │  Ready Up     │  Combat
                     │  Join Game    │  Chat         │  Explore
                     │               │  Settings     │  Trade
```

### States

1. **Login**: User authenticates or registers
2. **Browse**: View available games, create new game
3. **Lobby**: Wait for players, ready up, configure settings
4. **Playing**: Active gameplay with real-time sync

---

## Turn System

Combat uses a turn-based system matching the original Fallout mechanics.

### Turn Order

Players are sorted by **Sequence** stat (descending), with **Luck** as a tiebreaker:

```typescript
// From combat.c compare_faster() logic
turnOrder = participants.sort((a, b) => {
  if (b.sequence !== a.sequence) {
    return b.sequence - a.sequence;  // Higher sequence first
  }
  return b.luck - a.luck;  // Luck as tiebreaker
});
```

### Turn Timing

```
Base Turn Time: 30 seconds per player
Total Round Time = Base × Player Count
Per-Player Time = Total ÷ Player Count

Example (4 players):
├── Total round: 30 × 4 = 120 seconds
└── Each player: 30 seconds
```

### Action Point Costs

| Action | AP Cost |
|--------|---------|
| Move (per hex) | 1 |
| Single attack | 4 |
| Burst attack | 5 |
| Aimed attack | 6 |
| Use item | 2 |
| Reload | 2 |

---

## WebSocket Protocol

All real-time communication uses WebSocket with JSON messages.

### Connection Flow

```
Client                                Server
  │                                     │
  │──── Connect to /ws ────────────────►│
  │◄─── { type: "connected" } ──────────│
  │                                     │
  │──── { type: "auth:login",          │
  │       token: "jwt..." } ───────────►│
  │◄─── { type: "auth:success" } ───────│
  │                                     │
  │──── { type: "session:join",        │
  │       gameId: "..." } ─────────────►│
  │◄─── { type: "sync:full-state" } ────│
```

### Client → Server Messages

| Type | Payload | Description |
|------|---------|-------------|
| `auth:login` | `{ token }` | Authenticate connection |
| `session:join` | `{ gameId }` | Join a game session |
| `session:leave` | `{}` | Leave current session |
| `session:ready` | `{}` | Toggle ready state |
| `action:move` | `{ targetTile, elevation? }` | Move player |
| `action:attack` | `{ targetId, weaponMode, aimedLocation? }` | Attack target |
| `action:use-item` | `{ itemId, targetId? }` | Use inventory item |
| `turn:end` | `{}` | End current turn |
| `chat:message` | `{ message }` | Send chat message |

### Server → Client Messages

| Type | Payload | Description |
|------|---------|-------------|
| `auth:success` | `{ userId, username }` | Authentication successful |
| `auth:error` | `{ message }` | Authentication failed |
| `sync:full-state` | `{ state, timestamp }` | Full game state |
| `sync:delta` | `{ changes, timestamp }` | Incremental changes |
| `turn:start` | `{ participantId, timeLimit, round }` | Turn begins |
| `turn:end` | `{ participantId, timeout }` | Turn ends |
| `combat:started` | `{ round, turnOrder }` | Combat initiated |
| `combat:result` | `{ attackerId, targetId, hit, damage, ... }` | Attack outcome |
| `combat:ended` | `{ winnerId? }` | Combat finished |
| `player:joined` | `{ participant }` | Player joined session |
| `player:left` | `{ userId }` | Player left session |
| `chat:message` | `{ senderId, senderName, message }` | Chat received |

---

## State Synchronization

### Full State

Sent when joining a game or on request:

```typescript
interface GameState {
  session: {
    id: string;
    name: string;
    status: 'LOBBY' | 'PLAYING' | 'FINISHED';
    currentMap: string;
    inCombat: boolean;
    combatRound: number;
    turnTimeBase: number;
  };
  participants: Array<{
    id: string;
    userId: string;
    username: string;
    characterName: string;
    isHost: boolean;
    isBot: boolean;
    isReady: boolean;
    isConnected: boolean;
    tileIndex: number;
    elevation: number;
    rotation: number;
    currentHp: number;
    maxHp: number;
    currentAp: number;
    maxAp: number;
    isInCombat: boolean;
    isDead: boolean;
    turnOrder: number;
  }>;
  turnInfo?: {
    order: string[];
    currentIndex: number;
    currentPlayerId: string;
    round: number;
    timeRemaining?: number;
  };
}
```

### Delta Updates

Incremental changes sent in real-time:

```typescript
// Position change
{ type: 'position', participantId, tileIndex, elevation, rotation }

// Health change
{ type: 'health', participantId, currentHp, maxHp }

// AP change
{ type: 'ap', participantId, currentAp, maxAp }

// Player death
{ type: 'death', participantId, killerId? }
```

---

## Combat System

### Hit Chance Calculation

```typescript
function calculateHitChance(attacker, target, distance, weaponMode, aimedLocation?) {
  // Base chance from perception
  let chance = 50 + attacker.perception * 2;

  // Distance penalty
  chance -= distance * 4;

  // Aimed shot penalty
  if (aimedLocation) {
    switch (aimedLocation) {
      case 'eyes': chance -= 40; break;
      case 'head': chance -= 20; break;
      case 'groin': chance -= 30; break;
      case 'legs': chance -= 10; break;
      case 'arms': chance -= 10; break;
    }
  }

  // Burst bonus
  if (weaponMode === 'burst') {
    chance += 20;
  }

  // Target agility affects dodge
  chance -= target.agility;

  // Clamp between 5% and 95%
  return Math.max(5, Math.min(95, chance));
}
```

### Damage Calculation

```typescript
function calculateDamage(attacker, isCritical, aimedLocation?) {
  // Base damage from strength
  let damage = 10 + attacker.strength + Math.random() * 10;

  // Critical hit multiplier
  if (isCritical) {
    damage *= 1.5;
  }

  // Aimed location bonus
  if (aimedLocation === 'eyes') damage *= 1.3;
  if (aimedLocation === 'groin') damage *= 1.2;

  return Math.floor(damage);
}
```

---

## Bot System

### Host Bots

Create and manage public games automatically:

```typescript
interface HostBotConfig {
  gameNameTemplate: string;   // "Wasteland Arena #{n}"
  maxPlayers: number;         // 2-8
  turnTime: number;           // 10-120 seconds
  createInterval: number;     // Seconds between game creation
  minPlayersToStart: number;  // Minimum humans to start
  waitTimeForPlayers: number; // Seconds to wait for players
}
```

### Player Bots

AI that joins games and plays:

```typescript
interface PlayerBotConfig {
  aggressiveness: number;     // 0-1: Attack vs defensive
  skillLevel: number;         // 0-1: Decision quality
  preferredWeapons: string[]; // Weapon preferences
  level: number;              // Character level
}
```

### Combat AI Decision Loop

```
1. Evaluate HP
   └── If HP < 30%: Consider healing (priority based on aggressiveness)

2. Evaluate targets
   └── For each enemy:
       ├── Calculate hit chance
       ├── Estimate damage
       └── Score = hitChance × damage × aggressiveness × targetHpFactor

3. Evaluate positioning
   ├── Too far from enemies: Move closer
   └── Too close (if defensive): Move away

4. Execute highest priority action or end turn
```

---

## Integration

### Using MultiplayerManager

```typescript
import { MultiplayerManager } from './multiplayer';

// Initialize
const mp = new MultiplayerManager({
  canvas: gameCanvas,
  tileWidth: 32,
  tileHeight: 16,
  gridWidth: 200
});

await mp.initialize();

// Show login if not authenticated
if (mp.getState() === 'offline') {
  mp.showLogin();
}

// Listen for state changes
mp.onStateChange((state) => {
  console.log('Multiplayer state:', state);
});

// In game loop
function gameLoop() {
  // Update camera position for player renderer
  mp.updateCamera(cameraX, cameraY);

  // Render other players
  mp.renderPlayers();
}

// When local player moves
mp.sendMove(targetTile, elevation);

// When local player attacks
mp.sendAttack(targetId, 'single', 'head');

// End turn
mp.endTurn();

// Check if it's our turn
if (mp.isMyTurn()) {
  // Enable action UI
}
```

### Direct Component Usage

```typescript
import {
  authService,
  gameService,
  multiplayerClient,
  stateSync
} from './multiplayer';

// Auth
await authService.login(email, password);

// Create game
const game = await gameService.createGame({
  name: 'My Game',
  maxPlayers: 4
});

// Connect WebSocket
await multiplayerClient.connect();
multiplayerClient.joinSession(game.id);

// Listen for state changes
stateSync.onStateChange((state) => {
  console.log('Players:', state.participants);
});

stateSync.onCombat((event) => {
  if (event.type === 'result') {
    console.log(`${event.attackerName} hit for ${event.damage}`);
  }
});
```
