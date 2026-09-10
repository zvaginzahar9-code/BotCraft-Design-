import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * Подключение к PostgreSQL.
 *
 * Параметры берутся из окружения: локально их подхватывает Next из
 * `.env.local`, на хостинге они приходят из настроек площадки. Используются
 * стандартные имена libpq (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE), которые
 * драйвер читает сам, поэтому конфигурация подключения нигде не дублируется.
 * Если задан `DATABASE_URL`, он имеет приоритет — так подключаются managed-базы,
 * которые выдают одну готовую строку.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS furniture (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  model_path     TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  width          DOUBLE PRECISION NOT NULL,
  depth          DOUBLE PRECISION NOT NULL,
  height         DOUBLE PRECISION NOT NULL,
  default_scale  DOUBLE PRECISION NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  room_geometry TEXT NOT NULL,
  wall_height   DOUBLE PRECISION NOT NULL DEFAULT 2.7,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_furniture (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  furniture_id TEXT NOT NULL REFERENCES furniture(id),
  position_x   DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y   DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_z   DOUBLE PRECISION NOT NULL DEFAULT 0,
  rotation_y   DOUBLE PRECISION NOT NULL DEFAULT 0,
  scale        DOUBLE PRECISION NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_furniture_category ON furniture(category);
CREATE INDEX IF NOT EXISTS idx_pf_project ON project_furniture(project_id);
`;

declare global {
  // Иначе перезагрузка модулей в dev-режиме Next создавала бы новый пул
  // соединений на каждую правку файла, и подключения к серверу копились бы.
  // eslint-disable-next-line no-var
  var __botcraftPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __botcraftSchema: Promise<void> | undefined;
}

export function getPool(): Pool {
  if (!global.__botcraftPool) {
    const url = process.env.DATABASE_URL;

    // Без настроек драйвер молча подставляет localhost и пользователя системы,
    // а падает уже на этапе аутентификации — сообщением про SASL, по которому
    // невозможно понять, что произошло. На хостинге это выглядит как
    // «Application error» с одним лишь digest. Поэтому проверяем конфигурацию
    // сами и говорим прямо, чего не хватает.
    if (!url && !process.env.PGHOST) {
      throw new Error(
        'База данных не настроена: не задан ни DATABASE_URL, ни PGHOST. ' +
          'Локально: скопируйте .env.example в .env.local и заполните его. ' +
          'На хостинге: задайте DATABASE_URL в переменных окружения проекта — ' +
          'база должна быть доступна по сети, localhost с машины разработчика ' +
          'хостингу не виден. См. раздел «Деплой» в README.md.',
      );
    }

    global.__botcraftPool = new Pool({
      ...(url ? { connectionString: url } : {}),
      // Иначе недоступная база не даёт ошибку вовсе: попытка подключения висит
      // без ограничения по времени, и запрос умирает по таймауту платформы —
      // без внятной причины в логах.
      connectionTimeoutMillis: 10_000,
    });
    // Иначе разрыв простаивающего соединения (перезапуск сервера БД, таймаут
    // на стороне хостинга) поднимался бы до необработанного исключения и ронял
    // весь процесс. Пул переоткрывает соединение сам, наше дело — не упасть.
    global.__botcraftPool.on('error', (err) => console.error('postgres pool error', err));
  }
  return global.__botcraftPool;
}

/**
 * Создание таблиц — один раз на процесс.
 *
 * Канонически схему разворачивает `npm run db:seed`, но приложение не обязано
 * знать, запускали его или нет: все выражения идемпотентны (`IF NOT EXISTS`),
 * поэтому дешевле выполнить их лениво при первом запросе, чем отдавать 500 на
 * пустой базе. При ошибке промис сбрасывается, чтобы следующий запрос повторил
 * попытку, а не залипал на закешированном отказе.
 */
function ensureSchema(): Promise<void> {
  if (!global.__botcraftSchema) {
    global.__botcraftSchema = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((err) => {
        global.__botcraftSchema = undefined;
        throw err;
      });
  }
  return global.__botcraftSchema;
}

/** Запрос со строками результата. Плейсхолдеры — `$1`, `$2`, … */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Запрос без результата: возвращает число затронутых строк. */
export async function execute(text: string, params: unknown[] = []): Promise<number> {
  await ensureSchema();
  const res = await getPool().query(text, params);
  return res.rowCount ?? 0;
}

/**
 * Транзакция на выделенном соединении.
 *
 * Пул раздаёт запросы по разным соединениям, поэтому `BEGIN`/`COMMIT` через
 * `query` попали бы в разные сессии и транзакции бы не было — соединение нужно
 * захватить целиком и обязательно вернуть в пул.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type FurnitureRow = {
  id: string;
  name: string;
  category: string;
  model_path: string;
  thumbnail_path: string;
  width: number;
  depth: number;
  height: number;
  default_scale: number;
};

export type ProjectRow = {
  id: string;
  name: string;
  room_geometry: string;
  wall_height: number;
  created_at: Date;
  updated_at: Date;
};

export type PlacementRow = {
  id: number;
  project_id: string;
  furniture_id: string;
  position_x: number;
  position_y: number;
  position_z: number;
  rotation_y: number;
  scale: number;
};
