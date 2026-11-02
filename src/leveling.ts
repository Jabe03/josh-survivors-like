import type { PlayerProgression } from "./player.js";

export interface LevelCurveDefinition {
  base: number;
  linear: number;
  quadratic: number;
  exponent: number;
  // Exponential growth: each level costs this much more than the polynomial alone, compounding
  // (level L is multiplied by growth^(L-1)). Keeps the bar ahead of enemy counts as waves ramp.
  growth: number;
  minXpToNext: number;
}

export const DEFAULT_LEVEL_CURVE: LevelCurveDefinition = {
  base: 12,
  linear: 9,
  quadratic: 1.6,
  exponent: 1,
  growth: 1.08,
  minXpToNext: 8,
};

export function xpToNextLevel(level: number, curve: LevelCurveDefinition): number {
  const raw = curve.base + curve.linear * level + curve.quadratic * level * level;
  const polynomial = raw * Math.pow(Math.max(1, level), Math.max(0, curve.exponent - 1));
  const scaled = polynomial * Math.pow(curve.growth, Math.max(0, level - 1));
  return Math.max(curve.minXpToNext, Math.floor(scaled));
}

// Stat-up milestones inside each level, splitting its XP into equal parts: 1 gives a stat-up
// at the half level, 2 at each third, 0 none. Every full level gives an item upgrade.
export const STAT_UPS_PER_LEVEL = 1;

// What a milestone earns: a generic stat-up partway through a level, an item upgrade on level-up.
export type UpgradeReward = "stat" | "item";

// Where each stat-up milestone sits in a level, as fractions of its XP (e.g. [0.5]).
export function statUpFractions(statUpsPerLevel: number = STAT_UPS_PER_LEVEL): number[] {
  return Array.from({ length: statUpsPerLevel }, (_, i) => (i + 1) / (statUpsPerLevel + 1));
}

// Adds XP and returns every milestone it crossed, in the order they were reached.
export function grantExperience(
  progression: PlayerProgression,
  xpAmount: number,
  curve: LevelCurveDefinition,
  statUpsPerLevel: number = STAT_UPS_PER_LEVEL,
): UpgradeReward[] {
  progression.xp += xpAmount;
  const rewards: UpgradeReward[] = [];

  for (;;) {
    if (progression.statUpsClaimed < statUpsPerLevel) {
      const threshold = (progression.xpToNext * (progression.statUpsClaimed + 1)) / (statUpsPerLevel + 1);
      if (progression.xp < threshold) {
        break;
      }
      progression.statUpsClaimed += 1;
      rewards.push("stat");
    } else if (progression.xp >= progression.xpToNext) {
      progression.xp -= progression.xpToNext;
      progression.level += 1;
      progression.xpToNext = xpToNextLevel(progression.level, curve);
      progression.statUpsClaimed = 0;
      rewards.push("item");
    } else {
      break;
    }
  }

  return rewards;
}
