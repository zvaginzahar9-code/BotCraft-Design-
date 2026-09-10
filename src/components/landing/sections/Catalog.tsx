'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Counter, EASE, LineHeading, Reveal } from '../motion';
import { ArrowUpRightIcon } from '@/components/ui/icons';
import { plural } from '@/lib/plural';

/**
 * Каталог.
 *
 * Секция показывает ровно те превью, что отрисованы из GLB-моделей, которые
 * грузятся в сцену: сначала лентой во всю ширину — как витрина, затем сеткой
 * с настоящим фильтром. Фильтр не декоративный: категории те же, что в панели
 * каталога внутри студии, и приходят из той же таблицы.
 */

export type ShowcaseItem = {
  id: string;
  name: string;
  category: string;
  thumbnail_path: string;
  width: number;
  depth: number;
  height: number;
};

const ALL = 'Все';
const GRID_SIZE = 8;

/** Лента превью. Дорожка дублируется, поэтому сдвиг на -50% замыкается бесшовно. */
function Marquee({ items }: { items: ShowcaseItem[] }) {
  const row = [...items, ...items];

  return (
    <div className="marquee-host relative overflow-hidden">
      {/* Края растворяются в фон секции, чтобы лента не обрубалась. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-paper to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-paper to-transparent" />

      <div
        className="marquee-track flex w-max gap-4 py-1"
        style={{ ['--marquee-duration' as string]: `${Math.max(items.length * 1.9, 40)}s` }}
      >
        {row.map((item, i) => (
          <figure
            key={`${item.id}-${i}`}
            className="group relative h-36 w-44 shrink-0 rounded-md border border-hairline bg-surface p-4 transition-colors duration-200 sm:h-40 sm:w-52"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnail_path}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-contain mix-blend-multiply"
            />
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-md bg-gradient-to-t from-white via-white/90 to-transparent px-4 pt-6 pb-2.5 text-[12px] text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {item.name}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export default function Catalog({
  items,
  total,
}: {
  items: ShowcaseItem[];
  total: number;
}) {
  const [active, setActive] = useState(ALL);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return [
      { name: ALL, count: items.length },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    ];
  }, [items]);

  const visible = useMemo(() => {
    if (active !== ALL) return items.filter((i) => i.category === active).slice(0, GRID_SIZE);
    // На «Все» показываем по одному предмету из каждой категории, а не первые
    // восемь по алфавиту: иначе витрина открывается восемью зеркалами подряд и
    // выглядит гораздо беднее каталога.
    const byCategory = new Map<string, ShowcaseItem[]>();
    for (const item of items) {
      const list = byCategory.get(item.category);
      if (list) list.push(item);
      else byCategory.set(item.category, [item]);
    }
    const lists = [...byCategory.values()];
    const picked: ShowcaseItem[] = [];
    for (let round = 0; picked.length < GRID_SIZE && round < 12; round++) {
      for (const list of lists) {
        if (picked.length >= GRID_SIZE) break;
        if (list[round]) picked.push(list[round]);
      }
    }
    return picked;
  }, [items, active]);

  return (
    <section id="catalog" className="overflow-hidden border-t border-hairline bg-paper">
      <div className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 sm:pt-32">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <LineHeading
              className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.04] tracking-[-0.04em]"
              lines={[
                <span key="n">
                  <span className="num tabular-nums">
                    <Counter to={total} />
                  </span>{' '}
                  {plural(total, 'модель,', 'модели,', 'моделей,')}
                </span>,
                'готовых встать в комнату',
              ]}
            />
          </div>

          <div className="flex flex-col justify-end gap-6 lg:col-span-4 lg:col-start-9">
            <Reveal delay={0.1}>
              <p className="max-w-sm text-[16px] leading-[1.65] text-muted">
                Диваны, кровати, столы, кухни, сантехника и декор. Каждое превью
                отрисовано из своей модели. Стоковых фото здесь нет.
              </p>
            </Reveal>
            <Reveal delay={0.16}>
              <Link
                href="/editor?new=1"
                className="group inline-flex items-center gap-2.5 text-[15px] font-medium text-ink"
              >
                Открыть конструктор
                <span className="grid h-7 w-7 place-items-center rounded-full border border-line transition-colors duration-200 group-hover:border-accent group-hover:bg-accent group-hover:text-white">
                  <ArrowUpRightIcon size={13} />
                </span>
              </Link>
            </Reveal>
          </div>
        </div>
      </div>

      {/* Витрина во всю ширину: она намеренно выходит за колонку текста. */}
      <Reveal delay={0.08} className="mt-14" amount={0.05}>
        <Marquee items={items} />
      </Reveal>

      <div className="mx-auto max-w-[1240px] px-5 pb-24 sm:px-8 sm:pb-32">
        {/* Фильтр по тем же категориям, что и в панели каталога студии. */}
        <Reveal className="mt-16 flex flex-wrap gap-1.5" y={12}>
          {categories.map((c) => {
            const on = c.name === active;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => setActive(c.name)}
                aria-pressed={on}
                className={`btn-base h-9 cursor-pointer rounded-full px-4 text-[13.5px] ${
                  on
                    ? 'bg-ink text-white'
                    : 'border border-line bg-surface text-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                {c.name}
                <span className={`num text-[11.5px] ${on ? 'text-white/55' : 'text-faint'}`}>
                  {c.count}
                </span>
              </button>
            );
          })}
        </Reveal>

        <motion.div layout className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((item) => (
              <motion.article
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.32, ease: EASE }}
                className="group overflow-hidden rounded-md border border-hairline bg-surface transition-colors duration-200 hover:border-line"
              >
                <div className="aspect-square bg-paper p-5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumbnail_path}
                    alt={item.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain mix-blend-multiply transition-transform duration-400 ease-out group-hover:scale-[1.04]"
                  />
                </div>
                <div className="flex items-baseline justify-between gap-2 border-t border-hairline px-4 py-3">
                  <span className="truncate text-[13.5px] font-medium">{item.name}</span>
                  <span className="num shrink-0 text-[11px] text-faint">
                    {Math.round(item.width * 100)}×{Math.round(item.depth * 100)}
                  </span>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
