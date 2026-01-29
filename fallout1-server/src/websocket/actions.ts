import { WebSocket } from 'ws';
import { prisma } from '../index.js';
import { broadcastToGame, sendToUser } from './connection.js';
import {
  broadcastPositionUpdate,
  broadcastHealthUpdate,
  broadcastApUpdate,
  broadcastPlayerDeath,
  recordChange
} from './sync.js';
import { TurnService } from '../services/turn.service.js';

interface ExtendedWebSocket extends WebSocket {
  userId?: string;
  username?: string;
  gameId?: string;
  participantId?: string;
}

interface MovePayload {
  targetTile: number;
  elevation?: number;
}

interface AttackPayload {
  targetId: string;
  weaponMode: 'single' | 'burst' | 'aimed';
  aimedLocation?: string;
}

interface UseItemPayload {
  itemId: string;
  targetId?: string;
}

interface InteractPayload {
  objectId: string;
  action: string;
}

// AP costs for various actions
const AP_COSTS = {
  MOVE_PER_HEX: 1,
  ATTACK_SINGLE: 4,
  ATTACK_BURST: 5,
  ATTACK_AIMED: 6,
  USE_ITEM: 2,
  RELOAD: 2
};

export async function handleActionMessage(
  ws: ExtendedWebSocket,
  type: string,
  payload: any
) {
  if (!ws.userId || !ws.gameId || !ws.participantId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not in a game' }));
    return;
  }

  // Check if it's this player's turn
  const turnService = new TurnService(ws.gameId);
  const isCurrentTurn = await turnService.isPlayerTurn(ws.participantId);

  const game = await prisma.gameSession.findUnique({
    where: { id: ws.gameId }
  });

  // In combat, must be your turn
  if (game?.inCombat && !isCurrentTurn) {
    ws.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
    return;
  }

  // Get participant data
  const participant = await prisma.gameParticipant.findUnique({
    where: { id: ws.participantId },
    include: { character: true }
  });

  if (!participant) {
    ws.send(JSON.stringify({ type: 'error', message: 'Participant not found' }));
    return;
  }

  if (participant.isDead) {
    ws.send(JSON.stringify({ type: 'error', message: 'You are dead' }));
    return;
  }

  switch (type) {
    case 'action:move':
      await handleMove(ws, participant, payload as MovePayload);
      break;
    case 'action:attack':
      await handleAttack(ws, participant, payload as AttackPayload);
      break;
    case 'action:use-item':
      await handleUseItem(ws, participant, payload as UseItemPayload);
      break;
    case 'action:interact':
      await handleInteract(ws, participant, payload as InteractPayload);
      break;
  }
}

async function handleMove(
  ws: ExtendedWebSocket,
  participant: any,
  payload: MovePayload
) {
  const { targetTile, elevation = participant.elevation } = payload;

  // Calculate distance (simplified - actual implementation would use hex math)
  const currentTile = participant.tileIndex;
  const distance = calculateHexDistance(currentTile, targetTile);

  // Check AP cost
  const apCost = distance * AP_COSTS.MOVE_PER_HEX;
  if (participant.currentAp < apCost) {
    ws.send(JSON.stringify({
      type: 'action:error',
      action: 'move',
      message: `Not enough AP. Need ${apCost}, have ${participant.currentAp}`
    }));
    return;
  }

  // Update position and AP
  const updated = await prisma.gameParticipant.update({
    where: { id: participant.id },
    data: {
      tileIndex: targetTile,
      elevation,
      currentAp: participant.currentAp - apCost,
      lastActiveAt: new Date()
    }
  });

  // Broadcast updates
  await broadcastPositionUpdate(ws.gameId!, participant.id, {
    tileIndex: targetTile,
    elevation,
    rotation: participant.rotation
  });

  await broadcastApUpdate(ws.gameId!, participant.id, {
    currentAp: updated.currentAp,
    maxAp: participant.character?.maxAp || 7
  });

  ws.send(JSON.stringify({
    type: 'action:move-result',
    success: true,
    newPosition: { tileIndex: targetTile, elevation },
    apSpent: apCost,
    apRemaining: updated.currentAp
  }));
}

async function handleAttack(
  ws: ExtendedWebSocket,
  participant: any,
  payload: AttackPayload
) {
  const { targetId, weaponMode, aimedLocation } = payload;

  // Get target
  const target = await prisma.gameParticipant.findUnique({
    where: { id: targetId },
    include: { character: true }
  });

  if (!target) {
    ws.send(JSON.stringify({ type: 'action:error', action: 'attack', message: 'Target not found' }));
    return;
  }

  if (target.isDead) {
    ws.send(JSON.stringify({ type: 'action:error', action: 'attack', message: 'Target is already dead' }));
    return;
  }

  if (target.sessionId !== ws.gameId) {
    ws.send(JSON.stringify({ type: 'action:error', action: 'attack', message: 'Target not in this game' }));
    return;
  }

  // Calculate AP cost
  let apCost = AP_COSTS.ATTACK_SINGLE;
  if (weaponMode === 'burst') apCost = AP_COSTS.ATTACK_BURST;
  if (weaponMode === 'aimed') apCost = AP_COSTS.ATTACK_AIMED;

  if (participant.currentAp < apCost) {
    ws.send(JSON.stringify({
      type: 'action:error',
      action: 'attack',
      message: `Not enough AP. Need ${apCost}, have ${participant.currentAp}`
    }));
    return;
  }

  // Calculate hit chance and damage (simplified combat)
  const distance = calculateHexDistance(participant.tileIndex, target.tileIndex);
  const hitChance = calculateHitChance(participant, target, distance, weaponMode, aimedLocation);
  const roll = Math.random() * 100;
  const hit = roll <= hitChance;

  let damage = 0;
  let isCritical = false;

  if (hit) {
    // Base damage (simplified)
    const baseDamage = 10 + (participant.character?.strength || 5);
    damage = baseDamage + Math.floor(Math.random() * 10);

    // Critical hit check
    const critChance = (participant.character?.luck || 5) * 2;
    if (Math.random() * 100 <= critChance) {
      damage = Math.floor(damage * 1.5);
      isCritical = true;
    }

    // Apply aimed shot bonus
    if (aimedLocation === 'eyes') {
      damage = Math.floor(damage * 1.3);
    } else if (aimedLocation === 'groin') {
      damage = Math.floor(damage * 1.2);
    }

    // Apply damage resistance (simplified)
    const resistance = target.character?.endurance || 5;
    damage = Math.max(1, damage - Math.floor(resistance / 2));
  }

  // Update attacker AP
  await prisma.gameParticipant.update({
    where: { id: participant.id },
    data: {
      currentAp: participant.currentAp - apCost,
      damageDealt: { increment: hit ? damage : 0 },
      lastActiveAt: new Date()
    }
  });

  // Update target HP if hit
  let targetDied = false;
  if (hit) {
    const newHp = Math.max(0, target.currentHp - damage);
    targetDied = newHp === 0;

    await prisma.gameParticipant.update({
      where: { id: target.id },
      data: {
        currentHp: newHp,
        isDead: targetDied
      }
    });

    await broadcastHealthUpdate(ws.gameId!, target.id, {
      currentHp: newHp,
      maxHp: target.character?.maxHp || 30
    });

    if (targetDied) {
      await prisma.gameParticipant.update({
        where: { id: participant.id },
        data: { kills: { increment: 1 } }
      });
      await prisma.gameParticipant.update({
        where: { id: target.id },
        data: { deaths: { increment: 1 } }
      });
      await broadcastPlayerDeath(ws.gameId!, target.id, participant.id);
    }
  }

  await broadcastApUpdate(ws.gameId!, participant.id, {
    currentAp: participant.currentAp - apCost,
    maxAp: participant.character?.maxAp || 7
  });

  // Broadcast combat result
  const result = {
    type: 'combat:result',
    attackerId: participant.id,
    attackerName: participant.character?.name || ws.username,
    targetId: target.id,
    targetName: target.character?.name || 'Unknown',
    hit,
    damage: hit ? damage : 0,
    isCritical,
    aimedLocation,
    hitChance,
    roll: Math.floor(roll),
    targetDied,
    apSpent: apCost
  };

  broadcastToGame(ws.gameId!, result);

  ws.send(JSON.stringify({
    ...result,
    type: 'action:attack-result',
    apRemaining: participant.currentAp - apCost
  }));
}

async function handleUseItem(
  ws: ExtendedWebSocket,
  participant: any,
  payload: UseItemPayload
) {
  const { itemId, targetId } = payload;

  // Check AP
  if (participant.currentAp < AP_COSTS.USE_ITEM) {
    ws.send(JSON.stringify({
      type: 'action:error',
      action: 'use-item',
      message: `Not enough AP. Need ${AP_COSTS.USE_ITEM}, have ${participant.currentAp}`
    }));
    return;
  }

  // Simplified item use - in reality would check inventory
  // For now, assume stimpak healing
  let healAmount = 0;
  if (itemId === 'stimpak') {
    healAmount = 10 + Math.floor(Math.random() * 10);
  } else if (itemId === 'super-stimpak') {
    healAmount = 30 + Math.floor(Math.random() * 20);
  }

  const target = targetId
    ? await prisma.gameParticipant.findUnique({ where: { id: targetId } })
    : participant;

  if (!target || target.sessionId !== ws.gameId) {
    ws.send(JSON.stringify({ type: 'action:error', action: 'use-item', message: 'Invalid target' }));
    return;
  }

  const maxHp = target.character?.maxHp || 30;
  const newHp = Math.min(maxHp, target.currentHp + healAmount);

  await prisma.gameParticipant.update({
    where: { id: target.id },
    data: { currentHp: newHp }
  });

  await prisma.gameParticipant.update({
    where: { id: participant.id },
    data: { currentAp: participant.currentAp - AP_COSTS.USE_ITEM }
  });

  await broadcastHealthUpdate(ws.gameId!, target.id, {
    currentHp: newHp,
    maxHp
  });

  await broadcastApUpdate(ws.gameId!, participant.id, {
    currentAp: participant.currentAp - AP_COSTS.USE_ITEM,
    maxAp: participant.character?.maxAp || 7
  });

  await recordChange(ws.gameId!, {
    type: 'item-used',
    userId: ws.userId,
    itemId,
    targetId: target.id,
    effect: { heal: newHp - target.currentHp }
  });

  ws.send(JSON.stringify({
    type: 'action:use-item-result',
    success: true,
    itemId,
    targetId: target.id,
    healAmount: newHp - target.currentHp,
    apRemaining: participant.currentAp - AP_COSTS.USE_ITEM
  }));
}

async function handleInteract(
  ws: ExtendedWebSocket,
  participant: any,
  payload: InteractPayload
) {
  // Placeholder for object interaction
  // Would handle doors, containers, NPCs, etc.
  ws.send(JSON.stringify({
    type: 'action:interact-result',
    success: true,
    objectId: payload.objectId,
    action: payload.action
  }));
}

// Simplified hex distance calculation
function calculateHexDistance(tile1: number, tile2: number): number {
  // Assuming 200x200 grid
  const GRID_WIDTH = 200;
  const x1 = tile1 % GRID_WIDTH;
  const y1 = Math.floor(tile1 / GRID_WIDTH);
  const x2 = tile2 % GRID_WIDTH;
  const y2 = Math.floor(tile2 / GRID_WIDTH);

  // Convert to cube coordinates for hex distance
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);

  return Math.max(dx, dy, Math.abs(dx - dy));
}

// Simplified hit chance calculation
function calculateHitChance(
  attacker: any,
  target: any,
  distance: number,
  weaponMode: string,
  aimedLocation?: string
): number {
  // Base hit chance from skills (simplified)
  let baseChance = 50 + (attacker.character?.perception || 5) * 2;

  // Distance penalty
  baseChance -= distance * 4;

  // Aimed shot penalty
  if (aimedLocation) {
    switch (aimedLocation) {
      case 'eyes': baseChance -= 40; break;
      case 'head': baseChance -= 20; break;
      case 'groin': baseChance -= 30; break;
      case 'legs': baseChance -= 10; break;
      case 'arms': baseChance -= 10; break;
    }
  }

  // Burst bonus
  if (weaponMode === 'burst') {
    baseChance += 20;
  }

  // Target agility affects dodge
  baseChance -= (target.character?.agility || 5);

  // Clamp between 5% and 95%
  return Math.max(5, Math.min(95, baseChance));
}
