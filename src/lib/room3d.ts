/**
 * Превращает 2D-план в список боксов, из которых строится 3D-комната.
 *
 * Стены генерируются процедурно прямо из отрезков плана — никакой библиотеки
 * готовых моделей стен нет, поэтому результат по построению совпадает с
 * чертежом. Стена с дверями или окнами выдаётся несколькими боксами (простенки
 * по бокам, перемычка сверху, подоконная часть снизу), что оставляет в
 * геометрии настоящие дыры без всякого CSG.
 *
 * План (x, y) отображается в мир (x, z); +y на плане — это +z в сцене.
 */
import type { Opening, Point, RoomGeometry } from './geometry';
import { wallsOf } from './geometry';

export type WallBox = {
  key: string;
  /** Центр бокса в мировых координатах. */
  position: [number, number, number];
  /** Габариты бокса: [длина вдоль стены, высота, толщина]. */
  size: [number, number, number];
  /** Поворот по Y, выравнивающий бокс по направлению стены. */
  rotationY: number;
  wallIndex: number;
  /** Внешняя нормаль в мировых координатах: по ней прячем стены, обращённые к камере. */
  normal: [number, number, number];
};

type Span = { from: number; to: number; bottom: number; top: number };

/**
 * Режет стену длиной `len` и высотой `height` на сплошные участки с учётом
 * пробивающих её проёмов.
 */
function spansForWall(len: number, height: number, openings: Opening[]): Span[] {
  const holes = openings
    .map((o) => {
      const centre = o.t * len;
      const half = Math.min(o.width, len) / 2;
      return {
        from: Math.max(0, centre - half),
        to: Math.min(len, centre + half),
        bottom: Math.max(0, o.sill),
        top: Math.min(height, o.sill + o.height),
      };
    })
    .filter((h) => h.to - h.from > 0.01)
    .sort((a, b) => a.from - b.from);

  if (!holes.length) return [{ from: 0, to: len, bottom: 0, top: height }];

  const spans: Span[] = [];
  let cursor = 0;
  for (const h of holes) {
    if (h.from > cursor + 0.01) {
      spans.push({ from: cursor, to: h.from, bottom: 0, top: height });
    }
    // Перемычка над проёмом.
    if (height - h.top > 0.01) spans.push({ from: h.from, to: h.to, bottom: h.top, top: height });
    // Подоконная часть под окном.
    if (h.bottom > 0.01) spans.push({ from: h.from, to: h.to, bottom: 0, top: h.bottom });
    cursor = Math.max(cursor, h.to);
  }
  if (len - cursor > 0.01) spans.push({ from: cursor, to: len, bottom: 0, top: height });
  return spans;
}

export function buildWallBoxes(room: RoomGeometry): WallBox[] {
  const walls = wallsOf(room);
  const boxes: WallBox[] = [];

  for (const wall of walls) {
    if (wall.length < 0.02) continue;
    const ux = (wall.end.x - wall.start.x) / wall.length;
    const uz = (wall.end.y - wall.start.y) / wall.length;
    // Локальная +X бокса после поворота по Y на r переходит в (cos r, 0, -sin r).
    const rotationY = -Math.atan2(uz, ux);

    const spans = spansForWall(
      wall.length,
      wall.height,
      room.openings.filter((o) => o.wall === wall.index),
    );

    spans.forEach((span, i) => {
      const centre = (span.from + span.to) / 2;
      const length = span.to - span.from;
      const h = span.top - span.bottom;
      if (length < 0.01 || h < 0.01) return;
      boxes.push({
        key: `w${wall.index}-${i}`,
        position: [
          wall.start.x + ux * centre,
          (span.bottom + span.top) / 2,
          wall.start.y + uz * centre,
        ],
        size: [length, h, wall.thickness],
        rotationY,
        wallIndex: wall.index,
        // Левая нормаль к направлению стены; ниже при необходимости разворачивается.
        normal: [-uz, 0, ux],
      });
    });
  }

  return boxes;
}

/**
 * Разворачивает все нормали стен наружу комнаты, чтобы у отсечения стен,
 * обращённых к зрителю, была единая точка отсчёта.
 */
export function orientNormals(boxes: WallBox[], interior: Point): WallBox[] {
  return boxes.map((b) => {
    const toInterior = [interior.x - b.position[0], 0, interior.y - b.position[2]];
    const dot = b.normal[0] * toInterior[0] + b.normal[2] * toInterior[2];
    return dot > 0 ? { ...b, normal: [-b.normal[0], 0, -b.normal[2]] as [number, number, number] } : b;
  });
}

/** Проёмам добавляется тонкая вставка, чтобы окна читались как стекло, а не дыры. */
export type OpeningFrame = {
  key: string;
  kind: 'door' | 'window';
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
};

export function buildOpeningFrames(room: RoomGeometry): OpeningFrame[] {
  const walls = wallsOf(room);
  const frames: OpeningFrame[] = [];

  for (const op of room.openings) {
    const wall = walls[op.wall];
    if (!wall || wall.length < 0.02) continue;
    const ux = (wall.end.x - wall.start.x) / wall.length;
    const uz = (wall.end.y - wall.start.y) / wall.length;
    const centre = op.t * wall.length;
    const height = Math.min(op.height, wall.height - op.sill);
    if (height <= 0.05) continue;

    frames.push({
      key: op.id,
      kind: op.kind,
      position: [
        wall.start.x + ux * centre,
        op.sill + height / 2,
        wall.start.y + uz * centre,
      ],
      size: [Math.min(op.width, wall.length), height, wall.thickness * 0.35],
      rotationY: -Math.atan2(uz, ux),
    });
  }

  return frames;
}

/**
 * Текстура дощатого пола, рисуемая на canvas: приложению не нужно возить с собой
 * картинку, а масштаб доски может подстраиваться под размер комнаты.
 */
export function createFloorTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d8bd97';
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 64;
  for (let row = 0; row * plankH < 512; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col * 256 + offset < 512 + 256; col++) {
      const x = col * 256 + offset;
      const y = row * plankH;
      const tone = 208 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${tone}, ${tone - 22}, ${tone - 58})`;
      ctx.fillRect(x, y, 256, plankH);

      // Волокна дерева.
      ctx.strokeStyle = 'rgba(150, 115, 78, 0.16)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 9; g++) {
        const gy = y + 4 + Math.random() * (plankH - 8);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.bezierCurveTo(x + 80, gy + 2, x + 170, gy - 2, x + 256, gy);
        ctx.stroke();
      }

      // Стыки досок.
      ctx.strokeStyle = 'rgba(120, 90, 60, 0.4)';
      ctx.strokeRect(x + 0.5, y + 0.5, 256, plankH);
    }
  }

  return canvas;
}
