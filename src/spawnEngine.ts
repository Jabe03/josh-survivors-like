import { clampToPlayArea, cloneVec2, isInPlayArea, type Vec2 } from "./types.js";
import { createEnemy, ENEMY_LIBRARY, type ActiveEnemy, type EnemyId, type EnemyScaling, type EnemyTemplate } from "./enemies.js";

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
  // Most of this enemy alive at once. When reached, its weight goes to the other entries.
  maxAlive?: number;
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
  // Most special enemies (template.special: dashers, shooters, ...) alive at once. When
  // reached, only non-special entries are picked, so the total stays the same but the mix
  // stays readable.
  maxSpecials: number;
  // Spawned once when the stage begins (minibosses, bosses).
  spawnOnEnter: EnemyId[];
  // Start the next stage as soon as every spawnOnEnter enemy is dead, shifting the rest of
  // the timeline earlier. Otherwise the next stage starts at its startTime as usual.
  advanceOnClear: boolean;
  // Difficulty when the stage starts; scales the stats of every enemy spawned (see
  // DIFFICULTY_SCALING). 1 is the base stats in ENEMY_LIBRARY.
  difficulty: number;
}

// "stepped": each stage's difficulty holds for the whole stage. "continuous": difficulty ramps
// linearly from each stage's value to the next stage's value over the course of the stage.
export const DIFFICULTY_MODE: "stepped" | "continuous" = "continuous";

// How difficulty becomes stat multipliers: each multiplier is difficulty ^ exponent. So at
// difficulty 2, health is x2, damage x1.41, speed x1.23 and XP x1.74.
export const DIFFICULTY_SCALING = {
  health: 1,
  damage: 0.5,
  speed: 0.3,
  xp: 0.8,
};

// Applied once the final stage has started, so it keeps getting harder instead of going flat.
// Counts grow per tier up to hard limits, so the screen stays readable; past that, only
// difficulty keeps rising. Difficulty compounds by difficultyGrowthPerMinute, so it outpaces
// a build that has hit its level caps and no run lasts forever: with the default exponents,
// normal enemies match the base player's speed about 16 minutes in.
export const ENDLESS_SCALING = {
  difficultyGrowthPerMinute: 1.3,
  tierInterval: 30,
  maxNormalsPerTier: 6,
  maxSpecialsPerTier: 1,
  maxNormalsLimit: 70,
  maxSpecialsLimit: 14,
};


export const DEFAULT_SPAWN_STAGES: SpawnStage[] = [
  {
    startTime: 0,
    name: "Wave 1",
    clearOnEnter: false,
    spawnInterval: 0.3,
    maxNormals: 16,
    normals: [{ enemy: "normal", weight: 1 }],
    maxSpecials: 0,
    spawnOnEnter: [],
    advanceOnClear: false,
    difficulty: 1,
  },
  {
    startTime: 30,
    name: "Wave 2",
    clearOnEnter: false,
    spawnInterval: 0.22,
    maxNormals: 26,
    normals: [
      { enemy: "normal", weight: 0.75 },
      { enemy: "dasher", weight: 0.15, maxAlive: 3 },
      { enemy: "splitter", weight: 0.1, maxAlive: 2 },
    ],
    maxSpecials: 4,
    spawnOnEnter: [],
    advanceOnClear: false,
    difficulty: 1.45,
  },
  {
    startTime: 60,
    name: "Wave 3 - Miniboss",
    clearOnEnter: false,
    spawnInterval: 0.16,
    maxNormals: 36,
    normals: [
      { enemy: "normal", weight: 0.6 },
      { enemy: "dasher", weight: 0.12, maxAlive: 3 },
      { enemy: "shooter", weight: 0.12, maxAlive: 3 },
      { enemy: "splitter", weight: 0.08, maxAlive: 2 },
      { enemy: "bomber", weight: 0.08, maxAlive: 2 },
    ],
    maxSpecials: 6,
    spawnOnEnter: ["miniboss"],
    advanceOnClear: false,
    difficulty: 1.9,
  },
  {
    startTime: 120,
    name: "Boss Wave",
    clearOnEnter: false,
    spawnInterval: 99,
    maxNormals: 0,
    normals: [],
    maxSpecials: 0,
    spawnOnEnter: ["boss"],
    advanceOnClear: true,
    difficulty: 2.3,
  },
  {
    startTime: 240,
    name: "Wave 4 - Miniboss",
    clearOnEnter: false,
    spawnInterval: 0.11,
    maxNormals: 50,
    normals: [
      { enemy: "normal", weight: 0.5 },
      { enemy: "dasher", weight: 0.12, maxAlive: 4 },
      { enemy: "shooter", weight: 0.12, maxAlive: 4 },
      { enemy: "splitter", weight: 0.1, maxAlive: 3 },
      { enemy: "bomber", weight: 0.1, maxAlive: 3 },
      { enemy: "shielder", weight: 0.06, maxAlive: 2 },
    ],
    maxSpecials: 10,
    spawnOnEnter: ["miniboss"],
    advanceOnClear: false,
    difficulty: 2.7,
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

interface AliveCounts {
  normals: number;
  specials: number;
  byTemplate: Map<EnemyTemplate, number>;
}

function countAlive(enemies: readonly ActiveEnemy[]): AliveCounts {
  const counts: AliveCounts = { normals: 0, specials: 0, byTemplate: new Map() };
  for (const enemy of enemies) {
    addToCounts(counts, enemy.template);
  }
  return counts;
}

function addToCounts(counts: AliveCounts, template: EnemyTemplate): void {
  if (template.kind === "normal") {
    counts.normals += 1;
  }
  if (template.special) {
    counts.specials += 1;
  }
  counts.byTemplate.set(template, (counts.byTemplate.get(template) ?? 0) + 1);
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

    // Counts are updated inside the loop so a spawnInterval of 0 stops at the caps.
    const maxNormals = this.getMaxNormals(stage);
    const counts = countAlive(enemies);
    while (this.spawnTimer === 0 && counts.normals < maxNormals) {
      const enemyId = pickWeighted(this.spawnableEntries(stage, counts));
      if (enemyId === null) {
        break;
      }
      const template = ENEMY_LIBRARY[enemyId];
      enemies.push(this.spawnEnemyNear(playerPos, template));
      addToCounts(counts, template);
      this.spawnTimer = stage.spawnInterval;
    }
  }

  // The stage's spawn table minus entries at their maxAlive, and minus all specials once
  // maxSpecials is reached.
  private spawnableEntries(stage: SpawnStage, counts: AliveCounts): SpawnTableEntry[] {
    const specialsFull = counts.specials >= this.getMaxSpecials(stage);
    return stage.normals.filter((entry) => {
      const template = ENEMY_LIBRARY[entry.enemy];
      if (template.special && specialsFull) {
        return false;
      }
      return entry.maxAlive === undefined || (counts.byTemplate.get(template) ?? 0) < entry.maxAlive;
    });
  }

  private getMaxSpecials(stage: SpawnStage): number {
    const grown = stage.maxSpecials + this.getEndlessTier() * ENDLESS_SCALING.maxSpecialsPerTier;
    return Math.max(stage.maxSpecials, Math.min(ENDLESS_SCALING.maxSpecialsLimit, grown));
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
    const grown = stage.maxNormals + this.getEndlessTier() * ENDLESS_SCALING.maxNormalsPerTier;
    return Math.max(stage.maxNormals, Math.min(ENDLESS_SCALING.maxNormalsLimit, grown));
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

  getCurrentStageInfo(): { index: number; stage: SpawnStage; label: string; targetEnemyCount: number; difficulty: number } {
    const stage = this.stages[this.currentStageIndex];
    return {
      index: this.currentStageIndex,
      stage,
      label: stage.name,
      targetEnemyCount: this.getMaxNormals(stage) + stage.spawnOnEnter.length,
      difficulty: this.getDifficulty(),
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

  // The current difficulty: the stage's value, ramped toward the next stage's in continuous
  // mode, and compounding by ENDLESS_SCALING.difficultyGrowthPerMinute once the final stage starts.
  getDifficulty(): number {
    const stage = this.stages[this.currentStageIndex];
    const next = this.stages[this.currentStageIndex + 1];
    const timeInStage = Math.max(0, this.getStageTime() - stage.startTime);
    if (!next) {
      return stage.difficulty * Math.pow(ENDLESS_SCALING.difficultyGrowthPerMinute, timeInStage / 60);
    }
    if (DIFFICULTY_MODE === "stepped") {
      return stage.difficulty;
    }
    const progress = Math.min(1, timeInStage / Math.max(1e-6, next.startTime - stage.startTime));
    return stage.difficulty + (next.difficulty - stage.difficulty) * progress;
  }

  private getScaling(): EnemyScaling {
    const difficulty = Math.max(0.01, this.getDifficulty());
    return {
      difficulty,
      health: Math.pow(difficulty, DIFFICULTY_SCALING.health),
      damage: Math.pow(difficulty, DIFFICULTY_SCALING.damage),
      speed: Math.pow(difficulty, DIFFICULTY_SCALING.speed),
      xp: Math.pow(difficulty, DIFFICULTY_SCALING.xp),
    };
  }

  // Spawns at a random angle around the player, retrying for a spot inside the play area
  // (near a wall some angles land outside). Falls back to clamping onto the wall.
  private spawnEnemyNear(playerPos: Vec2, template: EnemyTemplate, distance = SPAWN_RADIUS): ActiveEnemy {
    let pos = playerPos;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      pos = { x: playerPos.x + Math.cos(angle) * distance, y: playerPos.y + Math.sin(angle) * distance };
      if (isInPlayArea(pos, template.radius)) {
        break;
      }
    }
    pos = cloneVec2(pos);
    clampToPlayArea(pos, template.radius);
    return createEnemy(template, pos, this.getScaling());
  }
}
