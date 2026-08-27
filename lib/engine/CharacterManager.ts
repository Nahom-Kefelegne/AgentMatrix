import type { SessionData, AgentData, Point } from '@/lib/types';
import { ENTRANCE_POINT, MEETING_ROOMS, DESK_POSITIONS, OVERFLOW_POSITIONS, TILE_SIZE } from '@/lib/constants';
import { Character } from './Character';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';

export class CharacterManager {
  private characters = new Map<string, Character>();
  private nextCharIndex = 0;

  // Track which meeting room is assigned to which team
  private teamRooms = new Map<string, number>(); // teamId → room index
  // Track reserved chairs so agents don't overlap (teamId → set of "x,y" keys)
  private reservedChairs = new Map<string, Set<string>>();

  spawn(
    session: SessionData,
    spriteSheet: SpriteSheet,
    tileMap: TileMap,
    animateEntrance = true,
  ): Character {
    const charIndex = this.nextCharIndex;
    this.nextCharIndex = (this.nextCharIndex + 1) % Math.max(spriteSheet.characterCount, 6);

    const char = new Character(
      session.id,
      session.name,
      session.color,
      spriteSheet,
      animateEntrance ? ENTRANCE_POINT.x : session.deskPosition.x,
      animateEntrance ? ENTRANCE_POINT.y : session.deskPosition.y,
      charIndex,
    );

    char.status = session.status;
    char.currentTool = session.currentTool;
    char.recentActions = session.recentActions;
    char.teamId = session.teamId;

    // Path to desk
    if (animateEntrance) {
      char.moveTo(session.deskPosition.x, session.deskPosition.y, tileMap);
    }

    this.characters.set(session.id, char);
    return char;
  }

  /** Spawn an agent character directly into a meeting room */
  spawnAgent(
    agent: AgentData,
    parentSessionId: string,
    teamId: string,
    spriteSheet: SpriteSheet,
    tileMap: TileMap,
    animateEntrance = true,
  ): Character {
    const charIndex = this.nextCharIndex;
    this.nextCharIndex = (this.nextCharIndex + 1) % Math.max(spriteSheet.characterCount, 6);

    // Assign a meeting room for this team
    const roomIndex = this.getOrAssignRoom(teamId);
    const room = MEETING_ROOMS[roomIndex];
    const chair = this.reserveChair(teamId, room.chairs);

    const char = new Character(
      agent.id,
      agent.name,
      agent.color,
      spriteSheet,
      animateEntrance ? ENTRANCE_POINT.x : chair.x,
      animateEntrance ? ENTRANCE_POINT.y : chair.y,
      charIndex,
      true, // isAgent
      undefined, // parentName resolved later
    );

    char.status = 'meeting';
    char.teamId = teamId;

    // Walk to meeting room chair
    if (animateEntrance) {
      char.moveTo(chair.x, chair.y, tileMap);
    }

    this.characters.set(agent.id, char);
    return char;
  }

  /** Move the parent session character to the meeting room too */
  moveParentToMeeting(
    parentId: string,
    teamId: string,
    tileMap: TileMap,
    animate = true,
  ): void {
    const char = this.characters.get(parentId);
    if (!char) return;
    // Don't move if already in a meeting for this team
    if (animate && char.teamId === teamId && char.status === 'meeting') return;

    const roomIndex = this.getOrAssignRoom(teamId);
    const room = MEETING_ROOMS[roomIndex];
    const chair = this.reserveChair(teamId, room.chairs);

    char.status = 'meeting';
    char.teamId = teamId;
    if (animate) char.moveTo(chair.x, chair.y, tileMap);
    else char.teleportTo(chair.x, chair.y);
  }

  private getOrAssignRoom(teamId: string): number {
    if (this.teamRooms.has(teamId)) {
      return this.teamRooms.get(teamId)!;
    }
    // Find first unoccupied room
    const usedRooms = new Set(this.teamRooms.values());
    for (let i = 0; i < MEETING_ROOMS.length; i++) {
      if (!usedRooms.has(i)) {
        this.teamRooms.set(teamId, i);
        return i;
      }
    }
    // All rooms taken — reuse room 0
    this.teamRooms.set(teamId, 0);
    return 0;
  }

  /** Reserve the next available chair for a team */
  private reserveChair(teamId: string, chairs: Point[]): Point {
    if (!this.reservedChairs.has(teamId)) {
      this.reservedChairs.set(teamId, new Set());
    }
    const reserved = this.reservedChairs.get(teamId)!;
    const chair = chairs.find(p => !reserved.has(`${p.x},${p.y}`)) || chairs[0];
    reserved.add(`${chair.x},${chair.y}`);
    return chair;
  }

  /** Release a meeting room when a team disbands */
  releaseRoom(teamId: string): void {
    this.teamRooms.delete(teamId);
    this.reservedChairs.delete(teamId);
  }

  despawn(sessionId: string, tileMap: TileMap): void {
    const char = this.characters.get(sessionId);
    if (!char) return;
    char.startExit(ENTRANCE_POINT.x, ENTRANCE_POINT.y, tileMap);
  }

  fire(sessionId: string, tileMap: TileMap): void {
    const char = this.characters.get(sessionId);
    if (!char) return;
    char.startFired(ENTRANCE_POINT.x, ENTRANCE_POINT.y, tileMap);
  }

  updateAll(dt: number): void {
    for (const [id, char] of this.characters) {
      char.update(dt);
      if (char.pendingRemoval) {
        this.characters.delete(id);
      }
    }
  }

  renderShadows(ctx: CanvasRenderingContext2D): void {
    for (const char of this.characters.values()) {
      char.renderShadow(ctx);
    }
  }

  renderAll(ctx: CanvasRenderingContext2D): void {
    const sorted = [...this.characters.values()].sort((a, b) => a.y - b.y);
    for (const char of sorted) {
      char.render(ctx);
    }
  }

  renderLabels(ctx: CanvasRenderingContext2D): void {
    for (const char of this.characters.values()) {
      char.renderLabel(ctx);
    }
  }

  renderLabelsHD(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const char of this.characters.values()) {
      char.renderLabelHD(ctx, scale);
    }
  }

  renderEmojisHD(ctx: CanvasRenderingContext2D, scale: number, reducedMotion = false): void {
    for (const char of this.characters.values()) {
      char.renderEmojiHD(ctx, scale, reducedMotion);
    }
  }

  renderBubblesHD(ctx: CanvasRenderingContext2D, scale: number): void {
    for (const char of this.characters.values()) {
      char.renderBubbleHD(ctx, scale);
    }
  }

  renderStatusDots(ctx: CanvasRenderingContext2D): void {
    for (const char of this.characters.values()) {
      char.renderStatusDot(ctx);
    }
  }

  hitTest(px: number, py: number): Character | null {
    for (const char of this.characters.values()) {
      const b = char.getBounds();
      if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) {
        return char;
      }
    }
    return null;
  }

  moveToMeeting(participantIds: string[], meetingPositions: Point[], tileMap: TileMap): void {
    participantIds.forEach((id, i) => {
      const char = this.characters.get(id);
      if (!char) return;
      const pos = meetingPositions[i % meetingPositions.length];
      char.status = 'meeting';
      char.moveTo(pos.x, pos.y, tileMap);
    });
  }

  returnToDesks(participantIds: string[], sessions: Map<string, SessionData>, tileMap: TileMap): void {
    for (const id of participantIds) {
      const char = this.characters.get(id);
      const session = sessions.get(id);
      if (!char || !session) continue;
      char.status = 'idle';
      char.moveTo(session.deskPosition.x, session.deskPosition.y, tileMap);
    }
  }

  getCharacter(id: string): Character | undefined {
    return this.characters.get(id);
  }

  /** Assign an idle desk position for an agent character */
  assignAgentDesk(agentId: string, tileMap: TileMap): Point | undefined {
    const allDesks = [...DESK_POSITIONS, ...OVERFLOW_POSITIONS];
    // Find desks not occupied by any character (compare tile coords)
    const occupiedTiles = new Set<string>();
    for (const char of this.characters.values()) {
      if (char.id === agentId) continue;
      const tileX = Math.round(char.x / TILE_SIZE);
      const tileY = Math.round(char.y / TILE_SIZE);
      occupiedTiles.add(`${tileX},${tileY}`);
    }
    for (const desk of allDesks) {
      if (!occupiedTiles.has(`${desk.x},${desk.y}`)) {
        return desk;
      }
    }
    // All desks taken — pick an overflow position
    return OVERFLOW_POSITIONS[0];
  }

  /** Find a character by name (useful for agents where IDs change) */
  findByName(name: string): Character | undefined {
    for (const char of this.characters.values()) {
      if (char.name === name) return char;
    }
    return undefined;
  }

  get all(): Map<string, Character> {
    return this.characters;
  }
}
