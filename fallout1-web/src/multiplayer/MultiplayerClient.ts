/**
 * WebSocket client for real-time multiplayer communication
 */

import { authService } from '../services/AuthService.js';

type MessageHandler = (data: any) => void;
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated';

interface QueuedMessage {
  type: string;
  payload: any;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private messageQueue: QueuedMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimeout: number | null = null;
  private pingInterval: number | null = null;
  private currentGameId: string | null = null;

  constructor(wsUrl?: string) {
    this.wsUrl = wsUrl || this.getDefaultWsUrl();
  }

  private getDefaultWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}/ws`;
    return host;
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'authenticated';
  }

  async connect(): Promise<void> {
    if (this.state !== 'disconnected') {
      return;
    }

    return new Promise((resolve, reject) => {
      this.state = 'connecting';

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.state = 'connected';
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.authenticate().then(resolve).catch(reject);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.handleDisconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };
      } catch (error) {
        this.state = 'disconnected';
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.stopPingInterval();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state = 'disconnected';
    this.currentGameId = null;
  }

  private async authenticate(): Promise<void> {
    const token = authService.getAccessToken();
    if (!token) {
      throw new Error('No access token available');
    }

    return new Promise((resolve, reject) => {
      const handleAuth = (data: any) => {
        this.off('auth:success', handleAuth);
        this.off('auth:error', handleAuthError);

        this.state = 'authenticated';
        this.flushMessageQueue();
        resolve();
      };

      const handleAuthError = (data: any) => {
        this.off('auth:success', handleAuth);
        this.off('auth:error', handleAuthError);
        reject(new Error(data.message || 'Authentication failed'));
      };

      this.on('auth:success', handleAuth);
      this.on('auth:error', handleAuthError);

      this.sendRaw({ type: 'auth:login', token });
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      const { type, ...payload } = message;

      // Dispatch to handlers
      const handlers = this.handlers.get(type);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(payload);
          } catch (error) {
            console.error(`Error in handler for ${type}:`, error);
          }
        });
      }

      // Also dispatch to wildcard handlers
      const wildcardHandlers = this.handlers.get('*');
      if (wildcardHandlers) {
        wildcardHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            console.error('Error in wildcard handler:', error);
          }
        });
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  private handleDisconnect(): void {
    this.stopPingInterval();
    this.state = 'disconnected';

    // Attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      this.reconnectTimeout = window.setTimeout(() => {
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
        });
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.emit('connection:failed', {});
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // WebSocket ping is handled by the protocol, but we can send app-level ping
        // for tracking latency if needed
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Event handling
  on(event: string, handler: MessageHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: MessageHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  once(event: string, handler: MessageHandler): void {
    const wrapper = (data: any) => {
      this.off(event, wrapper);
      handler(data);
    };
    this.on(event, wrapper);
  }

  private emit(event: string, data: any): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  // Message sending
  private sendRaw(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  send(type: string, payload: object = {}): void {
    const message = { type, ...payload };

    if (this.state === 'authenticated') {
      this.sendRaw(message);
    } else {
      this.messageQueue.push({ type, payload });
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const { type, payload } = this.messageQueue.shift()!;
      this.send(type, payload);
    }
  }

  // Game session methods
  joinSession(gameId: string): void {
    this.currentGameId = gameId;
    this.send('session:join', { gameId });
  }

  leaveSession(): void {
    if (this.currentGameId) {
      this.send('session:leave', {});
      this.currentGameId = null;
    }
  }

  toggleReady(): void {
    this.send('session:ready', {});
  }

  // Sync requests
  requestFullState(): void {
    this.send('sync:request', { full: true });
  }

  requestDeltaState(since: number): void {
    this.send('sync:request', { full: false, since });
  }

  // Player actions
  move(targetTile: number, elevation?: number): void {
    this.send('action:move', { targetTile, elevation });
  }

  attack(targetId: string, weaponMode: string = 'single', aimedLocation?: string): void {
    this.send('action:attack', { targetId, weaponMode, aimedLocation });
  }

  useItem(itemId: string, targetId?: string): void {
    this.send('action:use-item', { itemId, targetId });
  }

  interact(objectId: string, action: string): void {
    this.send('action:interact', { objectId, action });
  }

  endTurn(): void {
    this.send('turn:end', {});
  }

  // Chat
  sendChat(message: string): void {
    this.send('chat:message', { message });
  }
}

// Singleton instance
export const multiplayerClient = new MultiplayerClient();
