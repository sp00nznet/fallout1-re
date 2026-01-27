/**
 * Window Manager - Port of GNW window system
 * Port of plib/gnw/gnw.c
 *
 * Manages layered windows with their own buffers
 */

import { Renderer } from './Renderer';
import { Rect, createRect, rectIntersect, rectGetWidth, rectGetHeight } from '@/utils/Rect';

export const MAX_WINDOW_COUNT = 50;

export const enum WindowFlags {
  Hidden = 0x01,
  CanDrag = 0x02,
  Modal = 0x04,
  Transparent = 0x08,
  UseScreenBuffer = 0x10,
  DontMoveTop = 0x20
}

export interface Window {
  id: number;
  rect: Rect;
  width: number;
  height: number;
  buffer: Uint8Array;
  flags: number;
  backgroundColor: number;
}

export type WindowBlitProc = (
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  srcPitch: number,
  dest: Uint8Array,
  destPitch: number
) => void;

/**
 * Window Manager handles overlapping windows
 */
export class WindowManager {
  private windows: (Window | null)[] = new Array(MAX_WINDOW_COUNT).fill(null);
  private windowOrder: number[] = []; // Window IDs in z-order (back to front)
  private nextWindowId = 1;
  private renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;

    // Create root window (window 0) covering entire screen
    const rootWindow: Window = {
      id: 0,
      rect: { ...renderer.screenRect },
      width: renderer.width,
      height: renderer.height,
      buffer: new Uint8Array(0), // Root window has no buffer
      flags: 0,
      backgroundColor: 0
    };

    this.windows[0] = rootWindow;
    this.windowOrder.push(0);
  }

  /**
   * Create a new window
   */
  createWindow(
    x: number,
    y: number,
    width: number,
    height: number,
    backgroundColor: number = 0,
    flags: number = 0
  ): number {
    // Find free slot
    let slot = -1;
    for (let i = 1; i < MAX_WINDOW_COUNT; i++) {
      if (this.windows[i] === null) {
        slot = i;
        break;
      }
    }

    if (slot === -1) {
      console.error('Maximum windows reached');
      return -1;
    }

    // Clamp to screen bounds
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + width > this.renderer.width) {
      x = this.renderer.width - width;
    }
    if (y + height > this.renderer.height) {
      y = this.renderer.height - height;
    }

    const id = this.nextWindowId++;

    const window: Window = {
      id,
      rect: createRect(x, y, x + width - 1, y + height - 1),
      width,
      height,
      buffer: new Uint8Array(width * height),
      flags: flags | WindowFlags.Hidden, // Start hidden
      backgroundColor
    };

    // Fill with background color
    window.buffer.fill(backgroundColor);

    this.windows[slot] = window;
    this.windowOrder.push(id);

    return id;
  }

  /**
   * Delete a window
   */
  deleteWindow(windowId: number): void {
    if (windowId === 0) return; // Can't delete root

    const slot = this.findWindowSlot(windowId);
    if (slot === -1) return;

    const window = this.windows[slot]!;
    const rect = { ...window.rect };

    this.windows[slot] = null;

    // Remove from order
    const orderIdx = this.windowOrder.indexOf(windowId);
    if (orderIdx >= 0) {
      this.windowOrder.splice(orderIdx, 1);
    }

    // Refresh the area
    this.refreshAll(rect);
  }

  /**
   * Show a window
   */
  showWindow(windowId: number): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    if (window.flags & WindowFlags.Hidden) {
      window.flags &= ~WindowFlags.Hidden;

      // Move to top of z-order (unless DontMoveTop)
      if (!(window.flags & WindowFlags.DontMoveTop)) {
        this.bringToFront(windowId);
      }

      this.refreshWindow(window);
    }
  }

  /**
   * Hide a window
   */
  hideWindow(windowId: number): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    if (!(window.flags & WindowFlags.Hidden)) {
      window.flags |= WindowFlags.Hidden;
      this.refreshAll(window.rect);
    }
  }

  /**
   * Move a window
   */
  moveWindow(windowId: number, x: number, y: number): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    const oldRect = { ...window.rect };

    // Clamp to screen bounds
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + window.width > this.renderer.width) {
      x = this.renderer.width - window.width;
    }
    if (y + window.height > this.renderer.height) {
      y = this.renderer.height - window.height;
    }

    window.rect.ulx = x;
    window.rect.uly = y;
    window.rect.lrx = x + window.width - 1;
    window.rect.lry = y + window.height - 1;

    if (!(window.flags & WindowFlags.Hidden)) {
      this.refreshWindow(window);
      this.refreshAll(oldRect);
    }
  }

  /**
   * Bring window to front of z-order
   */
  bringToFront(windowId: number): void {
    const idx = this.windowOrder.indexOf(windowId);
    if (idx >= 0 && idx < this.windowOrder.length - 1) {
      this.windowOrder.splice(idx, 1);
      this.windowOrder.push(windowId);

      const window = this.findWindow(windowId);
      if (window && !(window.flags & WindowFlags.Hidden)) {
        this.refreshWindow(window);
      }
    }
  }

  /**
   * Get window buffer for drawing
   */
  getWindowBuffer(windowId: number): Uint8Array | null {
    const window = this.findWindow(windowId);
    return window?.buffer ?? null;
  }

  /**
   * Get window dimensions
   */
  getWindowSize(windowId: number): { width: number; height: number } | null {
    const window = this.findWindow(windowId);
    if (!window) return null;
    return { width: window.width, height: window.height };
  }

  /**
   * Get window position
   */
  getWindowRect(windowId: number): Rect | null {
    const window = this.findWindow(windowId);
    if (!window) return null;
    return { ...window.rect };
  }

  /**
   * Fill window with a color
   */
  fillWindow(windowId: number, x: number, y: number, width: number, height: number, color: number): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    const startX = Math.max(0, x);
    const startY = Math.max(0, y);
    const endX = Math.min(window.width, x + width);
    const endY = Math.min(window.height, y + height);

    for (let py = startY; py < endY; py++) {
      const rowStart = py * window.width + startX;
      window.buffer.fill(color, rowStart, rowStart + (endX - startX));
    }
  }

  /**
   * Draw text to window (placeholder - needs font system)
   */
  printWindow(
    windowId: number,
    text: string,
    x: number,
    y: number,
    _color: number
  ): void {
    // TODO: Implement when font system is ready
    console.log(`Window ${windowId}: "${text}" at (${x}, ${y})`);
  }

  /**
   * Draw a line in a window
   */
  lineWindow(
    windowId: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: number
  ): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    const buf = window.buffer;
    const pitch = window.width;

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let x = x1;
    let y = y1;

    while (true) {
      if (x >= 0 && x < window.width && y >= 0 && y < window.height) {
        buf[y * pitch + x] = color;
      }

      if (x === x2 && y === y2) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Draw a box outline in a window
   */
  boxWindow(
    windowId: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    color: number
  ): void {
    this.lineWindow(windowId, left, top, right, top, color);
    this.lineWindow(windowId, left, bottom, right, bottom, color);
    this.lineWindow(windowId, left, top, left, bottom, color);
    this.lineWindow(windowId, right, top, right, bottom, color);
  }

  /**
   * Request window redraw
   */
  drawWindow(windowId: number): void {
    const window = this.findWindow(windowId);
    if (!window) return;
    this.refreshWindow(window);
  }

  /**
   * Refresh specific rectangle within a window
   */
  drawWindowRect(windowId: number, rect: Rect): void {
    const window = this.findWindow(windowId);
    if (!window) return;

    const screenRect = createRect(
      window.rect.ulx + rect.ulx,
      window.rect.uly + rect.uly,
      window.rect.ulx + rect.lrx,
      window.rect.uly + rect.lry
    );

    this.refreshWindow(window, screenRect);
  }

  /**
   * Get window at screen position
   */
  getWindowAt(x: number, y: number): number {
    // Search from front to back
    for (let i = this.windowOrder.length - 1; i >= 0; i--) {
      const id = this.windowOrder[i]!;
      const window = this.findWindow(id);
      if (window && !(window.flags & WindowFlags.Hidden)) {
        if (x >= window.rect.ulx && x <= window.rect.lrx &&
            y >= window.rect.uly && y <= window.rect.lry) {
          return id;
        }
      }
    }
    return -1;
  }

  /**
   * Refresh a window's region to screen
   */
  private refreshWindow(window: Window, rect?: Rect): void {
    if (window.flags & WindowFlags.Hidden) return;

    const refreshRect = rect ?? window.rect;

    // Clip to window bounds
    const clippedRect = createRect(0, 0, 0, 0);
    if (!rectIntersect(refreshRect, window.rect, clippedRect)) {
      return;
    }

    // Build list of visible regions (clip against higher windows)
    const visibleRects = this.clipToVisibleRegions(window.id, clippedRect);

    // Blit visible portions to screen
    for (const visRect of visibleRects) {
      const srcX = visRect.ulx - window.rect.ulx;
      const srcY = visRect.uly - window.rect.uly;
      const width = rectGetWidth(visRect);
      const height = rectGetHeight(visRect);

      if (window.flags & WindowFlags.Transparent) {
        this.renderer.transBufToBuf(
          window.buffer.subarray(srcY * window.width + srcX),
          width,
          height,
          window.width,
          visRect.ulx,
          visRect.uly
        );
      } else {
        this.renderer.bufToBuf(
          window.buffer.subarray(srcY * window.width + srcX),
          width,
          height,
          window.width,
          visRect.ulx,
          visRect.uly
        );
      }
    }
  }

  /**
   * Refresh all windows in a region
   */
  private refreshAll(rect: Rect): void {
    for (const id of this.windowOrder) {
      const window = this.findWindow(id);
      if (window && !(window.flags & WindowFlags.Hidden)) {
        const intersection = createRect(0, 0, 0, 0);
        if (rectIntersect(rect, window.rect, intersection)) {
          this.refreshWindow(window, intersection);
        }
      }
    }
  }

  /**
   * Clip a rectangle to visible regions (not covered by higher windows)
   */
  private clipToVisibleRegions(windowId: number, rect: Rect): Rect[] {
    let regions: Rect[] = [{ ...rect }];

    // Find all windows above this one
    const windowIdx = this.windowOrder.indexOf(windowId);
    if (windowIdx === -1) return regions;

    for (let i = windowIdx + 1; i < this.windowOrder.length; i++) {
      const aboveId = this.windowOrder[i]!;
      const aboveWindow = this.findWindow(aboveId);
      if (!aboveWindow || (aboveWindow.flags & WindowFlags.Hidden)) {
        continue;
      }

      // Subtract above window's rect from all regions
      regions = this.subtractRect(regions, aboveWindow.rect);
    }

    return regions;
  }

  /**
   * Subtract a rectangle from a list of rectangles
   */
  private subtractRect(regions: Rect[], subtract: Rect): Rect[] {
    const result: Rect[] = [];

    for (const region of regions) {
      // Check if regions intersect
      const intersection = createRect(0, 0, 0, 0);
      if (!rectIntersect(region, subtract, intersection)) {
        // No intersection, keep original
        result.push(region);
        continue;
      }

      // Split into up to 4 rectangles
      // Top
      if (intersection.uly > region.uly) {
        result.push(createRect(region.ulx, region.uly, region.lrx, intersection.uly - 1));
      }
      // Bottom
      if (intersection.lry < region.lry) {
        result.push(createRect(region.ulx, intersection.lry + 1, region.lrx, region.lry));
      }
      // Left
      if (intersection.ulx > region.ulx) {
        result.push(createRect(region.ulx, intersection.uly, intersection.ulx - 1, intersection.lry));
      }
      // Right
      if (intersection.lrx < region.lrx) {
        result.push(createRect(intersection.lrx + 1, intersection.uly, region.lrx, intersection.lry));
      }
    }

    return result;
  }

  private findWindow(id: number): Window | null {
    for (const window of this.windows) {
      if (window && window.id === id) {
        return window;
      }
    }
    return null;
  }

  private findWindowSlot(id: number): number {
    for (let i = 0; i < this.windows.length; i++) {
      if (this.windows[i]?.id === id) {
        return i;
      }
    }
    return -1;
  }
}
