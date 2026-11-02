export interface Vec2 { x: number; y: number; }

export const CELL = 64; // grid cell size, only there so movement is visible

// The play area is the square from -PLAY_AREA_HALF_SIZE to +PLAY_AREA_HALF_SIZE on both axes,
// centered on the start. Large enough that normal play never reaches the walls.
export const PLAY_AREA_HALF_SIZE = 5000;

export function clampToPlayArea(pos: Vec2, margin = 0): void {
  const limit = PLAY_AREA_HALF_SIZE - margin;
  pos.x = Math.max(-limit, Math.min(limit, pos.x));
  pos.y = Math.max(-limit, Math.min(limit, pos.y));
}

export function isInPlayArea(pos: Vec2, margin = 0): boolean {
  const limit = PLAY_AREA_HALF_SIZE - margin;
  return Math.abs(pos.x) <= limit && Math.abs(pos.y) <= limit;
}

export function cloneVec2(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

// O(1) removal that does not preserve order. Safe inside a loop that iterates backwards.
export function swapRemove<T>(items: T[], index: number): void {
  const last = items.length - 1;
  if (index !== last) {
    items[index] = items[last];
  }
  items.pop();
}
