import type { Vec2 } from "./types.js";

export interface PlayerStats {
  moveSpeed: number;
  attackDamageMultiplier: number;
  attackRateMultiplier: number;
  attackSizeMultiplier: number;
}

export interface PlayerProgression {
  level: number;
  xp: number;
  xpToNext: number;
}

export interface Player {
  pos: Vec2;
  radius: number;
  health: number;
  maxHealth: number;
  stats: PlayerStats;
  progression: PlayerProgression;
}

export const BASE_PLAYER_RADIUS = 12;
export const BASE_PLAYER_MAX_HEALTH = 100;

export function createDefaultPlayer(initialXpToNext: number): Player {
  return {
    pos: { x: 0, y: 0 },
    radius: BASE_PLAYER_RADIUS,
    health: BASE_PLAYER_MAX_HEALTH,
    maxHealth: BASE_PLAYER_MAX_HEALTH,
    stats: {
      moveSpeed: 240,
      attackDamageMultiplier: 1,
      attackRateMultiplier: 1,
      attackSizeMultiplier: 1,
    },
    progression: {
      level: 1,
      xp: 0,
      xpToNext: initialXpToNext,
    },
  };
}
