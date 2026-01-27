/**
 * Text Rendering System - Port of plib/gnw/text.c
 * Handles bitmap font rendering
 */

export interface FontGlyph {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  advance: number;
  pixels: Uint8Array;
}

export interface Font {
  name: string;
  height: number;
  baseLine: number;
  glyphs: Map<number, FontGlyph>;
  defaultGlyph: FontGlyph;
}

export const enum TextFlags {
  None = 0,
  Monospace = 0x01,
  RightAlign = 0x02,
  CenterAlign = 0x04,
  WordWrap = 0x08,
  NoBackground = 0x10,
  Underline = 0x20
}

/**
 * Text renderer using bitmap fonts
 */
export class TextRenderer {
  private fonts: Map<string, Font> = new Map();
  private currentFont: Font | null = null;

  /**
   * Load a font from FON file data
   * Fallout uses a simple bitmap font format
   */
  loadFont(name: string, data: ArrayBuffer): boolean {
    const view = new DataView(data);
    let offset = 0;

    // FON header
    const numGlyphs = view.getUint32(offset, true);
    offset += 4;

    const height = view.getUint32(offset, true);
    offset += 4;

    const spacing = view.getUint32(offset, true);
    offset += 4;

    const font: Font = {
      name,
      height,
      baseLine: height - 2,
      glyphs: new Map(),
      defaultGlyph: {
        width: spacing,
        height,
        xOffset: 0,
        yOffset: 0,
        advance: spacing,
        pixels: new Uint8Array(spacing * height)
      }
    };

    // Read glyph info
    const glyphInfo: Array<{ width: number; offset: number }> = [];
    for (let i = 0; i < numGlyphs; i++) {
      const width = view.getUint16(offset, true);
      offset += 2;
      const dataOffset = view.getUint32(offset, true);
      offset += 4;
      glyphInfo.push({ width, offset: dataOffset });
    }

    // Read glyph data
    for (let i = 0; i < numGlyphs; i++) {
      const info = glyphInfo[i]!;
      const charCode = i + 32; // ASCII offset

      if (info.width === 0) continue;

      const pixels = new Uint8Array(info.width * height);

      // Read pixel data (1 byte per pixel row, packed)
      let dataOffset = info.offset;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < info.width; x++) {
          const byteIdx = Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          const byte = view.getUint8(dataOffset + byteIdx);
          pixels[y * info.width + x] = (byte & (1 << bitIdx)) ? 1 : 0;
        }
        dataOffset += Math.ceil(info.width / 8);
      }

      const glyph: FontGlyph = {
        width: info.width,
        height,
        xOffset: 0,
        yOffset: 0,
        advance: info.width + 1,
        pixels
      };

      font.glyphs.set(charCode, glyph);
    }

    this.fonts.set(name, font);

    if (!this.currentFont) {
      this.currentFont = font;
    }

    return true;
  }

  /**
   * Create a simple built-in font
   */
  createDefaultFont(): void {
    const height = 8;
    const font: Font = {
      name: 'default',
      height,
      baseLine: 6,
      glyphs: new Map(),
      defaultGlyph: {
        width: 6,
        height,
        xOffset: 0,
        yOffset: 0,
        advance: 6,
        pixels: new Uint8Array(6 * height)
      }
    };

    // Create simple glyphs for basic characters
    // This is a minimal 6x8 font
    const charData: Record<string, string[]> = {
      ' ': ['......', '......', '......', '......', '......', '......', '......', '......'],
      'A': ['..##..', '.#..#.', '#....#', '######', '#....#', '#....#', '#....#', '......'],
      'B': ['#####.', '#....#', '#####.', '#....#', '#....#', '#....#', '#####.', '......'],
      'C': ['.####.', '#....#', '#.....', '#.....', '#.....', '#....#', '.####.', '......'],
      'D': ['####..', '#...#.', '#....#', '#....#', '#....#', '#...#.', '####..', '......'],
      'E': ['######', '#.....', '#####.', '#.....', '#.....', '#.....', '######', '......'],
      'F': ['######', '#.....', '#####.', '#.....', '#.....', '#.....', '#.....', '......'],
      // Add more characters as needed...
      '0': ['.####.', '#....#', '#...##', '#..#.#', '#.#..#', '##...#', '.####.', '......'],
      '1': ['..#...', '.##...', '..#...', '..#...', '..#...', '..#...', '.###..', '......'],
      '!': ['..#...', '..#...', '..#...', '..#...', '..#...', '......', '..#...', '......'],
      '.': ['......', '......', '......', '......', '......', '..##..', '..##..', '......'],
      ',': ['......', '......', '......', '......', '..##..', '..#...', '.#....', '......'],
      ':': ['......', '..##..', '..##..', '......', '..##..', '..##..', '......', '......'],
      '-': ['......', '......', '......', '#####.', '......', '......', '......', '......'],
    };

    for (const [char, rows] of Object.entries(charData)) {
      const charCode = char.charCodeAt(0);
      const width = rows[0]!.length;
      const pixels = new Uint8Array(width * height);

      for (let y = 0; y < height; y++) {
        const row = rows[y] ?? '';
        for (let x = 0; x < width; x++) {
          pixels[y * width + x] = row[x] === '#' ? 1 : 0;
        }
      }

      font.glyphs.set(charCode, {
        width,
        height,
        xOffset: 0,
        yOffset: 0,
        advance: width + 1,
        pixels
      });
    }

    this.fonts.set('default', font);
    this.currentFont = font;
  }

  /**
   * Set current font
   */
  setFont(name: string): boolean {
    const font = this.fonts.get(name);
    if (font) {
      this.currentFont = font;
      return true;
    }
    return false;
  }

  /**
   * Get font height
   */
  getFontHeight(): number {
    return this.currentFont?.height ?? 8;
  }

  /**
   * Measure text width
   */
  measureText(text: string, flags: number = TextFlags.None): number {
    if (!this.currentFont) return 0;

    let width = 0;
    const isMonospace = (flags & TextFlags.Monospace) !== 0;
    const defaultWidth = this.currentFont.defaultGlyph.advance;

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const glyph = this.currentFont.glyphs.get(charCode) ?? this.currentFont.defaultGlyph;

      if (isMonospace) {
        width += defaultWidth;
      } else {
        width += glyph.advance;
      }
    }

    return width;
  }

  /**
   * Draw text to a buffer
   */
  drawText(
    buffer: Uint8Array,
    bufferWidth: number,
    bufferHeight: number,
    text: string,
    x: number,
    y: number,
    color: number,
    flags: number = TextFlags.None,
    maxWidth?: number
  ): void {
    if (!this.currentFont) return;

    const isMonospace = (flags & TextFlags.Monospace) !== 0;
    const noBackground = (flags & TextFlags.NoBackground) !== 0;
    const defaultWidth = this.currentFont.defaultGlyph.advance;

    // Handle alignment
    let startX = x;
    if (flags & TextFlags.RightAlign) {
      startX = x - this.measureText(text, flags);
    } else if (flags & TextFlags.CenterAlign) {
      startX = x - Math.floor(this.measureText(text, flags) / 2);
    }

    let cursorX = startX;

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const glyph: FontGlyph = this.currentFont.glyphs.get(charCode) ?? this.currentFont.defaultGlyph;

      const advance = isMonospace ? defaultWidth : glyph.advance;

      // Check if we'd exceed maxWidth
      if (maxWidth !== undefined && cursorX + advance > x + maxWidth) {
        break;
      }

      // Draw glyph
      for (let gy = 0; gy < glyph.height; gy++) {
        const py: number = y + gy + glyph.yOffset;
        if (py < 0 || py >= bufferHeight) continue;

        for (let gx = 0; gx < glyph.width; gx++) {
          const px: number = cursorX + gx + glyph.xOffset;
          if (px < 0 || px >= bufferWidth) continue;

          const glyphPixel = glyph.pixels[gy * glyph.width + gx];
          if (glyphPixel || !noBackground) {
            const destIdx = py * bufferWidth + px;
            if (glyphPixel) {
              buffer[destIdx] = color;
            }
          }
        }
      }

      cursorX += advance;
    }

    // Draw underline
    if (flags & TextFlags.Underline) {
      const underlineY = y + this.currentFont.height - 1;
      if (underlineY >= 0 && underlineY < bufferHeight) {
        const endX = cursorX;
        for (let px = startX; px < endX && px < bufferWidth; px++) {
          if (px >= 0) {
            buffer[underlineY * bufferWidth + px] = color;
          }
        }
      }
    }
  }

  /**
   * Draw text with word wrap
   */
  drawTextWrapped(
    buffer: Uint8Array,
    bufferWidth: number,
    bufferHeight: number,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    color: number,
    flags: number = TextFlags.None
  ): number {
    if (!this.currentFont) return 0;

    const words = text.split(' ');
    let cursorX = x;
    let cursorY = y;
    const lineHeight = this.currentFont.height + 2;
    let linesDrawn = 0;

    for (const word of words) {
      const wordWidth = this.measureText(word, flags);
      const spaceWidth = this.measureText(' ', flags);

      // Check if word fits on current line
      if (cursorX + wordWidth > x + maxWidth && cursorX > x) {
        // Move to next line
        cursorX = x;
        cursorY += lineHeight;
        linesDrawn++;
      }

      // Check if we've exceeded vertical space
      if (cursorY + this.currentFont.height > bufferHeight) {
        break;
      }

      // Draw word
      this.drawText(buffer, bufferWidth, bufferHeight, word, cursorX, cursorY, color, flags);
      cursorX += wordWidth + spaceWidth;
    }

    return linesDrawn + 1;
  }

  /**
   * Get font by name
   */
  getFont(name: string): Font | undefined {
    return this.fonts.get(name);
  }

  /**
   * Get current font
   */
  getCurrentFont(): Font | null {
    return this.currentFont;
  }
}

/**
 * Global text renderer instance
 */
let globalTextRenderer: TextRenderer | null = null;

export function getTextRenderer(): TextRenderer {
  if (!globalTextRenderer) {
    globalTextRenderer = new TextRenderer();
    globalTextRenderer.createDefaultFont();
  }
  return globalTextRenderer;
}
