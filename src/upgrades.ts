import { healPlayer, type Player, type PlayerStats } from "./player.js";

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

// Distinct random upgrades to offer on level-up (fewer if not enough are defined).
export function chooseUpgradeOptions(count: number = UPGRADE_CHOICE_COUNT): UpgradeDefinition[] {
  const pool = [...UPGRADE_DEFINITIONS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
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
