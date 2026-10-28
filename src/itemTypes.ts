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

// What an item can do to the world: enemy queries, damage, projectiles, VFX, healing.
export type ItemUpdateContext = SimContext;

export interface ItemDrawContext {
  ctx: CanvasRenderingContext2D;
  player: Player;
  worldToScreen: (world: Vec2) => Vec2;
}

// One item: its data and its hooks. Each file in src/items/ exports one of these through
// defineItem. Every field and hook is required; use {} or an empty function when an item
// does not need one.
export interface ItemDefinition<P extends ItemParams, S> {
  id: string;
  name: string;
  // 1 means the item has no levels.
  maxLevel: number;
  // Base values at level 1, before player stats.
  params: P;
  // Which player stats affect which params. Params not listed are not affected.
  scaling: ParamScalingMap<P>;
  // Added to params for each level above 1.
  perLevel: Partial<P>;

  // Called once per equipped copy; the result is passed back to update and draw.
  createState(): S;
  // Called every physics substep. Params have level bonuses and stat scaling applied.
  update(context: ItemUpdateContext, params: P, state: S): void;
  // Called every frame for visuals that last as long as the item does. One-off visuals
  // should use context.spawnVfx in update instead.
  draw(context: ItemDrawContext, params: P, state: S): void;
}

// An item with its param and state types erased, for code that handles every item.
export type AnyItemDefinition = ItemDefinition<ItemParams, unknown>;

// Checks an item against ItemDefinition and keeps its id as a literal type for ItemId.
export function defineItem<const Id extends string, P extends ItemParams, S>(item: ItemDefinition<P, S> & { id: Id }): ItemDefinition<P, S> & { id: Id } {
  return item;
}
