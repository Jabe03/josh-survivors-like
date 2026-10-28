import type { Vec2 } from "./types.js";
import { isTextEntryTarget, readMove, setupInput } from "./input.js";
import { DEV_MODE_HOTKEY, PauseMenu } from "./pauseMenu.js";
import { applyUpgrade, chooseUpgradeOptions, type UpgradeDefinition } from "./upgrades.js";
import { World } from "./world.js";
import { drawWorld } from "./render.js";
import { drawHud, ToastQueue } from "./hud.js";
import {
  drawDeathScreen,
  drawPausedBackdrop,
  drawStartScreen,
  drawUpgradeChoice,
  drawVictoryScreen,
  type Rect,
} from "./screens.js";

type GameState = "start" | "running" | "paused" | "levelup" | "victory" | "dead";

// Surviving this long wins the run; the player can then keep going in endless mode.
const VICTORY_TIME = 300;
// KeyboardEvent.code that uses the active item.
const ACTIVE_ITEM_KEY = "Space";

let gameState: GameState = "start";
let confirmPressed = false;
let restartPressed = false;
let pausePressed = false;
let activeItemPressed = false;
let choiceKeyPressed: number | null = null;
let pointerPressedAt: Vec2 | null = null;

let world = new World();
const toasts = new ToastQueue();
let victoryReached = false;
let pendingLevelUps = 0;
let upgradeOptions: UpgradeDefinition[] = [];
let pauseMenu: PauseMenu | null = null;

// Where the upgrade cards were last drawn, for click hit-testing.
let upgradeCardRects: Rect[] = [];

function resetRun(): void {
  world = new World();
  toasts.clear();
  victoryReached = false;
  pendingLevelUps = 0;
  upgradeOptions = [];
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
  activeItemPressed = false;
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

function grantUpgrade(upgrade: UpgradeDefinition): void {
  applyUpgrade(world.player, upgrade);
  toasts.push(`Upgrade: ${upgrade.name}: ${upgrade.description}`);
}

function resize(canvas: HTMLCanvasElement): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  drawWorld(ctx, canvas, world);
  drawHud(ctx, canvas, world, toasts);

  switch (gameState) {
    case "running":
      break;
    case "start":
      drawStartScreen(ctx, canvas);
      break;
    case "paused":
      drawPausedBackdrop(ctx, canvas);
      break;
    case "levelup":
      upgradeCardRects = drawUpgradeChoice(ctx, canvas, upgradeOptions, pendingLevelUps);
      break;
    case "victory":
      drawVictoryScreen(ctx, canvas, world.player.progression.level);
      break;
    case "dead":
      drawDeathScreen(ctx, canvas, world.player.progression.level, world.spawnEngine.getElapsedTime());
      break;
  }
}

function pauseGame(): void {
  setGameState("paused");
  pauseMenu?.open(world.player);
}

function resumeGame(): void {
  pauseMenu?.close();
  setGameState("running");
}

function runFrame(dt: number): void {
  if (activeItemPressed) {
    activeItemPressed = false;
    world.requestActiveItemUse();
  }
  pendingLevelUps += world.step(dt, readMove());
  toasts.update(dt);
  if (world.player.health <= 0) {
    setGameState("dead");
  } else if (pendingLevelUps > 0) {
    upgradeOptions = chooseUpgradeOptions();
    setGameState("levelup");
  } else if (!victoryReached && world.spawnEngine.getElapsedTime() >= VICTORY_TIME) {
    victoryReached = true;
    setGameState("victory");
  }
}

export function startGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  setupInput();
  pauseMenu = new PauseMenu(() => {
    if (gameState === "paused") {
      resumeGame();
    }
  });
  addEventListener("keydown", (e) => {
    // Typing in a pause-menu field only listens for ESC.
    if (isTextEntryTarget(e.target) && e.code !== "Escape") {
      return;
    }
    if (e.code === "Space" || e.code === "Enter") {
      confirmPressed = true;
    }
    // Ignore auto-repeat so holding the key does not fire again the moment it recharges.
    if (e.code === ACTIVE_ITEM_KEY && !e.repeat) {
      activeItemPressed = true;
    }
    if (e.code === "Escape") {
      pausePressed = true;
    }
    if (e.code === DEV_MODE_HOTKEY) {
      pauseMenu?.toggleDevMode();
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
        pauseGame();
      } else {
        runFrame(dt);
      }
    } else if (gameState === "paused") {
      if (consumePause()) {
        resumeGame();
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
