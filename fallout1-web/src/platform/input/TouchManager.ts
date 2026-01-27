/**
 * Touch Manager - Mobile touch input handling
 * Provides virtual controls and gesture support
 */

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

export interface GestureEvent {
  type: 'tap' | 'longpress' | 'swipe' | 'pinch' | 'pan';
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  scale?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
}

export type GestureCallback = (event: GestureEvent) => void;

export interface VirtualJoystick {
  active: boolean;
  baseX: number;
  baseY: number;
  stickX: number;
  stickY: number;
  dx: number;  // -1 to 1
  dy: number;  // -1 to 1
}

export interface TouchManagerConfig {
  canvas: HTMLCanvasElement;
  screenWidth: number;
  screenHeight: number;
  scale?: number;
  longPressTime?: number;
  tapMaxDistance?: number;
  swipeMinDistance?: number;
}

/**
 * Touch manager for mobile input
 */
export class TouchManager {
  private canvas: HTMLCanvasElement;
  private screenWidth: number;
  private screenHeight: number;
  private scale: number;

  private touches: Map<number, TouchPoint> = new Map();
  private gestureCallbacks: GestureCallback[] = [];

  // Gesture detection
  private longPressTime: number;
  private tapMaxDistance: number;
  private swipeMinDistance: number;
  private longPressTimer: number | null = null;

  // Virtual joystick
  private joystick: VirtualJoystick = {
    active: false,
    baseX: 0,
    baseY: 0,
    stickX: 0,
    stickY: 0,
    dx: 0,
    dy: 0
  };
  private joystickRadius = 50;
  private joystickEnabled = true;
  private joystickTouchId: number | null = null;

  // Pinch zoom
  private pinchStartDistance: number | null = null;

  constructor(config: TouchManagerConfig) {
    this.canvas = config.canvas;
    this.screenWidth = config.screenWidth;
    this.screenHeight = config.screenHeight;
    this.scale = config.scale ?? 1;
    this.longPressTime = config.longPressTime ?? 500;
    this.tapMaxDistance = config.tapMaxDistance ?? 10;
    this.swipeMinDistance = config.swipeMinDistance ?? 50;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd.bind(this), { passive: false });
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]!;
      const pos = this.getTouchPosition(touch);

      const point: TouchPoint = {
        id: touch.identifier,
        x: pos.x,
        y: pos.y,
        startX: pos.x,
        startY: pos.y,
        startTime: Date.now()
      };

      this.touches.set(touch.identifier, point);

      // Check for joystick activation
      if (this.joystickEnabled && this.joystickTouchId === null && this.isInJoystickZone(pos.x, pos.y)) {
        this.joystickTouchId = touch.identifier;
        this.joystick.active = true;
        this.joystick.baseX = pos.x;
        this.joystick.baseY = pos.y;
        this.joystick.stickX = pos.x;
        this.joystick.stickY = pos.y;
        this.joystick.dx = 0;
        this.joystick.dy = 0;
      }

      // Start long press timer for single touch
      if (this.touches.size === 1) {
        this.startLongPressTimer(point);
      }
    }

    // Check for pinch start
    if (this.touches.size === 2) {
      this.cancelLongPressTimer();
      const touchArray = Array.from(this.touches.values());
      this.pinchStartDistance = this.getDistance(touchArray[0]!, touchArray[1]!);
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]!;
      const point = this.touches.get(touch.identifier);
      if (!point) continue;

      const pos = this.getTouchPosition(touch);
      point.x = pos.x;
      point.y = pos.y;

      // Update joystick
      if (touch.identifier === this.joystickTouchId) {
        this.updateJoystick(pos.x, pos.y);
      }

      // Cancel long press if moved too far
      const distance = this.getDistance(point, { x: point.startX, y: point.startY });
      if (distance > this.tapMaxDistance) {
        this.cancelLongPressTimer();
      }
    }

    // Handle pinch
    if (this.touches.size === 2 && this.pinchStartDistance !== null) {
      const touchArray = Array.from(this.touches.values());
      const currentDistance = this.getDistance(touchArray[0]!, touchArray[1]!);
      const scale = currentDistance / this.pinchStartDistance;

      const centerX = (touchArray[0]!.x + touchArray[1]!.x) / 2;
      const centerY = (touchArray[0]!.y + touchArray[1]!.y) / 2;

      this.emitGesture({
        type: 'pinch',
        x: centerX,
        y: centerY,
        scale
      });
    }

    // Emit pan for single touch movement
    if (this.touches.size === 1 && this.joystickTouchId === null) {
      const point = this.touches.values().next().value as TouchPoint;
      const deltaX = point.x - point.startX;
      const deltaY = point.y - point.startY;

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        this.emitGesture({
          type: 'pan',
          x: point.x,
          y: point.y,
          deltaX,
          deltaY
        });
      }
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    e.preventDefault();

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i]!;
      const point = this.touches.get(touch.identifier);
      if (!point) continue;

      // Check for gestures
      const distance = this.getDistance(point, { x: point.startX, y: point.startY });
      const duration = Date.now() - point.startTime;

      if (touch.identifier !== this.joystickTouchId) {
        if (distance < this.tapMaxDistance && duration < this.longPressTime) {
          // Tap
          this.emitGesture({
            type: 'tap',
            x: point.x,
            y: point.y
          });
        } else if (distance >= this.swipeMinDistance && duration < 500) {
          // Swipe
          const deltaX = point.x - point.startX;
          const deltaY = point.y - point.startY;
          let direction: GestureEvent['direction'];

          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            direction = deltaX > 0 ? 'right' : 'left';
          } else {
            direction = deltaY > 0 ? 'down' : 'up';
          }

          this.emitGesture({
            type: 'swipe',
            x: point.x,
            y: point.y,
            deltaX,
            deltaY,
            direction
          });
        }
      }

      // Release joystick
      if (touch.identifier === this.joystickTouchId) {
        this.joystickTouchId = null;
        this.joystick.active = false;
        this.joystick.dx = 0;
        this.joystick.dy = 0;
      }

      this.touches.delete(touch.identifier);
    }

    this.cancelLongPressTimer();

    // Reset pinch
    if (this.touches.size < 2) {
      this.pinchStartDistance = null;
    }
  }

  private getTouchPosition(touch: Touch): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.screenWidth / (rect.width / this.scale);
    const scaleY = this.screenHeight / (rect.height / this.scale);

    return {
      x: Math.floor((touch.clientX - rect.left) * scaleX / this.scale),
      y: Math.floor((touch.clientY - rect.top) * scaleY / this.scale)
    };
  }

  private getDistance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private startLongPressTimer(point: TouchPoint): void {
    this.cancelLongPressTimer();
    this.longPressTimer = window.setTimeout(() => {
      this.emitGesture({
        type: 'longpress',
        x: point.x,
        y: point.y
      });
    }, this.longPressTime);
  }

  private cancelLongPressTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private isInJoystickZone(x: number, y: number): boolean {
    // Left side of screen, bottom half
    return x < this.screenWidth / 3 && y > this.screenHeight / 2;
  }

  private updateJoystick(x: number, y: number): void {
    const dx = x - this.joystick.baseX;
    const dy = y - this.joystick.baseY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > this.joystickRadius) {
      // Clamp to radius
      this.joystick.stickX = this.joystick.baseX + (dx / distance) * this.joystickRadius;
      this.joystick.stickY = this.joystick.baseY + (dy / distance) * this.joystickRadius;
      this.joystick.dx = dx / distance;
      this.joystick.dy = dy / distance;
    } else {
      this.joystick.stickX = x;
      this.joystick.stickY = y;
      this.joystick.dx = dx / this.joystickRadius;
      this.joystick.dy = dy / this.joystickRadius;
    }
  }

  private emitGesture(event: GestureEvent): void {
    for (const callback of this.gestureCallbacks) {
      callback(event);
    }
  }

  // Public API

  /**
   * Register gesture callback
   */
  onGesture(callback: GestureCallback): () => void {
    this.gestureCallbacks.push(callback);
    return () => {
      const idx = this.gestureCallbacks.indexOf(callback);
      if (idx >= 0) this.gestureCallbacks.splice(idx, 1);
    };
  }

  /**
   * Get virtual joystick state
   */
  getJoystick(): VirtualJoystick {
    return { ...this.joystick };
  }

  /**
   * Enable/disable virtual joystick
   */
  setJoystickEnabled(enabled: boolean): void {
    this.joystickEnabled = enabled;
    if (!enabled) {
      this.joystick.active = false;
      this.joystickTouchId = null;
    }
  }

  /**
   * Set joystick radius
   */
  setJoystickRadius(radius: number): void {
    this.joystickRadius = radius;
  }

  /**
   * Set display scale
   */
  setScale(scale: number): void {
    this.scale = scale;
  }

  /**
   * Get number of active touches
   */
  getTouchCount(): number {
    return this.touches.size;
  }

  /**
   * Get all active touch points
   */
  getTouches(): TouchPoint[] {
    return Array.from(this.touches.values());
  }

  /**
   * Draw joystick overlay (call from render loop)
   */
  drawJoystick(ctx: CanvasRenderingContext2D): void {
    if (!this.joystick.active) return;

    const scale = this.scale;

    // Draw base circle
    ctx.beginPath();
    ctx.arc(
      this.joystick.baseX * scale,
      this.joystick.baseY * scale,
      this.joystickRadius * scale,
      0,
      Math.PI * 2
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw stick
    ctx.beginPath();
    ctx.arc(
      this.joystick.stickX * scale,
      this.joystick.stickY * scale,
      (this.joystickRadius / 3) * scale,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fill();
  }
}
