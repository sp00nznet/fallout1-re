/**
 * Lobby screen showing current game session and players
 */

import { gameService, GameSession, Participant } from '../services/GameService.js';
import { authService } from '../services/AuthService.js';

interface LobbyScreenOptions {
  gameId: string;
  onLeave: () => void;
  onGameStart: () => void;
}

export class LobbyScreen {
  private container: HTMLDivElement;
  private gameId: string;
  private game: GameSession | null = null;
  private onLeave: () => void;
  private onGameStart: () => void;
  private refreshInterval: number | null = null;

  constructor(options: LobbyScreenOptions) {
    this.gameId = options.gameId;
    this.onLeave = options.onLeave;
    this.onGameStart = options.onGameStart;
    this.container = document.createElement('div');
    this.container.className = 'lobby-screen';
  }

  async mount(parent: HTMLElement): Promise<void> {
    parent.appendChild(this.container);
    this.addStyles();
    await this.refresh();

    // Auto-refresh every 2 seconds
    this.refreshInterval = window.setInterval(() => this.refresh(), 2000);
  }

  unmount(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container.remove();
  }

  private async refresh(): Promise<void> {
    try {
      this.game = await gameService.getGame(this.gameId);

      // Check if game started
      if (this.game.status === 'PLAYING') {
        this.unmount();
        this.onGameStart();
        return;
      }

      this.render();
    } catch (error) {
      console.error('Failed to refresh lobby:', error);
    }
  }

  private render(): void {
    if (!this.game) {
      this.container.innerHTML = '<div class="lobby-loading">Loading...</div>';
      return;
    }

    const user = authService.getUser();
    const isHost = user?.id === this.game.hostId;
    const myParticipant = this.game.participants.find(p => p.userId === user?.id);
    const allReady = this.game.participants.every(p => p.isReady);
    const canStart = isHost && allReady && this.game.participants.length >= 2;

    this.container.innerHTML = `
      <div class="lobby-overlay">
        <div class="lobby-modal">
          <div class="lobby-header">
            <h2>${this.game.name}</h2>
            <div class="lobby-info">
              <span class="player-count">${this.game.participants.length}/${this.game.maxPlayers} players</span>
              <span class="map-name">Map: ${this.game.currentMap}</span>
            </div>
          </div>

          <div class="lobby-players">
            <h3>Players</h3>
            <ul class="player-list">
              ${this.game.participants.map(p => this.renderParticipant(p, isHost, user?.id)).join('')}
            </ul>
          </div>

          <div class="lobby-settings">
            <div class="setting">
              <span class="setting-label">Turn Time:</span>
              <span class="setting-value">${this.game.turnTimeBase}s</span>
            </div>
            <div class="setting">
              <span class="setting-label">Level Range:</span>
              <span class="setting-value">${this.game.minLevel}-${this.game.maxLevel}</span>
            </div>
            <div class="setting">
              <span class="setting-label">Visibility:</span>
              <span class="setting-value">${this.game.visibility}</span>
            </div>
          </div>

          <div class="lobby-chat">
            <div class="chat-messages" id="chat-messages">
              <div class="chat-system">Welcome to the lobby!</div>
            </div>
            <div class="chat-input">
              <input type="text" id="chat-input" placeholder="Type a message..." maxlength="200">
              <button id="chat-send">Send</button>
            </div>
          </div>

          <div class="lobby-actions">
            ${myParticipant ? `
              <button class="ready-btn ${myParticipant.isReady ? 'ready' : ''}" id="ready-btn">
                ${myParticipant.isReady ? 'Ready!' : 'Not Ready'}
              </button>
            ` : ''}

            ${canStart ? `
              <button class="start-btn" id="start-btn">Start Game</button>
            ` : (isHost ? `
              <button class="start-btn" disabled>
                ${!allReady ? 'Waiting for players...' : 'Need more players'}
              </button>
            ` : '')}

            <button class="leave-btn" id="leave-btn">Leave Game</button>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  private renderParticipant(p: Participant, isHost: boolean, currentUserId?: string): string {
    const isSelf = p.userId === currentUserId;
    const canKick = isHost && !p.isHost && !isSelf;

    return `
      <li class="player-item ${p.isReady ? 'ready' : ''} ${p.isConnected ? '' : 'disconnected'}">
        <div class="player-info">
          <span class="player-name">${p.characterName || p.username}</span>
          ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
          ${p.isBot ? '<span class="bot-badge">BOT</span>' : ''}
          ${isSelf ? '<span class="you-badge">YOU</span>' : ''}
        </div>
        <div class="player-status">
          <span class="status-indicator ${p.isReady ? 'ready' : 'not-ready'}">
            ${p.isReady ? 'Ready' : 'Not Ready'}
          </span>
          ${canKick ? `<button class="kick-btn" data-participant-id="${p.id}">Kick</button>` : ''}
        </div>
      </li>
    `;
  }

  private attachEventListeners(): void {
    const readyBtn = this.container.querySelector('#ready-btn');
    const startBtn = this.container.querySelector('#start-btn');
    const leaveBtn = this.container.querySelector('#leave-btn');
    const chatInput = this.container.querySelector('#chat-input') as HTMLInputElement;
    const chatSend = this.container.querySelector('#chat-send');

    readyBtn?.addEventListener('click', () => this.handleReady());
    startBtn?.addEventListener('click', () => this.handleStart());
    leaveBtn?.addEventListener('click', () => this.handleLeave());

    chatSend?.addEventListener('click', () => this.handleSendChat(chatInput));
    chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSendChat(chatInput);
    });

    // Kick buttons
    const kickBtns = this.container.querySelectorAll('.kick-btn');
    kickBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const participantId = (e.target as HTMLElement).dataset.participantId;
        if (participantId) this.handleKick(participantId);
      });
    });
  }

  private async handleReady(): Promise<void> {
    try {
      await gameService.toggleReady(this.gameId);
      await this.refresh();
    } catch (error) {
      console.error('Failed to toggle ready:', error);
    }
  }

  private async handleStart(): Promise<void> {
    try {
      await gameService.startGame(this.gameId);
    } catch (error) {
      console.error('Failed to start game:', error);
      alert(error instanceof Error ? error.message : 'Failed to start game');
    }
  }

  private async handleLeave(): Promise<void> {
    try {
      await gameService.leaveGame(this.gameId);
      this.unmount();
      this.onLeave();
    } catch (error) {
      console.error('Failed to leave game:', error);
    }
  }

  private async handleKick(participantId: string): Promise<void> {
    if (!confirm('Are you sure you want to kick this player?')) return;

    try {
      await gameService.kickPlayer(this.gameId, participantId);
      await this.refresh();
    } catch (error) {
      console.error('Failed to kick player:', error);
    }
  }

  private handleSendChat(input: HTMLInputElement): void {
    const message = input.value.trim();
    if (!message) return;

    // Would send via WebSocket in full implementation
    const chatMessages = this.container.querySelector('#chat-messages');
    if (chatMessages) {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message';
      const user = authService.getUser();
      msgDiv.innerHTML = `<strong>${user?.username || 'You'}:</strong> ${message}`;
      chatMessages.appendChild(msgDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    input.value = '';
  }

  private addStyles(): void {
    if (document.getElementById('lobby-screen-styles')) return;

    const style = document.createElement('style');
    style.id = 'lobby-screen-styles';
    style.textContent = `
      .lobby-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
      }

      .lobby-overlay {
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        justify-content: center;
        align-items: center;
      }

      .lobby-modal {
        background: #1a1a2e;
        border: 2px solid #4a9f4a;
        border-radius: 8px;
        padding: 24px;
        width: 100%;
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
        color: #e0e0e0;
        font-family: 'Courier New', monospace;
      }

      .lobby-header {
        margin-bottom: 20px;
      }

      .lobby-header h2 {
        margin: 0 0 8px 0;
        color: #4a9f4a;
      }

      .lobby-info {
        display: flex;
        gap: 16px;
        color: #888;
        font-size: 14px;
      }

      .lobby-players h3 {
        color: #aaa;
        font-size: 14px;
        margin: 0 0 8px 0;
      }

      .player-list {
        list-style: none;
        padding: 0;
        margin: 0 0 20px 0;
      }

      .player-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px;
        background: #0d0d1a;
        border-radius: 4px;
        margin-bottom: 4px;
      }

      .player-item.disconnected {
        opacity: 0.5;
      }

      .player-info {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .player-name {
        font-weight: bold;
      }

      .host-badge, .bot-badge, .you-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        text-transform: uppercase;
      }

      .host-badge {
        background: #4a9f4a;
        color: #000;
      }

      .bot-badge {
        background: #4a4a9f;
        color: #fff;
      }

      .you-badge {
        background: #9f4a4a;
        color: #fff;
      }

      .status-indicator {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 3px;
      }

      .status-indicator.ready {
        background: #1a4a1a;
        color: #4a9f4a;
      }

      .status-indicator.not-ready {
        background: #4a3a1a;
        color: #9f7a4a;
      }

      .kick-btn {
        padding: 4px 8px;
        background: #4a1a1a;
        border: none;
        border-radius: 3px;
        color: #ff6b6b;
        cursor: pointer;
        font-size: 12px;
        margin-left: 8px;
      }

      .lobby-settings {
        display: flex;
        gap: 16px;
        margin-bottom: 20px;
        padding: 10px;
        background: #0d0d1a;
        border-radius: 4px;
      }

      .setting {
        font-size: 14px;
      }

      .setting-label {
        color: #888;
      }

      .setting-value {
        color: #fff;
        margin-left: 4px;
      }

      .lobby-chat {
        margin-bottom: 20px;
      }

      .chat-messages {
        height: 120px;
        overflow-y: auto;
        background: #0d0d1a;
        border-radius: 4px;
        padding: 10px;
        margin-bottom: 8px;
        font-size: 14px;
      }

      .chat-system {
        color: #888;
        font-style: italic;
      }

      .chat-message {
        margin-bottom: 4px;
      }

      .chat-input {
        display: flex;
        gap: 8px;
      }

      .chat-input input {
        flex: 1;
        padding: 8px;
        background: #0d0d1a;
        border: 1px solid #333;
        border-radius: 4px;
        color: #fff;
        font-family: inherit;
      }

      .chat-input button {
        padding: 8px 16px;
        background: #333;
        border: none;
        border-radius: 4px;
        color: #fff;
        cursor: pointer;
      }

      .lobby-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }

      .lobby-actions button {
        padding: 10px 20px;
        border: none;
        border-radius: 4px;
        font-family: inherit;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .ready-btn {
        background: #4a3a1a;
        color: #9f7a4a;
      }

      .ready-btn.ready {
        background: #1a4a1a;
        color: #4a9f4a;
      }

      .start-btn {
        background: #4a9f4a;
        color: #000;
        font-weight: bold;
      }

      .start-btn:disabled {
        background: #333;
        color: #666;
        cursor: not-allowed;
      }

      .leave-btn {
        background: #4a1a1a;
        color: #ff6b6b;
      }
    `;
    document.head.appendChild(style);
  }
}
