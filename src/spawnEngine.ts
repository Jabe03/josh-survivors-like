import type { Enemy, Vec2 } from "./types.js";

export type EnemyKind = "normal" | "miniboss" | "boss";

export interface EnemyTemplate {
  speed: number;
  radius: number;
  health: number;
  damage: number;
  hitInterval: number;
  xpReward: number;
}

export type SpawnWaveKind = "normal" | "normal_miniboss" | "boss";

export interface SpawnStage {
  startTime: number;
  name: string;
  kind: SpawnWaveKind;
  clearOnEnter: boolean;
  spawnInterval: number;
  maxNormals: number;
  normal: EnemyTemplate | null;
  miniboss: EnemyTemplate | null;
  boss: EnemyTemplate | null;
}

export interface ActiveEnemy extends Enemy {
  kind: EnemyKind;
  health: number;
  maxHealth: number;
  damage: number;
  hitInterval: number;
  hitCooldown: number;
  xpReward: number;
}

export const DEFAULT_SPAWN_STAGES: SpawnStage[] = [
  {
    startTime: 0,
    name: "Wave 1",
    kind: "normal",
    clearOnEnter: false,
    spawnInterval: 2.2,
    maxNormals: 2,
    normal: {
      speed: 95,
      radius: 12,
      health: 18,
      xpReward: 7,
      damage: 6,
      hitInterval: 0.9,
    },
    miniboss: null,
    boss: null,
  },
  {
    startTime: 20,
    name: "Wave 2",
    kind: "normal",
    clearOnEnter: false,
    spawnInterval: 1.6,
    maxNormals: 4,
    normal: {
      speed: 120,
      radius: 13,
      health: 26,
      xpReward: 10,
      damage: 8,
      hitInterval: 0.8,
    },
    miniboss: null,
    boss: null,
  },
  {
    startTime: 45,
    name: "Wave 3 - Miniboss",
    kind: "normal_miniboss",
    clearOnEnter: false,
    spawnInterval: 1.1,
    maxNormals: 6,
    normal: {
      speed: 145,
      radius: 14,
      health: 34,
      xpReward: 13,
      damage: 10,
      hitInterval: 0.7,
    },
    miniboss: {
      speed: 105,
      radius: 24,
      health: 220,
      xpReward: 70,
      damage: 18,
      hitInterval: 0.9,
    },
    boss: null,
  },
  {
    startTime: 80,
    name: "Boss Wave",
    kind: "boss",
    clearOnEnter: true,
    spawnInterval: 99,
    maxNormals: 0,
    normal: null,
    miniboss: null,
    boss: {
      speed: 95,
      radius: 36,
      health: 700,
      xpReward: 240,
      damage: 28,
      hitInterval: 1,
    },
  },
  {
    startTime: 115,
    name: "Wave 4 - Miniboss",
    kind: "normal_miniboss",
    clearOnEnter: false,
    spawnInterval: 0.8,
    maxNormals: 9,
    normal: {
      speed: 185,
      radius: 15,
      health: 48,
      xpReward: 18,
      damage: 13,
      hitInterval: 0.58,
    },
    miniboss: {
      speed: 120,
      radius: 26,
      health: 340,
      xpReward: 110,
      damage: 22,
      hitInterval: 0.82,
    },
    boss: null,
  },
];

export class EnemySpawnEngine {
  private elapsed = 0;
  private spawnTimer = 0;
  private currentStageIndex = 0;
  private enteredStageIndex = -1;
  private minibossSpawned = new Set<number>();
  private bossSpawned = new Set<number>();

  constructor(private readonly stages: SpawnStage[]) {}

  update(dt: number, playerPos: Vec2, enemies: ActiveEnemy[]): void {
    this.elapsed += dt;
    this.currentStageIndex = this.getCurrentStageIndex();
    const stage = this.stages[this.currentStageIndex];

    if (this.enteredStageIndex !== this.currentStageIndex) {
      this.enteredStageIndex = this.currentStageIndex;
      this.spawnTimer = 0;
      if (stage.clearOnEnter) {
        enemies.length = 0;
      }
    }

    this.spawnTimer = Math.max(0, this.spawnTimer - dt);

    if (stage.kind === "boss") {
      this.trySpawnBoss(stage, playerPos, enemies);
      return;
    }

    if (stage.kind === "normal_miniboss") {
      this.trySpawnMiniboss(stage, playerPos, enemies);
    }

    const normalCount = enemies.filter((e) => e.kind === "normal").length;
    while (this.spawnTimer === 0 && stage.normal !== null && normalCount < stage.maxNormals) {
      enemies.push(this.spawnEnemyNear(playerPos, stage.normal, "normal", 380, 640));
      this.spawnTimer = stage.spawnInterval;
    }
  }

  getElapsedTime(): number {
    return this.elapsed;
  }

  getCurrentStageInfo(): { index: number; stage: SpawnStage; label: string; targetEnemyCount: number } {
    const stage = this.stages[this.currentStageIndex];
    let targetEnemyCount = stage.maxNormals;
    if (stage.kind === "normal_miniboss") {
      targetEnemyCount += 1;
    }
    if (stage.kind === "boss") {
      targetEnemyCount = 1;
    }
    return {
      index: this.currentStageIndex,
      stage,
      label: stage.name,
      targetEnemyCount,
    };
  }

  private getCurrentStageIndex(): number {
    let currentIndex = 0;
    for (let i = 0; i < this.stages.length; i += 1) {
      if (this.elapsed >= this.stages[i].startTime) {
        currentIndex = i;
      }
    }
    return currentIndex;
  }

  private trySpawnMiniboss(stage: SpawnStage, playerPos: Vec2, enemies: ActiveEnemy[]): void {
    if (stage.miniboss === null) {
      return;
    }
    if (this.minibossSpawned.has(this.currentStageIndex)) {
      return;
    }
    enemies.push(this.spawnEnemyNear(playerPos, stage.miniboss, "miniboss", 420, 740));
    this.minibossSpawned.add(this.currentStageIndex);
  }

  private trySpawnBoss(stage: SpawnStage, playerPos: Vec2, enemies: ActiveEnemy[]): void {
    if (stage.boss === null) {
      return;
    }
    if (this.bossSpawned.has(this.currentStageIndex)) {
      return;
    }
    enemies.push(this.spawnEnemyNear(playerPos, stage.boss, "boss", 520, 760));
    this.bossSpawned.add(this.currentStageIndex);
  }

  private spawnEnemyNear(
    playerPos: Vec2,
    template: EnemyTemplate,
    kind: EnemyKind,
    minDistance: number,
    maxDistance: number,
  ): ActiveEnemy {
    const angle = Math.random() * Math.PI * 2;
    const distance = minDistance + Math.random() * (maxDistance - minDistance);

    return {
      kind,
      pos: {
        x: playerPos.x + Math.cos(angle) * distance,
        y: playerPos.y + Math.sin(angle) * distance,
      },
      radius: template.radius,
      speed: template.speed,
      health: template.health,
      maxHealth: template.health,
      damage: template.damage,
      hitInterval: template.hitInterval,
      hitCooldown: 0,
      xpReward: template.xpReward,
    };
  }
}
