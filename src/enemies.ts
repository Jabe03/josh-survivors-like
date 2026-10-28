import { cloneVec2, type Vec2 } from "./types.js";
import type { SimContext } from "./world.js";

export type EnemyKind = "normal" | "miniboss" | "boss";

// ---- Behaviors: how an enemy moves and attacks. Contact damage is shared by all enemies. ----

// Params for each behavior. Adding a behavior means adding it here and to BEHAVIOR_REGISTRY.
interface BehaviorParamsMap {
  // Walk straight at the player at the template's speed.
  chase: Record<string, never>;
}

export type EnemyBehaviorId = keyof BehaviorParamsMap;

export type EnemyBehavior = {
  [K in EnemyBehaviorId]: { id: K; params: BehaviorParamsMap[K] };
}[EnemyBehaviorId];

interface BehaviorHandler<P, S> {
  createState: () => S;
  update: (enemy: ActiveEnemy, context: SimContext, params: P, state: S) => void;
}

const BEHAVIOR_REGISTRY: { [K in EnemyBehaviorId]: BehaviorHandler<BehaviorParamsMap[K], unknown> } = {
  chase: {
    createState: () => null,
    update: (enemy, context) => {
      const dx = context.player.pos.x - enemy.pos.x;
      const dy = context.player.pos.y - enemy.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      enemy.pos.x += (dx / dist) * enemy.template.speed * context.dt;
      enemy.pos.y += (dy / dist) * enemy.template.speed * context.dt;
    },
  },
};

function getBehaviorHandler(id: EnemyBehaviorId): BehaviorHandler<unknown, unknown> {
  return BEHAVIOR_REGISTRY[id] as BehaviorHandler<unknown, unknown>;
}

// ---- Visuals: shape and colors. Adding a shape means adding it to SHAPE_PATHS. ----

export type EnemyShape = "circle" | "square" | "triangle" | "diamond";

export interface EnemyVisual {
  shape: EnemyShape;
  color: string;
  healthBarColor: string;
}

// Each entry traces the shape's path, sized to fit the enemy's collision radius.
const SHAPE_PATHS: Record<EnemyShape, (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => void> = {
  circle: (ctx, x, y, r) => ctx.arc(x, y, r, 0, Math.PI * 2),
  square: (ctx, x, y, r) => ctx.rect(x - r, y - r, r * 2, r * 2),
  triangle: (ctx, x, y, r) => {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.87, y + r * 0.5);
    ctx.lineTo(x - r * 0.87, y + r * 0.5);
    ctx.closePath();
  },
  diamond: (ctx, x, y, r) => {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
  },
};

// ---- Templates ----

export interface EnemyTemplate {
  kind: EnemyKind;
  speed: number;
  radius: number;
  health: number;
  // Contact damage and how often it can be dealt.
  damage: number;
  hitInterval: number;
  xpReward: number;
  behavior: EnemyBehavior;
  visual: EnemyVisual;
}

const CHASE: EnemyBehavior = { id: "chase", params: {} };
const NORMAL_VISUAL: EnemyVisual = { shape: "circle", color: "#d66565", healthBarColor: "#ff7a7a" };
const MINIBOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#c6552f", healthBarColor: "#ffb07f" };
const BOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#9a2a2a", healthBarColor: "#ff9d9d" };

// Shared enemy definitions. Stages reference these by id instead of copying stats.
export const ENEMY_LIBRARY = {
  normal_w1: { kind: "normal", speed: 95, radius: 12, health: 18, xpReward: 7, damage: 6, hitInterval: 0.9, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w2: { kind: "normal", speed: 120, radius: 13, health: 26, xpReward: 10, damage: 8, hitInterval: 0.8, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w3: { kind: "normal", speed: 145, radius: 14, health: 34, xpReward: 13, damage: 10, hitInterval: 0.7, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w4: { kind: "normal", speed: 185, radius: 15, health: 48, xpReward: 18, damage: 13, hitInterval: 0.58, behavior: CHASE, visual: NORMAL_VISUAL },
  miniboss_w3: { kind: "miniboss", speed: 105, radius: 24, health: 220, xpReward: 70, damage: 18, hitInterval: 0.9, behavior: CHASE, visual: MINIBOSS_VISUAL },
  miniboss_w4: { kind: "miniboss", speed: 120, radius: 26, health: 340, xpReward: 110, damage: 22, hitInterval: 0.82, behavior: CHASE, visual: MINIBOSS_VISUAL },
  boss_1: { kind: "boss", speed: 95, radius: 36, health: 700, xpReward: 240, damage: 28, hitInterval: 1, behavior: CHASE, visual: BOSS_VISUAL },
} satisfies Record<string, EnemyTemplate>;

export type EnemyId = keyof typeof ENEMY_LIBRARY;

// ---- Live enemies ----

// Only per-instance state lives here; everything fixed comes from `template`.
export interface ActiveEnemy {
  template: EnemyTemplate;
  pos: Vec2;
  health: number;
  maxHealth: number;
  hitCooldown: number;
  behaviorState: unknown;
  // While set, the enemy slides with this velocity instead of running its behavior.
  knockback: { velocity: Vec2; timeLeft: number } | null;
}

export function createEnemy(template: EnemyTemplate, pos: Vec2, healthMultiplier = 1): ActiveEnemy {
  const health = template.health * healthMultiplier;
  return {
    template,
    pos: cloneVec2(pos),
    health,
    maxHealth: health,
    hitCooldown: 0,
    behaviorState: getBehaviorHandler(template.behavior.id).createState(),
    knockback: null,
  };
}

export function updateEnemyBehavior(enemy: ActiveEnemy, context: SimContext): void {
  const behavior = enemy.template.behavior;
  getBehaviorHandler(behavior.id).update(enemy, context, behavior.params, enemy.behaviorState);
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: ActiveEnemy, screen: Vec2): void {
  const { radius, visual } = enemy.template;
  ctx.fillStyle = visual.color;
  ctx.beginPath();
  SHAPE_PATHS[visual.shape](ctx, screen.x, screen.y, radius);
  ctx.fill();

  const hpRatio = enemy.health / enemy.maxHealth;
  const hpW = radius * 2;
  const hpH = 4;
  const hpX = screen.x - hpW / 2;
  const hpY = screen.y - radius - 10;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(hpX, hpY, hpW, hpH);
  ctx.fillStyle = visual.healthBarColor;
  ctx.fillRect(hpX, hpY, hpW * Math.max(0, hpRatio), hpH);
}
