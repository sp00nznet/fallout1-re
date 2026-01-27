/**
 * Renderer for other players in multiplayer mode
 */

import { stateSync, ParticipantState } from './StateSync.js';

interface RenderConfig {
  canvas: HTMLCanvasElement;
  tileWidth: number;
  tileHeight: number;
  gridWidth: number;
  cameraX: number;
  cameraY: number;
}

interface PlayerSprite {
  participantId: string;
  currentFrame: number;
  animationTimer: number;
  lastTileIndex: number;
  isAnimating: boolean;
  targetTileIndex: number;
  interpolation: number;
}

export class PlayerRenderer {
  private config: RenderConfig;
  private ctx: CanvasRenderingContext2D;
  private sprites: Map<string, PlayerSprite> = new Map();
  private localParticipantId: string | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private unsubscribers: Array<() => void> = [];

  // Colors for different player states
  private readonly COLORS = {
    friendly: '#4a9f4a',
    hostile: '#9f4a4a',
    bot: '#4a4a9f',
    dead: '#666666',
    currentTurn: '#ffcc00'
  };

  constructor(config: RenderConfig) {
    this.config = config;
    this.ctx = config.canvas.getContext('2d')!;
    this.setupListeners();
  }

  setLocalParticipant(participantId: string): void {
    this.localParticipantId = participantId;
  }

  updateCamera(x: number, y: number): void {
    this.config.cameraX = x;
    this.config.cameraY = y;
  }

  private setupListeners(): void {
    // Listen for participant changes
    const unsubParticipant = stateSync.onParticipantChange((participant, changeType) => {
      if (participant.id === this.localParticipantId) return;

      switch (changeType) {
        case 'moved':
          this.handlePlayerMoved(participant);
          break;
        case 'joined':
          this.addPlayerSprite(participant);
          break;
        case 'left':
          this.removePlayerSprite(participant.id);
          break;
      }
    });

    this.unsubscribers.push(unsubParticipant);
  }

  private handlePlayerMoved(participant: ParticipantState): void {
    let sprite = this.sprites.get(participant.id);

    if (!sprite) {
      sprite = this.addPlayerSprite(participant);
    }

    // Start movement animation
    sprite.lastTileIndex = sprite.targetTileIndex;
    sprite.targetTileIndex = participant.tileIndex;
    sprite.isAnimating = true;
    sprite.interpolation = 0;
  }

  private addPlayerSprite(participant: ParticipantState): PlayerSprite {
    const sprite: PlayerSprite = {
      participantId: participant.id,
      currentFrame: 0,
      animationTimer: 0,
      lastTileIndex: participant.tileIndex,
      isAnimating: false,
      targetTileIndex: participant.tileIndex,
      interpolation: 1
    };

    this.sprites.set(participant.id, sprite);
    return sprite;
  }

  private removePlayerSprite(participantId: string): void {
    this.sprites.delete(participantId);
  }

  start(): void {
    if (this.animationFrameId !== null) return;

    this.lastFrameTime = performance.now();
    this.tick();
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }

  private tick = (): void => {
    const now = performance.now();
    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.update(deltaTime);
    this.render();

    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private update(deltaTime: number): void {
    // Update sprite animations
    for (const sprite of this.sprites.values()) {
      if (sprite.isAnimating) {
        sprite.interpolation += deltaTime * 4; // Animation speed
        if (sprite.interpolation >= 1) {
          sprite.interpolation = 1;
          sprite.isAnimating = false;
          sprite.lastTileIndex = sprite.targetTileIndex;
        }
      }

      // Update frame animation
      sprite.animationTimer += deltaTime;
      if (sprite.animationTimer >= 0.2) { // 5 FPS for idle animation
        sprite.animationTimer = 0;
        sprite.currentFrame = (sprite.currentFrame + 1) % 4;
      }
    }
  }

  render(): void {
    const state = stateSync.getState();
    if (!state) return;

    const { tileWidth, tileHeight, gridWidth, cameraX, cameraY } = this.config;
    const currentTurnId = state.turnInfo?.currentPlayerId;

    // Render each participant (except local player)
    for (const participant of state.participants) {
      if (participant.id === this.localParticipantId) continue;

      const sprite = this.sprites.get(participant.id);
      let tileIndex = participant.tileIndex;
      let interpolatedX = 0;
      let interpolatedY = 0;

      // Calculate position
      if (sprite?.isAnimating) {
        const lastX = (sprite.lastTileIndex % gridWidth) * tileWidth;
        const lastY = Math.floor(sprite.lastTileIndex / gridWidth) * tileHeight;
        const targetX = (sprite.targetTileIndex % gridWidth) * tileWidth;
        const targetY = Math.floor(sprite.targetTileIndex / gridWidth) * tileHeight;

        interpolatedX = lastX + (targetX - lastX) * sprite.interpolation;
        interpolatedY = lastY + (targetY - lastY) * sprite.interpolation;
      } else {
        interpolatedX = (tileIndex % gridWidth) * tileWidth;
        interpolatedY = Math.floor(tileIndex / gridWidth) * tileHeight;
      }

      // Convert to screen coordinates
      const screenX = interpolatedX - cameraX + this.config.canvas.width / 2;
      const screenY = interpolatedY - cameraY + this.config.canvas.height / 2;

      // Skip if off screen
      if (screenX < -50 || screenX > this.config.canvas.width + 50 ||
          screenY < -50 || screenY > this.config.canvas.height + 50) {
        continue;
      }

      this.renderPlayer(participant, screenX, screenY, participant.id === currentTurnId);
    }
  }

  private renderPlayer(
    participant: ParticipantState,
    x: number,
    y: number,
    isCurrentTurn: boolean
  ): void {
    const ctx = this.ctx;

    // Determine color
    let color = this.COLORS.friendly;
    if (participant.isDead) {
      color = this.COLORS.dead;
    } else if (participant.isBot) {
      color = this.COLORS.bot;
    } else if (isCurrentTurn) {
      color = this.COLORS.currentTurn;
    }

    // Draw player indicator (simple circle for now)
    ctx.save();

    // Current turn glow
    if (isCurrentTurn && !participant.isDead) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
    }

    // Player circle
    ctx.beginPath();
    ctx.arc(x, y - 20, 12, 0, Math.PI * 2);
    ctx.fillStyle = participant.isDead ? color : this.COLORS.friendly;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Health bar background
    const healthBarWidth = 30;
    const healthBarHeight = 4;
    const healthBarX = x - healthBarWidth / 2;
    const healthBarY = y - 38;

    ctx.fillStyle = '#333';
    ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    // Health bar fill
    const healthPercent = participant.maxHp > 0 ? participant.currentHp / participant.maxHp : 0;
    const healthColor = healthPercent > 0.5 ? '#4a9f4a' :
                        healthPercent > 0.25 ? '#9f9f4a' : '#9f4a4a';
    ctx.fillStyle = healthColor;
    ctx.fillRect(healthBarX, healthBarY, healthBarWidth * healthPercent, healthBarHeight);

    // Name tag
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(participant.characterName || participant.username, x, y - 45);

    // Bot/Host badge
    if (participant.isBot) {
      ctx.fillStyle = '#4a4a9f';
      ctx.fillText('[BOT]', x, y - 56);
    } else if (participant.isHost) {
      ctx.fillStyle = '#4a9f4a';
      ctx.fillText('[HOST]', x, y - 56);
    }

    // Dead indicator
    if (participant.isDead) {
      ctx.fillStyle = '#ff6b6b';
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.fillText('DEAD', x, y - 5);
    }

    ctx.restore();
  }

  // Render combat target indicator
  renderTargetIndicator(participantId: string): void {
    const state = stateSync.getState();
    if (!state) return;

    const participant = state.participants.find(p => p.id === participantId);
    if (!participant) return;

    const { tileWidth, tileHeight, gridWidth, cameraX, cameraY } = this.config;

    const screenX = (participant.tileIndex % gridWidth) * tileWidth - cameraX + this.config.canvas.width / 2;
    const screenY = Math.floor(participant.tileIndex / gridWidth) * tileHeight - cameraY + this.config.canvas.height / 2;

    const ctx = this.ctx;
    ctx.save();

    // Pulsing target circle
    const pulse = Math.sin(performance.now() / 200) * 0.3 + 0.7;
    ctx.strokeStyle = `rgba(255, 100, 100, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(screenX, screenY - 20, 20, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    ctx.strokeStyle = '#ff6464';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenX - 25, screenY - 20);
    ctx.lineTo(screenX - 10, screenY - 20);
    ctx.moveTo(screenX + 10, screenY - 20);
    ctx.lineTo(screenX + 25, screenY - 20);
    ctx.moveTo(screenX, screenY - 45);
    ctx.lineTo(screenX, screenY - 30);
    ctx.moveTo(screenX, screenY - 10);
    ctx.lineTo(screenX, screenY + 5);
    ctx.stroke();

    ctx.restore();
  }
}
