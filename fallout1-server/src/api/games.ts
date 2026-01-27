import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma, redis } from '../index.js';
import { authMiddleware } from './auth.js';
import { GameStatus, GameVisibility } from '@prisma/client';

export const gamesRouter = Router();

// Public routes (no auth required for browsing)
gamesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status, visibility } = req.query;

    const where: any = {};

    if (status) {
      where.status = status as GameStatus;
    } else {
      // Default: show lobby and playing games
      where.status = { in: [GameStatus.LOBBY, GameStatus.PLAYING] };
    }

    if (visibility) {
      where.visibility = visibility as GameVisibility;
    } else {
      // Default: only public games for browsing
      where.visibility = GameVisibility.PUBLIC;
    }

    const games = await prisma.gameSession.findMany({
      where,
      include: {
        host: {
          select: { id: true, username: true }
        },
        participants: {
          select: {
            id: true,
            isHost: true,
            isBot: true,
            isReady: true,
            isConnected: true,
            user: {
              select: { id: true, username: true }
            },
            character: {
              select: { id: true, name: true, level: true }
            }
          }
        },
        _count: {
          select: { participants: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(games);
  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific game
gamesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const gameId = req.params.id;

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId },
      include: {
        host: {
          select: { id: true, username: true }
        },
        participants: {
          include: {
            user: {
              select: { id: true, username: true }
            },
            character: true
          }
        }
      }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(game);
  } catch (error) {
    console.error('Get game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Protected routes
gamesRouter.use(authMiddleware);

// Create game
const createGameSchema = z.object({
  name: z.string().min(1).max(50),
  visibility: z.nativeEnum(GameVisibility).default(GameVisibility.PUBLIC),
  maxPlayers: z.number().int().min(2).max(8).default(4),
  password: z.string().optional(),
  minLevel: z.number().int().min(1).max(99).default(1),
  maxLevel: z.number().int().min(1).max(99).default(99),
  currentMap: z.string().default('desert1'),
  turnTimeBase: z.number().int().min(10).max(120).default(30),
  characterId: z.string().uuid().optional()
});

gamesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const data = createGameSchema.parse(req.body);

    // Validate character ownership if provided
    let character = null;
    if (data.characterId) {
      character = await prisma.character.findFirst({
        where: { id: data.characterId, userId }
      });
      if (!character) {
        res.status(400).json({ error: 'Character not found' });
        return;
      }
    }

    // Create game session
    const game = await prisma.gameSession.create({
      data: {
        hostId: userId,
        name: data.name,
        visibility: data.visibility,
        maxPlayers: data.maxPlayers,
        password: data.password,
        minLevel: data.minLevel,
        maxLevel: data.maxLevel,
        hostLevel: character?.level || 1,
        currentMap: data.currentMap,
        turnTimeBase: data.turnTimeBase,
        participants: {
          create: {
            userId,
            characterId: data.characterId,
            isHost: true,
            isReady: true,
            currentHp: character?.maxHp || 30,
            currentAp: character?.maxAp || 7,
            turnOrder: character?.sequence || 10
          }
        }
      },
      include: {
        host: {
          select: { id: true, username: true }
        },
        participants: {
          include: {
            user: {
              select: { id: true, username: true }
            },
            character: true
          }
        }
      }
    });

    // Cache game state in Redis
    await redis.setex(
      `game:${game.id}:state`,
      3600, // 1 hour TTL
      JSON.stringify({
        status: game.status,
        currentTurn: 0,
        inCombat: false,
        participants: game.participants.map(p => ({
          id: p.id,
          userId: p.userId,
          isReady: p.isReady,
          isConnected: p.isConnected
        }))
      })
    );

    res.status(201).json(game);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Create game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Join game
const joinGameSchema = z.object({
  password: z.string().optional(),
  characterId: z.string().uuid().optional()
});

gamesRouter.post('/:id/join', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;
    const data = joinGameSchema.parse(req.body);

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId },
      include: {
        participants: true
      }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (game.status !== GameStatus.LOBBY) {
      res.status(400).json({ error: 'Game is not accepting players' });
      return;
    }

    if (game.participants.length >= game.maxPlayers) {
      res.status(400).json({ error: 'Game is full' });
      return;
    }

    // Check password for private games
    if (game.visibility === GameVisibility.PRIVATE && game.password !== data.password) {
      res.status(403).json({ error: 'Invalid password' });
      return;
    }

    // Check if already in game
    const existing = game.participants.find(p => p.userId === userId);
    if (existing) {
      res.status(400).json({ error: 'Already in this game' });
      return;
    }

    // Validate character
    let character = null;
    if (data.characterId) {
      character = await prisma.character.findFirst({
        where: { id: data.characterId, userId }
      });
      if (!character) {
        res.status(400).json({ error: 'Character not found' });
        return;
      }

      // Check level restrictions
      if (character.level < game.minLevel || character.level > game.maxLevel) {
        res.status(400).json({
          error: `Character level must be between ${game.minLevel} and ${game.maxLevel}`
        });
        return;
      }
    }

    // Add participant
    const participant = await prisma.gameParticipant.create({
      data: {
        sessionId: gameId,
        userId,
        characterId: data.characterId,
        isHost: false,
        currentHp: character?.maxHp || 30,
        currentAp: character?.maxAp || 7,
        turnOrder: character?.sequence || 10
      },
      include: {
        user: {
          select: { id: true, username: true }
        },
        character: true
      }
    });

    res.status(201).json(participant);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Join game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leave game
gamesRouter.post('/:id/leave', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId },
      include: { participants: true }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const participant = game.participants.find(p => p.userId === userId);
    if (!participant) {
      res.status(400).json({ error: 'Not in this game' });
      return;
    }

    // If host leaves, either transfer host or close game
    if (participant.isHost) {
      const otherParticipants = game.participants.filter(p => p.userId !== userId && !p.isBot);

      if (otherParticipants.length > 0) {
        // Transfer host to another player
        const newHost = otherParticipants[0];
        await prisma.$transaction([
          prisma.gameParticipant.delete({
            where: { id: participant.id }
          }),
          prisma.gameParticipant.update({
            where: { id: newHost.id },
            data: { isHost: true }
          }),
          prisma.gameSession.update({
            where: { id: gameId },
            data: { hostId: newHost.userId }
          })
        ]);
      } else {
        // Close game
        await prisma.gameSession.update({
          where: { id: gameId },
          data: { status: GameStatus.FINISHED, endedAt: new Date() }
        });
        await redis.del(`game:${gameId}:state`);
      }
    } else {
      // Just remove participant
      await prisma.gameParticipant.delete({
        where: { id: participant.id }
      });
    }

    res.json({ message: 'Left game' });
  } catch (error) {
    console.error('Leave game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle ready state
gamesRouter.post('/:id/ready', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;

    const participant = await prisma.gameParticipant.findFirst({
      where: { sessionId: gameId, userId }
    });

    if (!participant) {
      res.status(400).json({ error: 'Not in this game' });
      return;
    }

    const updated = await prisma.gameParticipant.update({
      where: { id: participant.id },
      data: { isReady: !participant.isReady }
    });

    res.json({ isReady: updated.isReady });
  } catch (error) {
    console.error('Ready toggle error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start game (host only)
gamesRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId },
      include: { participants: true }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (game.hostId !== userId) {
      res.status(403).json({ error: 'Only host can start the game' });
      return;
    }

    if (game.status !== GameStatus.LOBBY) {
      res.status(400).json({ error: 'Game already started' });
      return;
    }

    // Check all players ready
    const notReady = game.participants.filter(p => !p.isReady);
    if (notReady.length > 0) {
      res.status(400).json({ error: 'Not all players are ready' });
      return;
    }

    // Update game status
    const updated = await prisma.gameSession.update({
      where: { id: gameId },
      data: {
        status: GameStatus.PLAYING,
        startedAt: new Date()
      }
    });

    // Initialize turn order in Redis
    const sortedParticipants = [...game.participants].sort((a, b) => {
      if (b.turnOrder !== a.turnOrder) {
        return b.turnOrder - a.turnOrder; // Higher sequence first
      }
      return 0; // Could add luck as tiebreaker
    });

    await redis.setex(
      `game:${gameId}:turns`,
      3600,
      JSON.stringify({
        order: sortedParticipants.map(p => p.id),
        currentIndex: 0,
        round: 1
      })
    );

    res.json({ message: 'Game started', status: updated.status });
  } catch (error) {
    console.error('Start game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Kick player (host only)
gamesRouter.post('/:id/kick/:participantId', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;
    const participantId = req.params.participantId;

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (game.hostId !== userId) {
      res.status(403).json({ error: 'Only host can kick players' });
      return;
    }

    const participant = await prisma.gameParticipant.findFirst({
      where: { id: participantId, sessionId: gameId }
    });

    if (!participant) {
      res.status(404).json({ error: 'Participant not found' });
      return;
    }

    if (participant.isHost) {
      res.status(400).json({ error: 'Cannot kick the host' });
      return;
    }

    await prisma.gameParticipant.delete({
      where: { id: participantId }
    });

    res.json({ message: 'Player kicked' });
  } catch (error) {
    console.error('Kick player error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update game settings (host only)
const updateGameSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  maxPlayers: z.number().int().min(2).max(8).optional(),
  visibility: z.nativeEnum(GameVisibility).optional(),
  password: z.string().nullable().optional(),
  minLevel: z.number().int().min(1).max(99).optional(),
  maxLevel: z.number().int().min(1).max(99).optional(),
  turnTimeBase: z.number().int().min(10).max(120).optional()
});

gamesRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;
    const data = updateGameSchema.parse(req.body);

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (game.hostId !== userId) {
      res.status(403).json({ error: 'Only host can update game settings' });
      return;
    }

    if (game.status !== GameStatus.LOBBY) {
      res.status(400).json({ error: 'Cannot update a started game' });
      return;
    }

    const updated = await prisma.gameSession.update({
      where: { id: gameId },
      data
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Update game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete game (host only)
gamesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const gameId = req.params.id;

    const game = await prisma.gameSession.findUnique({
      where: { id: gameId }
    });

    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (game.hostId !== userId) {
      res.status(403).json({ error: 'Only host can delete the game' });
      return;
    }

    await prisma.gameSession.delete({
      where: { id: gameId }
    });

    await redis.del(`game:${gameId}:state`);
    await redis.del(`game:${gameId}:turns`);

    res.json({ message: 'Game deleted' });
  } catch (error) {
    console.error('Delete game error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
