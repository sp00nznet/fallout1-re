import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import { authRouter } from './api/auth.js';
import { usersRouter } from './api/users.js';
import { gamesRouter } from './api/games.js';
import { savesRouter } from './api/saves.js';
import { botsRouter } from './api/bots.js';
import { setupWebSocket } from './websocket/connection.js';
import { BotManager } from './bots/bot-manager.js';

// Initialize clients
export const prisma = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const app = express();
const server = createServer(app);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/games', gamesRouter);
app.use('/api/saves', savesRouter);
app.use('/api/bots', botsRouter);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Bot manager
export const botManager = new BotManager();

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  try {
    await prisma.$connect();
    console.log('Connected to PostgreSQL');

    await redis.ping();
    console.log('Connected to Redis');

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Start bot manager
    await botManager.initialize();
    console.log('Bot manager initialized');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await botManager.shutdown();
  await prisma.$disconnect();
  redis.disconnect();
  server.close();
  process.exit(0);
});

main();
