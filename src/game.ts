import type { Vec2 } from "./types.js";
import { isTextEntryTarget, readMove, setupInput } from "./input.js";
import { DEV_MODE_HOTKEY, PauseMenu } from "./pauseMenu.js";
import { chooseItemOptions, chooseStatOptions, MAX_STAT_LINES, type UpgradeChoice } from "./upgrades.js";
import { MAX_PASSIVE_ITEMS } from "./items.js";
import type { UpgradeReward } from "./leveling.js";
import { World } from "./world.js";
import { drawWorld } from "./render.js";
import { drawHud, ToastQueue } from "./hud.js";
import { fetchLeaderboard, NameForm, submitScore, type LeaderboardResult, type LeaderboardView } from "./leaderboard.js";
import {
  drawDeathScreen,
  drawLeaderboardScreen,
  drawPausedBackdrop,
  drawStartScreen,
  drawUpgradeChoice,
  drawVictoryScreen,
  type Rect,
} from "./screens.js";

type GameState = "start" | "leaderboard" | "running" | "paused" | "levelup" | "victory" | "dead";

// Surviving this long wins the run; the player can then keep going in endless mode.
const VICTORY_TIME = 300;
// KeyboardEvent.code that uses the active item.
const ACTIVE_ITEM_KEY = "Space";

let gameState: GameState = "start";
let confirmPressed = false;
let restartPressed = false;
let leaderboardPressed = false;
let pausePressed = false;
let activeItemPressed = false;
let choiceKeyPressed: number | null = null;
let pointerPressedAt: Vec2 | null = null;

let world = new World();
const toasts = new ToastQueue();
let victoryReached = false;
// Rewards earned but not picked yet, oldest first. The first one is on screen.
let pendingRewards: UpgradeReward[] = [];
let upgradeOptions: UpgradeChoice[] = [];
let pauseMenu: PauseMenu | null = null;
let nameForm: NameForm | null = null;
let leaderboard: LeaderboardView = { status: "loading" };

// Where the upgrade cards were last drawn, for click hit-testing.
let upgradeCardRects: Rect[] = [];

function resetRun(): void {
  nameForm?.close();
  world = new World();
  toasts.clear();
  victoryReached = false;
  pendingRewards = [];
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
  leaderboardPressed = false;
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

const TOAST_PREFIX: Record<UpgradeChoice["kind"], string> = {
  newItem: "New item",
  itemLevel: "Item level up",
  newStat: "New stat line",
  statLevel: "Stat level up",
  recover: "Recovered",
};

function grantUpgrade(choice: UpgradeChoice): void {
  choice.apply(world.player);
  toasts.push(`${TOAST_PREFIX[choice.kind]}: ${choice.name} (${choice.description})`);
}

// Rolls the cards for the reward at the front of the queue.
function offerNextReward(): void {
  upgradeOptions = pendingRewards[0] === "item" ? chooseItemOptions(world.player) : chooseStatOptions(world.player);
}

function resize(canvas: HTMLCanvasElement): void {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
}

// The world and the HUD are each drawn inside save/restore, so canvas state one leaves behind
// (lineWidth, globalAlpha, ...) can't leak into the other or into the next frame. Without
// this, strokes that don't set their own width (grid, HUD panels) flicker as it changes.
function draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.save();
  drawWorld(ctx, canvas, world);
  ctx.restore();

  ctx.save();
  drawHud(ctx, canvas, world, toasts);
  drawOverlay(ctx, canvas);
  ctx.restore();
}

// The full-screen overlay for the current state, if it has one.
function drawOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  switch (gameState) {
    case "running":
      break;
    case "start":
      drawStartScreen(ctx, canvas, VICTORY_TIME);
      break;
    case "leaderboard":
      drawLeaderboardScreen(ctx, canvas, leaderboard);
      break;
    case "paused":
      drawPausedBackdrop(ctx, canvas);
      break;
    case "levelup":
      upgradeCardRects = drawUpgradeChoice(ctx, canvas, upgradeOptions, ...upgradeHeading(), pendingRewards.length);
      break;
    case "victory":
      drawVictoryScreen(ctx, canvas, world);
      break;
    case "dead":
      drawDeathScreen(ctx, canvas, world, leaderboard);
      break;
  }
}

// Heading and subtitle for the reward on screen, explaining what this pick is for.
function upgradeHeading(): [string, string] {
  const player = world.player;
  if (pendingRewards[0] === "item") {
    return ["Level Up!", `Choose a new item or level one up · Items ${player.passiveItems.length}/${MAX_PASSIVE_ITEMS}`];
  }
  return ["Stat Up!", `Choose a stat line or level one up · Stat lines ${player.statLines.size}/${MAX_STAT_LINES}`];
}

function pauseGame(): void {
  setGameState("paused");
  pauseMenu?.open(world.player);
}

function resumeGame(): void {
  pauseMenu?.close();
  setGameState("running");
}

// Asks for a name, then submits the run (or just loads the board if skipped). Results for a
// run that has since been restarted are dropped.
function endRun(): void {
  setGameState("dead");
  leaderboard = { status: "entering" };
  const run = world;
  const show = (result: LeaderboardResult | null) => {
    if (world === run) {
      leaderboard = result ? { status: "ready", ...result } : { status: "offline" };
    }
  };
  nameForm?.open((name) => {
    leaderboard = { status: "loading" };
    if (name === null) {
      void fetchLeaderboard().then(show);
      return;
    }
    const entry = { name, time: run.spawnEngine.getElapsedTime(), level: run.player.progression.level, kills: run.runStats.kills };
    void submitScore(entry).then(show);
  });
}

// From the start screen: shows the board, loading it fresh each time.
function openLeaderboard(): void {
  setGameState("leaderboard");
  leaderboard = { status: "loading" };
  void fetchLeaderboard().then((result) => {
    if (gameState === "leaderboard") {
      leaderboard = result ? { status: "ready", ...result } : { status: "offline" };
    }
  });
}

// Ends the run from the pause menu, the same way dying does (so it can still be submitted).
function giveUp(): void {
  pauseMenu?.close();
  endRun();
}

function runFrame(dt: number): void {
  if (activeItemPressed) {
    activeItemPressed = false;
    world.requestActiveItemUse();
  }
  pendingRewards.push(...world.step(dt, readMove()));
  toasts.update(dt);
  if (world.player.health <= 0) {
    endRun();
  } else if (pendingRewards.length > 0) {
    offerNextReward();
    setGameState("levelup");
  } else if (!victoryReached && world.spawnEngine.getElapsedTime() >= VICTORY_TIME) {
    victoryReached = true;
    setGameState("victory");
  }
}

export function startGame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  setupInput();
  nameForm = new NameForm();
  pauseMenu = new PauseMenu(
    () => {
      if (gameState === "paused") {
        resumeGame();
      }
    },
    () => {
      if (gameState === "paused") {
        giveUp();
      }
    },
  );
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
    if (e.code === "KeyL") {
      leaderboardPressed = true;
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
      if (leaderboardPressed) {
        openLeaderboard();
      } else if (consumeConfirm()) {
        resetRun();
        setGameState("running");
      }
    } else if (gameState === "leaderboard") {
      if (leaderboardPressed || consumePause() || consumeConfirm()) {
        setGameState("start");
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
        pendingRewards.shift();
        if (pendingRewards.length > 0) {
          offerNextReward();
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
      // Wait for the name form, so a click or SPACE meant for it doesn't restart.
      if (leaderboard.status !== "entering" && consumeConfirm()) {
        resetRun();
        setGameState("running");
      }
    }

    draw(ctx, canvas);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
