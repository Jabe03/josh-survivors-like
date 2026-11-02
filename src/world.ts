import { cloneVec2, swapRemove, type Vec2 } from "./types.js";
import { SpatialHash } from "./spatialHash.js";
import { BASE_PICKUP_RANGE, damagePlayer, healPlayer, Player } from "./player.js";
import { DEFAULT_LEVEL_CURVE, grantExperience, xpToNextLevel } from "./leveling.js";
import { DEFAULT_SPAWN_STAGES, EnemySpawnEngine } from "./spawnEngine.js";
import { applyKnockback, moveEnemy, updateEnemyBehavior, type ActiveEnemy } from "./enemies.js";
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
  spawnProjectile(spec: ProjectileSpec): void;
  spawnVfx(spec: VfxSpec): void;
}

export interface XpOrb {
  pos: Vec2;
  value: number;
  radius: number;
}

const CRIT_FLASH_COLOR = "#ffffff";
const CRIT_FLASH_SCALE = 1.6;

const MAGNET_RANGE = 180;
const QUERY_CELL_SIZE = 96;

// One run's simulation: player, enemies, items, projectiles, XP and visual effects.
export class World implements SimContext {
  readonly player = new Player(xpToNextLevel(1, DEFAULT_LEVEL_CURVE));
  readonly enemies: ActiveEnemy[] = [];
  readonly xpOrbs: XpOrb[] = [];
  readonly projectiles: Projectile[] = [];
  readonly vfx = new VfxSystem();
  readonly spawnEngine = new EnemySpawnEngine(DEFAULT_SPAWN_STAGES);
  dt = 0;
  // Set by requestActiveItemUse, handled during the next step.
  private activeItemRequested = false;

  // Rebuilt each substep after enemies move, for item and projectile queries.
  private readonly queryGrid = new SpatialHash();
  private readonly separationGrid = new SpatialHash();
  private maxEnemyRadius = 0;

  // Advances one frame. `move` is the normalized input direction. Returns levels gained;
  // stops early on a level-up so the game can pause for the upgrade choice.
  step(frameDt: number, move: Vec2): number {
    // Substeps improve collision stability when frame time spikes.
    const steps = Math.max(1, Math.ceil(frameDt / 0.016));
    const stepDt = frameDt / steps;
    let levelsGained = 0;

    for (let i = 0; i < steps; i += 1) {
      this.dt = stepDt;
      const stepMoveX = move.x * this.player.stats.moveSpeed * stepDt;
      const stepMoveY = move.y * this.player.stats.moveSpeed * stepDt;
      this.player.pos.x += stepMoveX;
      this.player.pos.y += stepMoveY;
      healPlayer(this.player, this.player.stats.healthRegenRate * stepDt);

      this.spawnEngine.update(stepDt, this.player.pos, this.enemies);
      this.updateEnemies(stepMoveX, stepMoveY);

      this.rebuildQueryGrid();
      for (const item of this.player.allItems) {
        item.update(this);
      }
      if (this.activeItemRequested) {
        this.activeItemRequested = false;
        this.player.useActiveItem(this);
      }
      this.updateProjectiles();

      // Run a couple of separation passes for tighter clusters.
      this.resolveEnemyEnemyOverlaps();
      this.resolveEnemyEnemyOverlaps();
      this.removeDeadEnemies();
      levelsGained += this.updateXpOrbs();
      this.vfx.update(stepDt);

      if (levelsGained > 0) {
        break;
      }
    }
    return levelsGained;
  }

  // ---- SimContext ----

  damageEnemy(enemy: ActiveEnemy, amount: number, hitFlash?: HitFlashStyle): number {
    const isCrit = Math.random() < this.player.stats.critChance;
    const hit = isCrit ? amount * this.player.stats.critDamageMultiplier : amount;
    const healthBefore = enemy.health;
    enemy.health = Math.max(0, enemy.health - hit);

    if (hitFlash) {
      this.vfx.spawnHitFlash(
        enemy.pos,
        isCrit ? { ...hitFlash, radius: hitFlash.radius * CRIT_FLASH_SCALE, color: CRIT_FLASH_COLOR } : hitFlash,
      );
    }
    return healthBefore - enemy.health;
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
    this.projectiles.push(createProjectile(spec));
  }

  spawnVfx(spec: VfxSpec): void {
    this.vfx.spawn(spec);
  }

  // Uses the active item on the next step, if it is charged.
  requestActiveItemUse(): void {
    this.activeItemRequested = true;
  }

  // ---- Simulation steps ----

  private updateEnemies(stepMoveX: number, stepMoveY: number): void {
    for (const enemy of this.enemies) {
      enemy.hitCooldown = Math.max(0, enemy.hitCooldown - this.dt);
      updateEnemyBehavior(enemy, this);
      moveEnemy(enemy, this.dt);

      const overlap = this.resolvePlayerEnemyOverlap(enemy, stepMoveX, stepMoveY);
      if (overlap && enemy.hitCooldown === 0) {
        // The cooldown resets even on a dodge, so the enemy can't re-roll every substep.
        this.hurtPlayer(enemy.template.damage);
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
        this.forEachEnemyTouching(projectile.pos, projectile.radius, (enemy) => {
          if (projectile.pierceLeft <= 0 || enemy.health <= 0 || projectile.hitEnemies.has(enemy)) {
            return;
          }
          this.damageEnemy(enemy, projectile.damage, projectile.hitFlash);
          projectile.hitEnemies.add(enemy);
          projectile.pierceLeft -= 1;
        });
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

  private updateXpOrbs(): number {
    const player = this.player;
    const pickupScale = player.stats.pickupRange / BASE_PICKUP_RANGE;
    const magnetRange = MAGNET_RANGE * pickupScale;
    const pickupRange = (player.radius + 10) * pickupScale;
    let levelsGained = 0;

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

      if (dist < pickupRange + orb.radius) {
        const gainedXp = orb.value * player.stats.xpMultiplier;
        levelsGained += grantExperience(player.progression, gainedXp, DEFAULT_LEVEL_CURVE);
        swapRemove(this.xpOrbs, i);
      }
    }
    return levelsGained;
  }

  private removeDeadEnemies(): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.health <= 0) {
        this.xpOrbs.push({ pos: cloneVec2(enemy.pos), value: enemy.template.xpReward, radius: 5 });
        swapRemove(this.enemies, i);
      }
    }
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
