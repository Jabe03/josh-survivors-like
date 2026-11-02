import { cloneVec2 } from "../types.js";
import { definePassiveItem } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Hitscan shot at the nearest enemy in range.

const HIT_FLASH: HitFlashStyle = { radius: 8, life: 0.12, color: "#ffe6a8" };

export const starterBlaster = definePassiveItem({
  id: "starter_blaster",
  name: "Default Attack",
  description: "Zaps the nearest enemy in range.",
  maxLevel: 5,
  params: {
    interval: 0.35,
    damage: 7,
    range: 480,
  },
  scaling: {
    interval: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    range: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 3,
    interval: -0.03,
  },

  createState: () => ({ cooldown: 0 }),

  update(context, params, state) {
    state.cooldown = Math.max(0, state.cooldown - context.dt);
    if (state.cooldown > 0) {
      return;
    }

    const target = context.findNearestEnemy(context.player.pos, params.range);
    if (!target) {
      return;
    }

    context.damageEnemy(target, params.damage, HIT_FLASH);
    context.spawnVfx({
      kind: "line",
      pos: context.player.pos,
      life: 0.08,
      layer: "below",
      params: { to: cloneVec2(target.pos), color: "#ffefb3", width: 2 },
    });
    state.cooldown = params.interval;
  },

  // The shot trail is a one-off VFX spawned in update; nothing persistent to draw.
  draw() {},
});
