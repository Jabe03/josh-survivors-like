import type { PlayerProgression } from "./player.js";

export interface LevelCurveDefinition {
  base: number;
  linear: number;
  quadratic: number;
  exponent: number;
  minXpToNext: number;
}

export const DEFAULT_LEVEL_CURVE: LevelCurveDefinition = {
  base: 12,
  linear: 9,
  quadratic: 1.6,
  exponent: 1,
  minXpToNext: 8,
};

export function xpToNextLevel(level: number, curve: LevelCurveDefinition): number {
  const raw = curve.base + curve.linear * level + curve.quadratic * level * level;
  const scaled = raw * Math.pow(Math.max(1, level), Math.max(0, curve.exponent - 1));
  return Math.max(curve.minXpToNext, Math.floor(scaled));
}

export function grantExperience(
  progression: PlayerProgression,
  xpAmount: number,
  curve: LevelCurveDefinition,
): number {
  progression.xp += xpAmount;
  let levelsGained = 0;

  while (progression.xp >= progression.xpToNext) {
    progression.xp -= progression.xpToNext;
    progression.level += 1;
    progression.xpToNext = xpToNextLevel(progression.level, curve);
    levelsGained += 1;
  }

  return levelsGained;
}
