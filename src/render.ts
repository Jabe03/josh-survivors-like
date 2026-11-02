import { CELL, PLAY_AREA_HALF_SIZE, type Vec2 } from "./types.js";
import { drawEnemy, drawEnemyTelegraph } from "./enemies.js";
import { drawProjectiles } from "./projectiles.js";
import { HEALTH_PICKUP, type World, type XpOrbTier } from "./world.js";

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

// Darkens everything outside the play area and outlines its edge. Normally off-screen.
function drawPlayAreaWalls(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, worldToScreen: (world: Vec2) => Vec2): void {
  const topLeft = worldToScreen({ x: -PLAY_AREA_HALF_SIZE, y: -PLAY_AREA_HALF_SIZE });
  const size = PLAY_AREA_HALF_SIZE * 2;
  ctx.fillStyle = "rgba(4, 2, 8, 0.75)";
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.rect(topLeft.x, topLeft.y, size, size);
  ctx.fill("evenodd");
  ctx.strokeStyle = "#7a5aa0";
  ctx.lineWidth = 3;
  ctx.strokeRect(topLeft.x, topLeft.y, size, size);
  ctx.lineWidth = 1;
}

const XP_ORB_STYLES: Record<XpOrbTier, { fill: string; outline: string }> = {
  small: { fill: "#7dd3ff", outline: "rgba(240, 252, 255, 0.75)" },
  medium: { fill: "#ffa94d", outline: "rgba(255, 240, 220, 0.85)" },
  large: { fill: "#b77dff", outline: "rgba(245, 230, 255, 0.9)" },
};
const LATENT_ORB_STYLE = { fill: "#4f9cc8", outline: "rgba(200, 230, 255, 0.4)" };

// A green cross on a dark backing, so it reads as healing rather than another orb.
function drawHealthPickup(ctx: CanvasRenderingContext2D, p: Vec2): void {
  const r = HEALTH_PICKUP.radius;
  ctx.fillStyle = "rgba(10, 30, 15, 0.8)";
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6dff8a";
  ctx.fillRect(p.x - r, p.y - r * 0.35, r * 2, r * 0.7);
  ctx.fillRect(p.x - r * 0.35, p.y - r, r * 0.7, r * 2);
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
  drawPlayAreaWalls(ctx, canvas, worldToScreen);

  const playerScreen = worldToScreen(player.pos);
  ctx.fillStyle = "#eadfc8";
  // Flickers while invulnerable (e.g. mid-dash).
  ctx.globalAlpha = player.invulnerableTime > 0 ? 0.45 + 0.25 * Math.sin(performance.now() / 30) : 1;
  ctx.beginPath();
  ctx.arc(playerScreen.x, playerScreen.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  for (const item of player.allItems) {
    item.draw({ ctx, player, worldToScreen });
  }
  world.vfx.draw(ctx, "below", worldToScreen);

  for (const enemy of world.enemies) {
    drawEnemyTelegraph(ctx, enemy, worldToScreen);
  }
  for (const enemy of world.enemies) {
    drawEnemy(ctx, enemy, worldToScreen(enemy.pos));
  }

  drawProjectiles(ctx, world.projectiles, worldToScreen);

  for (const orb of world.xpOrbs) {
    const p = worldToScreen(orb.pos);
    // Most latent orbs are far away; skip anything off-screen.
    if (p.x < -10 || p.y < -10 || p.x > canvas.width + 10 || p.y > canvas.height + 10) {
      continue;
    }
    // Latent orbs are smaller and dimmer, so enemy drops stand out.
    const style = orb.latent ? LATENT_ORB_STYLE : XP_ORB_STYLES[orb.tier];
    ctx.fillStyle = style.fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, orb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  for (const pickup of world.healthPickups) {
    // Blinks for its last few seconds before it fades.
    const timeLeft = HEALTH_PICKUP.lifetime - pickup.age;
    if (timeLeft < 5 && Math.floor(timeLeft * 6) % 2 === 0) {
      continue;
    }
    drawHealthPickup(ctx, worldToScreen(pickup.pos));
  }

  world.vfx.draw(ctx, "above", worldToScreen);
}
