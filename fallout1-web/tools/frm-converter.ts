/**
 * FRM to PNG Converter
 * Converts Fallout FRM sprites to PNG + JSON metadata
 *
 * Usage: npx ts-node tools/frm-converter.ts <input-dir> <output-dir> [palette.pal]
 */

import * as fs from 'fs';
import * as path from 'path';

// PNG encoder (simple implementation)
import { createCanvas } from 'canvas';

const ROTATION_COUNT = 6;

interface FRMHeader {
  version: number;
  framesPerSecond: number;
  actionFrame: number;
  frameCount: number;
  xOffsets: number[];
  yOffsets: number[];
  dataOffsets: number[];
  dataSize: number;
}

interface FRMFrame {
  width: number;
  height: number;
  size: number;
  hotspotX: number;
  hotspotY: number;
  pixels: Buffer;
}

interface FRMData {
  header: FRMHeader;
  frames: FRMFrame[][];
}

interface SpriteManifest {
  name: string;
  framesPerSecond: number;
  actionFrame: number;
  frameCount: number;
  rotations: RotationManifest[];
}

interface RotationManifest {
  xOffset: number;
  yOffset: number;
  frames: FrameManifest[];
}

interface FrameManifest {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  x: number;  // Position in sprite sheet
  y: number;
}

/**
 * Load a palette file
 */
function loadPalette(palettePath: string): Uint8Array {
  const buffer = fs.readFileSync(palettePath);
  const palette = new Uint8Array(768);

  // Read 256 RGB triplets (6-bit values)
  for (let i = 0; i < 768; i++) {
    // Convert 6-bit to 8-bit
    palette[i] = (buffer[i]! & 0x3F) << 2;
  }

  return palette;
}

/**
 * Generate a default grayscale palette
 */
function defaultPalette(): Uint8Array {
  const palette = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    palette[i * 3] = i;
    palette[i * 3 + 1] = i;
    palette[i * 3 + 2] = i;
  }
  return palette;
}

/**
 * Parse FRM file
 */
function parseFRM(buffer: Buffer): FRMData {
  let offset = 0;

  // Read header (big endian)
  const header: FRMHeader = {
    version: buffer.readUInt32BE(offset),
    framesPerSecond: buffer.readUInt16BE(offset + 4),
    actionFrame: buffer.readUInt16BE(offset + 6),
    frameCount: buffer.readUInt16BE(offset + 8),
    xOffsets: [],
    yOffsets: [],
    dataOffsets: [],
    dataSize: 0
  };
  offset += 10;

  // Read offsets
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.xOffsets.push(buffer.readInt16BE(offset));
    offset += 2;
  }
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.yOffsets.push(buffer.readInt16BE(offset));
    offset += 2;
  }
  for (let i = 0; i < ROTATION_COUNT; i++) {
    header.dataOffsets.push(buffer.readUInt32BE(offset));
    offset += 4;
  }

  header.dataSize = buffer.readUInt32BE(offset);
  offset += 4;

  // Parse frames
  const frames: FRMFrame[][] = [];
  const headerSize = 62;

  for (let rot = 0; rot < ROTATION_COUNT; rot++) {
    const rotFrames: FRMFrame[] = [];

    // Check if this rotation shares data with a previous one
    let sharesWith = -1;
    for (let prev = 0; prev < rot; prev++) {
      if (header.dataOffsets[prev] === header.dataOffsets[rot]) {
        sharesWith = prev;
        break;
      }
    }

    if (sharesWith >= 0) {
      frames.push(frames[sharesWith]!);
      continue;
    }

    // Parse frames for this rotation
    let frameOffset = headerSize + header.dataOffsets[rot]!;

    for (let f = 0; f < header.frameCount; f++) {
      const width = buffer.readUInt16BE(frameOffset);
      const height = buffer.readUInt16BE(frameOffset + 2);
      const size = buffer.readUInt32BE(frameOffset + 4);
      const hotspotX = buffer.readInt16BE(frameOffset + 8);
      const hotspotY = buffer.readInt16BE(frameOffset + 10);
      frameOffset += 12;

      const pixels = buffer.slice(frameOffset, frameOffset + size);
      frameOffset += size;

      rotFrames.push({ width, height, size, hotspotX, hotspotY, pixels });
    }

    frames.push(rotFrames);
  }

  return { header, frames };
}

/**
 * Create a sprite sheet from FRM data
 */
function createSpriteSheet(
  frm: FRMData,
  palette: Uint8Array
): { imageData: Buffer; manifest: SpriteManifest; width: number; height: number } {
  // Calculate sprite sheet dimensions
  let maxWidth = 0;
  let maxHeight = 0;

  for (const rotation of frm.frames) {
    for (const frame of rotation) {
      maxWidth = Math.max(maxWidth, frame.width);
      maxHeight = Math.max(maxHeight, frame.height);
    }
  }

  const sheetWidth = maxWidth * frm.header.frameCount;
  const sheetHeight = maxHeight * ROTATION_COUNT;

  // Create canvas
  const canvas = createCanvas(sheetWidth, sheetHeight);
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(sheetWidth, sheetHeight);
  const data = imageData.data;

  // Initialize with transparency
  data.fill(0);

  // Build manifest
  const manifest: SpriteManifest = {
    name: '',
    framesPerSecond: frm.header.framesPerSecond || 10,
    actionFrame: frm.header.actionFrame,
    frameCount: frm.header.frameCount,
    rotations: []
  };

  // Draw frames and build manifest
  for (let rot = 0; rot < ROTATION_COUNT; rot++) {
    const rotation = frm.frames[rot]!;
    const rotManifest: RotationManifest = {
      xOffset: frm.header.xOffsets[rot]!,
      yOffset: frm.header.yOffsets[rot]!,
      frames: []
    };

    for (let f = 0; f < rotation.length; f++) {
      const frame = rotation[f]!;
      const destX = f * maxWidth + Math.floor((maxWidth - frame.width) / 2);
      const destY = rot * maxHeight + Math.floor((maxHeight - frame.height) / 2);

      rotManifest.frames.push({
        width: frame.width,
        height: frame.height,
        hotspotX: frame.hotspotX,
        hotspotY: frame.hotspotY,
        x: destX,
        y: destY
      });

      // Draw pixels
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const srcIdx = y * frame.width + x;
          const colorIndex = frame.pixels[srcIdx]!;

          // Skip transparent pixels (color 0)
          if (colorIndex === 0) continue;

          const px = destX + x;
          const py = destY + y;
          const destIdx = (py * sheetWidth + px) * 4;

          data[destIdx] = palette[colorIndex * 3]!;
          data[destIdx + 1] = palette[colorIndex * 3 + 1]!;
          data[destIdx + 2] = palette[colorIndex * 3 + 2]!;
          data[destIdx + 3] = 255;
        }
      }
    }

    manifest.rotations.push(rotManifest);
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    imageData: canvas.toBuffer('image/png'),
    manifest,
    width: sheetWidth,
    height: sheetHeight
  };
}

/**
 * Convert a single FRM file
 */
function convertFRM(
  inputPath: string,
  outputDir: string,
  palette: Uint8Array
): void {
  const buffer = fs.readFileSync(inputPath);
  const frm = parseFRM(buffer);

  const baseName = path.basename(inputPath, '.frm');
  const relativePath = path.relative(process.cwd(), inputPath);

  const { imageData, manifest, width, height } = createSpriteSheet(frm, palette);

  manifest.name = baseName;

  // Write PNG
  const pngPath = path.join(outputDir, `${baseName}.png`);
  fs.writeFileSync(pngPath, imageData);

  // Write JSON manifest
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));

  console.log(`  ${relativePath} -> ${baseName}.png (${width}x${height})`);
}

/**
 * Process directory recursively
 */
function processDirectory(
  inputDir: string,
  outputDir: string,
  palette: Uint8Array,
  stats: { converted: number; errors: number }
): void {
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });

  for (const entry of entries) {
    const inputPath = path.join(inputDir, entry.name);

    if (entry.isDirectory()) {
      const subOutputDir = path.join(outputDir, entry.name);
      fs.mkdirSync(subOutputDir, { recursive: true });
      processDirectory(inputPath, subOutputDir, palette, stats);
    } else if (entry.name.toLowerCase().endsWith('.frm')) {
      try {
        convertFRM(inputPath, outputDir, palette);
        stats.converted++;
      } catch (error) {
        console.error(`  Error converting ${inputPath}:`, error);
        stats.errors++;
      }
    }
  }
}

// Main
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('FRM to PNG Converter');
  console.log('Usage: npx ts-node frm-converter.ts <input-dir> <output-dir> [palette.pal]');
  console.log('\nConverts Fallout FRM sprites to PNG sprite sheets with JSON metadata.');
  process.exit(1);
}

const inputDir = args[0]!;
const outputDir = args[1]!;
const paletteFile = args[2];

// Load palette
let palette: Uint8Array;
if (paletteFile && fs.existsSync(paletteFile)) {
  console.log(`Loading palette from ${paletteFile}`);
  palette = loadPalette(paletteFile);
} else {
  console.log('Using default grayscale palette');
  palette = defaultPalette();
}

// Check input directory
if (!fs.existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

// Create output directory
fs.mkdirSync(outputDir, { recursive: true });

console.log(`\nConverting FRM files from ${inputDir} to ${outputDir}\n`);

const stats = { converted: 0, errors: 0 };
processDirectory(inputDir, outputDir, palette, stats);

console.log(`\nConversion complete!`);
console.log(`  Converted: ${stats.converted} files`);
console.log(`  Errors: ${stats.errors}`);
