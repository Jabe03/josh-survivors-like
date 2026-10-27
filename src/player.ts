import type { Vec2 } from "./types.js";

export interface PlayerStats {
  moveSpeed: number;
  attackDamageMultiplier: number;
  attackRateMultiplier: number;
  attackSizeMultiplier: number;
  maxHealth: number;
  healthRegenRate: number;
  critChance: number;
  critDamageMultiplier: number;
  pickupRange: number;
  xpMultiplier: number;
  dodgeChance: number;
  armor: number;
  
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
  stats: PlayerStats;
  progression: PlayerProgression;
}


export const BASE_PLAYER_RADIUS = 12;
export const BASE_PLAYER_MAX_HEALTH = 100;
// Magnet and collect distances scale by pickupRange / BASE_PICKUP_RANGE.
export const BASE_PICKUP_RANGE = 50;

// Armor can't reduce a hit below this much damage.
export const MIN_DAMAGE_PER_HIT = 1;
// Dodge chance is clamped to this, however many upgrades stack.
export const MAX_DODGE_CHANCE = 0.6;

const BASE_PLAYER_STATS: PlayerStats = {
  moveSpeed: 240,
  attackDamageMultiplier: 1,
  attackRateMultiplier: 1,
  attackSizeMultiplier: 1,
  maxHealth: BASE_PLAYER_MAX_HEALTH,
  healthRegenRate: 0,
  critChance: 0,
  critDamageMultiplier: 1.5,
  pickupRange: BASE_PICKUP_RANGE,
  xpMultiplier: 1,
  dodgeChance: 0,
  armor: 0
};

export function createDefaultPlayer(initialXpToNext: number): Player {
  return {
    pos: { x: 0, y: 0 },
    radius: BASE_PLAYER_RADIUS,
    health: BASE_PLAYER_MAX_HEALTH,
    stats: { ...BASE_PLAYER_STATS },
    progression: {
      level: 1,
      xp: 0,
      xpToNext: initialXpToNext,
    },
  };
}

export function healPlayer(player: Player, amount: number): void {
  player.health = Math.min(player.stats.maxHealth, player.health + amount);
}

// Applies dodge, then armor. Returns false if the hit was dodged.
export function damagePlayer(player: Player, amount: number): boolean {
  const dodgeChance = Math.min(MAX_DODGE_CHANCE, player.stats.dodgeChance);
  if (Math.random() < dodgeChance) {
    return false;
  }
  const reduced = Math.max(MIN_DAMAGE_PER_HIT, amount - player.stats.armor);
  player.health = Math.max(0, player.health - reduced);
  return true;
}
