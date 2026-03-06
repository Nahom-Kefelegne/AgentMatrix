import { TileType, OFFICE_GRID, WALKABLE_TILES, TILE_SIZE, MAP_COLS, MAP_ROWS } from '@/lib/constants';

const T = TILE_SIZE;

// Color palette
const COLORS = {
  floorLight: '#4a4535',
  floorDark: '#3f3b2e',
  wallTop: '#2a2a3a',
  wallFace: '#222233',
  wallHighlight: '#3a3a4e',
  windowGlass: '#3a6a9a',
  windowFrame: '#2a2a3a',
  windowShine: '#5a8aba',
  deskTop: '#7a5530',
  deskFront: '#5a3a1a',
  deskLeg: '#4a2a10',
  deskItem1: '#888',
  deskItem2: '#6a6a9a',
  chairSeat: '#4a4a5a',
  chairBack: '#3a3a4a',
  meetingTable: '#6a4520',
  meetingTableEdge: '#4a2a0a',
  meetingChair: '#4a4a5a',
  reception: '#5a4530',
  receptionFront: '#3a2a15',
  plantPot: '#6a4a30',
  plantLeaf1: '#2a7a2a',
  plantLeaf2: '#3a9a3a',
  plantLeaf3: '#228a22',
  bookshelf: '#5a3a20',
  book1: '#8a3030',
  book2: '#3050a0',
  book3: '#30a050',
  book4: '#a0a030',
  kitchenCounter: '#555565',
  kitchenTop: '#666676',
  kitchenSink: '#3a3a4a',
  carpetMain: '#3a2a3a',
  carpetBorder: '#4a3a4a',
  entrance: '#5a5540',
  entranceArch: '#3a3a4a',
  waitingBench: '#6a5030',
  overflow: '#3f3b2e',
};

export class TileMap {
  private grid: TileType[][] = OFFICE_GRID;
  private cacheCanvas: HTMLCanvasElement | null = null;

  getTile(col: number, row: number): TileType {
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) {
      return TileType.WALL;
    }
    return this.grid[row][col];
  }

  isWalkable(col: number, row: number): boolean {
    return WALKABLE_TILES.has(this.getTile(col, row));
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Cache the tilemap to an offscreen canvas (it never changes)
    if (!this.cacheCanvas) {
      this.cacheCanvas = document.createElement('canvas');
      this.cacheCanvas.width = MAP_COLS * T;
      this.cacheCanvas.height = MAP_ROWS * T;
      const cctx = this.cacheCanvas.getContext('2d')!;
      cctx.imageSmoothingEnabled = false;
      this.renderAll(cctx);
    }
    ctx.drawImage(this.cacheCanvas, 0, 0);
  }

  private renderAll(ctx: CanvasRenderingContext2D): void {
    // Draw floor base first
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        this.drawFloor(ctx, col, row);
      }
    }
    // Draw tiles on top
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        this.drawTile(ctx, col, row);
      }
    }
  }

  private drawFloor(ctx: CanvasRenderingContext2D, col: number, row: number): void {
    const x = col * T;
    const y = row * T;
    // Checkerboard floor
    const isLight = (col + row) % 2 === 0;
    ctx.fillStyle = isLight ? COLORS.floorLight : COLORS.floorDark;
    ctx.fillRect(x, y, T, T);
    // Subtle wood grain lines
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
    for (let i = 3; i < T; i += 5) {
      ctx.fillRect(x, y + i, T, 1);
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, col: number, row: number): void {
    const tile = this.grid[row][col];
    const x = col * T;
    const y = row * T;

    switch (tile) {
      case TileType.WALL:
        this.drawWall(ctx, x, y);
        break;
      case TileType.WINDOW_WALL:
        this.drawWindow(ctx, x, y);
        break;
      case TileType.DESK:
        this.drawDesk(ctx, x, y, col);
        break;
      case TileType.CHAIR:
        this.drawChair(ctx, x, y);
        break;
      case TileType.MEETING_TABLE:
        this.drawMeetingTable(ctx, x, y);
        break;
      case TileType.MEETING_CHAIR:
        this.drawMeetingChair(ctx, x, y);
        break;
      case TileType.RECEPTION:
        this.drawReception(ctx, x, y);
        break;
      case TileType.PLANT:
        this.drawPlant(ctx, x, y);
        break;
      case TileType.BOOKSHELF:
        this.drawBookshelf(ctx, x, y);
        break;
      case TileType.KITCHEN:
        this.drawKitchen(ctx, x, y);
        break;
      case TileType.CARPET:
        this.drawCarpet(ctx, x, y);
        break;
      case TileType.ENTRANCE:
        this.drawEntrance(ctx, x, y);
        break;
      case TileType.WAITING:
        this.drawWaiting(ctx, x, y);
        break;
      case TileType.OVERFLOW:
        // Just floor, already drawn
        break;
      case TileType.FLOOR:
        // Already drawn
        break;
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Wall face
    ctx.fillStyle = COLORS.wallTop;
    ctx.fillRect(x, y, T, T);
    // Top highlight
    ctx.fillStyle = COLORS.wallHighlight;
    ctx.fillRect(x, y, T, 2);
    // Brick pattern
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(x, y + 5, T, 1);
    ctx.fillRect(x, y + 11, T, 1);
    ctx.fillRect(x + 8, y, 1, 5);
    ctx.fillRect(x + 4, y + 6, 1, 5);
    ctx.fillRect(x + 12, y + 6, 1, 5);
    ctx.fillRect(x + 8, y + 12, 1, 4);
  }

  private drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Wall base
    ctx.fillStyle = COLORS.wallTop;
    ctx.fillRect(x, y, T, T);
    // Window frame
    ctx.fillStyle = COLORS.windowFrame;
    ctx.fillRect(x + 1, y + 2, T - 2, T - 4);
    // Glass
    ctx.fillStyle = COLORS.windowGlass;
    ctx.fillRect(x + 2, y + 3, T - 4, T - 6);
    // Cross frame
    ctx.fillStyle = COLORS.windowFrame;
    ctx.fillRect(x + 7, y + 3, 2, T - 6);
    ctx.fillRect(x + 2, y + 7, T - 4, 1);
    // Shine
    ctx.fillStyle = COLORS.windowShine;
    ctx.fillRect(x + 3, y + 4, 3, 2);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x + 10, y + 4, 2, 1);
    ctx.globalAlpha = 1;
  }

  private drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, col: number): void {
    // Desk top (slightly wider look)
    ctx.fillStyle = COLORS.deskTop;
    ctx.fillRect(x + 1, y + 2, T - 2, 8);
    // Front edge
    ctx.fillStyle = COLORS.deskFront;
    ctx.fillRect(x + 1, y + 10, T - 2, 3);
    // Legs
    ctx.fillStyle = COLORS.deskLeg;
    ctx.fillRect(x + 2, y + 13, 2, 3);
    ctx.fillRect(x + T - 4, y + 13, 2, 3);
    // Items on desk (vary by column)
    if (col % 3 === 0) {
      // Monitor
      ctx.fillStyle = COLORS.deskItem2;
      ctx.fillRect(x + 4, y + 1, 6, 4);
      ctx.fillStyle = '#4a5a7a';
      ctx.fillRect(x + 5, y + 2, 4, 2);
      ctx.fillStyle = COLORS.deskItem1;
      ctx.fillRect(x + 6, y + 5, 2, 1);
    } else if (col % 3 === 1) {
      // Laptop
      ctx.fillStyle = '#555';
      ctx.fillRect(x + 3, y + 3, 8, 5);
      ctx.fillStyle = '#7a9abb';
      ctx.fillRect(x + 4, y + 3, 6, 3);
    } else {
      // Papers + cup
      ctx.fillStyle = '#ddd';
      ctx.fillRect(x + 3, y + 3, 5, 4);
      ctx.fillStyle = '#ccc';
      ctx.fillRect(x + 4, y + 4, 3, 2);
      ctx.fillStyle = '#aa5533';
      ctx.fillRect(x + 10, y + 3, 3, 4);
    }
  }

  private drawChair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Chair back
    ctx.fillStyle = COLORS.chairBack;
    ctx.fillRect(x + 4, y + 2, 8, 3);
    // Seat
    ctx.fillStyle = COLORS.chairSeat;
    ctx.fillRect(x + 3, y + 5, 10, 6);
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 4, y + 6, 8, 2);
    // Legs
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 5, y + 12, 1, 3);
    ctx.fillRect(x + 10, y + 12, 1, 3);
    // Wheels
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 4, y + 14, 3, 2);
    ctx.fillRect(x + 9, y + 14, 3, 2);
  }

  private drawMeetingTable(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = COLORS.meetingTable;
    ctx.fillRect(x, y + 2, T, T - 4);
    ctx.fillStyle = COLORS.meetingTableEdge;
    ctx.fillRect(x, y + T - 3, T, 2);
    // Wood grain
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y + 5, T, 1);
    ctx.fillRect(x, y + 9, T, 1);
  }

  private drawMeetingChair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Small chair
    ctx.fillStyle = COLORS.meetingChair;
    ctx.fillRect(x + 4, y + 4, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 5, y + 5, 6, 4);
  }

  private drawReception(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Counter
    ctx.fillStyle = COLORS.reception;
    ctx.fillRect(x, y + 2, T, 10);
    ctx.fillStyle = COLORS.receptionFront;
    ctx.fillRect(x, y + 12, T, 4);
    // Top surface
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 1, y + 3, T - 2, 2);
    // Bell or sign
    ctx.fillStyle = '#cc9933';
    ctx.fillRect(x + 6, y + 3, 4, 3);
    ctx.fillStyle = '#ddaa44';
    ctx.fillRect(x + 7, y + 2, 2, 1);
  }

  private drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Pot
    ctx.fillStyle = COLORS.plantPot;
    ctx.fillRect(x + 4, y + 10, 8, 6);
    ctx.fillRect(x + 3, y + 10, 10, 2);
    // Soil
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(x + 5, y + 9, 6, 2);
    // Leaves
    ctx.fillStyle = COLORS.plantLeaf1;
    ctx.fillRect(x + 5, y + 3, 6, 7);
    ctx.fillStyle = COLORS.plantLeaf2;
    ctx.fillRect(x + 3, y + 4, 4, 4);
    ctx.fillRect(x + 9, y + 5, 4, 3);
    ctx.fillStyle = COLORS.plantLeaf3;
    ctx.fillRect(x + 6, y + 1, 4, 4);
    ctx.fillRect(x + 4, y + 6, 3, 2);
  }

  private drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Frame
    ctx.fillStyle = COLORS.bookshelf;
    ctx.fillRect(x + 1, y, T - 2, T);
    // Shelves
    ctx.fillStyle = '#4a2a10';
    ctx.fillRect(x + 1, y + 5, T - 2, 1);
    ctx.fillRect(x + 1, y + 10, T - 2, 1);
    // Books row 1
    ctx.fillStyle = COLORS.book1;
    ctx.fillRect(x + 2, y + 1, 2, 4);
    ctx.fillStyle = COLORS.book2;
    ctx.fillRect(x + 4, y + 1, 3, 4);
    ctx.fillStyle = COLORS.book3;
    ctx.fillRect(x + 7, y + 2, 2, 3);
    ctx.fillStyle = COLORS.book4;
    ctx.fillRect(x + 10, y + 1, 3, 4);
    // Books row 2
    ctx.fillStyle = COLORS.book2;
    ctx.fillRect(x + 2, y + 6, 3, 4);
    ctx.fillStyle = COLORS.book1;
    ctx.fillRect(x + 5, y + 7, 2, 3);
    ctx.fillStyle = COLORS.book4;
    ctx.fillRect(x + 8, y + 6, 2, 4);
    ctx.fillStyle = COLORS.book3;
    ctx.fillRect(x + 11, y + 6, 2, 4);
    // Books row 3
    ctx.fillStyle = COLORS.book3;
    ctx.fillRect(x + 2, y + 11, 4, 4);
    ctx.fillStyle = COLORS.book1;
    ctx.fillRect(x + 7, y + 12, 3, 3);
    ctx.fillStyle = COLORS.book2;
    ctx.fillRect(x + 11, y + 11, 2, 4);
  }

  private drawKitchen(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Counter
    ctx.fillStyle = COLORS.kitchenCounter;
    ctx.fillRect(x, y + 4, T, T - 4);
    // Top
    ctx.fillStyle = COLORS.kitchenTop;
    ctx.fillRect(x, y + 3, T, 3);
    // Cabinet door
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x + 2, y + 8, T - 4, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + 3, y + 9, T - 6, 1);
    // Handle
    ctx.fillStyle = '#999';
    ctx.fillRect(x + 7, y + 10, 2, 1);
    // Coffee machine or sink on top
    ctx.fillStyle = COLORS.kitchenSink;
    ctx.fillRect(x + 3, y + 1, 5, 3);
    ctx.fillStyle = '#666';
    ctx.fillRect(x + 10, y + 1, 4, 4);
    ctx.fillStyle = '#888';
    ctx.fillRect(x + 11, y + 0, 2, 1);
  }

  private drawCarpet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = COLORS.carpetMain;
    ctx.fillRect(x, y, T, T);
    // Subtle pattern
    ctx.fillStyle = COLORS.carpetBorder;
    ctx.fillRect(x, y, T, 1);
    ctx.fillRect(x, y + T - 1, T, 1);
    // Diamond pattern
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(x + 4, y + 4, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(x + 6, y + 6, 4, 4);
  }

  private drawEntrance(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Floor mat
    ctx.fillStyle = COLORS.entrance;
    ctx.fillRect(x, y, T, T);
    // Mat pattern
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = COLORS.entrance;
    ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
    // Doorway arch
    ctx.fillStyle = COLORS.entranceArch;
    ctx.fillRect(x, y, T, 3);
  }

  private drawWaiting(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    // Bench
    ctx.fillStyle = COLORS.waitingBench;
    ctx.fillRect(x + 1, y + 6, T - 2, 4);
    // Seat cushion
    ctx.fillStyle = '#5a4535';
    ctx.fillRect(x + 2, y + 5, T - 4, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 3, y + 5, T - 6, 1);
    // Legs
    ctx.fillStyle = '#3a2a15';
    ctx.fillRect(x + 2, y + 10, 2, 4);
    ctx.fillRect(x + T - 4, y + 10, 2, 4);
  }
}
