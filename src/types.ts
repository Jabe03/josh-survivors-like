export interface Vec2 { x: number; y: number; }

export interface Enemy {
  pos: Vec2;
  radius: number;
  speed: number;
}

export const CELL = 64; // grid cell size, only there so movement is visible

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
