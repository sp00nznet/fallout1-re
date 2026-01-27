/**
 * Sprite rendering utilities
 * Handles drawing FRM sprites to buffers
 */

import { FRMSprite, FRMFrame, ROTATION_COUNT } from '@/data/FRMLoader';

export interface SpriteDrawOptions {
  /** Rotation/direction (0-5) */
  rotation?: number;
  /** Frame index */
  frame?: number;
  /** Use transparency (color 0 = transparent) */
  transparent?: boolean;
  /** Flip horizontally */
  flipX?: boolean;
  /** Flip vertically */
  flipY?: boolean;
  /** Scale factor (1.0 = normal) */
  scale?: number;
  /** Custom blend function */
  blendFunc?: (src: number, dest: number) => number;
}

/**
 * Draw a sprite frame to a buffer
 */
export function drawSprite(
  sprite: FRMSprite,
  destBuffer: Uint8Array,
  destPitch: number,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
  options: SpriteDrawOptions = {}
): void {
  const {
    rotation = 0,
    frame = 0,
    transparent = true,
    flipX = false,
    flipY = false,
    scale = 1.0,
    blendFunc
  } = options;

  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];
  if (!frameData) return;

  if (scale !== 1.0) {
    drawSpriteScaled(frameData, destBuffer, destPitch, destX, destY, destWidth, destHeight, scale, transparent, blendFunc);
  } else if (flipX || flipY) {
    drawSpriteFlipped(frameData, destBuffer, destPitch, destX, destY, destWidth, destHeight, flipX, flipY, transparent, blendFunc);
  } else {
    drawSpriteSimple(frameData, destBuffer, destPitch, destX, destY, destWidth, destHeight, transparent, blendFunc);
  }
}

/**
 * Simple sprite draw (no scaling or flipping)
 */
function drawSpriteSimple(
  frame: FRMFrame,
  dest: Uint8Array,
  destPitch: number,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
  transparent: boolean,
  blendFunc?: (src: number, dest: number) => number
): void {
  const src = frame.pixels;
  const srcWidth = frame.width;
  const srcHeight = frame.height;

  // Calculate clipping
  let sx = 0, sy = 0;
  let dx = destX, dy = destY;
  let w = srcWidth, h = srcHeight;

  // Clip to destination
  if (dx < 0) { sx -= dx; w += dx; dx = 0; }
  if (dy < 0) { sy -= dy; h += dy; dy = 0; }
  if (dx + w > destWidth) { w = destWidth - dx; }
  if (dy + h > destHeight) { h = destHeight - dy; }

  if (w <= 0 || h <= 0) return;

  if (transparent) {
    if (blendFunc) {
      for (let row = 0; row < h; row++) {
        let srcIdx = (sy + row) * srcWidth + sx;
        let destIdx = (dy + row) * destPitch + dx;
        for (let col = 0; col < w; col++) {
          const pixel = src[srcIdx++]!;
          if (pixel !== 0) {
            dest[destIdx] = blendFunc(pixel, dest[destIdx]!);
          }
          destIdx++;
        }
      }
    } else {
      for (let row = 0; row < h; row++) {
        let srcIdx = (sy + row) * srcWidth + sx;
        let destIdx = (dy + row) * destPitch + dx;
        for (let col = 0; col < w; col++) {
          const pixel = src[srcIdx++]!;
          if (pixel !== 0) {
            dest[destIdx] = pixel;
          }
          destIdx++;
        }
      }
    }
  } else {
    if (blendFunc) {
      for (let row = 0; row < h; row++) {
        let srcIdx = (sy + row) * srcWidth + sx;
        let destIdx = (dy + row) * destPitch + dx;
        for (let col = 0; col < w; col++) {
          dest[destIdx] = blendFunc(src[srcIdx++]!, dest[destIdx]!);
          destIdx++;
        }
      }
    } else {
      for (let row = 0; row < h; row++) {
        const srcIdx = (sy + row) * srcWidth + sx;
        const destIdx = (dy + row) * destPitch + dx;
        dest.set(src.subarray(srcIdx, srcIdx + w), destIdx);
      }
    }
  }
}

/**
 * Draw sprite with horizontal/vertical flip
 */
function drawSpriteFlipped(
  frame: FRMFrame,
  dest: Uint8Array,
  destPitch: number,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
  flipX: boolean,
  flipY: boolean,
  transparent: boolean,
  blendFunc?: (src: number, dest: number) => number
): void {
  const src = frame.pixels;
  const srcWidth = frame.width;
  const srcHeight = frame.height;

  for (let row = 0; row < srcHeight; row++) {
    const srcRow = flipY ? (srcHeight - 1 - row) : row;
    const destRow = destY + row;

    if (destRow < 0 || destRow >= destHeight) continue;

    for (let col = 0; col < srcWidth; col++) {
      const srcCol = flipX ? (srcWidth - 1 - col) : col;
      const destCol = destX + col;

      if (destCol < 0 || destCol >= destWidth) continue;

      const pixel = src[srcRow * srcWidth + srcCol]!;

      if (transparent && pixel === 0) continue;

      const destIdx = destRow * destPitch + destCol;
      if (blendFunc) {
        dest[destIdx] = blendFunc(pixel, dest[destIdx]!);
      } else {
        dest[destIdx] = pixel;
      }
    }
  }
}

/**
 * Draw sprite with scaling
 */
function drawSpriteScaled(
  frame: FRMFrame,
  dest: Uint8Array,
  destPitch: number,
  destX: number,
  destY: number,
  destWidth: number,
  destHeight: number,
  scale: number,
  transparent: boolean,
  blendFunc?: (src: number, dest: number) => number
): void {
  const src = frame.pixels;
  const srcWidth = frame.width;
  const srcHeight = frame.height;

  const scaledWidth = Math.floor(srcWidth * scale);
  const scaledHeight = Math.floor(srcHeight * scale);

  for (let row = 0; row < scaledHeight; row++) {
    const srcRow = Math.floor(row / scale);
    const destRow = destY + row;

    if (destRow < 0 || destRow >= destHeight) continue;

    for (let col = 0; col < scaledWidth; col++) {
      const srcCol = Math.floor(col / scale);
      const destCol = destX + col;

      if (destCol < 0 || destCol >= destWidth) continue;

      const pixel = src[srcRow * srcWidth + srcCol]!;

      if (transparent && pixel === 0) continue;

      const destIdx = destRow * destPitch + destCol;
      if (blendFunc) {
        dest[destIdx] = blendFunc(pixel, dest[destIdx]!);
      } else {
        dest[destIdx] = pixel;
      }
    }
  }
}

/**
 * Draw sprite centered at a position (accounting for hotspot)
 */
export function drawSpriteCentered(
  sprite: FRMSprite,
  destBuffer: Uint8Array,
  destPitch: number,
  centerX: number,
  centerY: number,
  destWidth: number,
  destHeight: number,
  options: SpriteDrawOptions = {}
): void {
  const { rotation = 0, frame = 0 } = options;
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];
  if (!frameData) return;

  // Calculate top-left position from center and hotspot
  const x = centerX - frameData.hotspotX;
  const y = centerY - frameData.hotspotY;

  drawSprite(sprite, destBuffer, destPitch, x, y, destWidth, destHeight, options);
}

/**
 * Get sprite bounds at a position (for collision detection)
 */
export function getSpriteBounds(
  sprite: FRMSprite,
  x: number,
  y: number,
  rotation: number,
  frame: number
): { x: number; y: number; width: number; height: number } | null {
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];
  if (!frameData) return null;

  return {
    x: x - frameData.hotspotX,
    y: y - frameData.hotspotY,
    width: frameData.width,
    height: frameData.height
  };
}

/**
 * Check if a point is within a sprite (for pixel-perfect collision)
 */
export function spriteHitTest(
  sprite: FRMSprite,
  spriteX: number,
  spriteY: number,
  testX: number,
  testY: number,
  rotation: number,
  frame: number
): boolean {
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];
  if (!frameData) return false;

  // Calculate position relative to sprite
  const relX = testX - (spriteX - frameData.hotspotX);
  const relY = testY - (spriteY - frameData.hotspotY);

  // Check bounds
  if (relX < 0 || relX >= frameData.width || relY < 0 || relY >= frameData.height) {
    return false;
  }

  // Check pixel (non-transparent)
  const pixel = frameData.pixels[relY * frameData.width + relX];
  return pixel !== 0;
}

/**
 * Create a blend function for lighting effects
 */
export function createLightingBlend(
  intensityTable: Uint8Array[],
  intensity: number
): (src: number, dest: number) => number {
  const intensityIdx = Math.max(0, Math.min(255, Math.floor(intensity * 255)));
  return (src: number, _dest: number) => {
    return intensityTable[src]?.[intensityIdx] ?? src;
  };
}

/**
 * Create a blend function for transparency effects
 */
export function createAlphaBlend(
  blendTable: Uint8Array,
  alpha: number
): (src: number, dest: number) => number {
  const level = Math.floor(alpha * 7); // 0-7 blend levels
  const offset = level * 256;
  return (src: number, _dest: number) => {
    // Use blend table for source-to-dest mapping
    return blendTable[offset + src] ?? src;
  };
}
