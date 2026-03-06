import type { Point } from './types';

// ===== Grid & Rendering =====

export const TILE_SIZE = 16;
export const MAP_COLS = 30;
export const MAP_ROWS = 20;
export const SCALE = 3;
export const CANVAS_W = MAP_COLS * TILE_SIZE; // 480
export const CANVAS_H = MAP_ROWS * TILE_SIZE; // 320
export const DISPLAY_W = CANVAS_W * SCALE;    // 1440
export const DISPLAY_H = CANVAS_H * SCALE;    // 960

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
  { x: 6, y: 3 },
  { x: 8, y: 3 },
  { x: 13, y: 3 },
  { x: 15, y: 3 },
  { x: 20, y: 3 },
  { x: 22, y: 3 },
  { x: 6, y: 6 },
  { x: 8, y: 6 },
];

// 3 meeting rooms, each with chair positions around a small table
// Room A (left): rows 10-15, cols 2-8
// Room B (center): rows 10-15, cols 11-17
// Room C (right): rows 10-15, cols 20-26
export const MEETING_ROOMS: { id: string; chairs: Point[] }[] = [
  {
    id: 'room-a',
    chairs: [
      { x: 3, y: 11 }, { x: 5, y: 11 }, { x: 7, y: 11 },
      { x: 3, y: 14 }, { x: 5, y: 14 }, { x: 7, y: 14 },
    ],
  },
  {
    id: 'room-b',
    chairs: [
      { x: 12, y: 11 }, { x: 14, y: 11 }, { x: 16, y: 11 },
      { x: 12, y: 14 }, { x: 14, y: 14 }, { x: 16, y: 14 },
    ],
  },
  {
    id: 'room-c',
    chairs: [
      { x: 21, y: 11 }, { x: 23, y: 11 }, { x: 25, y: 11 },
      { x: 21, y: 14 }, { x: 23, y: 14 }, { x: 25, y: 14 },
    ],
  },
];

// Flat list of all meeting positions (for backward compat)
export const MEETING_POSITIONS: Point[] = MEETING_ROOMS.flatMap(r => r.chairs);

export const OVERFLOW_POSITIONS: Point[] = [
  { x: 3, y: 17 },
  { x: 5, y: 17 },
  { x: 7, y: 17 },
  { x: 9, y: 17 },
];

export const ENTRANCE_POINT: Point = { x: 10, y: 19 };

// Window positions (tiles adjacent to windows where characters can stand before "jumping out")
// Row 0 windows at cols 6, 11, 16, 21 — stand one tile south (row 1)
export const WINDOW_EXIT_POSITIONS: Point[] = [
  { x: 6, y: 1 },
  { x: 11, y: 1 },
  { x: 16, y: 1 },
  { x: 21, y: 1 },
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

export const CHARACTER_SPEED = 48; // pixels per second (3 tiles/sec)
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
};

// ===== Socket Path =====

export const SOCKET_PATH = '/api/socketio';

// ===== Office Tilemap (30x20 grid) =====
// Legend: # wall, _ window, . floor, D desk, C chair, M meeting table,
//         m meeting chair, R reception, P plant, B bookshelf, K kitchen,
//         ~ carpet, E entrance, W waiting, o overflow

const T = TileType;

export const OFFICE_GRID: TileType[][] = [
  // Row 0: North wall with windows
  [T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL],
  // Row 1: Border floor with plants
  [T.WALL,T.PLANT,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.PLANT,T.WALL],
  // Row 2: Desk row 1
  [T.WALL,T.FLOOR,T.FLOOR,T.BOOKSHELF,T.FLOOR,T.FLOOR,T.DESK,T.FLOOR,T.DESK,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.DESK,T.FLOOR,T.DESK,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.DESK,T.FLOOR,T.DESK,T.FLOOR,T.FLOOR,T.BOOKSHELF,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 3: Chair row 1
  [T.WALL,T.FLOOR,T.FLOOR,T.BOOKSHELF,T.FLOOR,T.FLOOR,T.CHAIR,T.FLOOR,T.CHAIR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.CHAIR,T.FLOOR,T.CHAIR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.CHAIR,T.FLOOR,T.CHAIR,T.FLOOR,T.FLOOR,T.BOOKSHELF,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 4: Aisle
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 5: Desk row 2
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.DESK,T.FLOOR,T.DESK,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.DESK,T.FLOOR,T.DESK,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 6: Chair row 2 + kitchen
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.CHAIR,T.FLOOR,T.CHAIR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.CHAIR,T.FLOOR,T.CHAIR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.KITCHEN,T.FLOOR,T.KITCHEN,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 7: Kitchen area
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.KITCHEN,T.FLOOR,T.KITCHEN,T.FLOOR,T.KITCHEN,T.FLOOR,T.KITCHEN,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 8: Aisle
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 9: Hallway between desks and meeting rooms
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 10: Meeting room tops (carpet borders for 3 rooms)
  [T.WALL,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.WALL],
  // Row 11: Meeting chairs top row (3 per room)
  [T.WALL,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.CARPET,T.FLOOR,T.WALL],
  // Row 12: Meeting tables
  [T.WALL,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.FLOOR,T.CARPET,T.FLOOR,T.WALL],
  // Row 13: Meeting tables continued
  [T.WALL,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.MEETING_TABLE,T.FLOOR,T.FLOOR,T.CARPET,T.FLOOR,T.WALL],
  // Row 14: Meeting chairs bottom row
  [T.WALL,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.CARPET,T.FLOOR,T.CARPET,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.MEETING_CHAIR,T.FLOOR,T.CARPET,T.FLOOR,T.WALL],
  // Row 15: Meeting room bottoms
  [T.WALL,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.CARPET,T.FLOOR,T.WALL],
  // Row 16: Hallway
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 17: Plants + overflow waiting
  [T.WALL,T.PLANT,T.FLOOR,T.OVERFLOW,T.FLOOR,T.OVERFLOW,T.FLOOR,T.OVERFLOW,T.FLOOR,T.OVERFLOW,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.PLANT,T.WALL],
  // Row 18: Reception near entrance
  [T.WALL,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.RECEPTION,T.RECEPTION,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.FLOOR,T.WALL],
  // Row 19: South wall with entrance
  [T.WALL,T.WALL,T.WALL,T.WALL,T.ENTRANCE,T.ENTRANCE,T.WALL,T.WALL,T.WALL,T.WALL,T.ENTRANCE,T.ENTRANCE,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WINDOW_WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL,T.WALL],
];
