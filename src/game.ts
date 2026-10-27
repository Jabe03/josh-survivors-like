import { CELL, type Vec2 } from "./types.js";
import { readMove, setupInput } from "./input.js";
import { ActiveEnemy, DEFAULT_SPAWN_STAGES, EnemySpawnEngine } from "./spawnEngine.js";
import { createItemSystemState, DEFAULT_EQUIPPED_ITEM_IDS, drawItemEffects, ITEM_DEFINITIONS, updateItemEffects, type EffectId } from "./items.js";
import { createDefaultPlayer } from "./player.js";
import { DEFAULT_LEVEL_CURVE, grantExperience, xpToNextLevel } from "./leveling.js";
import { applyUpgrade, chooseRandomUpgrade } from "./upgrades.js";

type GameState = "start" | "running" | "dead";

let gameState: GameState = "start";
let confirmPressed = false;

let player = createDefaultPlayer(xpToNextLevel(1, DEFAULT_LEVEL_CURVE));

const enemies: ActiveEnemy[] = [];
let spawnEngine = new EnemySpawnEngine(DEFAULT_SPAWN_STAGES);
const equippedItemIds = [...DEFAULT_EQUIPPED_ITEM_IDS];
let itemSystemState = createItemSystemState();

interface XpOrb {
  pos: Vec2;
  value: number;
  radius: number;
}

const xpOrbs: XpOrb[] = [];
let lastUpgradeText = "";
let lastUpgradeTimer = 0;

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
  lastUpgradeText = "";
  lastUpgradeTimer = 0;
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

function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
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
      hitFlashes.splice(i, 1);
    }
  }

  lastUpgradeTimer = Math.max(0, lastUpgradeTimer - dt);
}

function damageEnemy(enemy: ActiveEnemy, amount: number, source: EffectId): void {
  enemy.health = Math.max(0, enemy.health - amount);

  hitFlashes.push({
    pos: cloneVec2(enemy.pos),
    radius: source === "default_shoot" ? 8 : 10,
    life: source === "default_shoot" ? 0.12 : 0.16,
    maxLife: source === "default_shoot" ? 0.12 : 0.16,
    color: source === "default_shoot" ? "#ffe6a8" : "#ff9966",
  });
}

function grantRandomUpgrade(): void {
  const upgrade = chooseRandomUpgrade();
  applyUpgrade(player, upgrade);
  lastUpgradeText = `${upgrade.name}: ${upgrade.description}`;
  lastUpgradeTimer = 2.4;
}

function spawnXpOrb(pos: Vec2, value: number): void {
  xpOrbs.push({
    pos: cloneVec2(pos),
    value,
    radius: 5,
  });
}

function updateXpOrbs(dt: number): void {
  const magnetRange = 180;
  const pickupRange = player.radius + 10;

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
      const gainedXp = orb.value;
      const levelsGained = grantExperience(player.progression, gainedXp, DEFAULT_LEVEL_CURVE);
      for (let level = 0; level < levelsGained; level += 1) {
        grantRandomUpgrade();
      }
      xpOrbs.splice(i, 1);
    }
  }
}

function removeDeadEnemies(): void {
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    if (enemies[i].health <= 0) {
      spawnXpOrb(enemies[i].pos, enemies[i].xpReward);
      enemies.splice(i, 1);
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

function resolveEnemyEnemyOverlaps(): void {
  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i];
    for (let j = i + 1; j < enemies.length; j += 1) {
      const b = enemies[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const minDist = a.radius + b.radius;
      const dist = Math.hypot(dx, dy);
      if (dist >= minDist) {
        continue;
      }

      let nx = dist > 0 ? dx / dist : 1;
      let ny = dist > 0 ? dy / dist : 0;
      const penetration = minDist - dist;
      const push = penetration / 2;

      a.pos.x -= nx * push;
      a.pos.y -= ny * push;
      b.pos.x += nx * push;
      b.pos.y += ny * push;
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
        player.health = Math.max(0, player.health - enemy.damage);
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
      equippedItemIds,
      itemSystemState,
    );

    // Run a couple of separation passes for tighter clusters.
    resolveEnemyEnemyOverlaps();
    resolveEnemyEnemyOverlaps();
    removeDeadEnemies();
    updateXpOrbs(stepDt);
    updateVisualEffects(stepDt);
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
    equippedItemIds,
    itemSystemState,
  );

  for (const enemy of enemies) {
    const enemyScreenX = enemy.pos.x - player.pos.x + canvas.width / 2;
    const enemyScreenY = enemy.pos.y - player.pos.y + canvas.height / 2;
    ctx.fillStyle = enemy.kind === "boss" ? "#9a2a2a" : enemy.kind === "miniboss" ? "#c6552f" : "#d66565";
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
    ctx.fillStyle = enemy.kind === "boss" ? "#ff9d9d" : enemy.kind === "miniboss" ? "#ffb07f" : "#ff7a7a";
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
  const hpRatio = player.health / player.maxHealth;

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
  ctx.fillText(`HP ${Math.ceil(player.health)} / ${player.maxHealth}`, barX + 8, barY + 13);

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

  if (lastUpgradeTimer > 0) {
    const alpha = Math.min(1, lastUpgradeTimer / 0.4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(30, 46, 22, 0.85)";
    ctx.fillRect(canvas.width / 2 - 170, xpBarY + 22, 340, 24);
    ctx.strokeStyle = "#9be27d";
    ctx.strokeRect(canvas.width / 2 - 170, xpBarY + 22, 340, 24);
    ctx.fillStyle = "#d7f7c9";
    ctx.fillText(`Upgrade: ${lastUpgradeText}`, canvas.width / 2 - 160, xpBarY + 38);
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
  ctx.fillText(stageInfo.label, stageLabelX + 10, stageLabelY + 34);
  ctx.fillText(`Enemies: ${enemies.length}/${stageInfo.targetEnemyCount}`, stageLabelX + 10, stageLabelY + 50);
  ctx.fillText(`Time: ${elapsedSeconds}s`, stageLabelX + 10, stageLabelY + 66);

  const itemPanelW = 240;
  const itemLineH = 18;
  const itemPanelX = canvas.width - itemPanelW - 16;
  const itemPanelY = 16;
  const itemPanelH = 34 + Math.max(1, equippedItemIds.length) * itemLineH;

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(itemPanelX, itemPanelY, itemPanelW, itemPanelH);
  ctx.strokeStyle = "#efe6d3";
  ctx.strokeRect(itemPanelX, itemPanelY, itemPanelW, itemPanelH);

  ctx.fillStyle = "#efe6d3";
  ctx.font = "12px monospace";
  ctx.fillText("Items", itemPanelX + 10, itemPanelY + 18);

  for (let i = 0; i < equippedItemIds.length; i += 1) {
    const itemId = equippedItemIds[i];
    const itemName = ITEM_DEFINITIONS[itemId]?.name ?? itemId;
    ctx.fillText(`- ${itemName}`, itemPanelX + 10, itemPanelY + 36 + i * itemLineH);
  }

  drawGameStateOverlay(ctx, canvas);
}

function drawGameStateOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  if (gameState === "running") {
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

export function startGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  setupInput();
  addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      confirmPressed = true;
    }
  });
  addEventListener("pointerdown", () => {
    confirmPressed = true;
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
        gameState = "running";
      }
    } else if (gameState === "running") {
      update(dt);
      if (player.health <= 0) {
        gameState = "dead";
      }
    } else if (gameState === "dead") {
      if (consumeConfirm()) {
        resetRun();
        gameState = "running";
      }
    }

    draw(ctx, canvas);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
