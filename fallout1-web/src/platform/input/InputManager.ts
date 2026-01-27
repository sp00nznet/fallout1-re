/**
 * Input Manager - Keyboard and Mouse handling
 * Port of plib/gnw/input.c
 */

export const enum MouseButton {
  Left = 0,
  Middle = 1,
  Right = 2
}

export interface MouseState {
  x: number;
  y: number;
  buttons: number;  // Bitmask: 1=left, 2=right, 4=middle
  wheelDelta: number;
}

export interface KeyState {
  code: string;
  key: string;
  pressed: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type KeyCallback = (event: KeyState) => void;
export type MouseCallback = (event: MouseState) => void;
export type MouseMoveCallback = (x: number, y: number) => void;

/**
 * Input manager handles all keyboard and mouse input
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private scale: number = 1;

  // Mouse state
  private mouse: MouseState = { x: 0, y: 0, buttons: 0, wheelDelta: 0 };

  // Keyboard state
  private keysDown: Set<string> = new Set();
  private keyQueue: KeyState[] = [];
  private maxQueueSize = 64;

  // Callbacks
  private keyDownCallbacks: KeyCallback[] = [];
  private keyUpCallbacks: KeyCallback[] = [];
  private mouseDownCallbacks: MouseCallback[] = [];
  private mouseUpCallbacks: MouseCallback[] = [];
  private mouseMoveCallbacks: MouseMoveCallback[] = [];
  private mouseWheelCallbacks: MouseCallback[] = [];

  // Key repeat
  private repeatEnabled = true;
  private repeatDelay = 250;  // ms before repeat starts
  private repeatInterval = 30; // ms between repeats
  private repeatTimers: Map<string, number> = new Map();

  // Screen dimensions for coordinate conversion
  private screenWidth: number;
  private screenHeight: number;

  constructor(canvas: HTMLCanvasElement, screenWidth: number, screenHeight: number) {
    this.canvas = canvas;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard events
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    window.addEventListener('keyup', this.handleKeyUp.bind(this));

    // Mouse events
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('wheel', this.handleMouseWheel.bind(this));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Handle mouse leaving canvas
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave.bind(this));

    // Touch events for mobile support
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Prevent default for game keys
    if (this.shouldPreventDefault(e)) {
      e.preventDefault();
    }

    const wasDown = this.keysDown.has(e.code);
    this.keysDown.add(e.code);

    const state: KeyState = {
      code: e.code,
      key: e.key,
      pressed: true,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey
    };

    // Only queue if not a repeat, or if repeat is enabled
    if (!wasDown || this.repeatEnabled) {
      this.queueKey(state);

      // Call callbacks
      for (const callback of this.keyDownCallbacks) {
        callback(state);
      }
    }

    // Setup key repeat
    if (!wasDown && this.repeatEnabled) {
      this.startKeyRepeat(e.code, state);
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
    this.stopKeyRepeat(e.code);

    const state: KeyState = {
      code: e.code,
      key: e.key,
      pressed: false,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey
    };

    for (const callback of this.keyUpCallbacks) {
      callback(state);
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    e.preventDefault();
    const button = e.button;

    if (button === 0) this.mouse.buttons |= 1;      // Left
    else if (button === 2) this.mouse.buttons |= 2; // Right
    else if (button === 1) this.mouse.buttons |= 4; // Middle

    this.updateMousePosition(e);

    for (const callback of this.mouseDownCallbacks) {
      callback({ ...this.mouse });
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    e.preventDefault();
    const button = e.button;

    if (button === 0) this.mouse.buttons &= ~1;
    else if (button === 2) this.mouse.buttons &= ~2;
    else if (button === 1) this.mouse.buttons &= ~4;

    this.updateMousePosition(e);

    for (const callback of this.mouseUpCallbacks) {
      callback({ ...this.mouse });
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    this.updateMousePosition(e);

    for (const callback of this.mouseMoveCallbacks) {
      callback(this.mouse.x, this.mouse.y);
    }
  }

  private handleMouseWheel(e: WheelEvent): void {
    e.preventDefault();
    this.mouse.wheelDelta = Math.sign(e.deltaY);

    for (const callback of this.mouseWheelCallbacks) {
      callback({ ...this.mouse });
    }

    this.mouse.wheelDelta = 0;
  }

  private handleMouseLeave(_e: MouseEvent): void {
    // Clear button state when mouse leaves
    this.mouse.buttons = 0;
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0]!;
      this.updateTouchPosition(touch);
      this.mouse.buttons |= 1; // Treat as left click

      for (const callback of this.mouseDownCallbacks) {
        callback({ ...this.mouse });
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    this.mouse.buttons &= ~1;

    for (const callback of this.mouseUpCallbacks) {
      callback({ ...this.mouse });
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0]!;
      this.updateTouchPosition(touch);

      for (const callback of this.mouseMoveCallbacks) {
        callback(this.mouse.x, this.mouse.y);
      }
    }
  }

  private updateMousePosition(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.screenWidth / (rect.width / this.scale);
    const scaleY = this.screenHeight / (rect.height / this.scale);

    this.mouse.x = Math.floor((e.clientX - rect.left) * scaleX / this.scale);
    this.mouse.y = Math.floor((e.clientY - rect.top) * scaleY / this.scale);

    // Clamp to screen bounds
    this.mouse.x = Math.max(0, Math.min(this.screenWidth - 1, this.mouse.x));
    this.mouse.y = Math.max(0, Math.min(this.screenHeight - 1, this.mouse.y));
  }

  private updateTouchPosition(touch: Touch): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.screenWidth / (rect.width / this.scale);
    const scaleY = this.screenHeight / (rect.height / this.scale);

    this.mouse.x = Math.floor((touch.clientX - rect.left) * scaleX / this.scale);
    this.mouse.y = Math.floor((touch.clientY - rect.top) * scaleY / this.scale);

    this.mouse.x = Math.max(0, Math.min(this.screenWidth - 1, this.mouse.x));
    this.mouse.y = Math.max(0, Math.min(this.screenHeight - 1, this.mouse.y));
  }

  private shouldPreventDefault(e: KeyboardEvent): boolean {
    // Prevent default for arrow keys, space, tab, etc.
    const preventKeys = [
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Space', 'Tab', 'Backspace'
    ];
    return preventKeys.includes(e.code);
  }

  private queueKey(state: KeyState): void {
    if (this.keyQueue.length >= this.maxQueueSize) {
      this.keyQueue.shift(); // Remove oldest
    }
    this.keyQueue.push(state);
  }

  private startKeyRepeat(code: string, state: KeyState): void {
    // Initial delay
    const timerId = window.setTimeout(() => {
      // Start repeating
      const repeatId = window.setInterval(() => {
        if (this.keysDown.has(code)) {
          this.queueKey({ ...state });
          for (const callback of this.keyDownCallbacks) {
            callback(state);
          }
        } else {
          this.stopKeyRepeat(code);
        }
      }, this.repeatInterval);

      this.repeatTimers.set(code, repeatId);
    }, this.repeatDelay);

    this.repeatTimers.set(code, timerId);
  }

  private stopKeyRepeat(code: string): void {
    const timerId = this.repeatTimers.get(code);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      clearInterval(timerId);
      this.repeatTimers.delete(code);
    }
  }

  // Public API

  /**
   * Set display scale for coordinate conversion
   */
  setScale(scale: number): void {
    this.scale = scale;
  }

  /**
   * Get current mouse state
   */
  getMouse(): MouseState {
    return { ...this.mouse };
  }

  /**
   * Get mouse X coordinate
   */
  getMouseX(): number {
    return this.mouse.x;
  }

  /**
   * Get mouse Y coordinate
   */
  getMouseY(): number {
    return this.mouse.y;
  }

  /**
   * Check if a key is currently pressed
   */
  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /**
   * Check if left mouse button is pressed
   */
  isLeftButtonDown(): boolean {
    return (this.mouse.buttons & 1) !== 0;
  }

  /**
   * Check if right mouse button is pressed
   */
  isRightButtonDown(): boolean {
    return (this.mouse.buttons & 2) !== 0;
  }

  /**
   * Get next key from queue (returns null if empty)
   */
  getKey(): KeyState | null {
    return this.keyQueue.shift() ?? null;
  }

  /**
   * Peek at next key without removing
   */
  peekKey(): KeyState | null {
    return this.keyQueue[0] ?? null;
  }

  /**
   * Clear key queue
   */
  clearKeyQueue(): void {
    this.keyQueue = [];
  }

  /**
   * Set key repeat enabled
   */
  setKeyRepeat(enabled: boolean): void {
    this.repeatEnabled = enabled;
    if (!enabled) {
      // Stop all current repeats
      for (const code of this.repeatTimers.keys()) {
        this.stopKeyRepeat(code);
      }
    }
  }

  /**
   * Register key down callback
   */
  onKeyDown(callback: KeyCallback): () => void {
    this.keyDownCallbacks.push(callback);
    return () => {
      const idx = this.keyDownCallbacks.indexOf(callback);
      if (idx >= 0) this.keyDownCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register key up callback
   */
  onKeyUp(callback: KeyCallback): () => void {
    this.keyUpCallbacks.push(callback);
    return () => {
      const idx = this.keyUpCallbacks.indexOf(callback);
      if (idx >= 0) this.keyUpCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register mouse down callback
   */
  onMouseDown(callback: MouseCallback): () => void {
    this.mouseDownCallbacks.push(callback);
    return () => {
      const idx = this.mouseDownCallbacks.indexOf(callback);
      if (idx >= 0) this.mouseDownCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register mouse up callback
   */
  onMouseUp(callback: MouseCallback): () => void {
    this.mouseUpCallbacks.push(callback);
    return () => {
      const idx = this.mouseUpCallbacks.indexOf(callback);
      if (idx >= 0) this.mouseUpCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register mouse move callback
   */
  onMouseMove(callback: MouseMoveCallback): () => void {
    this.mouseMoveCallbacks.push(callback);
    return () => {
      const idx = this.mouseMoveCallbacks.indexOf(callback);
      if (idx >= 0) this.mouseMoveCallbacks.splice(idx, 1);
    };
  }

  /**
   * Register mouse wheel callback
   */
  onMouseWheel(callback: MouseCallback): () => void {
    this.mouseWheelCallbacks.push(callback);
    return () => {
      const idx = this.mouseWheelCallbacks.indexOf(callback);
      if (idx >= 0) this.mouseWheelCallbacks.splice(idx, 1);
    };
  }

  /**
   * Show/hide mouse cursor
   */
  setMouseVisible(visible: boolean): void {
    this.canvas.style.cursor = visible ? 'default' : 'none';
  }

  /**
   * Check if mouse is within a rectangle
   */
  mouseIn(ulx: number, uly: number, lrx: number, lry: number): boolean {
    return this.mouse.x >= ulx && this.mouse.x <= lrx &&
           this.mouse.y >= uly && this.mouse.y <= lry;
  }

  /**
   * Clean up event listeners
   */
  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
    window.removeEventListener('keyup', this.handleKeyUp.bind(this));

    // Clear all repeat timers
    for (const code of this.repeatTimers.keys()) {
      this.stopKeyRepeat(code);
    }
  }
}
