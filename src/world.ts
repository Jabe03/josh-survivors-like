import { clampToPlayArea, cloneVec2, PLAY_AREA_HALF_SIZE, swapRemove, type Vec2 } from "./types.js";
import { SpatialHash } from "./spatialHash.js";
import { damagePlayer, healPlayer, Player } from "./player.js";
import { DEFAULT_LEVEL_CURVE, grantExperience, xpToNextLevel, type UpgradeReward } from "./leveling.js";
import { DEFAULT_SPAWN_STAGES, EnemySpawnEngine } from "./spawnEngine.js";
import { applyBurn, applyKnockback, BURN_HIT_FLASH, createEnemy, moveEnemy, tickBurn, updateEnemyBehavior, type ActiveEnemy } from "./enemies.js";
import { createProjectile, type Projectile, type ProjectileSpec } from "./projectiles.js";
import { VfxSystem, type HitFlashStyle, type VfxSpec } from "./vfx.js";

// Everything item effects and enemy behaviors are allowed to use. World implements it.
export interface SimContext {
  // Length of the current physics substep, in seconds.
  readonly dt: number;
  readonly player: Player;
  readonly enemies: readonly ActiveEnemy[];
  // Rolls for a crit and shows a hit flash (a bigger white one on crits). Returns the health
  // actually removed, which is less than the hit on overkill.
  damageEnemy(enemy: ActiveEnemy, amount: number, hitFlash?: HitFlashStyle): number;
  // Applies dodge and armor. Returns false if the hit was dodged.
  hurtPlayer(amount: number): boolean;
  healPlayer(amount: number): void;
  // Nearest enemy whose center is within range of pos, or null.
  findNearestEnemy(pos: Vec2, range: number): ActiveEnemy | null;
  // Every enemy whose center is within radius of pos.
  forEachEnemyInRadius(pos: Vec2, radius: number, visit: (enemy: ActiveEnemy) => void): void;
  // Every enemy whose body overlaps the circle at pos, for hitboxes like projectiles.
  forEachEnemyTouching(pos: Vec2, radius: number, visit: (enemy: ActiveEnemy) => void): void;
  // Pushes the enemy `distance` units directly away from `from`, scaled by its template's
  // knockbackMultiplier. Adds to the enemy's own movement rather than replacing it.
  knockbackEnemy(enemy: ActiveEnemy, from: Vec2, distance: number): void;
  // Sets the enemy burning for `duration` seconds. Burns don't stack; see applyBurn.
  burnEnemy(enemy: ActiveEnemy, dps: number, duration: number): void;
  spawnProjectile(spec: ProjectileSpec): void;
  spawnVfx(spec: VfxSpec): void;
}

export interface XpOrb {
  pos: Vec2;
  value: number;
  radius: number;
  // Scattered across the play area at the start, rather than dropped by an enemy.
  latent: boolean;
}

// Small XP orbs scattered sparsely over the whole play area, so exploring is worth a little.
// Collected ones are replaced over time, out of the player's sight.
export const LATENT_XP = {
  // How many are kept on the map. The play area is about 50 screens, so ~6 per screen.
  count: 300,
  value: 2,
  // Seconds between replacements while below `count`.
  refillInterval: 0.5,
  // Replacements appear at least this far from the player (just off-screen at 1080p).
  minRefillDistance: 1150,
};

const CRIT_FLASH_COLOR = "#ffffff";
const CRIT_FLASH_SCALE = 1.6;

// An orb is collected once it is this close to the player's edge. Fixed; only the magnet
// range (a player stat) scales.
const COLLECT_DISTANCE = 10;
const QUERY_CELL_SIZE = 96;

// Floating numbers over enemies when they take damage. Crits show bigger and white.
export const SHOW_DAMAGE_NUMBERS = true;

// Totals for the end-of-run summary.
export interface RunStats {
  kills: number;
  // Item id -> damage dealt (health actually removed). Damage from no item is under "other".
  damageBySource: Map<string, number>;
}

// One run's simulation: player, enemies, items, projectiles, XP and visual effects.
export class World implements SimContext {
  readonly runStats: RunStats = { kills: 0, damageBySource: new Map() };
  // Item id that damage dealt right now is credited to. Set while an item updates or
  // activates, and restored from projectiles and burns, so items don't have to pass it.
  private damageSource: string | null = null;
  readonly player = new Player(xpToNextLevel(1, DEFAULT_LEVEL_CURVE));
  readonly enemies: ActiveEnemy[] = [];
  readonly xpOrbs: XpOrb[] = [];
  readonly projectiles: Projectile[] = [];
  readonly vfx = new VfxSystem();
  readonly spawnEngine = new EnemySpawnEngine(DEFAULT_SPAWN_STAGES);
  dt = 0;
  // Set by requestActiveItemUse, handled during the next step.
  private activeItemRequested = false;
  private latentOrbCount = 0;
  private latentRefillTimer = 0;

  constructor() {
    for (let i = 0; i < LATENT_XP.count; i += 1) {
      this.spawnLatentOrb(0);
    }
  }

  // Rebuilt each substep after enemies move, for item and projectile queries.
  private readonly queryGrid = new SpatialHash();
  private readonly separationGrid = new SpatialHash();
  private maxEnemyRadius = 0;

  // Advances one frame. `move` is the normalized input direction. Returns the upgrade rewards
  // earned, in order; stops early when there are any so the game can pause for the choice.
  step(frameDt: number, move: Vec2): UpgradeReward[] {
    // Substeps improve collision stability when frame time spikes.
    const steps = Math.max(1, Math.ceil(frameDt / 0.016));
    const stepDt = frameDt / steps;
    const rewards: UpgradeReward[] = [];

    for (let i = 0; i < steps; i += 1) {
      this.dt = stepDt;
      const stepMoveX = move.x * this.player.stats.moveSpeed * stepDt;
      const stepMoveY = move.y * this.player.stats.moveSpeed * stepDt;
      const prevX = this.player.pos.x;
      const prevY = this.player.pos.y;
      this.player.pos.x += stepMoveX;
      this.player.pos.y += stepMoveY;
      clampToPlayArea(this.player.pos, this.player.radius);
      this.player.velocity.x = (this.player.pos.x - prevX) / stepDt;
      this.player.velocity.y = (this.player.pos.y - prevY) / stepDt;
      healPlayer(this.player, this.player.stats.healthRegenRate * stepDt);

      this.spawnEngine.update(stepDt, this.player.pos, this.enemies);
      this.updateEnemies(stepMoveX, stepMoveY);

      this.rebuildQueryGrid();
      this.applyShieldAuras();
      for (const item of this.player.allItems) {
        this.damageSource = item.item.id;
        item.update(this);
      }
      if (this.activeItemRequested) {
        this.activeItemRequested = false;
        this.damageSource = this.player.activeItem?.item.id ?? null;
        this.player.useActiveItem(this);
      }
      this.damageSource = null;
      this.updateProjectiles();

      // Run a couple of separation passes for tighter clusters.
      this.resolveEnemyEnemyOverlaps();
      this.resolveEnemyEnemyOverlaps();
      for (const enemy of this.enemies) {
        clampToPlayArea(enemy.pos, enemy.template.radius);
      }
      this.removeDeadEnemies();
      this.refillLatentOrbs();
      this.updateXpOrbs(rewards);
      this.vfx.update(stepDt);

      if (rewards.length > 0) {
        break;
      }
    }
    return rewards;
  }

  // ---- SimContext ----

  damageEnemy(enemy: ActiveEnemy, amount: number, hitFlash?: HitFlashStyle): number {
    const isCrit = Math.random() < this.player.stats.critChance;
    const hit = (isCrit ? amount * this.player.stats.critDamageMultiplier : amount) * (1 - enemy.shield);
    const healthBefore = enemy.health;
    enemy.health = Math.max(0, enemy.health - hit);
    const dealt = healthBefore - enemy.health;

    if (hitFlash) {
      this.vfx.spawnHitFlash(
        enemy.pos,
        isCrit ? { ...hitFlash, radius: hitFlash.radius * CRIT_FLASH_SCALE, color: CRIT_FLASH_COLOR } : hitFlash,
      );
    }
    if (dealt > 0) {
      const source = this.damageSource ?? "other";
      this.runStats.damageBySource.set(source, (this.runStats.damageBySource.get(source) ?? 0) + dealt);
      if (SHOW_DAMAGE_NUMBERS) {
        this.spawnDamageNumber(enemy, dealt, isCrit, hitFlash?.color);
      }
    }
    return dealt;
  }

  hurtPlayer(amount: number): boolean {
    return damagePlayer(this.player, amount);
  }

  healPlayer(amount: number): void {
    healPlayer(this.player, amount);
  }

  findNearestEnemy(pos: Vec2, range: number): ActiveEnemy | null {
    let nearest: ActiveEnemy | null = null;
    let bestDistSq = range * range;
    this.queryGrid.queryRadius(pos, range, (index) => {
      const enemy = this.enemies[index];
      const dx = enemy.pos.x - pos.x;
      const dy = enemy.pos.y - pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        nearest = enemy;
      }
    });
    return nearest;
  }

  forEachEnemyInRadius(pos: Vec2, radius: number, visit: (enemy: ActiveEnemy) => void): void {
    const radiusSq = radius * radius;
    this.queryGrid.queryRadius(pos, radius, (index) => {
      const enemy = this.enemies[index];
      const dx = enemy.pos.x - pos.x;
      const dy = enemy.pos.y - pos.y;
      if (dx * dx + dy * dy <= radiusSq) {
        visit(enemy);
      }
    });
  }

  knockbackEnemy(enemy: ActiveEnemy, from: Vec2, distance: number): void {
    applyKnockback(enemy, from, distance);
  }

  burnEnemy(enemy: ActiveEnemy, dps: number, duration: number): void {
    applyBurn(enemy, dps, duration, this.damageSource);
  }


  forEachEnemyTouching(pos: Vec2, radius: number, visit: (enemy: ActiveEnemy) => void): void {
    // Search wide enough to catch the largest enemy, then check exact overlap.
    this.queryGrid.queryRadius(pos, radius + this.maxEnemyRadius, (index) => {
      const enemy = this.enemies[index];
      const reach = radius + enemy.template.radius;
      const dx = enemy.pos.x - pos.x;
      const dy = enemy.pos.y - pos.y;
      if (dx * dx + dy * dy < reach * reach) {
        visit(enemy);
      }
    });
  }

  spawnProjectile(spec: ProjectileSpec): void {
    this.projectiles.push(createProjectile(spec, this.damageSource));
  }

  spawnVfx(spec: VfxSpec): void {
    this.vfx.spawn(spec);
  }

  // Uses the active item on the next step, if it is charged.
  requestActiveItemUse(): void {
    this.activeItemRequested = true;
  }

  // ---- Simulation steps ----

  private spawnDamageNumber(enemy: ActiveEnemy, dealt: number, isCrit: boolean, color: string | undefined): void {
    const text = dealt >= 1 ? String(Math.round(dealt)) : dealt.toFixed(1);
    // A little sideways jitter so numbers from rapid hits don't stack exactly.
    const pos = { x: enemy.pos.x + (Math.random() - 0.5) * 12, y: enemy.pos.y - enemy.template.radius };
    this.vfx.spawn({
      kind: "text",
      pos,
      life: isCrit ? 0.7 : 0.5,
      layer: "above",
      params: isCrit ? { text, color: CRIT_FLASH_COLOR, size: 16, rise: 30 } : { text, color: color ?? "#ffe9b0", size: 11, rise: 22 },
    });
  }

  private updateEnemies(stepMoveX: number, stepMoveY: number): void {
    for (const enemy of this.enemies) {
      enemy.hitCooldown = Math.max(0, enemy.hitCooldown - this.dt);
      // Read before ticking, since the last tick clears the burn.
      const burnSource = enemy.burn?.source ?? null;
      const burnDamage = tickBurn(enemy, this.dt);
      if (burnDamage > 0) {
        this.damageSource = burnSource;
        this.damageEnemy(enemy, burnDamage, BURN_HIT_FLASH);
        this.damageSource = null;
      }
      updateEnemyBehavior(enemy, this);
      moveEnemy(enemy, this.dt);

      const overlap = this.resolvePlayerEnemyOverlap(enemy, stepMoveX, stepMoveY);
      if (overlap && enemy.hitCooldown === 0) {
        // The cooldown resets even on a dodge, so the enemy can't re-roll every substep.
        this.hurtPlayer(enemy.damage);
        enemy.hitCooldown = enemy.template.hitInterval;
      }
    }
  }

  private rebuildQueryGrid(): void {
    this.maxEnemyRadius = 0;
    for (const enemy of this.enemies) {
      this.maxEnemyRadius = Math.max(this.maxEnemyRadius, enemy.template.radius);
    }
    this.queryGrid.build(this.enemies, QUERY_CELL_SIZE);
  }

  private updateProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.life -= this.dt;
      projectile.pos.x += projectile.velocity.x * this.dt;
      projectile.pos.y += projectile.velocity.y * this.dt;

      if (projectile.team === "player") {
        this.damageSource = projectile.source;
        this.forEachEnemyTouching(projectile.pos, projectile.radius, (enemy) => {
          if (projectile.pierceLeft <= 0 || enemy.health <= 0 || projectile.hitEnemies.has(enemy)) {
            return;
          }
          if (projectile.damage > 0) {
            this.damageEnemy(enemy, projectile.damage, projectile.hitFlash);
          }
          projectile.hitEnemies.add(enemy);
          projectile.pierceLeft -= 1;
          projectile.onHit?.(this, cloneVec2(projectile.pos), enemy);
        });
        this.damageSource = null;
      } else {
        const reach = projectile.radius + this.player.radius;
        if (Math.hypot(this.player.pos.x - projectile.pos.x, this.player.pos.y - projectile.pos.y) < reach) {
          this.hurtPlayer(projectile.damage);
          projectile.pierceLeft = 0;
        }
      }

      if (projectile.life <= 0 || projectile.pierceLeft <= 0) {
        swapRemove(this.projectiles, i);
      }
    }
  }

  // Pulls and collects XP orbs, adding any upgrade rewards earned to `rewards`.
  private updateXpOrbs(rewards: UpgradeReward[]): void {
    const player = this.player;
    const magnetRange = player.stats.magnetRange;
    const collectRange = player.radius + COLLECT_DISTANCE;

    for (let i = this.xpOrbs.length - 1; i >= 0; i -= 1) {
      const orb = this.xpOrbs[i];
      const dx = player.pos.x - orb.pos.x;
      const dy = player.pos.y - orb.pos.y;
      const dist = Math.hypot(dx, dy) || 1;

      if (dist < magnetRange) {
        const pullSpeed = 180 + (magnetRange - dist) * 2.2;
        orb.pos.x += (dx / dist) * pullSpeed * this.dt;
        orb.pos.y += (dy / dist) * pullSpeed * this.dt;
      }

      if (dist < collectRange + orb.radius) {
        const gainedXp = orb.value * player.stats.xpMultiplier;
        rewards.push(...grantExperience(player.progression, gainedXp, DEFAULT_LEVEL_CURVE));
        if (orb.latent) {
          this.latentOrbCount -= 1;
        }
        swapRemove(this.xpOrbs, i);
      }
    }
  }

  // Places a latent orb at a random spot in the play area at least `minDistance` from the player.
  private spawnLatentOrb(minDistance: number): void {
    const margin = 20;
    const span = PLAY_AREA_HALF_SIZE - margin;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const pos = { x: (Math.random() * 2 - 1) * span, y: (Math.random() * 2 - 1) * span };
      if (Math.hypot(pos.x - this.player.pos.x, pos.y - this.player.pos.y) >= minDistance) {
        this.xpOrbs.push({ pos, value: LATENT_XP.value, radius: 4, latent: true });
        this.latentOrbCount += 1;
        return;
      }
    }
  }

  private refillLatentOrbs(): void {
    if (this.latentOrbCount >= LATENT_XP.count) {
      return;
    }
    this.latentRefillTimer -= this.dt;
    if (this.latentRefillTimer <= 0) {
      this.latentRefillTimer = LATENT_XP.refillInterval;
      this.spawnLatentOrb(LATENT_XP.minRefillDistance);
    }
  }

  // Recomputes every enemy's shield from the living shielders around it. Uses the query grid,
  // so it runs after rebuildQueryGrid.
  private applyShieldAuras(): void {
    for (const enemy of this.enemies) {
      enemy.shield = 0;
    }
    for (const shielder of this.enemies) {
      const aura = shielder.template.shieldAura;
      if (!aura || shielder.health <= 0) {
        continue;
      }
      this.forEachEnemyInRadius(shielder.pos, aura.radius, (enemy) => {
        if (enemy !== shielder) {
          enemy.shield = Math.max(enemy.shield, aura.damageReduction);
        }
      });
    }
  }

  private removeDeadEnemies(): void {
    const spawned: ActiveEnemy[] = [];
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.health > 0) {
        continue;
      }
      if (!enemy.noReward) {
        this.xpOrbs.push({ pos: cloneVec2(enemy.pos), value: enemy.xpReward, radius: 5, latent: false });
        this.runStats.kills += 1;
      }
      const onDeath = enemy.template.onDeath;
      if (onDeath) {
        // Spread evenly around the corpse so they don't spawn stacked.
        for (let k = 0; k < onDeath.count; k += 1) {
          const angle = (k / onDeath.count) * Math.PI * 2 + Math.random();
          const offset = enemy.template.radius;
          const pos = { x: enemy.pos.x + Math.cos(angle) * offset, y: enemy.pos.y + Math.sin(angle) * offset };
          const child = createEnemy(onDeath.spawn, pos, enemy.scaling);
          applyKnockback(child, enemy.pos, onDeath.burstDistance);
          spawned.push(child);
        }
      }
      swapRemove(this.enemies, i);
    }
    this.enemies.push(...spawned);
  }

  private resolvePlayerEnemyOverlap(enemy: ActiveEnemy, moveX: number, moveY: number): boolean {
    const player = this.player;
    const dx = player.pos.x - enemy.pos.x;
    const dy = player.pos.y - enemy.pos.y;
    const minDist = player.radius + enemy.template.radius;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) {
      return false;
    }

    // If centers coincide, push along player movement direction when possible.
    let nx = dist > 0 ? dx / dist : 0;
    let ny = dist > 0 ? dy / dist : 0;
    if (dist === 0) {
      const moveLen = Math.hypot(moveX, moveY);
      if (moveLen > 0) {
        nx = moveX / moveLen;
        ny = moveY / moveLen;
      } else {
        nx = 1;
        ny = 0;
      }
    }

    const penetration = minDist - dist;
    enemy.pos.x -= nx * penetration;
    enemy.pos.y -= ny * penetration;
    return true;
  }

  private resolveEnemyEnemyOverlaps(): void {
    // Cells are as wide as the largest possible overlap distance, so any overlapping
    // pair sits in the same or an adjacent cell.
    let maxRadius = 0;
    for (const enemy of this.enemies) {
      maxRadius = Math.max(maxRadius, enemy.template.radius);
    }
    const grid = this.separationGrid;
    grid.build(this.enemies, maxRadius * 2);

    for (let i = 0; i < this.enemies.length; i += 1) {
      const a = this.enemies[i];
      const cx = grid.cellCoord(a.pos.x);
      const cy = grid.cellCoord(a.pos.y);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const bucket = grid.bucket(cx + ox, cy + oy);
          if (!bucket) {
            continue;
          }
          for (const j of bucket) {
            // Each pair once, matching the old i < j loop.
            if (j > i) {
              separateEnemyPair(a, this.enemies[j]);
            }
          }
        }
      }
    }
  }
}

function separateEnemyPair(a: ActiveEnemy, b: ActiveEnemy): void {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const minDist = a.template.radius + b.template.radius;
  const dist = Math.hypot(dx, dy);
  if (dist >= minDist) {
    return;
  }

  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  const penetration = minDist - dist;
  const push = penetration / 2;

  a.pos.x -= nx * push;
  a.pos.y -= ny * push;
  b.pos.x += nx * push;
  b.pos.y += ny * push;
}
