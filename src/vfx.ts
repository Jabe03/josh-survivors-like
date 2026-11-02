import { cloneVec2, swapRemove, type Vec2 } from "./types.js";

// "below" draws under enemies, "above" over everything else in the world.
export type VfxLayer = "below" | "above";

// Params for each kind of visual effect. Adding a kind means adding it here and to VFX_DRAWERS.
interface VfxParamsMap {
  // Filled circle that grows by `growth` (fraction of radius) while fading out.
  burst: { radius: number; color: string; growth: number };
  // Line from the effect's position to `to`, fading out.
  line: { to: Vec2; color: string; width: number };
  // Circle outline that scales from startScale to endScale while fading from `alpha`.
  ring: { radius: number; color: string; width: number; startScale: number; endScale: number; alpha: number };
  // Text that floats up by `rise` while fading out over its second half (damage numbers).
  text: { text: string; color: string; size: number; rise: number };
}

export type VfxKind = keyof VfxParamsMap;

export type VfxSpec = {
  [K in VfxKind]: {
    kind: K;
    // Copied on spawn, so the effect stays where it was created...
    pos: Vec2;
    // ...unless an anchor is given: the effect then follows this live position (e.g. player.pos).
    anchor?: Vec2;
    life: number;
    layer?: VfxLayer;
    params: VfxParamsMap[K];
  };
}[VfxKind];

// Style used when something damages an enemy; turned into a "burst" effect.
export interface HitFlashStyle {
  radius: number;
  life: number;
  color: string;
}

type VfxDrawer<P> = (ctx: CanvasRenderingContext2D, screen: Vec2, params: P, t: number, worldToScreen: (world: Vec2) => Vec2) => void;

// t goes from 0 (just spawned) to 1 (about to disappear).
const VFX_DRAWERS: { [K in VfxKind]: VfxDrawer<VfxParamsMap[K]> } = {
  burst: (ctx, screen, params, t) => {
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = params.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, params.radius * (1 + t * params.growth), 0, Math.PI * 2);
    ctx.fill();
  },
  line: (ctx, screen, params, t, worldToScreen) => {
    const to = worldToScreen(params.to);
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = params.color;
    ctx.lineWidth = params.width;
    ctx.beginPath();
    ctx.moveTo(screen.x, screen.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  },
  ring: (ctx, screen, params, t) => {
    const scale = params.startScale + (params.endScale - params.startScale) * t;
    ctx.globalAlpha = (1 - t) * params.alpha;
    ctx.strokeStyle = params.color;
    ctx.lineWidth = params.width;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, params.radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  },
  text: (ctx, screen, params, t) => {
    ctx.globalAlpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    ctx.font = `bold ${params.size}px monospace`;
    ctx.textAlign = "center";
    // A dark outline keeps the numbers readable over bright effects.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    const y = screen.y - params.rise * t;
    ctx.strokeText(params.text, screen.x, y);
    ctx.fillStyle = params.color;
    ctx.fillText(params.text, screen.x, y);
    ctx.textAlign = "start";
  },
};

interface ActiveVfx {
  spec: VfxSpec;
  pos: Vec2;
  age: number;
}

export class VfxSystem {
  private readonly effects: ActiveVfx[] = [];

  spawn(spec: VfxSpec): void {
    this.effects.push({ spec, pos: spec.anchor ?? cloneVec2(spec.pos), age: 0 });
  }

  spawnHitFlash(pos: Vec2, style: HitFlashStyle): void {
    this.spawn({ kind: "burst", pos, life: style.life, params: { radius: style.radius, color: style.color, growth: 0.7 } });
  }

  update(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const fx = this.effects[i];
      fx.age += dt;
      if (fx.age >= fx.spec.life) {
        swapRemove(this.effects, i);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, layer: VfxLayer, worldToScreen: (world: Vec2) => Vec2): void {
    for (const fx of this.effects) {
      if ((fx.spec.layer ?? "above") !== layer) {
        continue;
      }
      const t = Math.min(1, fx.age / fx.spec.life);
      const drawer = VFX_DRAWERS[fx.spec.kind] as VfxDrawer<unknown>;
      drawer(ctx, worldToScreen(fx.pos), fx.spec.params, t, worldToScreen);
    }
    ctx.globalAlpha = 1;
  }
}
