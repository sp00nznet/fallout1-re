/**
 * 256-color palette management
 * Port of plib/color/color.c
 *
 * Fallout uses 6-bit color values (0-63) which need to be converted to 8-bit (0-255)
 * for modern displays.
 */

export const PALETTE_SIZE = 256;
export const PALETTE_BYTES = PALETTE_SIZE * 3; // RGB triplets

/**
 * Color table for fast 15-bit RGB to palette index lookup
 * 32768 entries (5 bits per channel)
 */
export type ColorTable = Uint8Array;

/**
 * Intensity table for lighting calculations
 * 256x256 lookup for palette-to-palette intensity mapping
 */
export type IntensityTable = Uint8Array[];

/**
 * Palette manager handles color management for 8-bit indexed graphics
 */
export class Palette {
  /** Current color map (256 RGB triplets, 6-bit values) */
  private cmap: Uint8Array = new Uint8Array(PALETTE_BYTES);

  /** System palette with gamma correction applied */
  private systemCmap: Uint8Array = new Uint8Array(PALETTE_BYTES);

  /** Gamma correction lookup table (64 entries for 6-bit values) */
  private gammaTable: Uint8Array = new Uint8Array(64);

  /** Current gamma value */
  private gamma: number = 1.0;

  /** Which palette entries are mapped/valid */
  private mappedColor: Uint8Array = new Uint8Array(PALETTE_SIZE);

  /** 15-bit RGB to palette index lookup */
  private colorTable: ColorTable = new Uint8Array(32768);

  /** Intensity color table for lighting */
  private intensityTable: IntensityTable;

  /** Color mix addition table */
  private colorMixAddTable: Uint8Array[];

  /** Color mix multiplication table */
  private colorMixMulTable: Uint8Array[];

  /** Blend tables for alpha blending effects */
  private blendTables: Map<number, Uint8Array> = new Map();

  /** Palette stack for save/restore */
  private paletteStack: Array<{ cmap: Uint8Array; mappedColor: Uint8Array; colorTable: Uint8Array }> = [];

  /** Callback for when palette changes */
  private onPaletteChange?: () => void;

  constructor() {
    // Initialize intensity and mix tables
    this.intensityTable = new Array(PALETTE_SIZE);
    this.colorMixAddTable = new Array(PALETTE_SIZE);
    this.colorMixMulTable = new Array(PALETTE_SIZE);

    for (let i = 0; i < PALETTE_SIZE; i++) {
      this.intensityTable[i] = new Uint8Array(PALETTE_SIZE);
      this.colorMixAddTable[i] = new Uint8Array(PALETTE_SIZE);
      this.colorMixMulTable[i] = new Uint8Array(PALETTE_SIZE);
    }

    // Initialize gamma table to identity
    this.setGamma(1.0);

    // Initialize with a grayscale palette
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const value = Math.floor(i * 63 / 255);
      this.cmap[i * 3] = value;
      this.cmap[i * 3 + 1] = value;
      this.cmap[i * 3 + 2] = value;
      this.mappedColor[i] = 1;
    }
  }

  /**
   * Load a color table file (color.pal)
   */
  async loadColorTable(data: ArrayBuffer): Promise<boolean> {
    const bytes = new Uint8Array(data);
    let offset = 0;

    // Read 256 RGB triplets
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const r = bytes[offset++]!;
      const g = bytes[offset++]!;
      const b = bytes[offset++]!;

      if (r <= 0x3F && g <= 0x3F && b <= 0x3F) {
        this.mappedColor[i] = 1;
        this.cmap[i * 3] = r;
        this.cmap[i * 3 + 1] = g;
        this.cmap[i * 3 + 2] = b;
      } else {
        this.mappedColor[i] = 0;
        this.cmap[i * 3] = 0;
        this.cmap[i * 3 + 1] = 0;
        this.cmap[i * 3 + 2] = 0;
      }
    }

    // Read color table (32768 bytes)
    for (let i = 0; i < 32768; i++) {
      this.colorTable[i] = bytes[offset++]!;
    }

    // Check for "NEWC" marker indicating pre-computed tables
    const marker = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) |
                   ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24);
    offset += 4;

    if (marker === 0x4E455743) { // "NEWC"
      // Read pre-computed tables
      for (let i = 0; i < PALETTE_SIZE; i++) {
        for (let j = 0; j < PALETTE_SIZE; j++) {
          this.intensityTable[i]![j] = bytes[offset++]!;
        }
      }
      for (let i = 0; i < PALETTE_SIZE; i++) {
        for (let j = 0; j < PALETTE_SIZE; j++) {
          this.colorMixAddTable[i]![j] = bytes[offset++]!;
        }
      }
      for (let i = 0; i < PALETTE_SIZE; i++) {
        for (let j = 0; j < PALETTE_SIZE; j++) {
          this.colorMixMulTable[i]![j] = bytes[offset++]!;
        }
      }
    } else {
      // Compute tables
      this.buildIntensityTables();
      this.buildMixTables();
    }

    this.applyGamma();
    return true;
  }

  /**
   * Set the palette from raw RGB data (6-bit values)
   */
  setPalette(palette: Uint8Array): void {
    this.cmap.set(palette.subarray(0, PALETTE_BYTES));
    this.mappedColor.fill(1);
    this.applyGamma();
    this.onPaletteChange?.();
  }

  /**
   * Get the current palette (6-bit values)
   */
  getPalette(): Uint8Array {
    return new Uint8Array(this.cmap);
  }

  /**
   * Get the system palette with gamma applied (6-bit values)
   */
  getSystemPalette(): Uint8Array {
    return new Uint8Array(this.systemCmap);
  }

  /**
   * Set a single palette entry
   */
  setEntry(index: number, r: number, g: number, b: number): void {
    const base = index * 3;
    this.cmap[base] = r & 0x3F;
    this.cmap[base + 1] = g & 0x3F;
    this.cmap[base + 2] = b & 0x3F;
    this.applyGammaEntry(index);
    this.onPaletteChange?.();
  }

  /**
   * Get a single palette entry
   */
  getEntry(index: number): { r: number; g: number; b: number } {
    const base = index * 3;
    return {
      r: this.cmap[base]!,
      g: this.cmap[base + 1]!,
      b: this.cmap[base + 2]!
    };
  }

  /**
   * Set gamma correction (1.0 = no correction)
   */
  setGamma(gamma: number): void {
    this.gamma = gamma;
    for (let i = 0; i < 64; i++) {
      const value = Math.pow(i, gamma);
      this.gammaTable[i] = Math.max(0, Math.min(63, Math.round(value)));
    }
    this.applyGamma();
    this.onPaletteChange?.();
  }

  /**
   * Get current gamma value
   */
  getGamma(): number {
    return this.gamma;
  }

  /**
   * Convert palette index to RGBA for Canvas rendering
   * Returns values in 0-255 range
   */
  indexToRGBA(index: number): { r: number; g: number; b: number; a: number } {
    const base = index * 3;
    return {
      r: this.systemCmap[base]! << 2,      // 6-bit to 8-bit
      g: this.systemCmap[base + 1]! << 2,
      b: this.systemCmap[base + 2]! << 2,
      a: 255
    };
  }

  /**
   * Convert 15-bit RGB to palette index
   */
  rgbToIndex(rgb: number): number {
    return this.colorTable[rgb & 0x7FFF]!;
  }

  /**
   * Convert palette index to 15-bit RGB
   */
  indexToRGB(index: number): number {
    const base = index * 3;
    const r = this.cmap[base]! >> 1;      // 6-bit to 5-bit
    const g = this.cmap[base + 1]! >> 1;
    const b = this.cmap[base + 2]! >> 1;
    return (r << 10) | (g << 5) | b;
  }

  /**
   * Mix two colors additively (for light effects)
   */
  colorMixAdd(a: number, b: number): number {
    return this.colorMixAddTable[a]![b]!;
  }

  /**
   * Mix two colors multiplicatively (for shadow effects)
   */
  colorMixMul(a: number, b: number): number {
    return this.colorMixMulTable[a]![b]!;
  }

  /**
   * Calculate color with intensity adjustment
   */
  calculateColor(intensity: number, colorIndex: number): number {
    const intensityIndex = intensity >> 9; // Map to 0-255 range
    return this.intensityTable[colorIndex]![intensityIndex]!;
  }

  /**
   * Get or create a blend table for a specific color
   */
  getBlendTable(colorIndex: number): Uint8Array {
    let table = this.blendTables.get(colorIndex);
    if (!table) {
      table = this.buildBlendTable(colorIndex);
      this.blendTables.set(colorIndex, table);
    }
    return table;
  }

  /**
   * Free a blend table to release memory
   */
  freeBlendTable(colorIndex: number): void {
    this.blendTables.delete(colorIndex);
  }

  /**
   * Push current palette onto stack
   */
  push(): boolean {
    this.paletteStack.push({
      cmap: new Uint8Array(this.cmap),
      mappedColor: new Uint8Array(this.mappedColor),
      colorTable: new Uint8Array(this.colorTable)
    });
    return true;
  }

  /**
   * Pop palette from stack
   */
  pop(): boolean {
    const entry = this.paletteStack.pop();
    if (!entry) return false;

    this.cmap.set(entry.cmap);
    this.mappedColor.set(entry.mappedColor);
    this.colorTable.set(entry.colorTable);

    this.buildIntensityTables();
    this.buildMixTables();
    this.rebuildBlendTables();
    this.applyGamma();
    this.onPaletteChange?.();

    return true;
  }

  /**
   * Perform animated palette transition
   */
  async fade(
    oldPalette: Uint8Array,
    newPalette: Uint8Array,
    steps: number,
    applyCallback: (palette: Uint8Array) => void
  ): Promise<void> {
    const tempPalette = new Uint8Array(PALETTE_BYTES);

    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < PALETTE_BYTES; i++) {
        tempPalette[i] = oldPalette[i]! - Math.floor(
          (oldPalette[i]! - newPalette[i]!) * step / steps
        );
      }
      applyCallback(tempPalette);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }

    applyCallback(newPalette);
  }

  /**
   * Set callback for palette changes
   */
  setChangeCallback(callback: () => void): void {
    this.onPaletteChange = callback;
  }

  /**
   * Build RGBA palette for Canvas ImageData
   * Returns a Uint32Array for efficient pixel operations
   */
  buildRGBAPalette(): Uint32Array {
    const rgba = new Uint32Array(PALETTE_SIZE);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const base = i * 3;
      const r = this.systemCmap[base]! << 2;
      const g = this.systemCmap[base + 1]! << 2;
      const b = this.systemCmap[base + 2]! << 2;
      // Pack as ABGR for little-endian systems (Canvas ImageData format)
      rgba[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }
    return rgba;
  }

  // Private methods

  private applyGamma(): void {
    for (let i = 0; i < PALETTE_BYTES; i++) {
      this.systemCmap[i] = this.gammaTable[this.cmap[i]!]!;
    }
  }

  private applyGammaEntry(index: number): void {
    const base = index * 3;
    this.systemCmap[base] = this.gammaTable[this.cmap[base]!]!;
    this.systemCmap[base + 1] = this.gammaTable[this.cmap[base + 1]!]!;
    this.systemCmap[base + 2] = this.gammaTable[this.cmap[base + 2]!]!;
  }

  private buildIntensityTables(): void {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      if (this.mappedColor[i]) {
        this.buildIntensityTableColor(i);
      } else {
        this.intensityTable[i]!.fill(0);
      }
    }
  }

  private buildIntensityTableColor(colorIndex: number): void {
    const rgb = this.indexToRGB(colorIndex);
    const r = (rgb & 0x7C00) >> 10;
    const g = (rgb & 0x3E0) >> 5;
    const b = rgb & 0x1F;

    let intensity = 0;
    for (let i = 0; i < 128; i++) {
      // Darker shades (0-127)
      const dr = (r * intensity) >> 16;
      const dg = (g * intensity) >> 16;
      const db = (b * intensity) >> 16;
      const darkIdx = (dr << 10) | (dg << 5) | db;
      this.intensityTable[colorIndex]![i] = this.colorTable[darkIdx]!;

      // Lighter shades (128-255)
      const lr = r + (((0x1F - r) * intensity) >> 16);
      const lg = g + (((0x1F - g) * intensity) >> 16);
      const lb = b + (((0x1F - b) * intensity) >> 16);
      const lightIdx = (lr << 10) | (lg << 5) | lb;
      this.intensityTable[colorIndex]![0x7F + i + 1] = this.colorTable[lightIdx]!;

      intensity += 0x200;
    }
  }

  private buildMixTables(): void {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      this.buildMixTableColor(i);
    }
  }

  private buildMixTableColor(a: number): void {
    for (let b = 0; b < PALETTE_SIZE; b++) {
      if (this.mappedColor[a] && this.mappedColor[b]) {
        const rgbA = this.indexToRGB(a);
        const rgbB = this.indexToRGB(b);

        const rA = (rgbA & 0x7C00) >> 10;
        const gA = (rgbA & 0x3E0) >> 5;
        const bA = rgbA & 0x1F;

        const rB = (rgbB & 0x7C00) >> 10;
        const gB = (rgbB & 0x3E0) >> 5;
        const bB = rgbB & 0x1F;

        // Additive mix
        let rSum = rA + rB;
        let gSum = gA + gB;
        let bSum = bA + bB;

        const maxSum = Math.max(rSum, gSum, bSum);
        if (maxSum <= 0x1F) {
          const idx = (rSum << 10) | (gSum << 5) | bSum;
          this.colorMixAddTable[a]![b] = this.colorTable[idx]!;
        } else {
          const overflow = maxSum - 0x1F;
          rSum = Math.max(0, rSum - overflow);
          gSum = Math.max(0, gSum - overflow);
          bSum = Math.max(0, bSum - overflow);
          const idx = (rSum << 10) | (gSum << 5) | bSum;
          const baseColor = this.colorTable[idx]!;
          const intensity = Math.floor(((maxSum - 31) * 0.0078125 + 1.0) * 65536);
          this.colorMixAddTable[a]![b] = this.calculateColor(intensity, baseColor);
        }

        // Multiplicative mix
        const rMul = (rA * rB) >> 5;
        const gMul = (gA * gB) >> 5;
        const bMul = (bA * bB) >> 5;
        const mulIdx = (rMul << 10) | (gMul << 5) | bMul;
        this.colorMixMulTable[a]![b] = this.colorTable[mulIdx]!;
      } else {
        if (this.mappedColor[b]) {
          this.colorMixAddTable[a]![b] = b;
          this.colorMixMulTable[a]![b] = b;
        } else {
          this.colorMixAddTable[a]![b] = a;
          this.colorMixMulTable[a]![b] = a;
        }
      }
    }
  }

  private buildBlendTable(colorIndex: number): Uint8Array {
    const table = new Uint8Array(256 * 14);
    const rgb = this.indexToRGB(colorIndex);
    const r = (rgb & 0x7C00) >> 10;
    const g = (rgb & 0x3E0) >> 5;
    const b = rgb & 0x1F;

    // First 256 bytes: identity mapping
    for (let i = 0; i < 256; i++) {
      table[i] = i;
    }

    // Blend levels 1-7
    let offset = 256;
    for (let level = 6; level >= 0; level--) {
      for (let i = 0; i < 256; i++) {
        const srcRGB = this.indexToRGB(i);
        const srcR = (srcRGB & 0x7C00) >> 10;
        const srcG = (srcRGB & 0x3E0) >> 5;
        const srcB = srcRGB & 0x1F;

        const blendR = Math.floor((r * (7 - level) + srcR * level) / 7);
        const blendG = Math.floor((g * (7 - level) + srcG * level) / 7);
        const blendB = Math.floor((b * (7 - level) + srcB * level) / 7);

        const idx = (blendR << 10) | (blendG << 5) | blendB;
        table[offset + i] = this.colorTable[idx]!;
      }
      offset += 256;
    }

    // Intensity levels for glow effects
    for (let level = 0; level < 6; level++) {
      const intensity = Math.floor((level / 7 + 1) * 65535);
      for (let i = 0; i < 256; i++) {
        table[offset + i] = this.calculateColor(intensity, colorIndex);
      }
      offset += 256;
    }

    return table;
  }

  private rebuildBlendTables(): void {
    for (const [colorIndex] of this.blendTables) {
      this.blendTables.set(colorIndex, this.buildBlendTable(colorIndex));
    }
  }
}
