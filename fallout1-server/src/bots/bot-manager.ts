import { prisma } from '../index.js';
import { BotStatus, BotType } from '@prisma/client';
import { HostBot } from './host-bot.js';
import { PlayerBot } from './player-bot.js';

interface BotInstance {
  id: string;
  type: BotType;
  instance: HostBot | PlayerBot;
}

export class BotManager {
  private bots: Map<string, BotInstance> = new Map();
  private running = false;

  async initialize(): Promise<void> {
    // Load all enabled bots from database
    const enabledBots = await prisma.bot.findMany({
      where: { isEnabled: true }
    });

    console.log(`Found ${enabledBots.length} enabled bots`);

    // Auto-start bots that were running before server restart
    for (const bot of enabledBots) {
      if (bot.status !== BotStatus.IDLE && bot.status !== BotStatus.STOPPED) {
        // Reset status since we're starting fresh
        await prisma.bot.update({
          where: { id: bot.id },
          data: { status: BotStatus.IDLE }
        });
      }
    }

    this.running = true;
  }

  async startBot(botId: string): Promise<void> {
    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      throw new Error('Bot not found');
    }

    if (!bot.isEnabled) {
      throw new Error('Bot is disabled');
    }

    if (this.bots.has(botId)) {
      throw new Error('Bot is already running');
    }

    let instance: HostBot | PlayerBot;

    if (bot.type === BotType.HOST) {
      instance = new HostBot(bot.id, bot.config as any);
    } else {
      instance = new PlayerBot(bot.id, bot.config as any);
    }

    this.bots.set(botId, {
      id: botId,
      type: bot.type,
      instance
    });

    await instance.start();

    console.log(`Started bot: ${bot.name} (${bot.type})`);
  }

  async stopBot(botId: string): Promise<void> {
    const botInstance = this.bots.get(botId);
    if (!botInstance) {
      throw new Error('Bot not running');
    }

    await botInstance.instance.stop();
    this.bots.delete(botId);

    await prisma.bot.update({
      where: { id: botId },
      data: { status: BotStatus.STOPPED }
    });

    console.log(`Stopped bot: ${botId}`);
  }

  async stopAllBots(): Promise<void> {
    const promises = Array.from(this.bots.keys()).map(id => this.stopBot(id));
    await Promise.allSettled(promises);
  }

  async shutdown(): Promise<void> {
    this.running = false;
    await this.stopAllBots();
  }

  getBotStatus(botId: string): BotStatus {
    const botInstance = this.bots.get(botId);
    if (!botInstance) {
      return BotStatus.STOPPED;
    }
    return botInstance.instance.getStatus();
  }

  getRunningBots(): string[] {
    return Array.from(this.bots.keys());
  }
}
