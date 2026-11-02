import { swapRemove, type Vec2 } from "../types.js";
import { definePassiveItem, type ItemParams, type ItemUpdateContext } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// A glob of molten rock lobbed at the nearest enemy. On impact it splashes, damaging every
// enemy in the splash, and leaves a small pool of magma that hurts anything standing in it.
// The pool's damage per second is the orb's damage times poolDamageRatio, so it grows with
// damage upgrades, and the ratio itself can be raised by levels or upgrades.

const COLOR = "#d9381e";
const SPLASH_FLASH: HitFlashStyle = { radius: 10, life: 0.16, color: "#ff6a3d" };
const POOL_FLASH: HitFlashStyle = { radius: 5, life: 0.1, color: "#ff5a2a" };

interface MagmaPool {
  pos: Vec2;
  timeLeft: number;
  // Counts down to the next damage tick.
  tickTimer: number;
  // Counted rather than timed, so the pool deals exactly dps * duration.
  ticksLeft: number;
}

interface MagmaOrbState {
  cooldown: number;
  pools: MagmaPool[];
}

export const magmaOrb = definePassiveItem({
  id: "magma_orb",
  name: "Magma Orb",
  maxLevel: 5,
  params: {
    // Seconds between casts.
    interval: 1.6,
    // Targets the nearest enemy within this distance; the orb flies this far at most.
    range: 420,
    speed: 420,
    projectileRadius: 7,
    // Splash damage, dealt to every enemy in the splash.
    damage: 20,
    splashRadius: 70,
    // Pool damage per second, as a fraction of `damage`.
    poolDamageRatio: 0.25,
    poolRadius: 40,
    // Seconds the magma pool lasts.
    poolDuration: 3,
    // Seconds between pool damage ticks.
    poolTickInterval: 0.5,
  },
  scaling: {
    interval: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
    range: { stat: "attackSizeMultiplier", mode: "multiply" },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    splashRadius: { stat: "attackSizeMultiplier", mode: "multiply" },
    poolRadius: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 6,
    splashRadius: 8,
  },

  createState: (): MagmaOrbState => ({ cooldown: 0, pools: [] }),

  update(context, params, state) {
    tickPools(context, params, state);

    state.cooldown = Math.max(0, state.cooldown - context.dt);
    if (state.cooldown > 0) {
      return;
    }
    const origin = context.player.pos;
    const target = context.findNearestEnemy(origin, params.range);
    if (!target) {
      return;
    }

    const dx = target.pos.x - origin.x;
    const dy = target.pos.y - origin.y;
    const dist = Math.hypot(dx, dy) || 1;
    context.spawnProjectile({
      team: "player",
      pos: origin,
      velocity: { x: (dx / dist) * params.speed, y: (dy / dist) * params.speed },
      radius: params.projectileRadius,
      // The splash deals the damage, including to the enemy that was hit.
      damage: 0,
      life: params.range / params.speed,
      color: COLOR,
      // Params are captured at cast time, so an orb in flight keeps the stats it was cast with.
      onHit: (hitContext, pos) => {
        hitContext.forEachEnemyTouching(pos, params.splashRadius, (enemy) => {
          if (enemy.health > 0) {
            hitContext.damageEnemy(enemy, params.damage, SPLASH_FLASH);
          }
        });
        hitContext.spawnVfx({ kind: "burst", pos, life: 0.3, params: { radius: params.splashRadius * 0.6, color: "#e0482a", growth: 0.65 } });
        hitContext.spawnVfx({
          kind: "ring",
          pos,
          life: 0.3,
          params: { radius: params.splashRadius, color: "#ffb070", width: 3, startScale: 0.5, endScale: 1, alpha: 0.9 },
        });
        const ticks = Math.max(1, Math.round(params.poolDuration / params.poolTickInterval));
        state.pools.push({ pos, timeLeft: params.poolDuration, tickTimer: 0, ticksLeft: ticks });
      },
    });
    state.cooldown = params.interval;
  },

  // Magma pools; they flicker slightly and fade out over their last second.
  draw(context, params, state) {
    const { ctx } = context;
    for (const pool of state.pools) {
      const p = context.worldToScreen(pool.pos);
      const flicker = 0.85 + 0.15 * Math.sin(pool.timeLeft * 18);
      ctx.globalAlpha = 0.35 * Math.min(1, pool.timeLeft) * flicker;
      ctx.fillStyle = COLOR;
      ctx.beginPath();
      ctx.arc(p.x, p.y, params.poolRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
});

// Ticks every magma pool, damaging enemies standing in it, and removes expired ones.
function tickPools(context: ItemUpdateContext, params: ItemParams, state: MagmaOrbState): void {
  const tickDamage = params.damage * params.poolDamageRatio * params.poolTickInterval;
  for (let i = state.pools.length - 1; i >= 0; i -= 1) {
    const pool = state.pools[i];
    pool.timeLeft -= context.dt;
    pool.tickTimer -= context.dt;
    // The first tick happens right away, so an enemy that walks through still gets hurt.
    if (pool.tickTimer <= 0 && pool.ticksLeft > 0) {
      pool.tickTimer += params.poolTickInterval;
      pool.ticksLeft -= 1;
      context.forEachEnemyTouching(pool.pos, params.poolRadius, (enemy) => {
        if (enemy.health > 0) {
          context.damageEnemy(enemy, tickDamage, POOL_FLASH);
        }
      });
    }
    if (pool.timeLeft <= 0) {
      swapRemove(state.pools, i);
    }
  }
}
