import { startGame } from "./game.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("2D context not available");
}

startGame(canvas, ctx);
