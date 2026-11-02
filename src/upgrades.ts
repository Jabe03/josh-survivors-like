import { healPlayer, type Player, type PlayerStats } from "./player.js";
import { getItemParams, getMaxLevel, ITEM_DEFINITIONS, MAX_PASSIVE_ITEMS, type EquippedItem, type ItemId } from "./items.js";
import type { AnyItemDefinition } from "./itemTypes.js";
import { formatStat, paramLabel, round, STAT_DISPLAY } from "./format.js";

// Any numeric player stat can be upgraded; adding a stat to PlayerStats is enough.
export type UpgradeStatKey = keyof PlayerStats;

export interface StatModifier {
  stat: UpgradeStatKey;
  amount: number;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  modifiers: StatModifier[];
}

// Every stat line a stat-up card can offer. Related stats are bundled into one line so there
// are fewer, clearer choices. `description` is what each level adds.
export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: "agility",
    name: "Agility",
    description: "+18 movement speed, +3% dodge chance",
    modifiers: [
      { stat: "moveSpeed", amount: 18 },
      { stat: "dodgeChance", amount: 0.03 },
    ],
  },
  {
    id: "power",
    name: "Power",
    description: "+15% damage, +12% attack size",
    modifiers: [
      { stat: "attackDamageMultiplier", amount: 0.15 },
      { stat: "attackSizeMultiplier", amount: 0.12 },
    ],
  },
  {
    id: "haste",
    name: "Haste",
    description: "+12% attack speed, +10% active item recharge speed",
    modifiers: [
      { stat: "attackRateMultiplier", amount: 0.12 },
      { stat: "activeRechargeMultiplier", amount: 0.1 },
    ],
  },
  {
    id: "vitality",
    name: "Vitality",
    description: "+20 max health, +0.5 health regen per second",
    modifiers: [
      { stat: "maxHealth", amount: 20 },
      { stat: "healthRegenRate", amount: 0.5 },
    ],
  },
  {
    id: "crit",
    name: "Crit",
    description: "+3% crit chance, +15% crit damage",
    modifiers: [
      { stat: "critChance", amount: 0.03 },
      { stat: "critDamageMultiplier", amount: 0.15 },
    ],
  },
  {
    id: "insight",
    name: "Insight",
    description: "+25 magnet range, +10% XP gain",
    modifiers: [
      { stat: "magnetRange", amount: 25 },
      { stat: "xpMultiplier", amount: 0.1 },
    ],
  },
  {
    id: "armor",
    name: "Armor",
    description: "+2 armor, +4% damage reduction",
    modifiers: [
      { stat: "armor", amount: 2 },
      { stat: "damageReduction", amount: 0.04 },
    ],
  },
];

export const UPGRADE_CHOICE_COUNT = 3;
// Stat-up cards stop offering new stat lines once this many are held.
export const MAX_STAT_LINES = 4;
export const MAX_STAT_LEVEL = 5;
// Heal given by the fallback card, as a fraction of max health.
const RECOVER_FRACTION = 0.3;

export type UpgradeChoiceKind = "newItem" | "itemLevel" | "newStat" | "statLevel" | "recover";

// One value a card changes, shown as "label before -> after".
export interface UpgradeChange {
  label: string;
  before: string;
  after: string;
}

// One card on the upgrade screen: what it says, and what picking it does.
export interface UpgradeChoice {
  kind: UpgradeChoiceKind;
  name: string;
  // One line, used on the card when there are no `changes` and in the toast after picking.
  description: string;
  // Level before picking and the max, for the card's level pips. Picking adds one.
  level?: { current: number; max: number };
  changes: UpgradeChange[];
  // Something worth knowing before picking, e.g. that it fills the last free slot.
  note?: string;
  apply(player: Player): void;
}

function shuffled<T>(items: readonly T[]): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Offered when every stat line and item is maxed, so the upgrade screen is never empty.
function recoverChoice(player: Player): UpgradeChoice {
  const healed = Math.min(player.stats.maxHealth, player.health + player.stats.maxHealth * RECOVER_FRACTION);
  return {
    kind: "recover",
    name: "Recover",
    description: `Heal ${Math.round(RECOVER_FRACTION * 100)}% of max health`,
    changes: [{ label: "Health", before: String(Math.ceil(player.health)), after: String(Math.ceil(healed)) }],
    note: "Everything is maxed out.",
    apply: (target) => healPlayer(target, target.stats.maxHealth * RECOVER_FRACTION),
  };
}

// The player's stats before and after a stat line's modifiers, one change per stat.
function statChanges(player: Player, upgrade: UpgradeDefinition): UpgradeChange[] {
  return upgrade.modifiers.map(({ stat, amount }) => ({
    label: STAT_DISPLAY[stat].label,
    before: formatStat(stat, player.stats[stat]),
    after: formatStat(stat, player.stats[stat] + amount),
  }));
}

// An item's real param values (after stats) at its current and next level, for params the
// level changes.
function itemLevelChanges(player: Player, equipped: EquippedItem): UpgradeChange[] {
  const before = equipped.getParams(player.stats);
  const after = getItemParams(equipped.item, equipped.level + 1, player.stats);
  return Object.keys(before)
    .filter((name) => round(before[name], 2) !== round(after[name], 2))
    .map((name) => ({ label: paramLabel(name), before: round(before[name], 2), after: round(after[name], 2) }));
}

// Sets a stat line to any level (for dev tools), adding or removing its modifiers for the
// difference. Level 0 removes the line. Ignores MAX_STAT_LINES, and unlike a card pick,
// raising max health this way does not heal.
export function setStatLineLevel(player: Player, id: string, level: number): void {
  const upgrade = UPGRADE_DEFINITIONS.find((u) => u.id === id);
  if (!upgrade) {
    return;
  }
  const current = player.statLines.get(id) ?? 0;
  const target = Math.min(MAX_STAT_LEVEL, Math.max(0, Math.floor(level)));
  for (const modifier of upgrade.modifiers) {
    player.stats[modifier.stat] += modifier.amount * (target - current);
  }
  if (target === 0) {
    player.statLines.delete(id);
  } else {
    player.statLines.set(id, target);
  }
  player.health = Math.min(player.health, player.stats.maxHealth);
}

// Takes or levels up a stat line.
function applyStatLine(player: Player, upgrade: UpgradeDefinition): void {
  applyUpgrade(player, upgrade);
  player.statLines.set(upgrade.id, (player.statLines.get(upgrade.id) ?? 0) + 1);
}

// Stat-up cards, offered at the milestones inside a level: a level for a held stat line below
// MAX_STAT_LEVEL, or a new line while fewer than MAX_STAT_LINES are held.
export function chooseStatOptions(player: Player, count: number = UPGRADE_CHOICE_COUNT): UpgradeChoice[] {
  const canTakeNew = player.statLines.size < MAX_STAT_LINES;
  const pool: UpgradeChoice[] = [];
  for (const upgrade of UPGRADE_DEFINITIONS) {
    const level = player.statLines.get(upgrade.id) ?? 0;
    if (level >= MAX_STAT_LEVEL || (level === 0 && !canTakeNew)) {
      continue;
    }
    const lastSlot = level === 0 && player.statLines.size === MAX_STAT_LINES - 1;
    pool.push({
      kind: level === 0 ? "newStat" : "statLevel",
      name: upgrade.name,
      description: upgrade.description,
      level: { current: level, max: MAX_STAT_LEVEL },
      changes: statChanges(player, upgrade),
      note: lastSlot ? "Fills your last stat slot." : undefined,
      apply: (target) => applyStatLine(target, upgrade),
    });
  }
  return pool.length > 0 ? shuffled(pool).slice(0, count) : [recoverChoice(player)];
}

// What the next level adds, e.g. "damage +6, explosion radius +8" (before stat scaling).
function describeLevelUp(item: AnyItemDefinition): string {
  const parts = Object.entries(item.perLevel)
    .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] !== 0)
    .map(([name, amount]) => `${paramLabel(name).toLowerCase()} ${amount > 0 ? "+" : ""}${round(amount, 2)}`);
  return parts.length > 0 ? parts.join(", ") : "Stronger";
}

// Item upgrades offered on level-up: a level for an item the player owns (below its max),
// or an item they don't own yet (passive ones only while under MAX_PASSIVE_ITEMS). Falls
// back to stat upgrades when nothing is left to offer.
export function chooseItemOptions(player: Player, count: number = UPGRADE_CHOICE_COUNT): UpgradeChoice[] {
  const pool: UpgradeChoice[] = [];
  const ownedIds = new Set<string>();
  const passiveSlotsFull = player.passiveItems.length >= MAX_PASSIVE_ITEMS;

  for (const equipped of player.allItems) {
    ownedIds.add(equipped.item.id);
    if (equipped.level < getMaxLevel(equipped.item)) {
      pool.push({
        kind: "itemLevel",
        name: equipped.item.name,
        description: describeLevelUp(equipped.item),
        level: { current: equipped.level, max: getMaxLevel(equipped.item) },
        changes: itemLevelChanges(player, equipped),
        apply: () => equipped.setLevel(equipped.level + 1),
      });
    }
  }

  for (const itemId of Object.keys(ITEM_DEFINITIONS) as ItemId[]) {
    const item = ITEM_DEFINITIONS[itemId];
    if (ownedIds.has(itemId) || (item.kind === "passive" && passiveSlotsFull)) {
      continue;
    }
    // Only one active item can be equipped, so a new one replaces the current one.
    let note: string | undefined;
    if (item.kind === "active") {
      note = player.activeItem ? `Replaces ${player.activeItem.item.name}. Use with SPACE.` : "Active item: use with SPACE.";
    } else if (player.passiveItems.length === MAX_PASSIVE_ITEMS - 1) {
      note = "Fills your last item slot.";
    }
    pool.push({
      kind: "newItem",
      name: item.name,
      description: item.description,
      level: { current: 0, max: getMaxLevel(item) },
      changes: [],
      note,
      apply: (target) => {
        target.equipItem(itemId);
      },
    });
  }

  return pool.length > 0 ? shuffled(pool).slice(0, count) : chooseStatOptions(player, count);
}

export function applyUpgrade(player: Player, upgrade: UpgradeDefinition): void {
  for (const modifier of upgrade.modifiers) {
    player.stats[modifier.stat] += modifier.amount;
    // Raising max health also heals by the same amount, so the new HP is usable right away.
    if (modifier.stat === "maxHealth") {
      healPlayer(player, Math.max(0, modifier.amount));
    }
  }
  player.health = Math.min(player.health, player.stats.maxHealth);
}
