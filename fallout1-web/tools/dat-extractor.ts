/**
 * DAT Archive Extractor
 * Extracts files from Fallout 1 DAT archives
 *
 * Usage: npx ts-node tools/dat-extractor.ts <input.dat> <output-dir>
 */

import * as fs from 'fs';
import * as path from 'path';

// DAT1 format constants
const DAT_HEADER_SIZE = 16;

interface DATEntry {
  name: string;
  flags: number;
  offset: number;
  originalSize: number;
  packedSize: number;
}

/**
 * LZSS decompression (same as in-browser version)
 */
function lzssDecode(input: Buffer, outputLength: number): Buffer {
  const output = Buffer.alloc(outputLength);
  const ringBuffer = Buffer.alloc(4096);
  ringBuffer.fill(0x20, 0, 4078);

  let ringIndex = 4078;
  let inputPos = 0;
  let outputPos = 0;

  while (outputPos < outputLength && inputPos < input.length) {
    const flags = input[inputPos++]!;

    for (let bit = 0; bit < 8 && outputPos < outputLength; bit++) {
      if (flags & (1 << bit)) {
        if (inputPos >= input.length) break;
        const byte = input[inputPos++]!;
        output[outputPos++] = byte;
        ringBuffer[ringIndex] = byte;
        ringIndex = (ringIndex + 1) & 0xFFF;
      } else {
        if (inputPos + 1 >= input.length) break;
        const low = input[inputPos++]!;
        const high = input[inputPos++]!;
        const offset = low | ((high & 0xF0) << 4);
        const length = (high & 0x0F) + 3;

        for (let i = 0; i < length && outputPos < outputLength; i++) {
          const dictIndex = (offset + i) & 0xFFF;
          const byte = ringBuffer[dictIndex]!;
          output[outputPos++] = byte;
          ringBuffer[ringIndex] = byte;
          ringIndex = (ringIndex + 1) & 0xFFF;
        }
      }
    }
  }

  return output;
}

/**
 * Read a null-terminated string from buffer
 */
function readString(buffer: Buffer, offset: number, maxLength: number): string {
  let end = offset;
  while (end < offset + maxLength && buffer[end] !== 0) {
    end++;
  }
  return buffer.slice(offset, end).toString('ascii');
}

/**
 * Parse DAT1 (Fallout 1) format
 */
function parseDAT1(buffer: Buffer): DATEntry[] {
  const entries: DATEntry[] = [];

  // DAT1 header
  const dirCount = buffer.readUInt32LE(0);
  // Unknown value at offset 4
  // Unknown value at offset 8
  // Unknown value at offset 12

  let offset = DAT_HEADER_SIZE;

  // Read directory entries
  for (let d = 0; d < dirCount; d++) {
    const dirNameLength = buffer.readUInt8(offset);
    offset++;
    const dirName = buffer.slice(offset, offset + dirNameLength).toString('ascii');
    offset += dirNameLength;

    const fileCount = buffer.readUInt32LE(offset);
    offset += 4;

    // Unknown values
    offset += 4; // Unknown
    offset += 4; // Unknown

    // Read file entries in this directory
    for (let f = 0; f < fileCount; f++) {
      const fileNameLength = buffer.readUInt8(offset);
      offset++;
      const fileName = buffer.slice(offset, offset + fileNameLength).toString('ascii');
      offset += fileNameLength;

      const flags = buffer.readUInt32LE(offset);
      offset += 4;

      const fileOffset = buffer.readUInt32LE(offset);
      offset += 4;

      const originalSize = buffer.readUInt32LE(offset);
      offset += 4;

      const packedSize = buffer.readUInt32LE(offset);
      offset += 4;

      entries.push({
        name: path.join(dirName, fileName).replace(/\\/g, '/'),
        flags,
        offset: fileOffset,
        originalSize,
        packedSize
      });
    }
  }

  return entries;
}

/**
 * Extract a single file from the DAT archive
 */
function extractFile(datBuffer: Buffer, entry: DATEntry): Buffer {
  const isCompressed = entry.flags & 0x40;
  const rawData = datBuffer.slice(entry.offset, entry.offset + entry.packedSize);

  if (isCompressed && entry.packedSize !== entry.originalSize) {
    return lzssDecode(rawData, entry.originalSize);
  }

  return rawData;
}

/**
 * Main extraction function
 */
async function extractDAT(inputPath: string, outputDir: string): Promise<void> {
  console.log(`Extracting ${inputPath} to ${outputDir}`);

  // Read DAT file
  const datBuffer = fs.readFileSync(inputPath);
  console.log(`DAT file size: ${datBuffer.length} bytes`);

  // Parse entries
  const entries = parseDAT1(datBuffer);
  console.log(`Found ${entries.length} files`);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Extract each file
  let extracted = 0;
  let errors = 0;

  for (const entry of entries) {
    try {
      const outputPath = path.join(outputDir, entry.name);
      const outputDirPath = path.dirname(outputPath);

      // Create directory structure
      fs.mkdirSync(outputDirPath, { recursive: true });

      // Extract and write file
      const fileData = extractFile(datBuffer, entry);
      fs.writeFileSync(outputPath, fileData);

      extracted++;

      if (extracted % 100 === 0) {
        console.log(`Extracted ${extracted}/${entries.length} files...`);
      }
    } catch (error) {
      console.error(`Failed to extract ${entry.name}:`, error);
      errors++;
    }
  }

  console.log(`\nExtraction complete!`);
  console.log(`  Extracted: ${extracted} files`);
  console.log(`  Errors: ${errors}`);
}

/**
 * List files in DAT archive
 */
function listDAT(inputPath: string): void {
  const datBuffer = fs.readFileSync(inputPath);
  const entries = parseDAT1(datBuffer);

  console.log(`Files in ${inputPath}:\n`);

  for (const entry of entries) {
    const compressed = entry.flags & 0x40 ? 'C' : ' ';
    const ratio = entry.originalSize > 0
      ? Math.round(entry.packedSize / entry.originalSize * 100)
      : 100;

    console.log(
      `${compressed} ${entry.originalSize.toString().padStart(10)} ` +
      `${entry.packedSize.toString().padStart(10)} ` +
      `${ratio.toString().padStart(3)}% ${entry.name}`
    );
  }

  console.log(`\nTotal: ${entries.length} files`);
}

// Main entry point
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage:');
  console.log('  Extract: npx ts-node dat-extractor.ts <input.dat> <output-dir>');
  console.log('  List:    npx ts-node dat-extractor.ts --list <input.dat>');
  process.exit(1);
}

if (args[0] === '--list') {
  if (args.length < 2) {
    console.error('Missing input file');
    process.exit(1);
  }
  listDAT(args[1]!);
} else {
  if (args.length < 2) {
    console.error('Missing output directory');
    process.exit(1);
  }
  extractDAT(args[0]!, args[1]!).catch(console.error);
}
