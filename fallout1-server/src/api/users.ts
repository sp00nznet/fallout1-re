import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authMiddleware } from './auth.js';

export const usersRouter = Router();

// All routes require authentication
usersRouter.use(authMiddleware);

// Get current user profile
usersRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        lastLoginAt: true,
        totalPlayTime: true,
        gamesPlayed: true,
        gamesWon: true,
        _count: {
          select: {
            saves: true,
            characters: true
          }
        }
      }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's characters
usersRouter.get('/me/characters', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const characters = await prisma.character.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(characters);
  } catch (error) {
    console.error('Get characters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific character
usersRouter.get('/me/characters/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const characterId = req.params.id;

    const character = await prisma.character.findFirst({
      where: { id: characterId, userId }
    });

    if (!character) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    res.json(character);
  } catch (error) {
    console.error('Get character error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create character from save
const createCharacterSchema = z.object({
  saveSlot: z.number().int().min(1).max(10).optional(),
  name: z.string().min(1).max(50),
  level: z.number().int().min(1).max(99).default(1),
  strength: z.number().int().min(1).max(10).default(5),
  perception: z.number().int().min(1).max(10).default(5),
  endurance: z.number().int().min(1).max(10).default(5),
  charisma: z.number().int().min(1).max(10).default(5),
  intelligence: z.number().int().min(1).max(10).default(5),
  agility: z.number().int().min(1).max(10).default(5),
  luck: z.number().int().min(1).max(10).default(5),
  skills: z.record(z.number()).optional(),
  perks: z.array(z.string()).optional(),
  inventory: z.array(z.any()).optional()
});

usersRouter.post('/me/characters', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const data = createCharacterSchema.parse(req.body);

    // Calculate derived stats
    const maxHp = 15 + data.strength + (2 * data.endurance) + (data.level - 1) * (Math.floor(data.endurance / 2) + 3);
    const maxAp = 5 + Math.floor(data.agility / 2);
    const sequence = 2 * data.perception;

    const character = await prisma.character.create({
      data: {
        userId,
        name: data.name,
        level: data.level,
        strength: data.strength,
        perception: data.perception,
        endurance: data.endurance,
        charisma: data.charisma,
        intelligence: data.intelligence,
        agility: data.agility,
        luck: data.luck,
        maxHp,
        maxAp,
        sequence,
        skills: data.skills || {},
        perks: data.perks || [],
        inventory: data.inventory || [],
        sourceSlot: data.saveSlot
      }
    });

    res.status(201).json(character);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Create character error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update character
usersRouter.patch('/me/characters/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const characterId = req.params.id;

    // Verify ownership
    const existing = await prisma.character.findFirst({
      where: { id: characterId, userId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    const character = await prisma.character.update({
      where: { id: characterId },
      data: req.body
    });

    res.json(character);
  } catch (error) {
    console.error('Update character error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete character
usersRouter.delete('/me/characters/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const characterId = req.params.id;

    // Verify ownership
    const existing = await prisma.character.findFirst({
      where: { id: characterId, userId }
    });

    if (!existing) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    await prisma.character.delete({
      where: { id: characterId }
    });

    res.json({ message: 'Character deleted' });
  } catch (error) {
    console.error('Delete character error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user stats
usersRouter.get('/me/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const [user, recentGames] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          totalPlayTime: true,
          gamesPlayed: true,
          gamesWon: true
        }
      }),
      prisma.gameParticipant.findMany({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        take: 10,
        include: {
          session: {
            select: {
              name: true,
              status: true,
              startedAt: true,
              endedAt: true
            }
          }
        }
      })
    ]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Calculate additional stats
    const totalKills = await prisma.gameParticipant.aggregate({
      where: { userId },
      _sum: { kills: true }
    });

    const totalDeaths = await prisma.gameParticipant.aggregate({
      where: { userId },
      _sum: { deaths: true }
    });

    res.json({
      ...user,
      totalKills: totalKills._sum.kills || 0,
      totalDeaths: totalDeaths._sum.deaths || 0,
      kdRatio: totalDeaths._sum.deaths
        ? ((totalKills._sum.kills || 0) / totalDeaths._sum.deaths).toFixed(2)
        : totalKills._sum.kills || 0,
      winRate: user.gamesPlayed
        ? ((user.gamesWon / user.gamesPlayed) * 100).toFixed(1) + '%'
        : '0%',
      recentGames
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
