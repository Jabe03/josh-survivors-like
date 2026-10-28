import { getMaxLevel } from "./items.js";
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
  drawPanel(ctx, x, y, 220, 84);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText(`Stage: ${stageInfo.index + 1}`, x + 10, y + 18);
  ctx.fillText(`${stageInfo.label}${endlessTier > 0 ? ` +${endlessTier}` : ""}`, x + 10, y + 34);
  ctx.fillText(`Enemies: ${world.enemies.length}/${stageInfo.targetEnemyCount}`, x + 10, y + 50);
  ctx.fillText(`Time: ${Math.floor(spawnEngine.getElapsedTime())}s`, x + 10, y + 66);
}

function drawItemPanel(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): void {
  const equipped = world.items.equipped;
  const w = 240;
  const lineH = 18;
  const x = canvas.width - w - 16;
  const y = 16;
  drawPanel(ctx, x, y, w, 34 + Math.max(1, equipped.length) * lineH);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText("Items", x + 10, y + 18);
  for (let i = 0; i < equipped.length; i += 1) {
    const { item, level } = equipped[i];
    const levelText = getMaxLevel(item) > 1 ? ` Lv${level}` : "";
    ctx.fillText(`- ${item.name}${levelText}`, x + 10, y + 36 + i * lineH);
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World, toasts: ToastQueue): void {
  drawHealthBar(ctx, canvas, world);
  const xpBarBottom = drawXpBar(ctx, canvas, world);
  toasts.draw(ctx, canvas, xpBarBottom + 10);
  drawStagePanel(ctx, world);
  drawItemPanel(ctx, canvas, world);
}
