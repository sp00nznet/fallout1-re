import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { botManager } from '../index.js';
import { authMiddleware } from './auth.js';
import { BotType, BotStatus } from '@prisma/client';

export const botsRouter = Router();

// All routes require authentication
botsRouter.use(authMiddleware);

// Get all bots
botsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json(bots);
  } catch (error) {
    console.error('Get bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get bot by ID
botsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: req.params.id }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json(bot);
  } catch (error) {
    console.error('Get bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create bot
const createBotSchema = z.object({
  name: z.string().min(1).max(30),
  type: z.nativeEnum(BotType),
  config: z.object({
    // Host bot config
    gameNameTemplate: z.string().optional(),
    maxPlayers: z.number().int().min(2).max(8).optional(),
    turnTime: z.number().int().min(10).max(120).optional(),
    createInterval: z.number().int().min(60).optional(), // seconds

    // Player bot config
    aggressiveness: z.number().min(0).max(1).optional(),
    skillLevel: z.number().min(0).max(1).optional(),
    preferredWeapons: z.array(z.string()).optional()
  }).default({})
});

botsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = createBotSchema.parse(req.body);

    // Check for duplicate name
    const existing = await prisma.bot.findUnique({
      where: { name: data.name }
    });

    if (existing) {
      res.status(400).json({ error: 'Bot with this name already exists' });
      return;
    }

    const bot = await prisma.bot.create({
      data: {
        name: data.name,
        type: data.type,
        config: data.config,
        status: BotStatus.IDLE,
        isEnabled: true
      }
    });

    res.status(201).json(bot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Create bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update bot
const updateBotSchema = z.object({
  name: z.string().min(1).max(30).optional(),
  config: z.object({
    gameNameTemplate: z.string().optional(),
    maxPlayers: z.number().int().min(2).max(8).optional(),
    turnTime: z.number().int().min(10).max(120).optional(),
    createInterval: z.number().int().min(60).optional(),
    aggressiveness: z.number().min(0).max(1).optional(),
    skillLevel: z.number().min(0).max(1).optional(),
    preferredWeapons: z.array(z.string()).optional()
  }).optional(),
  isEnabled: z.boolean().optional()
});

botsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const botId = req.params.id;
    const data = updateBotSchema.parse(req.body);

    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    const updated = await prisma.bot.update({
      where: { id: botId },
      data: {
        ...data,
        config: data.config ? { ...(bot.config as object), ...data.config } : undefined
      }
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Update bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start bot
botsRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const botId = req.params.id;

    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (!bot.isEnabled) {
      res.status(400).json({ error: 'Bot is disabled' });
      return;
    }

    if (bot.status !== BotStatus.IDLE && bot.status !== BotStatus.STOPPED) {
      res.status(400).json({ error: 'Bot is already running' });
      return;
    }

    await botManager.startBot(botId);

    const updated = await prisma.bot.findUnique({
      where: { id: botId }
    });

    res.json(updated);
  } catch (error) {
    console.error('Start bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Stop bot
botsRouter.post('/:id/stop', async (req: Request, res: Response) => {
  try {
    const botId = req.params.id;

    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    if (bot.status === BotStatus.IDLE || bot.status === BotStatus.STOPPED) {
      res.status(400).json({ error: 'Bot is not running' });
      return;
    }

    await botManager.stopBot(botId);

    const updated = await prisma.bot.findUnique({
      where: { id: botId }
    });

    res.json(updated);
  } catch (error) {
    console.error('Stop bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete bot
botsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const botId = req.params.id;

    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    // Stop bot if running
    if (bot.status !== BotStatus.IDLE && bot.status !== BotStatus.STOPPED) {
      await botManager.stopBot(botId);
    }

    await prisma.bot.delete({
      where: { id: botId }
    });

    res.json({ message: 'Bot deleted' });
  } catch (error) {
    console.error('Delete bot error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get bot statistics
botsRouter.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const botId = req.params.id;

    const bot = await prisma.bot.findUnique({
      where: { id: botId }
    });

    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({
      gamesCreated: bot.gamesCreated,
      gamesPlayed: bot.gamesPlayed,
      gamesWon: bot.gamesWon,
      kills: bot.kills,
      deaths: bot.deaths,
      winRate: bot.gamesPlayed > 0
        ? ((bot.gamesWon / bot.gamesPlayed) * 100).toFixed(1) + '%'
        : '0%',
      kdRatio: bot.deaths > 0
        ? (bot.kills / bot.deaths).toFixed(2)
        : bot.kills,
      status: bot.status,
      lastActiveAt: bot.lastActiveAt
    });
  } catch (error) {
    console.error('Get bot stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk operations
botsRouter.post('/start-all', async (req: Request, res: Response) => {
  try {
    const bots = await prisma.bot.findMany({
      where: {
        isEnabled: true,
        status: { in: [BotStatus.IDLE, BotStatus.STOPPED] }
      }
    });

    const results = await Promise.allSettled(
      bots.map(bot => botManager.startBot(bot.id))
    );

    const started = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    res.json({ started, failed, total: bots.length });
  } catch (error) {
    console.error('Start all bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

botsRouter.post('/stop-all', async (req: Request, res: Response) => {
  try {
    await botManager.stopAllBots();
    res.json({ message: 'All bots stopped' });
  } catch (error) {
    console.error('Stop all bots error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
