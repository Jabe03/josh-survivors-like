import { CELL, type Vec2 } from "./types.js";
import { drawEnemy } from "./enemies.js";
import { drawItems } from "./items.js";
import { drawProjectiles } from "./projectiles.js";
import type { World } from "./world.js";

function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camX: number, camY: number): void {
  const w = canvas.width;
  const h = canvas.height;
  // Screen position of world point (wx, wy) is (wx - camX + w/2, wy - camY + h/2).
  const left = camX - w / 2;
  const top = camY - h / 2;
  const first = (v: number) => Math.floor(v / CELL) * CELL;

  for (let wx = first(left); wx <= left + w; wx += CELL) {
    ctx.strokeStyle = wx % (CELL * 8) === 0 ? "#3a2a4d" : "#221730";
    ctx.beginPath();
    ctx.moveTo(wx - left, 0);
    ctx.lineTo(wx - left, h);
    ctx.stroke();
  }

  for (let wy = first(top); wy <= top + h; wy += CELL) {
    ctx.strokeStyle = wy % (CELL * 8) === 0 ? "#3a2a4d" : "#221730";
    ctx.beginPath();
    ctx.moveTo(0, wy - top);
    ctx.lineTo(w, wy - top);
    ctx.stroke();
  }
}

// Draws the game world with the camera centered on the player. Layer order, bottom to top:
// grid, player, item visuals, "below" VFX, enemies, projectiles, XP orbs, "above" VFX.
export function drawWorld(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, world: World): void {
  const player = world.player;
  const worldToScreen = (p: Vec2): Vec2 => ({
    x: p.x - player.pos.x + canvas.width / 2,
    y: p.y - player.pos.y + canvas.height / 2,
  });

  ctx.fillStyle = "#17101f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas, player.pos.x, player.pos.y);

  const playerScreen = worldToScreen(player.pos);
  ctx.fillStyle = "#eadfc8";
  ctx.beginPath();
  ctx.arc(playerScreen.x, playerScreen.y, player.radius, 0, Math.PI * 2);
  ctx.fill();

  drawItems({ ctx, player, worldToScreen }, world.items);
  world.vfx.draw(ctx, "below", worldToScreen);

  for (const enemy of world.enemies) {
    drawEnemy(ctx, enemy, worldToScreen(enemy.pos));
  }

  drawProjectiles(ctx, world.projectiles, worldToScreen);

  for (const orb of world.xpOrbs) {
    const p = worldToScreen(orb.pos);
    ctx.fillStyle = "#7dd3ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, orb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(240, 252, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  world.vfx.draw(ctx, "above", worldToScreen);
}
