import type { Vec2 } from "./types.js";
import { createEnemy, ENEMY_LIBRARY, type ActiveEnemy, type EnemyId, type EnemyTemplate } from "./enemies.js";

// Distance from the player at which every enemy appears: just off-screen on a 1080p screen,
// whose corners are ~1101 from the center, plus a margin of at least the largest enemy
// radius (the boss, 36). Larger screens can see enemies spawn at their edges.
const SPAWN_RADIUS = 1150;

// Normals from the first stage's table, spawned once when the run starts so the player
// doesn't wait for the first wave to walk in from SPAWN_RADIUS. Each one spawns 0% to
// maxCloser closer than SPAWN_RADIUS, so some may appear on-screen. They count toward
// the first stage's maxNormals like any other normal.
const OPENING_BATCH = {
  count: 12,
  maxCloser: 0.5,
};

export interface SpawnTableEntry {
  enemy: EnemyId;
  weight: number;
}

export interface SpawnStage {
  startTime: number;
  name: string;
  clearOnEnter: boolean;
  spawnInterval: number;
  // Cap on live "normal" enemies, counted across all stages.
  maxNormals: number;
  // Picked by weight every spawnInterval while under maxNormals.
  normals: SpawnTableEntry[];
  // Spawned once when the stage begins (minibosses, bosses).
  spawnOnEnter: EnemyId[];
  // Start the next stage as soon as every spawnOnEnter enemy is dead, shifting the rest of
  // the timeline earlier. Otherwise the next stage starts at its startTime as usual.
  advanceOnClear: boolean;
}

// Applied once the final stage has started, so difficulty keeps rising instead of going flat.
export const ENDLESS_SCALING = {
  tierInterval: 30,
  healthMultiplierPerTier: 1.1,
  maxNormalsPerTier: 6,
};


export const DEFAULT_SPAWN_STAGES: SpawnStage[] = [
  {
    startTime: 0,
    name: "Wave 1",
    clearOnEnter: false,
    spawnInterval: 0.3,
    maxNormals: 16,
    normals: [{ enemy: "normal_w1", weight: 1 }],
    spawnOnEnter: [],
    advanceOnClear: false,
  },
  {
    startTime: 30,
    name: "Wave 2",
    clearOnEnter: false,
    spawnInterval: 0.22,
    maxNormals: 26,
    normals: [{ enemy: "normal_w2", weight: 1 }],
    spawnOnEnter: [],
    advanceOnClear: false,
  },
  {
    startTime: 60,
    name: "Wave 3 - Miniboss",
    clearOnEnter: false,
    spawnInterval: 0.16,
    maxNormals: 36,
    normals: [{ enemy: "normal_w3", weight: 1 }],
    spawnOnEnter: ["miniboss_w3"],
    advanceOnClear: false,
  },
  {
    startTime: 120,
    name: "Boss Wave",
    clearOnEnter: false,
    spawnInterval: 99,
    maxNormals: 0,
    normals: [],
    spawnOnEnter: ["boss_1"],
    advanceOnClear: true,
  },
  {
    startTime: 240,
    name: "Wave 4 - Miniboss",
    clearOnEnter: false,
    spawnInterval: 0.11,
    maxNormals: 50,
    normals: [{ enemy: "normal_w4", weight: 1 }],
    spawnOnEnter: ["miniboss_w4"],
    advanceOnClear: false,
  },
];

function pickWeighted(entries: readonly SpawnTableEntry[]): EnemyId | null {
  let total = 0;
  for (const entry of entries) {
    total += Math.max(0, entry.weight);
  }
  if (total <= 0) {
    return null;
  }

  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) {
      return entry.enemy;
    }
  }
  return entries[entries.length - 1].enemy;
}

function countNormals(enemies: readonly ActiveEnemy[]): number {
  let count = 0;
  for (const enemy of enemies) {
    if (enemy.template.kind === "normal") {
      count += 1;
    }
  }
  return count;
}

export class EnemySpawnEngine {
  private elapsed = 0;
  // Stage time runs ahead of real time once a stage is cleared early.
  private timelineOffset = 0;
  private spawnTimer = 0;
  private currentStageIndex = 0;
  private enteredStageIndex = -1;
  private stageEnterSpawns: ActiveEnemy[] = [];

  constructor(private readonly stages: SpawnStage[]) {}

  update(dt: number, playerPos: Vec2, enemies: ActiveEnemy[]): void {
    this.elapsed += dt;
    this.advanceIfCleared();
    this.currentStageIndex = this.getCurrentStageIndex();
    const stage = this.stages[this.currentStageIndex];

    if (this.enteredStageIndex === -1) {
      this.spawnOpeningBatch(playerPos, enemies, this.stages[0]);
    }

    if (this.enteredStageIndex !== this.currentStageIndex) {
      this.enteredStageIndex = this.currentStageIndex;
      this.spawnTimer = 0;
      if (stage.clearOnEnter) {
        enemies.length = 0;
      }
      this.stageEnterSpawns = stage.spawnOnEnter.map((enemyId) => this.spawnEnemyNear(playerPos, ENEMY_LIBRARY[enemyId]));
      enemies.push(...this.stageEnterSpawns);
    }

    this.spawnTimer = Math.max(0, this.spawnTimer - dt);

    // The count is updated inside the loop so a spawnInterval of 0 stops at the cap.
    const maxNormals = this.getMaxNormals(stage);
    let normalCount = countNormals(enemies);
    while (this.spawnTimer === 0 && normalCount < maxNormals) {
      const enemyId = pickWeighted(stage.normals);
      if (enemyId === null) {
        break;
      }
      enemies.push(this.spawnEnemyNear(playerPos, ENEMY_LIBRARY[enemyId]));
      normalCount += 1;
      this.spawnTimer = stage.spawnInterval;
    }
  }

  // 0 until the final stage starts, then +1 every ENDLESS_SCALING.tierInterval seconds.
  getEndlessTier(): number {
    const lastIndex = this.stages.length - 1;
    if (this.currentStageIndex < lastIndex) {
      return 0;
    }
    const timeInFinalStage = this.getStageTime() - this.stages[lastIndex].startTime;
    return Math.max(0, Math.floor(timeInFinalStage / ENDLESS_SCALING.tierInterval));
  }

  private getMaxNormals(stage: SpawnStage): number {
    return stage.maxNormals + this.getEndlessTier() * ENDLESS_SCALING.maxNormalsPerTier;
  }

  private getStageTime(): number {
    return this.elapsed + this.timelineOffset;
  }

  private advanceIfCleared(): void {
    const stage = this.stages[this.enteredStageIndex];
    const next = this.stages[this.enteredStageIndex + 1];
    if (!stage || !next || !stage.advanceOnClear || this.stageEnterSpawns.length === 0) {
      return;
    }
    if (this.stageEnterSpawns.every((enemy) => enemy.health <= 0)) {
      this.timelineOffset = Math.max(this.timelineOffset, next.startTime - this.elapsed);
      this.stageEnterSpawns = [];
    }
  }

  getElapsedTime(): number {
    return this.elapsed;
  }

  getCurrentStageInfo(): { index: number; stage: SpawnStage; label: string; targetEnemyCount: number } {
    const stage = this.stages[this.currentStageIndex];
    return {
      index: this.currentStageIndex,
      stage,
      label: stage.name,
      targetEnemyCount: this.getMaxNormals(stage) + stage.spawnOnEnter.length,
    };
  }

  private getCurrentStageIndex(): number {
    let currentIndex = 0;
    const stageTime = this.getStageTime();
    for (let i = 0; i < this.stages.length; i += 1) {
      if (stageTime >= this.stages[i].startTime) {
        currentIndex = i;
      }
    }
    return currentIndex;
  }

  private spawnOpeningBatch(playerPos: Vec2, enemies: ActiveEnemy[], stage: SpawnStage): void {
    for (let i = 0; i < OPENING_BATCH.count; i += 1) {
      const enemyId = pickWeighted(stage.normals);
      if (enemyId === null) {
        return;
      }
      const distance = SPAWN_RADIUS * (1 - Math.random() * OPENING_BATCH.maxCloser);
      enemies.push(this.spawnEnemyNear(playerPos, ENEMY_LIBRARY[enemyId], distance));
    }
  }

  private spawnEnemyNear(playerPos: Vec2, template: EnemyTemplate, distance = SPAWN_RADIUS): ActiveEnemy {
    const healthMultiplier = Math.pow(ENDLESS_SCALING.healthMultiplierPerTier, this.getEndlessTier());
    const angle = Math.random() * Math.PI * 2;
    const pos = {
      x: playerPos.x + Math.cos(angle) * distance,
      y: playerPos.y + Math.sin(angle) * distance,
    };
    return createEnemy(template, pos, healthMultiplier);
  }
}
