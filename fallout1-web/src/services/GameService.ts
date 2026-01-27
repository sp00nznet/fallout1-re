/**
 * Game service for multiplayer session management
 */

import { authService } from './AuthService.js';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface Character {
  id: string;
  name: string;
  level: number;
  strength: number;
  perception: number;
  endurance: number;
  charisma: number;
  intelligence: number;
  agility: number;
  luck: number;
  maxHp: number;
  maxAp: number;
  sequence: number;
}

interface Participant {
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
}

interface GameSession {
  id: string;
  hostId: string;
  name: string;
  status: 'LOBBY' | 'STARTING' | 'PLAYING' | 'PAUSED' | 'FINISHED';
  visibility: 'PUBLIC' | 'PRIVATE';
  maxPlayers: number;
  hostLevel: number;
  minLevel: number;
  maxLevel: number;
  currentMap: string;
  turnTimeBase: number;
  currentTurn: number;
  inCombat: boolean;
  combatRound: number;
  host: { id: string; username: string };
  participants: Participant[];
  _count?: { participants: number };
}

interface SaveGame {
  id: string;
  slot: number;
  name: string;
  location: string;
  level: number;
  playTime: number;
  isAutoSave: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateGameOptions {
  name: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
  maxPlayers?: number;
  password?: string;
  minLevel?: number;
  maxLevel?: number;
  currentMap?: string;
  turnTimeBase?: number;
  characterId?: string;
}

class GameService {
  // Game Sessions

  async listGames(status?: string, visibility?: string): Promise<GameSession[]> {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (visibility) params.set('visibility', visibility);

    const url = `${API_BASE}/games${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch games');
    }

    return response.json();
  }

  async getGame(gameId: string): Promise<GameSession> {
    const response = await fetch(`${API_BASE}/games/${gameId}`);

    if (!response.ok) {
      throw new Error('Game not found');
    }

    return response.json();
  }

  async createGame(options: CreateGameOptions): Promise<GameSession> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create game');
    }

    return response.json();
  }

  async joinGame(gameId: string, password?: string, characterId?: string): Promise<Participant> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games/${gameId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, characterId })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to join game');
    }

    return response.json();
  }

  async leaveGame(gameId: string): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games/${gameId}/leave`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to leave game');
    }
  }

  async toggleReady(gameId: string): Promise<{ isReady: boolean }> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games/${gameId}/ready`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to toggle ready');
    }

    return response.json();
  }

  async startGame(gameId: string): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games/${gameId}/start`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start game');
    }
  }

  async kickPlayer(gameId: string, participantId: string): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE}/games/${gameId}/kick/${participantId}`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to kick player');
    }
  }

  // Characters

  async getCharacters(): Promise<Character[]> {
    const response = await authService.fetchWithAuth(`${API_BASE}/users/me/characters`);

    if (!response.ok) {
      throw new Error('Failed to fetch characters');
    }

    return response.json();
  }

  async createCharacter(data: Partial<Character> & { name: string }): Promise<Character> {
    const response = await authService.fetchWithAuth(`${API_BASE}/users/me/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create character');
    }

    return response.json();
  }

  // Save Games

  async listSaves(): Promise<SaveGame[]> {
    const response = await authService.fetchWithAuth(`${API_BASE}/saves`);

    if (!response.ok) {
      throw new Error('Failed to fetch saves');
    }

    return response.json();
  }

  async uploadSave(
    slot: number,
    name: string,
    location: string,
    level: number,
    playTime: number,
    characterSnapshot: object,
    stateData: ArrayBuffer
  ): Promise<SaveGame> {
    // Convert ArrayBuffer to base64
    const base64 = btoa(
      new Uint8Array(stateData).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const response = await authService.fetchWithAuth(`${API_BASE}/saves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot,
        name,
        location,
        level,
        playTime,
        characterSnapshot,
        stateData: base64
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload save');
    }

    return response.json();
  }

  async downloadSave(slot: number): Promise<ArrayBuffer> {
    const response = await authService.fetchWithAuth(`${API_BASE}/saves/${slot}/download`);

    if (!response.ok) {
      throw new Error('Failed to download save');
    }

    return response.arrayBuffer();
  }

  async deleteSave(slot: number): Promise<void> {
    const response = await authService.fetchWithAuth(`${API_BASE}/saves/${slot}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete save');
    }
  }

  async extractCharacterFromSave(slot: number): Promise<Character> {
    const response = await authService.fetchWithAuth(`${API_BASE}/saves/${slot}/extract-character`, {
      method: 'POST'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to extract character');
    }

    return response.json();
  }
}

// Singleton instance
export const gameService = new GameService();
export type { GameSession, Participant, Character, SaveGame, CreateGameOptions };
