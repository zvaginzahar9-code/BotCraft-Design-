'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { CatalogItem } from '@/store/studio';
import { preloadModel } from '@/components/scene/FurnitureItem';
import { CheckIcon, MagnifyingGlassIcon, XIcon } from '@/components/ui/icons';

/**
 * Каталог мебели.
 *
 * Здесь грузятся только метаданные и превью; сам GLB подтягивается, когда
 * предмет реально ставят в комнату. Наведение на карточку начинает скачивать
 * её меш заранее — к моменту клика он обычно уже в кэше, и предмет появляется
 * без ожидания.
 *
 * Разделы строятся по самой базе, а не по списку в коде: любая модель,
 * добавленная в каталог, немедленно оказывается доступной, а раздел без единой
 * модели просто не появляется. Порядок разделов задан вручную — по тому, как
 * обставляют комнату (сначала крупное, потом мелочь), — а всё, чего в этом
 * порядке не нашлось, идёт следом по алфавиту.
 */

const CATEGORY_ORDER = [
  'Диваны',
  'Кресла',
  'Стулья',
  'Столы',
  'Кровати',
  'Шкафы',
  'Тумбы',
  'Кухня',
  'Сантехника',
  'Освещение',
  'Декор',
];

const ALL = 'Все';

export default function CatalogPanel({
  items,
  loading,
  onAdd,
  touch = false,
}: {
  items: CatalogItem[];
  loading: boolean;
  onAdd: (item: CatalogItem) => void;
  /** Крупная сетка и цели под палец. */
  touch?: boolean;
}) {
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const addedTimer = useRef<number | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    const known = CATEGORY_ORDER.filter((name) => counts.has(name));
    const rest = [...counts.keys()]
      .filter((name) => !CATEGORY_ORDER.includes(name))
      .sort((a, b) => a.localeCompare(b, 'ru'));
    return [
      { name: ALL, count: items.length },
      ...[...known, ...rest].map((name) => ({ name, count: counts.get(name) ?? 0 })),
    ];
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        (category === ALL || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)),
    );
  }, [items, category, query]);

  // Категория может исчезнуть при перезагрузке каталога — откатываемся на «Все».
  useEffect(() => {
    if (category !== ALL && !items.some((i) => i.category === category)) setCategory(ALL);
  }, [items, category]);

  useEffect(
    () => () => {
      if (addedTimer.current) window.clearTimeout(addedTimer.current);
    },
    [],
  );

  const handleAdd = (item: CatalogItem) => {
    onAdd(item);
    setJustAdded(item.id);
    if (addedTimer.current) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(null), 1100);
  };

  const gridClass = touch
    ? 'grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5'
    : 'grid grid-cols-[repeat(auto-fill,minmax(94px,1fr))] gap-2';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <div className="relative">
          <MagnifyingGlassIcon
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по каталогу"
            aria-label="Поиск по каталогу"
            className={`field pr-8 pl-8 text-[13.5px] ${touch ? 'py-2.5' : 'py-1.5'}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="btn-base btn-quiet absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 rounded-[6px]"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Разделы. Горизонтальная лента, а не выпадающий список: на телефоне
          пролистать её быстрее, чем открыть меню, а на десктопе видно сразу
          весь состав каталога. */}
      <div className="relative shrink-0 border-b border-line">
        <div
          className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 py-2"
          role="tablist"
          aria-label="Разделы каталога"
        >
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              role="tab"
              onClick={() => setCategory(c.name)}
              aria-selected={category === c.name}
              className={`btn-base shrink-0 cursor-pointer rounded-full px-3 text-[12.5px] ${
                touch ? 'h-9' : 'h-7.5'
              } ${category === c.name ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}
            >
              {c.name}
              <span
                className={`num text-[10.5px] ${
                  category === c.name ? 'text-white/55' : 'text-faint'
                }`}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
        {/* Растворение у правого края: без него лента разделов выглядит
            обрезанной вёрсткой, а не прокручиваемой. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent"
        />
      </div>

      <div className="slim-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5">
        {loading ? (
          <div className={gridClass}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton h-[132px] rounded-[10px]" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[13.5px] font-medium">Ничего не нашлось</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              Попробуйте другое слово или снимите фильтр раздела.
            </p>
            {(query || category !== ALL) && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory(ALL);
                }}
                className="btn-base btn-ghost mt-4 h-9 px-3.5 text-[12.5px]"
              >
                Показать всё
              </button>
            )}
          </div>
        ) : (
          <div className={gridClass}>
            {visible.map((item) => {
              const added = justAdded === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleAdd(item)}
                  // Начинаем качать меш заранее: к клику он обычно уже в кэше.
                  onMouseEnter={() => preloadModel(item.model_path)}
                  onFocus={() => preloadModel(item.model_path)}
                  title={`Поставить «${item.name}» в комнату`}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[10px] border border-line bg-surface text-left transition-colors duration-150 hover:border-ink/25 active:scale-[0.98]"
                >
                  <div className="relative aspect-square bg-paper p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnail_path}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain mix-blend-multiply transition-transform duration-200 ease-out group-hover:scale-105"
                    />
                    {added && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 grid place-items-center bg-accent/92 text-white"
                      >
                        <CheckIcon size={22} weight="bold" />
                      </motion.span>
                    )}
                  </div>
                  <div className="border-t border-hairline px-2 py-1.5">
                    <div className="truncate text-[11.5px] font-medium">{item.name}</div>
                    <div className="num text-[10px] text-faint">
                      {Math.round(item.width * 100)}×{Math.round(item.depth * 100)} см
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
