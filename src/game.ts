import { CELL, cloneVec2, swapRemove, type Vec2 } from "./types.js";
import { readMove, setupInput } from "./input.js";
import { ActiveEnemy, DEFAULT_SPAWN_STAGES, EnemySpawnEngine } from "./spawnEngine.js";
import { createItemSystemState, drawItemEffects, getEffectHitFlash, updateItemEffects, type EffectId } from "./items.js";
import { SpatialHash } from "./spatialHash.js";
import { BASE_PICKUP_RANGE, createDefaultPlayer, damagePlayer, healPlayer } from "./player.js";
import { DEFAULT_LEVEL_CURVE, grantExperience, xpToNextLevel } from "./leveling.js";
import { applyUpgrade, chooseUpgradeOptions, type UpgradeDefinition } from "./upgrades.js";

type GameState = "start" | "running" | "paused" | "levelup" | "victory" | "dead";

// Surviving this long wins the run; the player can then keep going in endless mode.
const VICTORY_TIME = 300;

let gameState: GameState = "start";
let confirmPressed = false;
let restartPressed = false;
let pausePressed = false;
let choiceKeyPressed: number | null = null;
let pointerPressedAt: Vec2 | null = null;

let victoryReached = false;
let pendingLevelUps = 0;
let upgradeOptions: UpgradeDefinition[] = [];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Where the upgrade cards were last drawn, for click hit-testing.
let upgradeCardRects: Rect[] = [];

let player = createDefaultPlayer(xpToNextLevel(1, DEFAULT_LEVEL_CURVE));

const enemies: ActiveEnemy[] = [];
let spawnEngine = new EnemySpawnEngine(DEFAULT_SPAWN_STAGES);
const enemyGrid = new SpatialHash();
let itemSystemState = createItemSystemState();

interface XpOrb {
  pos: Vec2;
  value: number;
  radius: number;
}

const xpOrbs: XpOrb[] = [];

const UPGRADE_TOAST_DURATION = 2.4;
// Toasts show one at a time; extra level-ups wait in the queue.
const upgradeToastQueue: string[] = [];
let upgradeToastTimer = 0;

interface HitFlash {
  pos: Vec2;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

const hitFlashes: HitFlash[] = [];

function resetRun(): void {
  player = createDefaultPlayer(xpToNextLevel(1, DEFAULT_LEVEL_CURVE));
  enemies.length = 0;
  xpOrbs.length = 0;
  hitFlashes.length = 0;
  upgradeToastQueue.length = 0;
  upgradeToastTimer = 0;
  victoryReached = false;
  pendingLevelUps = 0;
  upgradeOptions = [];
  spawnEngine = new EnemySpawnEngine(DEFAULT_SPAWN_STAGES);
  itemSystemState = createItemSystemState();
}

function consumeConfirm(): boolean {
  if (!confirmPressed) {
    return false;
  }
  confirmPressed = false;
  return true;
}

function consumePause(): boolean {
  if (!pausePressed) {
    return false;
  }
  pausePressed = false;
  return true;
}

function consumeRestart(): boolean {
  if (!restartPressed) {
    return false;
  }
  restartPressed = false;
  return true;
}

// Drop presses made during play so they do not trigger the next screen.
function setGameState(next: GameState): void {
  gameState = next;
  confirmPressed = false;
  restartPressed = false;
  pausePressed = false;
  choiceKeyPressed = null;
  pointerPressedAt = null;
}

function consumeUpgradeChoice(): number | null {
  let choice = choiceKeyPressed;
  if (choice === null && pointerPressedAt !== null) {
    const p = pointerPressedAt;
    const hit = upgradeCardRects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    choice = hit >= 0 ? hit : null;
  }
  choiceKeyPressed = null;
  pointerPressedAt = null;
  confirmPressed = false;
  return choice !== null && choice < upgradeOptions.length ? choice : null;
}

function screenPosFromWorld(world: Vec2, canvas: HTMLCanvasElement): Vec2 {
  return {
    x: world.x - player.pos.x + canvas.width / 2,
    y: world.y - player.pos.y + canvas.height / 2,
  };
}

function updateVisualEffects(dt: number): void {
  for (let i = hitFlashes.length - 1; i >= 0; i -= 1) {
    const fx = hitFlashes[i];
    fx.life -= dt;
    if (fx.life <= 0) {
      swapRemove(hitFlashes, i);
    }
  }

  if (upgradeToastQueue.length > 0) {
    upgradeToastTimer -= dt;
    if (upgradeToastTimer <= 0) {
      upgradeToastQueue.shift();
      upgradeToastTimer = upgradeToastQueue.length > 0 ? UPGRADE_TOAST_DURATION : 0;
    }
  }
}

const CRIT_FLASH_COLOR = "#ffffff";
const CRIT_FLASH_SCALE = 1.6;

// Every hit from every item rolls for a crit.
function damageEnemy(enemy: ActiveEnemy, amount: number, source: EffectId): void {
  const isCrit = Math.random() < player.stats.critChance;
  const dealt = isCrit ? amount * player.stats.critDamageMultiplier : amount;
  enemy.health = Math.max(0, enemy.health - dealt);

  const flash = getEffectHitFlash(source);
  hitFlashes.push({
    pos: cloneVec2(enemy.pos),
    radius: isCrit ? flash.radius * CRIT_FLASH_SCALE : flash.radius,
    life: flash.life,
    maxLife: flash.life,
    color: isCrit ? CRIT_FLASH_COLOR : flash.color,
  });
}

function grantUpgrade(upgrade: UpgradeDefinition): void {
  applyUpgrade(player, upgrade);
  if (upgradeToastQueue.length === 0) {
    upgradeToastTimer = UPGRADE_TOAST_DURATION;
  }
  upgradeToastQueue.push(`${upgrade.name}: ${upgrade.description}`);
}

function spawnXpOrb(pos: Vec2, value: number): void {
  xpOrbs.push({
    pos: cloneVec2(pos),
    value,
    radius: 5,
  });
}

function updateXpOrbs(dt: number): void {
  const pickupScale = player.stats.pickupRange / BASE_PICKUP_RANGE;
  const magnetRange = 180 * pickupScale;
  const pickupRange = (player.radius + 10) * pickupScale;

  for (let i = xpOrbs.length - 1; i >= 0; i -= 1) {
    const orb = xpOrbs[i];
    const dx = player.pos.x - orb.pos.x;
    const dy = player.pos.y - orb.pos.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (dist < magnetRange) {
      const pullSpeed = 180 + (magnetRange - dist) * 2.2;
      orb.pos.x += (dx / dist) * pullSpeed * dt;
      orb.pos.y += (dy / dist) * pullSpeed * dt;
    }

    if (dist < pickupRange + orb.radius) {
      const gainedXp = orb.value * player.stats.xpMultiplier;
      const levelsGained = grantExperience(player.progression, gainedXp, DEFAULT_LEVEL_CURVE);
      pendingLevelUps += levelsGained;
      swapRemove(xpOrbs, i);
    }
  }
}

function removeDeadEnemies(): void {
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    if (enemies[i].health <= 0) {
      spawnXpOrb(enemies[i].pos, enemies[i].xpReward);
      swapRemove(enemies, i);
    }
  }
}

function resolvePlayerEnemyOverlap(enemy: ActiveEnemy, moveX: number, moveY: number): boolean {
  const dx = player.pos.x - enemy.pos.x;
  const dy = player.pos.y - enemy.pos.y;
  const minDist = player.radius + enemy.radius;
  const dist = Math.hypot(dx, dy);
  if (dist >= minDist) {
    return false;
  }

  // If centers coincide, push along player movement direction when possible.
  let nx = dist > 0 ? dx / dist : 0;
  let ny = dist > 0 ? dy / dist : 0;
  if (dist === 0) {
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen > 0) {
      nx = moveX / moveLen;
      ny = moveY / moveLen;
    } else {
      nx = 1;
      ny = 0;
    }
  }

  const penetration = minDist - dist;
  enemy.pos.x -= nx * penetration;
  enemy.pos.y -= ny * penetration;
  return true;
}

function separateEnemyPair(a: ActiveEnemy, b: ActiveEnemy): void {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const minDist = a.radius + b.radius;
  const dist = Math.hypot(dx, dy);
  if (dist >= minDist) {
    return;
  }

  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  const penetration = minDist - dist;
  const push = penetration / 2;

  a.pos.x -= nx * push;
  a.pos.y -= ny * push;
  b.pos.x += nx * push;
  b.pos.y += ny * push;
}

function resolveEnemyEnemyOverlaps(): void {
  // Cells are as wide as the largest possible overlap distance, so any overlapping
  // pair sits in the same or an adjacent cell.
  let maxRadius = 0;
  for (const enemy of enemies) {
    maxRadius = Math.max(maxRadius, enemy.radius);
  }
  enemyGrid.build(enemies, maxRadius * 2);

  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i];
    const cx = enemyGrid.cellCoord(a.pos.x);
    const cy = enemyGrid.cellCoord(a.pos.y);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = enemyGrid.bucket(cx + ox, cy + oy);
        if (!bucket) {
          continue;
        }
        for (const j of bucket) {
          // Each pair once, matching the old i < j loop.
          if (j > i) {
            separateEnemyPair(a, enemies[j]);
          }
        }
      }
    }
  }
}

function resize(canvas: HTMLCanvasElement): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

function update(dt: number): void {
  // Substeps improve collision stability when frame time spikes.
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  const stepDt = dt / steps;

  for (let i = 0; i < steps; i += 1) {
    const m = readMove();
    const stepMoveX = m.x * player.stats.moveSpeed * stepDt;
    const stepMoveY = m.y * player.stats.moveSpeed * stepDt;
    player.pos.x += stepMoveX;
    player.pos.y += stepMoveY;
    healPlayer(player, player.stats.healthRegenRate * stepDt);

    spawnEngine.update(stepDt, player.pos, enemies);

    for (const enemy of enemies) {
      enemy.hitCooldown = Math.max(0, enemy.hitCooldown - stepDt);

      const dx = player.pos.x - enemy.pos.x;
      const dy = player.pos.y - enemy.pos.y;
      const dist = Math.hypot(dx, dy) || 1;

      enemy.pos.x += (dx / dist) * enemy.speed * stepDt;
      enemy.pos.y += (dy / dist) * enemy.speed * stepDt;

      const overlap = resolvePlayerEnemyOverlap(enemy, stepMoveX, stepMoveY);
      if (overlap && enemy.hitCooldown === 0) {
        // The cooldown resets even on a dodge, so the enemy can't re-roll every substep.
        damagePlayer(player, enemy.damage);
        enemy.hitCooldown = enemy.hitInterval;
      }
    }

    updateItemEffects(
      {
        dt: stepDt,
        player,
        enemies,
        damageEnemy,
      },
      itemSystemState,
    );

    // Run a couple of separation passes for tighter clusters.
    resolveEnemyEnemyOverlaps();
    resolveEnemyEnemyOverlaps();
    removeDeadEnemies();
    updateXpOrbs(stepDt);
    updateVisualEffects(stepDt);

    // Pause the rest of the frame so the player can pick an upgrade.
    if (pendingLevelUps > 0) {
      break;
    }
  }
}

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

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.fillStyle = "#17101f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, canvas, player.pos.x, player.pos.y);

  ctx.fillStyle = "#eadfc8";
  ctx.beginPath();
  const playerScreenX = canvas.width / 2;
  const playerScreenY = canvas.height / 2;
  ctx.arc(playerScreenX, playerScreenY, player.radius, 0, Math.PI * 2);
  ctx.fill();

  drawItemEffects(
    {
      ctx,
      canvas,
      player,
      worldToScreen: (world) => screenPosFromWorld(world, canvas),
    },
    itemSystemState,
  );

  for (const enemy of enemies) {
    const enemyScreenX = enemy.pos.x - player.pos.x + canvas.width / 2;
    const enemyScreenY = enemy.pos.y - player.pos.y + canvas.height / 2;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(enemyScreenX, enemyScreenY, enemy.radius, 0, Math.PI * 2);
    ctx.fill();

    const hpRatio = enemy.health / enemy.maxHealth;
    const hpW = enemy.radius * 2;
    const hpH = 4;
    const hpX = enemyScreenX - hpW / 2;
    const hpY = enemyScreenY - enemy.radius - 10;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(hpX, hpY, hpW, hpH);
    ctx.fillStyle = enemy.healthBarColor;
    ctx.fillRect(hpX, hpY, hpW * Math.max(0, hpRatio), hpH);
  }

  for (const orb of xpOrbs) {
    const p = screenPosFromWorld(orb.pos, canvas);
    ctx.fillStyle = "#7dd3ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, orb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(240, 252, 255, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  for (const flash of hitFlashes) {
    const alpha = Math.max(0, flash.life / flash.maxLife);
    const p = screenPosFromWorld(flash.pos, canvas);
    ctx.beginPath();
    ctx.fillStyle = flash.color;
    ctx.globalAlpha = alpha;
    ctx.arc(p.x, p.y, flash.radius * (1 + (1 - alpha) * 0.7), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Health bar 
  const barW = 220;
  const barH = 18;
  const barX = playerScreenX - barW / 2;
  const barY = playerScreenY + barH*2;
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

  const xpBarW = 280;
  const xpBarH = 12;
  const xpBarX = canvas.width / 2 - xpBarW / 2;
  const xpBarY = 16;
  const xpRatio = player.progression.xp / player.progression.xpToNext;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(xpBarX - 2, xpBarY - 2, xpBarW + 4, xpBarH + 4);
  ctx.fillStyle = "#1f2b3a";
  ctx.fillRect(xpBarX, xpBarY, xpBarW, xpBarH);
  ctx.fillStyle = "#6ec4ff";
  ctx.fillRect(xpBarX, xpBarY, xpBarW * Math.max(0, Math.min(1, xpRatio)), xpBarH);
  ctx.strokeStyle = "#d8ecff";
  ctx.strokeRect(xpBarX, xpBarY, xpBarW, xpBarH);

  ctx.fillStyle = "#d8ecff";
  ctx.font = "12px monospace";
  ctx.fillText(
    `LV ${player.progression.level}  XP ${Math.floor(player.progression.xp)} / ${player.progression.xpToNext}`,
    xpBarX + 8,
    xpBarY + 10,
  );

  if (upgradeToastQueue.length > 0) {
    const pending = upgradeToastQueue.length - 1;
    const toastText = `Upgrade: ${upgradeToastQueue[0]}${pending > 0 ? `  (+${pending} more)` : ""}`;
    const toastW = Math.max(340, ctx.measureText(toastText).width + 20);
    const toastX = canvas.width / 2 - toastW / 2;
    // Only fade out the last toast; queued ones swap in without flickering.
    const alpha = pending > 0 ? 1 : Math.min(1, upgradeToastTimer / 0.4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(30, 46, 22, 0.85)";
    ctx.fillRect(toastX, xpBarY + 22, toastW, 24);
    ctx.strokeStyle = "#9be27d";
    ctx.strokeRect(toastX, xpBarY + 22, toastW, 24);
    ctx.fillStyle = "#d7f7c9";
    ctx.fillText(toastText, toastX + 10, xpBarY + 38);
    ctx.globalAlpha = 1;
  }

  const stageInfo = spawnEngine.getCurrentStageInfo();
  const elapsedSeconds = Math.floor(spawnEngine.getElapsedTime());
  const stageLabelX = 16;
  const stageLabelY = 16;
  const panelW = 220;
  const panelH = 84;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(stageLabelX, stageLabelY, panelW, panelH);
  ctx.strokeStyle = "#efe6d3";
  ctx.strokeRect(stageLabelX, stageLabelY, panelW, panelH);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText(`Stage: ${stageInfo.index + 1}`, stageLabelX + 10, stageLabelY + 18);
  const endlessTier = spawnEngine.getEndlessTier();
  ctx.fillText(`${stageInfo.label}${endlessTier > 0 ? ` +${endlessTier}` : ""}`, stageLabelX + 10, stageLabelY + 34);
  ctx.fillText(`Enemies: ${enemies.length}/${stageInfo.targetEnemyCount}`, stageLabelX + 10, stageLabelY + 50);
  ctx.fillText(`Time: ${elapsedSeconds}s`, stageLabelX + 10, stageLabelY + 66);

  const itemPanelW = 240;
  const itemLineH = 18;
  const itemPanelX = canvas.width - itemPanelW - 16;
  const itemPanelY = 16;
  const equippedItems = itemSystemState.equipped;
  const itemPanelH = 34 + Math.max(1, equippedItems.length) * itemLineH;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(itemPanelX, itemPanelY, itemPanelW, itemPanelH);
  ctx.strokeStyle = "#efe6d3";
  ctx.strokeRect(itemPanelX, itemPanelY, itemPanelW, itemPanelH);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText("Items", itemPanelX + 10, itemPanelY + 18);

  for (let i = 0; i < equippedItems.length; i += 1) {
    ctx.fillText(`- ${equippedItems[i].item.name}`, itemPanelX + 10, itemPanelY + 36 + i * itemLineH);
  }

  drawGameStateOverlay(ctx, canvas);
}

function drawUpgradeChoice(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.fillStyle = "rgba(10, 8, 15, 0.7)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cardW = 220;
  const cardH = 110;
  const gap = 20;
  const totalW = upgradeOptions.length * cardW + (upgradeOptions.length - 1) * gap;
  const startX = canvas.width / 2 - totalW / 2;
  const cardY = canvas.height / 2 - cardH / 2;

  ctx.fillStyle = "#efe6d3";
  ctx.font = "24px monospace";
  const title = pendingLevelUps > 1 ? `Level Up! (${pendingLevelUps} to pick)` : "Level Up!";
  ctx.fillText(title, canvas.width / 2 - ctx.measureText(title).width / 2, cardY - 30);

  upgradeCardRects = upgradeOptions.map((_, i) => ({ x: startX + i * (cardW + gap), y: cardY, w: cardW, h: cardH }));
  for (let i = 0; i < upgradeOptions.length; i += 1) {
    const upgrade = upgradeOptions[i];
    const r = upgradeCardRects[i];
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
    ctx.fillText(upgrade.description, r.x + 12, r.y + 76);
  }

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  const hint = "Press 1-3 or click a card";
  ctx.fillText(hint, canvas.width / 2 - ctx.measureText(hint).width / 2, cardY + cardH + 32);
}

function drawGameStateOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (gameState === "running") {
    return;
  }

  if (gameState === "levelup") {
    drawUpgradeChoice(ctx, canvas);
    return;
  }

  if (gameState === "paused") {
    ctx.fillStyle = "rgba(10, 8, 15, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#efe6d3";
    ctx.font = "36px monospace";
    ctx.fillText("Paused", canvas.width / 2 - 70, canvas.height / 2 - 20);

    ctx.font = "16px monospace";
    ctx.fillText("Press ESC to resume", canvas.width / 2 - 95, canvas.height / 2 + 20);
    return;
  }

  if (gameState === "victory") {
    ctx.fillStyle = "rgba(8, 18, 10, 0.8)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#d7f7c9";
    ctx.font = "36px monospace";
    ctx.fillText("You Survived!", canvas.width / 2 - 140, canvas.height / 2 - 36);

    ctx.font = "16px monospace";
    ctx.fillText(`Level: ${player.progression.level}`, canvas.width / 2 - 60, canvas.height / 2 + 2);
    ctx.fillText("SPACE / ENTER / Click to keep going (endless)", canvas.width / 2 - 225, canvas.height / 2 + 46);
    ctx.fillText("R to start a new run", canvas.width / 2 - 100, canvas.height / 2 + 74);
    return;
  }

  if (gameState === "start") {
    ctx.fillStyle = "rgba(10, 8, 15, 0.82)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#efe6d3";
    ctx.font = "36px monospace";
    ctx.fillText("Josh's Game", canvas.width / 2 - 150, canvas.height / 2 - 40);

    ctx.font = "16px monospace";
    ctx.fillText("Move: WASD", canvas.width / 2 - 70, canvas.height / 2);
    ctx.fillText("Collect XP, level up, survive.", canvas.width / 2 - 145, canvas.height / 2 + 28);
    ctx.fillText("Press SPACE / ENTER / Click to Start", canvas.width / 2 - 200, canvas.height / 2 + 72);
    return;
  }

  ctx.fillStyle = "rgba(20, 6, 8, 0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffd4d4";
  ctx.font = "36px monospace";
  ctx.fillText("You Died", canvas.width / 2 - 95, canvas.height / 2 - 36);

  ctx.font = "16px monospace";
  ctx.fillText(`Final Level: ${player.progression.level}`, canvas.width / 2 - 90, canvas.height / 2 + 2);
  ctx.fillText(`Time Survived: ${Math.floor(spawnEngine.getElapsedTime())}s`, canvas.width / 2 - 130, canvas.height / 2 + 30);
  ctx.fillText("Press SPACE / ENTER / Click to Restart", canvas.width / 2 - 205, canvas.height / 2 + 74);
}

function runFrame(dt: number): void {
  update(dt);
  if (player.health <= 0) {
    setGameState("dead");
  } else if (pendingLevelUps > 0) {
    upgradeOptions = chooseUpgradeOptions();
    setGameState("levelup");
  } else if (!victoryReached && spawnEngine.getElapsedTime() >= VICTORY_TIME) {
    victoryReached = true;
    setGameState("victory");
  }
}

export function startGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  setupInput();
  addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      confirmPressed = true;
    }
    if (e.code === "Escape") {
      pausePressed = true;
    }
    if (e.code === "KeyR") {
      restartPressed = true;
    }
    const choiceMatch = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (choiceMatch) {
      choiceKeyPressed = Number(choiceMatch[1]) - 1;
    }
  });
  addEventListener("pointerdown", (e) => {
    confirmPressed = true;
    pointerPressedAt = { x: e.clientX, y: e.clientY };
  });

  addEventListener("resize", () => resize(canvas));
  resize(canvas);

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (gameState === "start") {
      if (consumeConfirm()) {
        resetRun();
        setGameState("running");
      }
    } else if (gameState === "running") {
      if (consumePause()) {
        setGameState("paused");
      } else {
        runFrame(dt);
      }
    } else if (gameState === "paused") {
      if (consumePause()) {
        setGameState("running");
      }
    } else if (gameState === "levelup") {
      const choice = consumeUpgradeChoice();
      if (choice !== null) {
        grantUpgrade(upgradeOptions[choice]);
        pendingLevelUps -= 1;
        if (pendingLevelUps > 0) {
          upgradeOptions = chooseUpgradeOptions();
        } else {
          setGameState("running");
        }
      }
    } else if (gameState === "victory") {
      if (consumeRestart()) {
        resetRun();
        setGameState("running");
      } else if (consumeConfirm()) {
        setGameState("running");
      }
    } else if (gameState === "dead") {
      if (consumeConfirm()) {
        resetRun();
        setGameState("running");
      }
    }

    draw(ctx, canvas);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
