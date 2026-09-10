import { NextResponse } from 'next/server';
import { query as dbQuery, type FurnitureRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Только метаданные каталога — никогда сами меши. Клиент рисует карточки по
 * превью отсюда, а GLB тянет из /models/* лениво, при первой реальной установке
 * предмета в комнату.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const search = searchParams.get('q');

  const where: string[] = [];
  const params: unknown[] = [];
  if (category && category !== 'Все') {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`lower(name) LIKE $${params.length}`);
  }

  const items = await dbQuery<FurnitureRow>(
    `SELECT id, name, category, model_path, thumbnail_path, width, depth, height, default_scale
     FROM furniture
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY category, name`,
    params,
  );

  // COUNT — bigint, драйвер отдал бы его строкой: приводим к int, иначе счётчик
  // в фильтре каталога поехал бы на сравнениях чисел.
  const categories = await dbQuery<{ category: string; count: number }>(
    'SELECT category, COUNT(*)::int AS count FROM furniture GROUP BY category ORDER BY category',
  );

  return NextResponse.json({ items, categories });
}
