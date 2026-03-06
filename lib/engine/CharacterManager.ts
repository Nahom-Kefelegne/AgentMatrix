import type { SessionData, Point } from '@/lib/types';
import { ENTRANCE_POINT, TILE_SIZE } from '@/lib/constants';
import { Character } from './Character';
import { SpriteSheet } from './SpriteSheet';
import { TileMap } from './TileMap';

export class CharacterManager {
  private characters = new Map<string, Character>();
  private nextCharIndex = 0;

  spawn(session: SessionData, spriteSheet: SpriteSheet, tileMap: TileMap): Character {
    const charIndex = this.nextCharIndex;
    this.nextCharIndex = (this.nextCharIndex + 1) % Math.max(spriteSheet.characterCount, 6);

    const char = new Character(
      session.id,
      session.name,
      session.color,
      spriteSheet,
      ENTRANCE_POINT.x,
      ENTRANCE_POINT.y,
      charIndex,
    );

    char.status = session.status;
    char.currentTool = session.currentTool;
    char.recentActions = session.recentActions;
    char.teamId = session.teamId;

    // Path to desk
    const desk = session.deskPosition;
    char.moveTo(desk.x, desk.y, tileMap);

    this.characters.set(session.id, char);
    return char;
  }

  despawn(sessionId: string, tileMap: TileMap): void {
    const char = this.characters.get(sessionId);
    if (!char) return;

    char.startExit(ENTRANCE_POINT.x, ENTRANCE_POINT.y, tileMap);
  }

  updateAll(dt: number): void {
    for (const [id, char] of this.characters) {
      char.update(dt);

      // Remove characters after jump animation completes
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
    // Y-sorted rendering for depth
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
      char.status = session.status === 'meeting' ? 'idle' : session.status;
      char.moveTo(session.deskPosition.x, session.deskPosition.y, tileMap);
    }
  }

  getCharacter(id: string): Character | undefined {
    return this.characters.get(id);
  }

  get all(): Map<string, Character> {
    return this.characters;
  }
}
