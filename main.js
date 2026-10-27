"use strict";
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const PLAYER_SPEED = 240; // world units per second
const CELL = 64; // grid cell size, only there so movement is visible
// The player lives at a position in the world. The camera follows it,
// so the player is always drawn at screen center and the world slides past.
const player = { x: 0, y: 0 };
const keys = new Set();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
}
addEventListener("resize", resize);
resize();
function readMove() {
    const x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const y = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
    const len = Math.hypot(x, y) || 1; // normalize so diagonals aren't faster
    return { x: x / len, y: y / len };
}
function update(dt) {
    const m = readMove();
    player.x += m.x * PLAYER_SPEED * dt;
    player.y += m.y * PLAYER_SPEED * dt;
}
function drawGrid(camX, camY) {
    const w = canvas.width, h = canvas.height;
    // Screen position of world point (wx, wy) is (wx - camX + w/2, wy - camY + h/2).
    const left = camX - w / 2, top = camY - h / 2;
    const first = (v) => Math.floor(v / CELL) * CELL;
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
function draw() {
    ctx.fillStyle = "#17101f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(player.x, player.y);
    ctx.fillStyle = "#eadfc8";
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 12, 0, Math.PI * 2);
    ctx.fill();
}
let last = performance.now();
function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
