export interface Vec2 { x: number; y: number; }

export interface Enemy {
  pos: Vec2;
  radius: number;
  speed: number;
}

export const CELL = 64; // grid cell size, only there so movement is visible
