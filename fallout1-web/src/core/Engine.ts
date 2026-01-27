/**
 * Game Engine - Main game loop and initialization
 * Coordinates all game systems
 */

import { Renderer, SCREEN_WIDTH, SCREEN_HEIGHT } from '@/platform/graphics/Renderer';
import { InputManager } from '@/platform/input/InputManager';
import { AssetManager, getAssetManager } from './AssetManager';

export interface EngineConfig {
  canvas: HTMLCanvasElement;
  scale?: number;
  targetFPS?: number;
  assetPath?: string;
}

export interface GameState {
  /** Is the game paused */
  paused: boolean;
  /** Current game time in ticks */
  ticks: number;
  /** Delta time since last frame (seconds) */
  deltaTime: number;
}

export type UpdateCallback = (state: GameState) => void;
export type RenderCallback = (renderer: Renderer) => void;

/**
 * Main game engine
 */
export class Engine {
  readonly renderer: Renderer;
  readonly input: InputManager;
  readonly assets: AssetManager;

  private running = false;
  private paused = false;
  private ticks = 0;
  private lastTime = 0;
  private accumulator = 0;
  private targetFPS: number;
  private frameTime: number;

  private updateCallbacks: UpdateCallback[] = [];
  private renderCallbacks: RenderCallback[] = [];
  private rafId: number | null = null;

  // Performance tracking
  private frameCount = 0;
  private fpsTime = 0;
  private currentFPS = 0;

  constructor(config: EngineConfig) {
    this.targetFPS = config.targetFPS ?? 60;
    this.frameTime = 1000 / this.targetFPS;

    // Initialize renderer
    this.renderer = new Renderer({
      canvas: config.canvas,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      scale: config.scale ?? 1
    });

    // Initialize input
    this.input = new InputManager(
      config.canvas,
      SCREEN_WIDTH,
      SCREEN_HEIGHT
    );
    this.input.setScale(config.scale ?? 1);

    // Initialize assets
    this.assets = getAssetManager();
    if (config.assetPath) {
      this.assets.setBasePath(config.assetPath);
    }

    // Handle window focus
    this.setupFocusHandling();
  }

  private setupFocusHandling(): void {
    window.addEventListener('blur', () => {
      this.renderer.setActive(false);
      // Optionally pause on blur
      // this.paused = true;
    });

    window.addEventListener('focus', () => {
      this.renderer.setActive(true);
      this.lastTime = performance.now();
    });

    // Handle visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.renderer.setActive(false);
      } else {
        this.renderer.setActive(true);
        this.lastTime = performance.now();
      }
    });
  }

  /**
   * Initialize the engine and load required assets
   */
  async initialize(): Promise<void> {
    // Load color palette
    try {
      const paletteData = await this.assets.loadFile('color.pal');
      await this.renderer.palette.loadColorTable(paletteData);
    } catch (error) {
      console.warn('Could not load color.pal, using default palette');
    }

    console.log('Engine initialized');
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;

    this.gameLoop(this.lastTime);
  }

  /**
   * Stop the game loop
   */
  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Pause/unpause the game
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.lastTime = performance.now();
    }
  }

  /**
   * Check if game is paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Register an update callback
   */
  onUpdate(callback: UpdateCallback): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      const idx = this.updateCallbacks.indexOf(callback);
      if (idx >= 0) this.updateCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register a render callback
   */
  onRender(callback: RenderCallback): () => void {
    this.renderCallbacks.push(callback);
    return () => {
      const idx = this.renderCallbacks.indexOf(callback);
      if (idx >= 0) this.renderCallbacks.splice(idx, 1);
    };
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.currentFPS;
  }

  /**
   * Get game ticks (frame count)
   */
  getTicks(): number {
    return this.ticks;
  }

  /**
   * Set display scale
   */
  setScale(scale: number): void {
    this.renderer.setScale(scale);
    this.input.setScale(scale);
  }

  private gameLoop(currentTime: number): void {
    if (!this.running) return;

    this.rafId = requestAnimationFrame((t) => this.gameLoop(t));

    // Calculate delta time
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // FPS tracking
    this.frameCount++;
    this.fpsTime += deltaTime;
    if (this.fpsTime >= 1000) {
      this.currentFPS = this.frameCount;
      this.frameCount = 0;
      this.fpsTime -= 1000;
    }

    // Skip if paused
    if (this.paused) {
      return;
    }

    // Fixed timestep with accumulator
    this.accumulator += deltaTime;

    // Prevent spiral of death
    if (this.accumulator > 200) {
      this.accumulator = 200;
    }

    // Update at fixed timestep
    while (this.accumulator >= this.frameTime) {
      this.update(this.frameTime / 1000);
      this.accumulator -= this.frameTime;
      this.ticks++;
    }

    // Render
    this.render();
  }

  private update(deltaTime: number): void {
    const state: GameState = {
      paused: this.paused,
      ticks: this.ticks,
      deltaTime
    };

    for (const callback of this.updateCallbacks) {
      callback(state);
    }
  }

  private render(): void {
    for (const callback of this.renderCallbacks) {
      callback(this.renderer);
    }

    // Present the frame
    this.renderer.present();
  }
}

/**
 * Create and initialize the game engine
 */
export async function createEngine(config: EngineConfig): Promise<Engine> {
  const engine = new Engine(config);
  await engine.initialize();
  return engine;
}
