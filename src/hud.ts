import { getMaxLevel, MAX_PASSIVE_ITEMS } from "./items.js";
import { statUpFractions } from "./leveling.js";
import { MAX_STAT_LEVEL, MAX_STAT_LINES, UPGRADE_DEFINITIONS } from "./upgrades.js";
import { drawLevelPips } from "./screens.js";
import { formatTime } from "./format.js";
import type { World } from "./world.js";

const TOAST_DURATION = 2.4;

// Toasts show one at a time; extra ones wait in the queue.
export class ToastQueue {
  private readonly queue: string[] = [];
  private timer = 0;

  push(text: string): void {
    if (this.queue.length === 0) {
      this.timer = TOAST_DURATION;
    }
    this.queue.push(text);
  }

  clear(): void {
    this.queue.length = 0;
    this.timer = 0;
  }

  update(dt: number): void {
    if (this.queue.length === 0) {
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.queue.shift();
      this.timer = this.queue.length > 0 ? TOAST_DURATION : 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, y: number): void {
    if (this.queue.length === 0) {
      return;
    }
    ctx.font = "12px monospace";
    const pending = this.queue.length - 1;
    const text = `${this.queue[0]}${pending > 0 ? `  (+${pending} more)` : ""}`;
    const w = Math.max(340, ctx.measureText(text).width + 20);
    const x = canvas.width / 2 - w / 2;
    // Only fade out the last toast; queued ones swap in without flickering.
    ctx.globalAlpha = pending > 0 ? 1 : Math.min(1, this.timer / 0.4);
    ctx.fillStyle = "rgba(30, 46, 22, 0.85)";
    ctx.fillRect(x, y, w, 24);
    ctx.strokeStyle = "#9be27d";
    ctx.strokeRect(x, y, w, 24);
    ctx.fillStyle = "#d7f7c9";
    ctx.fillText(text, x + 10, y + 16);
    ctx.globalAlpha = 1;
  }
}

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#efe6d3";
  ctx.strokeRect(x, y, w, h);
}

function drawHealthBar(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): void {
  const player = world.player;
  const barW = 220;
  const barH = 18;
  const barX = canvas.width / 2 - barW / 2;
  const barY = canvas.height / 2 + barH * 2;
  const hpRatio = player.health / player.stats.maxHealth;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  ctx.fillStyle = "#3a1f1f";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpRatio > 0.35 ? "#55d67a" : "#d6a255";
  ctx.fillRect(barX, barY, barW * Math.max(0, hpRatio), barH);
  ctx.strokeStyle = "#efe6d3";
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText(`HP ${Math.ceil(player.health)} / ${player.stats.maxHealth}`, barX + 8, barY + 13);

  drawActiveItemMeter(ctx, world, barX, barY + barH + 8, barW);
}

// Recharge meter for the active item, under the health bar.
function drawActiveItemMeter(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, w: number): void {
  const activeItem = world.player.activeItem;
  if (!activeItem) {
    return;
  }
  const charge = activeItem.getCharge(world.player.stats);
  const h = 8;
  const ready = charge >= 1;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#1f2b3a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ready ? "#a8d8ff" : "#4f7fa8";
  ctx.fillRect(x, y, w * charge, h);
  ctx.strokeStyle = ready ? "#e8f6ff" : "#6b5a80";
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = ready ? "#e8f6ff" : "#8f8299";
  ctx.font = "12px monospace";
  ctx.fillText(`${activeItem.item.name} ${ready ? "[SPACE]" : `${Math.floor(charge * 100)}%`}`, x, y + h + 14);
}

// Returns the bar's bottom edge, so the toast can sit below it.
function drawXpBar(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): number {
  const progression = world.player.progression;
  const w = 280;
  const h = 12;
  const x = canvas.width / 2 - w / 2;
  const y = 16;
  const ratio = progression.xp / progression.xpToNext;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#1f2b3a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#6ec4ff";
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
  // A tick at each stat-up milestone; bright until it has been reached.
  statUpFractions().forEach((fraction, i) => {
    ctx.fillStyle = i < progression.statUpsClaimed ? "rgba(216, 236, 255, 0.35)" : "#ffe08a";
    ctx.fillRect(x + w * fraction - 1, y, 2, h);
  });
  ctx.strokeStyle = "#d8ecff";
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#d8ecff";
  ctx.font = "12px monospace";
  ctx.fillText(`LV ${progression.level}  XP ${Math.floor(progression.xp)} / ${progression.xpToNext}`, x + 8, y + 10);
  return y + h;
}

function drawStagePanel(ctx: CanvasRenderingContext2D, world: World): void {
  const spawnEngine = world.spawnEngine;
  const stageInfo = spawnEngine.getCurrentStageInfo();
  const endlessTier = spawnEngine.getEndlessTier();
  const x = 16;
  const y = 16;
  drawPanel(ctx, x, y, 220, 100);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText(`Stage: ${stageInfo.index + 1}`, x + 10, y + 18);
  ctx.fillText(`${stageInfo.label}${endlessTier > 0 ? ` +${endlessTier}` : ""}`, x + 10, y + 34);
  ctx.fillText(`Enemies: ${world.enemies.length}/${stageInfo.targetEnemyCount}`, x + 10, y + 50);
  ctx.fillText(`Time: ${formatTime(spawnEngine.getElapsedTime())}`, x + 10, y + 66);
  ctx.fillText(`Difficulty: x${stageInfo.difficulty.toFixed(2)}`, x + 10, y + 82);
}

// Shortens text with "…" until it fits maxWidth in the current font.
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

// What one slot in the bottom bar shows. null is an empty slot.
interface SlotContent {
  name: string;
  level: number;
  maxLevel: number;
  // Active item only: recharge progress from 0 to 1.
  charge?: number;
}

interface SlotGroup {
  label: string;
  accent: string;
  slots: (SlotContent | null)[];
}

const SLOT_H = 46;
const SLOT_GAP = 6;
const GROUP_GAP = 24;

function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, slot: SlotContent | null, accent: string): void {
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, w, SLOT_H);

  if (!slot) {
    ctx.strokeStyle = "#3a2f48";
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, SLOT_H - 1);
    ctx.fillStyle = "#4f4560";
    ctx.font = "11px monospace";
    const text = "empty";
    ctx.fillText(text, x + w / 2 - ctx.measureText(text).width / 2, y + SLOT_H / 2 + 4);
    return;
  }

  if (slot.charge !== undefined) {
    // Recharge fills the slot from the bottom; bright once ready.
    const ready = slot.charge >= 1;
    ctx.fillStyle = ready ? "rgba(168, 216, 255, 0.28)" : "rgba(79, 127, 168, 0.3)";
    const fillH = SLOT_H * slot.charge;
    ctx.fillRect(x, y + SLOT_H - fillH, w, fillH);
  }
  ctx.strokeStyle = accent;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, SLOT_H - 1);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText(fitText(ctx, slot.name, w - 12), x + 6, y + 17);
  if (slot.maxLevel > 1) {
    drawLevelPips(ctx, x + 6, y + 26, slot.level, slot.maxLevel, null, 6);
  }
  if (slot.charge !== undefined && slot.charge >= 1) {
    ctx.fillStyle = "#a8d8ff";
    ctx.font = "10px monospace";
    const key = "SPACE";
    ctx.fillText(key, x + w - 6 - ctx.measureText(key).width, y + SLOT_H - 6);
  }
}

// Fixed slots along the bottom of the screen: passive items, the active item and stat lines.
// Empty slots are drawn too, so the caps are visible at a glance.
function drawSlotBar(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): void {
  const player = world.player;
  const itemSlots: (SlotContent | null)[] = [];
  for (let i = 0; i < Math.max(MAX_PASSIVE_ITEMS, player.passiveItems.length); i += 1) {
    const equipped = player.passiveItems[i];
    itemSlots.push(equipped ? { name: equipped.item.name, level: equipped.level, maxLevel: getMaxLevel(equipped.item) } : null);
  }
  const active = player.activeItem;
  const statSlots: (SlotContent | null)[] = [];
  const lines = [...player.statLines];
  for (let i = 0; i < Math.max(MAX_STAT_LINES, lines.length); i += 1) {
    const line = lines[i];
    const upgrade = line && UPGRADE_DEFINITIONS.find((u) => u.id === line[0]);
    statSlots.push(line ? { name: upgrade?.name ?? line[0], level: line[1], maxLevel: MAX_STAT_LEVEL } : null);
  }

  const groups: SlotGroup[] = [
    { label: `ITEMS ${player.passiveItems.length}/${MAX_PASSIVE_ITEMS}`, accent: "#9be27d", slots: itemSlots },
    {
      label: "ACTIVE",
      accent: "#a8d8ff",
      slots: [active ? { name: active.item.name, level: active.level, maxLevel: getMaxLevel(active.item), charge: active.getCharge(player.stats) } : null],
    },
    { label: `STAT LINES ${player.statLines.size}/${MAX_STAT_LINES}`, accent: "#b5a8ff", slots: statSlots },
  ];

  const slotCount = groups.reduce((sum, g) => sum + g.slots.length, 0);
  const gaps = groups.reduce((sum, g) => sum + (g.slots.length - 1) * SLOT_GAP, 0) + (groups.length - 1) * GROUP_GAP;
  const slotW = Math.max(60, Math.min(118, (canvas.width - 32 - gaps) / slotCount));
  const totalW = slotCount * slotW + gaps;
  const y = canvas.height - SLOT_H - 16;
  let x = canvas.width / 2 - totalW / 2;

  for (const group of groups) {
    ctx.fillStyle = "#8f8299";
    ctx.font = "11px monospace";
    ctx.fillText(group.label, x, y - 6);
    for (const slot of group.slots) {
      drawSlot(ctx, x, y, slotW, slot, group.accent);
      x += slotW + SLOT_GAP;
    }
    x += GROUP_GAP - SLOT_GAP;
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World, toasts: ToastQueue): void {
  drawHealthBar(ctx, canvas, world);
  const xpBarBottom = drawXpBar(ctx, canvas, world);
  toasts.draw(ctx, canvas, xpBarBottom + 10);
  drawStagePanel(ctx, world);
  drawSlotBar(ctx, canvas, world);
}
