import type { UpgradeChoice } from "./upgrades.js";

// Full-screen overlays for the non-running game states.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function dim(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function drawStartScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.82)");

  ctx.fillStyle = "#efe6d3";
  ctx.font = "36px monospace";
  ctx.fillText("Josh's Game", canvas.width / 2 - 150, canvas.height / 2 - 40);

  ctx.font = "16px monospace";
  ctx.fillText("Move: WASD   Active item: SPACE", canvas.width / 2 - 155, canvas.height / 2);
  ctx.fillText("Collect XP, level up, survive.", canvas.width / 2 - 145, canvas.height / 2 + 28);
  ctx.fillText("Press SPACE / ENTER / Click to Start", canvas.width / 2 - 200, canvas.height / 2 + 72);
}

// The pause menu itself is an HTML overlay (pauseMenu.ts); this just dims the game behind it.
export function drawPausedBackdrop(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.7)");
}

// Splits text into lines no wider than maxWidth in the current font.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

// `remaining` counts this pick, so 1 means it is the last one. Returns where each card was
// drawn, for click hit-testing.
export function drawUpgradeChoice(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  options: readonly UpgradeChoice[],
  heading: string,
  remaining: number,
): Rect[] {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.7)");

  const cardW = 220;
  const cardH = 130;
  const gap = 20;
  const totalW = options.length * cardW + (options.length - 1) * gap;
  const startX = canvas.width / 2 - totalW / 2;
  const cardY = canvas.height / 2 - cardH / 2;

  ctx.fillStyle = "#efe6d3";
  ctx.font = "24px monospace";
  const title = remaining > 1 ? `${heading} (${remaining} to pick)` : heading;
  ctx.fillText(title, canvas.width / 2 - ctx.measureText(title).width / 2, cardY - 30);

  const rects = options.map((_, i) => ({ x: startX + i * (cardW + gap), y: cardY, w: cardW, h: cardH }));
  for (let i = 0; i < options.length; i += 1) {
    const upgrade = options[i];
    const r = rects[i];
    ctx.fillStyle = "rgba(30, 46, 22, 0.92)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#9be27d";
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 1;

    ctx.fillStyle = "#9be27d";
    ctx.font = "12px monospace";
    ctx.fillText(`[${i + 1}]`, r.x + 12, r.y + 22);
    ctx.fillStyle = "#d7f7c9";
    ctx.font = "16px monospace";
    ctx.fillText(upgrade.name, r.x + 12, r.y + 50);
    ctx.font = "12px monospace";
    const lines = wrapText(ctx, upgrade.description, r.w - 24);
    lines.forEach((line, lineIndex) => ctx.fillText(line, r.x + 12, r.y + 76 + lineIndex * 16));
  }

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  const hint = `Press 1-${options.length} or click a card`;
  ctx.fillText(hint, canvas.width / 2 - ctx.measureText(hint).width / 2, cardY + cardH + 32);
  return rects;
}

export function drawVictoryScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, level: number): void {
  dim(ctx, canvas, "rgba(8, 18, 10, 0.8)");

  ctx.fillStyle = "#d7f7c9";
  ctx.font = "36px monospace";
  ctx.fillText("You Survived!", canvas.width / 2 - 140, canvas.height / 2 - 36);

  ctx.font = "16px monospace";
  ctx.fillText(`Level: ${level}`, canvas.width / 2 - 60, canvas.height / 2 + 2);
  ctx.fillText("SPACE / ENTER / Click to keep going (endless)", canvas.width / 2 - 225, canvas.height / 2 + 46);
  ctx.fillText("R to start a new run", canvas.width / 2 - 100, canvas.height / 2 + 74);
}

export function drawDeathScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, level: number, timeSurvived: number): void {
  dim(ctx, canvas, "rgba(20, 6, 8, 0.8)");

  ctx.fillStyle = "#ffd4d4";
  ctx.font = "36px monospace";
  ctx.fillText("You Died", canvas.width / 2 - 95, canvas.height / 2 - 36);

  ctx.font = "16px monospace";
  ctx.fillText(`Final Level: ${level}`, canvas.width / 2 - 90, canvas.height / 2 + 2);
  ctx.fillText(`Time Survived: ${Math.floor(timeSurvived)}s`, canvas.width / 2 - 130, canvas.height / 2 + 30);
  ctx.fillText("Press SPACE / ENTER / Click to Restart", canvas.width / 2 - 205, canvas.height / 2 + 74);
}
