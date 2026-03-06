import { CONNECTION_LINE_LIFETIME } from '@/lib/constants';
import type { Point } from '@/lib/types';

export class ConnectionLine {
  from: Point;
  to: Point;
  color: string;
  alpha: number;
  lifetime: number;
  elapsed: number = 0;

  constructor(from: Point, to: Point, color: string) {
    this.from = from;
    this.to = to;
    this.color = color;
    this.alpha = 1;
    this.lifetime = CONNECTION_LINE_LIFETIME;
  }

  update(dt: number): void {
    this.elapsed += dt;
    const fadeStart = this.lifetime - 1;
    if (this.elapsed >= fadeStart) {
      this.alpha = Math.max(0, 1 - (this.elapsed - fadeStart));
    }
  }

  get isDead(): boolean {
    return this.alpha <= 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    // Glow effect
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 4;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(this.from.x, this.from.y);
    ctx.lineTo(this.to.x, this.to.y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
