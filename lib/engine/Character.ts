import type { Point, SessionStatus, CharacterData, Action } from '@/lib/types';
import {
  TILE_SIZE,
  CHARACTER_SPEED,
  ANIM_FRAME_DURATION,
  WALK_FRAMES,
  SPRITE_SCALE,
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
  get isLeaving(): boolean { return this.exiting || this.fired; }

  // Fired animation
  private fired = false;
  private firedTimer = 0;
  private firedPhase: 'shocked' | 'packing' | 'walking' = 'shocked';
  private static readonly SHOCKED_DURATION = 1.0;
  private static readonly PACKING_DURATION = 1.5;

  // Chat bubble
  private bubbleText: string | null = null;
  private bubbleTimer = 0;
  private static readonly BUBBLE_DURATION = 2.0; // seconds

  // Status emoji indicator (floats above head, bobs)
  private statusEmoji: string | null = null;
  private emojiTimer = 0;
  private emojiPersistent = false; // true = stays until cleared
  private static readonly EMOJI_DURATION = 5.0;

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

  getFrameInfo(): { blockX: number; blockY: number; dirRow: number; frame: number; flip: boolean } {
    const block = this.spriteSheet.getCharacterFrame(this.charIndex);
    const dirInfo = DIR_INFO[this.direction];
    return {
      blockX: block.blockX,
      blockY: block.blockY,
      dirRow: dirInfo.row,
      frame: this.animFrame,
      flip: dirInfo.flip,
    };
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

    // Tick chat bubble
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleText = null;
      }
    }

    // Tick emoji indicator
    if (this.emojiTimer > 0) {
      this.emojiTimer -= dt;
      if (this.emojiTimer <= 0) {
        if (this.emojiPersistent) {
          this.emojiTimer = Character.EMOJI_DURATION; // loop
        } else {
          this.statusEmoji = null;
        }
      }
    }

    // Fired animation phases
    if (this.fired) {
      this.firedTimer += dt;
      if (this.firedPhase === 'shocked') {
        // Stand still, looking shocked
        if (this.firedTimer >= Character.SHOCKED_DURATION) {
          this.firedPhase = 'packing';
          this.firedTimer = 0;
          this.showBubble('...');
        }
      } else if (this.firedPhase === 'packing') {
        // Bob up and down like packing
        this.bobTimer += dt * 6;
        if (this.firedTimer >= Character.PACKING_DURATION) {
          this.firedPhase = 'walking';
          this.firedTimer = 0;
          this.bobTimer = 0;
          // Now walk to exit
          if (this._firedTileMap) {
            this.exiting = true;
            this.moveTo(this._firedExitX, this._firedExitY, this._firedTileMap);
          }
        }
      }
      // 'walking' phase falls through to normal path movement below
      if (this.firedPhase !== 'walking') return;
    }

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

  /** Show a floating emoji indicator above the character */
  showEmoji(emoji: string, persistent = false): void {
    this.statusEmoji = emoji;
    this.emojiPersistent = persistent;
    this.emojiTimer = Character.EMOJI_DURATION;
  }

  /** Clear the emoji (e.g., when they start working again) */
  clearEmoji(): void {
    this.statusEmoji = null;
    this.emojiTimer = 0;
    this.emojiPersistent = false;
  }

  /** Show a chat bubble above the character */
  showBubble(text: string): void {
    // Shorten to max 15 chars
    this.bubbleText = text.length > 15 ? text.slice(0, 14) + '…' : text;
    this.bubbleTimer = Character.BUBBLE_DURATION;
  }

  /** Walk to exit and disappear */
  startExit(tileX: number, tileY: number, tileMap: TileMap): void {
    if (this.exiting || this.fired) return;
    this.exiting = true;
    this.moveTo(tileX, tileY, tileMap);
  }

  /** Start the fired animation — shocked → packing → sad walk out */
  startFired(exitTileX: number, exitTileY: number, tileMap: TileMap): void {
    if (this.fired || this.exiting) return;
    this.fired = true;
    this.firedTimer = 0;
    this.firedPhase = 'shocked';
    this.setPath([]); // stop current movement
    this.status = 'idle';
    this.showBubble('!!');
    this._firedExitX = exitTileX;
    this._firedExitY = exitTileY;
    this._firedTileMap = tileMap;
  }
  private _firedExitX = 0;
  private _firedExitY = 0;
  private _firedTileMap: TileMap | null = null;

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
    let drawY = this.y;

    if (this.fired && this.firedPhase === 'packing') {
      // Frantic bobbing while "packing"
      drawY = this.y + Math.sin(this.bobTimer) * 1.5;
    } else if (this.fired && this.firedPhase === 'shocked') {
      // Slight shake
      const shake = Math.sin(this.firedTimer * 20) * 0.5;
      drawY = this.y + shake;
    } else if (this.status === 'working' && !this.isMoving) {
      drawY = this.y + Math.sin(this.bobTimer * 3) * 0.5;
    }

    if (this.spriteSheet.isReady) {
      const block = this.spriteSheet.getCharacterFrame(this.charIndex);
      const dirInfo = DIR_INFO[this.direction];
      const drawW = Math.round(TILE_SIZE * SPRITE_SCALE);
      const drawH = Math.round(17 * SPRITE_SCALE); // 17 = sprite frame height
      // Center the bigger sprite on the tile position
      const offsetX = (TILE_SIZE - drawW) / 2;
      const offsetY = TILE_SIZE - drawH; // anchor at feet
      this.spriteSheet.drawCharFrame(
        ctx,
        block.blockX,
        block.blockY,
        dirInfo.row,
        this.animFrame,
        this.x + offsetX,
        drawY + offsetY,
        dirInfo.flip,
        drawW,
        drawH,
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

    // Draw flashing laptop/monitor when working and not moving
    if (this.status === 'working' && !this.isMoving && !this.fired) {
      const monX = this.x + 1;
      const monY = this.y + TILE_SIZE - 7;
      // Monitor body
      ctx.fillStyle = '#333';
      ctx.fillRect(monX, monY, 10, 7);
      // Screen with flashing colors
      const screenColors = ['#3a7aff', '#4ade80', '#f59e0b', '#8b5cf6'];
      const colorIdx = Math.floor(this.bobTimer * 4) % screenColors.length;
      ctx.fillStyle = screenColors[colorIdx];
      ctx.fillRect(monX + 1, monY + 1, 8, 4);
      // Text lines on screen
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(monX + 2, monY + 2, 4, 1);
      ctx.fillRect(monX + 2, monY + 4, 6, 1);
      // Monitor stand
      ctx.fillStyle = '#555';
      ctx.fillRect(monX + 4, monY + 7, 2, 1);
    }

    // Draw cardboard box when fired (packing or walking phase)
    if (this.fired && (this.firedPhase === 'packing' || this.firedPhase === 'walking')) {
      const boxX = this.x + TILE_SIZE - 2;
      const boxY = drawY + 6;
      // Box body
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(boxX, boxY, 7, 6);
      // Box flaps (open during packing, closed during walking)
      ctx.fillStyle = '#cd9b1d';
      if (this.firedPhase === 'packing') {
        // Open flaps
        ctx.fillRect(boxX - 1, boxY - 1, 3, 2);
        ctx.fillRect(boxX + 5, boxY - 1, 3, 2);
      } else {
        // Closed flaps
        ctx.fillRect(boxX, boxY - 1, 7, 2);
      }
      // Box tape
      ctx.fillStyle = '#8b7355';
      ctx.fillRect(boxX + 3, boxY, 1, 6);
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
    const fontSize = 13;
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
    const dotY = this.y - 6;

    ctx.save();
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Render chat bubble on the HD overlay */
  renderBubbleHD(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.bubbleText) return;

    const fontSize = 10;
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const bx = (this.x + TILE_SIZE / 2) * scale;
    const by = (this.y - 4) * scale;

    const metrics = ctx.measureText(this.bubbleText);
    const padX = 6;
    const padY = 4;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;

    // Fade out in last 0.5s
    const alpha = this.bubbleTimer < 0.5 ? this.bubbleTimer / 0.5 : 1;
    ctx.globalAlpha = alpha;

    // Bubble background
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(bx - w / 2, by - h, w, h, 4);
    ctx.fill();

    // Bubble tail (small triangle)
    ctx.beginPath();
    ctx.moveTo(bx - 4, by);
    ctx.lineTo(bx + 4, by);
    ctx.lineTo(bx, by + 5);
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = '#222';
    ctx.fillText(this.bubbleText, bx, by - padY);

    ctx.globalAlpha = 1;
  }

  /** Render floating emoji on the HD overlay */
  renderEmojiHD(ctx: CanvasRenderingContext2D, scale: number): void {
    if (!this.statusEmoji) return;

    const x = (this.x + TILE_SIZE / 2) * scale;
    const baseY = (this.y - 14) * scale;
    // Gentle bob up and down
    const bob = Math.sin((Character.EMOJI_DURATION - this.emojiTimer) * 3) * 4;
    const y = baseY + bob;

    // For persistent emojis, don't fade. For timed ones, fade in last 1s.
    if (!this.emojiPersistent) {
      const alpha = this.emojiTimer < 1.0 ? this.emojiTimer : 1;
      ctx.globalAlpha = alpha;
    }

    ctx.font = '24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.statusEmoji, x, y);

    ctx.globalAlpha = 1;
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
