import type { Player, PlayerStats } from "./player.js";

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
  }
}
