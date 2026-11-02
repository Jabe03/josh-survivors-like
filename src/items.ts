import type { PlayerStats } from "./player.js";
import type { AnyActiveItemDefinition, AnyItemDefinition, ItemDrawContext, ItemParams, ItemUpdateContext, ParamScaling } from "./itemTypes.js";
import { starterBlaster } from "./items/starterBlaster.js";
import { aura } from "./items/aura.js";
import { blowback } from "./items/blowback.js";
import { orbitals } from "./items/orbitals.js";
import { fireball } from "./items/fireball.js";
import { magmaOrb } from "./items/magmaOrb.js";

// Every item in the game, passive and active. To add one, create its file in src/items/
// and list it here.
const ITEM_LIST = [starterBlaster, aura, blowback, orbitals, fireball, magmaOrb] as const;

export type ItemId = (typeof ITEM_LIST)[number]["id"];

const ERASED_ITEM_LIST: readonly AnyItemDefinition[] = ITEM_LIST;

export const ITEM_DEFINITIONS = Object.fromEntries(ERASED_ITEM_LIST.map((item) => [item.id, item])) as Record<ItemId, AnyItemDefinition>;

export const DEFAULT_EQUIPPED_ITEM_IDS: ItemId[] = ["starter_blaster"];

// No item levels past this, whatever its maxLevel says.
export const MAX_ITEM_LEVEL = 5;
// Item cards stop offering new passive items once this many are held. The active item is
// separate and doesn't count. Dev mode can still add more.
export const MAX_PASSIVE_ITEMS = 4;

export function getMaxLevel(item: AnyItemDefinition): number {
  return Math.min(MAX_ITEM_LEVEL, Math.max(1, item.maxLevel));
}

// Params after level bonuses, and after stat scaling when stats are given.
export function getItemParams(item: AnyItemDefinition, level: number, stats?: PlayerStats): ItemParams {
  const result: ItemParams = {};
  for (const name of Object.keys(item.params)) {
    let value = item.params[name] + (item.perLevel[name] ?? 0) * (level - 1);
    const rule: ParamScaling | undefined = item.scaling[name];
    if (stats && rule) {
      const statValue = stats[rule.stat];
      value = rule.mode === "multiply" ? value * statValue : value / Math.max(rule.minStat ?? 0, statValue);
    }
    result[name] = value;
  }
  return result;
}

// One equipped copy of an item, holding its level and runtime state. Equipping the same
// item twice gives each copy its own state.
export class EquippedItem<D extends AnyItemDefinition = AnyItemDefinition> {
  level = 1;
  readonly state: unknown;

  constructor(readonly item: D) {
    this.state = item.createState();
  }

  getParams(stats?: PlayerStats): ItemParams {
    return getItemParams(this.item, this.level, stats);
  }

  // Clamped to 1..maxLevel. Returns false if the level did not change.
  setLevel(level: number): boolean {
    const clamped = Math.min(getMaxLevel(this.item), Math.max(1, Math.floor(level)));
    if (clamped === this.level) {
      return false;
    }
    this.level = clamped;
    return true;
  }

  update(context: ItemUpdateContext): void {
    this.item.update(context, this.getParams(context.player.stats), this.state);
  }

  draw(context: ItemDrawContext): void {
    this.item.draw(context, this.getParams(context.player.stats), this.state);
  }
}

export class EquippedActiveItem extends EquippedItem<AnyActiveItemDefinition> {
  // Recharge progress from 0 (just used) to 1 (ready), as reported by the item.
  getCharge(stats: PlayerStats): number {
    return Math.max(0, Math.min(1, this.item.getCooldown(this.getParams(stats), this.state)));
  }

  // Does the item's effect if it is fully charged. Returns whether it fired.
  useActive(context: ItemUpdateContext): boolean {
    if (this.getCharge(context.player.stats) < 1) {
      return false;
    }
    this.item.activate(context, this.getParams(context.player.stats), this.state);
    return true;
  }
}

export function createEquippedItem(itemId: ItemId): EquippedItem | EquippedActiveItem {
  const item = ITEM_DEFINITIONS[itemId];
  return item.kind === "active" ? new EquippedActiveItem(item) : new EquippedItem(item);
}
