import type { Point } from '@/lib/types';
import { MAP_COLS, MAP_ROWS } from '@/lib/constants';
import { TileMap } from './TileMap';

const NEIGHBORS: Point[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export class Pathfinder {
  static findPath(start: Point, end: Point, tileMap: TileMap): Point[] {
    if (start.x === end.x && start.y === end.y) return [];

    const key = (p: Point) => `${p.x},${p.y}`;
    const visited = new Set<string>();
    const parent = new Map<string, Point | null>();
    const queue: Point[] = [start];

    visited.add(key(start));
    parent.set(key(start), null);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.x === end.x && current.y === end.y) {
        // Reconstruct path excluding start, including end
        const path: Point[] = [];
        let node: Point | null = current;
        while (node !== null) {
          const p = parent.get(key(node));
          if (p !== null && p !== undefined) {
            path.unshift(node);
          }
          node = p ?? null;
        }
        return path;
      }

      for (const n of NEIGHBORS) {
        const next: Point = { x: current.x + n.x, y: current.y + n.y };
        if (
          next.x < 0 || next.x >= MAP_COLS ||
          next.y < 0 || next.y >= MAP_ROWS
        ) continue;

        const k = key(next);
        if (visited.has(k)) continue;

        // Allow walking to end even if not normally walkable (for desk positions)
        if (!tileMap.isWalkable(next.x, next.y) && !(next.x === end.x && next.y === end.y)) {
          continue;
        }

        visited.add(k);
        parent.set(k, current);
        queue.push(next);
      }
    }

    // No path found — fallback: return just the end point
    return [end];
  }
}
