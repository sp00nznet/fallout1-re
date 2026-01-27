import { prisma, redis } from '../index.js';
import { broadcastToGame, sendToUser } from '../websocket/connection.js';

interface TurnData {
  order: string[]; // participant IDs
  currentIndex: number;
  round: number;
}

export class TurnService {
  private gameId: string;
  private timerKey: string;
  private turnsKey: string;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.timerKey = `game:${gameId}:timer`;
    this.turnsKey = `game:${gameId}:turns`;
  }

  async getTurnData(): Promise<TurnData | null> {
    const data = await redis.get(this.turnsKey);
    return data ? JSON.parse(data) : null;
  }

  async getCurrentPlayer(): Promise<string | null> {
    const turnData = await this.getTurnData();
    if (!turnData) return null;
    return turnData.order[turnData.currentIndex] || null;
  }

  async isPlayerTurn(participantId: string): Promise<boolean> {
    const currentPlayerId = await this.getCurrentPlayer();
    return currentPlayerId === participantId;
  }

  async startTurnTimer(): Promise<void> {
    const game = await prisma.gameSession.findUnique({
      where: { id: this.gameId },
      include: { participants: { where: { isDead: false } } }
    });

    if (!game || !game.inCombat) return;

    const turnData = await this.getTurnData();
    if (!turnData) return;

    // Calculate turn time
    // Base turn time × number of players, divided by number of players = base per player
    const playerCount = game.participants.length;
    const turnTimeMs = game.turnTimeBase * 1000; // Convert to milliseconds

    const currentParticipantId = turnData.order[turnData.currentIndex];
    const currentParticipant = await prisma.gameParticipant.findUnique({
      where: { id: currentParticipantId },
      include: { character: true }
    });

    if (!currentParticipant) return;

    // Store timer info
    const timerData = {
      startTime: Date.now(),
      endTime: Date.now() + turnTimeMs,
      participantId: currentParticipantId,
      duration: turnTimeMs
    };

    await redis.setex(this.timerKey, Math.ceil(turnTimeMs / 1000) + 10, JSON.stringify(timerData));

    // Broadcast turn start
    broadcastToGame(this.gameId, {
      type: 'turn:start',
      participantId: currentParticipantId,
      userId: currentParticipant.userId,
      characterName: currentParticipant.character?.name || 'Unknown',
      round: turnData.round,
      turnIndex: turnData.currentIndex,
      timeLimit: turnTimeMs / 1000,
      ap: currentParticipant.currentAp
    });

    // Schedule automatic turn end
    this.scheduleTimeout(turnTimeMs);
  }

  private scheduleTimeout(delayMs: number): void {
    setTimeout(async () => {
      await this.checkAndEndTurn();
    }, delayMs + 500); // Add small buffer
  }

  private async checkAndEndTurn(): Promise<void> {
    const timerData = await redis.get(this.timerKey);
    if (!timerData) return;

    const timer = JSON.parse(timerData);
    const now = Date.now();

    // If time has expired, end the turn
    if (now >= timer.endTime) {
      await this.endTurn(true);
    }
  }

  async endTurn(timeout: boolean = false): Promise<void> {
    const turnData = await this.getTurnData();
    if (!turnData) return;

    const game = await prisma.gameSession.findUnique({
      where: { id: this.gameId },
      include: { participants: { where: { isDead: false } } }
    });

    if (!game || !game.inCombat) return;

    // Get current player
    const currentParticipantId = turnData.order[turnData.currentIndex];
    const currentParticipant = await prisma.gameParticipant.findUnique({
      where: { id: currentParticipantId }
    });

    // Clear timer
    await redis.del(this.timerKey);

    // Broadcast turn end
    broadcastToGame(this.gameId, {
      type: 'turn:end',
      participantId: currentParticipantId,
      timeout,
      round: turnData.round
    });

    // Move to next player
    let nextIndex = turnData.currentIndex + 1;
    let newRound = turnData.round;

    // Skip dead players
    const aliveParticipants = turnData.order.filter(async (id) => {
      const p = await prisma.gameParticipant.findUnique({ where: { id } });
      return p && !p.isDead;
    });

    // Check if round is complete
    if (nextIndex >= turnData.order.length) {
      nextIndex = 0;
      newRound++;

      // Check win condition - only one player/team left
      const alivePlayers = game.participants.filter(p => !p.isDead && !p.isBot);
      const aliveBots = game.participants.filter(p => !p.isDead && p.isBot);

      if (alivePlayers.length <= 1 && aliveBots.length === 0) {
        // Combat ends - one or fewer humans left
        await this.endCombat(alivePlayers[0]?.id);
        return;
      }

      // Reset AP for all players at start of new round
      for (const participant of game.participants) {
        if (!participant.isDead) {
          const character = await prisma.character.findUnique({
            where: { id: participant.characterId || '' }
          });
          await prisma.gameParticipant.update({
            where: { id: participant.id },
            data: { currentAp: character?.maxAp || 7 }
          });
        }
      }

      // Broadcast new round
      broadcastToGame(this.gameId, {
        type: 'combat:new-round',
        round: newRound
      });
    }

    // Find next alive player
    let attempts = 0;
    while (attempts < turnData.order.length) {
      const nextParticipantId = turnData.order[nextIndex];
      const nextParticipant = await prisma.gameParticipant.findUnique({
        where: { id: nextParticipantId }
      });

      if (nextParticipant && !nextParticipant.isDead) {
        break;
      }

      nextIndex = (nextIndex + 1) % turnData.order.length;
      attempts++;
    }

    // Update turn data
    const newTurnData: TurnData = {
      order: turnData.order,
      currentIndex: nextIndex,
      round: newRound
    };

    await redis.setex(this.turnsKey, 3600, JSON.stringify(newTurnData));

    // Update game
    await prisma.gameSession.update({
      where: { id: this.gameId },
      data: {
        currentTurn: nextIndex,
        combatRound: newRound
      }
    });

    // Start next turn timer
    await this.startTurnTimer();
  }

  private async endCombat(winnerId?: string): Promise<void> {
    await redis.del(this.turnsKey);
    await redis.del(this.timerKey);

    await prisma.gameSession.update({
      where: { id: this.gameId },
      data: {
        inCombat: false,
        combatRound: 0,
        status: 'FINISHED',
        endedAt: new Date()
      }
    });

    await prisma.gameParticipant.updateMany({
      where: { sessionId: this.gameId },
      data: { isInCombat: false }
    });

    // Update winner stats if any
    if (winnerId) {
      const winner = await prisma.gameParticipant.findUnique({
        where: { id: winnerId }
      });

      if (winner) {
        await prisma.user.update({
          where: { id: winner.userId },
          data: {
            gamesWon: { increment: 1 },
            gamesPlayed: { increment: 1 }
          }
        });
      }
    }

    broadcastToGame(this.gameId, {
      type: 'combat:ended',
      winnerId
    });

    broadcastToGame(this.gameId, {
      type: 'game:ended',
      winnerId
    });
  }

  async getTimeRemaining(): Promise<number> {
    const timerData = await redis.get(this.timerKey);
    if (!timerData) return 0;

    const timer = JSON.parse(timerData);
    return Math.max(0, (timer.endTime - Date.now()) / 1000);
  }
}
