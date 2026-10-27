import type { Vec2 } from "./types.js";
import type { Player } from "./player.js";
import type { ActiveEnemy } from "./spawnEngine.js";

export type EffectId = "default_shoot" | "damage_aura";

export interface ItemEffectDefinition {
  effectId: EffectId;
  params: Record<string, number>;
}

export interface ItemDefinition {
  id: string;
  name: string;
  effects: ItemEffectDefinition[];
}

export interface ItemEffectContext {
  dt: number;
  player: Player;
  enemies: ActiveEnemy[];
  damageEnemy: (enemy: ActiveEnemy, amount: number, source: EffectId) => void;
}

export interface ItemDrawContext {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  player: Player;
  worldToScreen: (world: Vec2) => Vec2;
}

type EffectRuntimeState = Record<string, unknown>;
type EffectUpdateHandler = (
  context: ItemEffectContext,
  params: Record<string, number>,
  state: EffectRuntimeState,
) => void;

type EffectDrawHandler = (
  context: ItemDrawContext,
  params: Record<string, number>,
  state: EffectRuntimeState,
) => void;

interface EffectHandler {
  update: EffectUpdateHandler;
  draw: EffectDrawHandler;
}

interface ShotTrail {
  from: Vec2;
  to: Vec2;
  life: number;
  maxLife: number;
}

interface DefaultShootState extends EffectRuntimeState {
  cooldown?: number;
  trails?: ShotTrail[];
}

interface AuraPulse {
  radius: number;
  life: number;
  maxLife: number;
}

interface DamageAuraState extends EffectRuntimeState {
  cooldown?: number;
  pulses?: AuraPulse[];
}

function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

const EFFECT_REGISTRY: Record<EffectId, EffectHandler> = {
  default_shoot: {
    update: (context, params, runtimeState) => {
      const state = runtimeState as DefaultShootState;
      const trails = (state.trails ??= []);
      const interval = (params.interval ?? 0.4) / Math.max(0.15, context.player.stats.attackRateMultiplier);
      const damage = (params.damage ?? 6) * context.player.stats.attackDamageMultiplier;
      const range = (params.range ?? 420) * context.player.stats.attackSizeMultiplier;

      for (let i = trails.length - 1; i >= 0; i -= 1) {
        trails[i].life -= context.dt;
        if (trails[i].life <= 0) {
          trails.splice(i, 1);
        }
      }

      state.cooldown = Math.max(0, (state.cooldown ?? 0) - context.dt);
      if ((state.cooldown ?? 0) > 0) {
        return;
      }

      let target: ActiveEnemy | null = null;
      let bestDistSq = range * range;
      for (const enemy of context.enemies) {
        const dx = enemy.pos.x - context.player.pos.x;
        const dy = enemy.pos.y - context.player.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= bestDistSq) {
          bestDistSq = distSq;
          target = enemy;
        }
      }

      if (!target) {
        return;
      }

      context.damageEnemy(target, damage, "default_shoot");
      trails.push({
        from: cloneVec2(context.player.pos),
        to: cloneVec2(target.pos),
        life: 0.08,
        maxLife: 0.08,
      });
      state.cooldown = interval;
    },
    draw: (context, _params, runtimeState) => {
      const state = runtimeState as DefaultShootState;
      const trails = state.trails ?? [];
      for (const trail of trails) {
        const alpha = Math.max(0, trail.life / trail.maxLife);
        const from = context.worldToScreen(trail.from);
        const to = context.worldToScreen(trail.to);
        context.ctx.strokeStyle = `rgba(255, 239, 179, ${alpha})`;
        context.ctx.lineWidth = 2;
        context.ctx.beginPath();
        context.ctx.moveTo(from.x, from.y);
        context.ctx.lineTo(to.x, to.y);
        context.ctx.stroke();
      }
    },
  },

  damage_aura: {
    update: (context, params, runtimeState) => {
      const state = runtimeState as DamageAuraState;
      const pulses = (state.pulses ??= []);
      const radius = (params.radius ?? 120) * context.player.stats.attackSizeMultiplier;
      const damage = (params.damage ?? 3) * context.player.stats.attackDamageMultiplier;
      const interval = params.interval ?? 0.3;
      const radiusSq = radius * radius;

      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        pulses[i].life -= context.dt;
        if (pulses[i].life <= 0) {
          pulses.splice(i, 1);
        }
      }

      state.cooldown = Math.max(0, (state.cooldown ?? 0) - context.dt);
      if ((state.cooldown ?? 0) > 0) {
        return;
      }

      for (const enemy of context.enemies) {
        const dx = enemy.pos.x - context.player.pos.x;
        const dy = enemy.pos.y - context.player.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= radiusSq) {
          context.damageEnemy(enemy, damage, "damage_aura");
        }
      }

      pulses.push({ radius, life: 0.28, maxLife: 0.28 });
      state.cooldown = interval;
    },
    draw: (context, params, runtimeState) => {
      const state = runtimeState as DamageAuraState;
      const radius = (params.radius ?? 120) * context.player.stats.attackSizeMultiplier;

      context.ctx.strokeStyle = "rgba(255, 156, 102, 0.22)";
      context.ctx.lineWidth = 2;
      context.ctx.beginPath();
      context.ctx.arc(context.canvas.width / 2, context.canvas.height / 2, radius, 0, Math.PI * 2);
      context.ctx.stroke();

      const pulses = state.pulses ?? [];
      for (const pulse of pulses) {
        const alpha = Math.max(0, pulse.life / pulse.maxLife);
        const t = 1 - alpha;
        const pulseRadius = pulse.radius * (0.92 + t * 0.16);
        context.ctx.strokeStyle = `rgba(255, 153, 102, ${alpha * 0.7})`;
        context.ctx.lineWidth = 3;
        context.ctx.beginPath();
        context.ctx.arc(context.canvas.width / 2, context.canvas.height / 2, pulseRadius, 0, Math.PI * 2);
        context.ctx.stroke();
      }
    },
  },
};

export const ITEM_DEFINITIONS: Record<string, ItemDefinition> = {
  starter_blaster: {
    id: "starter_blaster",
    name: "Default Attack",
    effects: [
      {
        effectId: "default_shoot",
        params: {
          interval: 0.35,
          damage: 7,
          range: 480,
        },
      },
    ],
  },
  aura: {
    id: "aura",
    name: "Aura",
    effects: [
      {
        effectId: "damage_aura",
        params: {
          radius: 140,
          damage: 2,
          interval: 0.25,
        },
      },
    ],
  },
};

export const DEFAULT_EQUIPPED_ITEM_IDS = ["starter_blaster", "aura"];

export interface ItemSystemState {
  effectStates: Record<string, EffectRuntimeState>;
}

export function createItemSystemState(): ItemSystemState {
  return { effectStates: {} };
}

export function updateItemEffects(
  context: ItemEffectContext,
  equippedItemIds: string[],
  state: ItemSystemState,
): void {
  for (const itemId of equippedItemIds) {
    const item = ITEM_DEFINITIONS[itemId];
    if (!item) {
      continue;
    }

    for (let effectIndex = 0; effectIndex < item.effects.length; effectIndex += 1) {
      const effect = item.effects[effectIndex];
      const key = `${item.id}:${effectIndex}`;
      const effectState = (state.effectStates[key] ??= {});
      const handler = EFFECT_REGISTRY[effect.effectId];
      handler.update(context, effect.params, effectState);
    }
  }
}

export function drawItemEffects(
  context: ItemDrawContext,
  equippedItemIds: string[],
  state: ItemSystemState,
): void {
  for (const itemId of equippedItemIds) {
    const item = ITEM_DEFINITIONS[itemId];
    if (!item) {
      continue;
    }

    for (let effectIndex = 0; effectIndex < item.effects.length; effectIndex += 1) {
      const effect = item.effects[effectIndex];
      const key = `${item.id}:${effectIndex}`;
      const effectState = (state.effectStates[key] ??= {});
      const handler = EFFECT_REGISTRY[effect.effectId];
      handler.draw(context, effect.params, effectState);
    }
  }
}
