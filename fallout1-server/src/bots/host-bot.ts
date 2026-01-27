import { prisma, redis } from '../index.js';
import { BotStatus, GameStatus, GameVisibility } from '@prisma/client';

interface HostBotConfig {
  gameNameTemplate?: string;
  maxPlayers?: number;
  turnTime?: number;
  createInterval?: number; // seconds between game creation attempts
  minPlayersToStart?: number;
  waitTimeForPlayers?: number; // seconds to wait for players before starting
}

const DEFAULT_CONFIG: HostBotConfig = {
  gameNameTemplate: 'Wasteland Arena #{n}',
  maxPlayers: 4,
  turnTime: 30,
  createInterval: 300, // 5 minutes
  minPlayersToStart: 2,
  waitTimeForPlayers: 120 // 2 minutes
};

export class HostBot {
  private botId: string;
  private config: HostBotConfig;
  private status: BotStatus = BotStatus.IDLE;
  private intervalId: NodeJS.Timeout | null = null;
  private currentGameId: string | null = null;
  private gameCounter = 0;

  constructor(botId: string, config: Partial<HostBotConfig> = {}) {
    this.botId = botId;
    this.config = { ...DEFAULT_CONFIG, ...config };
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

    // Start the game creation loop
    this.runLoop();
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    // Close any current game
    if (this.currentGameId) {
      await this.closeGame();
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
    // Check if we should create a new game
    if (!this.currentGameId) {
      const shouldCreate = await this.shouldCreateGame();
      if (shouldCreate) {
        await this.createGame();
      }
    } else {
      // Check if current game should start or close
      await this.checkCurrentGame();
    }

    // Schedule next check
    const interval = (this.config.createInterval || 300) * 1000;
    this.intervalId = setTimeout(() => this.runLoop(), interval);
  }

  private async shouldCreateGame(): Promise<boolean> {
    // Check how many public games are available
    const availableGames = await prisma.gameSession.count({
      where: {
        status: GameStatus.LOBBY,
        visibility: GameVisibility.PUBLIC
      }
    });

    // Create a game if there are few available
    return availableGames < 3;
  }

  private async createGame(): Promise<void> {
    this.status = BotStatus.CREATING_GAME;
    this.gameCounter++;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.CREATING_GAME,
        lastActiveAt: new Date()
      }
    });

    const gameName = (this.config.gameNameTemplate || 'Bot Game #{n}')
      .replace('{n}', this.gameCounter.toString());

    // Create a system user for the bot if needed
    const botUser = await this.getOrCreateBotUser();

    // Create the game session
    const game = await prisma.gameSession.create({
      data: {
        hostId: botUser.id,
        name: gameName,
        status: GameStatus.LOBBY,
        visibility: GameVisibility.PUBLIC,
        maxPlayers: this.config.maxPlayers || 4,
        turnTimeBase: this.config.turnTime || 30,
        participants: {
          create: {
            userId: botUser.id,
            isHost: true,
            isBot: true,
            isReady: true
          }
        }
      }
    });

    this.currentGameId = game.id;
    this.status = BotStatus.IN_LOBBY;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.IN_LOBBY,
        currentGameId: game.id,
        gamesCreated: { increment: 1 },
        lastActiveAt: new Date()
      }
    });

    console.log(`Host bot ${this.botId} created game: ${gameName}`);

    // Store game creation time in Redis for timeout tracking
    await redis.setex(
      `bot:${this.botId}:game-created`,
      (this.config.waitTimeForPlayers || 120) + 60,
      Date.now().toString()
    );
  }

  private async checkCurrentGame(): Promise<void> {
    if (!this.currentGameId) return;

    const game = await prisma.gameSession.findUnique({
      where: { id: this.currentGameId },
      include: { participants: true }
    });

    if (!game) {
      this.currentGameId = null;
      return;
    }

    // Game already started or finished
    if (game.status !== GameStatus.LOBBY) {
      if (game.status === GameStatus.FINISHED) {
        this.currentGameId = null;
      }
      return;
    }

    // Check if enough players have joined
    const humanPlayers = game.participants.filter(p => !p.isBot);
    const allReady = game.participants.every(p => p.isReady);

    if (humanPlayers.length >= (this.config.minPlayersToStart || 2) - 1 && allReady) {
      // Start the game
      await this.startGame();
      return;
    }

    // Check if we've waited too long
    const createdTime = await redis.get(`bot:${this.botId}:game-created`);
    if (createdTime) {
      const elapsed = Date.now() - parseInt(createdTime, 10);
      const waitTime = (this.config.waitTimeForPlayers || 120) * 1000;

      if (elapsed > waitTime && humanPlayers.length === 0) {
        // No one joined, close the game
        await this.closeGame();
      }
    }
  }

  private async startGame(): Promise<void> {
    if (!this.currentGameId) return;

    await prisma.gameSession.update({
      where: { id: this.currentGameId },
      data: {
        status: GameStatus.PLAYING,
        startedAt: new Date()
      }
    });

    this.status = BotStatus.PLAYING;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.PLAYING,
        gamesPlayed: { increment: 1 },
        lastActiveAt: new Date()
      }
    });

    console.log(`Host bot ${this.botId} started game: ${this.currentGameId}`);

    // Clean up Redis
    await redis.del(`bot:${this.botId}:game-created`);
  }

  private async closeGame(): Promise<void> {
    if (!this.currentGameId) return;

    await prisma.gameSession.update({
      where: { id: this.currentGameId },
      data: {
        status: GameStatus.FINISHED,
        endedAt: new Date()
      }
    });

    console.log(`Host bot ${this.botId} closed game: ${this.currentGameId}`);

    this.currentGameId = null;
    this.status = BotStatus.IDLE;

    await prisma.bot.update({
      where: { id: this.botId },
      data: {
        status: BotStatus.IDLE,
        currentGameId: null,
        lastActiveAt: new Date()
      }
    });

    await redis.del(`bot:${this.botId}:game-created`);
  }

  private async getOrCreateBotUser() {
    const botName = `bot_host_${this.botId.slice(0, 8)}`;

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
}
