import { clampToPlayArea, cloneVec2, type Vec2 } from "../types.js";
import type { ActiveEnemy } from "../enemies.js";
import { defineActiveItem, timeCooldown } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Active: dashes the player a short way in the direction they're moving (or last moved),
// damaging every enemy the dash passes through, once each. The player can't be hurt during
// the dash and for a moment after it.

const COLOR = "#eadfc8";
const HIT_FLASH: HitFlashStyle = { radius: 11, life: 0.16, color: "#fff4d6" };
// Seconds between afterimages left along the path.
const AFTERIMAGE_INTERVAL = 0.025;

interface PhaseDashState {
  sinceUse: number;
  // Distance still to travel; 0 when not dashing.
  dashLeft: number;
  dir: Vec2;
  hit: Set<ActiveEnemy>;
  afterimageTimer: number;
}

export const phaseDash = defineActiveItem({
  id: "phase_dash",
  name: "Phase Dash",
  description: "Active: dash through enemies, hitting each one you pass. You can't be hurt mid-dash.",
  maxLevel: 5,
  params: {
    distance: 260,
    // Units per second while dashing.
    speed: 1400,
    damage: 20,
    // How far past the player's edge the dash hits.
    hitWidth: 16,
    // Seconds of safety after the dash ends.
    graceTime: 0.2,
    // Seconds to recharge.
    cooldown: 6,
  },
  scaling: {
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    hitWidth: { stat: "attackSizeMultiplier", mode: "multiply" },
    cooldown: { stat: "activeRechargeMultiplier", mode: "divide", minStat: 0.15 },
  },
  perLevel: {
    damage: 8,
    distance: 30,
    cooldown: -0.5,
  },

  // Starts fully charged.
  createState: (): PhaseDashState => ({ sinceUse: Infinity, dashLeft: 0, dir: { x: 1, y: 0 }, hit: new Set(), afterimageTimer: 0 }),

  update(context, params, state) {
    state.sinceUse += context.dt;
    if (state.dashLeft <= 0) {
      return;
    }
    const player = context.player;
    const step = Math.min(state.dashLeft, params.speed * context.dt);
    player.pos.x += state.dir.x * step;
    player.pos.y += state.dir.y * step;
    clampToPlayArea(player.pos, player.radius);
    state.dashLeft -= step;
    player.invulnerableTime = Math.max(player.invulnerableTime, state.dashLeft / params.speed + params.graceTime);

    context.forEachEnemyTouching(player.pos, player.radius + params.hitWidth, (enemy) => {
      if (state.hit.has(enemy)) {
        return;
      }
      state.hit.add(enemy);
      context.damageEnemy(enemy, params.damage, HIT_FLASH);
    });

    state.afterimageTimer -= context.dt;
    if (state.afterimageTimer <= 0) {
      state.afterimageTimer = AFTERIMAGE_INTERVAL;
      context.spawnVfx({ kind: "burst", pos: cloneVec2(player.pos), life: 0.22, layer: "below", params: { radius: player.radius, color: COLOR, growth: 0 } });
    }
    if (state.dashLeft <= 0) {
      state.hit.clear();
    }
  },

  getCooldown(params, state) {
    return timeCooldown(state.sinceUse, params.cooldown);
  },

  activate(context, params, state) {
    const player = context.player;
    state.dir = cloneVec2(player.facing);
    state.dashLeft = params.distance;
    state.hit.clear();
    state.afterimageTimer = 0;
    player.invulnerableTime = Math.max(player.invulnerableTime, params.distance / params.speed + params.graceTime);
    context.spawnVfx({
      kind: "ring",
      pos: player.pos,
      life: 0.25,
      layer: "below",
      params: { radius: player.radius * 2, color: COLOR, width: 3, startScale: 0.6, endScale: 1.4, alpha: 0.8 },
    });
    state.sinceUse = 0;
  },

  // The streak is one-off afterimage VFX; the recharge meter is drawn by the HUD.
  draw() {},
});
