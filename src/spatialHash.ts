import type { Vec2 } from "./types.js";

// Uniform grid that buckets item indices by cell. Rebuilt from scratch each time it is used;
// bucket arrays are reused between builds to avoid per-frame allocation.
export class SpatialHash {
  private readonly cells = new Map<number, number[]>();
  private readonly usedBuckets: number[][] = [];
  private cellSize = 64;

  // Drop empty buckets once the map gets large, since the player keeps moving into new cells.
  private static readonly MAX_CELLS = 4096;

  build(items: readonly { pos: Vec2 }[], cellSize: number): void {
    for (const bucket of this.usedBuckets) {
      bucket.length = 0;
    }
    this.usedBuckets.length = 0;
    if (this.cells.size > SpatialHash.MAX_CELLS) {
      this.cells.clear();
    }

    this.cellSize = Math.max(1, cellSize);
    for (let i = 0; i < items.length; i += 1) {
      const pos = items[i].pos;
      const key = SpatialHash.key(this.cellCoord(pos.x), this.cellCoord(pos.y));
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      if (bucket.length === 0) {
        this.usedBuckets.push(bucket);
      }
      bucket.push(i);
    }
  }

  cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  bucket(cx: number, cy: number): readonly number[] | undefined {
    return this.cells.get(SpatialHash.key(cx, cy));
  }

  // Coordinates wrap every 65536 cells; a collision only costs extra distance checks.
  private static key(cx: number, cy: number): number {
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }
}
