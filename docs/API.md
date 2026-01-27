# API Reference

Complete reference for the Fallout 1 multiplayer REST and WebSocket APIs.

---

## Table of Contents

- [Authentication](#authentication)
- [REST API](#rest-api)
  - [Auth Endpoints](#auth-endpoints)
  - [User Endpoints](#user-endpoints)
  - [Save Endpoints](#save-endpoints)
  - [Game Endpoints](#game-endpoints)
  - [Bot Endpoints](#bot-endpoints)
- [WebSocket API](#websocket-api)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

---

## Authentication

All authenticated endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <access_token>
```

### Token Refresh

Access tokens expire after 15 minutes. Use the refresh token to get new tokens:

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "<refresh_token>"
}
```

---

## REST API

Base URL: `/api`

### Auth Endpoints

#### Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "VaultDweller",
  "password": "securepassword123"
}
```

**Response** `201 Created`
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "VaultDweller",
    "createdAt": "2024-01-15T10:00:00Z"
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response** `200 OK`
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "username": "VaultDweller",
    "totalPlayTime": 3600,
    "gamesPlayed": 10,
    "gamesWon": 3
  },
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Refresh Token

```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJ..."
}
```

**Response** `200 OK`
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

#### Logout

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

---

### User Endpoints

All require authentication.

#### Get Profile

```http
GET /api/users/me
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "VaultDweller",
  "createdAt": "2024-01-15T10:00:00Z",
  "lastLoginAt": "2024-01-20T15:30:00Z",
  "totalPlayTime": 3600,
  "gamesPlayed": 10,
  "gamesWon": 3,
  "_count": {
    "saves": 3,
    "characters": 2
  }
}
```

#### Get Characters

```http
GET /api/users/me/characters
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Vault Dweller",
    "level": 5,
    "strength": 6,
    "perception": 7,
    "endurance": 5,
    "charisma": 4,
    "intelligence": 8,
    "agility": 6,
    "luck": 5,
    "maxHp": 45,
    "maxAp": 8,
    "sequence": 14,
    "skills": {"smallGuns": 75, "lockpick": 60},
    "perks": ["awareness"],
    "inventory": []
  }
]
```

#### Create Character

```http
POST /api/users/me/characters
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Character",
  "level": 1,
  "strength": 5,
  "perception": 5,
  "endurance": 5,
  "charisma": 5,
  "intelligence": 5,
  "agility": 5,
  "luck": 5
}
```

**Response** `201 Created`

#### Get Statistics

```http
GET /api/users/me/stats
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
{
  "totalPlayTime": 3600,
  "gamesPlayed": 10,
  "gamesWon": 3,
  "totalKills": 47,
  "totalDeaths": 12,
  "kdRatio": "3.92",
  "winRate": "30.0%",
  "recentGames": [...]
}
```

---

### Save Endpoints

All require authentication.

#### List Saves

```http
GET /api/saves
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
[
  {
    "id": "uuid",
    "slot": 1,
    "name": "Shady Sands",
    "location": "Shady Sands",
    "level": 3,
    "playTime": 1800,
    "isAutoSave": false,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T12:00:00Z"
  }
]
```

#### Get Save

```http
GET /api/saves/:slot
Authorization: Bearer <token>
```

#### Upload Save

```http
POST /api/saves
Authorization: Bearer <token>
Content-Type: application/json

{
  "slot": 1,
  "name": "My Save",
  "location": "Vault 13",
  "level": 1,
  "playTime": 300,
  "characterSnapshot": {
    "name": "Vault Dweller",
    "level": 1,
    "strength": 5,
    ...
  },
  "stateData": "<base64 encoded save data>"
}
```

**Response** `201 Created`

#### Download Save

```http
GET /api/saves/:slot/download
Authorization: Bearer <token>
```

**Response** `200 OK`
Binary save file with `Content-Type: application/octet-stream`

#### Delete Save

```http
DELETE /api/saves/:slot
Authorization: Bearer <token>
```

**Response** `200 OK`

#### Extract Character

```http
POST /api/saves/:slot/extract-character
Authorization: Bearer <token>
```

Creates a new character from the save's character snapshot.

**Response** `201 Created` with character object

---

### Game Endpoints

#### List Games (Public)

```http
GET /api/games
GET /api/games?status=LOBBY
GET /api/games?visibility=PUBLIC
```

**Response** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Wasteland Arena",
    "status": "LOBBY",
    "visibility": "PUBLIC",
    "maxPlayers": 4,
    "hostLevel": 5,
    "minLevel": 1,
    "maxLevel": 99,
    "currentMap": "desert1",
    "turnTimeBase": 30,
    "host": {
      "id": "uuid",
      "username": "HostPlayer"
    },
    "participants": [...],
    "_count": {
      "participants": 2
    }
  }
]
```

#### Get Game

```http
GET /api/games/:id
```

#### Create Game

```http
POST /api/games
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Game",
  "visibility": "PUBLIC",
  "maxPlayers": 4,
  "minLevel": 1,
  "maxLevel": 99,
  "turnTimeBase": 30,
  "characterId": "uuid"
}
```

**Response** `201 Created`

#### Join Game

```http
POST /api/games/:id/join
Authorization: Bearer <token>
Content-Type: application/json

{
  "password": "optional",
  "characterId": "uuid"
}
```

**Response** `201 Created` with participant object

#### Leave Game

```http
POST /api/games/:id/leave
Authorization: Bearer <token>
```

#### Toggle Ready

```http
POST /api/games/:id/ready
Authorization: Bearer <token>
```

**Response** `200 OK`
```json
{
  "isReady": true
}
```

#### Start Game (Host Only)

```http
POST /api/games/:id/start
Authorization: Bearer <token>
```

#### Kick Player (Host Only)

```http
POST /api/games/:id/kick/:participantId
Authorization: Bearer <token>
```

#### Update Settings (Host Only)

```http
PATCH /api/games/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Name",
  "maxPlayers": 6,
  "turnTimeBase": 45
}
```

#### Delete Game (Host Only)

```http
DELETE /api/games/:id
Authorization: Bearer <token>
```

---

### Bot Endpoints

All require authentication.

#### List Bots

```http
GET /api/bots
Authorization: Bearer <token>
```

#### Get Bot

```http
GET /api/bots/:id
Authorization: Bearer <token>
```

#### Create Bot

```http
POST /api/bots
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "ArenaBot1",
  "type": "HOST",
  "config": {
    "gameNameTemplate": "Arena #{n}",
    "maxPlayers": 4,
    "turnTime": 30,
    "createInterval": 300
  }
}
```

#### Update Bot

```http
PATCH /api/bots/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "config": {
    "aggressiveness": 0.8
  },
  "isEnabled": true
}
```

#### Start Bot

```http
POST /api/bots/:id/start
Authorization: Bearer <token>
```

#### Stop Bot

```http
POST /api/bots/:id/stop
Authorization: Bearer <token>
```

#### Delete Bot

```http
DELETE /api/bots/:id
Authorization: Bearer <token>
```

#### Start All Bots

```http
POST /api/bots/start-all
Authorization: Bearer <token>
```

#### Stop All Bots

```http
POST /api/bots/stop-all
Authorization: Bearer <token>
```

---

## WebSocket API

Connect to `/ws` endpoint.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth:login',
    token: accessToken
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(message.type, message);
};
```

### Message Format

All messages follow this structure:

```typescript
interface Message {
  type: string;
  [key: string]: any;
}
```

### Client Messages

| Type | Payload | Description |
|------|---------|-------------|
| `auth:login` | `{ token: string }` | Authenticate |
| `session:join` | `{ gameId: string }` | Join game |
| `session:leave` | `{}` | Leave game |
| `session:ready` | `{}` | Toggle ready |
| `sync:request` | `{ full?: boolean, since?: number }` | Request state |
| `action:move` | `{ targetTile: number, elevation?: number }` | Move |
| `action:attack` | `{ targetId: string, weaponMode: string, aimedLocation?: string }` | Attack |
| `action:use-item` | `{ itemId: string, targetId?: string }` | Use item |
| `action:interact` | `{ objectId: string, action: string }` | Interact |
| `turn:end` | `{}` | End turn |
| `chat:message` | `{ message: string }` | Send chat |

### Server Messages

| Type | Payload | Description |
|------|---------|-------------|
| `connected` | `{ message: string }` | Connection established |
| `auth:success` | `{ userId, username }` | Auth successful |
| `auth:error` | `{ message }` | Auth failed |
| `auth:kicked` | `{ message }` | Kicked (connected elsewhere) |
| `session:joined` | `{ gameId, participantId }` | Joined session |
| `session:reconnect-available` | `{ gameId, gameName }` | Can reconnect |
| `sync:full-state` | `{ state, timestamp }` | Full state |
| `sync:delta` | `{ changes[], timestamp }` | State changes |
| `player:connected` | `{ userId, username }` | Player connected |
| `player:disconnected` | `{ userId, username }` | Player disconnected |
| `player:joined` | `{ participant }` | Player joined |
| `player:left` | `{ userId }` | Player left |
| `player:ready-changed` | `{ participantId, isReady }` | Ready toggled |
| `turn:start` | `{ participantId, timeLimit, round, ap }` | Turn started |
| `turn:end` | `{ participantId, timeout }` | Turn ended |
| `combat:started` | `{ round, turnOrder[], firstPlayerId }` | Combat begun |
| `combat:result` | `{ attackerId, targetId, hit, damage, ... }` | Attack result |
| `combat:new-round` | `{ round }` | New round |
| `combat:ended` | `{ winnerId? }` | Combat ended |
| `game:ended` | `{ winnerId? }` | Game finished |
| `chat:message` | `{ id, senderId, senderName, message, timestamp }` | Chat message |
| `error` | `{ message }` | Error occurred |

---

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "details": [...]  // Optional validation details
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (invalid/expired token) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not Found |
| `500` | Internal Server Error |

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| `/api/auth/login` | 5 req/min per IP |
| `/api/auth/register` | 3 req/min per IP |
| All other endpoints | 100 req/min per user |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705320000
```
