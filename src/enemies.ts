import { cloneVec2, type Vec2 } from "./types.js";
import type { SimContext } from "./world.js";
import type { HitFlashStyle } from "./vfx.js";

export type EnemyKind = "normal" | "miniboss" | "boss";

// ---- Behaviors: how an enemy moves and attacks. Contact damage is shared by all enemies. ----
// Behaviors steer by setting enemy.moveVelocity; moveEnemy then combines it with knockback.

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
      enemy.moveVelocity.x = (dx / dist) * enemy.template.speed;
      enemy.moveVelocity.y = (dy / dist) * enemy.template.speed;
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
  // Scales knockback taken: 1 = full push, 0.5 = half distance, 0 = immune.
  knockbackMultiplier: number;
  behavior: EnemyBehavior;
  visual: EnemyVisual;
}

// A push lasts this long at constant speed, so its distance is exact.
const KNOCKBACK_DURATION = 0.15;

const CHASE: EnemyBehavior = { id: "chase", params: {} };
const NORMAL_VISUAL: EnemyVisual = { shape: "circle", color: "#d66565", healthBarColor: "#ff7a7a" };
const MINIBOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#c6552f", healthBarColor: "#ffb07f" };
const BOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#9a2a2a", healthBarColor: "#ff9d9d" };

// Shared enemy definitions. Stages reference these by id instead of copying stats.
export const ENEMY_LIBRARY = {
  normal_w1: { kind: "normal", speed: 60, radius: 12, health: 18, xpReward: 7, damage: 6, hitInterval: 0.9, knockbackMultiplier: 1, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w2: { kind: "normal", speed: 70, radius: 13, health: 26, xpReward: 10, damage: 8, hitInterval: 0.8, knockbackMultiplier: 1, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w3: { kind: "normal", speed: 82, radius: 14, health: 34, xpReward: 13, damage: 10, hitInterval: 0.7, knockbackMultiplier: 1, behavior: CHASE, visual: NORMAL_VISUAL },
  normal_w4: { kind: "normal", speed: 100, radius: 15, health: 48, xpReward: 18, damage: 13, hitInterval: 0.58, knockbackMultiplier: 1, behavior: CHASE, visual: NORMAL_VISUAL },
  miniboss_w3: { kind: "miniboss", speed: 66, radius: 24, health: 220, xpReward: 70, damage: 18, hitInterval: 0.9, knockbackMultiplier: 1, behavior: CHASE, visual: MINIBOSS_VISUAL },
  miniboss_w4: { kind: "miniboss", speed: 74, radius: 26, health: 340, xpReward: 110, damage: 22, hitInterval: 0.82, knockbackMultiplier: 1, behavior: CHASE, visual: MINIBOSS_VISUAL },
  boss_1: { kind: "boss", speed: 62, radius: 36, health: 700, xpReward: 240, damage: 28, hitInterval: 1, knockbackMultiplier: 1, behavior: CHASE, visual: BOSS_VISUAL },
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
  // Where the enemy wants to go, set by its behavior each step.
  moveVelocity: Vec2;
  // Current push, added to moveVelocity (scaled by knockbackMultiplier) until
  // knockbackTimeLeft runs out. Zero when not being pushed.
  knockbackVelocity: Vec2;
  knockbackTimeLeft: number;
  // Null when not burning.
  burn: BurnStatus | null;
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
    moveVelocity: { x: 0, y: 0 },
    knockbackVelocity: { x: 0, y: 0 },
    knockbackTimeLeft: 0,
    burn: null,
  };
}

// Pushes the enemy `distance` units away from `from` (before knockbackMultiplier), over
// KNOCKBACK_DURATION. A new push replaces one already in progress.
export function applyKnockback(enemy: ActiveEnemy, from: Vec2, distance: number): void {
  const dx = enemy.pos.x - from.x;
  const dy = enemy.pos.y - from.y;
  const dist = Math.hypot(dx, dy);
  // An enemy exactly on top of `from` has no direction; push it along +x.
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  const speed = distance / KNOCKBACK_DURATION;
  enemy.knockbackVelocity.x = nx * speed;
  enemy.knockbackVelocity.y = ny * speed;
  enemy.knockbackTimeLeft = KNOCKBACK_DURATION;
}

// Moves the enemy by moveVelocity + knockbackMultiplier * knockbackVelocity. With no push in
// progress the knockback term is zero, so this is just the behavior's movement.
export function moveEnemy(enemy: ActiveEnemy, dt: number): void {
  let kbDx = 0;
  let kbDy = 0;
  if (enemy.knockbackTimeLeft > 0) {
    // Clamp the last step so the total distance is exact.
    const t = Math.min(dt, enemy.knockbackTimeLeft);
    const scale = enemy.template.knockbackMultiplier * t;
    kbDx = enemy.knockbackVelocity.x * scale;
    kbDy = enemy.knockbackVelocity.y * scale;
    enemy.knockbackTimeLeft -= t;
    if (enemy.knockbackTimeLeft <= 0) {
      enemy.knockbackVelocity.x = 0;
      enemy.knockbackVelocity.y = 0;
    }
  }
  enemy.pos.x += enemy.moveVelocity.x * dt + kbDx;
  enemy.pos.y += enemy.moveVelocity.y * dt + kbDy;
}

// ---- Status effects ----

// Seconds between burn damage ticks, shared by every burn.
export const BURN_TICK_INTERVAL = 0.5;
export const BURN_HIT_FLASH: HitFlashStyle = { radius: 5, life: 0.1, color: "#ff8a3d" };

// Damage over time. Ticks are counted rather than timed, so a burn deals exactly dps * duration.
export interface BurnStatus {
  dps: number;
  ticksLeft: number;
  // Counts down to the next tick.
  tickTimer: number;
}

// Burns don't stack: reapplying keeps the stronger dps and the longer remaining duration,
// so overlapping hits can't multiply burn damage.
export function applyBurn(enemy: ActiveEnemy, dps: number, duration: number): void {
  const ticks = Math.max(1, Math.round(duration / BURN_TICK_INTERVAL));
  if (!enemy.burn) {
    // The first tick waits a full interval, so it doesn't land on the same frame as the hit.
    enemy.burn = { dps, ticksLeft: ticks, tickTimer: BURN_TICK_INTERVAL };
    return;
  }
  enemy.burn.dps = Math.max(enemy.burn.dps, dps);
  enemy.burn.ticksLeft = Math.max(enemy.burn.ticksLeft, ticks);
}

// Advances the burn and returns the damage due this step (0 between ticks).
export function tickBurn(enemy: ActiveEnemy, dt: number): number {
  const burn = enemy.burn;
  if (!burn) {
    return 0;
  }
  burn.tickTimer -= dt;
  if (burn.tickTimer > 0) {
    return 0;
  }
  burn.tickTimer += BURN_TICK_INTERVAL;
  burn.ticksLeft -= 1;
  if (burn.ticksLeft <= 0) {
    enemy.burn = null;
  }
  return burn.dps * BURN_TICK_INTERVAL;
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

  if (enemy.burn) {
    ctx.strokeStyle = "#ff8a3d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    SHAPE_PATHS[visual.shape](ctx, screen.x, screen.y, radius + 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

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
