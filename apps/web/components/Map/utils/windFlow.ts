import type { Map as MlMap } from 'maplibre-gl';

/**
 * earth.nullschool-style animated wind-particle flow on a 2D canvas overlay,
 * synced to a MapLibre map. Thousands of particles advect along a static
 * India 10 m wind field (public/wind-flow/india-wind.json), leaving fading
 * trails — the classic "earth" (Cameron Beccario, MIT) technique, our own
 * compact implementation.
 *
 * Coordinates: particles live in CSS pixels. Each frame we derive an
 * (approximate, linear) screen→lng/lat transform from map.getBounds() to
 * sample the field at each particle's geographic position, then advance it by
 * a fixed pixel velocity so the flow speed stays readable at every zoom.
 * Trails fade via a low-alpha `destination-out` wipe so the dark basemap stays
 * visible beneath the transparent canvas.
 */

export interface WindField {
  /** [W, S, E, N] degrees. */
  bbox: [number, number, number, number];
  width: number;
  height: number;
  speedMax: number;
  u: number[]; // eastward m/s, row-major, row 0 = north
  v: number[]; // northward m/s
}

interface Particle {
  x: number; // CSS px
  y: number;
  px: number; // previous position (trail start)
  py: number;
  age: number;
  maxAge: number;
}

// ── Tunables ────────────────────────────────────────────────────────────────
const SPEED_PX = 0.7; // screen px moved per (m/s) per frame
const STROKE_ALPHA = 0.92; // particle line alpha
const TRAIL_WIPE = 0.1; // destination-out alpha each frame (lower = longer trails)
const LINE_WIDTH = 1.3;
const PARTICLE_DENSITY = 1 / 2600; // particles per css px², clamped below
const MIN_PARTICLES = 900;
const MAX_PARTICLES = 3200;
const MIN_AGE = 60;
const AGE_JITTER = 120;

export async function loadWindField(url: string): Promise<WindField> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wind-flow: HTTP ${res.status} loading ${url}`);
  return (await res.json()) as WindField;
}

export class WindFlow {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private raf = 0;
  private running = false;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  // Per-frame linear screen→geo transform (from map bounds).
  private west = 0;
  private east = 0;
  private north = 0;
  private south = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: MlMap,
    private readonly field: WindField,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('wind-flow: 2D canvas context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.map.on('move', this.onMove);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.map.off('move', this.onMove);
  }

  destroy(): void {
    this.stop();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Match the canvas backing store to its CSS size × devicePixelRatio. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.lineWidth = LINE_WIDTH;
    this.ctx.lineCap = 'round';
    const target = Math.round(
      Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, this.cssW * this.cssH * PARTICLE_DENSITY)),
    );
    this.seed(target);
  }

  // Wipe trails on pan/zoom so the previous viewport's streaks don't smear.
  private onMove = () => {
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
  };

  private seed(count: number): void {
    this.updateBounds();
    this.particles = [];
    for (let i = 0; i < count; i++) this.particles.push(this.spawn());
  }

  private updateBounds(): void {
    const b = this.map.getBounds();
    this.west = b.getWest();
    this.east = b.getEast();
    this.north = b.getNorth();
    this.south = b.getSouth();
  }

  /** Spawn within the India-bbox ∩ viewport rectangle (in screen px). */
  private spawn(): Particle {
    const [W, S, E, N] = this.field.bbox;
    const lw = Math.max(this.west, W);
    const le = Math.min(this.east, E);
    const ln = Math.min(this.north, N);
    const ls = Math.max(this.south, S);
    const dLon = this.east - this.west || 1;
    const dLat = this.north - this.south || 1;
    let x: number;
    let y: number;
    if (le > lw && ln > ls) {
      const xw = ((lw - this.west) / dLon) * this.cssW;
      const xe = ((le - this.west) / dLon) * this.cssW;
      const yn = ((this.north - ln) / dLat) * this.cssH;
      const ys = ((this.north - ls) / dLat) * this.cssH;
      x = xw + Math.random() * (xe - xw);
      y = yn + Math.random() * (ys - yn);
    } else {
      x = Math.random() * this.cssW;
      y = Math.random() * this.cssH;
    }
    return { x, y, px: x, py: y, age: 0, maxAge: MIN_AGE + Math.random() * AGE_JITTER };
  }

  /** Bilinear u/v sample at a geographic point, or null if outside the field. */
  private sample(lng: number, lat: number): { u: number; v: number } | null {
    const { bbox, width, height, u, v } = this.field;
    const [W, S, E, N] = bbox;
    if (lng < W || lng > E || lat < S || lat > N) return null;
    const fx = ((lng - W) / (E - W)) * (width - 1);
    const fy = ((N - lat) / (N - S)) * (height - 1); // row 0 = north
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const i00 = y0 * width + x0;
    const i10 = y0 * width + x1;
    const i01 = y1 * width + x0;
    const i11 = y1 * width + x1;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const uu = lerp(lerp(u[i00], u[i10], tx), lerp(u[i01], u[i11], tx), ty);
    const vv = lerp(lerp(v[i00], v[i10], tx), lerp(v[i01], v[i11], tx), ty);
    return { u: uu, v: vv };
  }

  private frame = () => {
    if (!this.running) return;
    this.updateBounds();
    const ctx = this.ctx;

    // Fade existing trails toward transparent (keeps the basemap visible).
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${TRAIL_WIPE})`;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.globalCompositeOperation = 'source-over';

    const dLon = this.east - this.west || 1;
    const dLat = this.north - this.south || 1;

    for (const p of this.particles) {
      if (p.age++ > p.maxAge) {
        Object.assign(p, this.spawn());
        continue;
      }
      // Approximate screen→geo (linear; fine for the India viewport).
      const lng = this.west + (p.x / this.cssW) * dLon;
      const lat = this.north - (p.y / this.cssH) * dLat;
      const w = this.sample(lng, lat);
      if (!w) {
        Object.assign(p, this.spawn());
        continue;
      }
      p.px = p.x;
      p.py = p.y;
      p.x += w.u * SPEED_PX;
      p.y -= w.v * SPEED_PX; // screen y grows downward; v is northward
      if (p.x < 0 || p.x > this.cssW || p.y < 0 || p.y > this.cssH) {
        Object.assign(p, this.spawn());
        continue;
      }
      ctx.strokeStyle = speedColor(Math.hypot(w.u, w.v), this.field.speedMax);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    this.raf = requestAnimationFrame(this.frame);
  };
}

/** Speed → colour ramp (cyan → mint → warm white), nullschool-ish. */
function speedColor(speed: number, speedMax: number): string {
  const t = Math.min(1, speed / (speedMax || 12));
  const stops: [number, [number, number, number]][] = [
    [0.0, [86, 180, 233]], // sky blue
    [0.5, [150, 240, 210]], // mint
    [1.0, [255, 246, 200]], // warm white
  ];
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0] || 1;
  const f = (t - lo[0]) / span;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f);
  return `rgba(${r},${g},${b},${STROKE_ALPHA})`;
}
