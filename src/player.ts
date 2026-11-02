import type { Vec2 } from "./types.js";
import { createEquippedItem, DEFAULT_EQUIPPED_ITEM_IDS, EquippedActiveItem, EquippedItem, type ItemId } from "./items.js";
import type { ItemUpdateContext } from "./itemTypes.js";

export interface PlayerStats {
  moveSpeed: number;
  attackDamageMultiplier: number;
  attackRateMultiplier: number;
  // How fast active items recharge; their cooldowns are divided by it.
  activeRechargeMultiplier: number;
  attackSizeMultiplier: number;
  maxHealth: number;
  healthRegenRate: number;
  critChance: number;
  critDamageMultiplier: number;
  // Distance at which XP orbs start flying to the player, in world units.
  magnetRange: number;
  xpMultiplier: number;
  dodgeChance: number;
  armor: number;
  // Fraction of each hit ignored, applied before armor.
  damageReduction: number;
  
}

export interface PlayerProgression {
  level: number;
  xp: number;
  xpToNext: number;
  // Stat-up milestones already reached in the current level.
  statUpsClaimed: number;
}



export const BASE_PLAYER_RADIUS = 12;
export const BASE_PLAYER_MAX_HEALTH = 100;

// Armor can't reduce a hit below this much damage.
export const MIN_DAMAGE_PER_HIT = 1;
// Dodge chance is clamped to this, however many upgrades stack.
export const MAX_DODGE_CHANCE = 0.6;
// Damage reduction is clamped to this, so the player can never shrug off everything.
export const MAX_DAMAGE_REDUCTION = 0.5;

export const BASE_PLAYER_STATS: Readonly<PlayerStats> = {
  moveSpeed: 210,
  attackDamageMultiplier: 1,
  attackRateMultiplier: 1,
  activeRechargeMultiplier: 1,
  attackSizeMultiplier: 1,
  maxHealth: BASE_PLAYER_MAX_HEALTH,
  healthRegenRate: 0,
  critChance: 0,
  critDamageMultiplier: 1.5,
  magnetRange: 60,
  xpMultiplier: 1,
  dodgeChance: 0,
  armor: 0,
  damageReduction: 0,
};

export class Player {
  pos: Vec2 = { x: 0, y: 0 };
  // How fast the player actually moved last substep (after walls), for enemies that lead their aim.
  velocity: Vec2 = { x: 0, y: 0 };
  // Unit vector of the last direction the player moved in; kept while standing still.
  facing: Vec2 = { x: 1, y: 0 };
  // Seconds left during which hits are ignored (e.g. mid-dash). Ticked down by World.
  invulnerableTime = 0;
  // While itemHasteTime > 0, passive items run this many times faster. Ticked down by World.
  itemHasteMultiplier = 1;
  itemHasteTime = 0;
  radius = BASE_PLAYER_RADIUS;
  health = BASE_PLAYER_MAX_HEALTH;
  stats: PlayerStats = { ...BASE_PLAYER_STATS };
  progression: PlayerProgression;
  readonly passiveItems: EquippedItem[] = [];
  // At most one active item; null when none is equipped.
  activeItem: EquippedActiveItem | null = null;
  // Stat lines taken from stat-up cards: upgrade id -> level, in the order they were taken.
  readonly statLines = new Map<string, number>();

  constructor(initialXpToNext: number, itemIds: readonly ItemId[] = DEFAULT_EQUIPPED_ITEM_IDS) {
    this.progression = { level: 1, xp: 0, xpToNext: initialXpToNext, statUpsClaimed: 0 };
    for (const itemId of itemIds) {
      this.equipItem(itemId);
    }
  }

  // Passive and active items, in update and draw order.
  get allItems(): EquippedItem[] {
    return this.activeItem ? [...this.passiveItems, this.activeItem] : this.passiveItems;
  }

  // Passive items are added; an active item replaces the current one.
  equipItem(itemId: ItemId): EquippedItem {
    const equipped = createEquippedItem(itemId);
    if (equipped instanceof EquippedActiveItem) {
      this.activeItem = equipped;
    } else {
      this.passiveItems.push(equipped);
    }
    return equipped;
  }

  unequipPassive(slotIndex: number): void {
    if (slotIndex >= 0 && slotIndex < this.passiveItems.length) {
      this.passiveItems.splice(slotIndex, 1);
    }
  }

  unequipActive(): void {
    this.activeItem = null;
  }

  // Asks the active item to do its effect. Returns whether it fired.
  useActiveItem(context: ItemUpdateContext): boolean {
    return this.activeItem?.useActive(context) ?? false;
  }
}

export function healPlayer(player: Player, amount: number): void {
  player.health = Math.min(player.stats.maxHealth, player.health + amount);
}

// Applies dodge, then armor. Returns false if the hit was dodged.
export function damagePlayer(player: Player, amount: number): boolean {
  if (player.invulnerableTime > 0) {
    return false;
  }
  const dodgeChance = Math.min(MAX_DODGE_CHANCE, player.stats.dodgeChance);
  if (Math.random() < dodgeChance) {
    return false;
  }
  const reduction = Math.min(MAX_DAMAGE_REDUCTION, player.stats.damageReduction);
  const reduced = Math.max(MIN_DAMAGE_PER_HIT, amount * (1 - reduction) - player.stats.armor);
  player.health = Math.max(0, player.health - reduced);
  return true;
}
