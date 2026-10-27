import { cloneVec2, swapRemove, type Vec2 } from "./types.js";
import type { Player } from "./player.js";
import type { ActiveEnemy } from "./spawnEngine.js";

// Params for each effect. Item definitions must supply every field, so the values in
// ITEM_DEFINITIONS are the single source of truth and typos fail to compile.
interface EffectParamsMap {
  default_shoot: { interval: number; damage: number; range: number };
  damage_aura: { radius: number; damage: number; interval: number };
}

export type EffectId = keyof EffectParamsMap;

export type ItemEffectDefinition = {
  [K in EffectId]: { effectId: K; params: EffectParamsMap[K] };
}[EffectId];

export interface ItemDefinition {
  id: string;
  name: string;
  effects: ItemEffectDefinition[];
}

export interface HitFlashStyle {
  radius: number;
  life: number;
  color: string;
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

interface EffectHandler<P, S> {
  hitFlash: HitFlashStyle;
  createState: () => S;
  update: (context: ItemEffectContext, params: P, state: S) => void;
  draw: (context: ItemDrawContext, params: P, state: S) => void;
}

interface ShotTrail {
  from: Vec2;
  to: Vec2;
  life: number;
  maxLife: number;
}

interface DefaultShootState {
  cooldown: number;
  trails: ShotTrail[];
}

interface AuraPulse {
  radius: number;
  life: number;
  maxLife: number;
}

interface DamageAuraState {
  cooldown: number;
  pulses: AuraPulse[];
}

interface EffectStateMap {
  default_shoot: DefaultShootState;
  damage_aura: DamageAuraState;
}

function tickLifetimes(items: { life: number }[], dt: number): void {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    items[i].life -= dt;
    if (items[i].life <= 0) {
      swapRemove(items, i);
    }
  }
}

const EFFECT_REGISTRY: { [K in EffectId]: EffectHandler<EffectParamsMap[K], EffectStateMap[K]> } = {
  default_shoot: {
    hitFlash: { radius: 8, life: 0.12, color: "#ffe6a8" },
    createState: () => ({ cooldown: 0, trails: [] }),
    update: (context, params, state) => {
      const interval = params.interval / Math.max(0.15, context.player.stats.attackRateMultiplier);
      const damage = params.damage * context.player.stats.attackDamageMultiplier;
      const range = params.range * context.player.stats.attackSizeMultiplier;

      tickLifetimes(state.trails, context.dt);

      state.cooldown = Math.max(0, state.cooldown - context.dt);
      if (state.cooldown > 0) {
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
      state.trails.push({
        from: cloneVec2(context.player.pos),
        to: cloneVec2(target.pos),
        life: 0.08,
        maxLife: 0.08,
      });
      state.cooldown = interval;
    },
    draw: (context, _params, state) => {
      for (const trail of state.trails) {
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
    hitFlash: { radius: 10, life: 0.16, color: "#ff9966" },
    createState: () => ({ cooldown: 0, pulses: [] }),
    update: (context, params, state) => {
      const radius = params.radius * context.player.stats.attackSizeMultiplier;
      const damage = params.damage * context.player.stats.attackDamageMultiplier;
      const radiusSq = radius * radius;

      tickLifetimes(state.pulses, context.dt);

      state.cooldown = Math.max(0, state.cooldown - context.dt);
      if (state.cooldown > 0) {
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

      state.pulses.push({ radius, life: 0.28, maxLife: 0.28 });
      state.cooldown = params.interval;
    },
    draw: (context, params, state) => {
      const radius = params.radius * context.player.stats.attackSizeMultiplier;

      context.ctx.strokeStyle = "rgba(255, 156, 102, 0.22)";
      context.ctx.lineWidth = 2;
      context.ctx.beginPath();
      context.ctx.arc(context.canvas.width / 2, context.canvas.height / 2, radius, 0, Math.PI * 2);
      context.ctx.stroke();

      for (const pulse of state.pulses) {
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

// The registry is typed per effect, but an equipped item holds a mix of effects, so look
// handlers up through this erased view. createState guarantees the state matches.
function getHandler(effectId: EffectId): EffectHandler<unknown, unknown> {
  return EFFECT_REGISTRY[effectId] as EffectHandler<unknown, unknown>;
}

export function getEffectHitFlash(effectId: EffectId): HitFlashStyle {
  return EFFECT_REGISTRY[effectId].hitFlash;
}

export const ITEM_DEFINITIONS = {
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
} satisfies Record<string, ItemDefinition>;

export type ItemId = keyof typeof ITEM_DEFINITIONS;

export const DEFAULT_EQUIPPED_ITEM_IDS: ItemId[] = ["starter_blaster", "aura"];

// One per equipped slot, so equipping the same item twice gives it independent cooldowns.
export interface EquippedItem {
  item: ItemDefinition;
  effectStates: unknown[];
}

export interface ItemSystemState {
  equipped: EquippedItem[];
}

export function createItemSystemState(itemIds: readonly ItemId[] = DEFAULT_EQUIPPED_ITEM_IDS): ItemSystemState {
  const state: ItemSystemState = { equipped: [] };
  for (const itemId of itemIds) {
    equipItem(state, itemId);
  }
  return state;
}

export function equipItem(state: ItemSystemState, itemId: ItemId): EquippedItem {
  const item: ItemDefinition = ITEM_DEFINITIONS[itemId];
  const equipped: EquippedItem = {
    item,
    effectStates: item.effects.map((effect) => getHandler(effect.effectId).createState()),
  };
  state.equipped.push(equipped);
  return equipped;
}

export function updateItemEffects(context: ItemEffectContext, state: ItemSystemState): void {
  for (const equipped of state.equipped) {
    const effects = equipped.item.effects;
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
      const effect = effects[effectIndex];
      getHandler(effect.effectId).update(context, effect.params, equipped.effectStates[effectIndex]);
    }
  }
}

export function drawItemEffects(context: ItemDrawContext, state: ItemSystemState): void {
  for (const equipped of state.equipped) {
    const effects = equipped.item.effects;
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
      const effect = effects[effectIndex];
      getHandler(effect.effectId).draw(context, effect.params, equipped.effectStates[effectIndex]);
    }
  }
}
