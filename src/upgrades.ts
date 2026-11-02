import { healPlayer, type Player, type PlayerStats } from "./player.js";
import { getMaxLevel, ITEM_DEFINITIONS, type ItemId } from "./items.js";
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

export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: "move_speed_up",
    name: "Move Speed Up",
    description: "+18 movement speed",
    modifiers: [{ stat: "moveSpeed", amount: 18 }],
  },
  {
    id: "damage_up",
    name: "Damage Up",
    description: "+15% damage",
    modifiers: [{ stat: "attackDamageMultiplier", amount: 0.15 }],
  },
  {
    id: "attack_speed_up",
    name: "Attack Speed Up",
    description: "+12% attack speed",
    modifiers: [{ stat: "attackRateMultiplier", amount: 0.12 }],
  },
  {
    id: "attack_size_up",
    name: "Attack Size Up",
    description: "+12% attack size",
    modifiers: [{ stat: "attackSizeMultiplier", amount: 0.12 }],
  },
  {
    id: "max_health_up",
    name: "Max Health Up",
    description: "+20 max health",
    modifiers: [{ stat: "maxHealth", amount: 20 }],
  },
  {
    id: "health_regen_up",
    name: "Health Regen Up",
    description: "+0.5 health regen per second",
    modifiers: [{ stat: "healthRegenRate", amount: 0.5 }],
  },
  {
    id: "crit_chance_up",
    name: "Crit Chance Up",
    description: "+3% crit chance",
    modifiers: [{ stat: "critChance", amount: 0.03 }],
  },
  {
    id: "crit_damage_up",
    name: "Crit Damage Up",
    description: "+15% crit damage multiplier",
    modifiers: [{ stat: "critDamageMultiplier", amount: 0.15 }],
  },
  {
    id: "pickup_range_up",
    name: "Pickup Range Up",
    description: "+10 pickup range",
    modifiers: [{ stat: "pickupRange", amount: 10 }],
  },
  {
    id: "xp_multiplier_up",
    name: "XP Multiplier Up",
    description: "+10% XP gain",
    modifiers: [{ stat: "xpMultiplier", amount: 0.1 }],
  },
  {
    id: "dodge_chance_up",
    name: "Dodge Chance Up",
    description: "+3% dodge chance",
    modifiers: [{ stat: "dodgeChance", amount: 0.03 }],
  },
  {
    id: "armor_up",
    name: "Armor Up",
    description: "+2 armor (reduces damage taken)",
    modifiers: [{ stat: "armor", amount: 2 }],
  },
];

export const UPGRADE_CHOICE_COUNT = 3;

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

// Distinct random stat upgrades, offered at the stat-up milestones inside a level.
export function chooseStatOptions(count: number = UPGRADE_CHOICE_COUNT): UpgradeChoice[] {
  return shuffled(UPGRADE_DEFINITIONS)
    .slice(0, count)
    .map((upgrade) => ({ name: upgrade.name, description: upgrade.description, apply: (player) => applyUpgrade(player, upgrade) }));
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
// or an item they don't own yet. Falls back to stat upgrades when nothing is left to offer.
export function chooseItemOptions(player: Player, count: number = UPGRADE_CHOICE_COUNT): UpgradeChoice[] {
  const pool: UpgradeChoice[] = [];
  const ownedIds = new Set<string>();

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
    if (ownedIds.has(itemId)) {
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

  return pool.length > 0 ? shuffled(pool).slice(0, count) : chooseStatOptions(count);
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
