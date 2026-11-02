import { MAX_DODGE_CHANCE, type PlayerStats } from "./player.js";

// Display names and number formatting shared by the HUD, upgrade cards and pause menu.

export type StatKey = keyof PlayerStats;
type StatFormat = "flat" | "multiplier" | "chance" | "perSecond";

interface StatDisplay {
  label: string;
  format: StatFormat;
  // Step for the dev-mode number input.
  step: number;
}

// Every stat must be listed here, so adding one to PlayerStats fails to compile until it is.
export const STAT_DISPLAY: Record<StatKey, StatDisplay> = {
  maxHealth: { label: "Max Health", format: "flat", step: 10 },
  healthRegenRate: { label: "Health Regen", format: "perSecond", step: 0.5 },
  armor: { label: "Armor", format: "flat", step: 1 },
  dodgeChance: { label: "Dodge Chance", format: "chance", step: 0.01 },
  moveSpeed: { label: "Move Speed", format: "flat", step: 10 },
  attackDamageMultiplier: { label: "Damage", format: "multiplier", step: 0.05 },
  attackRateMultiplier: { label: "Attack Speed", format: "multiplier", step: 0.05 },
  attackSizeMultiplier: { label: "Attack Size", format: "multiplier", step: 0.05 },
  critChance: { label: "Crit Chance", format: "chance", step: 0.01 },
  critDamageMultiplier: { label: "Crit Damage", format: "multiplier", step: 0.05 },
  magnetRange: { label: "Magnet Range", format: "flat", step: 10 },
  xpMultiplier: { label: "XP Gain", format: "multiplier", step: 0.05 },
};

export const STAT_KEYS = Object.keys(STAT_DISPLAY) as StatKey[];

// Rounds to at most `digits` decimals and drops trailing zeros: 0.350 -> "0.35", 7.0 -> "7".
export function round(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function formatStat(key: StatKey, value: number): string {
  let text: string;
  switch (STAT_DISPLAY[key].format) {
    case "flat":
      text = round(value, 2);
      break;
    case "multiplier":
      text = `${round(value * 100, 1)}%`;
      break;
    case "chance":
      text = `${round(value * 100, 1)}%`;
      break;
    case "perSecond":
      text = `${round(value, 2)}/s`;
      break;
  }
  if (key === "dodgeChance" && value > MAX_DODGE_CHANCE) {
    text += ` (capped at ${round(MAX_DODGE_CHANCE * 100, 1)}%)`;
  }
  return text;
}

// A change to a stat, signed: "+15%", "+20", "+0.5/s".
export function formatStatDelta(key: StatKey, amount: number): string {
  const sign = amount >= 0 ? "+" : "−";
  const size = Math.abs(amount);
  switch (STAT_DISPLAY[key].format) {
    case "flat":
      return `${sign}${round(size, 2)}`;
    case "multiplier":
    case "chance":
      return `${sign}${round(size * 100, 1)}%`;
    case "perSecond":
      return `${sign}${round(size, 2)}/s`;
  }
}

// Item param names for display: "explosionRadius" -> "Explosion radius".
export function paramLabel(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Seconds as m:ss, e.g. 83 -> "1:23".
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
