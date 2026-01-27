/**
 * Asset Manager - Loading and caching game assets
 * Handles loading from converted assets (JSON, PNG) or original formats
 */

import { Sprite } from '@/data/FRMLoader';
import { lzssDecode } from '@/data/LZSS';

export type AssetType = 'sprite' | 'palette' | 'map' | 'script' | 'audio' | 'font' | 'text';

export interface AssetEntry {
  type: AssetType;
  path: string;
  data: unknown;
  size: number;
  lastAccess: number;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  currentFile: string;
}

export type ProgressCallback = (progress: LoadProgress) => void;

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Maximum cache size in bytes */
  maxSize: number;
  /** Enable LRU eviction */
  lruEnabled: boolean;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxSize: 64 * 1024 * 1024, // 64 MB
  lruEnabled: true
};

/**
 * Asset manager with caching
 */
export class AssetManager {
  private cache: Map<string, AssetEntry> = new Map();
  private cacheSize = 0;
  private config: CacheConfig;
  private basePath: string;

  /** Pending loads to avoid duplicate requests */
  private pending: Map<string, Promise<unknown>> = new Map();

  constructor(basePath = '/assets', config: Partial<CacheConfig> = {}) {
    this.basePath = basePath;
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * Load a sprite (FRM format)
   */
  async loadSprite(path: string): Promise<Sprite> {
    const cached = this.getFromCache<Sprite>(path, 'sprite');
    if (cached) return cached;

    const data = await this.loadFile(path);
    const sprite = Sprite.fromBuffer(data);

    this.addToCache(path, 'sprite', sprite, data.byteLength);
    return sprite;
  }

  /**
   * Load a palette file
   */
  async loadPalette(path: string): Promise<Uint8Array> {
    const cached = this.getFromCache<Uint8Array>(path, 'palette');
    if (cached) return cached;

    const data = await this.loadFile(path);
    const palette = new Uint8Array(data);

    this.addToCache(path, 'palette', palette, palette.byteLength);
    return palette;
  }

  /**
   * Load raw binary file
   */
  async loadFile(path: string): Promise<ArrayBuffer> {
    const fullPath = this.resolvePath(path);

    // Check for pending load
    const pendingKey = `file:${fullPath}`;
    const pending = this.pending.get(pendingKey);
    if (pending) {
      return pending as Promise<ArrayBuffer>;
    }

    const loadPromise = this.fetchFile(fullPath);
    this.pending.set(pendingKey, loadPromise);

    try {
      const result = await loadPromise;
      return result;
    } finally {
      this.pending.delete(pendingKey);
    }
  }

  /**
   * Load a text file
   */
  async loadText(path: string): Promise<string> {
    const cached = this.getFromCache<string>(path, 'text');
    if (cached) return cached;

    const fullPath = this.resolvePath(path);
    const response = await fetch(fullPath);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }

    const text = await response.text();
    this.addToCache(path, 'text', text, text.length * 2); // Approximate size
    return text;
  }

  /**
   * Load a JSON file
   */
  async loadJSON<T>(path: string): Promise<T> {
    const text = await this.loadText(path);
    return JSON.parse(text) as T;
  }

  /**
   * Load multiple assets with progress reporting
   */
  async loadBatch(
    paths: string[],
    onProgress?: ProgressCallback
  ): Promise<Map<string, ArrayBuffer>> {
    const results = new Map<string, ArrayBuffer>();
    const total = paths.length;

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]!;

      if (onProgress) {
        onProgress({
          loaded: i,
          total,
          currentFile: path
        });
      }

      try {
        const data = await this.loadFile(path);
        results.set(path, data);
      } catch (error) {
        console.warn(`Failed to load ${path}:`, error);
      }
    }

    if (onProgress) {
      onProgress({
        loaded: total,
        total,
        currentFile: ''
      });
    }

    return results;
  }

  /**
   * Load LZSS compressed data
   */
  async loadCompressed(path: string, uncompressedSize: number): Promise<Uint8Array> {
    const data = await this.loadFile(path);
    return lzssDecode(new Uint8Array(data), uncompressedSize);
  }

  /**
   * Check if an asset exists
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);
    try {
      const response = await fetch(fullPath, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Preload assets for faster access
   */
  async preload(paths: string[]): Promise<void> {
    await Promise.all(paths.map(path => this.loadFile(path).catch(() => null)));
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.cacheSize = 0;
  }

  /**
   * Remove a specific item from cache
   */
  uncache(path: string): boolean {
    const entry = this.cache.get(path);
    if (entry) {
      this.cacheSize -= entry.size;
      this.cache.delete(path);
      return true;
    }
    return false;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; entries: number } {
    return {
      size: this.cacheSize,
      maxSize: this.config.maxSize,
      entries: this.cache.size
    };
  }

  /**
   * Set the base path for assets
   */
  setBasePath(path: string): void {
    this.basePath = path;
  }

  // Private methods

  private resolvePath(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return path;
    }
    return `${this.basePath}/${path}`;
  }

  private async fetchFile(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  private getFromCache<T>(path: string, type: AssetType): T | null {
    const entry = this.cache.get(path);
    if (entry && entry.type === type) {
      entry.lastAccess = Date.now();
      return entry.data as T;
    }
    return null;
  }

  private addToCache(path: string, type: AssetType, data: unknown, size: number): void {
    // Evict if needed
    if (this.config.lruEnabled) {
      while (this.cacheSize + size > this.config.maxSize && this.cache.size > 0) {
        this.evictLRU();
      }
    }

    // Don't cache if single item exceeds max size
    if (size > this.config.maxSize) {
      return;
    }

    const entry: AssetEntry = {
      type,
      path,
      data,
      size,
      lastAccess: Date.now()
    };

    this.cache.set(path, entry);
    this.cacheSize += size;
  }

  private evictLRU(): void {
    let oldestPath: string | null = null;
    let oldestTime = Infinity;

    for (const [path, entry] of this.cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestPath = path;
      }
    }

    if (oldestPath) {
      const entry = this.cache.get(oldestPath);
      if (entry) {
        this.cacheSize -= entry.size;
        this.cache.delete(oldestPath);
      }
    }
  }
}

/**
 * Global asset manager instance
 */
let globalAssetManager: AssetManager | null = null;

export function getAssetManager(): AssetManager {
  if (!globalAssetManager) {
    globalAssetManager = new AssetManager();
  }
  return globalAssetManager;
}

export function setAssetManager(manager: AssetManager): void {
  globalAssetManager = manager;
}
