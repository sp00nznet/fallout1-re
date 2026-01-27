interface Participant {
  id: string;
  tileIndex: number;
  currentHp: number;
  currentAp: number;
}

interface GameState {
  currentMap: string;
  participants: Participant[];
}

interface ExplorationAction {
  type: 'move' | 'wait' | 'interact';
  targetTile?: number;
  objectId?: string;
}

export class ExplorationAI {
  private skillLevel: number;
  private visitedTiles: Set<number> = new Set();
  private explorationTarget: number | null = null;

  constructor(skillLevel: number = 0.5) {
    this.skillLevel = skillLevel;
  }

  decideAction(self: Participant, game: GameState): ExplorationAction {
    // Mark current tile as visited
    this.visitedTiles.add(self.tileIndex);

    // If we have an exploration target, continue towards it
    if (this.explorationTarget !== null) {
      if (self.tileIndex === this.explorationTarget) {
        this.explorationTarget = null;
      } else {
        return {
          type: 'move',
          targetTile: this.getNextTileTowards(self.tileIndex, this.explorationTarget)
        };
      }
    }

    // Pick a new exploration target
    this.explorationTarget = this.pickExplorationTarget(self.tileIndex);

    if (this.explorationTarget !== null) {
      return {
        type: 'move',
        targetTile: this.getNextTileTowards(self.tileIndex, this.explorationTarget)
      };
    }

    // No target, wander randomly
    return {
      type: 'move',
      targetTile: this.getRandomAdjacentTile(self.tileIndex)
    };
  }

  private pickExplorationTarget(currentTile: number): number | null {
    const GRID_WIDTH = 200;
    const GRID_HEIGHT = 200;

    // Find unvisited areas
    // Divide map into sectors and find least visited sector
    const sectorSize = 20;
    const sectors: Map<string, number> = new Map();

    for (let y = 0; y < GRID_HEIGHT; y += sectorSize) {
      for (let x = 0; x < GRID_WIDTH; x += sectorSize) {
        const sectorKey = `${x},${y}`;
        let visitedCount = 0;

        for (let sy = 0; sy < sectorSize && y + sy < GRID_HEIGHT; sy++) {
          for (let sx = 0; sx < sectorSize && x + sx < GRID_WIDTH; sx++) {
            const tile = (y + sy) * GRID_WIDTH + (x + sx);
            if (this.visitedTiles.has(tile)) {
              visitedCount++;
            }
          }
        }

        sectors.set(sectorKey, visitedCount);
      }
    }

    // Find least visited sector
    let leastVisited: string | null = null;
    let leastCount = Infinity;

    sectors.forEach((count, key) => {
      if (count < leastCount) {
        leastCount = count;
        leastVisited = key;
      }
    });

    if (leastVisited) {
      const [x, y] = leastVisited.split(',').map(Number);
      // Pick center of sector
      return (y + Math.floor(sectorSize / 2)) * GRID_WIDTH + (x + Math.floor(sectorSize / 2));
    }

    return null;
  }

  private getNextTileTowards(from: number, to: number): number {
    const GRID_WIDTH = 200;
    const x1 = from % GRID_WIDTH;
    const y1 = Math.floor(from / GRID_WIDTH);
    const x2 = to % GRID_WIDTH;
    const y2 = Math.floor(to / GRID_WIDTH);

    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);

    // Clamp to bounds
    const newX = Math.max(0, Math.min(GRID_WIDTH - 1, x1 + dx));
    const newY = Math.max(0, Math.min(GRID_WIDTH - 1, y1 + dy));

    return newY * GRID_WIDTH + newX;
  }

  private getRandomAdjacentTile(from: number): number {
    const GRID_WIDTH = 200;
    const x = from % GRID_WIDTH;
    const y = Math.floor(from / GRID_WIDTH);

    // Random direction
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1]
    ];

    const [dx, dy] = directions[Math.floor(Math.random() * directions.length)];

    const newX = Math.max(0, Math.min(GRID_WIDTH - 1, x + dx));
    const newY = Math.max(0, Math.min(GRID_WIDTH - 1, y + dy));

    return newY * GRID_WIDTH + newX;
  }

  // Call this when bot joins a new game to reset exploration state
  reset(): void {
    this.visitedTiles.clear();
    this.explorationTarget = null;
  }
}
