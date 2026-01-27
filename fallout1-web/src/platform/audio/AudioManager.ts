/**
 * Audio Manager - Web Audio API wrapper
 * Handles music, sound effects, and speech
 */

export interface SoundHandle {
  id: number;
  source: AudioBufferSourceNode;
  gainNode: GainNode;
  loop: boolean;
  playing: boolean;
}

export interface AudioConfig {
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
  speechVolume?: number;
}

const DEFAULT_CONFIG: AudioConfig = {
  masterVolume: 1.0,
  musicVolume: 0.7,
  sfxVolume: 1.0,
  speechVolume: 1.0
};

/**
 * Audio manager for game sounds
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private speechGain: GainNode | null = null;

  private bufferCache: Map<string, AudioBuffer> = new Map();
  private activeSounds: Map<number, SoundHandle> = new Map();
  private nextSoundId = 1;

  private currentMusic: SoundHandle | null = null;

  private config: AudioConfig;
  private initialized = false;
  private suspended = true;

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the audio context
   * Must be called from a user interaction (click/touch)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.ctx = new AudioContext();

      // Create gain nodes
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.masterGain.gain.value = this.config.masterVolume!;

      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);
      this.musicGain.gain.value = this.config.musicVolume!;

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.sfxGain.gain.value = this.config.sfxVolume!;

      this.speechGain = this.ctx.createGain();
      this.speechGain.connect(this.masterGain);
      this.speechGain.gain.value = this.config.speechVolume!;

      this.initialized = true;

      // Resume context if suspended
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.suspended = this.ctx.state === 'suspended';

      console.log('Audio initialized:', this.ctx.state);
    } catch (error) {
      console.error('Failed to initialize audio:', error);
    }
  }

  /**
   * Resume audio context (call on user interaction)
   */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
      this.suspended = false;
    }
  }

  /**
   * Suspend audio context
   */
  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
      this.suspended = true;
    }
  }

  /**
   * Load an audio file
   */
  async loadSound(path: string): Promise<AudioBuffer | null> {
    if (!this.ctx) {
      console.warn('Audio not initialized');
      return null;
    }

    // Check cache
    const cached = this.bufferCache.get(path);
    if (cached) return cached;

    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to load ${path}: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      this.bufferCache.set(path, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.error(`Failed to load audio ${path}:`, error);
      return null;
    }
  }

  /**
   * Play a sound effect
   */
  playSound(
    buffer: AudioBuffer,
    options: {
      loop?: boolean;
      volume?: number;
      pan?: number;  // -1 to 1
      playbackRate?: number;
    } = {}
  ): number {
    if (!this.ctx || !this.sfxGain) return -1;

    const {
      loop = false,
      volume = 1.0,
      pan = 0,
      playbackRate = 1.0
    } = options;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = playbackRate;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = volume;

    // Optional panning
    if (pan !== 0) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(panner);
      panner.connect(gainNode);
    } else {
      source.connect(gainNode);
    }

    gainNode.connect(this.sfxGain);

    const id = this.nextSoundId++;
    const handle: SoundHandle = {
      id,
      source,
      gainNode,
      loop,
      playing: true
    };

    this.activeSounds.set(id, handle);

    source.onended = () => {
      handle.playing = false;
      this.activeSounds.delete(id);
    };

    source.start();

    return id;
  }

  /**
   * Play a sound effect by path
   */
  async playSoundByPath(
    path: string,
    options?: { loop?: boolean; volume?: number; pan?: number }
  ): Promise<number> {
    const buffer = await this.loadSound(path);
    if (!buffer) return -1;
    return this.playSound(buffer, options);
  }

  /**
   * Stop a sound
   */
  stopSound(id: number): void {
    const handle = this.activeSounds.get(id);
    if (handle) {
      try {
        handle.source.stop();
      } catch {
        // Already stopped
      }
      handle.playing = false;
      this.activeSounds.delete(id);
    }
  }

  /**
   * Set sound volume
   */
  setSoundVolume(id: number, volume: number): void {
    const handle = this.activeSounds.get(id);
    if (handle) {
      handle.gainNode.gain.value = volume;
    }
  }

  /**
   * Play music (stops any currently playing music)
   */
  async playMusic(path: string, fadeIn = 0): Promise<void> {
    if (!this.ctx || !this.musicGain) return;

    // Fade out current music
    if (this.currentMusic) {
      await this.fadeOutMusic(0.5);
    }

    const buffer = await this.loadSound(path);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = fadeIn > 0 ? 0 : 1;
    gainNode.connect(this.musicGain);

    source.connect(gainNode);

    const handle: SoundHandle = {
      id: this.nextSoundId++,
      source,
      gainNode,
      loop: true,
      playing: true
    };

    source.onended = () => {
      if (this.currentMusic === handle) {
        this.currentMusic = null;
      }
      handle.playing = false;
    };

    source.start();
    this.currentMusic = handle;

    // Fade in
    if (fadeIn > 0) {
      gainNode.gain.linearRampToValueAtTime(1, this.ctx.currentTime + fadeIn);
    }
  }

  /**
   * Stop music
   */
  async stopMusic(fadeOut = 0): Promise<void> {
    if (!this.currentMusic) return;

    if (fadeOut > 0) {
      await this.fadeOutMusic(fadeOut);
    } else {
      try {
        this.currentMusic.source.stop();
      } catch {
        // Already stopped
      }
      this.currentMusic = null;
    }
  }

  /**
   * Fade out music
   */
  private async fadeOutMusic(duration: number): Promise<void> {
    if (!this.currentMusic || !this.ctx) return;

    const handle = this.currentMusic;
    handle.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);

    await new Promise(resolve => setTimeout(resolve, duration * 1000));

    try {
      handle.source.stop();
    } catch {
      // Already stopped
    }

    if (this.currentMusic === handle) {
      this.currentMusic = null;
    }
  }

  /**
   * Play speech
   */
  async playSpeech(path: string): Promise<number> {
    if (!this.ctx || !this.speechGain) return -1;

    const buffer = await this.loadSound(path);
    if (!buffer) return -1;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 1;
    gainNode.connect(this.speechGain);

    source.connect(gainNode);

    const id = this.nextSoundId++;
    const handle: SoundHandle = {
      id,
      source,
      gainNode,
      loop: false,
      playing: true
    };

    this.activeSounds.set(id, handle);

    source.onended = () => {
      handle.playing = false;
      this.activeSounds.delete(id);
    };

    source.start();
    return id;
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume: number): void {
    this.config.masterVolume = volume;
    if (this.masterGain) {
      this.masterGain.gain.value = volume;
    }
  }

  /**
   * Set music volume
   */
  setMusicVolume(volume: number): void {
    this.config.musicVolume = volume;
    if (this.musicGain) {
      this.musicGain.gain.value = volume;
    }
  }

  /**
   * Set SFX volume
   */
  setSfxVolume(volume: number): void {
    this.config.sfxVolume = volume;
    if (this.sfxGain) {
      this.sfxGain.gain.value = volume;
    }
  }

  /**
   * Set speech volume
   */
  setSpeechVolume(volume: number): void {
    this.config.speechVolume = volume;
    if (this.speechGain) {
      this.speechGain.gain.value = volume;
    }
  }

  /**
   * Get current config
   */
  getConfig(): AudioConfig {
    return { ...this.config };
  }

  /**
   * Check if audio is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if audio is suspended
   */
  isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    for (const [id] of this.activeSounds) {
      this.stopSound(id);
    }
    if (this.currentMusic) {
      try {
        this.currentMusic.source.stop();
      } catch {
        // Already stopped
      }
      this.currentMusic = null;
    }
  }

  /**
   * Clear the buffer cache
   */
  clearCache(): void {
    this.bufferCache.clear();
  }

  /**
   * Dispose the audio manager
   */
  dispose(): void {
    this.stopAll();
    this.clearCache();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}

/**
 * Global audio manager instance
 */
let globalAudioManager: AudioManager | null = null;

export function getAudioManager(): AudioManager {
  if (!globalAudioManager) {
    globalAudioManager = new AudioManager();
  }
  return globalAudioManager;
}
