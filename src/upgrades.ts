import type { Player } from "./player.js";

export type UpgradeStatKey =
  | "moveSpeed"
  | "attackDamageMultiplier"
  | "attackRateMultiplier"
  | "attackSizeMultiplier";

export interface UpgradeDefinition {
  id: string;
  name: string;
  description: string;
  stat: UpgradeStatKey;
  amount: number;
}

export const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: "move_speed_up",
    name: "Move Speed Up",
    description: "+18 movement speed",
    stat: "moveSpeed",
    amount: 18,
  },
  {
    id: "damage_up",
    name: "Damage Up",
    description: "+15% damage",
    stat: "attackDamageMultiplier",
    amount: 0.15,
  },
  {
    id: "attack_speed_up",
    name: "Attack Speed Up",
    description: "+12% attack speed",
    stat: "attackRateMultiplier",
    amount: 0.12,
  },
  {
    id: "attack_size_up",
    name: "Attack Size Up",
    description: "+12% attack size",
    stat: "attackSizeMultiplier",
    amount: 0.12,
  },
];

export function chooseRandomUpgrade(): UpgradeDefinition {
  const i = Math.floor(Math.random() * UPGRADE_DEFINITIONS.length);
  return UPGRADE_DEFINITIONS[i];
}

export function applyUpgrade(player: Player, upgrade: UpgradeDefinition): void {
  switch (upgrade.stat) {
    case "moveSpeed":
      player.stats.moveSpeed += upgrade.amount;
      break;
    case "attackDamageMultiplier":
      player.stats.attackDamageMultiplier += upgrade.amount;
      break;
    case "attackRateMultiplier":
      player.stats.attackRateMultiplier += upgrade.amount;
      break;
    case "attackSizeMultiplier":
      player.stats.attackSizeMultiplier += upgrade.amount;
      break;
  }
}
