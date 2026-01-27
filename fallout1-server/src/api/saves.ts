import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authMiddleware } from './auth.js';

export const savesRouter = Router();

// All routes require authentication
savesRouter.use(authMiddleware);

// Get all saves for current user
savesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const saves = await prisma.saveGame.findMany({
      where: { userId },
      select: {
        id: true,
        slot: true,
        name: true,
        location: true,
        level: true,
        playTime: true,
        isAutoSave: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { slot: 'asc' }
    });

    res.json(saves);
  } catch (error) {
    console.error('Get saves error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific save
savesRouter.get('/:slot', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const slot = parseInt(req.params.slot, 10);

    if (isNaN(slot) || slot < 1 || slot > 10) {
      res.status(400).json({ error: 'Invalid slot number (1-10)' });
      return;
    }

    const save = await prisma.saveGame.findUnique({
      where: {
        userId_slot: { userId, slot }
      }
    });

    if (!save) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    res.json(save);
  } catch (error) {
    console.error('Get save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download save data (binary)
savesRouter.get('/:slot/download', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const slot = parseInt(req.params.slot, 10);

    if (isNaN(slot) || slot < 1 || slot > 10) {
      res.status(400).json({ error: 'Invalid slot number (1-10)' });
      return;
    }

    const save = await prisma.saveGame.findUnique({
      where: {
        userId_slot: { userId, slot }
      },
      select: {
        name: true,
        stateData: true
      }
    });

    if (!save) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${save.name}.sav"`);
    res.send(Buffer.from(save.stateData));
  } catch (error) {
    console.error('Download save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload/create save
const saveSchema = z.object({
  slot: z.number().int().min(1).max(10),
  name: z.string().min(1).max(100),
  location: z.string().default('Unknown'),
  level: z.number().int().min(1).max(99).default(1),
  playTime: z.number().int().min(0).default(0),
  characterSnapshot: z.object({
    name: z.string(),
    level: z.number(),
    strength: z.number().optional(),
    perception: z.number().optional(),
    endurance: z.number().optional(),
    charisma: z.number().optional(),
    intelligence: z.number().optional(),
    agility: z.number().optional(),
    luck: z.number().optional(),
    maxHp: z.number().optional(),
    maxAp: z.number().optional(),
    currentHp: z.number().optional(),
    currentAp: z.number().optional(),
    skills: z.record(z.number()).optional(),
    perks: z.array(z.string()).optional(),
    inventory: z.array(z.any()).optional()
  }),
  stateData: z.string(), // Base64 encoded
  isAutoSave: z.boolean().default(false)
});

savesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const data = saveSchema.parse(req.body);

    // Decode base64 state data
    const stateBuffer = Buffer.from(data.stateData, 'base64');

    const save = await prisma.saveGame.upsert({
      where: {
        userId_slot: { userId, slot: data.slot }
      },
      create: {
        userId,
        slot: data.slot,
        name: data.name,
        location: data.location,
        level: data.level,
        playTime: data.playTime,
        characterSnapshot: data.characterSnapshot,
        stateData: stateBuffer,
        isAutoSave: data.isAutoSave
      },
      update: {
        name: data.name,
        location: data.location,
        level: data.level,
        playTime: data.playTime,
        characterSnapshot: data.characterSnapshot,
        stateData: stateBuffer,
        isAutoSave: data.isAutoSave
      },
      select: {
        id: true,
        slot: true,
        name: true,
        location: true,
        level: true,
        playTime: true,
        isAutoSave: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.status(201).json(save);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Create save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-save endpoint (simplified)
savesRouter.post('/auto', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    // Auto-save uses slot 10 by default
    const autoSaveSlot = 10;

    const data = saveSchema.parse({
      ...req.body,
      slot: autoSaveSlot,
      isAutoSave: true
    });

    const stateBuffer = Buffer.from(data.stateData, 'base64');

    const save = await prisma.saveGame.upsert({
      where: {
        userId_slot: { userId, slot: autoSaveSlot }
      },
      create: {
        userId,
        slot: autoSaveSlot,
        name: `Auto-Save - ${data.location}`,
        location: data.location,
        level: data.level,
        playTime: data.playTime,
        characterSnapshot: data.characterSnapshot,
        stateData: stateBuffer,
        isAutoSave: true
      },
      update: {
        name: `Auto-Save - ${data.location}`,
        location: data.location,
        level: data.level,
        playTime: data.playTime,
        characterSnapshot: data.characterSnapshot,
        stateData: stateBuffer
      },
      select: {
        id: true,
        slot: true,
        name: true,
        location: true,
        level: true,
        playTime: true,
        updatedAt: true
      }
    });

    res.json(save);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: error.errors });
      return;
    }
    console.error('Auto-save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete save
savesRouter.delete('/:slot', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const slot = parseInt(req.params.slot, 10);

    if (isNaN(slot) || slot < 1 || slot > 10) {
      res.status(400).json({ error: 'Invalid slot number (1-10)' });
      return;
    }

    const save = await prisma.saveGame.findUnique({
      where: {
        userId_slot: { userId, slot }
      }
    });

    if (!save) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    await prisma.saveGame.delete({
      where: {
        userId_slot: { userId, slot }
      }
    });

    res.json({ message: 'Save deleted' });
  } catch (error) {
    console.error('Delete save error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Extract character from save for multiplayer
savesRouter.post('/:slot/extract-character', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const slot = parseInt(req.params.slot, 10);

    if (isNaN(slot) || slot < 1 || slot > 10) {
      res.status(400).json({ error: 'Invalid slot number (1-10)' });
      return;
    }

    const save = await prisma.saveGame.findUnique({
      where: {
        userId_slot: { userId, slot }
      },
      select: {
        characterSnapshot: true,
        level: true
      }
    });

    if (!save) {
      res.status(404).json({ error: 'Save not found' });
      return;
    }

    const snapshot = save.characterSnapshot as any;

    // Create character from save snapshot
    const character = await prisma.character.create({
      data: {
        userId,
        name: snapshot.name || 'Vault Dweller',
        level: save.level,
        strength: snapshot.strength || 5,
        perception: snapshot.perception || 5,
        endurance: snapshot.endurance || 5,
        charisma: snapshot.charisma || 5,
        intelligence: snapshot.intelligence || 5,
        agility: snapshot.agility || 5,
        luck: snapshot.luck || 5,
        maxHp: snapshot.maxHp || 30,
        maxAp: snapshot.maxAp || 7,
        sequence: snapshot.perception ? snapshot.perception * 2 : 10,
        skills: snapshot.skills || {},
        perks: snapshot.perks || [],
        inventory: snapshot.inventory || [],
        sourceSlot: slot
      }
    });

    res.status(201).json(character);
  } catch (error) {
    console.error('Extract character error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
