import { swapRemove, type Vec2 } from "../types.js";
import type { ActiveEnemy } from "../enemies.js";
import { definePassiveItem, type ItemUpdateContext } from "../itemTypes.js";
import type { HitFlashStyle } from "../vfx.js";

// Orbs that circle the player and damage enemies they touch. Each orb has a damage budget
// and dissipates once it is spent, so orbitals can't grind through a crowd forever. A wave
// lasts up to `duration`; the resummon cooldown only starts once the last orb is gone.

const COLOR = "#b9a6ff";
const HIT_FLASH: HitFlashStyle = { radius: 8, life: 0.12, color: COLOR };

interface Orb {
  // Fixed place in the ring, as a fraction of a full turn.
  slot: number;
  damageLeft: number;
  // Budget at summon time, for fading the orb as it is spent.
  damageBudget: number;
  // Seconds until each recently hit enemy can be hit by this orb again.
  hitCooldowns: Map<ActiveEnemy, number>;
}

interface OrbitalsState {
  // "active": orbs are out, `timer` is the time left in the wave. "cooldown": no orbs,
  // `timer` is the time until the next summon.
  phase: "active" | "cooldown";
  timer: number;
  angle: number;
  orbs: Orb[];
}

function orbPosition(center: Vec2, angle: number, slot: number, orbitRadius: number): Vec2 {
  const a = angle + slot * Math.PI * 2;
  return { x: center.x + Math.cos(a) * orbitRadius, y: center.y + Math.sin(a) * orbitRadius };
}

function dissipate(context: ItemUpdateContext, pos: Vec2, size: number): void {
  context.spawnVfx({ kind: "burst", pos, life: 0.25, params: { radius: size, color: COLOR, growth: 1.2 } });
}

export const orbitals = definePassiveItem({
  id: "orbitals",
  name: "Orbitals",
  description: "Orbs circle you, each until its damage is spent.",
  maxLevel: 5,
  params: {
    count: 2,
    // Distance from the player to each orb's center.
    orbitRadius: 90,
    // Radians per second.
    orbitSpeed: 3.2,
    // Radius of each orb.
    size: 11,
    damage: 8,
    // Total damage one orb can deal before it dissipates.
    damageBudget: 200,
    // Seconds before the same orb can hit the same enemy again.
    hitInterval: 0.4,
    // Seconds a wave of orbs lasts if their budgets are not spent first.
    duration: 6,
    // Seconds between the last orb dissipating and the next wave.
    cooldown: 3,
  },
  scaling: {
    orbitRadius: { stat: "attackSizeMultiplier", mode: "multiply" },
    size: { stat: "attackSizeMultiplier", mode: "multiply" },
    damage: { stat: "attackDamageMultiplier", mode: "multiply" },
    // Scaled with damage so damage upgrades don't just make orbs burn out faster.
    damageBudget: { stat: "attackDamageMultiplier", mode: "multiply" },
    cooldown: { stat: "attackRateMultiplier", mode: "divide", minStat: 0.15 },
  },
  perLevel: {
    count: 1,
    damageBudget: 50,
  },

  // Starts with an expired cooldown, so the first wave appears immediately.
  createState: (): OrbitalsState => ({ phase: "cooldown", timer: 0, angle: 0, orbs: [] }),

  update(context, params, state) {
    state.timer -= context.dt;
    if (state.phase === "cooldown") {
      if (state.timer > 0) {
        return;
      }
      const count = Math.max(1, Math.round(params.count));
      for (let i = 0; i < count; i += 1) {
        state.orbs.push({ slot: i / count, damageLeft: params.damageBudget, damageBudget: params.damageBudget, hitCooldowns: new Map() });
      }
      state.phase = "active";
      state.timer = params.duration;
    }

    state.angle = (state.angle + params.orbitSpeed * context.dt) % (Math.PI * 2);
    const expired = state.timer <= 0;

    for (let i = state.orbs.length - 1; i >= 0; i -= 1) {
      const orb = state.orbs[i];
      const pos = orbPosition(context.player.pos, state.angle, orb.slot, params.orbitRadius);

      for (const [enemy, cooldown] of orb.hitCooldowns) {
        if (cooldown <= context.dt) {
          orb.hitCooldowns.delete(enemy);
        } else {
          orb.hitCooldowns.set(enemy, cooldown - context.dt);
        }
      }

      if (!expired) {
        context.forEachEnemyTouching(pos, params.size, (enemy) => {
          if (orb.damageLeft <= 0 || enemy.health <= 0 || orb.hitCooldowns.has(enemy)) {
            return;
          }
          // The budget counts health actually removed, so overkill on a weak enemy is not wasted.
          orb.damageLeft -= context.damageEnemy(enemy, Math.min(params.damage, orb.damageLeft), HIT_FLASH);
          orb.hitCooldowns.set(enemy, params.hitInterval);
        });
      }

      if (expired || orb.damageLeft <= 0) {
        dissipate(context, pos, params.size);
        swapRemove(state.orbs, i);
      }
    }

    if (state.orbs.length === 0) {
      state.phase = "cooldown";
      state.timer = params.cooldown;
    }
  },

  // Each orb fades as its damage budget is spent.
  draw(context, params, state) {
    const { ctx } = context;
    for (const orb of state.orbs) {
      const p = context.worldToScreen(orbPosition(context.player.pos, state.angle, orb.slot, params.orbitRadius));
      ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, orb.damageLeft / orb.damageBudget);
      ctx.fillStyle = COLOR;
      ctx.beginPath();
      ctx.arc(p.x, p.y, params.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f0ebff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
});
