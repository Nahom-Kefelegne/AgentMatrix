import type { SessionData, AgentData, CharacterData, Point } from '@/lib/types';
import { CANVAS_W, CANVAS_H, SCALE, TILE_SIZE, MEETING_POSITIONS, TileType } from '@/lib/constants';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';
import { CharacterManager } from './CharacterManager';
import { Character } from './Character';
import { ConnectionLine } from './ConnectionLine';
import { perfEvent } from '@/lib/perf';

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
  private suspended = false;
  private lastTimestamp = 0;
  private rafId = 0;
  private readonly targetFrameMs: number;
  private overlayScale = SCALE;
  private readonly reducedMotion: boolean;

  // Callbacks for React integration
  private onCharacterHover: ((data: CharacterData | null, screenX: number, screenY: number) => void) | null = null;
  private onCharacterClick: ((data: CharacterData | null) => void) | null = null;

  // Track active sessions for returnToDesks
  private sessions = new Map<string, SessionData>();

  constructor(
    canvas: HTMLCanvasElement,
    overlayCanvas?: HTMLCanvasElement,
    options: { reducedMotion?: boolean } = {},
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    if (overlayCanvas) {
      this.overlayCanvas = overlayCanvas;
      this.overlayCtx = overlayCanvas.getContext('2d')!;
      this.overlayScale = overlayCanvas.width / CANVAS_W || SCALE;
    }

    this.reducedMotion = options.reducedMotion === true;
    this.targetFrameMs = 1000 / (this.reducedMotion ? 12 : 30);
    this.tileMap = new TileMap();
    this.characterManager = new CharacterManager();
    this.spriteSheet = new SpriteSheet();
  }

  async loadAssets(): Promise<void> {
    try {
      await this.spriteSheet.load('/sprites/characters.png');
      if (this.running && !this.suspended) this.render();
    } catch {
      console.warn('Sprite sheet not loaded, using fallback rendering');
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimestamp = performance.now();
    this.render();
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return;
    this.suspended = suspended;
    perfEvent(suspended ? 'office:suspended' : 'office:resumed');
    if (suspended) {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    if (this.running) {
      this.lastTimestamp = performance.now();
      this.render();
      this.scheduleFrame();
    }
  }

  resizeOverlay(width: number, height: number): void {
    if (!this.overlayCanvas || !this.overlayCtx) return;
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (
      this.overlayCanvas.width !== nextWidth
      || this.overlayCanvas.height !== nextHeight
    ) {
      this.overlayCanvas.width = nextWidth;
      this.overlayCanvas.height = nextHeight;
      this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    }
    this.overlayScale = nextWidth / CANVAS_W;
    if (this.running && !this.suspended) this.render();
  }

  private scheduleFrame(): void {
    if (!this.running || this.suspended || this.rafId) return;
    this.rafId = requestAnimationFrame((ts) => this.gameLoop(ts));
  }

  private gameLoop(timestamp: number): void {
    this.rafId = 0;
    if (!this.running || this.suspended) return;

    const elapsed = timestamp - this.lastTimestamp;
    if (elapsed >= this.targetFrameMs) {
      const dt = Math.min(elapsed / 1000, 0.1);
      this.lastTimestamp = timestamp - (elapsed % this.targetFrameMs);

      this.update(dt);
      this.render();
    }

    this.scheduleFrame();
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
    perfEvent('office:frame');
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
          const hx = (hChar.x + TILE_SIZE / 2) * this.overlayScale;
          const hy = (hChar.y + TILE_SIZE / 2) * this.overlayScale;
          const hr = TILE_SIZE * this.overlayScale * 0.8;
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

      this.characterManager.renderEmojisHD(this.overlayCtx, this.overlayScale, this.reducedMotion);
      this.characterManager.renderBubblesHD(this.overlayCtx, this.overlayScale);
      this.characterManager.renderLabelsHD(this.overlayCtx, this.overlayScale);
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

  spawnCharacter(session: SessionData, animateEntrance = true): void {
    // Skip if already spawned
    if (this.characterManager.getCharacter(session.id)) return;
    const internalSession: SessionData = {
      ...session,
      recentActions: [...session.recentActions],
      agents: session.agents.map(agent => ({ ...agent })),
    };
    this.sessions.set(session.id, internalSession);
    this.characterManager.spawn(
      internalSession,
      this.spriteSheet,
      this.tileMap,
      animateEntrance,
    );
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
    if (changes.name !== undefined) char.setName(changes.name);
    if (changes.lastToolSummary !== undefined) char.lastToolSummary = changes.lastToolSummary;
    if (changes.lastActivity !== undefined) char.lastActivity = changes.lastActivity;
  }

  spawnAgent(
    sessionId: string,
    agent: AgentData,
    teamId: string,
    animateEntrance = true,
    moveParent = true,
  ): void {
    if (this.characterManager.getCharacter(agent.id)) return;
    this.characterManager.spawnAgent(
      agent,
      sessionId,
      teamId,
      this.spriteSheet,
      this.tileMap,
      animateEntrance,
    );
    if (moveParent) {
      this.characterManager.moveParentToMeeting(
        sessionId,
        teamId,
        this.tileMap,
        animateEntrance,
      );
    }
  }

  hydrateSessions(sessions: Iterable<SessionData>): void {
    for (const session of sessions) {
      this.spawnCharacter(session, false);
      if (session.status === 'idle') {
        this.showEmoji(session.id, '💤', true);
      } else if (session.status === 'attention') {
        this.showEmoji(session.id, '✋', true);
      }
      session.agents.forEach((agent, index) => {
        const teamId = agent.teamName || `team-${session.id.slice(0, 6)}`;
        this.spawnAgent(session.id, agent, teamId, false, index === 0);
      });
    }
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

}
