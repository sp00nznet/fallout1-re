/**
 * Canvas 2D Renderer with 8-bit palette support
 * Port of plib/gnw/svga.c
 *
 * Maintains an 8-bit index buffer and converts to RGBA on present()
 */

import { Palette } from './Palette';
import { Rect, createRect } from '@/utils/Rect';

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  width?: number;
  height?: number;
  scale?: number;
}

/**
 * Low-level renderer handling 8-bit indexed graphics
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  /** 8-bit index buffer (what the game draws to) */
  private indexBuffer: Uint8Array;

  /** RGBA buffer for canvas output */
  private imageData: ImageData;

  /** Pre-computed RGBA palette (updated when palette changes) */
  private rgbaPalette: Uint32Array;

  /** Screen dimensions */
  readonly width: number;
  readonly height: number;

  /** Display scale */
  private scale: number;

  /** Screen rect for clipping */
  readonly screenRect: Rect;

  /** Palette manager */
  readonly palette: Palette;

  /** Dirty region tracking for optimized updates */
  private dirtyRect: Rect | null = null;

  /** Whether the renderer is active (window focused) */
  private isActive = true;

  constructor(config: RendererConfig) {
    this.canvas = config.canvas;
    this.width = config.width ?? SCREEN_WIDTH;
    this.height = config.height ?? SCREEN_HEIGHT;
    this.scale = config.scale ?? 1;

    // Setup canvas
    this.canvas.width = this.width * this.scale;
    this.canvas.height = this.height * this.scale;

    const ctx = this.canvas.getContext('2d', {
      alpha: false,
      desynchronized: true  // Performance hint
    });
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    // Disable image smoothing for crisp pixels
    this.ctx.imageSmoothingEnabled = false;

    // Initialize buffers
    this.indexBuffer = new Uint8Array(this.width * this.height);
    this.imageData = this.ctx.createImageData(this.width, this.height);

    // Initialize palette
    this.palette = new Palette();
    this.rgbaPalette = this.palette.buildRGBAPalette();

    // Update RGBA palette when palette changes
    this.palette.setChangeCallback(() => {
      this.rgbaPalette = this.palette.buildRGBAPalette();
    });

    // Screen rect
    this.screenRect = createRect(0, 0, this.width - 1, this.height - 1);

    // Clear to black
    this.clear(0);
  }

  /**
   * Set renderer active state (for pause when window loses focus)
   */
  setActive(active: boolean): void {
    this.isActive = active;
  }

  /**
   * Get if renderer is active
   */
  getActive(): boolean {
    return this.isActive;
  }

  /**
   * Get the index buffer for direct manipulation
   */
  getBuffer(): Uint8Array {
    return this.indexBuffer;
  }

  /**
   * Clear the screen with a palette index
   */
  clear(colorIndex: number): void {
    this.indexBuffer.fill(colorIndex);
    this.markDirty(this.screenRect);
  }

  /**
   * Fill a rectangle with a palette index
   */
  fillRect(x: number, y: number, width: number, height: number, colorIndex: number): void {
    const startX = Math.max(0, x);
    const startY = Math.max(0, y);
    const endX = Math.min(this.width, x + width);
    const endY = Math.min(this.height, y + height);

    for (let py = startY; py < endY; py++) {
      const rowStart = py * this.width + startX;
      this.indexBuffer.fill(colorIndex, rowStart, rowStart + (endX - startX));
    }

    this.markDirty(createRect(startX, startY, endX - 1, endY - 1));
  }

  /**
   * Copy buffer to buffer (main blit operation)
   * Port of buf_to_buf from grbuf.c
   */
  bufToBuf(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    srcPitch: number,
    destX: number,
    destY: number
  ): void {
    const destPitch = this.width;
    const dest = this.indexBuffer;

    // Clip to screen bounds
    let sx = 0, sy = 0;
    let dx = destX, dy = destY;
    let w = srcWidth, h = srcHeight;

    if (dx < 0) { sx -= dx; w += dx; dx = 0; }
    if (dy < 0) { sy -= dy; h += dy; dy = 0; }
    if (dx + w > this.width) { w = this.width - dx; }
    if (dy + h > this.height) { h = this.height - dy; }

    if (w <= 0 || h <= 0) return;

    for (let row = 0; row < h; row++) {
      const srcOffset = (sy + row) * srcPitch + sx;
      const destOffset = (dy + row) * destPitch + dx;
      dest.set(src.subarray(srcOffset, srcOffset + w), destOffset);
    }

    this.markDirty(createRect(dx, dy, dx + w - 1, dy + h - 1));
  }

  /**
   * Copy buffer with transparency (color 0 = transparent)
   * Port of trans_buf_to_buf from grbuf.c
   */
  transBufToBuf(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    srcPitch: number,
    destX: number,
    destY: number
  ): void {
    const destPitch = this.width;
    const dest = this.indexBuffer;

    // Clip to screen bounds
    let sx = 0, sy = 0;
    let dx = destX, dy = destY;
    let w = srcWidth, h = srcHeight;

    if (dx < 0) { sx -= dx; w += dx; dx = 0; }
    if (dy < 0) { sy -= dy; h += dy; dy = 0; }
    if (dx + w > this.width) { w = this.width - dx; }
    if (dy + h > this.height) { h = this.height - dy; }

    if (w <= 0 || h <= 0) return;

    for (let row = 0; row < h; row++) {
      let srcOffset = (sy + row) * srcPitch + sx;
      let destOffset = (dy + row) * destPitch + dx;

      for (let col = 0; col < w; col++) {
        const pixel = src[srcOffset++]!;
        if (pixel !== 0) {
          dest[destOffset] = pixel;
        }
        destOffset++;
      }
    }

    this.markDirty(createRect(dx, dy, dx + w - 1, dy + h - 1));
  }

  /**
   * Copy buffer with mask (only draw where mask != 0)
   * Port of mask_buf_to_buf from grbuf.c
   */
  maskBufToBuf(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    srcPitch: number,
    mask: Uint8Array,
    maskPitch: number,
    destX: number,
    destY: number
  ): void {
    const destPitch = this.width;
    const dest = this.indexBuffer;

    for (let row = 0; row < srcHeight; row++) {
      for (let col = 0; col < srcWidth; col++) {
        const maskIdx = row * maskPitch + col;
        if (mask[maskIdx] !== 0) {
          const srcIdx = row * srcPitch + col;
          const destIdx = (destY + row) * destPitch + (destX + col);
          if (destX + col >= 0 && destX + col < this.width &&
              destY + row >= 0 && destY + row < this.height) {
            dest[destIdx] = src[srcIdx]!;
          }
        }
      }
    }

    this.markDirty(createRect(destX, destY, destX + srcWidth - 1, destY + srcHeight - 1));
  }

  /**
   * Draw a line (Bresenham's algorithm)
   * Port of draw_line from grbuf.c
   */
  drawLine(x1: number, y1: number, x2: number, y2: number, colorIndex: number): void {
    const buf = this.indexBuffer;
    const pitch = this.width;

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let x = x1;
    let y = y1;

    while (true) {
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        buf[y * pitch + x] = colorIndex;
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

    this.markDirty(createRect(
      Math.min(x1, x2),
      Math.min(y1, y2),
      Math.max(x1, x2),
      Math.max(y1, y2)
    ));
  }

  /**
   * Draw a rectangle outline
   * Port of draw_box from grbuf.c
   */
  drawBox(left: number, top: number, right: number, bottom: number, colorIndex: number): void {
    this.drawLine(left, top, right, top, colorIndex);
    this.drawLine(left, bottom, right, bottom, colorIndex);
    this.drawLine(left, top, left, bottom, colorIndex);
    this.drawLine(right, top, right, bottom, colorIndex);
  }

  /**
   * Draw a shaded box (3D effect)
   * Port of draw_shaded_box from grbuf.c
   */
  drawShadedBox(
    left: number, top: number, right: number, bottom: number,
    ltColor: number, rbColor: number
  ): void {
    this.drawLine(left, top, right, top, ltColor);
    this.drawLine(left, bottom, right, bottom, rbColor);
    this.drawLine(left, top, left, bottom, ltColor);
    this.drawLine(right, top, right, bottom, rbColor);
  }

  /**
   * Lighten a buffer region using intensity table
   * Port of lighten_buf from grbuf.c
   */
  lightenBuf(x: number, y: number, width: number, height: number): void {
    const buf = this.indexBuffer;
    const pitch = this.width;
    const intensityLevel = 147; // Magic constant from original

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const px = x + col;
        const py = y + row;
        if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
          const idx = py * pitch + px;
          const oldColor = buf[idx]!;
          buf[idx] = this.palette.calculateColor(intensityLevel << 9, oldColor);
        }
      }
    }

    this.markDirty(createRect(x, y, x + width - 1, y + height - 1));
  }

  /**
   * Scale source buffer to destination
   * Port of cscale from grbuf.c
   */
  cscale(
    src: Uint8Array, srcWidth: number, srcHeight: number, srcPitch: number,
    destX: number, destY: number, destWidth: number, destHeight: number
  ): void {
    const dest = this.indexBuffer;
    const destPitch = this.width;

    const heightRatio = (destHeight << 16) / srcHeight;
    const widthRatio = (destWidth << 16) / srcWidth;

    for (let srcY = 0; srcY < srcHeight; srcY++) {
      const y1 = (heightRatio * srcY) >> 16;
      const y2 = (heightRatio * (srcY + 1)) >> 16;

      for (let srcX = 0; srcX < srcWidth; srcX++) {
        const x1 = (widthRatio * srcX) >> 16;
        const x2 = (widthRatio * (srcX + 1)) >> 16;
        const pixel = src[srcY * srcPitch + srcX]!;

        for (let dy = y1; dy < y2; dy++) {
          for (let dx = x1; dx < x2; dx++) {
            const px = destX + dx;
            const py = destY + dy;
            if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
              dest[py * destPitch + px] = pixel;
            }
          }
        }
      }
    }

    this.markDirty(createRect(destX, destY, destX + destWidth - 1, destY + destHeight - 1));
  }

  /**
   * Mark a region as needing update
   */
  markDirty(rect: Rect): void {
    if (!this.dirtyRect) {
      this.dirtyRect = createRect(rect.ulx, rect.uly, rect.lrx, rect.lry);
    } else {
      // Expand dirty rect to include new region
      this.dirtyRect.ulx = Math.min(this.dirtyRect.ulx, rect.ulx);
      this.dirtyRect.uly = Math.min(this.dirtyRect.uly, rect.uly);
      this.dirtyRect.lrx = Math.max(this.dirtyRect.lrx, rect.lrx);
      this.dirtyRect.lry = Math.max(this.dirtyRect.lry, rect.lry);
    }
  }

  /**
   * Blit a region from index buffer to canvas
   * Port of GNW95_ShowRect from svga.c
   */
  showRect(
    srcX: number, srcY: number,
    width: number, height: number,
    destX: number, destY: number
  ): void {
    if (!this.isActive) return;

    // Convert index buffer region to RGBA
    const rgbaData = new Uint32Array(this.imageData.data.buffer);
    const palette = this.rgbaPalette;

    for (let row = 0; row < height; row++) {
      const srcOffset = (srcY + row) * this.width + srcX;
      const destOffset = (destY + row) * this.width + destX;

      for (let col = 0; col < width; col++) {
        const colorIndex = this.indexBuffer[srcOffset + col]!;
        rgbaData[destOffset + col] = palette[colorIndex]!;
      }
    }

    // Draw to canvas
    this.ctx.putImageData(
      this.imageData,
      0, 0,
      destX, destY, width, height
    );

    // Scale if needed
    if (this.scale > 1) {
      this.ctx.drawImage(
        this.canvas,
        destX, destY, width, height,
        destX * this.scale, destY * this.scale,
        width * this.scale, height * this.scale
      );
    }
  }

  /**
   * Present the frame - convert index buffer to RGBA and display
   */
  present(): void {
    if (!this.isActive) return;

    // If nothing dirty, skip
    if (!this.dirtyRect) return;

    // Clamp dirty rect to screen
    const rect = createRect(
      Math.max(0, this.dirtyRect.ulx),
      Math.max(0, this.dirtyRect.uly),
      Math.min(this.width - 1, this.dirtyRect.lrx),
      Math.min(this.height - 1, this.dirtyRect.lry)
    );

    // Convert entire dirty region
    const rgbaData = new Uint32Array(this.imageData.data.buffer);
    const palette = this.rgbaPalette;
    const indexBuffer = this.indexBuffer;
    const width = this.width;

    for (let y = rect.uly; y <= rect.lry; y++) {
      const rowStart = y * width;
      for (let x = rect.ulx; x <= rect.lrx; x++) {
        const colorIndex = indexBuffer[rowStart + x]!;
        rgbaData[rowStart + x] = palette[colorIndex]!;
      }
    }

    // Put the updated region
    this.ctx.putImageData(this.imageData, 0, 0);

    // Scale to canvas if needed
    if (this.scale > 1) {
      // Redraw at scale - clear and draw scaled
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(
        this.canvas,
        0, 0, this.width, this.height,
        0, 0, this.width * this.scale, this.height * this.scale
      );
    }

    // Clear dirty rect
    this.dirtyRect = null;
  }

  /**
   * Force full screen refresh
   */
  refresh(): void {
    this.markDirty(this.screenRect);
    this.present();
  }

  /**
   * Set display scale (1 = native, 2 = 2x, etc.)
   */
  setScale(scale: number): void {
    this.scale = scale;
    this.canvas.width = this.width * scale;
    this.canvas.height = this.height * scale;
    this.ctx.imageSmoothingEnabled = false;
    this.refresh();
  }

  /**
   * Get current scale
   */
  getScale(): number {
    return this.scale;
  }
}
