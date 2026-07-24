import type { SessionData, AgentData, CharacterData, Point } from '@/lib/types';
import { CANVAS_W, CANVAS_H, SCALE, TILE_SIZE, MEETING_POSITIONS, TileType } from '@/lib/constants';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';
import { CharacterManager } from './CharacterManager';
import { Character } from './Character';
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

      // Highlight selected character
      if (this.highlightedId) {
        const hChar = this.characterManager.getCharacter(this.highlightedId);
        if (hChar) {
          const hx = (hChar.x + TILE_SIZE / 2) * SCALE;
          const hy = (hChar.y + TILE_SIZE / 2) * SCALE;
          const hr = TILE_SIZE * SCALE * 0.8;
          this.overlayCtx.save();
          this.overlayCtx.strokeStyle = '#4a9eff';
          this.overlayCtx.lineWidth = 3;
          this.overlayCtx.shadowColor = '#4a9eff';
          this.overlayCtx.shadowBlur = 12;
          this.overlayCtx.beginPath();
          this.overlayCtx.arc(hx, hy, hr, 0, Math.PI * 2);
          this.overlayCtx.stroke();
          this.overlayCtx.restore();
        }
      }

      this.characterManager.renderEmojisHD(this.overlayCtx, SCALE);
      this.characterManager.renderBubblesHD(this.overlayCtx, SCALE);
      this.characterManager.renderLabelsHD(this.overlayCtx, SCALE);
    } else {
      // Fallback: render on game canvas (will be pixelated)
      this.characterManager.renderLabels(this.ctx);
    }
  }

  // === Drag state ===
  private dragging: Character | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // Mouse handlers — canvasX/canvasY are in game-space (unscaled) coordinates
  handleMouseMove(canvasX: number, canvasY: number, screenX: number, screenY: number): void {
    if (this.dragging) {
      this.dragging.x = canvasX - this.dragOffsetX;
      this.dragging.y = canvasY - this.dragOffsetY;
      return;
    }
    const hit = this.characterManager.hitTest(canvasX, canvasY);
    if (this.onCharacterHover) {
      this.onCharacterHover(hit ? hit.getData() : null, screenX, screenY);
    }
  }

  handleMouseDown(canvasX: number, canvasY: number): void {
    const hit = this.characterManager.hitTest(canvasX, canvasY);
    if (hit) {
      this.dragging = hit;
      this.dragOffsetX = canvasX - hit.x;
      this.dragOffsetY = canvasY - hit.y;
      hit.setPath([]); // cancel current movement
    }
  }

  handleMouseUp(canvasX: number, canvasY: number): void {
    if (this.dragging) {
      const dropTileX = Math.floor(canvasX / TILE_SIZE);
      const dropTileY = Math.floor(canvasY / TILE_SIZE);

      // Search nearby tiles (5x5 area) for the nearest chair
      const SEARCH_RADIUS = 2;
      let nearestChair: { x: number; y: number; dist: number } | null = null;

      for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
        for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
          const tx = dropTileX + dx;
          const ty = dropTileY + dy;
          const tile = this.tileMap.getTile(tx, ty);
          if (tile === TileType.CHAIR || tile === TileType.MEETING_CHAIR) {
            const dist = dx * dx + dy * dy;
            if (!nearestChair || dist < nearestChair.dist) {
              nearestChair = { x: tx, y: ty, dist };
            }
          }
        }
      }

      if (nearestChair) {
        this.dragging.x = nearestChair.x * TILE_SIZE;
        this.dragging.y = nearestChair.y * TILE_SIZE;
        this.dragging.setPath([]);
      } else {
        // No chair nearby — walk back to desk
        const session = this.sessions.get(this.dragging.id);
        if (session) {
          this.dragging.moveTo(session.deskPosition.x, session.deskPosition.y, this.tileMap);
        }
      }
      this.dragging = null;
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
    if (!char) return;
    this.sessions.delete(sessionId);
    // If already in fired animation, let it finish — don't override with regular exit
    if (char.isLeaving) return;
    this.characterManager.despawn(sessionId, this.tileMap);
  }

  fireCharacter(sessionId: string): void {
    const char = this.characterManager.getCharacter(sessionId);
    if (!char) return;
    this.sessions.delete(sessionId);
    this.characterManager.fire(sessionId, this.tileMap);
  }

  updateCharacter(sessionId: string, changes: Partial<SessionData>): void {
    const char = this.characterManager.getCharacter(sessionId);
    if (!char) return;
    // Don't update characters that are in exit/fired animation
    if (char.isLeaving) return;

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

  spawnAgent(sessionId: string, agent: AgentData, teamId: string): void {
    if (this.characterManager.getCharacter(agent.id)) return;
    this.characterManager.spawnAgent(agent, sessionId, teamId, this.spriteSheet, this.tileMap);
    // Also move the parent to the meeting room
    this.characterManager.moveParentToMeeting(sessionId, teamId, this.tileMap);
  }

  removeAgent(sessionId: string, agentId: string): void {
    this.characterManager.despawn(agentId, this.tileMap);
  }

  /** Move an agent from meeting room to an idle desk position */
  idleAgent(parentSessionId: string, agentId: string): void {
    const char = this.characterManager.getCharacter(agentId);
    if (!char || char.isLeaving) return;
    // Assign a desk position for the agent
    const deskPos = this.characterManager.assignAgentDesk(agentId, this.tileMap);
    char.status = 'idle';
    char.teamId = undefined;
    if (deskPos) {
      char.moveTo(deskPos.x, deskPos.y, this.tileMap);
    }
  }

  returnToDeskAfterMeeting(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    const char = this.characterManager.getCharacter(sessionId);
    if (!char || !session) return;
    // Release the meeting room
    if (char.teamId) {
      this.characterManager.releaseRoom(char.teamId);
    }
    char.status = 'idle';
    char.teamId = undefined;
    char.moveTo(session.deskPosition.x, session.deskPosition.y, this.tileMap);
  }

  startMeeting(teamId: string, participantIds: string[]): void {
    this.characterManager.moveToMeeting(participantIds, MEETING_POSITIONS, this.tileMap);
  }

  endMeeting(participantIds: string[]): void {
    this.characterManager.returnToDesks(participantIds, this.sessions, this.tileMap);
  }

  showEmoji(characterId: string, emoji: string, persistent = false): void {
    const char = this.characterManager.getCharacter(characterId);
    if (char) char.showEmoji(emoji, persistent);
  }

  clearEmoji(characterId: string): void {
    const char = this.characterManager.getCharacter(characterId);
    if (char) char.clearEmoji();
  }

  showChatBubble(characterId: string, text: string): void {
    const char = this.characterManager.getCharacter(characterId);
    if (char) char.showBubble(text);
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

  private highlightedId: string | null = null;

  highlightCharacter(characterId: string | null): void {
    this.highlightedId = characterId;
  }

  getCharacterManager(): CharacterManager {
    return this.characterManager;
  }

  /**
   * Get a character's screen position (in display pixels) and a data URL of its sprite.
   * Used for the floating sprite animation when opening the session dialog.
   */
  getCharacterScreenInfo(characterId: string): {
    screenX: number;
    screenY: number;
    spriteDataURL: string;
    name: string;
    color: string;
  } | null {
    const char = this.characterManager.getCharacter(characterId);
    if (!char) return null;

    // Screen position (center of character, in display coordinates)
    const canvasEl = this.canvas;
    const rect = canvasEl.getBoundingClientRect();
    const screenX = rect.left + (char.x + TILE_SIZE / 2) * (rect.width / CANVAS_W);
    const screenY = rect.top + (char.y + TILE_SIZE / 2) * (rect.height / CANVAS_H);

    // Render sprite to a small offscreen canvas
    const spriteSize = 64;
    const offscreen = document.createElement('canvas');
    offscreen.width = spriteSize;
    offscreen.height = spriteSize;
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // Draw the character's current frame centered in the canvas
    if (this.spriteSheet.isReady) {
      const frame = char.getFrameInfo();
      this.spriteSheet.drawCharFrame(
        ctx,
        frame.blockX, frame.blockY,
        frame.dirRow, frame.frame,
        (spriteSize - 48) / 2, (spriteSize - 51) / 2,
        frame.flip,
        48, 51,
      );
    }

    return {
      screenX,
      screenY,
      spriteDataURL: offscreen.toDataURL(),
      name: char.name,
      color: char.color,
    };
  }
}
