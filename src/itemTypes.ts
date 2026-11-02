import type { Vec2 } from "./types.js";
import type { Player, PlayerStats } from "./player.js";
import type { SimContext } from "./world.js";

// Every param is a number, so stats and level bonuses can apply to any of them.
export type ItemParams = Record<string, number>;

// How one player stat changes one param.
export interface ParamScaling {
  stat: keyof PlayerStats;
  // "multiply": value * stat. "divide": value / max(minStat, stat), for intervals that
  // should shrink as the stat grows.
  mode: "multiply" | "divide";
  minStat?: number;
}

export type ParamScalingMap<P> = { [K in keyof P]?: ParamScaling };

// What an item can do to the world: enemy queries, damage, knockback, projectiles, VFX, healing.
export type ItemUpdateContext = SimContext;

export interface ItemDrawContext {
  ctx: CanvasRenderingContext2D;
  player: Player;
  worldToScreen: (world: Vec2) => Vec2;
}

// Data and hooks every item has, passive or active. Every field and hook is required;
// use {} or an empty function when an item does not need one.
interface ItemBase<P extends ItemParams, S> {
  id: string;
  name: string;
  // One short line for the upgrade card offering it as a new item.
  description: string;
  // 1 means the item has no levels. Capped at MAX_ITEM_LEVEL.
  maxLevel: number;
  // Base values at level 1, before player stats.
  params: P;
  // Which player stats affect which params. Params not listed are not affected.
  scaling: ParamScalingMap<P>;
  // Added to params for each level above 1.
  perLevel: Partial<P>;

  // Called once per equipped copy; the result is passed back to the other hooks.
  createState(): S;
  // Called every physics substep. Params have level bonuses and stat scaling applied.
  update(context: ItemUpdateContext, params: P, state: S): void;
  // Called every frame for visuals that last as long as the item does. One-off visuals
  // should use context.spawnVfx instead.
  draw(context: ItemDrawContext, params: P, state: S): void;
}

// Works on its own while equipped. Any number can be equipped.
export interface PassiveItemDefinition<P extends ItemParams, S> extends ItemBase<P, S> {
  kind: "passive";
}

// Used by pressing the active-item key. Only one can be equipped at a time.
export interface ActiveItemDefinition<P extends ItemParams, S> extends ItemBase<P, S> {
  kind: "active";
  // Recharge progress from 0 (just used) to 1 (ready). The item decides what fills it
  // (time, kills, ...) by tracking that in its state, usually in update.
  getCooldown(params: P, state: S): number;
  // Called when the key is pressed and getCooldown returned 1 or more. Should reset
  // whatever getCooldown reads.
  activate(context: ItemUpdateContext, params: P, state: S): void;
}

export type ItemDefinition<P extends ItemParams, S> = PassiveItemDefinition<P, S> | ActiveItemDefinition<P, S>;

// Items with their param and state types erased, for code that handles every item.
export type AnyPassiveItemDefinition = PassiveItemDefinition<ItemParams, unknown>;
export type AnyActiveItemDefinition = ActiveItemDefinition<ItemParams, unknown>;
export type AnyItemDefinition = AnyPassiveItemDefinition | AnyActiveItemDefinition;

// Each file in src/items/ exports one of these. They check the item against its interface,
// fill in `kind`, and keep the id as a literal type for ItemId.
export function definePassiveItem<const Id extends string, P extends ItemParams, S>(
  item: Omit<PassiveItemDefinition<P, S>, "kind"> & { id: Id },
): PassiveItemDefinition<P, S> & { id: Id } {
  return { ...item, kind: "passive" };
}

export function defineActiveItem<const Id extends string, P extends ItemParams, S>(
  item: Omit<ActiveItemDefinition<P, S>, "kind"> & { id: Id },
): ActiveItemDefinition<P, S> & { id: Id } {
  return { ...item, kind: "active" };
}

// Shared by time-based active items: getCooldown for a state that counts seconds since use.
export function timeCooldown(elapsed: number, duration: number): number {
  return duration <= 0 ? 1 : Math.min(1, elapsed / duration);
}
