/**
 * State synchronization manager for multiplayer
 */

import { multiplayerClient } from './MultiplayerClient.js';

interface ParticipantState {
  id: string;
  userId: string;
  username: string;
  characterName: string;
  isHost: boolean;
  isBot: boolean;
  isReady: boolean;
  isConnected: boolean;
  tileIndex: number;
  elevation: number;
  rotation: number;
  currentHp: number;
  maxHp: number;
  currentAp: number;
  maxAp: number;
  isInCombat: boolean;
  isDead: boolean;
  turnOrder: number;
}

interface SessionState {
  id: string;
  name: string;
  status: string;
  currentMap: string;
  inCombat: boolean;
  combatRound: number;
  currentTurn: number;
  turnTimeBase: number;
}

interface TurnInfo {
  order: string[];
  currentIndex: number;
  currentPlayerId: string;
  round: number;
  timeRemaining?: number;
}

interface GameState {
  session: SessionState;
  participants: ParticipantState[];
  turnInfo?: TurnInfo;
}

type StateChangeHandler = (state: GameState) => void;
type ParticipantChangeHandler = (participant: ParticipantState, changeType: string) => void;
type TurnChangeHandler = (turnInfo: TurnInfo) => void;
type CombatHandler = (data: any) => void;

export class StateSync {
  private state: GameState | null = null;
  private stateHandlers: Set<StateChangeHandler> = new Set();
  private participantHandlers: Set<ParticipantChangeHandler> = new Set();
  private turnHandlers: Set<TurnChangeHandler> = new Set();
  private combatHandlers: Set<CombatHandler> = new Set();
  private lastSyncTimestamp = 0;
  private syncRequestInterval: number | null = null;

  constructor() {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Full state sync
    multiplayerClient.on('sync:full-state', (data) => {
      this.state = data.state;
      this.lastSyncTimestamp = data.timestamp;
      this.notifyStateChange();
    });

    // Delta sync
    multiplayerClient.on('sync:delta', (data) => {
      if (!this.state) return;

      for (const change of data.changes) {
        this.applyChange(change);
      }

      this.lastSyncTimestamp = data.timestamp;
      this.notifyStateChange();
    });

    // Player events
    multiplayerClient.on('player:connected', (data) => {
      if (!this.state) return;

      const participant = this.state.participants.find(p => p.userId === data.userId);
      if (participant) {
        participant.isConnected = true;
        this.notifyParticipantChange(participant, 'connected');
      }
    });

    multiplayerClient.on('player:disconnected', (data) => {
      if (!this.state) return;

      const participant = this.state.participants.find(p => p.userId === data.userId);
      if (participant) {
        participant.isConnected = false;
        this.notifyParticipantChange(participant, 'disconnected');
      }
    });

    multiplayerClient.on('player:joined', (data) => {
      if (!this.state) return;

      this.state.participants.push(data.participant);
      this.notifyParticipantChange(data.participant, 'joined');
      this.notifyStateChange();
    });

    multiplayerClient.on('player:left', (data) => {
      if (!this.state) return;

      const index = this.state.participants.findIndex(p => p.userId === data.userId);
      if (index >= 0) {
        const participant = this.state.participants[index];
        if (participant) {
          this.state.participants.splice(index, 1);
          this.notifyParticipantChange(participant, 'left');
          this.notifyStateChange();
        }
      }
    });

    multiplayerClient.on('player:ready-changed', (data) => {
      if (!this.state) return;

      const participant = this.state.participants.find(p => p.id === data.participantId);
      if (participant) {
        participant.isReady = data.isReady;
        this.notifyParticipantChange(participant, 'ready-changed');
      }
    });

    // Turn events
    multiplayerClient.on('turn:start', (data) => {
      if (!this.state) return;

      this.state.turnInfo = {
        order: this.state.turnInfo?.order || [],
        currentIndex: data.turnIndex,
        currentPlayerId: data.participantId,
        round: data.round,
        timeRemaining: data.timeLimit
      };

      // Reset AP for the current player
      const participant = this.state.participants.find(p => p.id === data.participantId);
      if (participant) {
        participant.currentAp = data.ap;
      }

      this.notifyTurnChange();
    });

    multiplayerClient.on('turn:end', (_data: unknown) => {
      if (!this.state?.turnInfo) return;

      // Turn info will be updated by next turn:start
      this.notifyTurnChange();
    });

    // Combat events
    multiplayerClient.on('combat:started', (data) => {
      if (!this.state) return;

      this.state.session.inCombat = true;
      this.state.session.combatRound = data.round;
      this.state.turnInfo = {
        order: data.turnOrder.map((t: any) => t.participantId),
        currentIndex: 0,
        currentPlayerId: data.firstPlayerId,
        round: data.round
      };

      this.notifyCombat({ type: 'started', ...data });
      this.notifyStateChange();
    });

    multiplayerClient.on('combat:ended', (data) => {
      if (!this.state) return;

      this.state.session.inCombat = false;
      this.state.turnInfo = undefined;

      this.notifyCombat({ type: 'ended', ...data });
      this.notifyStateChange();
    });

    multiplayerClient.on('combat:new-round', (data) => {
      if (!this.state) return;

      this.state.session.combatRound = data.round;
      this.notifyCombat({ type: 'new-round', ...data });
    });

    multiplayerClient.on('combat:result', (data) => {
      this.notifyCombat({ type: 'result', ...data });
    });
  }

  private applyChange(change: any): void {
    if (!this.state) return;

    switch (change.type) {
      case 'position': {
        const p = this.state.participants.find(p => p.id === change.participantId);
        if (p) {
          p.tileIndex = change.tileIndex;
          p.elevation = change.elevation;
          p.rotation = change.rotation;
          this.notifyParticipantChange(p, 'moved');
        }
        break;
      }

      case 'health': {
        const p = this.state.participants.find(p => p.id === change.participantId);
        if (p) {
          p.currentHp = change.currentHp;
          p.maxHp = change.maxHp;
          this.notifyParticipantChange(p, 'health-changed');
        }
        break;
      }

      case 'ap': {
        const p = this.state.participants.find(p => p.id === change.participantId);
        if (p) {
          p.currentAp = change.currentAp;
          p.maxAp = change.maxAp;
          this.notifyParticipantChange(p, 'ap-changed');
        }
        break;
      }

      case 'death': {
        const p = this.state.participants.find(p => p.id === change.participantId);
        if (p) {
          p.isDead = true;
          p.currentHp = 0;
          this.notifyParticipantChange(p, 'died');
        }
        break;
      }

      case 'combat-state': {
        this.state.session.inCombat = change.inCombat;
        this.state.session.combatRound = change.round;
        break;
      }
    }
  }

  // State access
  getState(): GameState | null {
    return this.state;
  }

  getParticipant(participantId: string): ParticipantState | undefined {
    return this.state?.participants.find(p => p.id === participantId);
  }

  getParticipantByUserId(userId: string): ParticipantState | undefined {
    return this.state?.participants.find(p => p.userId === userId);
  }

  getCurrentTurnParticipant(): ParticipantState | undefined {
    if (!this.state?.turnInfo) return undefined;
    return this.getParticipant(this.state.turnInfo.currentPlayerId);
  }

  isMyTurn(myParticipantId: string): boolean {
    return this.state?.turnInfo?.currentPlayerId === myParticipantId;
  }

  // Event subscriptions
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onParticipantChange(handler: ParticipantChangeHandler): () => void {
    this.participantHandlers.add(handler);
    return () => this.participantHandlers.delete(handler);
  }

  onTurnChange(handler: TurnChangeHandler): () => void {
    this.turnHandlers.add(handler);
    return () => this.turnHandlers.delete(handler);
  }

  onCombat(handler: CombatHandler): () => void {
    this.combatHandlers.add(handler);
    return () => this.combatHandlers.delete(handler);
  }

  private notifyStateChange(): void {
    if (this.state) {
      this.stateHandlers.forEach(h => h(this.state!));
    }
  }

  private notifyParticipantChange(participant: ParticipantState, changeType: string): void {
    this.participantHandlers.forEach(h => h(participant, changeType));
  }

  private notifyTurnChange(): void {
    if (this.state?.turnInfo) {
      this.turnHandlers.forEach(h => h(this.state!.turnInfo!));
    }
  }

  private notifyCombat(data: any): void {
    this.combatHandlers.forEach(h => h(data));
  }

  // Periodic sync request (backup for missed deltas)
  startPeriodicSync(intervalMs: number = 10000): void {
    this.stopPeriodicSync();
    this.syncRequestInterval = window.setInterval(() => {
      if (this.lastSyncTimestamp > 0) {
        multiplayerClient.requestDeltaState(this.lastSyncTimestamp);
      }
    }, intervalMs);
  }

  stopPeriodicSync(): void {
    if (this.syncRequestInterval) {
      clearInterval(this.syncRequestInterval);
      this.syncRequestInterval = null;
    }
  }

  // Reset state
  reset(): void {
    this.state = null;
    this.lastSyncTimestamp = 0;
    this.stopPeriodicSync();
  }
}

// Singleton instance
export const stateSync = new StateSync();
export type { GameState, ParticipantState, SessionState, TurnInfo };
