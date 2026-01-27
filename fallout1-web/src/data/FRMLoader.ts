/**
 * FRM Sprite Format Loader
 * Port of game/artload.c
 *
 * FRM is Fallout's sprite format containing:
 * - Animation frames for up to 6 rotations
 * - Per-frame dimensions and hotspots
 * - Palette-indexed pixel data
 */

export const ROTATION_COUNT = 6;

/**
 * FRM file header structure
 */
export interface FRMHeader {
  /** Version/flags (always 4 in Fallout 1) */
  version: number;
  /** Frames per second for animation */
  framesPerSecond: number;
  /** Action frame (when to trigger effects) */
  actionFrame: number;
  /** Number of frames per direction */
  frameCount: number;
  /** X offset per rotation */
  xOffsets: number[];
  /** Y offset per rotation */
  yOffsets: number[];
  /** Data offset for each rotation */
  dataOffsets: number[];
  /** Total data size */
  dataSize: number;
}

/**
 * Individual frame data
 */
export interface FRMFrame {
  /** Frame width in pixels */
  width: number;
  /** Frame height in pixels */
  height: number;
  /** Pixel data size */
  size: number;
  /** Hotspot X (relative to top-left) */
  hotspotX: number;
  /** Hotspot Y (relative to top-left) */
  hotspotY: number;
  /** Palette-indexed pixel data */
  pixels: Uint8Array;
}

/**
 * Complete FRM sprite data
 */
export interface FRMSprite {
  header: FRMHeader;
  /** Frames indexed by [rotation][frame] */
  frames: FRMFrame[][];
}

/**
 * Parse FRM file data
 */
export function parseFRM(data: ArrayBuffer): FRMSprite {
  const view = new DataView(data);
  let offset = 0;

  // Read header
  const header: FRMHeader = {
    version: view.getUint32(offset, false), // Big endian
    framesPerSecond: view.getUint16(offset + 4, false),
    actionFrame: view.getUint16(offset + 6, false),
    frameCount: view.getUint16(offset + 8, false),
    xOffsets: [],
    yOffsets: [],
    dataOffsets: [],
    dataSize: 0
  };
  offset += 10;

  // Read offsets for each rotation
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.xOffsets.push(view.getInt16(offset, false));
    offset += 2;
  }
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.yOffsets.push(view.getInt16(offset, false));
    offset += 2;
  }
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.dataOffsets.push(view.getUint32(offset, false));
    offset += 4;
  }

  header.dataSize = view.getUint32(offset, false);
  offset += 4;

  // Total header size is 62 bytes (0x3E)

  // Read frames for each rotation
  const frames: FRMFrame[][] = [];
  const headerSize = 62; // Fixed header size

  for (let rotation = 0; rotation < ROTATION_COUNT; rotation++) {
    const rotationFrames: FRMFrame[] = [];

    // Check if this rotation uses the same data as a previous one
    let useExisting = false;
    for (let prev = 0; prev < rotation; prev++) {
      if (header.dataOffsets[prev] === header.dataOffsets[rotation]) {
        // Reference existing frames
        frames.push(frames[prev]!);
        useExisting = true;
        break;
      }
    }

    if (useExisting) continue;

    // Parse frames for this rotation
    let frameOffset = headerSize + header.dataOffsets[rotation]!;

    for (let frameIdx = 0; frameIdx < header.frameCount; frameIdx++) {
      const width = view.getUint16(frameOffset, false);
      const height = view.getUint16(frameOffset + 2, false);
      const size = view.getUint32(frameOffset + 4, false);
      const hotspotX = view.getInt16(frameOffset + 8, false);
      const hotspotY = view.getInt16(frameOffset + 10, false);
      frameOffset += 12;

      // Read pixel data
      const pixels = new Uint8Array(data, frameOffset, size);
      frameOffset += size;

      rotationFrames.push({
        width,
        height,
        size,
        hotspotX,
        hotspotY,
        pixels: new Uint8Array(pixels) // Copy the data
      });
    }

    frames.push(rotationFrames);
  }

  return { header, frames };
}

/**
 * Get frame dimensions
 */
export function getFrameSize(
  sprite: FRMSprite,
  frame: number,
  rotation: number
): { width: number; height: number } {
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];

  if (!frameData) {
    return { width: 0, height: 0 };
  }

  return { width: frameData.width, height: frameData.height };
}

/**
 * Get frame hotspot
 */
export function getFrameHotspot(
  sprite: FRMSprite,
  frame: number,
  rotation: number
): { x: number; y: number } {
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];

  if (!frameData) {
    return { x: 0, y: 0 };
  }

  return { x: frameData.hotspotX, y: frameData.hotspotY };
}

/**
 * Get rotation offsets
 */
export function getRotationOffset(
  sprite: FRMSprite,
  rotation: number
): { x: number; y: number } {
  const rot = rotation % ROTATION_COUNT;
  return {
    x: sprite.header.xOffsets[rot] ?? 0,
    y: sprite.header.yOffsets[rot] ?? 0
  };
}

/**
 * Get frame pixel data
 */
export function getFrameData(
  sprite: FRMSprite,
  frame: number,
  rotation: number
): Uint8Array | null {
  const rot = rotation % ROTATION_COUNT;
  const frameData = sprite.frames[rot]?.[frame];
  return frameData?.pixels ?? null;
}

/**
 * Get animation FPS
 */
export function getAnimationFPS(sprite: FRMSprite): number {
  return sprite.header.framesPerSecond || 10; // Default to 10 FPS
}

/**
 * Get action frame index
 */
export function getActionFrame(sprite: FRMSprite): number {
  return sprite.header.actionFrame;
}

/**
 * Get total frame count
 */
export function getFrameCount(sprite: FRMSprite): number {
  return sprite.header.frameCount;
}

/**
 * Convert FRM to a sprite sheet for efficient WebGL/Canvas rendering
 * Returns a single buffer with all frames laid out horizontally
 */
export function createSpriteSheet(sprite: FRMSprite): {
  data: Uint8Array;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
} {
  // Find max frame dimensions
  let maxWidth = 0;
  let maxHeight = 0;

  for (const rotation of sprite.frames) {
    for (const frame of rotation) {
      maxWidth = Math.max(maxWidth, frame.width);
      maxHeight = Math.max(maxHeight, frame.height);
    }
  }

  // Create sheet with all rotations and frames
  const sheetWidth = maxWidth * sprite.header.frameCount;
  const sheetHeight = maxHeight * ROTATION_COUNT;
  const data = new Uint8Array(sheetWidth * sheetHeight);

  // Copy each frame to the sheet
  for (let rot = 0; rot < ROTATION_COUNT; rot++) {
    const rotation = sprite.frames[rot];
    if (!rotation) continue;

    for (let f = 0; f < rotation.length; f++) {
      const frame = rotation[f];
      if (!frame) continue;

      const destX = f * maxWidth;
      const destY = rot * maxHeight;

      // Center frame within its cell
      const offsetX = Math.floor((maxWidth - frame.width) / 2);
      const offsetY = Math.floor((maxHeight - frame.height) / 2);

      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const srcIdx = y * frame.width + x;
          const destIdx = (destY + offsetY + y) * sheetWidth + (destX + offsetX + x);
          data[destIdx] = frame.pixels[srcIdx]!;
        }
      }
    }
  }

  return {
    data,
    width: sheetWidth,
    height: sheetHeight,
    frameWidth: maxWidth,
    frameHeight: maxHeight,
    frameCount: sprite.header.frameCount
  };
}

/**
 * FRM Sprite class for easier manipulation
 */
export class Sprite {
  private data: FRMSprite;

  constructor(data: FRMSprite) {
    this.data = data;
  }

  static fromBuffer(buffer: ArrayBuffer): Sprite {
    return new Sprite(parseFRM(buffer));
  }

  get frameCount(): number {
    return this.data.header.frameCount;
  }

  get fps(): number {
    return this.data.header.framesPerSecond || 10;
  }

  get actionFrame(): number {
    return this.data.header.actionFrame;
  }

  getFrame(frame: number, rotation = 0): FRMFrame | null {
    const rot = rotation % ROTATION_COUNT;
    return this.data.frames[rot]?.[frame] ?? null;
  }

  getFrameSize(frame: number, rotation = 0): { width: number; height: number } {
    return getFrameSize(this.data, frame, rotation);
  }

  getHotspot(frame: number, rotation = 0): { x: number; y: number } {
    return getFrameHotspot(this.data, frame, rotation);
  }

  getOffset(rotation: number): { x: number; y: number } {
    return getRotationOffset(this.data, rotation);
  }

  getData(): FRMSprite {
    return this.data;
  }
}
