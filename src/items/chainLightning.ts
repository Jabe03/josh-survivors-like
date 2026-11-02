import { cloneVec2 } from "../types.js";
import type { ActiveEnemy } from "../enemies.js";
import { definePassiveItem } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Zaps the nearest enemy, then arcs from each target to the nearest enemy it hasn't hit yet.
// The number of jumps is fixed and each enemy is hit at most once per chain, so it can't
// bounce around a crowd forever. Each jump deals a fraction of the previous one's damage.

const COLOR = "#7fd4ff";
const HIT_FLASH: HitFlashStyle = { radius: 9, life: 0.14, color: COLOR };

export const chainLightning = definePassiveItem({
  id: "chain_lightning",
  name: "Chain Lightning",
  description: "Lightning strikes a nearby enemy, then arcs to others close by.",
  maxLevel: 5,
  params: {
    interval: 1.4,
    damage: 12,
    // How far from the player the first target can be.
    range: 380,
    // Extra enemies hit after the first.
    jumps: 3,
    // How far each arc can reach from the last target.
    jumpRange: 150,
    // Each jump deals this fraction of the previous hit's damage.
    jumpDamageRatio: 0.8,
  },
  scaling: {
    interval: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    jumpRange: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 4,
    jumps: 1,
  },

  createState: () => ({ cooldown: 0 }),

  update(context, params, state) {
    state.cooldown = Math.max(0, state.cooldown - context.dt);
    if (state.cooldown > 0) {
      return;
    }
    const first = context.findNearestEnemy(context.player.pos, params.range);
    if (!first) {
      return;
    }

    const hit = new Set<ActiveEnemy>();
    let from = cloneVec2(context.player.pos);
    let target: ActiveEnemy | null = first;
    let damage = params.damage;
    for (let i = 0; i <= Math.floor(params.jumps) && target; i += 1) {
      const to = cloneVec2(target.pos);
      context.spawnVfx({ kind: "bolt", pos: from, life: 0.16, layer: "above", params: { to, color: COLOR, width: 2, jitter: 7 } });
      context.damageEnemy(target, damage, HIT_FLASH);
      hit.add(target);
      from = to;
      damage *= params.jumpDamageRatio;

      // Next: the nearest enemy to this one that the chain hasn't hit.
      let next: ActiveEnemy | null = null;
      let bestDistSq = params.jumpRange * params.jumpRange;
      context.forEachEnemyInRadius(to, params.jumpRange, (enemy) => {
        if (hit.has(enemy) || enemy.health <= 0) {
          return;
        }
        const distSq = (enemy.pos.x - to.x) ** 2 + (enemy.pos.y - to.y) ** 2;
        if (distSq <= bestDistSq) {
          bestDistSq = distSq;
          next = enemy;
        }
      });
      // The cast undoes narrowing to null, since TS doesn't track the callback's assignment.
      target = next as ActiveEnemy | null;
    }
    state.cooldown = params.interval;
  },

  // The bolts are one-off VFX spawned in update; nothing persistent to draw.
  draw() {},
});
