import { defineActiveItem, timeCooldown } from "../itemTypes.js";

// Active: for a few seconds, every passive item runs faster (World gives them a longer
// substep), so they fire, pulse and spin more often. Fixed duration, long recharge.

const COLOR = "255, 214, 102";

export const overcharge = defineActiveItem({
  id: "overcharge",
  name: "Overcharge",
  description: "Active: for a few seconds, all your weapons attack twice as fast.",
  maxLevel: 5,
  params: {
    // How many times faster passive items run.
    speedup: 2,
    duration: 4,
    // Seconds to recharge, counted from when it is used.
    cooldown: 18,
  },
  scaling: {},
  perLevel: {
    duration: 0.5,
    cooldown: -1,
  },

  // Starts fully charged. `activeLeft` is the time left on the effect, for the glow.
  createState: () => ({ sinceUse: Infinity, activeLeft: 0 }),

  update(context, _params, state) {
    state.sinceUse += context.dt;
    state.activeLeft = Math.max(0, state.activeLeft - context.dt);
  },

  getCooldown(params, state) {
    return timeCooldown(state.sinceUse, params.cooldown);
  },

  activate(context, params, state) {
    const player = context.player;
    player.itemHasteMultiplier = params.speedup;
    player.itemHasteTime = params.duration;
    state.activeLeft = params.duration;
    context.spawnVfx({
      kind: "ring",
      pos: player.pos,
      anchor: player.pos,
      life: 0.35,
      layer: "above",
      params: { radius: 60, color: `rgb(${COLOR})`, width: 4, startScale: 0.3, endScale: 1, alpha: 0.9 },
    });
    state.sinceUse = 0;
  },

  // A flickering glow around the player while it lasts, fading out at the end.
  draw(context, _params, state) {
    if (state.activeLeft <= 0) {
      return;
    }
    const center = context.worldToScreen(context.player.pos);
    const fade = Math.min(1, state.activeLeft / 0.5);
    const flicker = 0.75 + 0.25 * Math.random();
    context.ctx.fillStyle = `rgba(${COLOR}, ${0.18 * fade * flicker})`;
    context.ctx.beginPath();
    context.ctx.arc(center.x, center.y, context.player.radius * 2.4, 0, Math.PI * 2);
    context.ctx.fill();
    context.ctx.strokeStyle = `rgba(${COLOR}, ${0.7 * fade * flicker})`;
    context.ctx.lineWidth = 2;
    context.ctx.beginPath();
    context.ctx.arc(center.x, center.y, context.player.radius * 1.6, 0, Math.PI * 2);
    context.ctx.stroke();
  },
});
