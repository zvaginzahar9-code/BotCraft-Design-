/**
 * Разворачивает схему в PostgreSQL и заполняет каталог мебели по тем GLB, что
 * лежат в public/models.
 *
 * Реальные размеры берутся из assets/catalog.json (`realSize` = метры по самой
 * длинной оси модели) в сочетании с измеренными габаритными боксами из
 * assets/model-bounds.json, которые пишет рендерер превью. Модели без записи в
 * каталоге всё равно импортируются с разумным значением по умолчанию, чтобы
 * только что добавленный GLB не исчезал из каталога молча.
 *
 * Схема не дублируется: она читается из src/lib/db.ts, который остаётся
 * единственным местом её описания.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { root } from '../lib/paths.mjs';
import { loadEnv } from '../lib/env.mjs';

loadEnv();

const MODELS = path.join(root, 'public', 'models');
const THUMBS = path.join(root, 'public', 'thumbs');

const SCHEMA = fs
  .readFileSync(path.join(root, 'src', 'lib', 'db.ts'), 'utf8')
  .match(/const SCHEMA = `([\s\S]*?)`;/)[1];

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'catalog.json'), 'utf8')).items;
const bounds = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'model-bounds.json'), 'utf8'));

const files = fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb')).sort();
const rows = [];

for (const file of files) {
  const id = path.basename(file, '.glb');
  const meta = catalog[id];
  const bbox = bounds[id];
  if (!bbox) {
    console.warn(`skip ${id}: no measured bounds (run assets:thumbs first)`);
    continue;
  }

  const maxAxis = Math.max(...bbox) || 1;
  const realSize = meta?.realSize ?? 1;
  const scale = realSize / maxAxis;
  const hasThumb = fs.existsSync(path.join(THUMBS, `${id}.webp`));

  rows.push({
    id,
    name: meta?.name ?? `Модель ${id.slice(0, 6)}`,
    category: meta?.category ?? 'Мебель',
    model_path: `/models/${file}`,
    thumbnail_path: hasThumb ? `/thumbs/${id}.webp` : '',
    width: +(bbox[0] * scale).toFixed(3),
    height: +(bbox[1] * scale).toFixed(3),
    depth: +(bbox[2] * scale).toFixed(3),
    default_scale: +scale.toFixed(5),
  });
}

const client = new pg.Client(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
);

try {
  await client.connect();
} catch (err) {
  console.error(
    'Не удалось подключиться к PostgreSQL. Проверьте .env.local ' +
      '(PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) и что сервер запущен.',
  );
  throw err;
}

try {
  await client.query(SCHEMA);

  // Каталог перезаливается целиком, но через UPSERT, а не DELETE: на furniture
  // ссылается project_furniture, и удаление строк унесло бы расстановку из
  // сохранённых проектов.
  await client.query('BEGIN');
  for (const r of rows) {
    await client.query(
      `INSERT INTO furniture
         (id, name, category, model_path, thumbnail_path, width, depth, height, default_scale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, category = excluded.category,
         model_path = excluded.model_path, thumbnail_path = excluded.thumbnail_path,
         width = excluded.width, depth = excluded.depth, height = excluded.height,
         default_scale = excluded.default_scale`,
      [
        r.id,
        r.name,
        r.category,
        r.model_path,
        r.thumbnail_path,
        r.width,
        r.depth,
        r.height,
        r.default_scale,
      ],
    );
  }
  await client.query('COMMIT');

  const { rows: byCategory } = await client.query(
    'SELECT category, COUNT(*)::int AS n FROM furniture GROUP BY category ORDER BY n DESC',
  );

  console.log(`seeded ${rows.length} furniture models`);
  for (const c of byCategory) console.log(`  ${c.category}: ${c.n}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  await client.end();
}
