import type { PlayerStats } from "./player.js";
import type { AnyItemDefinition, ItemDrawContext, ItemParams, ItemUpdateContext, ParamScaling } from "./itemTypes.js";
import { starterBlaster } from "./items/starterBlaster.js";
import { aura } from "./items/aura.js";

// Every item in the game. To add one, create its file in src/items/ and list it here.
const ITEM_LIST = [starterBlaster, aura] as const;

export type ItemId = (typeof ITEM_LIST)[number]["id"];

const ERASED_ITEM_LIST: readonly AnyItemDefinition[] = ITEM_LIST;

export const ITEM_DEFINITIONS = Object.fromEntries(ERASED_ITEM_LIST.map((item) => [item.id, item])) as Record<ItemId, AnyItemDefinition>;

export const DEFAULT_EQUIPPED_ITEM_IDS: ItemId[] = ["starter_blaster", "aura"];

export function getMaxLevel(item: AnyItemDefinition): number {
  return Math.max(1, item.maxLevel);
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

// One per equipped slot, so equipping the same item twice gives it an independent state.
export interface EquippedItem {
  item: AnyItemDefinition;
  level: number;
  state: unknown;
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
  const item = ITEM_DEFINITIONS[itemId];
  const equipped: EquippedItem = { item, level: 1, state: item.createState() };
  state.equipped.push(equipped);
  return equipped;
}

export function unequipItem(state: ItemSystemState, slotIndex: number): void {
  if (slotIndex >= 0 && slotIndex < state.equipped.length) {
    state.equipped.splice(slotIndex, 1);
  }
}

// Clamped to 1..maxLevel. Returns false if the level did not change.
export function setItemLevel(state: ItemSystemState, slotIndex: number, level: number): boolean {
  const equipped = state.equipped[slotIndex];
  if (!equipped) {
    return false;
  }
  const clamped = Math.min(getMaxLevel(equipped.item), Math.max(1, Math.floor(level)));
  if (clamped === equipped.level) {
    return false;
  }
  equipped.level = clamped;
  return true;
}

export function updateItems(context: ItemUpdateContext, state: ItemSystemState): void {
  for (const equipped of state.equipped) {
    const params = getItemParams(equipped.item, equipped.level, context.player.stats);
    equipped.item.update(context, params, equipped.state);
  }
}

export function drawItems(context: ItemDrawContext, state: ItemSystemState): void {
  for (const equipped of state.equipped) {
    const params = getItemParams(equipped.item, equipped.level, context.player.stats);
    equipped.item.draw(context, params, equipped.state);
  }
}
