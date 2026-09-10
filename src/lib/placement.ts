/**
 * Расстановка мебели: где предмет физически может стоять и куда он «прилипает».
 *
 * Раньше предмет удерживался внутри комнаты по радиусу описанной окружности его
 * плана — то есть диван 2.6 м не подпускался к стене ближе чем на 1.3 м. Это и
 * есть та самая «мебель не встаёт к стене»: ограничение считалось по кругу,
 * хотя предмет прямоугольный и повёрнут.
 *
 * Здесь всё считается по настоящему ориентированному габариту (OBB):
 *
 *   • опорная функция  support(n) = |w/2 · (u·n)| + |d/2 · (v·n)|  даёт вылет
 *     повёрнутого прямоугольника вдоль произвольного направления. Диван,
 *     стоящий параллельно стене, упирается в неё на глубину/2, а тот же диван
 *     под 45° — на половину диагонали, ровно как в жизни;
 *
 *   • стена — это не линия плана, а её внутренняя грань: план хранит осевые
 *     линии, а стена имеет толщину, поэтому пол заканчивается на t/2 внутрь;
 *
 *   • ограничения применяются по каждой стене отдельно и в несколько проходов,
 *     поэтому угол комнаты работает сам собой: предмет выталкивается сразу из
 *     двух граней и садится в угол.
 *
 * Координаты: план (x, y) ложится в мир (x, z) один в один, поэтому вся
 * математика здесь ведётся в плоскости XZ и одинаково верна для плана и сцены.
 */

import {
  centroid,
  pointInPolygon,
  signedArea,
  wallsOf,
  type Point,
  type RoomGeometry,
} from './geometry';

/** Габарит предмета в метрах, уже с учётом масштаба экземпляра. */
export type Box = { width: number; depth: number; height: number };

export type WallFace = {
  index: number;
  /** Концы осевой линии стены. */
  start: Point;
  end: Point;
  length: number;
  /** Единичное направление стены в XZ. */
  dir: Point;
  /** Единичная нормаль, смотрящая ВНУТРЬ комнаты. */
  normal: Point;
  /** Точка на внутренней грани стены (осевая линия, сдвинутая на t/2 внутрь). */
  face: Point;
  /** Угол направления стены, atan2(dz, dx). */
  angle: number;
  /** Толщина стены, м. */
  thickness: number;
};

/** На сколько предмет может «дотянуться» до стены, чтобы прилипнуть, м. */
export const SNAP_DISTANCE = 0.34;
/** Допуск по углу, в пределах которого предмет доворачивается вдоль стены. */
const SNAP_ANGLE = (14 * Math.PI) / 180;
/** Насколько глубоко предмет может быть вдавлен в стену и всё ещё прилипнуть. */
const SNAP_OVERLAP = 0.5;

const EPS = 1e-4;

/**
 * Внутренние грани стен комнаты.
 *
 * Нормаль выбирается по знаку площади полигона, а не «в сторону центра масс»:
 * у Г-образной комнаты центр масс может лежать вообще вне пола.
 */
export function wallFaces(room: RoomGeometry): WallFace[] {
  const poly = room.points;
  if (poly.length < 3 || !room.closed) return [];
  const orientation = signedArea(poly) > 0 ? 1 : -1;
  const half = (room.wallThickness ?? 0.15) / 2;

  return wallsOf(room)
    .filter((w) => w.length > 1e-4)
    .map((w) => {
      const dx = (w.end.x - w.start.x) / w.length;
      const dz = (w.end.y - w.start.y) / w.length;
      const nx = -dz * orientation;
      const nz = dx * orientation;
      return {
        index: w.index,
        start: w.start,
        end: w.end,
        length: w.length,
        dir: { x: dx, y: dz },
        normal: { x: nx, y: nz },
        face: {
          x: (w.start.x + w.end.x) / 2 + nx * half,
          y: (w.start.y + w.end.y) / 2 + nz * half,
        },
        angle: Math.atan2(dz, dx),
        thickness: half * 2,
      };
    });
}

/**
 * Полувылет повёрнутого габарита вдоль направления `n`.
 *
 * Поворот `rotationY` — это поворот вокруг мировой оси Y, поэтому локальная +X
 * смотрит в (cos r, −sin r), а локальная +Z — в (sin r, cos r) в плоскости XZ.
 */
export function support(box: Box, rotationY: number, n: Point): number {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const ux = c;
  const uz = -s;
  const vx = s;
  const vz = c;
  return (
    Math.abs((box.width / 2) * (ux * n.x + uz * n.y)) +
    Math.abs((box.depth / 2) * (vx * n.x + vz * n.y))
  );
}

/** Расстояние от центра предмета до внутренней грани стены вдоль её нормали. */
function faceDistance(p: Point, face: WallFace): number {
  return (p.x - face.face.x) * face.normal.x + (p.y - face.face.y) * face.normal.y;
}

/** Проекция точки на ось стены: 0 — начало, `length` — конец. */
function alongWall(p: Point, face: WallFace): number {
  return (p.x - face.start.x) * face.dir.x + (p.y - face.start.y) * face.dir.y;
}

/**
 * Перекрывается ли предмет со стеной вдоль её длины.
 *
 * Это половина теста разделяющих осей: вторую половину (поперёк стены) считает
 * вызывающий, потому что ему нужна не только сама встреча, но и её глубина.
 * Без этого теста стена ограничивала бы предмет своей бесконечной прямой — и в
 * Г-образной комнате мебель из дальнего крыла выталкивало бы линией стены,
 * которая физически до неё не доходит.
 *
 * Полки стен продлены на полтолщины: стены сходятся в углу, и без этого запаса
 * между двумя ограничениями остаётся щель ровно по размеру стыка.
 */
function overlapsAlongWall(p: Point, box: Box, rotationY: number, face: WallFace): boolean {
  const s = alongWall(p, face);
  const reach = support(box, rotationY, face.dir);
  const pad = (face.thickness ?? 0) / 2;
  return s + reach > -pad && s - reach < face.length + pad;
}

export type SolveInput = {
  room: RoomGeometry;
  box: Box;
  position: [number, number, number];
  rotationY: number;
  /** Прилипание к стенам. Выключается на время, когда пользователь держит Alt. */
  snap?: boolean;
};

export type SolveResult = {
  position: [number, number, number];
  rotationY: number;
  /** Стена, к которой предмет сейчас прижат вплотную, — сцена её подсвечивает. */
  snappedWall: number | null;
};

/**
 * Приводит желаемое положение предмета к допустимому.
 *
 * Порядок важен: сначала мягкое прилипание к близкой стене (оно может довернуть
 * предмет), затем жёсткое удержание внутри комнаты (оно ничего не поворачивает,
 * только выталкивает), затем высота. Если сделать наоборот, предмет сначала
 * выталкивался бы из стены, а потом прилипал обратно — и дрожал бы на границе.
 */
export function solvePlacement(input: SolveInput): SolveResult {
  const { room, box } = input;
  const faces = wallFaces(room);
  let rotationY = input.rotationY;
  let p: Point = { x: input.position[0], y: input.position[2] };
  let snappedWall: number | null = null;

  if (faces.length) {
    if (input.snap) {
      const primary = nearestSnapCandidate(p, box, rotationY, faces);
      if (primary) {
        rotationY = primary.rotationY;
        p = primary.position;
        snappedWall = primary.index;

        // Второй, перпендикулярный кандидат — это угол комнаты. Без него шкаф,
        // придвинутый к длинной стене, оставлял бы у боковой щель в пару
        // сантиметров, которую руками уже не убрать.
        const corner = nearestSnapCandidate(p, box, rotationY, faces, primary.index, true);
        if (corner) p = corner.position;
      }
    }

    // Удержание внутри пола. Несколько проходов: выталкивание из одной стены
    // может нарушить ограничение соседней, в углу это обычное дело.
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const face of faces) {
        if (!overlapsAlongWall(p, box, rotationY, face)) continue;
        const need = support(box, rotationY, face.normal);
        const d = faceDistance(p, face);
        if (d < need - EPS) {
          p = {
            x: p.x + face.normal.x * (need - d),
            y: p.y + face.normal.y * (need - d),
          };
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Комната может быть физически меньше предмета — тогда ограничения тянут
    // его в разные стороны и он уезжает наружу. Возвращаем в центр: лучше
    // предмет, торчащий из стен по центру комнаты, чем предмет за её пределами.
    if (!pointInPolygon(p, room.points)) {
      const c = centroid(room.points);
      if (pointInPolygon(c, room.points)) p = c;
    }
  }

  const maxY = Math.max(0, (room.wallHeight ?? 2.7) - box.height);
  let y = input.position[1];
  if (!Number.isFinite(y)) y = 0;
  if (y < 0.02) y = 0;
  y = Math.min(y, maxY);

  return {
    position: [round(p.x), round(y), round(p.y)],
    rotationY,
    snappedWall,
  };
}

/**
 * Ближайшая стена, к которой предмет стоит прижать.
 *
 * `perpendicularTo` включает угловой режим: рассматриваются только стены,
 * заметно непараллельные уже найденной, и поворот больше не трогается — в углу
 * ориентацию задаёт первая стена.
 */
function nearestSnapCandidate(
  p: Point,
  box: Box,
  rotationY: number,
  faces: WallFace[],
  excludeIndex?: number,
  perpendicularOnly = false,
): { index: number; position: Point; rotationY: number } | null {
  const exclude = excludeIndex !== undefined ? faces.find((f) => f.index === excludeIndex) : null;
  let best: { index: number; position: Point; rotationY: number; gap: number } | null = null;

  for (const face of faces) {
    if (face.index === excludeIndex) continue;
    if (!overlapsAlongWall(p, box, rotationY, face)) continue;
    if (perpendicularOnly && exclude) {
      const parallel = Math.abs(face.dir.x * exclude.dir.x + face.dir.y * exclude.dir.y);
      if (parallel > 0.35) continue;
    }

    // Довод предмета вдоль стены: если он и так почти параллелен ей (с точностью
    // до четверти оборота — шкаф можно ставить любым боком), доворачиваем.
    let rot = rotationY;
    if (!perpendicularOnly) {
      // Направление предмета в XZ — это угол его локальной +X, то есть −rotationY.
      const delta = wrapQuarter(face.angle + rotationY);
      if (Math.abs(delta) <= SNAP_ANGLE) rot = rotationY - delta;
    }

    const need = support(box, rot, face.normal);
    const gap = faceDistance(p, face) - need;
    if (gap > SNAP_DISTANCE || gap < -SNAP_OVERLAP) continue;
    if (best && Math.abs(gap) >= Math.abs(best.gap)) continue;

    best = {
      index: face.index,
      rotationY: rot,
      gap,
      position: { x: p.x - face.normal.x * gap, y: p.y - face.normal.y * gap },
    };
  }

  return best;
}

/** Приводит угол в диапазон [−π/4, π/4]: поворот предмета кратен четверти. */
function wrapQuarter(angle: number): number {
  const q = Math.PI / 2;
  let a = angle % q;
  if (a > q / 2) a -= q;
  if (a < -q / 2) a += q;
  return a;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Свободное место для нового предмета.
 *
 * Кандидаты идут по спирали с золотым углом от центра комнаты; побеждает
 * первый, который никого не задевает. Если свободного места нет вовсе (в
 * маленькой комнате так и бывает), берём то, где до ближайшего соседа дальше
 * всего — предметы расходятся, а не складываются в стопку.
 */
export function findFreeSpot(input: {
  room: RoomGeometry;
  box: Box;
  taken: { x: number; z: number; radius: number }[];
}): { x: number; z: number } {
  const { room, box, taken } = input;
  const centre = centroid(room.points);
  const radius = Math.hypot(box.width, box.depth) / 2;

  const clearance = (p: Point) =>
    taken.reduce(
      (min, t) => Math.min(min, Math.hypot(t.x - p.x, t.z - p.y) - (t.radius + radius)),
      Infinity,
    );

  const place = (candidate: Point): Point => {
    const solved = solvePlacement({
      room,
      box,
      position: [candidate.x, 0, candidate.y],
      rotationY: 0,
      snap: false,
    });
    return { x: solved.position[0], y: solved.position[2] };
  };

  let best = place(centre);
  let bestGap = clearance(best);

  for (let step = 1; step < 140 && bestGap < 0.02; step++) {
    const angle = step * 2.399963;
    const r = Math.min(radius * 0.5 * Math.sqrt(step), 8);
    const candidate = place({
      x: centre.x + Math.cos(angle) * r,
      y: centre.y + Math.sin(angle) * r,
    });
    const gap = clearance(candidate);
    if (gap > bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }

  return { x: best.x, z: best.y };
}

/** Габарит предмета в метрах по данным каталога и масштабу экземпляра. */
export function boxOf(
  item: { width: number; depth: number; height: number },
  scale: number,
): Box {
  return {
    width: Math.max(item.width * scale, 0.05),
    depth: Math.max(item.depth * scale, 0.05),
    height: Math.max(item.height * scale, 0.05),
  };
}
