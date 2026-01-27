import { WebSocket } from 'ws';
import { prisma, redis } from '../index.js';
import { broadcastToGame } from './connection.js';

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  username?: string;
  gameId?: string;
  participantId?: string;
}

interface GameState {
  session: {
    id: string;
    name: string;
    status: string;
    currentMap: string;
    inCombat: boolean;
    combatRound: number;
    currentTurn: number;
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

export async function handleSyncMessage(
  ws: ExtendedWebSocket,
  subtype: string,
  payload: any
) {
  if (!ws.userId || !ws.gameId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
    return;
  }

  switch (subtype) {
    case 'request':
      if (payload.full) {
        await sendFullState(ws);
      } else {
        await sendDeltaState(ws, payload.since);
      }
      break;
  }
}

async function sendFullState(ws: ExtendedWebSocket) {
  if (!ws.gameId) return;

  const game = await prisma.gameSession.findUnique({
    where: { id: ws.gameId },
    include: {
      participants: {
        include: {
          user: { select: { username: true } },
          character: { select: { name: true, maxHp: true, maxAp: true } }
        }
      }
    }
  });

  if (!game) {
    ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
    return;
  }

  // Get turn info from Redis
  const turnData = await redis.get(`game:${ws.gameId}:turns`);
  const turnInfo = turnData ? JSON.parse(turnData) : null;

  // Get timer info
  const timerData = await redis.get(`game:${ws.gameId}:timer`);
  const timer = timerData ? JSON.parse(timerData) : null;

  const state: GameState = {
    session: {
      id: game.id,
      name: game.name,
      status: game.status,
      currentMap: game.currentMap,
      inCombat: game.inCombat,
      combatRound: game.combatRound,
      currentTurn: game.currentTurn,
      turnTimeBase: game.turnTimeBase
    },
    participants: game.participants.map(p => ({
      id: p.id,
      userId: p.userId,
      username: p.user.username,
      characterName: p.character?.name || 'Vault Dweller',
      isHost: p.isHost,
      isBot: p.isBot,
      isReady: p.isReady,
      isConnected: p.isConnected,
      tileIndex: p.tileIndex,
      elevation: p.elevation,
      rotation: p.rotation,
      currentHp: p.currentHp,
      maxHp: p.character?.maxHp || 30,
      currentAp: p.currentAp,
      maxAp: p.character?.maxAp || 7,
      isInCombat: p.isInCombat,
      isDead: p.isDead,
      turnOrder: p.turnOrder
    }))
  };

  if (turnInfo) {
    state.turnInfo = {
      order: turnInfo.order,
      currentIndex: turnInfo.currentIndex,
      currentPlayerId: turnInfo.order[turnInfo.currentIndex],
      round: turnInfo.round,
      timeRemaining: timer?.endTime ? Math.max(0, timer.endTime - Date.now()) / 1000 : undefined
    };
  }

  ws.send(JSON.stringify({
    type: 'sync:full-state',
    state,
    timestamp: Date.now()
  }));
}

async function sendDeltaState(ws: ExtendedWebSocket, since: number) {
  if (!ws.gameId) return;

  // Get changes since timestamp from Redis
  const changes = await redis.lrange(`game:${ws.gameId}:changes`, 0, -1);
  const relevantChanges = changes
    .map(c => JSON.parse(c))
    .filter(c => c.timestamp > since);

  if (relevantChanges.length === 0) {
    ws.send(JSON.stringify({
      type: 'sync:delta',
      changes: [],
      timestamp: Date.now()
    }));
    return;
  }

  ws.send(JSON.stringify({
    type: 'sync:delta',
    changes: relevantChanges,
    timestamp: Date.now()
  }));
}

// Utility to record and broadcast state changes
export async function recordChange(gameId: string, change: object) {
  const changeWithTimestamp = {
    ...change,
    timestamp: Date.now()
  };

  // Store in Redis (keep last 100 changes)
  await redis.lpush(`game:${gameId}:changes`, JSON.stringify(changeWithTimestamp));
  await redis.ltrim(`game:${gameId}:changes`, 0, 99);
  await redis.expire(`game:${gameId}:changes`, 3600);

  // Broadcast to all connected players
  broadcastToGame(gameId, {
    type: 'sync:delta',
    changes: [changeWithTimestamp],
    timestamp: Date.now()
  });
}

// Broadcast position update
export async function broadcastPositionUpdate(
  gameId: string,
  participantId: string,
  position: { tileIndex: number; elevation: number; rotation: number }
) {
  await recordChange(gameId, {
    type: 'position',
    participantId,
    ...position
  });
}

// Broadcast health update
export async function broadcastHealthUpdate(
  gameId: string,
  participantId: string,
  health: { currentHp: number; maxHp: number }
) {
  await recordChange(gameId, {
    type: 'health',
    participantId,
    ...health
  });
}

// Broadcast AP update
export async function broadcastApUpdate(
  gameId: string,
  participantId: string,
  ap: { currentAp: number; maxAp: number }
) {
  await recordChange(gameId, {
    type: 'ap',
    participantId,
    ...ap
  });
}

// Broadcast combat state change
export async function broadcastCombatState(
  gameId: string,
  inCombat: boolean,
  round: number
) {
  await recordChange(gameId, {
    type: 'combat-state',
    inCombat,
    round
  });
}

// Broadcast player death
export async function broadcastPlayerDeath(
  gameId: string,
  participantId: string,
  killerId?: string
) {
  await recordChange(gameId, {
    type: 'death',
    participantId,
    killerId
  });
}
