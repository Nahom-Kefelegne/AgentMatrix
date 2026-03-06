import type { SessionData, CharacterData, Point } from '@/lib/types';
import { CANVAS_W, CANVAS_H, SCALE, TILE_SIZE, MEETING_POSITIONS } from '@/lib/constants';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';
import { CharacterManager } from './CharacterManager';
import { ConnectionLine } from './ConnectionLine';

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private tileMap: TileMap;
  private characterManager: CharacterManager;
  private connectionLines: ConnectionLine[] = [];
  private spriteSheet: SpriteSheet;

  private running = false;
  private lastTimestamp = 0;
  private rafId = 0;

  // Callbacks for React integration
  private onCharacterHover: ((data: CharacterData | null, screenX: number, screenY: number) => void) | null = null;
  private onCharacterClick: ((data: CharacterData | null) => void) | null = null;

  // Track active sessions for returnToDesks
  private sessions = new Map<string, SessionData>();

  constructor(canvas: HTMLCanvasElement, overlayCanvas?: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    if (overlayCanvas) {
      this.overlayCanvas = overlayCanvas;
      this.overlayCtx = overlayCanvas.getContext('2d')!;
      overlayCanvas.width = CANVAS_W * SCALE;
      overlayCanvas.height = CANVAS_H * SCALE;
    }

    this.tileMap = new TileMap();
    this.characterManager = new CharacterManager();
    this.spriteSheet = new SpriteSheet();
  }

  async init(): Promise<void> {
    try {
      await this.spriteSheet.load('/sprites/characters.png');
    } catch {
      console.warn('Sprite sheet not loaded, using fallback rendering');
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private gameLoop(timestamp: number): void {
    if (!this.running) return;

    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1); // cap at 100ms
    this.lastTimestamp = timestamp;

    this.update(dt);
    this.render();

    this.rafId = requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private update(dt: number): void {
    this.characterManager.updateAll(dt);

    // Update connection lines, remove dead ones
    for (let i = this.connectionLines.length - 1; i >= 0; i--) {
      this.connectionLines[i].update(dt);
      if (this.connectionLines[i].isDead) {
        this.connectionLines.splice(i, 1);
      }
    }
  }

  private render(): void {
    this.ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Pixel art layer (native resolution)
    this.tileMap.render(this.ctx);
    this.characterManager.renderShadows(this.ctx);
    this.characterManager.renderAll(this.ctx);
    for (const line of this.connectionLines) {
      line.render(this.ctx);
    }
    this.characterManager.renderStatusDots(this.ctx);

    // Crisp text overlay (display resolution)
    if (this.overlayCtx && this.overlayCanvas) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      this.characterManager.renderLabelsHD(this.overlayCtx, SCALE);
    } else {
      // Fallback: render on game canvas (will be pixelated)
      this.characterManager.renderLabels(this.ctx);
    }
  }

  // Mouse handlers — canvasX/canvasY are in game-space (unscaled) coordinates
  handleMouseMove(canvasX: number, canvasY: number, screenX: number, screenY: number): void {
    const hit = this.characterManager.hitTest(canvasX, canvasY);
    if (this.onCharacterHover) {
      this.onCharacterHover(hit ? hit.getData() : null, screenX, screenY);
    }
  }

  handleMouseClick(canvasX: number, canvasY: number): void {
    const hit = this.characterManager.hitTest(canvasX, canvasY);
    if (this.onCharacterClick) {
      this.onCharacterClick(hit ? hit.getData() : null);
    }
  }

  setOnHover(cb: (data: CharacterData | null, screenX: number, screenY: number) => void): void {
    this.onCharacterHover = cb;
  }

  setOnClick(cb: (data: CharacterData | null) => void): void {
    this.onCharacterClick = cb;
  }

  // === Public API for React integration ===

  spawnCharacter(session: SessionData): void {
    // Skip if already spawned
    if (this.characterManager.getCharacter(session.id)) return;
    this.sessions.set(session.id, session);
    this.characterManager.spawn(session, this.spriteSheet, this.tileMap);
  }

  removeCharacter(sessionId: string): void {
    const char = this.characterManager.getCharacter(sessionId);
    if (!char) return; // already removed or never existed
    this.sessions.delete(sessionId);
    this.characterManager.despawn(sessionId, this.tileMap);
  }

  updateCharacter(sessionId: string, changes: Partial<SessionData>): void {
    const char = this.characterManager.getCharacter(sessionId);
    if (!char) return;

    // Update session record
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, changes);
    }

    if (changes.status !== undefined) char.status = changes.status;
    if (changes.currentTool !== undefined) char.currentTool = changes.currentTool;
    if (changes.recentActions !== undefined) char.recentActions = changes.recentActions;
    if (changes.teamId !== undefined) char.teamId = changes.teamId;
    if (changes.name !== undefined) char.name = changes.name;
    if (changes.lastToolSummary !== undefined) char.lastToolSummary = changes.lastToolSummary;
    if (changes.lastActivity !== undefined) char.lastActivity = changes.lastActivity;
  }

  startMeeting(teamId: string, participantIds: string[]): void {
    this.characterManager.moveToMeeting(participantIds, MEETING_POSITIONS, this.tileMap);
  }

  endMeeting(participantIds: string[]): void {
    this.characterManager.returnToDesks(participantIds, this.sessions, this.tileMap);
  }

  drawConnectionLine(fromId: string, toId: string): void {
    const fromChar = this.characterManager.getCharacter(fromId);
    const toChar = this.characterManager.getCharacter(toId);
    if (!fromChar || !toChar) return;

    const from: Point = {
      x: fromChar.x + TILE_SIZE / 2,
      y: fromChar.y + TILE_SIZE / 2,
    };
    const to: Point = {
      x: toChar.x + TILE_SIZE / 2,
      y: toChar.y + TILE_SIZE / 2,
    };

    this.connectionLines.push(new ConnectionLine(from, to, fromChar.color));
  }

  getCharacterManager(): CharacterManager {
    return this.characterManager;
  }
}
