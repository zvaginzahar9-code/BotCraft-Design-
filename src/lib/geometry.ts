/**
 * Модель геометрии комнаты — общая для 2D-редактора плана, генератора 3D и БД.
 * Координаты в МЕТРАХ на плоскости XY пространства плана; 3D-сцена отображает
 * план (x, y) в мир (x, z), поэтому сверху план читается точно так же.
 */

export type Point = { x: number; y: number };

export type Opening = {
  id: string;
  kind: 'door' | 'window';
  /** Индекс стены, на которой стоит проём. */
  wall: number;
  /** Центр проёма вдоль стены, 0..1. */
  t: number;
  width: number;
  height: number;
  /** Расстояние от пола до низа проёма (высота подоконника). */
  sill: number;
};

export type RoomGeometry = {
  points: Point[];
  closed: boolean;
  wallHeight: number;
  wallThickness: number;
  openings: Opening[];
};

export type Wall = {
  index: number;
  start: Point;
  end: Point;
  length: number;
  /** Радианы: atan2 направления стены в пространстве плана. */
  angle: number;
  thickness: number;
  height: number;
};

export const DEFAULT_WALL_HEIGHT = 2.7;
export const DEFAULT_WALL_THICKNESS = 0.15;

export function emptyRoom(): RoomGeometry {
  return {
    points: [],
    closed: false,
    wallHeight: DEFAULT_WALL_HEIGHT,
    wallThickness: DEFAULT_WALL_THICKNESS,
    openings: [],
  };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Отрезки стен, выведенные из полигона. Незамкнутая ломаная даёт n-1 стену;
 * замкнутая — n, где последняя соединяет конечную точку с первой.
 */
export function wallsOf(room: RoomGeometry): Wall[] {
  const { points, closed, wallHeight, wallThickness } = room;
  const n = points.length;
  const count = closed ? n : n - 1;
  const walls: Wall[] = [];
  for (let i = 0; i < count; i++) {
    const start = points[i];
    const end = points[(i + 1) % n];
    walls.push({
      index: i,
      start,
      end,
      length: dist(start, end),
      angle: Math.atan2(end.y - start.y, end.x - start.x),
      thickness: wallThickness,
      height: wallHeight,
    });
  }
  return walls;
}

/** Знаковая площадь полигона по формуле шнурования; знак задаёт обход. */
export function signedArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function area(room: RoomGeometry): number {
  if (!room.closed || room.points.length < 3) return 0;
  return Math.abs(signedArea(room.points));
}

export function perimeter(room: RoomGeometry): number {
  return wallsOf(room).reduce((sum, w) => sum + w.length, 0);
}

export function centroid(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    // Вырожденный полигон — откатываемся к среднему по вершинам.
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function bounds(points: Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Ближайшая к `p` точка на отрезке ab. */
export function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return { point: { ...a }, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/**
 * Меняет длину стены `index` на `newLength`, сохраняя остальной план по
 * возможности нетронутым.
 *
 * Начальная точка стены остаётся на месте, конечная едет вдоль направления
 * стены. Всё, что идёт после этой конечной точки, переносится на ту же дельту,
 * поэтому следующие стены сохраняют и длину, и угол. В замкнутом плане это
 * оставило бы замыкающую стену висеть под углом, поэтому перенос
 * останавливается на ближайшей стене, ПАРАЛЛЕЛЬНОЙ редактируемой: она и
 * поглощает изменение, растягиваясь или сжимаясь. Именно этого ждёшь, когда
 * расширяешь одну сторону прямоугольной комнаты и рассчитываешь, что
 * противоположная последует за ней.
 */
export function setWallLength(room: RoomGeometry, index: number, newLength: number): RoomGeometry {
  const points = room.points.map((p) => ({ ...p }));
  const n = points.length;
  const walls = wallsOf(room);
  const wall = walls[index];
  if (!wall || newLength <= 0.01 || wall.length < 1e-6) return room;

  const dirX = (wall.end.x - wall.start.x) / wall.length;
  const dirY = (wall.end.y - wall.start.y) / wall.length;
  const delta = newLength - wall.length;
  const dx = dirX * delta;
  const dy = dirY * delta;

  // Сколько точек после сдвинутого конца едут вместе с ним.
  let span = room.closed ? n - 1 : n - 1 - index;
  if (room.closed) {
    for (let step = 1; step < n; step++) {
      const w = walls[(index + step) % walls.length];
      if (!w || w.length < 1e-6) continue;
      const ux = (w.end.x - w.start.x) / w.length;
      const uy = (w.end.y - w.start.y) / w.length;
      // |cross| ~ 0 означает параллельность (в любую сторону).
      if (Math.abs(ux * dirY - uy * dirX) < 1e-3) {
        span = step - 1;
        break;
      }
    }
  }

  for (let step = 0; step <= span; step++) {
    const idx = (index + 1 + step) % n;
    points[idx].x += dx;
    points[idx].y += dy;
  }

  return { ...room, points };
}

/** Округляет значение до ближайшего кратного `step`. */
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Защита от битой геометрии, пришедшей из API или localStorage. */
export function isValidRoom(room: RoomGeometry | null | undefined): room is RoomGeometry {
  return !!room && Array.isArray(room.points) && room.points.length >= 3 && room.closed;
}
