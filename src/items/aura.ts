import { definePassiveItem } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Periodic pulse that damages every enemy within a radius of the player.

const HIT_FLASH: HitFlashStyle = { radius: 10, life: 0.16, color: "#ff9966" };

export const aura = definePassiveItem({
  id: "aura",
  name: "Aura",
  description: "Pulses damage to every enemy around you.",
  maxLevel: 5,
  params: {
    radius: 140,
    damage: 2,
    interval: 0.25,
  },
  scaling: {
    radius: { stat: "attackSizeMultiplier", mode: "multiply" },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 1,
    radius: 15,
  },

  createState: () => ({ cooldown: 0 }),

  update(context, params, state) {
    state.cooldown = Math.max(0, state.cooldown - context.dt);
    if (state.cooldown > 0) {
      return;
    }

    context.forEachEnemyInRadius(context.player.pos, params.radius, (enemy) => {
      context.damageEnemy(enemy, params.damage, HIT_FLASH);
    });
    context.spawnVfx({
      kind: "ring",
      pos: context.player.pos,
      anchor: context.player.pos,
      life: 0.28,
      layer: "below",
      params: { radius: params.radius, color: "#ff9966", width: 3, startScale: 0.92, endScale: 1.08, alpha: 0.7 },
    });
    state.cooldown = params.interval;
  },

  // Faint outline showing the aura's reach.
  draw(context, params) {
    const center = context.worldToScreen(context.player.pos);
    context.ctx.strokeStyle = "rgba(255, 156, 102, 0.22)";
    context.ctx.lineWidth = 2;
    context.ctx.beginPath();
    context.ctx.arc(center.x, center.y, params.radius, 0, Math.PI * 2);
    context.ctx.stroke();
  },
});
