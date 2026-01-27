/**
 * Fallout 1 Multiplayer System - Main Entry Point
 *
 * This module provides the main integration point for adding multiplayer
 * functionality to the Fallout 1 HTML5 port.
 */

import { authService } from '../services/AuthService.js';
import { gameService } from '../services/GameService.js';
import { multiplayerClient } from './MultiplayerClient.js';
import { stateSync } from './StateSync.js';
import { PlayerRenderer } from './PlayerRenderer.js';
import { LoginScreen } from '../ui/LoginScreen.js';
import { GameBrowser } from '../ui/GameBrowser.js';
import { LobbyScreen } from '../ui/LobbyScreen.js';
import { MultiplayerHUD } from '../ui/MultiplayerHUD.js';

export interface MultiplayerConfig {
  canvas: HTMLCanvasElement;
  tileWidth: number;
  tileHeight: number;
  gridWidth: number;
}

export type MultiplayerState =
  | 'offline'
  | 'login'
  | 'browser'
  | 'lobby'
  | 'playing';

type StateChangeHandler = (state: MultiplayerState) => void;

export class MultiplayerManager {
  private config: MultiplayerConfig;
  private state: MultiplayerState = 'offline';
  private stateHandlers: Set<StateChangeHandler> = new Set();

  private currentGameId: string | null = null;
  private localParticipantId: string | null = null;

  private loginScreen: LoginScreen | null = null;
  private gameBrowser: GameBrowser | null = null;
  private lobbyScreen: LobbyScreen | null = null;
  private multiplayerHUD: MultiplayerHUD | null = null;
  private playerRenderer: PlayerRenderer | null = null;

  private cameraX = 0;
  private cameraY = 0;

  constructor(config: MultiplayerConfig) {
    this.config = config;
  }

  // Lifecycle
  async initialize(): Promise<void> {
    // Check if already authenticated
    if (authService.isAuthenticated()) {
      this.setState('browser');
    } else {
      this.setState('offline');
    }
  }

  destroy(): void {
    this.cleanupCurrentState();
    multiplayerClient.disconnect();
    stateSync.reset();
  }

  // State management
  getState(): MultiplayerState {
    return this.state;
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private setState(newState: MultiplayerState): void {
    if (this.state === newState) return;

    this.cleanupCurrentState();
    this.state = newState;
    this.setupNewState();

    this.stateHandlers.forEach(h => h(newState));
  }

  private cleanupCurrentState(): void {
    switch (this.state) {
      case 'login':
        this.loginScreen?.unmount();
        this.loginScreen = null;
        break;
      case 'browser':
        this.gameBrowser?.unmount();
        this.gameBrowser = null;
        break;
      case 'lobby':
        this.lobbyScreen?.unmount();
        this.lobbyScreen = null;
        break;
      case 'playing':
        this.multiplayerHUD?.unmount();
        this.multiplayerHUD = null;
        this.playerRenderer?.stop();
        this.playerRenderer = null;
        multiplayerClient.leaveSession();
        stateSync.stopPeriodicSync();
        break;
    }
  }

  private setupNewState(): void {
    const container = document.body;

    switch (this.state) {
      case 'login':
        this.loginScreen = new LoginScreen({
          onSuccess: () => this.setState('browser'),
          onCancel: () => this.setState('offline')
        });
        this.loginScreen.mount(container);
        break;

      case 'browser':
        this.gameBrowser = new GameBrowser({
          onJoinGame: (gameId) => this.handleJoinGame(gameId),
          onBack: () => this.setState('offline')
        });
        this.gameBrowser.mount(container);
        break;

      case 'lobby':
        if (!this.currentGameId) {
          this.setState('browser');
          return;
        }
        this.lobbyScreen = new LobbyScreen({
          gameId: this.currentGameId,
          onLeave: () => this.handleLeaveGame(),
          onGameStart: () => this.handleGameStart()
        });
        this.lobbyScreen.mount(container);
        break;

      case 'playing':
        this.setupPlayingState();
        break;
    }
  }

  // Actions
  showLogin(): void {
    this.setState('login');
  }

  showBrowser(): void {
    if (!authService.isAuthenticated()) {
      this.setState('login');
      return;
    }
    this.setState('browser');
  }

  async logout(): Promise<void> {
    await authService.logout();
    this.currentGameId = null;
    this.localParticipantId = null;
    this.setState('offline');
  }

  private async handleJoinGame(gameId: string): Promise<void> {
    this.currentGameId = gameId;
    this.setState('lobby');

    // Connect WebSocket and join session
    try {
      await multiplayerClient.connect();
      multiplayerClient.joinSession(gameId);
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  }

  private handleLeaveGame(): void {
    this.currentGameId = null;
    this.localParticipantId = null;
    multiplayerClient.leaveSession();
    this.setState('browser');
  }

  private async handleGameStart(): Promise<void> {
    this.setState('playing');
  }

  private async setupPlayingState(): Promise<void> {
    if (!this.currentGameId) return;

    // Find our participant ID
    const user = authService.getUser();
    if (!user) return;

    // Wait for full state sync
    const state = await new Promise<any>((resolve) => {
      const unsub = stateSync.onStateChange((state) => {
        unsub();
        resolve(state);
      });

      // Request full state
      multiplayerClient.requestFullState();
    });

    const myParticipant = state.participants.find((p: any) => p.userId === user.id);
    if (myParticipant) {
      this.localParticipantId = myParticipant.id;
    }

    // Set up player renderer
    this.playerRenderer = new PlayerRenderer({
      canvas: this.config.canvas,
      tileWidth: this.config.tileWidth,
      tileHeight: this.config.tileHeight,
      gridWidth: this.config.gridWidth,
      cameraX: this.cameraX,
      cameraY: this.cameraY
    });

    if (this.localParticipantId) {
      this.playerRenderer.setLocalParticipant(this.localParticipantId);
    }

    this.playerRenderer.start();

    // Set up HUD
    if (this.localParticipantId) {
      this.multiplayerHUD = new MultiplayerHUD({
        localParticipantId: this.localParticipantId,
        onTargetSelect: (targetId) => this.handleTargetSelect(targetId)
      });
      this.multiplayerHUD.mount(document.body);
    }

    // Start periodic sync
    stateSync.startPeriodicSync(10000);
  }

  // Game integration methods
  updateCamera(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.playerRenderer?.updateCamera(x, y);
  }

  renderPlayers(): void {
    this.playerRenderer?.render();
  }

  // Movement - called when local player moves
  sendMove(targetTile: number, elevation?: number): void {
    if (this.state !== 'playing') return;
    multiplayerClient.move(targetTile, elevation);
  }

  // Attack - called when local player attacks
  sendAttack(targetId: string, weaponMode: string = 'single', aimedLocation?: string): void {
    if (this.state !== 'playing') return;
    multiplayerClient.attack(targetId, weaponMode, aimedLocation);
  }

  // End turn
  endTurn(): void {
    if (this.state !== 'playing') return;
    multiplayerClient.endTurn();
  }

  // Check if it's our turn
  isMyTurn(): boolean {
    if (!this.localParticipantId) return false;
    return stateSync.isMyTurn(this.localParticipantId);
  }

  private handleTargetSelect(targetId: string): void {
    // Highlight target in renderer
    this.playerRenderer?.renderTargetIndicator(targetId);
    // Could trigger attack UI here
  }
}

// Re-export components for individual use
export {
  authService,
  gameService,
  multiplayerClient,
  stateSync,
  PlayerRenderer,
  LoginScreen,
  GameBrowser,
  LobbyScreen,
  MultiplayerHUD
};
