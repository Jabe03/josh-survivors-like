import { cloneVec2, type Vec2 } from "./types.js";
import type { ActiveEnemy } from "./enemies.js";
import type { HitFlashStyle } from "./vfx.js";
import type { SimContext } from "./world.js";

// Called after a player projectile hits an enemy, with where the hit happened (e.g. to explode).
export type ProjectileHitHandler = (context: SimContext, pos: Vec2, enemy: ActiveEnemy) => void;

// "player" projectiles hit enemies; "enemy" projectiles hit the player.
export type ProjectileTeam = "player" | "enemy";

export interface ProjectileSpec {
  team: ProjectileTeam;
  pos: Vec2;
  velocity: Vec2;
  radius: number;
  // Direct-hit damage. 0 skips the direct hit, for projectiles whose onHit does the damage.
  damage: number;
  // Seconds before it disappears on its own.
  life: number;
  // How many enemies it can hit before disappearing (default 1). Ignored for enemy projectiles.
  pierce?: number;
  color: string;
  hitFlash?: HitFlashStyle;
  onHit?: ProjectileHitHandler;
}

export interface Projectile {
  team: ProjectileTeam;
  pos: Vec2;
  velocity: Vec2;
  radius: number;
  damage: number;
  life: number;
  pierceLeft: number;
  color: string;
  hitFlash?: HitFlashStyle;
  onHit?: ProjectileHitHandler;
  // Item id its damage is credited to, for the run summary. Set by World, not by the item.
  source: string | null;
  // Enemies already hit, so a piercing shot damages each one only once.
  hitEnemies: Set<ActiveEnemy>;
}

export function createProjectile(spec: ProjectileSpec, source: string | null = null): Projectile {
  return {
    team: spec.team,
    pos: cloneVec2(spec.pos),
    velocity: cloneVec2(spec.velocity),
    radius: spec.radius,
    damage: spec.damage,
    life: spec.life,
    pierceLeft: spec.pierce ?? 1,
    color: spec.color,
    hitFlash: spec.hitFlash,
    onHit: spec.onHit,
    source,
    hitEnemies: new Set(),
  };
}

export function drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: readonly Projectile[], worldToScreen: (world: Vec2) => Vec2): void {
  for (const projectile of projectiles) {
    const p = worldToScreen(projectile.pos);
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
