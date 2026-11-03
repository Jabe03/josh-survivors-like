import { MAX_STAT_LEVEL, MAX_STAT_LINES, type UpgradeChoice, type UpgradeChoiceKind } from "./upgrades.js";
import { ITEM_DEFINITIONS, MAX_ITEM_LEVEL, MAX_PASSIVE_ITEMS, type ItemId } from "./items.js";
import { STAT_UPS_PER_LEVEL } from "./leveling.js";
import { formatTime } from "./format.js";
import type { World } from "./world.js";
import type { LeaderboardView } from "./leaderboard.js";

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

// How a run works, shown on the start screen. Built from the real constants so it stays true.
function howToPlayLines(victoryTime: number): string[] {
  const statUps =
    STAT_UPS_PER_LEVEL === 1 ? "Halfway to each level" : `${STAT_UPS_PER_LEVEL} times between levels`;
  const levelCaps =
    MAX_ITEM_LEVEL === MAX_STAT_LEVEL
      ? `Each goes up to level ${MAX_ITEM_LEVEL}.`
      : `Items go up to level ${MAX_ITEM_LEVEL}, stat lines to ${MAX_STAT_LEVEL}.`;
  return [
    "Move with WASD. Your items attack on their own.",
    "SPACE uses your active item once its meter is full.",
    "Defeated enemies drop XP orbs. Walk near them to collect.",
    "",
    `${statUps} (the ticks on the XP bar): pick a stat line.`,
    "Each full level: pick a new item or level one up.",
    `Hold up to ${MAX_PASSIVE_ITEMS} items and ${MAX_STAT_LINES} stat lines. ${levelCaps}`,
    "",
    `Survive ${formatTime(victoryTime)} to win, then keep going in endless mode.`,
    "ESC pauses and shows your full build.",
  ];
}

export function drawStartScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, victoryTime: number): void {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.88)");
  const cx = canvas.width / 2;
  const lines = howToPlayLines(victoryTime);
  let y = canvas.height / 2 - (lines.length * 22) / 2 - 40;

  ctx.fillStyle = "#efe6d3";
  ctx.font = "40px monospace";
  drawCentered(ctx, "Circle Survivors", cx, y);
  y += 22;
  ctx.fillStyle = "#8f8299";
  ctx.font = "14px monospace";
  drawCentered(ctx, "How to play", cx, y + 16);
  y += 48;

  ctx.fillStyle = "#d8d0c0";
  ctx.font = "15px monospace";
  for (const line of lines) {
    drawCentered(ctx, line, cx, y);
    y += line ? 24 : 12;
  }

  ctx.fillStyle = "#ffd27a";
  ctx.font = "18px monospace";
  drawCentered(ctx, "Press SPACE / ENTER / Click to start", cx, y + 30);
  ctx.fillStyle = "#b8aec4";
  ctx.font = "15px monospace";
  drawCentered(ctx, "L to view the leaderboard", cx, y + 58);
}

export function drawLeaderboardScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, view: LeaderboardView): void {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.92)");
  const cx = canvas.width / 2;
  const top = canvas.height / 2 - 150;
  ctx.fillStyle = "#efe6d3";
  ctx.font = "34px monospace";
  drawCentered(ctx, "Leaderboard", cx, top - 30);
  const y = drawLeaderboard(ctx, cx, top, view, false);
  ctx.fillStyle = "#ffd27a";
  ctx.font = "16px monospace";
  drawCentered(ctx, "ESC / L / SPACE to go back", cx, y + 30);
}

// Time, level and kills, then a bar per item showing its share of all damage dealt.
function drawRunSummary(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World, top: number): number {
  const cx = canvas.width / 2;
  const { kills, damageBySource } = world.runStats;
  let y = top;

  ctx.fillStyle = "#efe6d3";
  ctx.font = "16px monospace";
  const time = formatTime(world.spawnEngine.getElapsedTime());
  drawCentered(ctx, `Time ${time}   Level ${world.player.progression.level}   Kills ${kills}`, cx, y);
  y += 36;

  const rows = [...damageBySource].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, damage]) => sum + damage, 0);
  if (rows.length === 0 || total <= 0) {
    return y;
  }

  ctx.fillStyle = "#8f8299";
  ctx.font = "13px monospace";
  drawCentered(ctx, "Damage by item", cx, y);
  y += 20;

  const nameW = 150;
  const barW = 220;
  const valueW = 110;
  const left = cx - (nameW + barW + valueW) / 2;
  ctx.font = "13px monospace";
  for (const [source, damage] of rows) {
    const name = source in ITEM_DEFINITIONS ? ITEM_DEFINITIONS[source as ItemId].name : "Other";
    const share = damage / total;
    ctx.fillStyle = "#d8d0c0";
    ctx.fillText(name, left, y + 11);
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(left + nameW, y, barW, 14);
    ctx.fillStyle = "#ffb35c";
    ctx.fillRect(left + nameW, y, barW * share, 14);
    ctx.fillStyle = "#efe6d3";
    ctx.fillText(`${Math.round(damage)} (${Math.round(share * 100)}%)`, left + nameW + barW + 10, y + 11);
    y += 20;
  }
  return y;
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

function drawCentered(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillText(text, x - ctx.measureText(text).width / 2, y);
}

// Tag text and accent color for each kind of upgrade card.
const CARD_STYLE: Record<UpgradeChoiceKind, { tag: string; color: string }> = {
  newItem: { tag: "NEW ITEM", color: "#ffd27a" },
  itemLevel: { tag: "ITEM LEVEL UP", color: "#9be27d" },
  newStat: { tag: "NEW STAT LINE", color: "#7dc8ff" },
  statLevel: { tag: "STAT LEVEL UP", color: "#b5a8ff" },
  recover: { tag: "RECOVER", color: "#ff9ab0" },
};

// One square per level: filled up to the current level, the level this pick adds in the
// accent color, and outlines for the rest.
export function drawLevelPips(ctx: CanvasRenderingContext2D, x: number, y: number, current: number, max: number, accent: string | null, size = 8): void {
  for (let i = 0; i < max; i += 1) {
    const px = x + i * (size + 3);
    if (i < current) {
      ctx.fillStyle = "#d8d0c0";
      ctx.fillRect(px, y, size, size);
    } else if (accent && i === current) {
      ctx.fillStyle = accent;
      ctx.fillRect(px, y, size, size);
    } else {
      ctx.strokeStyle = "#6b5a80";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, y + 0.5, size - 1, size - 1);
    }
  }
}

function drawCard(ctx: CanvasRenderingContext2D, choice: UpgradeChoice, r: Rect, keyNumber: number): void {
  const style = CARD_STYLE[choice.kind];
  const left = r.x + 14;
  const right = r.x + r.w - 14;

  ctx.fillStyle = "rgba(20, 16, 28, 0.95)";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = style.color;
  ctx.fillRect(r.x, r.y, r.w, 4);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.lineWidth = 1;

  ctx.font = "11px monospace";
  ctx.fillStyle = style.color;
  ctx.fillText(style.tag, left, r.y + 24);
  ctx.fillStyle = "#8f8299";
  const key = `[${keyNumber}]`;
  ctx.fillText(key, right - ctx.measureText(key).width, r.y + 24);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "18px monospace";
  ctx.fillText(choice.name, left, r.y + 50);

  let y = r.y + 64;
  if (choice.level) {
    drawLevelPips(ctx, left, y, choice.level.current, choice.level.max, style.color);
    ctx.fillStyle = "#8f8299";
    ctx.font = "11px monospace";
    const { current, max } = choice.level;
    const levelText = current === 0 ? `Lv 1 of ${max}` : `Lv ${current} → ${current + 1} of ${max}`;
    ctx.fillText(levelText, left + max * 11 + 8, y + 8);
  }
  y += 30;

  ctx.font = "12px monospace";
  if (choice.changes.length > 0) {
    for (const change of choice.changes) {
      ctx.fillStyle = "#b8aec4";
      ctx.fillText(change.label, left, y);
      const value = `${change.before} → ${change.after}`;
      ctx.fillStyle = "#efe6d3";
      ctx.fillText(value, right - ctx.measureText(value).width, y);
      y += 18;
    }
  } else {
    ctx.fillStyle = "#d8d0c0";
    for (const line of wrapText(ctx, choice.description, r.w - 28)) {
      ctx.fillText(line, left, y);
      y += 16;
    }
  }

  if (choice.note) {
    ctx.fillStyle = style.color;
    ctx.font = "11px monospace";
    const lines = wrapText(ctx, choice.note, r.w - 28);
    lines.forEach((line, i) => ctx.fillText(line, left, r.y + r.h - 14 - (lines.length - 1 - i) * 14));
  }
}

// `remaining` counts this pick, so 1 means it is the last one. Returns where each card was
// drawn, for click hit-testing.
export function drawUpgradeChoice(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  options: readonly UpgradeChoice[],
  heading: string,
  subtitle: string,
  remaining: number,
): Rect[] {
  dim(ctx, canvas, "rgba(10, 8, 15, 0.75)");

  const cardW = 260;
  const cardH = 175;
  const gap = 20;
  const totalW = options.length * cardW + (options.length - 1) * gap;
  const startX = canvas.width / 2 - totalW / 2;
  const cardY = canvas.height / 2 - cardH / 2;

  ctx.fillStyle = "#efe6d3";
  ctx.font = "26px monospace";
  drawCentered(ctx, remaining > 1 ? `${heading} (${remaining} to pick)` : heading, canvas.width / 2, cardY - 46);
  ctx.fillStyle = "#b8aec4";
  ctx.font = "13px monospace";
  drawCentered(ctx, subtitle, canvas.width / 2, cardY - 20);

  const rects = options.map((_, i) => ({ x: startX + i * (cardW + gap), y: cardY, w: cardW, h: cardH }));
  options.forEach((choice, i) => drawCard(ctx, choice, rects[i], i + 1));

  ctx.fillStyle = "#8f8299";
  ctx.font = "12px monospace";
  drawCentered(ctx, `Press 1-${options.length} or click a card`, canvas.width / 2, cardY + cardH + 30);
  return rects;
}

// Leaves room above and below the summary, whose height depends on how many items dealt damage.
function summaryTop(canvas: HTMLCanvasElement, world: World): number {
  return canvas.height / 2 - 40 - world.runStats.damageBySource.size * 10;
}

export function drawVictoryScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): void {
  dim(ctx, canvas, "rgba(8, 18, 10, 0.92)");
  const cx = canvas.width / 2;
  const top = summaryTop(canvas, world);

  ctx.fillStyle = "#d7f7c9";
  ctx.font = "38px monospace";
  drawCentered(ctx, "You Survived!", cx, top - 40);

  const y = drawRunSummary(ctx, canvas, world, top);
  ctx.fillStyle = "#ffd27a";
  ctx.font = "16px monospace";
  drawCentered(ctx, "SPACE / ENTER / Click to keep going (endless)", cx, y + 30);
  ctx.fillStyle = "#b8aec4";
  drawCentered(ctx, "R to start a new run", cx, y + 56);
}

// Rows of the leaderboard table under the run summary, with the player's new entry highlighted.
// Returns the y below it.
export function drawLeaderboard(ctx: CanvasRenderingContext2D, cx: number, top: number, view: LeaderboardView, heading = true): number {
  let y = top;
  ctx.font = "13px monospace";
  ctx.fillStyle = "#8f8299";
  if (heading) {
    drawCentered(ctx, "Leaderboard", cx, y);
    y += 22;
  }
  if (view.status !== "ready") {
    const message = { entering: "Enter a name below to submit your run", loading: "Loading...", offline: "Leaderboard offline" }[view.status];
    drawCentered(ctx, message, cx, y);
    return y + 20;
  }
  if (view.entries.length === 0) {
    drawCentered(ctx, "No runs yet", cx, y);
    return y + 20;
  }
  const columns = [-235, -195, 15, 95, 175];
  ctx.textAlign = "left";
  for (const [i, entry] of view.entries.entries()) {
    const mine = view.rank === i + 1;
    ctx.fillStyle = mine ? "#ffd27a" : "#d8d0c0";
    const cells = [`${i + 1}.`, entry.name, formatTime(entry.time), `Lv ${entry.level}`, `${entry.kills} kills`];
    cells.forEach((text, c) => ctx.fillText(text, cx + columns[c], y));
    y += 18;
  }
  ctx.textAlign = "start";
  if (view.rank !== null && view.rank > view.entries.length) {
    ctx.fillStyle = "#ffd27a";
    drawCentered(ctx, `Your run placed #${view.rank}`, cx, y + 4);
    y += 22;
  }
  return y;
}

export function drawDeathScreen(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World, leaderboard: LeaderboardView): void {
  dim(ctx, canvas, "rgba(20, 6, 8, 0.92)");
  const cx = canvas.width / 2;
  // Higher than the victory screen, to make room for the leaderboard.
  const top = Math.max(90, summaryTop(canvas, world) - 140);

  ctx.fillStyle = "#ffd4d4";
  ctx.font = "38px monospace";
  // Still alive means the run was ended from the pause menu.
  drawCentered(ctx, world.player.health > 0 ? "Run Ended" : "You Died", cx, top - 40);

  let y = drawRunSummary(ctx, canvas, world, top);
  y = drawLeaderboard(ctx, cx, y + 16, leaderboard);
  if (leaderboard.status !== "entering") {
    ctx.fillStyle = "#ffd27a";
    ctx.font = "16px monospace";
    drawCentered(ctx, "Press SPACE / ENTER / Click to restart", cx, y + 24);
  }
}
