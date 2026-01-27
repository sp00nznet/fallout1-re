/**
 * LZSS Decompression
 * Port of plib/db/lzss.c
 *
 * LZSS is used for compression in Fallout's DAT archives
 */

const RING_BUFFER_SIZE = 4096;
const RING_BUFFER_INIT_OFFSET = 4078;
const MIN_MATCH_LENGTH = 3;

/**
 * Decode LZSS compressed data
 * @param input Compressed data
 * @param outputLength Expected decompressed length
 * @returns Decompressed data
 */
export function lzssDecode(input: Uint8Array, outputLength: number): Uint8Array {
  const output = new Uint8Array(outputLength);
  const ringBuffer = new Uint8Array(RING_BUFFER_SIZE);

  // Initialize ring buffer with spaces (0x20)
  ringBuffer.fill(0x20, 0, RING_BUFFER_INIT_OFFSET);

  let ringIndex = RING_BUFFER_INIT_OFFSET;
  let inputPos = 0;
  let outputPos = 0;

  while (outputPos < outputLength && inputPos < input.length) {
    // Read flags byte - each bit indicates literal (1) or reference (0)
    const flags = input[inputPos++]!;

    for (let bit = 0; bit < 8 && outputPos < outputLength; bit++) {
      if (flags & (1 << bit)) {
        // Literal byte
        if (inputPos >= input.length) break;

        const byte = input[inputPos++]!;
        output[outputPos++] = byte;
        ringBuffer[ringIndex] = byte;
        ringIndex = (ringIndex + 1) & 0xFFF;
      } else {
        // Reference to ring buffer
        if (inputPos + 1 >= input.length) break;

        const low = input[inputPos++]!;
        const high = input[inputPos++]!;

        // Decode offset and length
        const offset = low | ((high & 0xF0) << 4);
        const length = (high & 0x0F) + MIN_MATCH_LENGTH;

        // Copy from ring buffer
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
 * Streaming LZSS decoder for large files
 */
export class LZSSDecoder {
  private ringBuffer: Uint8Array;
  private ringIndex: number;

  constructor(_compressedLength: number) {
    this.ringBuffer = new Uint8Array(RING_BUFFER_SIZE);
    this.ringBuffer.fill(0x20, 0, RING_BUFFER_INIT_OFFSET);
    this.ringIndex = RING_BUFFER_INIT_OFFSET;
  }

  /**
   * Decode a chunk of data
   * @param input Input chunk
   * @param output Output buffer
   * @param outputOffset Offset in output buffer
   * @param maxOutput Maximum bytes to output
   * @returns Number of bytes written to output
   */
  decodeChunk(
    input: Uint8Array,
    output: Uint8Array,
    outputOffset: number,
    maxOutput: number
  ): number {
    let inputPos = 0;
    let outputPos = outputOffset;
    const outputEnd = outputOffset + maxOutput;

    while (outputPos < outputEnd && inputPos < input.length) {
      const flags = input[inputPos++]!;

      for (let bit = 0; bit < 8 && outputPos < outputEnd && inputPos < input.length; bit++) {
        if (flags & (1 << bit)) {
          // Literal
          const byte = input[inputPos++]!;
          output[outputPos++] = byte;
          this.ringBuffer[this.ringIndex] = byte;
          this.ringIndex = (this.ringIndex + 1) & 0xFFF;
        } else {
          // Reference
          if (inputPos + 1 >= input.length) break;

          const low = input[inputPos++]!;
          const high = input[inputPos++]!;
          const offset = low | ((high & 0xF0) << 4);
          const length = (high & 0x0F) + MIN_MATCH_LENGTH;

          for (let i = 0; i < length && outputPos < outputEnd; i++) {
            const dictIndex = (offset + i) & 0xFFF;
            const byte = this.ringBuffer[dictIndex]!;
            output[outputPos++] = byte;
            this.ringBuffer[this.ringIndex] = byte;
            this.ringIndex = (this.ringIndex + 1) & 0xFFF;
          }
        }
      }
    }

    return outputPos - outputOffset;
  }
}

/**
 * Encode data with LZSS compression
 * (Primarily for save files or mod tools)
 */
export function lzssEncode(input: Uint8Array): Uint8Array {
  // For now, use a simple implementation
  // A full implementation would use a sliding window for better compression
  const output: number[] = [];
  const ringBuffer = new Uint8Array(RING_BUFFER_SIZE);
  ringBuffer.fill(0x20, 0, RING_BUFFER_INIT_OFFSET);

  let ringIndex = RING_BUFFER_INIT_OFFSET;
  let inputPos = 0;

  while (inputPos < input.length) {
    let flags = 0;
    const flagPos = output.length;
    output.push(0); // Placeholder for flags

    for (let bit = 0; bit < 8 && inputPos < input.length; bit++) {
      // Try to find a match in the ring buffer
      let bestOffset = -1;
      let bestLength = 0;

      // Search for matches (simple implementation)
      for (let searchStart = 0; searchStart < RING_BUFFER_SIZE; searchStart++) {
        let matchLength = 0;
        while (
          matchLength < 18 && // Max match length is 18 (0xF + 3)
          inputPos + matchLength < input.length &&
          ringBuffer[(searchStart + matchLength) & 0xFFF] === input[inputPos + matchLength]
        ) {
          matchLength++;
        }

        if (matchLength >= MIN_MATCH_LENGTH && matchLength > bestLength) {
          bestLength = matchLength;
          bestOffset = searchStart;
        }
      }

      if (bestLength >= MIN_MATCH_LENGTH) {
        // Emit reference
        const low = bestOffset & 0xFF;
        const high = ((bestOffset >> 4) & 0xF0) | ((bestLength - MIN_MATCH_LENGTH) & 0x0F);
        output.push(low);
        output.push(high);

        // Update ring buffer
        for (let i = 0; i < bestLength; i++) {
          ringBuffer[ringIndex] = input[inputPos + i]!;
          ringIndex = (ringIndex + 1) & 0xFFF;
        }
        inputPos += bestLength;
      } else {
        // Emit literal
        flags |= (1 << bit);
        const byte = input[inputPos++]!;
        output.push(byte);
        ringBuffer[ringIndex] = byte;
        ringIndex = (ringIndex + 1) & 0xFFF;
      }
    }

    output[flagPos] = flags;
  }

  return new Uint8Array(output);
}
