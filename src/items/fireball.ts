import { definePassiveItem } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Fireball launched at the nearest enemy. On impact it explodes, damaging every enemy in the
// blast and setting them on fire. The burn's damage per second is the fireball's damage
// times burnDamageRatio, so it grows with damage upgrades, and the ratio itself can be
// raised by levels or upgrades. Burn ticking and stacking rules live in enemies.ts.

const COLOR = "#ff7a2e";
const EXPLOSION_FLASH: HitFlashStyle = { radius: 10, life: 0.16, color: "#ffb35c" };

export const fireball = definePassiveItem({
  id: "fireball",
  name: "Fireball",
  description: "Explodes on impact and sets enemies on fire.",
  maxLevel: 5,
  params: {
    // Seconds between casts.
    interval: 1.6,
    // Targets the nearest enemy within this distance; the fireball flies this far at most.
    range: 420,
    speed: 420,
    projectileRadius: 7,
    // Explosion damage, dealt to every enemy in the blast.
    damage: 20,
    explosionRadius: 70,
    // Burn damage per second, as a fraction of `damage`.
    burnDamageRatio: 0.25,
    // Seconds each enemy burns for.
    burnDuration: 3,
  },
  scaling: {
    interval: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
    range: { stat: "attackSizeMultiplier", mode: "multiply" },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    explosionRadius: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 6,
    explosionRadius: 8,
  },

  createState: () => ({ cooldown: 0 }),

  update(context, params, state) {
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
      // The explosion deals the damage, including to the enemy that was hit.
      damage: 0,
      life: params.range / params.speed,
      color: COLOR,
      // Params are captured at cast time, so a fireball in flight keeps the stats it was cast with.
      onHit: (hitContext, pos) => {
        const burnDps = params.damage * params.burnDamageRatio;
        hitContext.forEachEnemyTouching(pos, params.explosionRadius, (enemy) => {
          if (enemy.health > 0) {
            hitContext.damageEnemy(enemy, params.damage, EXPLOSION_FLASH);
            hitContext.burnEnemy(enemy, burnDps, params.burnDuration);
          }
        });
        hitContext.spawnVfx({ kind: "burst", pos, life: 0.3, params: { radius: params.explosionRadius * 0.6, color: "#ff9a3d", growth: 0.65 } });
        hitContext.spawnVfx({
          kind: "ring",
          pos,
          life: 0.3,
          params: { radius: params.explosionRadius, color: "#ffd08a", width: 3, startScale: 0.5, endScale: 1, alpha: 0.9 },
        });
      },
    });
    state.cooldown = params.interval;
  },

  // The projectile and explosion are drawn by the projectile and VFX systems.
  draw() {},
});
