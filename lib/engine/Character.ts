import type { Point, SessionStatus, CharacterData, Action } from '@/lib/types';
import {
  TILE_SIZE,
  CHARACTER_SPEED,
  ANIM_FRAME_DURATION,
  WALK_FRAMES,
  Direction,
  STATUS_COLORS,
} from '@/lib/constants';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';
import { Pathfinder } from './Pathfinder';

// Direction → sprite row (0=down, 1=left, 2=up) and whether to flip horizontally
const DIR_INFO: Record<Direction, { row: number; flip: boolean }> = {
  [Direction.DOWN]:  { row: 0, flip: false },
  [Direction.LEFT]:  { row: 1, flip: false },
  [Direction.RIGHT]: { row: 1, flip: true },  // mirror of left
  [Direction.UP]:    { row: 2, flip: false },
};

export class Character {
  id: string;
  name: string;
  color: string;
  status: SessionStatus;
  currentTool?: string;
  lastToolSummary?: string;
  lastActivity?: number;
  recentActions: Action[] = [];
  teamId?: string;
  isAgent: boolean;
  parentName?: string;

  // Position in pixels
  x: number;
  y: number;

  // Tile position target
  private path: Point[] = [];
  private direction: Direction = Direction.DOWN;
  private animFrame: number = 0;
  private animTimer: number = 0;
  private bobTimer: number = 0;

  private exiting = false;
  private exitDone = false;
  get pendingRemoval(): boolean { return this.exitDone; }

  private spriteSheet: SpriteSheet;
  private charIndex: number;

  constructor(
    id: string,
    name: string,
    color: string,
    spriteSheet: SpriteSheet,
    startTileX: number,
    startTileY: number,
    charIndex = 0,
    isAgent = false,
    parentName?: string,
  ) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.status = 'idle';
    this.spriteSheet = spriteSheet;
    this.charIndex = charIndex;
    this.isAgent = isAgent;
    this.parentName = parentName;

    this.x = startTileX * TILE_SIZE;
    this.y = startTileY * TILE_SIZE;
  }

  get tileX(): number {
    return Math.round(this.x / TILE_SIZE);
  }

  get tileY(): number {
    return Math.round(this.y / TILE_SIZE);
  }

  get isMoving(): boolean {
    return this.path.length > 0;
  }

  moveTo(tileX: number, tileY: number, tileMap: TileMap): void {
    const start: Point = { x: this.tileX, y: this.tileY };
    const end: Point = { x: tileX, y: tileY };
    const path = Pathfinder.findPath(start, end, tileMap);
    this.setPath(path);
  }

  setPath(path: Point[]): void {
    this.path = [...path];
  }

  update(dt: number): void {
    if (this.exitDone) return;

    if (this.path.length > 0) {
      this.moveAlongPath(dt);
      this.animTimer += dt;
      if (this.animTimer >= ANIM_FRAME_DURATION) {
        this.animTimer -= ANIM_FRAME_DURATION;
        this.animFrame = (this.animFrame + 1) % WALK_FRAMES;
      }

      // Arrived at entrance — done
      if (this.path.length === 0 && this.exiting) {
        this.exitDone = true;
      }
    } else {
      this.animFrame = 0;
      this.animTimer = 0;

      if (this.status === 'working') {
        this.bobTimer += dt;
      }
    }
  }

  /** Walk to exit and disappear */
  startExit(tileX: number, tileY: number, tileMap: TileMap): void {
    if (this.exiting) return;
    this.exiting = true;
    this.moveTo(tileX, tileY, tileMap);
  }

  private moveAlongPath(dt: number): void {
    const target = this.path[0];
    const targetX = target.x * TILE_SIZE;
    const targetY = target.y * TILE_SIZE;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (Math.abs(dx) > Math.abs(dy)) {
      this.direction = dx > 0 ? Direction.RIGHT : Direction.LEFT;
    } else {
      this.direction = dy > 0 ? Direction.DOWN : Direction.UP;
    }

    const moveAmount = CHARACTER_SPEED * dt;
    if (moveAmount >= dist) {
      this.x = targetX;
      this.y = targetY;
      this.path.shift();
    } else {
      this.x += (dx / dist) * moveAmount;
      this.y += (dy / dist) * moveAmount;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const drawY = this.status === 'working' && !this.isMoving
      ? this.y + Math.sin(this.bobTimer * 3) * 0.5
      : this.y;

    if (this.spriteSheet.isReady) {
      const block = this.spriteSheet.getCharacterFrame(this.charIndex);
      const dirInfo = DIR_INFO[this.direction];
      this.spriteSheet.drawCharFrame(
        ctx,
        block.blockX,
        block.blockY,
        dirInfo.row,
        this.animFrame,
        this.x,
        drawY,
        dirInfo.flip,
      );
    } else {
      // Fallback: colored circle
      ctx.save();
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x + TILE_SIZE / 2, drawY + TILE_SIZE / 2, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.x + 4, drawY + 5, 3, 3);
      ctx.fillRect(this.x + 9, drawY + 5, 3, 3);
      ctx.fillStyle = '#000';
      ctx.fillRect(this.x + 5, drawY + 6, 2, 2);
      ctx.fillRect(this.x + 10, drawY + 6, 2, 2);
      ctx.restore();
    }
  }

  renderShadow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(
      this.x + TILE_SIZE / 2,
      this.y + TILE_SIZE - 1,
      TILE_SIZE / 3,
      2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  renderLabel(ctx: CanvasRenderingContext2D): void {
    // Fallback for non-HD rendering
    const label = this.name;
    ctx.font = '3px sans-serif';
    ctx.textAlign = 'center';
    const labelX = this.x + TILE_SIZE / 2;
    const labelY = this.y + TILE_SIZE + 4;
    ctx.fillStyle = '#fff';
    ctx.fillText(label, labelX, labelY);
  }

  /** Render label on a high-resolution overlay canvas for crisp text */
  renderLabelHD(ctx: CanvasRenderingContext2D, scale: number): void {
    const label = this.name;
    const fontSize = 11;
    ctx.font = `600 ${fontSize}px 'Courier New', Courier, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const labelX = (this.x + TILE_SIZE / 2) * scale;
    const labelY = (this.y + TILE_SIZE + 1) * scale;

    const metrics = ctx.measureText(label);
    const padX = 4;
    const padY = 2;

    // Background pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const bgWidth = metrics.width + padX * 2;
    const bgHeight = fontSize + padY * 2;
    ctx.beginPath();
    const r = 3;
    const bx = labelX - bgWidth / 2;
    const by = labelY;
    ctx.roundRect(bx, by, bgWidth, bgHeight, r);
    ctx.fill();

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, labelX, labelY + padY);
  }

  renderStatusDot(ctx: CanvasRenderingContext2D): void {
    const dotColor = STATUS_COLORS[this.status] ?? STATUS_COLORS.idle;
    const dotX = this.x + TILE_SIZE / 2;
    const dotY = this.y - 2;

    ctx.save();
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  getBounds(): { x: number; y: number; w: number; h: number } {
    return { x: this.x, y: this.y, w: TILE_SIZE, h: TILE_SIZE };
  }

  getData(): CharacterData {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      status: this.status,
      currentTool: this.currentTool,
      lastToolSummary: this.lastToolSummary,
      lastActivity: this.lastActivity,
      recentActions: this.recentActions,
      teamId: this.teamId,
      isAgent: this.isAgent,
      parentName: this.parentName,
    };
  }
}
