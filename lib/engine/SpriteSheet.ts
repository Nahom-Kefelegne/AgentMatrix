// Sprite sheet layout for 32_Characters set:
// Each character block: 64x51 pixels = 4 frames (16px wide) x 3 directions (17px tall)
// 8 characters per row in the combined sheet
// Row 0: walk down, Row 1: walk left, Row 2: walk up
// 4 animation frames per direction (frame 0 = stand, 1-3 = walk cycle)

const FRAME_W = 16;
const FRAME_H = 17;
const FRAMES_PER_DIR = 4;
const DIRS_PER_CHAR = 3;  // down, left, up
const CHAR_BLOCK_W = FRAME_W * FRAMES_PER_DIR;  // 64
const CHAR_BLOCK_H = FRAME_H * DIRS_PER_CHAR;   // 51
const CHARS_PER_ROW = 8;

export interface CharacterFrameInfo {
  /** Pixel X offset of this character's block in the sheet */
  blockX: number;
  /** Pixel Y offset of this character's block in the sheet */
  blockY: number;
}

export class SpriteSheet {
  private image: HTMLImageElement | null = null;
  private ready = false;

  get isReady(): boolean {
    return this.ready;
  }

  load(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.ready = true;
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load sprite sheet: ${url}`));
      img.src = url;
    });
  }

  getCharacterFrame(charIndex: number): CharacterFrameInfo {
    const col = charIndex % CHARS_PER_ROW;
    const row = Math.floor(charIndex / CHARS_PER_ROW);
    return {
      blockX: col * CHAR_BLOCK_W,
      blockY: row * CHAR_BLOCK_H,
    };
  }

  get characterCount(): number {
    if (!this.image) return 24; // fallback
    const cols = Math.floor(this.image.width / CHAR_BLOCK_W);
    const rows = Math.floor(this.image.height / CHAR_BLOCK_H);
    return cols * rows;
  }

  /**
   * Draw a specific frame for a character.
   * @param dirRow 0=down, 1=left, 2=up (right = left flipped)
   * @param frame 0-3 animation frame
   * @param blockX pixel X of character block
   * @param blockY pixel Y of character block
   */
  drawCharFrame(
    ctx: CanvasRenderingContext2D,
    blockX: number,
    blockY: number,
    dirRow: number,
    frame: number,
    destX: number,
    destY: number,
    flip = false,
  ): void {
    if (!this.image) return;

    const srcX = blockX + frame * FRAME_W;
    const srcY = blockY + dirRow * FRAME_H;

    if (flip) {
      ctx.save();
      ctx.translate(destX + FRAME_W, destY);
      ctx.scale(-1, 1);
      ctx.drawImage(
        this.image,
        srcX, srcY, FRAME_W, FRAME_H,
        0, 0, FRAME_W, FRAME_H,
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        this.image,
        srcX, srcY, FRAME_W, FRAME_H,
        destX, destY, FRAME_W, FRAME_H,
      );
    }
  }
}
