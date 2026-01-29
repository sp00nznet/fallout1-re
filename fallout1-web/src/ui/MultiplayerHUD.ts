/**
 * Multiplayer HUD showing turn info, player list, and chat
 */

import { stateSync, GameState, ParticipantState, TurnInfo } from '../multiplayer/StateSync.js';
import { multiplayerClient } from '../multiplayer/MultiplayerClient.js';

interface MultiplayerHUDOptions {
  localParticipantId: string;
  onTargetSelect?: (participantId: string) => void;
}

export class MultiplayerHUD {
  private container: HTMLDivElement;
  private localParticipantId: string;
  private onTargetSelect?: (participantId: string) => void;
  private turnTimer: number | null = null;
  private timeRemaining = 0;
  private chatMessages: Array<{ sender: string; message: string; isSystem: boolean }> = [];
  private unsubscribers: Array<() => void> = [];

  constructor(options: MultiplayerHUDOptions) {
    this.localParticipantId = options.localParticipantId;
    if (options.onTargetSelect) {
      this.onTargetSelect = options.onTargetSelect;
    }
    this.container = document.createElement('div');
    this.container.className = 'multiplayer-hud';
    this.setupListeners();
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
    this.addStyles();
    this.render();
  }

  unmount(): void {
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
    this.container.remove();
  }

  private setupListeners(): void {
    // State changes
    const unsubState = stateSync.onStateChange((_state) => {
      this.render();
    });
    this.unsubscribers.push(unsubState);

    // Turn changes
    const unsubTurn = stateSync.onTurnChange((turnInfo) => {
      this.startTurnTimer(turnInfo.timeRemaining || 30);
      this.render();
    });
    this.unsubscribers.push(unsubTurn);

    // Combat events
    const unsubCombat = stateSync.onCombat((data) => {
      if (data.type === 'result') {
        this.addChatMessage(
          'COMBAT',
          `${data.attackerName} ${data.hit ? 'hit' : 'missed'} ${data.targetName}` +
          (data.hit ? ` for ${data.damage} damage${data.isCritical ? ' (CRITICAL!)' : ''}` : '') +
          (data.targetDied ? ' - KILL!' : ''),
          true
        );
      } else if (data.type === 'started') {
        this.addChatMessage('SYSTEM', 'Combat has begun!', true);
      } else if (data.type === 'ended') {
        this.addChatMessage('SYSTEM', 'Combat has ended.', true);
      }
    });
    this.unsubscribers.push(unsubCombat);

    // Chat messages
    multiplayerClient.on('chat:message', (data) => {
      this.addChatMessage(data.senderName, data.message, data.isSystem || false);
    });
  }

  private startTurnTimer(seconds: number): void {
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
    }

    this.timeRemaining = seconds;

    this.turnTimer = window.setInterval(() => {
      this.timeRemaining = Math.max(0, this.timeRemaining - 1);
      this.updateTimerDisplay();

      if (this.timeRemaining <= 0 && this.turnTimer) {
        clearInterval(this.turnTimer);
        this.turnTimer = null;
      }
    }, 1000);
  }

  private updateTimerDisplay(): void {
    const timerEl = this.container.querySelector('.turn-timer-value');
    if (timerEl) {
      timerEl.textContent = this.formatTime(this.timeRemaining);
      timerEl.classList.toggle('warning', this.timeRemaining <= 10);
      timerEl.classList.toggle('critical', this.timeRemaining <= 5);
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
  }

  private addChatMessage(sender: string, message: string, isSystem: boolean): void {
    this.chatMessages.push({ sender, message, isSystem });
    if (this.chatMessages.length > 50) {
      this.chatMessages.shift();
    }
    this.renderChat();
  }

  private render(): void {
    const state = stateSync.getState();
    if (!state) {
      this.container.innerHTML = '<div class="hud-loading">Connecting...</div>';
      return;
    }

    const localParticipant = state.participants.find(p => p.id === this.localParticipantId);
    const isMyTurn = state.turnInfo?.currentPlayerId === this.localParticipantId;
    const currentTurnPlayer = state.turnInfo ?
      state.participants.find(p => p.id === state.turnInfo!.currentPlayerId) : null;

    this.container.innerHTML = `
      <div class="hud-top">
        ${state.session.inCombat ? this.renderCombatInfo(state, isMyTurn, currentTurnPlayer) : ''}
      </div>

      <div class="hud-left">
        ${this.renderPlayerList(state.participants, state.turnInfo)}
      </div>

      <div class="hud-right">
        ${this.renderLocalStats(localParticipant)}
      </div>

      <div class="hud-bottom">
        ${this.renderChat()}
        ${isMyTurn && state.session.inCombat ? this.renderActionBar(localParticipant) : ''}
      </div>
    `;

    this.attachEventListeners();
  }

  private renderCombatInfo(
    state: GameState,
    isMyTurn: boolean,
    currentTurnPlayer: ParticipantState | null | undefined
  ): string {
    return `
      <div class="combat-info">
        <div class="combat-round">Round ${state.session.combatRound}</div>
        <div class="turn-indicator ${isMyTurn ? 'my-turn' : ''}">
          ${isMyTurn ? 'YOUR TURN' : `${currentTurnPlayer?.characterName || 'Unknown'}'s turn`}
        </div>
        <div class="turn-timer">
          <span class="turn-timer-label">Time:</span>
          <span class="turn-timer-value">${this.formatTime(this.timeRemaining)}</span>
        </div>
      </div>
    `;
  }

  private renderPlayerList(participants: ParticipantState[], turnInfo?: TurnInfo): string {
    const sorted = [...participants].sort((a, b) => {
      if (a.isDead !== b.isDead) return a.isDead ? 1 : -1;
      return b.turnOrder - a.turnOrder;
    });

    return `
      <div class="player-list-panel">
        <div class="panel-header">Players</div>
        <ul class="player-list">
          ${sorted.map(p => this.renderPlayerListItem(p, turnInfo)).join('')}
        </ul>
      </div>
    `;
  }

  private renderPlayerListItem(p: ParticipantState, turnInfo?: TurnInfo): string {
    const isCurrentTurn = turnInfo?.currentPlayerId === p.id;
    const isLocal = p.id === this.localParticipantId;
    const healthPercent = p.maxHp > 0 ? (p.currentHp / p.maxHp) * 100 : 0;

    return `
      <li class="player-item ${p.isDead ? 'dead' : ''} ${isCurrentTurn ? 'current-turn' : ''} ${isLocal ? 'local' : ''}"
          data-participant-id="${p.id}">
        <div class="player-header">
          <span class="player-name">${p.characterName || p.username}</span>
          ${p.isBot ? '<span class="badge bot">BOT</span>' : ''}
          ${p.isHost ? '<span class="badge host">HOST</span>' : ''}
          ${isLocal ? '<span class="badge you">YOU</span>' : ''}
        </div>
        <div class="player-bars">
          <div class="health-bar">
            <div class="health-fill" style="width: ${healthPercent}%"></div>
            <span class="health-text">${p.currentHp}/${p.maxHp}</span>
          </div>
          ${p.isInCombat ? `
            <div class="ap-bar">
              <div class="ap-fill" style="width: ${(p.currentAp / p.maxAp) * 100}%"></div>
              <span class="ap-text">AP: ${p.currentAp}</span>
            </div>
          ` : ''}
        </div>
        ${!isLocal && !p.isDead && p.isInCombat ? `
          <button class="target-btn" data-target-id="${p.id}">Target</button>
        ` : ''}
      </li>
    `;
  }

  private renderLocalStats(participant?: ParticipantState): string {
    if (!participant) return '';

    return `
      <div class="local-stats-panel">
        <div class="panel-header">${participant.characterName || 'You'}</div>
        <div class="stat-row">
          <span class="stat-label">HP:</span>
          <span class="stat-value">${participant.currentHp}/${participant.maxHp}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">AP:</span>
          <span class="stat-value">${participant.currentAp}/${participant.maxAp}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Position:</span>
          <span class="stat-value">${participant.tileIndex}</span>
        </div>
      </div>
    `;
  }

  private renderChat(): string {
    return `
      <div class="chat-panel">
        <div class="chat-messages" id="hud-chat-messages">
          ${this.chatMessages.map(m => `
            <div class="chat-message ${m.isSystem ? 'system' : ''}">
              <span class="chat-sender">${m.sender}:</span>
              <span class="chat-text">${this.escapeHtml(m.message)}</span>
            </div>
          `).join('')}
        </div>
        <div class="chat-input-row">
          <input type="text" id="hud-chat-input" placeholder="Type message..."
                 maxlength="200" autocomplete="off">
          <button id="hud-chat-send">Send</button>
        </div>
      </div>
    `;
  }

  private renderActionBar(participant?: ParticipantState): string {
    if (!participant) return '';

    return `
      <div class="action-bar">
        <button class="action-btn" id="action-attack" ${participant.currentAp < 4 ? 'disabled' : ''}>
          Attack (4 AP)
        </button>
        <button class="action-btn" id="action-move" ${participant.currentAp < 1 ? 'disabled' : ''}>
          Move (1+ AP)
        </button>
        <button class="action-btn" id="action-heal" ${participant.currentAp < 2 ? 'disabled' : ''}>
          Use Stimpak (2 AP)
        </button>
        <button class="action-btn end-turn" id="action-end-turn">
          End Turn
        </button>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private attachEventListeners(): void {
    // Chat input
    const chatInput = this.container.querySelector('#hud-chat-input') as HTMLInputElement;
    const chatSend = this.container.querySelector('#hud-chat-send');

    chatSend?.addEventListener('click', () => this.sendChat(chatInput));
    chatInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat(chatInput);
    });

    // Target buttons
    const targetBtns = this.container.querySelectorAll('.target-btn');
    targetBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = (e.target as HTMLElement).dataset.targetId;
        if (targetId && this.onTargetSelect) {
          this.onTargetSelect(targetId);
        }
      });
    });

    // Action buttons
    const endTurnBtn = this.container.querySelector('#action-end-turn');
    endTurnBtn?.addEventListener('click', () => {
      multiplayerClient.endTurn();
    });

    const healBtn = this.container.querySelector('#action-heal');
    healBtn?.addEventListener('click', () => {
      multiplayerClient.useItem('stimpak', this.localParticipantId);
    });

    // Scroll chat to bottom
    const chatMessages = this.container.querySelector('#hud-chat-messages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  private sendChat(input: HTMLInputElement): void {
    const message = input.value.trim();
    if (!message) return;

    multiplayerClient.sendChat(message);
    input.value = '';
  }

  private addStyles(): void {
    if (document.getElementById('multiplayer-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'multiplayer-hud-styles';
    style.textContent = `
      .multiplayer-hud {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        font-family: 'Courier New', monospace;
        z-index: 100;
      }

      .multiplayer-hud > * {
        pointer-events: auto;
      }

      .hud-top {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
      }

      .hud-left {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 200px;
      }

      .hud-right {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 160px;
      }

      .hud-bottom {
        position: absolute;
        bottom: 10px;
        left: 10px;
        right: 10px;
        display: flex;
        gap: 10px;
      }

      /* Combat Info */
      .combat-info {
        background: rgba(0, 0, 0, 0.8);
        border: 1px solid #4a9f4a;
        border-radius: 4px;
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 20px;
        color: #fff;
      }

      .combat-round {
        font-size: 14px;
        color: #888;
      }

      .turn-indicator {
        font-size: 18px;
        font-weight: bold;
      }

      .turn-indicator.my-turn {
        color: #ffcc00;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .turn-timer-value {
        font-size: 20px;
        font-weight: bold;
      }

      .turn-timer-value.warning {
        color: #ff9f4a;
      }

      .turn-timer-value.critical {
        color: #ff4a4a;
        animation: pulse 0.5s infinite;
      }

      /* Panels */
      .player-list-panel,
      .local-stats-panel,
      .chat-panel {
        background: rgba(0, 0, 0, 0.8);
        border: 1px solid #333;
        border-radius: 4px;
      }

      .panel-header {
        padding: 8px 10px;
        background: #1a1a1a;
        border-bottom: 1px solid #333;
        font-size: 12px;
        color: #888;
        text-transform: uppercase;
      }

      /* Player List */
      .player-list {
        list-style: none;
        padding: 0;
        margin: 0;
        max-height: 300px;
        overflow-y: auto;
      }

      .player-item {
        padding: 8px 10px;
        border-bottom: 1px solid #222;
      }

      .player-item.current-turn {
        background: rgba(255, 204, 0, 0.1);
        border-left: 3px solid #ffcc00;
      }

      .player-item.local {
        background: rgba(74, 159, 74, 0.1);
      }

      .player-item.dead {
        opacity: 0.5;
      }

      .player-header {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 4px;
      }

      .player-name {
        color: #fff;
        font-size: 13px;
      }

      .badge {
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 2px;
      }

      .badge.bot { background: #4a4a9f; color: #fff; }
      .badge.host { background: #4a9f4a; color: #000; }
      .badge.you { background: #9f4a4a; color: #fff; }

      .player-bars {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .health-bar,
      .ap-bar {
        height: 12px;
        background: #1a1a1a;
        border-radius: 2px;
        position: relative;
        overflow: hidden;
      }

      .health-fill {
        height: 100%;
        background: linear-gradient(to right, #9f4a4a, #4a9f4a);
        transition: width 0.3s;
      }

      .ap-fill {
        height: 100%;
        background: #4a7a9f;
        transition: width 0.3s;
      }

      .health-text,
      .ap-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 10px;
        color: #fff;
        text-shadow: 0 0 2px #000;
      }

      .target-btn {
        margin-top: 4px;
        padding: 2px 8px;
        background: #4a1a1a;
        border: none;
        border-radius: 2px;
        color: #ff6b6b;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
      }

      /* Local Stats */
      .local-stats-panel {
        padding-bottom: 8px;
      }

      .stat-row {
        padding: 4px 10px;
        display: flex;
        justify-content: space-between;
        font-size: 13px;
      }

      .stat-label { color: #888; }
      .stat-value { color: #fff; }

      /* Chat */
      .chat-panel {
        flex: 1;
        max-width: 400px;
        display: flex;
        flex-direction: column;
      }

      .chat-messages {
        height: 120px;
        overflow-y: auto;
        padding: 8px;
        font-size: 12px;
      }

      .chat-message {
        margin-bottom: 2px;
      }

      .chat-message.system {
        color: #888;
        font-style: italic;
      }

      .chat-sender {
        color: #4a9f4a;
      }

      .chat-text {
        color: #ddd;
      }

      .chat-input-row {
        display: flex;
        border-top: 1px solid #333;
      }

      .chat-input-row input {
        flex: 1;
        padding: 8px;
        background: transparent;
        border: none;
        color: #fff;
        font-family: inherit;
        font-size: 12px;
      }

      .chat-input-row button {
        padding: 8px 12px;
        background: #333;
        border: none;
        color: #fff;
        cursor: pointer;
        font-family: inherit;
      }

      /* Action Bar */
      .action-bar {
        display: flex;
        gap: 8px;
        padding: 10px;
        background: rgba(0, 0, 0, 0.8);
        border: 1px solid #4a9f4a;
        border-radius: 4px;
      }

      .action-btn {
        padding: 8px 16px;
        background: #1a4a1a;
        border: 1px solid #4a9f4a;
        border-radius: 4px;
        color: #4a9f4a;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        transition: all 0.2s;
      }

      .action-btn:hover:not(:disabled) {
        background: #4a9f4a;
        color: #000;
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .action-btn.end-turn {
        background: #4a3a1a;
        border-color: #9f7a4a;
        color: #9f7a4a;
      }

      .action-btn.end-turn:hover {
        background: #9f7a4a;
        color: #000;
      }
    `;
    document.head.appendChild(style);
  }
}
