import type { Vec2 } from "./types.js";

const keys = new Set<string>();

// True while the player is typing in a menu field, so game keys should be ignored.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function setupInput(): void {
  addEventListener("keydown", (e) => {
    if (!isTextEntryTarget(e.target)) {
      keys.add(e.code);
    }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
}

export function readMove(): Vec2 {
  const x = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const y = (keys.has("KeyS") ? 1 : 0) - (keys.has("KeyW") ? 1 : 0);
  const len = Math.hypot(x, y) || 1; // normalize so diagonals are not faster
  return { x: x / len, y: y / len };
}
