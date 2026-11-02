import { cloneVec2, type Vec2 } from "./types.js";
import type { SimContext } from "./world.js";
import type { HitFlashStyle } from "./vfx.js";

export type EnemyKind = "normal" | "miniboss" | "boss";

// ---- Behaviors: how an enemy moves and attacks. Contact damage is shared by all enemies. ----
// Behaviors steer by setting enemy.moveVelocity; moveEnemy then combines it with knockback.

// Params for each behavior. Adding a behavior means adding it here and to BEHAVIOR_REGISTRY.
interface BehaviorParamsMap {
  // Walk straight at the player at the enemy's speed.
  chase: Record<string, never>;
  // Approach like chase until within triggerRange, then back up slowly while winding up (a
  // telegraph line shows the aim), then dash in a straight line along the locked aim, then
  // rest before approaching again.
  dasher: {
    triggerRange: number;
    windupTime: number;
    backupSpeed: number;
    dashSpeed: number;
    dashDistance: number;
    recoverTime: number;
  };
  // Run at the player; once within fuseRange, stop and flash the blast radius for fuseTime,
  // then explode, hurting the player if inside explosionRadius. Self-destructing gives no XP.
  bomber: {
    fuseRange: number;
    fuseTime: number;
    explosionRadius: number;
  };
  // Keep about preferredRange from the player, circling slowly, and every fireInterval glow
  // for windupTime then fire a projectile, leading the player's movement (see predictedAim). The projectile deals the
  // enemy's (scaled) damage.
  shooter: {
    preferredRange: number;
    fireInterval: number;
    windupTime: number;
    projectileSpeed: number;
    projectileRadius: number;
    projectileLife: number;
  };
}

export type EnemyBehaviorId = keyof BehaviorParamsMap;

export type EnemyBehavior = {
  [K in EnemyBehaviorId]: { id: K; params: BehaviorParamsMap[K] };
}[EnemyBehaviorId];

interface BehaviorHandler<P, S> {
  createState: () => S;
  update: (enemy: ActiveEnemy, context: SimContext, params: P, state: S) => void;
  // Optional telegraph drawn under the enemies, e.g. a dash's aim line.
  draw?: (ctx: CanvasRenderingContext2D, enemy: ActiveEnemy, params: P, state: S, worldToScreen: (world: Vec2) => Vec2) => void;
}

// Unit vector from the enemy to the player, and the distance.
function towardPlayer(enemy: ActiveEnemy, context: SimContext): { x: number; y: number; dist: number } {
  const dx = context.player.pos.x - enemy.pos.x;
  const dy = context.player.pos.y - enemy.pos.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: dx / dist, y: dy / dist, dist };
}

// Difficulty at which aim leads the player by half of a true prediction. Lead strength is
// difficulty / (difficulty + this): always toward where the player is heading, weak early
// on, and approaching a perfect intercept as difficulty climbs.
const PREDICTION_HALF_DIFFICULTY = 2;

// Unit vector from the enemy toward where the player will be when something moving at
// `speed` reaches them, blended between their current spot and the true intercept by the
// enemy's difficulty. When no intercept exists (the player outruns it), leads by the time
// it would take to reach their current spot instead.
function predictedAim(enemy: ActiveEnemy, context: SimContext, speed: number): { x: number; y: number } {
  const player = context.player;
  const dx = player.pos.x - enemy.pos.x;
  const dy = player.pos.y - enemy.pos.y;
  const vx = player.velocity.x;
  const vy = player.velocity.y;
  // Smallest t > 0 with |d + v t| = speed * t.
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t = 0;
  if (Math.abs(a) < 1e-6) {
    t = b < 0 ? -c / b : 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-b - root) / (2 * a);
      const t2 = (-b + root) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2, 0);
    }
  }
  if (t <= 0) {
    t = Math.sqrt(c) / speed;
  }
  const difficulty = enemy.scaling.difficulty;
  const lead = (difficulty / (difficulty + PREDICTION_HALF_DIFFICULTY)) * t;
  const ax = dx + vx * lead;
  const ay = dy + vy * lead;
  const dist = Math.hypot(ax, ay) || 1;
  return { x: ax / dist, y: ay / dist };
}

interface DasherState {
  phase: "approach" | "windup" | "dash" | "recover";
  timer: number;
  aim: Vec2;
  dashLeft: number;
}

interface ShooterState {
  cooldown: number;
  // Seconds left glowing before the shot; 0 when not winding up.
  windupLeft: number;
  // Which way it circles the player: 1 or -1.
  orbitSign: number;
}

const DASH_TELEGRAPH_COLOR = "255, 120, 80";
const SHOT_COLOR = "#d68aff";

interface BomberState {
  // Seconds left on the lit fuse; null until it is lit.
  fuseLeft: number | null;
}

// State types differ per behavior; each handler annotates its own state parameter.
const BEHAVIOR_REGISTRY: { [K in EnemyBehaviorId]: BehaviorHandler<BehaviorParamsMap[K], any> } = {
  chase: {
    createState: () => null,
    update: (enemy, context) => {
      const to = towardPlayer(enemy, context);
      enemy.moveVelocity.x = to.x * enemy.speed;
      enemy.moveVelocity.y = to.y * enemy.speed;
    },
  },

  dasher: {
    createState: (): DasherState => ({ phase: "approach", timer: 0, aim: { x: 0, y: 0 }, dashLeft: 0 }),
    update: (enemy, context, params, state: DasherState) => {
      const to = towardPlayer(enemy, context);
      state.timer -= context.dt;
      switch (state.phase) {
        case "approach":
          enemy.moveVelocity.x = to.x * enemy.speed;
          enemy.moveVelocity.y = to.y * enemy.speed;
          if (to.dist < params.triggerRange) {
            state.phase = "windup";
            state.timer = params.windupTime;
          }
          break;
        case "windup": {
          // Keeps tracking the player until the dash starts, so the aim line follows them,
          // leading their movement more at higher difficulty.
          const aim = predictedAim(enemy, context, params.dashSpeed);
          state.aim.x = aim.x;
          state.aim.y = aim.y;
          enemy.moveVelocity.x = -to.x * params.backupSpeed;
          enemy.moveVelocity.y = -to.y * params.backupSpeed;
          if (state.timer <= 0) {
            state.phase = "dash";
            state.dashLeft = params.dashDistance;
          }
          break;
        }
        case "dash":
          enemy.moveVelocity.x = state.aim.x * params.dashSpeed;
          enemy.moveVelocity.y = state.aim.y * params.dashSpeed;
          state.dashLeft -= params.dashSpeed * context.dt;
          if (state.dashLeft <= 0) {
            state.phase = "recover";
            state.timer = params.recoverTime;
          }
          break;
        case "recover":
          enemy.moveVelocity.x = 0;
          enemy.moveVelocity.y = 0;
          if (state.timer <= 0) {
            state.phase = "approach";
          }
          break;
      }
    },
    // While winding up: a line along the aim, the full dash length, brightening as the dash nears.
    draw: (ctx, enemy, params, state: DasherState, worldToScreen) => {
      if (state.phase !== "windup") {
        return;
      }
      const progress = 1 - Math.max(0, state.timer) / params.windupTime;
      const from = worldToScreen(enemy.pos);
      const to = worldToScreen({ x: enemy.pos.x + state.aim.x * params.dashDistance, y: enemy.pos.y + state.aim.y * params.dashDistance });
      ctx.strokeStyle = `rgba(${DASH_TELEGRAPH_COLOR}, ${0.15 + 0.55 * progress})`;
      ctx.lineWidth = enemy.template.radius * 2 * (0.4 + 0.6 * progress);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.lineWidth = 1;
    },
  },

  bomber: {
    createState: (): BomberState => ({ fuseLeft: null }),
    update: (enemy, context, params, state: BomberState) => {
      const to = towardPlayer(enemy, context);
      if (state.fuseLeft === null) {
        enemy.moveVelocity.x = to.x * enemy.speed;
        enemy.moveVelocity.y = to.y * enemy.speed;
        if (to.dist < params.fuseRange) {
          state.fuseLeft = params.fuseTime;
        }
        return;
      }
      // Lit: stands still (knockback can still move it) until it goes off.
      enemy.moveVelocity.x = 0;
      enemy.moveVelocity.y = 0;
      state.fuseLeft -= context.dt;
      if (state.fuseLeft > 0) {
        return;
      }
      if (to.dist <= params.explosionRadius + context.player.radius) {
        context.hurtPlayer(enemy.damage);
      }
      context.spawnVfx({ kind: "burst", pos: enemy.pos, life: 0.35, params: { radius: params.explosionRadius * 0.7, color: "#ff8a3d", growth: 0.5 } });
      context.spawnVfx({
        kind: "ring",
        pos: enemy.pos,
        life: 0.35,
        params: { radius: params.explosionRadius, color: "#ffd08a", width: 3, startScale: 0.6, endScale: 1, alpha: 0.9 },
      });
      enemy.health = 0;
      enemy.noReward = true;
    },
    // Lit fuse: the blast radius, pulsing faster as it nears zero.
    draw: (ctx, enemy, params, state: BomberState, worldToScreen) => {
      if (state.fuseLeft === null) {
        return;
      }
      const progress = 1 - Math.max(0, state.fuseLeft) / params.fuseTime;
      const pulse = 0.5 + 0.5 * Math.sin(progress * progress * 40);
      const p = worldToScreen(enemy.pos);
      ctx.fillStyle = `rgba(255, 80, 60, ${0.08 + 0.17 * progress + 0.1 * pulse})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, params.explosionRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 110, 80, ${0.4 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
    },
  },

  shooter: {
    createState: (): ShooterState => ({ cooldown: 1 + Math.random() * 2, windupLeft: 0, orbitSign: Math.random() < 0.5 ? 1 : -1 }),
    update: (enemy, context, params, state: ShooterState) => {
      const to = towardPlayer(enemy, context);
      if (to.dist > params.preferredRange + 40) {
        enemy.moveVelocity.x = to.x * enemy.speed;
        enemy.moveVelocity.y = to.y * enemy.speed;
      } else if (to.dist < params.preferredRange - 60) {
        enemy.moveVelocity.x = -to.x * enemy.speed * 0.8;
        enemy.moveVelocity.y = -to.y * enemy.speed * 0.8;
      } else {
        // In range: circle the player slowly instead of standing still.
        enemy.moveVelocity.x = -to.y * state.orbitSign * enemy.speed * 0.5;
        enemy.moveVelocity.y = to.x * state.orbitSign * enemy.speed * 0.5;
      }

      if (state.windupLeft > 0) {
        state.windupLeft -= context.dt;
        if (state.windupLeft <= 0) {
          const aim = predictedAim(enemy, context, params.projectileSpeed);
          context.spawnProjectile({
            team: "enemy",
            pos: enemy.pos,
            velocity: { x: aim.x * params.projectileSpeed, y: aim.y * params.projectileSpeed },
            radius: params.projectileRadius,
            damage: enemy.damage,
            life: params.projectileLife,
            color: SHOT_COLOR,
          });
          state.cooldown = params.fireInterval;
        }
        return;
      }
      state.cooldown -= context.dt;
      // Only starts a shot when close enough that the player can see it coming.
      if (state.cooldown <= 0 && to.dist < params.preferredRange + 250) {
        state.windupLeft = params.windupTime;
      }
    },
    // A glow that grows while the shot winds up.
    draw: (ctx, enemy, params, state: ShooterState, worldToScreen) => {
      if (state.windupLeft <= 0) {
        return;
      }
      const progress = 1 - state.windupLeft / params.windupTime;
      const p = worldToScreen(enemy.pos);
      ctx.fillStyle = SHOT_COLOR;
      ctx.globalAlpha = 0.25 + 0.45 * progress;
      ctx.beginPath();
      ctx.arc(p.x, p.y, enemy.template.radius * (1.2 + 0.8 * progress), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  },
};

function getBehaviorHandler(id: EnemyBehaviorId): BehaviorHandler<unknown, unknown> {
  return BEHAVIOR_REGISTRY[id] as BehaviorHandler<unknown, unknown>;
}

// ---- Visuals: shape and colors. Adding a shape means adding it to SHAPE_PATHS. ----

export type EnemyShape = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "star" | "spikeball";

// Points around (x, y) at radius r, starting straight up.
function polygonPath(ctx: CanvasRenderingContext2D, x: number, y: number, radii: readonly number[]): void {
  radii.forEach((r, i) => {
    const angle = -Math.PI / 2 + (i / radii.length) * Math.PI * 2;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  });
  ctx.closePath();
}

export interface EnemyVisual {
  shape: EnemyShape;
  color: string;
  healthBarColor: string;
  // Circles drawn on top of the shape, in order, each `scale` times the radius (e.g. a
  // glowing center).
  cores?: { color: string; scale: number }[];
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
  hexagon: (ctx, x, y, r) => polygonPath(ctx, x, y, [r, r, r, r, r, r]),
  star: (ctx, x, y, r) => polygonPath(ctx, x, y, [r, r * 0.5, r, r * 0.5, r, r * 0.5, r, r * 0.5, r, r * 0.5]),
  // A body ringed with 10 sharp spikes, like a sea mine.
  spikeball: (ctx, x, y, r) => polygonPath(ctx, x, y, Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? r : r * 0.62))),
};

// ---- Templates ----

// Base stats at difficulty 1. Health, damage, speed and XP are scaled by the current
// difficulty when the enemy spawns (see EnemyScaling and spawnEngine.ts).
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
  // Counts toward a stage's maxSpecials cap (see spawnEngine.ts).
  special: boolean;
  behavior: EnemyBehavior;
  visual: EnemyVisual;
  // Enemies spawned where this one dies, at the same difficulty scaling, flung
  // burstDistance outward from the corpse.
  onDeath?: { spawn: EnemyTemplate; count: number; burstDistance: number };
  // Other enemies within `radius` take `damageReduction` less damage (0.5 = half) while this
  // one lives. It never shields itself.
  shieldAura?: { radius: number; damageReduction: number };
}

// A push lasts this long at constant speed, so its distance is exact.
const KNOCKBACK_DURATION = 0.15;

const CHASE: EnemyBehavior = { id: "chase", params: {} };
const DASHER: EnemyBehavior = {
  id: "dasher",
  params: { triggerRange: 300, windupTime: 0.9, backupSpeed: 35, dashSpeed: 650, dashDistance: 420, recoverTime: 0.8 },
};
const SHOOTER: EnemyBehavior = {
  id: "shooter",
  params: { preferredRange: 340, fireInterval: 2.4, windupTime: 0.4, projectileSpeed: 240, projectileRadius: 6, projectileLife: 3.5 },
};
const BOMBER: EnemyBehavior = { id: "bomber", params: { fuseRange: 110, fuseTime: 1.1, explosionRadius: 120 } };
const NORMAL_VISUAL: EnemyVisual = { shape: "circle", color: "#d66565", healthBarColor: "#ff7a7a" };
const DASHER_VISUAL: EnemyVisual = { shape: "triangle", color: "#e8913a", healthBarColor: "#ffc27a" };
const SHOOTER_VISUAL: EnemyVisual = { shape: "diamond", color: "#a76ad6", healthBarColor: "#d6a8ff" };
const SPLITTER_VISUAL: EnemyVisual = { shape: "square", color: "#5fae4c", healthBarColor: "#9be27d" };
const SPLITLING_VISUAL: EnemyVisual = { shape: "square", color: "#86cf6e", healthBarColor: "#b8f0a0" };
// Dark spikes around a red-hot center, so it reads as "don't let this near you".
const BOMBER_VISUAL: EnemyVisual = {
  shape: "spikeball",
  color: "#e0892a",
  healthBarColor: "#fff08a",
  cores: [
    { color: "#3a1a10", scale: 0.55 },
    { color: "#ff4a2a", scale: 0.38 },
    { color: "#ffe08a", scale: 0.16 },
  ],
};
const SHIELDER_VISUAL: EnemyVisual = { shape: "hexagon", color: "#4f9ad6", healthBarColor: "#9ccfff" };
const MINIBOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#c6552f", healthBarColor: "#ffb07f" };
const BOSS_VISUAL: EnemyVisual = { shape: "circle", color: "#9a2a2a", healthBarColor: "#ff9d9d" };

// What a splitter breaks into. Not special, so splitlings don't use up the special cap, but
// they are normals, so they count toward maxNormals and hold back regular spawns.
const SPLITLING: EnemyTemplate = {
  kind: "normal",
  speed: 165,
  radius: 8,
  health: 10,
  xpReward: 1,
  damage: 4,
  hitInterval: 0.7,
  knockbackMultiplier: 1,
  special: false,
  behavior: CHASE,
  visual: SPLITLING_VISUAL,
};

// Shared enemy definitions, at difficulty 1. Stages reference these by id; the stage's
// difficulty does the scaling.
export const ENEMY_LIBRARY = {
  normal: { kind: "normal", speed: 60, radius: 12, health: 18, xpReward: 4, damage: 6, hitInterval: 0.9, knockbackMultiplier: 1, special: false, behavior: CHASE, visual: NORMAL_VISUAL },
  dasher: { kind: "normal", speed: 50, radius: 13, health: 22, xpReward: 6, damage: 10, hitInterval: 0.6, knockbackMultiplier: 1, special: true, behavior: DASHER, visual: DASHER_VISUAL },
  shooter: { kind: "normal", speed: 45, radius: 12, health: 16, xpReward: 6, damage: 7, hitInterval: 0.9, knockbackMultiplier: 1, special: true, behavior: SHOOTER, visual: SHOOTER_VISUAL },
  splitter: {
    kind: "normal", speed: 50, radius: 15, health: 30, xpReward: 6, damage: 8, hitInterval: 0.9, knockbackMultiplier: 1, special: true,
    behavior: CHASE, visual: SPLITTER_VISUAL, onDeath: { spawn: SPLITLING, count: 6, burstDistance: 130 },
  },
  splitling: SPLITLING,
  // `damage` is the explosion; it stops well outside contact range.
  bomber: { kind: "normal", speed: 100, radius: 13, health: 14, xpReward: 6, damage: 22, hitInterval: 1, knockbackMultiplier: 1, special: true, behavior: BOMBER, visual: BOMBER_VISUAL },
  shielder: {
    kind: "normal", speed: 40, radius: 16, health: 40, xpReward: 10, damage: 6, hitInterval: 0.9, knockbackMultiplier: 0.5, special: true,
    behavior: CHASE, visual: SHIELDER_VISUAL, shieldAura: { radius: 170, damageReduction: 0.5 },
  },
  miniboss: { kind: "miniboss", speed: 48, radius: 24, health: 116, xpReward: 22, damage: 11, hitInterval: 0.9, knockbackMultiplier: 0.5, special: false, behavior: CHASE, visual: MINIBOSS_VISUAL },
  boss: { kind: "boss", speed: 41, radius: 36, health: 304, xpReward: 63, damage: 15, hitInterval: 1, knockbackMultiplier: 0.25, special: false, behavior: CHASE, visual: BOSS_VISUAL },
} satisfies Record<string, EnemyTemplate>;

// Multipliers applied to a template's stats when an enemy spawns.
export interface EnemyScaling {
  // The raw difficulty the multipliers came from, for behaviors that scale in other ways.
  difficulty: number;
  health: number;
  damage: number;
  speed: number;
  xp: number;
}

export const NO_SCALING: EnemyScaling = { difficulty: 1, health: 1, damage: 1, speed: 1, xp: 1 };

export type EnemyId = keyof typeof ENEMY_LIBRARY;

// ---- Live enemies ----

// Per-instance state, plus the stats that difficulty scales. Everything else comes from `template`.
export interface ActiveEnemy {
  template: EnemyTemplate;
  pos: Vec2;
  health: number;
  maxHealth: number;
  // Scaled from the template when spawned; use these, not the template's.
  damage: number;
  speed: number;
  xpReward: number;
  // The scaling it spawned with, passed on to anything it spawns on death.
  scaling: EnemyScaling;
  // Damage reduction from nearby shielders this step (0 = none). Set by World each step.
  shield: number;
  // Dies without dropping XP or counting as a kill (e.g. a bomber exploding).
  noReward: boolean;
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

export function createEnemy(template: EnemyTemplate, pos: Vec2, scaling: EnemyScaling = NO_SCALING): ActiveEnemy {
  const health = template.health * scaling.health;
  return {
    template,
    pos: cloneVec2(pos),
    health,
    maxHealth: health,
    damage: template.damage * scaling.damage,
    speed: template.speed * scaling.speed,
    xpReward: template.xpReward * scaling.xp,
    scaling,
    shield: 0,
    noReward: false,
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
  // Item id the burn's damage is credited to, for the run summary.
  source: string | null;
  ticksLeft: number;
  // Counts down to the next tick.
  tickTimer: number;
}

// Burns don't stack: reapplying keeps the stronger dps and the longer remaining duration,
// so overlapping hits can't multiply burn damage. The stronger burn's source gets the credit.
export function applyBurn(enemy: ActiveEnemy, dps: number, duration: number, source: string | null = null): void {
  const ticks = Math.max(1, Math.round(duration / BURN_TICK_INTERVAL));
  if (!enemy.burn) {
    // The first tick waits a full interval, so it doesn't land on the same frame as the hit.
    enemy.burn = { dps, source, ticksLeft: ticks, tickTimer: BURN_TICK_INTERVAL };
    return;
  }
  if (dps >= enemy.burn.dps) {
    enemy.burn.dps = dps;
    enemy.burn.source = source;
  }
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

// The enemy's behavior telegraph (dash line, shot glow), if it has one right now. Drawn under
// all enemies so it never hides them.
export function drawEnemyTelegraph(ctx: CanvasRenderingContext2D, enemy: ActiveEnemy, worldToScreen: (world: Vec2) => Vec2): void {
  const aura = enemy.template.shieldAura;
  if (aura) {
    const p = worldToScreen(enemy.pos);
    ctx.fillStyle = "rgba(79, 154, 214, 0.08)";
    ctx.strokeStyle = "rgba(120, 190, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, aura.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  const behavior = enemy.template.behavior;
  getBehaviorHandler(behavior.id).draw?.(ctx, enemy, behavior.params, enemy.behaviorState, worldToScreen);
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: ActiveEnemy, screen: Vec2): void {
  const { radius, visual } = enemy.template;
  ctx.fillStyle = visual.color;
  ctx.beginPath();
  SHAPE_PATHS[visual.shape](ctx, screen.x, screen.y, radius);
  ctx.fill();
  for (const core of visual.cores ?? []) {
    ctx.fillStyle = core.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * core.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  if (enemy.shield > 0) {
    ctx.strokeStyle = "#9ccfff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    SHAPE_PATHS[visual.shape](ctx, screen.x, screen.y, radius + 4);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

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
