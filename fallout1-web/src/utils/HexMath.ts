/**
 * Hexagonal grid math utilities
 * Based on the tile.c implementation from the original game
 *
 * Fallout uses a flat-topped hexagonal grid with pointy sides
 * The grid is 200x200 tiles per elevation, with 3 elevations
 */

export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 200;
export const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;
export const ELEVATION_COUNT = 3;

// Hex tile dimensions in pixels
export const HEX_WIDTH = 32;
export const HEX_HEIGHT = 16;
export const HEX_HALF_WIDTH = HEX_WIDTH / 2;
export const HEX_HALF_HEIGHT = HEX_HEIGHT / 2;

// Direction constants (matching original game)
export const enum Direction {
  NE = 0,
  E = 1,
  SE = 2,
  SW = 3,
  W = 4,
  NW = 5
}

// Direction offsets for tile calculations
// First index: 0 = x offset, 1 = y offset
// Second index: direction (0-5)
export const DIR_TILE_OFFSETS: readonly [readonly number[], readonly number[]] = [
  [16, 32, 16, -16, -32, -16],   // x offsets
  [-12, 0, 12, 12, 0, -12]       // y offsets
] as const;

// Tile number offsets for each direction
// Based on the 200-wide grid
export const DIR_TILE: readonly [readonly number[], readonly number[]] = [
  [1, 199, 200, -1, -199, -200], // even row
  [1, 200, 201, -1, -200, -199]  // odd row
] as const;

/**
 * Check if a tile number is valid
 */
export function isValidTile(tile: number): boolean {
  return tile >= 0 && tile < GRID_SIZE;
}

/**
 * Convert tile number to grid x/y coordinates
 */
export function tileToCoords(tile: number): { x: number; y: number } {
  return {
    x: tile % GRID_WIDTH,
    y: Math.floor(tile / GRID_WIDTH)
  };
}

/**
 * Convert grid x/y coordinates to tile number
 */
export function coordsToTile(x: number, y: number): number {
  return y * GRID_WIDTH + x;
}

/**
 * Get the tile adjacent in a given direction
 */
export function getTileInDirection(tile: number, direction: Direction): number {
  if (!isValidTile(tile)) return -1;

  const coords = tileToCoords(tile);
  const parity = coords.y & 1; // 0 for even row, 1 for odd row
  const offset = DIR_TILE[parity]![direction]!;
  const newTile = tile + offset;

  return isValidTile(newTile) ? newTile : -1;
}

/**
 * Convert tile to screen pixel coordinates
 * Returns the center of the tile
 */
export function tileToScreen(tile: number, screenCenterTile: number): { x: number; y: number } {
  const tileCoords = tileToCoords(tile);
  const centerCoords = tileToCoords(screenCenterTile);

  const dx = tileCoords.x - centerCoords.x;
  const dy = tileCoords.y - centerCoords.y;

  // Hex grid layout calculation
  const screenX = dx * HEX_WIDTH + (tileCoords.y & 1) * HEX_HALF_WIDTH;
  const screenY = dy * HEX_HALF_HEIGHT * 3;

  return { x: screenX, y: screenY };
}

/**
 * Convert screen pixel coordinates to tile number
 */
export function screenToTile(screenX: number, screenY: number, screenCenterTile: number): number {
  const centerCoords = tileToCoords(screenCenterTile);

  // Approximate grid position
  const approxY = Math.floor(screenY / (HEX_HALF_HEIGHT * 3)) + centerCoords.y;
  const parity = approxY & 1;
  const offsetX = parity * HEX_HALF_WIDTH;
  const approxX = Math.floor((screenX - offsetX) / HEX_WIDTH) + centerCoords.x;

  // TODO: More precise hit-testing within hex boundaries

  if (approxX < 0 || approxX >= GRID_WIDTH || approxY < 0 || approxY >= GRID_HEIGHT) {
    return -1;
  }

  return coordsToTile(approxX, approxY);
}

/**
 * Calculate distance between two tiles (hex distance)
 */
export function tileDistance(tile1: number, tile2: number): number {
  if (!isValidTile(tile1) || !isValidTile(tile2)) return -1;

  const c1 = tileToCoords(tile1);
  const c2 = tileToCoords(tile2);

  // Convert to axial coordinates for hex distance
  const ax1 = c1.x - (c1.y - (c1.y & 1)) / 2;
  const ax2 = c2.x - (c2.y - (c2.y & 1)) / 2;
  const az1 = c1.y;
  const az2 = c2.y;

  const dx = ax2 - ax1;
  const dz = az2 - az1;
  const dy = -dx - dz;

  return (Math.abs(dx) + Math.abs(dy) + Math.abs(dz)) / 2;
}

/**
 * Get the direction from one tile to another
 */
export function tileGetDirection(fromTile: number, toTile: number): Direction {
  const from = tileToCoords(fromTile);
  const to = tileToCoords(toTile);

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Calculate angle and map to direction
  const angle = Math.atan2(dy, dx);
  const deg = angle * 180 / Math.PI;

  // Map angle to direction (0 is E, going counter-clockwise)
  if (deg >= -30 && deg < 30) return Direction.E;
  if (deg >= 30 && deg < 90) return Direction.SE;
  if (deg >= 90 && deg < 150) return Direction.SW;
  if (deg >= 150 || deg < -150) return Direction.W;
  if (deg >= -150 && deg < -90) return Direction.NW;
  return Direction.NE;
}

/**
 * Rotate a direction clockwise
 */
export function rotateClockwise(direction: Direction): Direction {
  return ((direction + 1) % 6) as Direction;
}

/**
 * Rotate a direction counter-clockwise
 */
export function rotateCounterClockwise(direction: Direction): Direction {
  return ((direction + 5) % 6) as Direction;
}

/**
 * Get the opposite direction
 */
export function oppositeDirection(direction: Direction): Direction {
  return ((direction + 3) % 6) as Direction;
}
