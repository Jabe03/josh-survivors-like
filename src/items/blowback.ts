import { defineActiveItem, timeCooldown } from "../itemTypes.js";

// Active: pushes every enemy within a radius directly away from the player.

export const blowback = defineActiveItem({
  id: "blowback",
  name: "Blowback",
  maxLevel: 1,
  params: {
    radius: 200,
    // How far each enemy is pushed, in world units.
    distance: 150,
    // Seconds to recharge.
    cooldown: 8,
  },
  scaling: {
    radius: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {},

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
