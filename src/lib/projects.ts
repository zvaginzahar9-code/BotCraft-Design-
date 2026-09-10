import { randomUUID } from 'node:crypto';
import { execute, query, withTransaction, type PlacementRow, type ProjectRow } from './db';
import { DEFAULT_WALL_HEIGHT, type RoomGeometry } from './geometry';

export type PlacementInput = {
  furnitureId: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
};

export type ProjectPayload = {
  id: string;
  name: string;
  roomGeometry: RoomGeometry;
  wallHeight: number;
  createdAt: string;
  updatedAt: string;
  placements: (PlacementInput & { id: number })[];
};

const FALLBACK_ROOM: RoomGeometry = {
  points: [],
  closed: false,
  wallHeight: DEFAULT_WALL_HEIGHT,
  wallThickness: 0.15,
  openings: [],
};

/**
 * Геометрия хранится как JSON, поэтому обрезанная или отредактированная руками
 * запись иначе уронила бы рендер страницы. Деградируем до пустой комнаты вместо
 * того, чтобы отдавать 500 на всю студию.
 */
function parseGeometry(raw: string, id: string): RoomGeometry {
  try {
    const parsed = JSON.parse(raw) as RoomGeometry;
    if (!parsed || !Array.isArray(parsed.points)) throw new Error('no points');
    return parsed;
  } catch (err) {
    console.error(`project ${id}: unreadable room_geometry`, err);
    return FALLBACK_ROOM;
  }
}

/**
 * Время наружу отдаётся как «YYYY-MM-DD HH:MM:SS» по UTC.
 *
 * Драйвер PostgreSQL возвращает `timestamptz` объектом `Date`, но клиент ждёт
 * ровно тот же текстовый формат, что отдавала прежняя база, — на него завязано
 * форматирование «N мин назад» на карточке проекта. Формат — часть контракта
 * API, поэтому конвертация живёт здесь, а не в компоненте.
 */
function toUtcText(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function toPayload(row: ProjectRow, placements: PlacementRow[]): ProjectPayload {
  return {
    id: row.id,
    name: row.name,
    roomGeometry: parseGeometry(row.room_geometry, row.id),
    wallHeight: row.wall_height,
    createdAt: toUtcText(row.created_at),
    updatedAt: toUtcText(row.updated_at),
    placements: placements.map((p) => ({
      id: p.id,
      furnitureId: p.furniture_id,
      position: [p.position_x, p.position_y, p.position_z],
      rotationY: p.rotation_y,
      scale: p.scale,
    })),
  };
}

export type ProjectSummary = {
  id: string;
  name: string;
  wallHeight: number;
  createdAt: string;
  updatedAt: string;
  items: number;
  /** Контур комнаты: карточка проекта рисует по нему настоящий план. */
  points: { x: number; y: number }[];
  closed: boolean;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  // COUNT возвращает bigint, который драйвер отдаёт строкой, — приводим к int,
  // иначе в UI прилетело бы "3" вместо 3.
  const rows = await query<ProjectRow & { items: number }>(
    `SELECT p.id, p.name, p.wall_height, p.created_at, p.updated_at, p.room_geometry,
            (SELECT COUNT(*) FROM project_furniture f WHERE f.project_id = p.id)::int AS items
     FROM projects p ORDER BY p.updated_at DESC LIMIT 50`,
  );

  return rows.map((r) => {
    const geometry = parseGeometry(r.room_geometry, r.id);
    return {
      id: r.id,
      name: r.name,
      wallHeight: r.wall_height,
      createdAt: toUtcText(r.created_at),
      updatedAt: toUtcText(r.updated_at),
      items: r.items,
      points: geometry.points,
      closed: geometry.closed,
    };
  });
}

export async function getProject(id: string): Promise<ProjectPayload | null> {
  const [row] = await query<ProjectRow>('SELECT * FROM projects WHERE id = $1', [id]);
  if (!row) return null;
  const placements = await query<PlacementRow>(
    'SELECT * FROM project_furniture WHERE project_id = $1 ORDER BY id',
    [id],
  );
  return toPayload(row, placements);
}

export async function createProject(input: {
  name?: string;
  roomGeometry: RoomGeometry;
  wallHeight?: number;
  placements?: PlacementInput[];
}): Promise<ProjectPayload> {
  const id = randomUUID();
  const wallHeight = input.wallHeight ?? input.roomGeometry.wallHeight ?? DEFAULT_WALL_HEIGHT;

  await execute(
    `INSERT INTO projects (id, name, room_geometry, wall_height)
     VALUES ($1, $2, $3, $4)`,
    [id, input.name?.trim() || 'Новый проект', JSON.stringify(input.roomGeometry), wallHeight],
  );

  if (input.placements?.length) await replacePlacements(id, input.placements);
  return (await getProject(id))!;
}

export async function updateProject(
  id: string,
  input: {
    name?: string;
    roomGeometry?: RoomGeometry;
    wallHeight?: number;
    placements?: PlacementInput[];
  },
): Promise<ProjectPayload | null> {
  const [existing] = await query<{ id: string }>('SELECT id FROM projects WHERE id = $1', [id]);
  if (!existing) return null;

  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    params.push(input.name.trim() || 'Новый проект');
    sets.push(`name = $${params.length}`);
  }
  if (input.roomGeometry !== undefined) {
    params.push(JSON.stringify(input.roomGeometry));
    sets.push(`room_geometry = $${params.length}`);
  }
  if (input.wallHeight !== undefined) {
    params.push(input.wallHeight);
    sets.push(`wall_height = $${params.length}`);
  }

  params.push(id);
  await execute(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (input.placements) await replacePlacements(id, input.placements);

  return getProject(id);
}

/**
 * При сохранении расстановка переписывается целиком. В комнате десятки
 * предметов, а не тысячи, поэтому вычисление диффа стоило бы дороже, чем
 * экономит, — а так сохранённое состояние в точности равно тому, что
 * пользователь видит на экране.
 */
async function replacePlacements(projectId: string, placements: PlacementInput[]) {
  const known = new Set(
    (await query<{ id: string }>('SELECT id FROM furniture')).map((r) => r.id),
  );

  await withTransaction(async (client) => {
    await client.query('DELETE FROM project_furniture WHERE project_id = $1', [projectId]);
    for (const p of placements) {
      if (!known.has(p.furnitureId)) continue;
      await client.query(
        `INSERT INTO project_furniture
           (project_id, furniture_id, position_x, position_y, position_z, rotation_y, scale)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          projectId,
          p.furnitureId,
          p.position[0],
          p.position[1],
          p.position[2],
          p.rotationY,
          p.scale,
        ],
      );
    }
  });
}

export async function deleteProject(id: string): Promise<boolean> {
  return (await execute('DELETE FROM projects WHERE id = $1', [id])) > 0;
}
