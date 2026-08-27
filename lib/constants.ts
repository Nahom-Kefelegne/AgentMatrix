import type { Point } from './types';

// ===== Grid & Rendering =====

export const TILE_SIZE = 16;
export const MAP_COLS = 38;
export const MAP_ROWS = 26;
export const SCALE = 2.5;
export const CANVAS_W = MAP_COLS * TILE_SIZE; // 608
export const CANVAS_H = MAP_ROWS * TILE_SIZE; // 416
export const DISPLAY_W = Math.round(CANVAS_W * SCALE); // 1520
export const DISPLAY_H = Math.round(CANVAS_H * SCALE); // 1040

// ===== Tile Types =====

export enum TileType {
  WALL = 0,
  FLOOR = 1,
  DESK = 2,
  CHAIR = 3,
  MEETING_TABLE = 4,
  MEETING_CHAIR = 5,
  RECEPTION = 6,
  PLANT = 7,
  BOOKSHELF = 8,
  KITCHEN = 9,
  WINDOW_WALL = 10,
  CARPET = 11,
  ENTRANCE = 12,
  WAITING = 13,
  OVERFLOW = 14,
}

export const WALKABLE_TILES = new Set<TileType>([
  TileType.FLOOR,
  TileType.CHAIR,
  TileType.MEETING_CHAIR,
  TileType.CARPET,
  TileType.ENTRANCE,
  TileType.WAITING,
  TileType.OVERFLOW,
]);

// ===== Tile Colors (programmatic fallback) =====

export const TILE_COLORS: Record<TileType, string> = {
  [TileType.WALL]: '#2a2a3a',
  [TileType.FLOOR]: '#3d3a2e',
  [TileType.DESK]: '#6b4226',
  [TileType.CHAIR]: '#4a4a3a',
  [TileType.MEETING_TABLE]: '#5a3a1a',
  [TileType.MEETING_CHAIR]: '#4a4a3a',
  [TileType.RECEPTION]: '#5a4a3a',
  [TileType.PLANT]: '#2a5a2a',
  [TileType.BOOKSHELF]: '#4a3a2a',
  [TileType.KITCHEN]: '#3a3a4a',
  [TileType.WINDOW_WALL]: '#4a6a8a',
  [TileType.CARPET]: '#3a2a3a',
  [TileType.ENTRANCE]: '#5a5a4a',
  [TileType.WAITING]: '#4a4a3a',
  [TileType.OVERFLOW]: '#3d3a2e',
};

// ===== Positions =====

export const DESK_POSITIONS: Point[] = [
  { x: 6, y: 4 },
  { x: 8, y: 4 },
  { x: 15, y: 4 },
  { x: 17, y: 4 },
  { x: 24, y: 4 },
  { x: 26, y: 4 },
  { x: 6, y: 8 },
  { x: 8, y: 8 },
  { x: 15, y: 8 },
  { x: 17, y: 8 },
];

// 3 meeting rooms, well-spaced across the bottom half
// Room A (left): rows 14-19, cols 2-10
// Room B (center): rows 14-19, cols 14-22
// Room C (right): rows 14-19, cols 26-34
export const MEETING_ROOMS: { id: string; chairs: Point[] }[] = [
  {
    id: 'room-a',
    chairs: [
      { x: 4, y: 15 }, { x: 6, y: 15 }, { x: 8, y: 15 },
      { x: 4, y: 18 }, { x: 6, y: 18 }, { x: 8, y: 18 },
    ],
  },
  {
    id: 'room-b',
    chairs: [
      { x: 16, y: 15 }, { x: 18, y: 15 }, { x: 20, y: 15 },
      { x: 16, y: 18 }, { x: 18, y: 18 }, { x: 20, y: 18 },
    ],
  },
  {
    id: 'room-c',
    chairs: [
      { x: 28, y: 15 }, { x: 30, y: 15 }, { x: 32, y: 15 },
      { x: 28, y: 18 }, { x: 30, y: 18 }, { x: 32, y: 18 },
    ],
  },
];

// Flat list of all meeting positions (for backward compat)
export const MEETING_POSITIONS: Point[] = MEETING_ROOMS.flatMap(r => r.chairs);

export const OVERFLOW_POSITIONS: Point[] = [
  { x: 4, y: 22 },
  { x: 6, y: 22 },
  { x: 8, y: 22 },
  { x: 10, y: 22 },
];

export const ENTRANCE_POINT: Point = { x: 14, y: 25 };

export const WINDOW_EXIT_POSITIONS: Point[] = [
  { x: 8, y: 1 },
  { x: 14, y: 1 },
  { x: 22, y: 1 },
  { x: 28, y: 1 },
];

// ===== Character Colors =====

export const CHARACTER_COLORS = [
  '#4a9eff', // blue
  '#ff6b6b', // red
  '#51cf66', // green
  '#ffd43b', // yellow
  '#cc5de8', // purple
  '#ff922b', // orange
  '#20c997', // teal
  '#f06595', // pink
  '#a9e34b', // lime
  '#74c0fc', // light blue
] as const;

// ===== Animation =====

export const CHARACTER_SPEED = 120; // pixels per second (~7.5 tiles/sec)
export const SPRITE_SCALE = 1.4; // draw sprites 40% bigger than tile size
export const ANIM_FRAME_DURATION = 0.15; // seconds per frame
export const WALK_FRAMES = 4;
export const CONNECTION_LINE_LIFETIME = 2.5; // seconds
export const MAX_RECENT_ACTIONS = 10;

// ===== Direction Mapping =====

export enum Direction {
  DOWN = 0,
  LEFT = 1,
  RIGHT = 2,
  UP = 3,
}

export const DIRECTION_NAMES = ['down', 'left', 'right', 'up'] as const;
export type DirectionName = (typeof DIRECTION_NAMES)[number];

// ===== Status Colors =====

export const STATUS_COLORS: Record<string, string> = {
  idle: '#888888',
  working: '#51cf66',
  meeting: '#4a9eff',
  attention: '#ef4444',
  done: '#60a5fa',
};

// ===== Socket Path =====

export const SOCKET_PATH = '/api/socketio';

// ===== Office Tilemap (30x20 grid) =====
// Legend: # wall, _ window, . floor, D desk, C chair, M meeting table,
//         m meeting chair, R reception, P plant, B bookshelf, K kitchen,
//         ~ carpet, E entrance, W waiting, o overflow

const T = TileType;
const W = T.WALL, F = T.FLOOR, _ = T.WINDOW_WALL, D = T.DESK, C = T.CHAIR;
const M = T.MEETING_TABLE, m = T.MEETING_CHAIR, R = T.RECEPTION, P = T.PLANT;
const B = T.BOOKSHELF, K = T.KITCHEN, X = T.CARPET, E = T.ENTRANCE, O = T.OVERFLOW, A = T.WAITING;

export const OFFICE_GRID: TileType[][] = [
  // Row 0: North wall with windows
  [W,W,W,W,W,W,W,_,W,W,W,W,W,_,W,W,W,W,W,W,W,_,W,W,W,W,W,_,W,W,W,W,W,W,W,W,W,W],
  // Row 1: Border floor with plants + bookshelves
  [W,P,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,P,W],
  // Row 2: Spacer
  [W,F,F,B,F,F,F,F,F,F,F,F,B,F,F,F,F,F,F,F,F,B,F,F,F,F,F,F,F,F,F,F,B,F,F,F,F,W],
  // Row 3: Desk row 1
  [W,F,F,F,F,F,D,F,D,F,F,F,F,F,F,D,F,D,F,F,F,F,F,F,D,F,D,F,F,F,F,F,F,F,K,K,F,W],
  // Row 4: Chair row 1
  [W,F,F,F,F,F,C,F,C,F,F,F,F,F,F,C,F,C,F,F,F,F,F,F,C,F,C,F,F,F,F,F,F,K,F,K,F,W],
  // Row 5: Aisle
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 6: Spacer
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 7: Desk row 2
  [W,F,F,F,F,F,D,F,D,F,F,F,F,F,F,D,F,D,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 8: Chair row 2
  [W,F,F,F,F,F,C,F,C,F,F,F,F,F,F,C,F,C,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 9: Aisle
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 10: Spacer
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 11: Spacer + decorations
  [W,F,F,P,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,P,F,F,W],
  // Row 12: Hallway before meeting rooms
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 13: Meeting room tops (carpet borders for 3 rooms)
  [W,F,X,X,X,X,X,X,X,X,X,F,F,F,X,X,X,X,X,X,X,X,X,F,F,F,X,X,X,X,X,X,X,X,X,F,F,W],
  // Row 14: Meeting room interior
  [W,F,X,F,F,F,F,F,F,F,X,F,F,F,X,F,F,F,F,F,F,F,X,F,F,F,X,F,F,F,F,F,F,F,X,F,F,W],
  // Row 15: Meeting chairs top
  [W,F,X,F,m,F,m,F,m,F,X,F,F,F,X,F,m,F,m,F,m,F,X,F,F,F,X,F,m,F,m,F,m,F,X,F,F,W],
  // Row 16: Meeting table
  [W,F,X,F,M,M,M,M,M,F,X,F,F,F,X,F,M,M,M,M,M,F,X,F,F,F,X,F,M,M,M,M,M,F,X,F,F,W],
  // Row 17: Meeting table continued
  [W,F,X,F,M,M,M,M,M,F,X,F,F,F,X,F,M,M,M,M,M,F,X,F,F,F,X,F,M,M,M,M,M,F,X,F,F,W],
  // Row 18: Meeting chairs bottom
  [W,F,X,F,m,F,m,F,m,F,X,F,F,F,X,F,m,F,m,F,m,F,X,F,F,F,X,F,m,F,m,F,m,F,X,F,F,W],
  // Row 19: Meeting room interior
  [W,F,X,F,F,F,F,F,F,F,X,F,F,F,X,F,F,F,F,F,F,F,X,F,F,F,X,F,F,F,F,F,F,F,X,F,F,W],
  // Row 20: Meeting room bottoms
  [W,F,X,X,X,X,X,X,X,X,X,F,F,F,X,X,X,X,X,X,X,X,X,F,F,F,X,X,X,X,X,X,X,X,X,F,F,W],
  // Row 21: Hallway
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 22: Overflow + waiting
  [W,P,F,F,O,F,O,F,O,F,O,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,P,F,W],
  // Row 23: Reception area
  [W,F,F,F,F,F,F,F,F,F,F,F,F,R,R,R,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 24: Near entrance
  [W,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,F,W],
  // Row 25: South wall with entrance
  [W,W,W,W,W,W,W,W,W,W,W,W,W,E,E,E,W,W,W,W,W,W,W,W,_,W,W,W,W,_,W,W,W,W,W,W,W,W],
];
