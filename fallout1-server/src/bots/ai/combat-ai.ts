interface Participant {
  id: string;
  tileIndex: number;
  currentHp: number;
  currentAp: number;
  character?: {
    maxHp: number;
    maxAp: number;
    strength: number;
    perception: number;
    agility: number;
    luck: number;
  };
}

interface CombatAction {
  type: 'attack' | 'heal' | 'move' | 'end-turn';
  targetId?: string;
  targetTile?: number;
  priority: number;
}

export class CombatAI {
  private aggressiveness: number; // 0-1
  private skillLevel: number; // 0-1

  constructor(aggressiveness: number = 0.5, skillLevel: number = 0.5) {
    this.aggressiveness = aggressiveness;
    this.skillLevel = skillLevel;
  }

  decideAction(self: Participant, enemies: Participant[]): CombatAction {
    const possibleActions: CombatAction[] = [];

    // Check HP - if low, prioritize healing
    const hpPercent = self.currentHp / (self.character?.maxHp || 30);
    const healThreshold = 0.3 + (1 - this.aggressiveness) * 0.2; // More defensive = heal earlier

    if (hpPercent < healThreshold && self.currentAp >= 2) {
      possibleActions.push({
        type: 'heal',
        priority: (1 - hpPercent) * 100 + (1 - this.aggressiveness) * 20
      });
    }

    // Evaluate attack options
    if (self.currentAp >= 4 && enemies.length > 0) {
      for (const enemy of enemies) {
        const distance = this.calculateDistance(self.tileIndex, enemy.tileIndex);
        const hitChance = this.estimateHitChance(self, enemy, distance);
        const expectedDamage = this.estimateDamage(self);

        // Score = hit chance × expected damage × aggressiveness modifier
        const attackScore = hitChance * expectedDamage * (0.5 + this.aggressiveness * 0.5);

        // Prefer weaker targets (finish them off)
        const targetHpFactor = 1 + (1 - enemy.currentHp / (enemy.character?.maxHp || 30)) * 0.3;

        possibleActions.push({
          type: 'attack',
          targetId: enemy.id,
          priority: attackScore * targetHpFactor
        });
      }
    }

    // Consider movement for better positioning
    if (self.currentAp >= 1 && enemies.length > 0) {
      const movementAction = this.evaluateMovement(self, enemies);
      if (movementAction) {
        possibleActions.push(movementAction);
      }
    }

    // Always have end turn as fallback
    possibleActions.push({
      type: 'end-turn',
      priority: -1
    });

    // Sort by priority and pick best action
    possibleActions.sort((a, b) => b.priority - a.priority);

    // Add some randomness based on skill level
    // Higher skill = more likely to pick optimal choice
    if (this.skillLevel < 0.9 && possibleActions.length > 1) {
      const randomFactor = Math.random();
      if (randomFactor > this.skillLevel) {
        // Pick a suboptimal choice
        const index = Math.min(
          Math.floor(Math.random() * Math.min(3, possibleActions.length)),
          possibleActions.length - 1
        );
        return possibleActions[index];
      }
    }

    return possibleActions[0];
  }

  private calculateDistance(tile1: number, tile2: number): number {
    const GRID_WIDTH = 200;
    const x1 = tile1 % GRID_WIDTH;
    const y1 = Math.floor(tile1 / GRID_WIDTH);
    const x2 = tile2 % GRID_WIDTH;
    const y2 = Math.floor(tile2 / GRID_WIDTH);

    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  }

  private estimateHitChance(attacker: Participant, target: Participant, distance: number): number {
    // Base chance from perception
    let chance = 50 + (attacker.character?.perception || 5) * 2;

    // Distance penalty
    chance -= distance * 4;

    // Target agility
    chance -= (target.character?.agility || 5);

    return Math.max(5, Math.min(95, chance)) / 100;
  }

  private estimateDamage(attacker: Participant): number {
    // Base damage from strength
    return 10 + (attacker.character?.strength || 5);
  }

  private evaluateMovement(self: Participant, enemies: Participant[]): CombatAction | null {
    // Find closest enemy
    let closestEnemy: Participant | null = null;
    let closestDistance = Infinity;

    for (const enemy of enemies) {
      const dist = this.calculateDistance(self.tileIndex, enemy.tileIndex);
      if (dist < closestDistance) {
        closestDistance = dist;
        closestEnemy = enemy;
      }
    }

    if (!closestEnemy) return null;

    // Decide: get closer or stay back?
    const optimalRange = 3 + (1 - this.aggressiveness) * 5; // Defensive bots prefer longer range

    if (closestDistance > optimalRange) {
      // Move closer
      const targetTile = this.getTileTowards(self.tileIndex, closestEnemy.tileIndex);
      return {
        type: 'move',
        targetTile,
        priority: 10 * this.aggressiveness
      };
    } else if (closestDistance < optimalRange - 2) {
      // Move away (kiting)
      const targetTile = this.getTileAway(self.tileIndex, closestEnemy.tileIndex);
      return {
        type: 'move',
        targetTile,
        priority: 10 * (1 - this.aggressiveness)
      };
    }

    return null;
  }

  private getTileTowards(from: number, to: number): number {
    const GRID_WIDTH = 200;
    const x1 = from % GRID_WIDTH;
    const y1 = Math.floor(from / GRID_WIDTH);
    const x2 = to % GRID_WIDTH;
    const y2 = Math.floor(to / GRID_WIDTH);

    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);

    return (y1 + dy) * GRID_WIDTH + (x1 + dx);
  }

  private getTileAway(from: number, awayFrom: number): number {
    const GRID_WIDTH = 200;
    const x1 = from % GRID_WIDTH;
    const y1 = Math.floor(from / GRID_WIDTH);
    const x2 = awayFrom % GRID_WIDTH;
    const y2 = Math.floor(awayFrom / GRID_WIDTH);

    const dx = -Math.sign(x2 - x1);
    const dy = -Math.sign(y2 - y1);

    // Clamp to grid bounds
    const newX = Math.max(0, Math.min(GRID_WIDTH - 1, x1 + dx));
    const newY = Math.max(0, Math.min(GRID_WIDTH - 1, y1 + dy));

    return newY * GRID_WIDTH + newX;
  }
}
