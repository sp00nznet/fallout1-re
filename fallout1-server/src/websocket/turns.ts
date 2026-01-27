import { WebSocket } from 'ws';
import { prisma, redis } from '../index.js';
import { broadcastToGame } from './connection.js';
import { TurnService } from '../services/turn.service.js';

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  username?: string;
  gameId?: string;
  participantId?: string;
}

export async function handleTurnMessage(
  ws: ExtendedWebSocket,
  type: string,
  payload: any
) {
  if (!ws.userId || !ws.gameId || !ws.participantId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
    return;
  }

  const turnService = new TurnService(ws.gameId);

  switch (type) {
    case 'turn:end':
      await handleEndTurn(ws, turnService);
      break;
    case 'turn:timeout':
      // Server handles timeout, but client can signal it saw timeout
      break;
  }
}

async function handleEndTurn(ws: ExtendedWebSocket, turnService: TurnService) {
  // Verify it's actually this player's turn
  const isCurrentTurn = await turnService.isPlayerTurn(ws.participantId!);
  if (!isCurrentTurn) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
    return;
  }

  await turnService.endTurn();
}

// Initialize combat for a game
export async function initiateCombat(gameId: string) {
  const game = await prisma.gameSession.findUnique({
    where: { id: gameId },
    include: {
      participants: {
        where: { isDead: false },
        include: { character: true }
      }
    }
  });

  if (!game || game.inCombat) return;

  // Sort participants by sequence (turn order), luck as tiebreaker
  const sortedParticipants = [...game.participants].sort((a, b) => {
    const seqA = a.character?.sequence || 10;
    const seqB = b.character?.sequence || 10;
    if (seqB !== seqA) return seqB - seqA;

    const luckA = a.character?.luck || 5;
    const luckB = b.character?.luck || 5;
    return luckB - luckA;
  });

  // Store turn order in Redis
  const turnData = {
    order: sortedParticipants.map(p => p.id),
    currentIndex: 0,
    round: 1
  };

  await redis.setex(`game:${gameId}:turns`, 3600, JSON.stringify(turnData));

  // Update game state
  await prisma.gameSession.update({
    where: { id: gameId },
    data: {
      inCombat: true,
      combatRound: 1,
      currentTurn: 0
    }
  });

  // Set all participants to in-combat
  await prisma.gameParticipant.updateMany({
    where: { sessionId: gameId, isDead: false },
    data: { isInCombat: true }
  });

  // Reset AP for all participants
  for (const participant of sortedParticipants) {
    await prisma.gameParticipant.update({
      where: { id: participant.id },
      data: { currentAp: participant.character?.maxAp || 7 }
    });
  }

  // Broadcast combat start
  broadcastToGame(gameId, {
    type: 'combat:started',
    round: 1,
    turnOrder: sortedParticipants.map(p => ({
      participantId: p.id,
      userId: p.userId,
      characterName: p.character?.name || 'Unknown',
      sequence: p.character?.sequence || 10
    })),
    firstPlayerId: sortedParticipants[0].id
  });

  // Start the turn timer for first player
  const turnService = new TurnService(gameId);
  await turnService.startTurnTimer();
}

// End combat for a game
export async function endCombat(gameId: string) {
  await redis.del(`game:${gameId}:turns`);
  await redis.del(`game:${gameId}:timer`);

  await prisma.gameSession.update({
    where: { id: gameId },
    data: {
      inCombat: false,
      combatRound: 0
    }
  });

  await prisma.gameParticipant.updateMany({
    where: { sessionId: gameId },
    data: { isInCombat: false }
  });

  broadcastToGame(gameId, {
    type: 'combat:ended'
  });
}
