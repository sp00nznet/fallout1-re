/**
 * Save Manager - IndexedDB persistence for save games
 * Port of game/loadsave.c storage layer
 */

const DB_NAME = 'fallout1-saves';
const DB_VERSION = 1;
const STORE_SAVES = 'saves';
const STORE_CONFIG = 'config';
const STORE_CACHE = 'cache';

export interface SaveGame {
  slot: number;
  name: string;
  timestamp: number;
  playTime: number;  // seconds
  location: string;
  level: number;
  data: Uint8Array;  // Compressed save data
  screenshot?: Uint8Array;  // Optional thumbnail
}

export interface SaveMetadata {
  slot: number;
  name: string;
  timestamp: number;
  playTime: number;
  location: string;
  level: number;
  hasScreenshot: boolean;
}

export interface GameConfig {
  key: string;
  value: unknown;
}

/**
 * Save manager using IndexedDB
 */
export class SaveManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create saves store
        if (!db.objectStoreNames.contains(STORE_SAVES)) {
          const savesStore = db.createObjectStore(STORE_SAVES, { keyPath: 'slot' });
          savesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Create config store
        if (!db.objectStoreNames.contains(STORE_CONFIG)) {
          db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
        }

        // Create cache store
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          const cacheStore = db.createObjectStore(STORE_CACHE, { keyPath: 'path' });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Save a game to a slot
   */
  async saveGame(save: SaveGame): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readwrite');
      const store = transaction.objectStore(STORE_SAVES);

      const request = store.put(save);

      request.onerror = () => reject(new Error(`Failed to save: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Load a game from a slot
   */
  async loadGame(slot: number): Promise<SaveGame | null> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readonly');
      const store = transaction.objectStore(STORE_SAVES);

      const request = store.get(slot);

      request.onerror = () => reject(new Error(`Failed to load: ${request.error?.message}`));
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  /**
   * Delete a save game
   */
  async deleteGame(slot: number): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readwrite');
      const store = transaction.objectStore(STORE_SAVES);

      const request = store.delete(slot);

      request.onerror = () => reject(new Error(`Failed to delete: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get all save game metadata (without full data)
   */
  async listSaves(): Promise<SaveMetadata[]> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readonly');
      const store = transaction.objectStore(STORE_SAVES);

      const request = store.getAll();

      request.onerror = () => reject(new Error(`Failed to list saves: ${request.error?.message}`));
      request.onsuccess = () => {
        const saves = request.result as SaveGame[];
        const metadata: SaveMetadata[] = saves.map(save => ({
          slot: save.slot,
          name: save.name,
          timestamp: save.timestamp,
          playTime: save.playTime,
          location: save.location,
          level: save.level,
          hasScreenshot: !!save.screenshot
        }));
        metadata.sort((a, b) => b.timestamp - a.timestamp);
        resolve(metadata);
      };
    });
  }

  /**
   * Check if a slot is occupied
   */
  async hasSlot(slot: number): Promise<boolean> {
    const save = await this.loadGame(slot);
    return save !== null;
  }

  /**
   * Get the next available slot
   */
  async getNextSlot(): Promise<number> {
    const saves = await this.listSaves();
    const usedSlots = new Set(saves.map(s => s.slot));

    for (let slot = 1; slot <= 10; slot++) {
      if (!usedSlots.has(slot)) {
        return slot;
      }
    }

    // All slots full, return slot with oldest save
    if (saves.length > 0) {
      return saves[saves.length - 1]!.slot;
    }

    return 1;
  }

  /**
   * Save a configuration value
   */
  async setConfig(key: string, value: unknown): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CONFIG], 'readwrite');
      const store = transaction.objectStore(STORE_CONFIG);

      const request = store.put({ key, value });

      request.onerror = () => reject(new Error(`Failed to set config: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get a configuration value
   */
  async getConfig<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CONFIG], 'readonly');
      const store = transaction.objectStore(STORE_CONFIG);

      const request = store.get(key);

      request.onerror = () => reject(new Error(`Failed to get config: ${request.error?.message}`));
      request.onsuccess = () => {
        const result = request.result as GameConfig | undefined;
        resolve((result?.value as T) ?? defaultValue);
      };
    });
  }

  /**
   * Delete a configuration value
   */
  async deleteConfig(key: string): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CONFIG], 'readwrite');
      const store = transaction.objectStore(STORE_CONFIG);

      const request = store.delete(key);

      request.onerror = () => reject(new Error(`Failed to delete config: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Cache an asset
   */
  async cacheAsset(path: string, data: ArrayBuffer): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CACHE], 'readwrite');
      const store = transaction.objectStore(STORE_CACHE);

      const request = store.put({
        path,
        data: new Uint8Array(data),
        timestamp: Date.now()
      });

      request.onerror = () => reject(new Error(`Failed to cache: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get a cached asset
   */
  async getCachedAsset(path: string): Promise<ArrayBuffer | null> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CACHE], 'readonly');
      const store = transaction.objectStore(STORE_CACHE);

      const request = store.get(path);

      request.onerror = () => reject(new Error(`Failed to get cache: ${request.error?.message}`));
      request.onsuccess = () => {
        const result = request.result;
        if (result?.data) {
          resolve(result.data.buffer);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Clear the asset cache
   */
  async clearCache(): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_CACHE], 'readwrite');
      const store = transaction.objectStore(STORE_CACHE);

      const request = store.clear();

      request.onerror = () => reject(new Error(`Failed to clear cache: ${request.error?.message}`));
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Export all saves as a downloadable file
   */
  async exportSaves(): Promise<Blob> {
    const saves = await this.listSaves();
    const fullSaves: SaveGame[] = [];

    for (const meta of saves) {
      const save = await this.loadGame(meta.slot);
      if (save) {
        fullSaves.push(save);
      }
    }

    const json = JSON.stringify(fullSaves, (_key, value) => {
      if (value instanceof Uint8Array) {
        return { __type: 'Uint8Array', data: Array.from(value) };
      }
      return value;
    });

    return new Blob([json], { type: 'application/json' });
  }

  /**
   * Import saves from a file
   */
  async importSaves(blob: Blob): Promise<number> {
    const text = await blob.text();
    const saves = JSON.parse(text, (_key, value) => {
      if (value && value.__type === 'Uint8Array') {
        return new Uint8Array(value.data);
      }
      return value;
    }) as SaveGame[];

    let imported = 0;
    for (const save of saves) {
      await this.saveGame(save);
      imported++;
    }

    return imported;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

/**
 * Global save manager instance
 */
let globalSaveManager: SaveManager | null = null;

export function getSaveManager(): SaveManager {
  if (!globalSaveManager) {
    globalSaveManager = new SaveManager();
  }
  return globalSaveManager;
}
