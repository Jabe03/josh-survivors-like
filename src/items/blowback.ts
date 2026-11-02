import { defineActiveItem, timeCooldown } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Active: hits every enemy within a radius for a little damage and pushes it directly away
// from the player. The damage is a bonus; the push is the point.

const HIT_FLASH: HitFlashStyle = { radius: 10, life: 0.16, color: "#a8d8ff" };

export const blowback = defineActiveItem({
  id: "blowback",
  name: "Blowback",
  description: "Active: hits and knocks back every enemy around you.",
  maxLevel: 5,
  params: {
    radius: 200,
    damage: 8,
    // How far each enemy is pushed, in world units.
    distance: 150,
    // Seconds to recharge.
    cooldown: 8,
  },
  scaling: {
    radius: { stat: "attackSizeMultiplier", mode: "multiply" },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
  },
  perLevel: {
    radius: 25,
    damage: 3,
    cooldown: -1,
  },

  // Starts fully charged.
  createState: () => ({ sinceUse: Infinity }),

  update(context, _params, state) {
    state.sinceUse += context.dt;
  },

  getCooldown(params, state) {
    return timeCooldown(state.sinceUse, params.cooldown);
  },

  activate(context, params, state) {
    const origin = context.player.pos;
    context.forEachEnemyInRadius(origin, params.radius, (enemy) => {
      context.damageEnemy(enemy, params.damage, HIT_FLASH);
      context.knockbackEnemy(enemy, origin, params.distance);
    });
    context.spawnVfx({
      kind: "ring",
      pos: origin,
      anchor: origin,
      life: 0.3,
      layer: "above",
      params: { radius: params.radius, color: "#a8d8ff", width: 4, startScale: 0.3, endScale: 1, alpha: 0.9 },
    });
    state.sinceUse = 0;
  },

  // The recharge meter is drawn by the HUD; nothing persistent in the world.
  draw() {},
});
