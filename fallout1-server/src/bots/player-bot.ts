import { prisma, redis } from '../index.js';
import { BotStatus, GameStatus, GameVisibility } from '@prisma/client';
import { CombatAI } from './ai/combat-ai.js';
import { ExplorationAI } from './ai/exploration-ai.js';

interface PlayerBotConfig {
  aggressiveness?: number; // 0-1, how likely to attack vs. defensive
  skillLevel?: number; // 0-1, affects decision quality
  preferredWeapons?: string[];
  joinInterval?: number; // seconds between join attempts
  level?: number; // Character level
}

const DEFAULT_CONFIG: PlayerBotConfig = {
  aggressiveness: 0.5,
  skillLevel: 0.5,
  preferredWeapons: [],
  joinInterval: 60,
  level: 5
};

export class PlayerBot {
  private botId: string;
  private config: PlayerBotConfig;
  private status: BotStatus = BotStatus.IDLE;
  private intervalId: NodeJS.Timeout | null = null;
  private currentGameId: string | null = null;
  private participantId: string | null = null;
  private combatAI: CombatAI;
  private explorationAI: ExplorationAI;
  private actionLoopId: NodeJS.Timeout | null = null;

  constructor(botId: string, config: Partial<PlayerBotConfig> = {}) {
    this.botId = botId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.combatAI = new CombatAI(this.config.aggressiveness || 0.5, this.config.skillLevel || 0.5);
    this.explorationAI = new ExplorationAI(this.config.skillLevel || 0.5);
  }

  async start(): Promise<void> {
    this.status = BotStatus.IDLE;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.IDLE,
        lastActiveAt: new Date()
      }
    });

    // Start the join/play loop
    this.runLoop();
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    if (this.actionLoopId) {
      clearTimeout(this.actionLoopId);
      this.actionLoopId = null;
    }

    // Leave current game
    if (this.currentGameId && this.participantId) {
      await this.leaveGame();
    }

    this.status = BotStatus.STOPPED;

    await prisma.bot.update({
      where: { id: this.botId },
      data: { status: BotStatus.STOPPED }
    });
  }

  getStatus(): BotStatus {
    return this.status;
  }

  private async runLoop(): Promise<void> {
    if (this.status === BotStatus.STOPPED) return;

    if (!this.currentGameId) {
      await this.findAndJoinGame();
    } else {
      await this.checkGameStatus();
    }

    // Schedule next check
    const interval = (this.config.joinInterval || 60) * 1000;
    this.intervalId = setTimeout(() => this.runLoop(), interval);
  }

  private async findAndJoinGame(): Promise<void> {
    // Find available public games
    const games = await prisma.gameSession.findMany({
      where: {
        status: GameStatus.LOBBY,
        visibility: GameVisibility.PUBLIC
      },
      include: {
        participants: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Filter games that have room
    const availableGames = games.filter(g =>
      g.participants.length < g.maxPlayers &&
      !g.participants.some(p => p.userId === this.getBotUserId())
    );

    if (availableGames.length === 0) return;

    // Pick a random game (could be smarter about this)
    const game = availableGames[Math.floor(Math.random() * availableGames.length)];
    await this.joinGame(game.id);
  }

  private async joinGame(gameId: string): Promise<void> {
    const botUser = await this.getOrCreateBotUser();
    const character = await this.getOrCreateCharacter(botUser.id);

    // Check if already in game
    const existing = await prisma.gameParticipant.findFirst({
      where: { sessionId: gameId, userId: botUser.id }
    });

    if (existing) return;

    const participant = await prisma.gameParticipant.create({
      data: {
        sessionId: gameId,
        userId: botUser.id,
        characterId: character.id,
        isHost: false,
        isBot: true,
        isReady: true,
        currentHp: character.maxHp,
        currentAp: character.maxAp,
        turnOrder: character.sequence
      }
    });

    this.currentGameId = gameId;
    this.participantId = participant.id;
    this.status = BotStatus.IN_LOBBY;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.IN_LOBBY,
        currentGameId: gameId,
        lastActiveAt: new Date()
      }
    });

    console.log(`Player bot ${this.botId} joined game: ${gameId}`);
  }

  private async leaveGame(): Promise<void> {
    if (!this.participantId) return;

    await prisma.gameParticipant.delete({
      where: { id: this.participantId }
    });

    this.currentGameId = null;
    this.participantId = null;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.IDLE,
        currentGameId: null,
        lastActiveAt: new Date()
      }
    });
  }

  private async checkGameStatus(): Promise<void> {
    if (!this.currentGameId) return;

    const game = await prisma.gameSession.findUnique({
      where: { id: this.currentGameId }
    });

    if (!game) {
      this.currentGameId = null;
      this.participantId = null;
      this.status = BotStatus.IDLE;
      return;
    }

    if (game.status === GameStatus.FINISHED) {
      this.currentGameId = null;
      this.participantId = null;
      this.status = BotStatus.IDLE;

      await prisma.bot.update({
        where: { id: this.botId },
        data: {
          status: BotStatus.IDLE,
          currentGameId: null,
          gamesPlayed: { increment: 1 },
          lastActiveAt: new Date()
        }
      });
      return;
    }

    if (game.status === GameStatus.PLAYING && this.status !== BotStatus.PLAYING) {
      this.status = BotStatus.PLAYING;

      await prisma.bot.update({
        where: { id: this.botId },
        data: {
          status: BotStatus.PLAYING,
          lastActiveAt: new Date()
        }
      });

      // Start action loop
      this.startActionLoop();
    }
  }

  private startActionLoop(): void {
    if (this.actionLoopId) {
      clearTimeout(this.actionLoopId);
    }

    this.runActionLoop();
  }

  private async runActionLoop(): Promise<void> {
    if (this.status !== BotStatus.PLAYING || !this.currentGameId || !this.participantId) {
      return;
    }

    const game = await prisma.gameSession.findUnique({
      where: { id: this.currentGameId },
      include: {
        participants: {
          include: { character: true }
        }
      }
    });

    if (!game || game.status !== GameStatus.PLAYING) {
      return;
    }

    // Check if it's our turn
    const turnData = await redis.get(`game:${this.currentGameId}:turns`);
    if (!turnData) {
      // Not in combat, use exploration AI
      await this.doExplorationAction(game);
    } else {
      const turns = JSON.parse(turnData);
      const currentTurnId = turns.order[turns.currentIndex];

      if (currentTurnId === this.participantId) {
        // It's our turn, use combat AI
        await this.doCombatAction(game);
      }
    }

    // Schedule next action check
    this.actionLoopId = setTimeout(() => this.runActionLoop(), 2000);
  }

  private async doCombatAction(game: any): Promise<void> {
    const participant = game.participants.find((p: any) => p.id === this.participantId);
    if (!participant || participant.isDead) return;

    const enemies = game.participants.filter((p: any) =>
      p.id !== this.participantId && !p.isDead
    );

    const action = this.combatAI.decideAction(participant, enemies);

    if (action.type === 'attack' && action.targetId) {
      // Simulate attack action
      await this.executeAttack(participant, action.targetId);
    } else if (action.type === 'heal') {
      // Use healing item
      await this.executeHeal(participant);
    } else if (action.type === 'move' && action.targetTile !== undefined) {
      // Move to position
      await this.executeMove(participant, action.targetTile);
    } else if (action.type === 'end-turn') {
      // End turn
      await this.executeEndTurn();
    }
  }

  private async doExplorationAction(game: any): Promise<void> {
    const participant = game.participants.find((p: any) => p.id === this.participantId);
    if (!participant) return;

    const action = this.explorationAI.decideAction(participant, game);

    if (action.type === 'move' && action.targetTile !== undefined) {
      await this.executeMove(participant, action.targetTile);
    }
  }

  private async executeAttack(participant: any, targetId: string): Promise<void> {
    // In a real implementation, this would go through the WebSocket
    // For now, we'll directly update the database
    console.log(`Bot ${this.botId} attacks ${targetId}`);

    // Deduct AP and record action
    if (participant.currentAp >= 4) {
      await prisma.gameParticipant.update({
        where: { id: this.participantId! },
        data: { currentAp: participant.currentAp - 4 }
      });
    }
  }

  private async executeHeal(participant: any): Promise<void> {
    console.log(`Bot ${this.botId} uses healing item`);

    const maxHp = participant.character?.maxHp || 30;
    const healAmount = Math.min(15, maxHp - participant.currentHp);

    if (healAmount > 0 && participant.currentAp >= 2) {
      await prisma.gameParticipant.update({
        where: { id: this.participantId! },
        data: {
          currentHp: participant.currentHp + healAmount,
          currentAp: participant.currentAp - 2
        }
      });
    }
  }

  private async executeMove(participant: any, targetTile: number): Promise<void> {
    console.log(`Bot ${this.botId} moves to tile ${targetTile}`);

    await prisma.gameParticipant.update({
      where: { id: this.participantId! },
      data: {
        tileIndex: targetTile,
        currentAp: Math.max(0, participant.currentAp - 1)
      }
    });
  }

  private async executeEndTurn(): Promise<void> {
    console.log(`Bot ${this.botId} ends turn`);

    // In real implementation, trigger turn service
    // For now, just update last active
    await prisma.bot.update({
      where: { id: this.botId },
      data: { lastActiveAt: new Date() }
    });
  }

  private getBotUserId(): string {
    return `bot_player_${this.botId.slice(0, 8)}`;
  }

  private async getOrCreateBotUser() {
    const botName = this.getBotUserId();

    let user = await prisma.user.findUnique({
      where: { username: botName }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: botName,
          email: `${botName}@bot.local`,
          passwordHash: 'BOT_USER_NO_LOGIN'
        }
      });
    }

    return user;
  }

  private async getOrCreateCharacter(userId: string) {
    let character = await prisma.character.findFirst({
      where: { userId }
    });

    if (!character) {
      const level = this.config.level || 5;

      character = await prisma.character.create({
        data: {
          userId,
          name: `Bot Fighter ${this.botId.slice(0, 4)}`,
          level,
          strength: 6,
          perception: 6,
          endurance: 6,
          charisma: 4,
          intelligence: 5,
          agility: 7,
          luck: 5,
          maxHp: 30 + level * 3,
          maxAp: 8,
          sequence: 12,
          skills: { smallGuns: 50 + level * 5, melee: 40 + level * 3 },
          perks: [],
          inventory: []
        }
      });
    }

    return character;
  }
}
