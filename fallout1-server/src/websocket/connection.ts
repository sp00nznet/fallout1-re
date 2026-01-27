import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { prisma, redis } from '../index.js';
import { handleSyncMessage } from './sync.js';
import { handleActionMessage } from './actions.js';
import { handleTurnMessage } from './turns.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallout1-dev-secret-change-in-prod';

interface AuthPayload {
  userId: string;
  username: string;
}

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  username?: string;
  gameId?: string;
  participantId?: string;
  isAlive?: boolean;
}

// Connection tracking
const connections = new Map<string, ExtendedWebSocket>(); // userId -> socket
const gameConnections = new Map<string, Set<string>>(); // gameId -> Set<userId>

export function getConnection(userId: string): ExtendedWebSocket | undefined {
  return connections.get(userId);
}

export function getGameConnections(gameId: string): ExtendedWebSocket[] {
  const userIds = gameConnections.get(gameId);
  if (!userIds) return [];
  return Array.from(userIds)
    .map(id => connections.get(id))
    .filter((ws): ws is ExtendedWebSocket => ws !== undefined);
}

export function broadcastToGame(gameId: string, message: object, excludeUserId?: string) {
  const sockets = getGameConnections(gameId);
  const data = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.userId !== excludeUserId && socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }
}

export function sendToUser(userId: string, message: object) {
  const socket = connections.get(userId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function setupWebSocket(wss: WebSocketServer) {
  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (extWs.isAlive === false) {
        return ws.terminate();
      }
      extWs.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', async () => {
      await handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send connection acknowledgment
    ws.send(JSON.stringify({ type: 'connected', message: 'Connection established' }));
  });
}

async function handleMessage(ws: ExtendedWebSocket, message: any) {
  const { type, ...payload } = message;

  switch (type) {
    // Authentication
    case 'auth:login':
      await handleAuth(ws, payload.token);
      break;

    // Session management
    case 'session:join':
      await handleJoinSession(ws, payload.gameId);
      break;

    case 'session:leave':
      await handleLeaveSession(ws);
      break;

    case 'session:ready':
      await handleReadyToggle(ws);
      break;

    // Chat
    case 'chat:message':
      await handleChatMessage(ws, payload.message);
      break;

    // Game sync
    case 'sync:request':
      await handleSyncMessage(ws, 'request', payload);
      break;

    // Player actions
    case 'action:move':
    case 'action:attack':
    case 'action:use-item':
    case 'action:interact':
      await handleActionMessage(ws, type, payload);
      break;

    // Turn management
    case 'turn:end':
    case 'turn:timeout':
      await handleTurnMessage(ws, type, payload);
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }));
  }
}

async function handleAuth(ws: ExtendedWebSocket, token: string) {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;

    // Close existing connection for this user
    const existing = connections.get(payload.userId);
    if (existing && existing !== ws) {
      existing.send(JSON.stringify({
        type: 'auth:kicked',
        message: 'Connected from another location'
      }));
      existing.close();
    }

    ws.userId = payload.userId;
    ws.username = payload.username;
    connections.set(payload.userId, ws);

    // Store connection in Redis
    await redis.setex(`ws:user:${payload.userId}`, 3600, 'connected');

    ws.send(JSON.stringify({
      type: 'auth:success',
      userId: payload.userId,
      username: payload.username
    }));

    // Check if user was in a game
    const participant = await prisma.gameParticipant.findFirst({
      where: { userId: payload.userId, isConnected: false },
      include: { session: true }
    });

    if (participant && participant.session.status !== 'FINISHED') {
      ws.send(JSON.stringify({
        type: 'session:reconnect-available',
        gameId: participant.sessionId,
        gameName: participant.session.name
      }));
    }
  } catch (error) {
    ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid token' }));
  }
}

async function handleJoinSession(ws: ExtendedWebSocket, gameId: string) {
  if (!ws.userId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }

  // Verify participant exists
  const participant = await prisma.gameParticipant.findFirst({
    where: { sessionId: gameId, userId: ws.userId }
  });

  if (!participant) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not a participant in this game' }));
    return;
  }

  // Leave current game if any
  if (ws.gameId) {
    await handleLeaveSession(ws);
  }

  // Join new game
  ws.gameId = gameId;
  ws.participantId = participant.id;

  // Track connection
  if (!gameConnections.has(gameId)) {
    gameConnections.set(gameId, new Set());
  }
  gameConnections.get(gameId)!.add(ws.userId);

  // Update participant connection status
  await prisma.gameParticipant.update({
    where: { id: participant.id },
    data: { isConnected: true, lastActiveAt: new Date() }
  });

  // Notify others
  broadcastToGame(gameId, {
    type: 'player:connected',
    userId: ws.userId,
    username: ws.username
  }, ws.userId);

  // Send current game state
  await handleSyncMessage(ws, 'request', { full: true });

  ws.send(JSON.stringify({
    type: 'session:joined',
    gameId,
    participantId: participant.id
  }));
}

async function handleLeaveSession(ws: ExtendedWebSocket) {
  if (!ws.userId || !ws.gameId) return;

  const gameId = ws.gameId;

  // Remove from tracking
  gameConnections.get(gameId)?.delete(ws.userId);
  if (gameConnections.get(gameId)?.size === 0) {
    gameConnections.delete(gameId);
  }

  // Update participant
  if (ws.participantId) {
    await prisma.gameParticipant.update({
      where: { id: ws.participantId },
      data: { isConnected: false }
    });
  }

  // Notify others
  broadcastToGame(gameId, {
    type: 'player:disconnected',
    userId: ws.userId,
    username: ws.username
  });

  ws.gameId = undefined;
  ws.participantId = undefined;
}

async function handleReadyToggle(ws: ExtendedWebSocket) {
  if (!ws.participantId || !ws.gameId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
    return;
  }

  const participant = await prisma.gameParticipant.findUnique({
    where: { id: ws.participantId }
  });

  if (!participant) return;

  const updated = await prisma.gameParticipant.update({
    where: { id: ws.participantId },
    data: { isReady: !participant.isReady }
  });

  broadcastToGame(ws.gameId, {
    type: 'player:ready-changed',
    participantId: ws.participantId,
    userId: ws.userId,
    isReady: updated.isReady
  });
}

async function handleChatMessage(ws: ExtendedWebSocket, message: string) {
  if (!ws.userId || !ws.gameId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
    return;
  }

  // Sanitize and validate message
  const sanitized = message.trim().slice(0, 500);
  if (!sanitized) return;

  // Store in database
  const chatMessage = await prisma.chatMessage.create({
    data: {
      sessionId: ws.gameId,
      senderId: ws.userId,
      senderName: ws.username || 'Unknown',
      message: sanitized
    }
  });

  // Broadcast to all in game
  broadcastToGame(ws.gameId, {
    type: 'chat:message',
    id: chatMessage.id,
    senderId: ws.userId,
    senderName: ws.username,
    message: sanitized,
    timestamp: chatMessage.createdAt.toISOString()
  });
}

async function handleDisconnect(ws: ExtendedWebSocket) {
  if (ws.userId) {
    connections.delete(ws.userId);
    await redis.del(`ws:user:${ws.userId}`);
  }

  if (ws.gameId) {
    await handleLeaveSession(ws);
  }
}
