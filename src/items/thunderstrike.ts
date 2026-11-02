import type { ActiveEnemy } from "../enemies.js";
import { definePassiveItem } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Every interval, lightning falls from the sky onto a few random enemies near the player.
// Each bolt hits a tiny area around its target, so it rewards crowds a little without
// becoming a screen-clear. Different bolts in one volley pick different targets.

const COLOR = "#c9b8ff";
const HIT_FLASH: HitFlashStyle = { radius: 10, life: 0.16, color: COLOR };
// How far above the target each bolt starts, on screen.
const BOLT_HEIGHT = 420;

export const thunderstrike = definePassiveItem({
  id: "thunderstrike",
  name: "Thunderstrike",
  description: "Lightning falls from the sky onto random enemies near you.",
  maxLevel: 5,
  params: {
    interval: 1.6,
    damage: 16,
    // Bolts per volley.
    strikes: 2,
    // Targets are picked from enemies this close to the player (about the screen).
    range: 650,
    // Each bolt also hits enemies this close to its target.
    radius: 26,
  },
  scaling: {
    interval: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    radius: { stat: "attackSizeMultiplier", mode: "multiply" },
  },
  perLevel: {
    damage: 3,
    strikes: 1,
  },

  createState: () => ({ cooldown: 0 }),

  update(context, params, state) {
    state.cooldown = Math.max(0, state.cooldown - context.dt);
    if (state.cooldown > 0) {
      return;
    }
    const candidates: ActiveEnemy[] = [];
    context.forEachEnemyInRadius(context.player.pos, params.range, (enemy) => {
      candidates.push(enemy);
    });
    if (candidates.length === 0) {
      return;
    }

    // Partial shuffle: the first `count` entries become a random pick without repeats.
    const count = Math.min(candidates.length, Math.floor(params.strikes));
    for (let i = 0; i < count; i += 1) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      const pos = { x: candidates[i].pos.x, y: candidates[i].pos.y };
      context.forEachEnemyInRadius(pos, params.radius, (enemy) => {
        context.damageEnemy(enemy, params.damage, HIT_FLASH);
      });
      context.spawnVfx({
        kind: "bolt",
        pos: { x: pos.x + (Math.random() - 0.5) * 60, y: pos.y - BOLT_HEIGHT },
        life: 0.2,
        layer: "above",
        params: { to: pos, color: COLOR, width: 2.5, jitter: 10 },
      });
      context.spawnVfx({
        kind: "ring",
        pos,
        life: 0.25,
        layer: "below",
        params: { radius: params.radius, color: COLOR, width: 2, startScale: 0.5, endScale: 1.2, alpha: 0.9 },
      });
    }
    state.cooldown = params.interval;
  },

  // The bolts are one-off VFX spawned in update; nothing persistent to draw.
  draw() {},
});
