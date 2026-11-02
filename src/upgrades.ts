import { healPlayer, type Player, type PlayerStats } from "./player.js";
import { getMaxLevel, ITEM_DEFINITIONS, MAX_PASSIVE_ITEMS, type ItemId } from "./items.js";
import type { AnyItemDefinition } from "./itemTypes.js";

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
    id: "move_speed",
    name: "Move Speed",
    description: "+18 movement speed",
    modifiers: [{ stat: "moveSpeed", amount: 18 }],
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
    id: "attack_speed",
    name: "Attack Speed",
    description: "+12% attack speed",
    modifiers: [{ stat: "attackRateMultiplier", amount: 0.12 }],
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
    id: "dodge",
    name: "Dodge",
    description: "+3% dodge chance",
    modifiers: [{ stat: "dodgeChance", amount: 0.03 }],
  },
  {
    id: "armor",
    name: "Armor",
    description: "+2 armor (reduces damage taken)",
    modifiers: [{ stat: "armor", amount: 2 }],
  },
];

export const UPGRADE_CHOICE_COUNT = 3;
// Stat-up cards stop offering new stat lines once this many are held.
export const MAX_STAT_LINES = 4;
export const MAX_STAT_LEVEL = 5;
// Heal given by the fallback card, as a fraction of max health.
const RECOVER_FRACTION = 0.3;

// One card on the upgrade screen: what it says, and what picking it does.
export interface UpgradeChoice {
  name: string;
  description: string;
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
function recoverChoice(): UpgradeChoice {
  return {
    name: "Recover",
    description: `Heal ${Math.round(RECOVER_FRACTION * 100)}% of max health`,
    apply: (player) => healPlayer(player, player.stats.maxHealth * RECOVER_FRACTION),
  };
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
    pool.push({
      name: level === 0 ? `New: ${upgrade.name}` : `${upgrade.name} Lv${level + 1}`,
      description: upgrade.description,
      apply: (target) => applyStatLine(target, upgrade),
    });
  }
  return pool.length > 0 ? shuffled(pool).slice(0, count) : [recoverChoice()];
}

// "explosionRadius" -> "explosion radius", for describing params on cards.
function paramLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// What the next level adds, e.g. "damage +6, explosion radius +8" (before stat scaling).
function describeLevelUp(item: AnyItemDefinition): string {
  const parts = Object.entries(item.perLevel)
    .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] !== 0)
    .map(([name, amount]) => `${paramLabel(name)} ${amount > 0 ? "+" : ""}${Number(amount.toFixed(2))}`);
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
        name: `${equipped.item.name} Lv${equipped.level + 1}`,
        description: describeLevelUp(equipped.item),
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
    const replaces = item.kind === "active" && player.activeItem ? ` Replaces ${player.activeItem.item.name}.` : "";
    pool.push({
      name: `New: ${item.name}`,
      description: `${item.description}${replaces}`,
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
